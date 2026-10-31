import test from "node:test";
import assert from "node:assert/strict";
import { createAutoWorktree } from "../src/automation/autoWorktree.js";
import { createStore } from "../src/store.js";
import { trackedRows } from "../src/rows.js";
import { makePr, NOW } from "./helpers.js";

const SLUG = "acme/desktop";
const pr = (n, extra = {}) =>
  makePr({ number: n, repo: "desktop", owner: "acme", updatedAt: NOW - n * 1000, ...extra });

async function harness({ prs, enabled = true, login = "me", max = 10, failures = {} } = {}) {
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  await store.init();
  store.setRepos([{ slug: SLUG, enabled: true, available: true }]);
  store.setSnapshot(SLUG, { syncedAt: NOW, prs, daily: {} });
  store.setRuntime({ ghLogin: login });
  store.setAutomation({ autoWorktree: enabled, autoWorktreeMax: max });
  let worktrees = [];
  // 真实宿主：创建 resolve 之后才异步刷新侧栏。新建的 worktree 先放进 hostWts，publish() 才可见。
  let hostWts = [];
  let clock = NOW;
  const index = {
    getSnapshot: () => ({ repos: [{ workspaceId: "w1", path: "/repo", slug: SLUG }], worktrees, loading: false, error: null }),
    subscribe: () => () => {},
    refresh: async () => index.getSnapshot(),
  };
  const created = [];
  const removed = [];
  let gate = null;
  const ctx = {
    worktrees: {
      create: async (def) => {
        created.push(def);
        if (gate) await gate;
        const queue = failures[def.prNumber];
        const fail = Array.isArray(queue) ? queue.shift() : null;
        if (fail) throw new Error(fail);
        const path = `/repo-worktrees/${def.branch}`;
        hostWts = [
          ...hostWts,
          { workspaceId: `wt-${def.branch}`, parentWorkspaceId: "w1", path, name: def.branch, repo: SLUG, branch: def.branch, prNumber: def.prNumber },
        ];
        return { worktreePath: path };
      },
      remove: async (def) => {
        removed.push(def);
        worktrees = worktrees.filter((w) => w.path !== def.worktreePath);
        hostWts = hostWts.filter((w) => w.path !== def.worktreePath);
        return { orphanDirectory: false, branchKeptReason: null };
      },
    },
  };
  const dirty = new Set();
  const exec = { isDirty: async (path) => dirty.has(path) };
  let n = 0;
  const auto = createAutoWorktree({
    ctx,
    store,
    index,
    exec,
    now: () => clock,
    newBranch: (p) => `pr-${p.number}-${String((n += 1)).padStart(3, "0")}`,
  });
  return {
    store,
    index,
    auto,
    created,
    removed,
    dirty,
    setGate: (promise) => {
      gate = promise;
    },
    wts: () => worktrees,
    /** 宿主刷新侧栏并广播 onChange：插件对账。 */
    publish: () => {
      worktrees = [...hostWts];
      auto.reconcile();
    },
    removeAll: () => {
      worktrees = [];
      hostWts = [];
    },
    tick: (ms) => {
      clock += ms;
    },
  };
}

const statusOf = (h, number) =>
  trackedRows(h.store, h.index, NOW).rows.find((r) => r.pr.number === number)?.d.key;

test("关闭时什么都不做；未拿到 gh 登录名时也不做（否则可能给自己的 PR 建）", async () => {
  const off = await harness({ prs: [pr(1)], enabled: false });
  await off.auto.run();
  assert.equal(off.created.length, 0);
  const noLogin = await harness({ prs: [pr(1)], login: null });
  await noLogin.auto.run();
  assert.equal(noLogin.created.length, 0);
});

