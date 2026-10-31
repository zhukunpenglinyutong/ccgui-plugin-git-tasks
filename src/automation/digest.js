/** 飞书每小时汇总的调度与发送。
 *
 * - 按墙钟判断“这个整点发过没有”（窗口在后台时定时器可能被节流，睡眠唤醒后只补一条）；
 * - 先占用槽位再干活，发送前按发送时刻再占一次（跨整点也只算一条）；
 * - 发之前同步一次（不受「仅前台同步」限制；2 分钟内刚同步过就不重复）；
 * - 与上次**成功发出**的快照比对，没变化就不发；
 * - 暂时性问题（网络 / 飞书 5xx / 唤醒后网络还没恢复导致全部仓库同步失败）：
 *   同一个整点内每 5 分钟再试，最多 3 次，之后等下个整点；
 * - 配置错误（签名 / 关键词 / IP / 地址失效）暂停自动发送，修好后点「恢复」；
 * - 换机器人 / 关掉 / 卸载时，进行中的发送不再重试、不改基线。 */

import { DIGEST_TICK_MS, MINUTE } from "../constants.js";
import {
  diffDigest,
  digestSnapshot,
  errorCategory,
  fitDigestPost,
  isQuietHour,
  postToText,
  slotKey,
} from "../domain/digest.js";
import { describeFeishuFailure, redact, sendFeishu, validateWebhook } from "../notify/feishu.js";
import { trackedRows } from "../rows.js";

const SLOT_RETRY_MS = 5 * MINUTE;
const SLOT_RETRIES = 3;
const FRESH_SYNC_MS = 2 * MINUTE;

const liveSlugs = (state) =>
  state.cfg.repos.filter((r) => r.enabled !== false && r.available !== false).map((r) => r.slug);

function currentErrors(state) {
  const live = new Set(liveSlugs(state));
  // 只比对 / 发送错误类别：原始输出每次可能不同（会每小时重复提醒），也可能带本机路径。
  const errors = Object.fromEntries(
    Object.entries(state.runtime.errors || {})
      .filter(([slug, msg]) => live.has(slug) && typeof msg === "string")
      .map(([slug, msg]) => [slug, errorCategory(msg)]),
  );
  if (state.runtime.ghError) errors["*"] = errorCategory(state.runtime.ghError);
  return errors;
}

/** 所有仓库都没同步成功：多半是刚唤醒网络还没恢复，先等等再发。 */
function allFailed(state, errors) {
  const live = liveSlugs(state);
  return !!errors["*"] || (live.length > 0 && live.every((slug) => errors[slug]));
}

function collect(store, index, now) {
  const state = store.getSnapshot();
  const { rows } = trackedRows(store, index, now);
  return { current: digestSnapshot(rows, state.cfg.repos), errors: currentErrors(state) };
}

function createSlotRetry(now) {
  let retry = null;
  return {
    due: (slot) => !!retry && retry.slot === slot && retry.count <= SLOT_RETRIES && now() >= retry.at,
    exhausted: (slot) => !!retry && retry.slot === slot && retry.count >= SLOT_RETRIES,
    schedule: (slot) => {
      const count = retry?.slot === slot ? retry.count + 1 : 1;
      retry = { slot, count, at: now() + SLOT_RETRY_MS };
    },
    clear: () => {
      retry = null;
    },
  };
}

function createSender({ ctx, store, t, now, sleep }) {
  const invoke = (command, args) => ctx.bridge.invoke(command, args);
  return {
    build(current, errors, diff, test) {
      const state = store.getSnapshot();
      return fitDigestPost({ current, diff, errors, defs: state.cfg.defs, repos: state.cfg.repos, now: now(), t, locale: ctx.host?.locale, test });
    },
    async deliver(payload, shouldAbort) {
      const { webhook, secret } = store.getSnapshot().feishu;
      const send = (body) => sendFeishu({ invoke, webhook, secret, payload: body, now, shouldAbort, ...(sleep ? { sleep } : {}) });
      const result = await send(payload);
      // 富文本格式被拒：同样内容改发纯文本，汇总不丢。
      if (result.ok || result.kind !== "format" || payload.msg_type !== "post" || shouldAbort()) return result;
      return send(postToText(payload));
    },
    recordFailure(result) {
      const message = describeFeishuFailure(result, t);
      store.setNotifyState({
        lastResult: { ok: false, at: now(), message },
        ...(result.fatal ? { paused: { kind: result.kind, message, at: now() } } : {}),
      });
      return message;
    },
  };
}

