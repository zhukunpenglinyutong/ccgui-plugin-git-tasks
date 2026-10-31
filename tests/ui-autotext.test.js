import test from "node:test";
import assert from "node:assert/strict";
import { planHint, runResultText, skipText } from "../src/ui/autoText.js";
import { createT } from "../src/i18n.js";

const t = createT("zh-CN");
const cfg = { autoWorktreeMax: 30, autoWorktreeForks: false };

test("「执行」结果提示：每种原因都说清楚", () => {
  assert.equal(
    runResultText(t, { reason: "none", plan: { total: 25, skipped: { fork: 25 } } }, cfg),
    "没有可新建的：待审查 25 个，跳过 来自 fork 25。要建 fork 来的 PR，打开「包含来自 fork 的 PR」",
  );
  assert.match(runResultText(t, { reason: "none", plan: { total: 0, skipped: {} } }, cfg), /没有 PR/);
  assert.match(runResultText(t, { reason: "created", created: 3, failed: 1, plan: { waiting: 4 } }, cfg), /已新建 3 个.*失败 1 个.*还有 4 个后台下一轮再建（点「执行」可一次建完）/);
  assert.match(runResultText(t, { reason: "created", created: 30, manual: true, plan: { waiting: 2 } }, cfg), /已新建 30 个.*已达上限，还有 2 个没建/);
  assert.equal(runResultText(t, { reason: "created", created: 8, manual: true, plan: { waiting: 0 } }, cfg), "已新建 8 个 worktree，侧栏可看进度");
  assert.match(runResultText(t, { reason: "failed", failed: 2 }, cfg), /都失败了/);
  assert.match(runResultText(t, { reason: "capped" }, cfg), /上限 30 个/);
  assert.match(runResultText(t, { reason: "breaker", until: 10 * 60_000 }, cfg, 0), /10 分钟后/);
  assert.match(runResultText(t, { reason: "noLogin" }, cfg), /登录名/);
  assert.match(runResultText(t, { reason: "indexNotReady" }, cfg), /还没加载好/);
  assert.match(runResultText(t, { reason: "disabled" }, cfg), /没开/);
  assert.ok(!/打开「包含来自 fork/.test(runResultText(t, { reason: "none", plan: { total: 2, skipped: { fork: 2 } } }, { ...cfg, autoWorktreeForks: true })));
});

test("状态行：待审查总数、可建数与跳过原因", () => {
  const hint = planHint(t, { enabled: true, max: 30, alive: 2, total: 25, eligible: 0, skipped: { fork: 23, hasWorktree: 2 }, capped: false, breaker: false }, 0);
  assert.equal(hint, "最多保留 30 个，当前 2 个（点了「开始审查」的不计入） · 待审查 25 个，可建 0 个（跳过：来自 fork 23 · 已有 worktree 2）");
  assert.equal(skipText(t, {}), "");
});
