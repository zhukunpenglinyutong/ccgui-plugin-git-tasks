import test from "node:test";
import assert from "node:assert/strict";
import { createStore, defaultConfig, trimSnapshot } from "../src/store.js";
import { DEFAULT_RULES, STORE_VERSION } from "../src/constants.js";
import { derive } from "../src/domain/derive.js";
import { makePr, NOW, DAY_MS } from "./helpers.js";

function memoryBackend(seed = {}) {
  const values = new Map(Object.entries(seed));
  const writes = [];
  return {
    values,
    writes,
    load: async (key) => (values.has(key) ? structuredClone(values.get(key)) : null),
    save: async (key, value) => {
      writes.push([key, value]);
      values.set(key, structuredClone(value));
    },
  };
}

const flushMicro = () => new Promise((resolve) => setTimeout(resolve, 0));

test("init：配置迁移到默认值，版本不符的快照丢弃", async () => {
  const backend = memoryBackend({
    cfg: { v: STORE_VERSION, rules: { overdueReview: 9 }, repos: [{ slug: "acme/a", enabled: false }] },
    "snap:acme/a": { v: 0, prs: ["bad"] },
    local: { v: 1, marks: {}, bindings: {}, order: {}, ignored: [] },
  });
  const store = createStore({ load: backend.load, save: backend.save });
  await store.init();
  const s = store.getSnapshot();
  assert.equal(s.ready, true);
  assert.equal(s.cfg.rules.overdueReview, 9);
  assert.equal(s.cfg.rules.commentReview, DEFAULT_RULES.commentReview);
  assert.deepEqual(s.cfg.repos, [{ slug: "acme/a", enabled: false }]);
  assert.deepEqual(s.snapshots, {});
});

test("配置变更不可变且防抖持久化", async () => {
  const backend = memoryBackend();
  const store = createStore({ load: backend.load, save: backend.save, debounceMs: 5 });
  await store.init();
  const before = store.getSnapshot();
  store.setRules({ overdueReview: 5 });
  const after = store.getSnapshot();
  assert.notEqual(before, after);
  assert.notEqual(before.cfg, after.cfg);
  assert.equal(after.cfg.rules.overdueReview, 5);
  assert.equal(before.cfg.rules.overdueReview, DEFAULT_RULES.overdueReview);
  store.setRules({ overdueRereview: 3 });
  await new Promise((r) => setTimeout(r, 20));
  const cfgWrites = backend.writes.filter(([key]) => key === "cfg");
  assert.equal(cfgWrites.length, 1);
  assert.equal(cfgWrites[0][1].rules.overdueRereview, 3);
  assert.equal(cfgWrites[0][1].v, STORE_VERSION);
});

test("本地标记：追加、撤销、拖拽落列", async () => {
  const backend = memoryBackend();
  const store = createStore({ load: backend.load, save: backend.save, debounceMs: 1 });
  await store.init();
  const pr = makePr({ number: 1 });
  store.setSnapshot("acme/desktop-cc-gui", { syncedAt: NOW, prs: [pr], daily: {} });
  const key = pr.key;
  const beforeMark = store.getSnapshot();
  store.addMark(key, { verdict: "changes", via: "button", at: NOW, sha: pr.headSha });
  let merged = store.prWithMarks(store.getSnapshot().snapshots["acme/desktop-cc-gui"].prs[0]);
  assert.equal(derive(merged, DEFAULT_RULES).key, "changes_requested");
  assert.notEqual(beforeMark.local, store.getSnapshot().local);
  store.unmarkLast(key);
  merged = store.prWithMarks(store.getSnapshot().snapshots["acme/desktop-cc-gui"].prs[0]);
  assert.equal(derive(merged, DEFAULT_RULES).key, "needs_review");
  assert.equal(store.getSnapshot().local.marks[key], undefined);
});

