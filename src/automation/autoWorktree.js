/** 自动建 worktree：每次同步结束后跑一轮（串行、单飞、可熔断）。
 *
 * 走宿主 `ctx.worktrees.create` 同一条管线（侧栏有进度、可取消）。建好的 worktree
 * 记为“自动”，不让 PR 进入审查中；你点「开始审查」后才转为你的。PR 结束后不自动删，
 * 只列为可清理（见 cleanup.js）。
 *
 * 宿主在创建 resolve 之后才异步刷新侧栏，所以“绑定到 PR”放在对账里做：
 * 记录第一次在侧栏里解析出 workspaceId 时绑定。 */

import { AUTO_WT_BREAKER, AUTO_WT_RETRY_MS, DAY } from "../constants.js";
import {
  classifyCreateError,
  hasAnyWorktree,
  pickAutoCandidates,
  pruneRecords,
  reconcileRecords,
  recordAfterFailure,
} from "../domain/autowt.js";
import { newBranchName } from "../domain/link.js";
import { meSetOf, trackedRows, worktreesOf } from "../rows.js";
import { createCleanup } from "./cleanup.js";

const RECORD_TTL_MS = 30 * DAY;

function freshRecord(prev, { branch, repo, now }) {
  return {
    status: "creating",
    attempts: (prev?.attempts || 0) + 1,
    at: now,
    branch,
    repo: repo.slug,
    parentId: repo.workspaceId,
    workspaceId: "",
    path: "",
    missingSince: 0,
    lastError: prev?.lastError || "",
  };
}

/** 新解析出 workspaceId 的自动记录：绑到它的 PR（PR 还没绑、worktree 也没被别的 PR 占）。 */
function bindNewlyResolved(store, before, after) {
  const bindings = store.getSnapshot().local.bindings;
  const taken = new Set(Object.values(bindings));
  for (const [key, next] of Object.entries(after)) {
    const prev = before[key];
    if (next.status !== "created" || !next.workspaceId || prev?.workspaceId === next.workspaceId) continue;
    if (bindings[key] || taken.has(next.workspaceId)) continue;
    store.bind(key, next.workspaceId);
    taken.add(next.workspaceId);
  }
}

function createReconciler({ store, index, now, inFlight }) {
  return function reconcile() {
    const snap = index.getSnapshot();
    if (snap.loading || snap.error) return;
    const before = store.getSnapshot().auto;
    const step = reconcileRecords({
      records: before,
      wts: snap.worktrees,
      repoSlugs: new Set(snap.repos.map((r) => r.slug)),
      parentIds: new Set(snap.repos.map((r) => r.workspaceId)),
      inFlight,
      now: now(),
    });
    const live = new Set(store.allPrs().map((p) => p.key));
    const pruned = pruneRecords(step.records, live, now(), RECORD_TTL_MS);
    if (!step.changed && !pruned.changed) return;
    store.setAutoRecords(pruned.records);
    bindNewlyResolved(store, before, pruned.records);
  };
}

function createCreator({ ctx, store, index, now, newBranch, reconcile, isDisposed }) {
  async function attemptCreate(pr, repo, prev, branch) {
    const record = freshRecord(prev, { branch, repo, now: now() });
    store.setAutoRecord(pr.key, record);
    try {
      const result = await ctx.worktrees.create({
        repoPath: repo.path,
        parentWorkspaceId: repo.workspaceId,
        branch,
        prNumber: pr.number,
        prTitle: pr.title,
        prUrl: pr.url,
      });
      // 已卸载：别覆盖新实例的数据，留给它按分支名认领。
      if (isDisposed()) return { ok: true, record };
      // 先记为已建（按路径识别为自动），再刷新侧栏；绑定在对账里完成。
      store.setAutoRecord(pr.key, { ...record, status: "created", at: now(), path: result.worktreePath, lastError: "" });
      await index.refresh();
      if (!isDisposed()) reconcile();
      return { ok: true, record };
    } catch (error) {
      return { ok: false, record, message: error?.message || String(error) };
    }
  }

  /** 建一个；返回 created / transient / failed / skip。 */
  return async function createOne(pr) {
    const repo = index.getSnapshot().repos.find((r) => r.slug === pr.repoSlug);
    if (!repo) return "skip";
    let prev = store.getSnapshot().auto[pr.key];
    for (let renamed = 0; renamed < 2; renamed += 1) {
      const outcome = await attemptCreate(pr, repo, prev, newBranch(pr));
      if (outcome.ok) return "created";
      if (isDisposed()) return "skip";
      const { action } = classifyCreateError(outcome.message);
      if (action === "rename" && renamed === 0) {
        prev = outcome.record;
        continue;
      }
      store.setAutoRecord(pr.key, recordAfterFailure(outcome.record, outcome.message, now()));
      return action === "retry" ? "transient" : "failed";
    }
    return "failed";
  };
}