export function createDigest({
  ctx,
  store,
  index,
  sync,
  t,
  now = Date.now,
  sleep,
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (id) => clearInterval(id),
}) {
  let timer = null;
  let running = null;
  let disposed = false;
  // 换机器人 / 重新开启时 +1：进行中的发送据此放弃，不把基线写给新目标。
  let generation = 0;
  const retry = createSlotRetry(now);
  const sender = createSender({ ctx, store, t, now, sleep });

  function configured() {
    const state = store.getSnapshot();
    return state.ready && state.cfg.notify.feishu && validateWebhook(state.feishu.webhook).ok;
  }

  function due() {
    const state = store.getSnapshot();
    if (!configured() || state.notify.paused) return false;
    const slot = slotKey(now());
    return slot !== state.notify.lastSlot || retry.due(slot);
  }

  async function freshSync() {
    const last = store.getSnapshot().runtime.lastSync || 0;
    if (now() - last >= FRESH_SYNC_MS) await sync.run();
  }

  async function sendDiff({ current, errors, diff, slot, gen }) {
    // 按发送时刻再占一次槽位：10:59 开始、11:00 才发出的那条算 11 点的。
    store.setNotifyState({ lastSlot: slotKey(now()) });
    const stale = () => disposed || gen !== generation || !configured();
    const result = await sender.deliver(sender.build(current, errors, diff, false), stale);
    if (stale()) return { skipped: "stale" };
    if (!result.ok) {
      if (!result.fatal) retry.schedule(slot);
      return { failed: sender.recordFailure(result) };
    }
    retry.clear();
    store.setNotifyState({
      baseline: { repos: current, errors },
      lastSentAt: now(),
      lastResult: { ok: true, at: now(), message: "" },
      paused: null,
    });
    return { sent: true };
  }

  async function runSlot() {
    const gen = generation;
    const slot = slotKey(now());
    store.setNotifyState({ lastSlot: slot });
    if (isQuietHour(now(), store.getSnapshot().cfg.notify)) return { skipped: "quiet" };
    await freshSync();
    if (disposed || gen !== generation || !configured()) return { skipped: "stale" };
    const { current, errors } = collect(store, index, now());
    if (allFailed(store.getSnapshot(), errors) && !retry.exhausted(slot)) {
      retry.schedule(slot);
      return { skipped: "offline" };
    }
    const diff = diffDigest(store.getSnapshot().notify.baseline, current, errors);
    if (!diff.hasChanges) {
      retry.clear();
      return { skipped: "same" };
    }
    return sendDiff({ current, errors, diff, slot, gen });
  }

  function check() {
    if (disposed) return Promise.resolve(null);
    if (running) return running;
    if (!due()) return Promise.resolve(null);
    running = runSlot()
      .catch((error) => {
        store.setNotifyState({ lastResult: { ok: false, at: now(), message: redact(error?.message || error) } });
        return { failed: true };
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  /** 发一条测试消息：无视去重、不动基线；成功则解除暂停。 */
  async function sendTest() {
    try {
      if (!validateWebhook(store.getSnapshot().feishu.webhook).ok) {
        return { ok: false, message: describeFeishuFailure({ kind: "invalid" }, t) };
      }
      const { current, errors } = collect(store, index, now());
      const payload = sender.build(current, errors, diffDigest(null, current, errors), true);
      const result = await sender.deliver(payload, () => disposed);
      if (!result.ok) return { ok: false, message: sender.recordFailure(result) };
      store.setNotifyState({ paused: null, lastResult: { ok: true, at: now(), message: "" } });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: redact(error?.message || error) };
    }
  }

  return {
    check,
    sendTest,
    /** 解除暂停并允许本小时立即再发。 */
    resume: () => {
      retry.clear();
      store.setNotifyState({ paused: null, lastSlot: "" });
    },
    /** 换了机器人 / 重新开启：新目标当作首次汇总；进行中的发送作废。 */
    onTargetChanged: () => {
      generation += 1;
      retry.clear();
      store.setNotifyState({ baseline: null, lastSlot: "", paused: null });
    },
    start: () => {
      if (timer || disposed) return;
      timer = setTimer(() => {
        void check();
      }, DIGEST_TICK_MS);
    },
    dispose: () => {
      disposed = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}
