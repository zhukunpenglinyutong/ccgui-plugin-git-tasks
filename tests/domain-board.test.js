import test from "node:test";
import assert from "node:assert/strict";
import { applyDrop, colOf, dropPlan, sortColumn } from "../src/domain/board.js";
import { derive, flags } from "../src/domain/derive.js";
import { DEFAULT_RULES, DAY } from "../src/constants.js";
import { makePr, NOW } from "./helpers.js";

const rules = (over = {}) => ({ ...DEFAULT_RULES, ...over });
const row = (pr, r = rules()) => {
  const d = derive(pr, r);
  return { pr, d, f: flags(d, r, NOW) };
};

test("列映射：草稿归待审查，已结束包含三种状态", () => {
  assert.equal(colOf("needs_review"), "review");
  assert.equal(colOf("reviewing"), "review");
  assert.equal(colOf("draft"), "review");
  assert.equal(colOf("changes_requested"), "fix");
  assert.equal(colOf("needs_rereview"), "rereview");
  assert.equal(colOf("approved"), "approved");
  assert.equal(colOf("merged"), "ended");
  assert.equal(colOf("done"), "ended");
});

test("同列 → 只排序", () => {
  const pr = makePr();
  assert.deepEqual(dropPlan(pr, rules(), "review"), { ok: true, reorder: true, text: "调整顺序" });
});

test("已合并 / 已关闭 / 草稿不能拖", () => {
  const merged = makePr({ timeline: [{ type: "merged", at: NOW - DAY }] });
  assert.equal(dropPlan(merged, rules(), "fix").ok, false);
  const closed = makePr({ timeline: [{ type: "closed", at: NOW - DAY }] });
  assert.equal(dropPlan(closed, rules(), "fix").text, "已合并 / 已关闭由 GitHub 决定");
  const draft = makePr({ isDraft: true, draftAtCreation: true });
  assert.equal(dropPlan(draft, rules(), "fix").text, "草稿要等作者转 Ready");
});

test("已完成拖回原本所在列 = 只去掉完成标记", () => {
  const pr = makePr({
    marks: [{ verdict: "done", at: NOW - DAY, sha: "c0" }],
  });
  const plan = dropPlan(pr, rules(), "review");
  assert.equal(plan.ok, true);
  assert.equal(plan.mark, null);
  assert.equal(plan.text, "取消“完成”标记");
  assert.equal(plan.base.some((e) => e.type === "mark" && e.verdict === "done"), false);
});

test("没审过的 PR 不能拖到待复审", () => {
  const pr = makePr();
  assert.deepEqual(dropPlan(pr, rules(), "rereview"), {
    ok: false,
    text: "你还没审过，谈不上复审",
  });
});

test("每个目标列对应正确的本地标记", () => {
  const reviewed = makePr({
    reviews: [{ state: "APPROVED", at: NOW - 2 * DAY, sha: "c0" }],
  });
  assert.equal(dropPlan(reviewed, rules(), "review").mark, "reset");
  assert.equal(dropPlan(reviewed, rules(), "fix").mark, "changes");
  assert.equal(dropPlan(reviewed, rules(), "rereview").mark, "fixed");
  assert.equal(dropPlan(reviewed, rules(), "ended").mark, "done");
  const sameCol = makePr({
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 2 * DAY, sha: "c0" }],
  });
  assert.equal(dropPlan(sameCol, rules(), "fix").reorder, true);
});

test("applyDrop：放入标记后状态正确，返回前后状态", () => {
  const pr = makePr({
    commits: [{ sha: "c0", at: NOW - 6 * DAY }],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, sha: "c0" }],
  });
  const result = applyDrop(pr, rules(), "rereview", ["k"], NOW);
  assert.equal(result.ok, true);
  assert.equal(result.beforeKey, "changes_requested");
  assert.equal(result.afterKey, "needs_rereview");
  assert.equal(result.mark, "fixed");
  assert.deepEqual(result.order, ["k"]);
  const next = { ...pr, events: result.events };
  assert.equal(derive(next, rules()).key, "needs_rereview");
});

test("applyDrop：不能放时返回原因且不改事件", () => {
  const pr = makePr();
  const result = applyDrop(pr, rules(), "rereview", ["k"], NOW);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "你还没审过，谈不上复审");
  assert.equal(result.events, undefined);
});

test("applyDrop：同列只返回排序", () => {
  const pr = makePr();
  const result = applyDrop(pr, rules(), "review", ["a", "b"], NOW);
  assert.deepEqual(result, { ok: true, reorder: true, order: ["a", "b"] });
});