function plan(store, index, now, perRun) {
  const state = store.getSnapshot();
  const snap = index.getSnapshot();
  const { rows, prs, wts } = trackedRows(store, index, now());
  return pickAutoCandidates({
    rows,
    wts,
    prs,
    bindings: state.local.bindings,
    rules: state.cfg.rules,
    records: state.auto,
    repoSlugs: new Set(snap.repos.map((r) => r.slug)),
    skipSlugs: new Set(Object.keys(state.runtime.errors || {})),
    meSet: meSetOf(state),
    includeForks: state.cfg.automation.autoWorktreeForks,
    max: state.cfg.automation.autoWorktreeMax,
    now: now(),
    ...(perRun ? { perRun } : {}),
  });
}

/** 这一轮不能跑的原因；null = 可以跑。 */
function blockedReason(store, index) {
  const state = store.getSnapshot();
  const snap = index.getSnapshot();
  if (!state.ready || !state.cfg.automation.autoWorktree) return "disabled";
  // 不知道自己是谁时无法排除你自己的 PR，宁可不建。
  if (!state.runtime.ghLogin || state.runtime.ghError) return "noLogin";
  if (snap.loading || snap.error || snap.repos.length === 0) return "indexNotReady";
  return null;
}

function stillNeeded(store, index, pr) {
  const state = store.getSnapshot();
  return !hasAnyWorktree(pr, {
    wts: worktreesOf(store, index),
    prs: store.allPrs(),
    bindings: state.local.bindings,
    rules: state.cfg.rules,
  });
}

/** 熔断：跨轮保持。熔断期间每 AUTO_WT_RETRY_MS 只放 1 个试探，成功才恢复。
 *  宿主每次失败都在侧栏留一条失败行，持续性故障时不能每轮都再失败 3 次。 */
function createBreaker({ store, now }) {
  let until = 0;
  let tripped = false;
  const publish = () => store.setRuntime({ autoBreaker: tripped ? { until } : null });
  return {
    isTripped: () => tripped,
    blocked: () => tripped && now() < until,
    until: () => until,
    trip: () => {
      tripped = true;
      until = now() + AUTO_WT_RETRY_MS;
      publish();
    },
    reset: () => {
      if (!tripped) return;
      tripped = false;
      until = 0;
      publish();
    },
  };
}

