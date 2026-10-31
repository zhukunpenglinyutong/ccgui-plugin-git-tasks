import test from "node:test";
import assert from "node:assert/strict";
import { createDigest } from "../src/automation/digest.js";
import { createStore } from "../src/store.js";
import { createT } from "../src/i18n.js";
import { makePr, NOW } from "./helpers.js";

const SLUG = "acme/desktop";
const HOOK = "https://open.feishu.cn/open-apis/bot/v2/hook/1b2c3d4e-aaaa-bbbb-cccc-1234567890ab";
const at = (h, m = 5) => new Date(2026, 9, 30, h, m).getTime();
const pr = (n, extra = {}) => makePr({ number: n, repo: "desktop", owner: "acme", ...extra });

async function harness({ enabled = true, webhook = HOOK, quiet = false, responses = [] } = {}) {
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  await store.init();
  store.setRepos([{ slug: SLUG, enabled: true, available: true }]);
  store.setSnapshot(SLUG, { syncedAt: NOW, prs: [pr(1), pr(2)], daily: {} });
  store.setRuntime({ ghLogin: "me" });
  store.setFeishu({ webhook, secret: "" });
  store.setNotifyCfg({ feishu: enabled, quiet, quietStart: 22, quietEnd: 8 });
  const index = { getSnapshot: () => ({ repos: [], worktrees: [], loading: false, error: null }) };
  const sent = [];
  const queue = [...responses];
  const ctx = {
    host: { locale: "zh-CN" },
    bridge: {
      invoke: async (command, args) => {
        sent.push({ command, body: JSON.parse(args.body) });
        const next = queue.shift() ?? { status: 200, body: '{"code":0}' };
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  let syncs = 0;
  let syncHook = null;
  const sync = {
    run: async () => {
      syncs += 1;
      if (syncHook) await syncHook();
    },
  };
  let clock = at(10);
  const digest = createDigest({
    ctx,
    store,
    index,
    sync,
    t: createT("zh-CN"),
    now: () => clock,
    sleep: async () => {},
    setTimer: () => 1,
    clearTimer: () => {},
  });
  return {
    store,
    digest,
    sent,
    syncs: () => syncs,
    setClock: (value) => {
      clock = value;
    },
    onSync: (fn) => {
      syncHook = fn;
    },
    titles: () => sent.map((s) => s.body.content.post.zh_cn.title),
  };
}

test("关闭或 webhook 无效时不发", async () => {
  const off = await harness({ enabled: false });
  await off.digest.check();
  assert.equal(off.sent.length, 0);
  const bad = await harness({ webhook: "https://evil.com/x" });
  await bad.digest.check();
  assert.equal(bad.sent.length, 0);
});

test("每个整点最多一条：首次发初始汇总；同一小时不重发；没变化的整点跳过", async () => {
  const h = await harness();
  await h.digest.check();
  assert.equal(h.sent.length, 1);
  assert.match(h.titles()[0], /首次/);
  assert.equal(h.syncs(), 1, "发之前先同步");
  await h.digest.check();
  assert.equal(h.sent.length, 1);
  h.setClock(at(11));
  await h.digest.check();
  assert.equal(h.sent.length, 1, "没有变化不发");
  assert.equal(h.store.getSnapshot().notify.lastSlot, "2026-10-30T11");
});

test("有状态变化的整点才发，内容是相对上次已发送的变化", async () => {
  const h = await harness();
  await h.digest.check();
  h.store.setSnapshot(SLUG, {
    syncedAt: NOW,
    prs: [pr(1, { reviews: [{ state: "APPROVED", at: NOW - 1000 }] }), pr(2)],
    daily: {},
  });
  h.setClock(at(11));
  await h.digest.check();
  assert.equal(h.sent.length, 2);
  const lines = h.sent[1].body.content.post.zh_cn.content.map((l) => l.map((e) => e.text).join(""));
  assert.ok(lines.some((l) => /#1 .*：待审查 → 已通过/.test(l)));
});

test("静默时段：占用槽位但不发；静默结束后把累积的变化合并成一条", async () => {
  const h = await harness({ quiet: true });
  await h.digest.check();
  h.setClock(at(23));
  h.store.setSnapshot(SLUG, { syncedAt: NOW, prs: [pr(1), pr(2), pr(3)], daily: {} });
  await h.digest.check();
  h.setClock(at(23, 50) + 7 * 3600_000);
  await h.digest.check();
  assert.equal(h.sent.length, 1, "23:05 / 06:55 都在静默时段");
  h.setClock(at(8) + 86_400_000);
  await h.digest.check();
  assert.equal(h.sent.length, 2);
});

test("睡眠 / 关机后恢复只补发一条", async () => {
  const h = await harness();
  await h.digest.check();
  h.store.setSnapshot(SLUG, { syncedAt: NOW, prs: [pr(1), pr(2), pr(3)], daily: {} });
  h.setClock(at(18));
  await h.digest.check();
  await h.digest.check();
  assert.equal(h.sent.length, 2);
});

test("配置错误（签名失败）：暂停自动发送；恢复后下个整点继续", async () => {
  const h = await harness({ responses: [{ status: 200, body: '{"code":19021,"msg":"sign match fail"}' }] });
  await h.digest.check();
  assert.equal(h.sent.length, 1);
  const state = h.store.getSnapshot().notify;
  assert.equal(state.paused.kind, "sign");
  assert.equal(state.baseline, null);
  h.setClock(at(11));
  await h.digest.check();
  assert.equal(h.sent.length, 1, "暂停期间不发");
  h.digest.resume();
  await h.digest.check();
  assert.equal(h.sent.length, 2);
  assert.equal(h.store.getSnapshot().notify.paused, null);
});

test("暂时性失败：不暂停、不更新基线；同一整点 5 分钟后再试", async () => {
  const fail = { status: 502, body: "" };
  const h = await harness({ responses: [fail, fail, fail] });
  await h.digest.check();
  assert.equal(h.sent.length, 3, "一次发送内连发 3 次（重试 2 次）");
  assert.equal(h.store.getSnapshot().notify.paused, null);
  assert.equal(h.store.getSnapshot().notify.lastResult.ok, false);
  h.setClock(at(10, 7));
  await h.digest.check();
  assert.equal(h.sent.length, 3, "5 分钟内不重试");
  h.setClock(at(10, 11));
  await h.digest.check();
  assert.equal(h.sent.length, 4, "同一整点内重试成功");
  assert.match(h.titles()[3], /首次/);
  h.setClock(at(10, 40));
  await h.digest.check();
  assert.equal(h.sent.length, 4, "成功后本整点不再发");
});

test("唤醒后网络未恢复（所有仓库同步失败）：先推迟，不发一条全是错误的消息", async () => {
  const h = await harness();
  await h.digest.check();
  h.store.setRuntime({ errors: { "acme/desktop": "连接 GitHub 失败（网络或代理问题）" } });
  h.setClock(at(18));
  await h.digest.check();
  assert.equal(h.sent.length, 1, "推迟");
  h.store.setRuntime({ errors: {} });
  h.store.setSnapshot(SLUG, { syncedAt: NOW, prs: [pr(1), pr(2), pr(3)], daily: {} });
  h.setClock(at(18, 11));
  await h.digest.check();
  assert.equal(h.sent.length, 2, "网络恢复后同一整点内补发");
  const lines = h.sent[1].body.content.post.zh_cn.content.map((l) => l.map((e) => e.text).join(""));
  assert.ok(!lines.some((l) => /同步失败/.test(l)));
});

test("一直同步失败：推迟 3 次后照常发出失败提醒", async () => {
  const h = await harness();
  await h.digest.check();
  h.store.setRuntime({ ghError: "gh 未登录。请在终端执行 `gh auth login`" });
  for (const minute of [5, 11, 17, 23]) {
    h.setClock(at(12, minute));
    await h.digest.check();
  }
  assert.equal(h.sent.length, 2);
  const lines = h.sent[1].body.content.post.zh_cn.content.map((l) => l.map((e) => e.text).join(""));
  assert.ok(lines.some((l) => /同步失败：gh 未登录/.test(l)));
});

test("同步跨过整点：按发送时刻占槽位，下个整点不重复发", async () => {
  const h = await harness();
  h.setClock(at(10, 59));
  h.onSync(async () => {
    h.setClock(at(11, 0) + 30_000);
  });
  await h.digest.check();
  assert.equal(h.sent.length, 1);
  h.onSync(null);
  h.setClock(at(11, 2));
  await h.digest.check();
  assert.equal(h.sent.length, 1);
});

test("刚同步过（2 分钟内）不再强制同步", async () => {
  const h = await harness();
  h.store.setRuntime({ lastSync: at(10, 4) });
  await h.digest.check();
  assert.equal(h.syncs(), 0);
  assert.equal(h.sent.length, 1);
});

test("并发触发（定时器 + 回到前台）只发一条", async () => {
  const h = await harness();
  await Promise.all([h.digest.check(), h.digest.check(), h.digest.check()]);
  assert.equal(h.sent.length, 1);
});

test("测试消息：无视去重，不改基线，成功后解除暂停", async () => {
  const h = await harness();
  await h.digest.check();
  const baseline = h.store.getSnapshot().notify.baseline;
  h.store.setNotifyState({ paused: { kind: "sign", message: "", at: 0 } });
  const out = await h.digest.sendTest();
  assert.equal(out.ok, true);
  assert.match(h.titles()[1], /测试/);
  assert.equal(h.store.getSnapshot().notify.baseline, baseline);
  assert.equal(h.store.getSnapshot().notify.paused, null);
});

test("发送途中换 webhook：旧地址不再重试，基线不写给新目标", async () => {
  const fail = { status: 502, body: "" };
  const h = await harness({ responses: [fail, fail, fail] });
  const pending = h.digest.check();
  h.digest.onTargetChanged();
  await pending;
  assert.ok(h.sent.length < 3, `旧地址的重试应中止，实际 ${h.sent.length} 次`);
  assert.equal(h.store.getSnapshot().notify.baseline, null);
  await h.digest.check();
  assert.match(h.titles().at(-1), /首次/);
});

test("测试消息出错不会卡住（返回失败而不是抛出）", async () => {
  const h = await harness({ responses: [new Error("boom")] });
  h.store.setFeishu({ secret: "" });
  const out = await h.digest.sendTest();
  assert.equal(typeof out.ok, "boolean");
});

test("换 webhook：重置基线与槽位，新群收到首次汇总", async () => {
  const h = await harness();
  await h.digest.check();
  h.digest.onTargetChanged();
  assert.equal(h.store.getSnapshot().notify.baseline, null);
  await h.digest.check();
  assert.equal(h.sent.length, 2);
  assert.match(h.titles()[1], /首次/);
});

test("富文本格式被拒：自动改发纯文本，发送成功、不暂停", async () => {
  const h = await harness({ responses: [{ status: 200, body: '{"code":19002,"msg":"params error, unknown content value"}' }] });
  await h.digest.check();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].body.msg_type, "post");
  assert.equal(h.sent[1].body.msg_type, "text");
  assert.match(h.sent[1].body.content.text, /^Git 任务汇总/);
  const notify = h.store.getSnapshot().notify;
  assert.equal(notify.paused, null);
  assert.ok(notify.baseline, "纯文本发成功也算发出");
});

test("测试消息同样会改发纯文本", async () => {
  const h = await harness({ responses: [{ status: 200, body: '{"code":19002,"msg":"params error, unknown content value"}' }] });
  const out = await h.digest.sendTest();
  assert.equal(out.ok, true);
  assert.equal(h.sent[1].body.msg_type, "text");
});