test("串行新建、记录为自动、绑定到 PR；PR 仍是待审查", async () => {
  const h = await harness({ prs: [pr(1), pr(2)] });
  const out = await h.auto.run();
  assert.equal(out.created, 2);
  assert.deepEqual(h.created.map((d) => d.prNumber), [1, 2]);
  assert.equal(h.created[0].parentWorkspaceId, "w1");
  assert.equal(h.store.getSnapshot().auto["acme/desktop#1"].status, "created", "resolve 后立刻记为已建");
  assert.equal(h.store.getSnapshot().local.bindings["acme/desktop#1"], undefined, "侧栏还没刷新，先不绑");
  h.publish();
  const record = h.store.getSnapshot().auto["acme/desktop#1"];
  assert.equal(record.workspaceId, "wt-pr-1-001");
  assert.equal(record.parentId, "w1");
  assert.equal(h.store.getSnapshot().local.bindings["acme/desktop#1"], "wt-pr-1-001");
  assert.equal(statusOf(h, 1), "needs_review");
  await h.auto.run();
  assert.equal(h.created.length, 2, "已建的不会重复建");
});

test("上限：仍存在的自动 worktree 达到上限就停，并给出提示", async () => {
  const h = await harness({ prs: [pr(1), pr(2), pr(3)], max: 2 });
  await h.auto.run();
  assert.equal(h.created.length, 2);
  h.publish();
  await h.auto.run();
  assert.equal(h.created.length, 2);
  assert.equal(h.auto.status().capped, true);
  assert.equal(h.auto.status().alive, 2);
});

test("分支已存在：换后缀重试一次", async () => {
  const h = await harness({ prs: [pr(1)], failures: { 1: ["branch_exists: pr-1-001"] } });
  await h.auto.run();
  assert.deepEqual(h.created.map((d) => d.branch), ["pr-1-001", "pr-1-002"]);
  assert.equal(h.store.getSnapshot().auto["acme/desktop#1"].status, "created");
});

test("你在侧栏取消：记为取消，以后不再自动建", async () => {
  const h = await harness({ prs: [pr(1)], failures: { 1: ["canceled"] } });
  await h.auto.run();
  await h.auto.run();
  assert.equal(h.created.length, 1);
  assert.equal(h.store.getSnapshot().auto["acme/desktop#1"].status, "canceled");
});

test("熔断跨轮保持：连续 3 次失败后停；30 分钟后只试探 1 个；成功才恢复", async () => {
  const fail = () => ["fetch_failed: network"];
  const h = await harness({
    prs: [pr(1), pr(2), pr(3), pr(4), pr(5), pr(6)],
    failures: { 1: [...fail(), ...fail()], 2: fail(), 3: fail() },
  });
  await h.auto.run();
  assert.equal(h.created.length, 3);
  assert.equal(h.auto.status().breaker, true);
  assert.equal(h.store.getSnapshot().auto["acme/desktop#1"].status, "failed");
  h.tick(15 * 60_000);
  await h.auto.run();
  assert.equal(h.created.length, 3, "熔断期间下一轮同步不再尝试");
  h.tick(16 * 60_000);
  await h.auto.run();
  assert.equal(h.created.length, 4, "到点只放 1 个试探（#1 第二次仍失败，继续熔断）");
  assert.equal(h.auto.status().breaker, true);
  assert.equal(h.store.getSnapshot().auto["acme/desktop#1"].status, "gave_up");
  h.tick(31 * 60_000);
  await h.auto.run();
  assert.equal(h.created.length, 5, "再到点又只放 1 个（#2 重试成功）");
  assert.equal(h.auto.status().breaker, false, "试探成功，恢复");
  h.publish();
  await h.auto.run();
  assert.ok(h.created.length > 5, "恢复后按正常节奏继续建");
});

test("并发触发只跑一轮；手动创建中的 PR 自动流程跳过", async () => {
  const h = await harness({ prs: [pr(1), pr(2)] });
  assert.equal(h.auto.claim("acme/desktop#2"), true);
  let open;
  h.setGate(new Promise((resolve) => {
    open = resolve;
  }));
  const a = h.auto.run();
  const b = h.auto.run();
  open();
  await Promise.all([a, b]);
  assert.deepEqual(h.created.map((d) => d.prNumber), [1]);
  assert.equal(h.auto.claim("acme/desktop#1"), true, "跑完释放");
  h.auto.release("acme/desktop#2");
});