test("applyDrop：拖到已结束会记 done，再拖走会去掉 done", () => {
  const pr = makePr({
    reviews: [{ state: "APPROVED", at: NOW - 2 * DAY, sha: "c0" }],
  });
  const done = applyDrop(pr, rules(), "ended", ["k"], NOW);
  const donePr = { ...pr, events: done.events };
  assert.equal(derive(donePr, rules()).key, "done");
  const back = applyDrop(donePr, rules(), "approved", ["k"], NOW + 1000);
  const backPr = { ...pr, events: back.events };
  assert.equal(derive(backPr, rules()).key, "approved");
});

test("排序：超时优先，其次等得最久；已结束按结束时间倒序", () => {
  const overdue = row(makePr({ number: 1, createdAt: NOW - 5 * DAY }));
  const fresh = row(makePr({ number: 2, createdAt: NOW - DAY }));
  const older = row(makePr({ number: 3, createdAt: NOW - 9 * DAY }));
  assert.deepEqual(
    sortColumn([fresh, overdue, older], "review", []).map((r) => r.pr.number),
    [3, 1, 2],
  );
  const endedNew = row(makePr({ number: 4, timeline: [{ type: "merged", at: NOW - DAY }] }));
  const endedOld = row(makePr({ number: 5, timeline: [{ type: "merged", at: NOW - 5 * DAY }] }));
  assert.deepEqual(
    sortColumn([endedOld, endedNew], "ended", []).map((r) => r.pr.number),
    [4, 5],
  );
});

test("排序：审查中的卡片排在待审查列最前", () => {
  const reviewing = row(makePr({ number: 1, createdAt: NOW - 9 * DAY }));
  reviewing.d = { ...reviewing.d, key: "reviewing", since: NOW - 60_000 };
  const fresh = row(makePr({ number: 2, createdAt: NOW - DAY }));
  assert.deepEqual(
    sortColumn([fresh, reviewing], "review", []).map((r) => r.pr.number),
    [1, 2],
  );
});

test("排序：手动顺序优先，未排过的按默认规则排在后面", () => {
  const a = row(makePr({ number: 1, createdAt: NOW - 2 * DAY }));
  const b = row(makePr({ number: 2, createdAt: NOW - 9 * DAY }));
  const c = row(makePr({ number: 3, createdAt: NOW - 2 * DAY }));
  const sorted = sortColumn([a, b, c], "review", [c.pr.key, a.pr.key]);
  assert.deepEqual(
    sorted.map((r) => r.pr.number),
    [3, 1, 2],
  );
});

test("columnByKey：未知列回退到第一列", async () => {
  const { columnByKey, splitColumn } = await import("../src/domain/board.js");
  assert.equal(columnByKey("nope").key, "review");
  const drafts = [
    { pr: makePr({ number: 1, isDraft: true, draftAtCreation: true }), d: { key: "draft", since: NOW }, f: {} },
    { pr: makePr({ number: 2, createdAt: NOW - DAY }), d: { key: "needs_review", since: NOW - DAY }, f: {} },
  ];
  const split = splitColumn(drafts, "review", { endedDays: 7, now: NOW });
  assert.deepEqual(
    split.main.map((r) => r.pr.number),
    [2],
  );
  assert.deepEqual(
    split.drafts.map((r) => r.pr.number),
    [1],
  );
  const ended = [
    { pr: makePr({ number: 3 }), d: { key: "merged", since: NOW - DAY }, f: {} },
    { pr: makePr({ number: 4 }), d: { key: "merged", since: NOW - 30 * DAY }, f: {} },
  ];
  const cut = splitColumn(ended, "ended", { endedDays: 7, now: NOW });
  assert.deepEqual(
    cut.main.map((r) => r.pr.number),
    [3],
  );
  assert.equal(cut.hidden, 1);
});

test("orderAfterDrop：保持其余顺序，插到落点", async () => {
  const { orderAfterDrop } = await import("../src/domain/board.js");
  const rows = ["a", "b", "c", "d"].map((key) => ({ pr: { key } }));
  assert.deepEqual(orderAfterDrop(rows, "c", 0), ["c", "a", "b", "d"]);
  assert.deepEqual(orderAfterDrop(rows, "a", 3), ["b", "c", "d", "a"]);
  assert.deepEqual(orderAfterDrop(rows, "d", 99), ["a", "b", "c", "d"]);
  assert.deepEqual(orderAfterDrop(rows, "x", 1), ["a", "x", "b", "c", "d"]);
});