export function createAutoWorktree({ ctx, store, index, exec, now = Date.now, newBranch = newBranchName }) {
  const inFlight = new Set();
  let running = null;
  let disposed = false;
  const isDisposed = () => disposed;
  const reconcile = createReconciler({ store, index, now, inFlight });
  const createOne = createCreator({ ctx, store, index, now, newBranch, reconcile, isDisposed });
  const breaker = createBreaker({ store, now });
  const cleanup = createCleanup({ ctx, store, index, exec, now, isDisposed });
  const claim = (prKey) => {
    if (inFlight.has(prKey)) return false;
    inFlight.add(prKey);
    return true;
  };
  const release = (prKey) => {
    inFlight.delete(prKey);
  };

  async function createPicked(picks, onProgress) {
    let created = 0;
    let failed = 0;
    let transient = 0;
    let done = 0;
    const report = () => onProgress?.({ done, total: picks.length });
    report();
    for (const pr of picks) {
      if (disposed || !store.getSnapshot().cfg.automation.autoWorktree) break;
      if (!stillNeeded(store, index, pr) || !claim(pr.key)) continue;
      let outcome;
      try {
        outcome = await createOne(pr);
      } finally {
        release(pr.key);
      }
      if (outcome === "created") {
        created += 1;
        breaker.reset();
      } else if (outcome === "transient" || outcome === "failed") {
        failed += 1;
      }
      done += 1;
      report();
      transient = outcome === "transient" ? transient + 1 : 0;
      // 熔断中的试探失败：继续熔断并顺延；否则连续 N 次才熔断。
      if (transient && (breaker.isTripped() || transient >= AUTO_WT_BREAKER)) {
        breaker.trip();
        break;
      }
    }
    return { created, failed };
  }

  /** 一轮的结果：{ created, failed, reason, plan }。reason 供「执行」按钮解释：
   *  disabled / noLogin / indexNotReady / breaker / capped / none / created / failed。 */
  /** 后台同步每轮最多 AUTO_WT_PER_RUN 个（别让侧栏一次刷出几十条进度）；
   *  你手动点「执行」就一次建到上限。熔断中只放 1 个试探。 */
  function perRunFor(manual) {
    if (breaker.isTripped()) return 1;
    return manual ? Infinity : 0;
  }

  async function runOnce({ manual, onProgress }) {
    reconcile();
    const blocked = disposed ? "disabled" : blockedReason(store, index);
    if (blocked) return { created: 0, failed: 0, reason: blocked };
    if (breaker.blocked()) return { created: 0, failed: 0, reason: "breaker", until: breaker.until() };
    const picked = plan(store, index, now, perRunFor(manual));
    if (!picked.picks.length) return { created: 0, failed: 0, reason: picked.capped ? "capped" : "none", plan: picked };
    const { created, failed } = await createPicked(picked.picks, onProgress);
    return { created, failed, manual, reason: created ? "created" : "failed", plan: picked };
  }

  /** 单飞：后台触发直接复用进行中的一轮；手动触发等它跑完再跑自己的一轮。 */
  function run({ manual = false, onProgress } = {}) {
    if (running && !manual) return running;
    const previous = running;
    const current = (async () => {
      if (previous) await previous.catch(() => undefined);
      return runOnce({ manual, onProgress });
    })();
    running = current;
    current
      .finally(() => {
        if (running === current) running = null;
      })
      .catch(() => undefined);
    return current;
  }

  /** 实时状态（设置页 / 横幅用）：清理、开始审查之后立刻反映。 */
  function status() {
    const { autoWorktree: enabled, autoWorktreeMax: max } = store.getSnapshot().cfg.automation;
    const { alive, capped, waiting, total, eligible, skipped } = plan(store, index, now, 0);
    return {
      enabled,
      max,
      alive,
      total,
      eligible,
      skipped,
      capped: enabled && capped,
      waiting,
      breaker: enabled && breaker.isTripped(),
    };
  }

  function adopt(prKey) {
    const record = store.getSnapshot().auto[prKey];
    if (!record || record.status !== "created") return;
    store.setAutoRecord(prKey, { ...record, status: "adopted", at: now() });
    store.markReviewing(prKey, now());
  }

  function adoptWorktree(workspaceId) {
    const hit = Object.entries(store.getSnapshot().auto).find(
      ([, r]) => r.status === "created" && r.workspaceId === workspaceId,
    );
    if (hit) store.setAutoRecord(hit[0], { ...hit[1], status: "adopted", at: now() });
  }

  function resetFailures() {
    const records = store.getSnapshot().auto;
    const keep = Object.fromEntries(
      Object.entries(records).filter(([, r]) => r.status !== "failed" && r.status !== "gave_up"),
    );
    const cleared = Object.keys(records).length - Object.keys(keep).length;
    if (cleared) store.setAutoRecords(keep);
    breaker.reset();
    return cleared;
  }

  return {
    run,
    reconcile,
    claim,
    release,
    isBusy: (prKey) => inFlight.has(prKey),
    status,
    adopt,
    adoptWorktree,
    resetFailures,
    ...cleanup,
    dispose: () => {
      disposed = true;
    },
  };
}