test("开始审查：自动 worktree 转为你的，PR 进入审查中且不再计入上限", async () => {
  const h = await harness({ prs: [pr(1)] });
  await h.auto.run();
  h.publish();
  assert.equal(statusOf(h, 1), "needs_review");
  h.auto.adopt("acme/desktop#1");
  assert.equal(h.store.getSnapshot().auto["acme/desktop#1"].status, "adopted");
  assert.equal(statusOf(h, 1), "reviewing");
  assert.equal(h.auto.status().alive, 0);
});

test("清理：有未提交改动的跳过；干净的删除并记为已删、解除绑定", async () => {
  const h = await harness({ prs: [pr(1), pr(2)] });
  await h.auto.run();
  h.publish();
  h.store.setSnapshot(SLUG, {
    syncedAt: NOW,
    prs: [pr(1, { state: "MERGED", timeline: [{ type: "merged", at: NOW }] }), pr(2, { state: "CLOSED", timeline: [{ type: "closed", at: NOW }] })],
    daily: {},
  });
  const items = h.auto.cleanable();
  assert.equal(items.length, 2);
  h.dirty.add(items.find((i) => i.pr.number === 2).wt.path);
  const out = await h.auto.cleanup(items);
  assert.equal(out.removed, 1);
  assert.equal(out.dirty, 1);
  assert.equal(h.removed.length, 1);
  assert.equal(h.removed[0].deleteBranch, false);
  assert.equal(h.store.getSnapshot().auto["acme/desktop#1"].status, "removed");
  assert.equal(h.store.getSnapshot().local.bindings["acme/desktop#1"], undefined);
  assert.equal(h.store.getSnapshot().auto["acme/desktop#2"].status, "created");
});

test("你手动删掉自动 worktree：看不到满 10 分钟后记为已删，不会再建", async () => {
  const h = await harness({ prs: [pr(1)] });
  await h.auto.run();
  h.publish();
  h.removeAll();
  await h.auto.run();
  assert.equal(h.store.getSnapshot().auto["acme/desktop#1"].status, "created", "刚看不到：先观察");
  h.tick(11 * 60_000);
  await h.auto.run();
  assert.equal(h.created.length, 1);
  assert.equal(h.store.getSnapshot().auto["acme/desktop#1"].status, "removed");
});

test("关掉「排除我自己的 PR」也不会给自己的 PR 建", async () => {
  const h = await harness({ prs: [pr(1, { author: "me" }), pr(2)] });
  h.store.setRules({ excludeMine: false });
  await h.auto.run();
  assert.deepEqual(h.created.map((d) => d.prNumber), [2]);
});

test("卸载后不再写状态（插件重载时不覆盖新实例的数据）", async () => {
  const h = await harness({ prs: [pr(1), pr(2)] });
  let open;
  h.setGate(new Promise((resolve) => {
    open = resolve;
  }));
  const running = h.auto.run();
  await new Promise((resolve) => setImmediate(resolve));
  h.auto.dispose();
  open();
  await running;
  assert.equal(h.created.length, 1);
  assert.equal(h.store.getSnapshot().auto["acme/desktop#1"].status, "creating", "留给新实例按分支名认领");
});

test("重置失败：清掉失败 / 放弃的记录，保留取消与已删", async () => {
  const h = await harness({ prs: [pr(1)] });
  h.store.setAutoRecords({
    "acme/desktop#1": { status: "gave_up", attempts: 2, at: NOW },
    "acme/desktop#2": { status: "failed", attempts: 1, at: NOW },
    "acme/desktop#3": { status: "canceled", attempts: 1, at: NOW },
  });
  assert.equal(h.auto.resetFailures(), 2);
  assert.deepEqual(Object.keys(h.store.getSnapshot().auto), ["acme/desktop#3"]);
});

