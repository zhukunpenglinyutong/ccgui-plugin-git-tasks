import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceIndex, mergeRepoList } from "../src/workspaces.js";
import { createStore } from "../src/store.js";
import { makePr, NOW } from "./helpers.js";

test("mergeRepoList：保留顺序与开关，新仓库追加，消失的标 available:false", () => {
  const merged = mergeRepoList(
    [
      { slug: "a/one", enabled: false },
      { slug: "a/two", enabled: true },
    ],
    [{ slug: "a/two" }, { slug: "a/three" }],
  );
  assert.deepEqual(merged, [
    { slug: "a/one", enabled: false, available: false },
    { slug: "a/two", enabled: true, available: true },
    { slug: "a/three", enabled: true, available: true },
  ]);
});

test("宿主暂时返回空工作区：不清空仓库设置与绑定", async () => {
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  await store.init();
  const pr = makePr({ number: 1 });
  store.setSnapshot("acme/desktop", { syncedAt: NOW, prs: [pr], daily: {} });
  store.setRepos([{ slug: "acme/desktop", enabled: true, available: true }]);
  store.bind(pr.key, "wt-1");
  const index = createWorkspaceIndex({
    ctx: { workspaces: { list: async () => [] } },
    exec: { runGit: async () => ({ code: 0, stdout: "", stderr: "" }) },
    store,
  });
  await index.refresh();
  assert.equal(store.getSnapshot().cfg.repos[0].slug, "acme/desktop");
  assert.deepEqual(store.getSnapshot().local.bindings, { [pr.key]: "wt-1" });
});

function delayedHost() {
  // 真实宿主：worktree 在创建 resolve 之后才出现在侧栏（异步 refreshWorkspaces）。
  const rows = [{ id: "w1", path: "/repo", name: "repo" }];
  let listCalls = 0;
  return {
    ctx: {
      workspaces: {
        list: async () => {
          listCalls += 1;
          return listCalls >= 3
            ? [...rows, { id: "wt9", path: "/repo-worktrees/pr-9-001", name: "pr-9-001", kind: "worktree", parentId: "w1", worktree: { branch: "pr-9-001", prNumber: 9 } }]
            : rows;
        },
      },
    },
    calls: () => listCalls,
  };
}

test("waitForWorktree：侧栏稍后才出现新 worktree，轮询到它为止", async () => {
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  await store.init();
  const host = delayedHost();
  const index = createWorkspaceIndex({
    ctx: host.ctx,
    exec: { runGit: async () => ({ code: 0, stdout: "git@github.com:acme/repo.git\n", stderr: "" }) },
    store,
    sleep: async () => {},
  });
  const found = await index.waitForWorktree("/repo-worktrees/pr-9-001");
  assert.equal(found.workspaceId, "wt9");
  assert.equal(host.calls(), 3);
});

test("waitForWorktree：超时返回 null，不无限等待", async () => {
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  await store.init();
  let clock = 0;
  const index = createWorkspaceIndex({
    ctx: { workspaces: { list: async () => [{ id: "w1", path: "/repo", name: "repo" }] } },
    exec: { runGit: async () => ({ code: 0, stdout: "git@github.com:acme/repo.git\n", stderr: "" }) },
    store,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  assert.equal(await index.waitForWorktree("/never", { timeoutMs: 2000 }), null);
  assert.ok(clock >= 2000);
});
