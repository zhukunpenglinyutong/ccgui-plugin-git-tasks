import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeAutomation,
  sanitizeAutoRecords,
  sanitizeFeishu,
  sanitizeNotifyCfg,
  sanitizeNotifyState,
} from "../src/automation/config.js";
import { DEFAULT_AUTOMATION, DEFAULT_NOTIFY } from "../src/constants.js";

test("自动化设置：缺省、类型错误、越界都回到安全值", () => {
  assert.deepEqual(sanitizeAutomation(null), DEFAULT_AUTOMATION);
  assert.deepEqual(sanitizeAutomation({ autoWorktree: "yes", autoWorktreeMax: "abc" }), DEFAULT_AUTOMATION);
  assert.equal(sanitizeAutomation({ autoWorktreeMax: 30 }).autoWorktreeMax, 30);
  assert.equal(sanitizeAutomation({ autoWorktreeMax: 0 }).autoWorktreeMax, 1);
  assert.equal(sanitizeAutomation({ autoWorktreeMax: 999 }).autoWorktreeMax, 50);
  assert.equal(sanitizeAutomation({ autoWorktreeMax: 12.7 }).autoWorktreeMax, 13);
  assert.equal(sanitizeAutomation({ autoWorktree: true }).autoWorktree, true);
});

test("通知设置：静默时段只接受 0–23 整点", () => {
  assert.deepEqual(sanitizeNotifyCfg(undefined), DEFAULT_NOTIFY);
  const out = sanitizeNotifyCfg({ feishu: true, quiet: false, quietStart: 25, quietEnd: -1 });
  assert.equal(out.feishu, true);
  assert.equal(out.quiet, false);
  assert.equal(out.quietStart, DEFAULT_NOTIFY.quietStart);
  assert.equal(out.quietEnd, DEFAULT_NOTIFY.quietEnd);
  assert.equal(sanitizeNotifyCfg({ quietStart: 0, quietEnd: 23 }).quietEnd, 23);
});

test("飞书凭据：去空白，非字符串清空", () => {
  assert.deepEqual(sanitizeFeishu(null), { webhook: "", secret: "" });
  assert.deepEqual(sanitizeFeishu({ webhook: "  https://x  ", secret: 3 }), { webhook: "https://x", secret: "" });
});

test("自动 worktree 记录：丢弃坏条目，未知状态丢弃", () => {
  const out = sanitizeAutoRecords({
    v: 1,
    records: {
      "a/b#1": { status: "created", attempts: 1, workspaceId: "wt1", path: "/p", branch: "pr-1-001", at: 5 },
      "a/b#2": { status: "weird" },
      "a/b#3": "nope",
      "a/b#4": { status: "failed", attempts: "x", lastError: "fetch_failed: boom", at: 7 },
    },
  });
  assert.deepEqual(Object.keys(out).sort(), ["a/b#1", "a/b#4"]);
  assert.equal(out["a/b#4"].attempts, 0);
  assert.equal(out["a/b#1"].workspaceId, "wt1");
  assert.deepEqual(sanitizeAutoRecords({ v: 99, records: {} }), {});
});

test("通知状态：基线与暂停原因保留形状", () => {
  const out = sanitizeNotifyState({
    v: 1,
    lastSlot: "2026-10-30T10",
    lastSentAt: 100,
    baseline: { repos: { "a/b": { "a/b#1": { s: "needs_review", n: 1, t: "x", u: "u" } } }, errors: { "a/b": "network" } },
    paused: { kind: "sign", message: "m", at: 1 },
    lastResult: { ok: true, at: 100, message: "" },
  });
  assert.equal(out.lastSlot, "2026-10-30T10");
  assert.equal(out.baseline.repos["a/b"]["a/b#1"].s, "needs_review");
  assert.equal(out.paused.kind, "sign");
  const empty = sanitizeNotifyState({ v: 2 });
  assert.equal(empty.baseline, null);
  assert.equal(empty.paused, null);
});
