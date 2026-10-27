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