test("你把自动 worktree 手动绑给别的 PR：转为你的，不再算自动", async () => {
  const h = await harness({ prs: [pr(1)] });
  await h.auto.run();
  h.publish();
  h.auto.adoptWorktree("wt-pr-1-001");
  assert.equal(h.store.getSnapshot().auto["acme/desktop#1"].status, "adopted");
});

test("清理：列表打开后情况变了（你点了开始审查）就不删", async () => {
  const h = await harness({ prs: [pr(1)] });
  await h.auto.run();
  h.publish();
  h.store.setSnapshot(SLUG, { syncedAt: NOW, prs: [pr(1, { state: "MERGED", timeline: [{ type: "merged", at: NOW }] })], daily: {} });
  const items = h.auto.cleanable();
  assert.equal(items.length, 1);
  h.auto.adopt("acme/desktop#1");
  const out = await h.auto.cleanup(items);
  assert.equal(out.removed, 0);
  assert.equal(out.skipped, 1);
  assert.equal(h.removed.length, 0);
});

test("侧栏还在加载 / 读取出错时不建也不对账", async () => {
  const h = await harness({ prs: [pr(1)] });
  const real = h.index.getSnapshot;
  h.index.getSnapshot = () => ({ ...real(), loading: true });
  await h.auto.run();
  h.index.getSnapshot = () => ({ ...real(), error: "boom" });
  await h.auto.run();
  assert.equal(h.created.length, 0);
});

test("执行一轮返回原因：全是 fork / 没开 / 没登录名 / 已建", async () => {
  const forks = await harness({ prs: [pr(1), pr(2)].map((p) => ({ ...p, isCrossRepository: true })) });
  const none = await forks.auto.run();
  assert.equal(none.created, 0);
  assert.equal(none.reason, "none");
  assert.equal(none.plan.total, 2);
  assert.equal(none.plan.skipped.fork, 2);

  const off = await harness({ prs: [pr(1)], enabled: false });
  assert.equal((await off.auto.run()).reason, "disabled");
  const noLogin = await harness({ prs: [pr(1)], login: null });
  assert.equal((await noLogin.auto.run()).reason, "noLogin");

  const ok = await harness({ prs: [pr(1), pr(2)] });
  const done = await ok.auto.run();
  assert.equal(done.created, 2);
  assert.equal(done.reason, "created");
});

test("手动「执行」一次建到上限；后台同步仍每轮最多 5 个", async () => {
  const many = () => Array.from({ length: 8 }, (_, i) => pr(i + 1));
  const bg = await harness({ prs: many() });
  await bg.auto.run();
  assert.equal(bg.created.length, 5, "后台一轮 5 个");

  const manual = await harness({ prs: many() });
  const progress = [];
  const out = await manual.auto.run({ manual: true, onProgress: (p) => progress.push(p) });
  assert.equal(out.created, 8, "手动一次建完");
  assert.deepEqual(progress.at(-1), { done: 8, total: 8 });
  assert.deepEqual(progress[0], { done: 0, total: 8 });

  const capped = await harness({ prs: many(), max: 6 });
  assert.equal((await capped.auto.run({ manual: true })).created, 6, "手动也不超过上限");
});

test("手动「执行」时后台正好在跑：等它跑完再把剩下的建完", async () => {
  const h = await harness({ prs: Array.from({ length: 8 }, (_, i) => pr(i + 1)) });
  let open;
  h.setGate(new Promise((resolve) => {
    open = resolve;
  }));
  const background = h.auto.run();
  const manual = h.auto.run({ manual: true });
  open();
  await background;
  const out = await manual;
  assert.equal(h.created.length, 8);
  assert.equal(out.created, 3, "后台建了 5 个，手动补剩下 3 个");
  assert.equal(new Set(h.created.map((d) => d.prNumber)).size, 8, "没有重复建");
});