test("拖拽落列：更新标记与列内顺序", async () => {
  const backend = memoryBackend();
  const store = createStore({ load: backend.load, save: backend.save, debounceMs: 1 });
  await store.init();
  const pr = makePr({
    number: 2,
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 2 * DAY_MS, sha: "c0" }],
  });
  store.setSnapshot("acme/desktop-cc-gui", { syncedAt: NOW, prs: [pr], daily: {} });
  const result = store.applyDropLocal(pr.key, "rereview", [pr.key], NOW);
  assert.equal(result.ok, true);
  const saved = store.getSnapshot();
  assert.deepEqual(saved.local.order.rereview, [pr.key]);
  const merged = store.prWithMarks(saved.snapshots["acme/desktop-cc-gui"].prs[0]);
  assert.equal(derive(merged, DEFAULT_RULES).key, "needs_rereview");
});

test("绑定 / 解除 / 清理失效 worktree", async () => {
  const backend = memoryBackend();
  const store = createStore({ load: backend.load, save: backend.save, debounceMs: 1 });
  await store.init();
  const pr = makePr({ number: 3 });
  store.setSnapshot("acme/desktop-cc-gui", { syncedAt: NOW, prs: [pr], daily: {} });
  store.bind(pr.key, "wt-1");
  store.bind("acme/desktop-cc-gui#4", "wt-2");
  assert.deepEqual(store.getSnapshot().local.bindings, {
    [pr.key]: "wt-1",
    "acme/desktop-cc-gui#4": "wt-2",
  });
  store.pruneBindings(new Set(["wt-1"]));
  assert.deepEqual(store.getSnapshot().local.bindings, { [pr.key]: "wt-1" });
  store.unbind(pr.key);
  assert.deepEqual(store.getSnapshot().local.bindings, {});
});

test("忽略 / 清空本地数据 / 恢复默认", async () => {
  const backend = memoryBackend();
  const store = createStore({ load: backend.load, save: backend.save, debounceMs: 1 });
  await store.init();
  const pr = makePr({ number: 5 });
  store.setSnapshot("acme/desktop-cc-gui", { syncedAt: NOW, prs: [pr], daily: {} });
  store.toggleIgnore(pr.key);
  assert.deepEqual(store.getSnapshot().local.ignored, [pr.key]);
  store.toggleIgnore(pr.key);
  assert.deepEqual(store.getSnapshot().local.ignored, []);
  store.addMark(pr.key, { verdict: "approve", via: "button", at: NOW, sha: pr.headSha });
  store.bind(pr.key, "wt-9");
  store.clearLocal();
  const s = store.getSnapshot();
  assert.deepEqual(s.local, { marks: {}, bindings: {}, order: {}, ignored: [], reviewing: {} });
  store.setRules({ overdueReview: 7 });
  store.resetConfig();
  assert.equal(store.getSnapshot().cfg.rules.overdueReview, DEFAULT_RULES.overdueReview);
});

test("审查中时间戳：写入、持久化与清除", async () => {
  const backend = memoryBackend();
  const store = createStore({ load: backend.load, save: backend.save, debounceMs: 1 });
  await store.init();
  store.markReviewing("acme/desktop#1", NOW);
  assert.equal(store.getSnapshot().local.reviewing["acme/desktop#1"], NOW);
  store.clearReviewing("acme/desktop#1");
  assert.deepEqual(store.getSnapshot().local.reviewing, {});
});

test("快照裁剪：只保留近 30 天结束的 PR，open 全留", () => {
  const open = makePr({ number: 1 });
  const oldMerged = {
    ...makePr({ number: 2 }),
    state: "MERGED",
    events: [{ type: "merged", at: NOW - 40 * DAY_MS }],
  };
  const newMerged = {
    ...makePr({ number: 3 }),
    state: "MERGED",
    events: [{ type: "merged", at: NOW - 5 * DAY_MS }],
  };
  const trimmed = trimSnapshot({ prs: [open, oldMerged, newMerged] }, NOW);
  assert.deepEqual(
    trimmed.prs.map((p) => p.number),
    [1, 3],
  );
});

test("defaultConfig 保持仓库顺序", () => {
  const cfg = defaultConfig([{ slug: "b/b" }, { slug: "a/a" }]);
  assert.deepEqual(cfg.repos, [
    { slug: "b/b", enabled: true },
    { slug: "a/a", enabled: true },
  ]);
  assert.deepEqual(cfg.rules, DEFAULT_RULES);
  assert.equal(cfg.extraAccounts.length, 0);
});
