import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import { DEFAULT_AUTOMATION, DEFAULT_NOTIFY } from "../src/constants.js";

function memoryStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  const store = createStore({
    load: async (key) => data.get(key) ?? null,
    save: async (key, value) => data.set(key, value),
    debounceMs: 0,
    schedule: (fn) => {
      fn();
      return 1;
    },
    cancel: () => {},
  });
  return { store, data };
}

test("自动化设置默认关闭，旧存储升级后补齐", async () => {
  const { store } = memoryStore({ cfg: { v: 1, repos: [], rules: {} } });
  await store.init();
  const state = store.getSnapshot();
  assert.deepEqual(state.cfg.automation, DEFAULT_AUTOMATION);
  assert.deepEqual(state.cfg.notify, DEFAULT_NOTIFY);
  assert.deepEqual(state.auto, {});
  assert.deepEqual(state.feishu, { webhook: "", secret: "" });
  assert.equal(state.notify.baseline, null);
});

test("自动化设置写入走清洗并持久化", async () => {
  const { store, data } = memoryStore();
  await store.init();
  store.setAutomation({ autoWorktree: true, autoWorktreeMax: 300 });
  store.setNotifyCfg({ feishu: true, quietStart: 23 });
  const state = store.getSnapshot();
  assert.equal(state.cfg.automation.autoWorktreeMax, 50);
  assert.equal(state.cfg.notify.quietStart, 23);
  assert.equal(data.get("cfg").automation.autoWorktree, true);
});

test("自动 worktree 记录：单条更新 / 删除，存独立 key，不受「清空本地数据」影响", async () => {
  const { store, data } = memoryStore();
  await store.init();
  store.setAutoRecord("a/b#1", { status: "created", attempts: 1, at: 1, workspaceId: "w" });
  store.setAutoRecord("a/b#2", { status: "failed", attempts: 1, at: 2 });
  store.setAutoRecord("a/b#2", null);
  assert.deepEqual(Object.keys(store.getSnapshot().auto), ["a/b#1"]);
  assert.equal(data.get("auto").v, 1);
  assert.equal(data.get("auto").records["a/b#1"].workspaceId, "w");
  store.clearLocal();
  assert.deepEqual(Object.keys(store.getSnapshot().auto), ["a/b#1"]);
});

test("飞书凭据与通知状态各自持久化；恢复默认设置不清凭据", async () => {
  const { store, data } = memoryStore();
  await store.init();
  store.setFeishu({ webhook: " https://open.feishu.cn/open-apis/bot/v2/hook/abcdefgh ", secret: "s" });
  store.setNotifyState({ lastSlot: "2026-10-30T10", baseline: { repos: {}, errors: {} } });
  assert.equal(data.get("feishu").webhook, "https://open.feishu.cn/open-apis/bot/v2/hook/abcdefgh");
  assert.equal(data.get("notify").lastSlot, "2026-10-30T10");
  store.resetConfig();
  assert.equal(store.getSnapshot().feishu.secret, "s");
  assert.equal(store.getSnapshot().cfg.notify.feishu, false);

  const reloaded = memoryStore(Object.fromEntries(data));
  await reloaded.store.init();
  assert.equal(reloaded.store.getSnapshot().notify.lastSlot, "2026-10-30T10");
  assert.equal(reloaded.store.getSnapshot().feishu.secret, "s");
});
