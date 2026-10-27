import test from "node:test";
import assert from "node:assert/strict";
import { derive, flags, isTracked, verdictOf } from "../src/domain/derive.js";
import { DEFAULT_RULES, DAY } from "../src/constants.js";
import { makePr, NOW, DAY_MS } from "./helpers.js";

const rules = (over = {}) => ({ ...DEFAULT_RULES, ...over });

test("没有审查 → 待审查，起点是创建时间", () => {
  const pr = makePr({ createdAt: NOW - 4 * DAY });
  const d = derive(pr, rules());
  assert.equal(d.key, "needs_review");
  assert.equal(d.since, pr.createdAt);
  assert.equal(d.reviews, 0);
});

test("Request changes 且 head 未变 → 待修复", () => {
  const pr = makePr({
    createdAt: NOW - 4 * DAY,
    commits: [{ sha: "c1", at: NOW - 4 * DAY }],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 2 * DAY, sha: "c1", comments: 3 }],
  });
  const d = derive(pr, rules());
  assert.equal(d.key, "changes_requested");
  assert.equal(d.since, NOW - 2 * DAY);
  assert.equal(d.reviews, 1);
});

test("作者推送新提交 → 待复审，起点是新提交时间", () => {
  const pr = makePr({
    commits: [
      { sha: "c1", at: NOW - 6 * DAY },
      { sha: "c2", at: NOW - 2 * DAY },
    ],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, sha: "c1" }],
  });
  const d = derive(pr, rules());
  assert.equal(d.key, "needs_rereview");
  assert.equal(d.since, NOW - 2 * DAY);
  assert.deepEqual(
    d.updates.map((e) => e.sha),
    ["c2"],
  );
});

test("rebase：提交时间早于审查，但 SHA 变了 → 待复审", () => {
  const pr = makePr({
    commits: [
      { sha: "old", at: NOW - 6 * DAY },
      { sha: "rewritten", at: NOW - 9 * DAY },
    ],
    reviews: [{ state: "APPROVED", at: NOW - 5 * DAY, sha: "old" }],
    updatedAt: NOW - 3 * DAY,
  });
  const d = derive(pr, rules());
  assert.equal(d.key, "needs_rereview");
  assert.equal(d.since, NOW - 3 * DAY);
  assert.equal(d.newCode.sha, "rewritten");
});

test("force-push：审查绑定的 SHA 不在提交列表 → 待复审，起点取 forcePush 时间", () => {
  const pr = makePr({
    commits: [{ sha: "pushed", at: NOW - 7 * DAY }],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 5 * DAY, sha: "gone" }],
    timeline: [{ type: "forcePush", at: NOW - 2 * DAY, sha: "pushed" }],
  });
  const d = derive(pr, rules());
  assert.equal(d.key, "needs_rereview");
  assert.equal(d.since, NOW - 2 * DAY);
});

test("仅合并主干的提交：忽略开关决定是否算新代码", () => {
  const pr = makePr({
    commits: [
      { sha: "c1", at: NOW - 6 * DAY },
      { sha: "mb", at: NOW - 2 * DAY, merge: true },
    ],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, sha: "c1" }],
  });
  const ignored = derive(pr, rules({ ignoreMergeBase: true }));
  assert.equal(ignored.key, "changes_requested");
  assert.equal(ignored.ignoredMB.length, 1);
  const counted = derive(pr, rules({ ignoreMergeBase: false }));
  assert.equal(counted.key, "needs_rereview");
});

test("Approve 之后又有新提交：默认回到待复审，可配置为保持已通过", () => {
  const pr = makePr({
    commits: [
      { sha: "c1", at: NOW - 6 * DAY },
      { sha: "c2", at: NOW - 2 * DAY },
    ],
    reviews: [{ state: "APPROVED", at: NOW - 4 * DAY, sha: "c1" }],
  });
  assert.equal(derive(pr, rules()).key, "needs_rereview");
  assert.equal(derive(pr, rules({ approveThenCommit: "keep" })).key, "approved");
});

test("Approve 之后只有合并主干提交 → 保持已通过", () => {
  const pr = makePr({
    commits: [
      { sha: "c1", at: NOW - 6 * DAY },
      { sha: "mb", at: NOW - 2 * DAY, merge: true },
    ],
    reviews: [{ state: "APPROVED", at: NOW - 4 * DAY, sha: "c1" }],
  });
  assert.equal(derive(pr, rules()).key, "approved");
});

test("作者重新请求审查：可配置", () => {
  const pr = makePr({
    commits: [{ sha: "c1", at: NOW - 6 * DAY }],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, sha: "c1" }],
    timeline: [{ type: "rerequest", at: NOW - 2 * DAY }],
  });
  assert.equal(derive(pr, rules({ rerequest: true })).key, "needs_rereview");
  assert.equal(derive(pr, rules({ rerequest: false })).key, "changes_requested");
});

test("作者回复评论：默认不算修复", () => {
  const pr = makePr({
    commits: [{ sha: "c1", at: NOW - 6 * DAY }],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, sha: "c1" }],
    comments: [{ at: NOW - 2 * DAY, isAuthor: true }],
  });
  assert.equal(derive(pr, rules()).key, "changes_requested");
  assert.equal(derive(pr, rules({ authorReply: true })).key, "needs_rereview");
});

test("Comment 类 Review 默认算要求修复，可配置为不算", () => {
  const pr = makePr({
    commits: [{ sha: "c1", at: NOW - 6 * DAY }],
    reviews: [{ state: "COMMENTED", at: NOW - 4 * DAY, sha: "c1", comments: 1 }],
  });
  const counted = derive(pr, rules({ commentReview: "changes" }));
  assert.equal(counted.key, "changes_requested");
  const ignored = derive(pr, rules({ commentReview: "ignore" }));
  assert.equal(ignored.key, "needs_review");
  assert.equal(ignored.uncounted.state, "COMMENTED");
});

test("普通评论默认不算审查，可配置为要求修复", () => {
  const pr = makePr({
    commits: [{ sha: "c1", at: NOW - 6 * DAY }],
    comments: [{ at: NOW - 3 * DAY, mine: true, isAuthor: false }],
  });
  assert.equal(derive(pr, rules({ plainComment: "ignore" })).key, "needs_review");
  assert.equal(derive(pr, rules({ plainComment: "changes" })).key, "changes_requested");
});

test("本地标记 reset：回到待审查，审查次数保留", () => {
  const pr = makePr({
    commits: [{ sha: "c1", at: NOW - 6 * DAY }],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 5 * DAY, sha: "c1" }],
    marks: [{ verdict: "reset", at: NOW - 2 * DAY }],
  });
  const d = derive(pr, rules());
  assert.equal(d.key, "needs_review");
  assert.equal(d.since, NOW - 2 * DAY);
  assert.equal(d.reviews, 1);
  assert.equal(d.reopened.verdict, "reset");
});

test("本地标记 changes / approve 计入结论", () => {
  const base = { commits: [{ sha: "c1", at: NOW - 6 * DAY }] };
  assert.equal(
    derive(makePr({ ...base, marks: [{ verdict: "changes", at: NOW - DAY }] }), rules()).key,
    "changes_requested",
  );
  assert.equal(
    derive(makePr({ ...base, marks: [{ verdict: "approve", at: NOW - DAY }] }), rules()).key,
    "approved",
  );
});

test("标记完成后作者推送 → 自动失效并回到正常流转", () => {
  const pr = makePr({
    commits: [
      { sha: "c1", at: NOW - 6 * DAY },
      { sha: "c2", at: NOW - DAY },
    ],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 5 * DAY, sha: "c1" }],
    marks: [{ verdict: "done", at: NOW - 2 * DAY, sha: "c1" }],
  });
  const d = derive(pr, rules());
  assert.equal(d.key, "needs_rereview");
});

test("标记完成后没有新动作 → 已完成", () => {
  const pr = makePr({
    commits: [{ sha: "c1", at: NOW - 6 * DAY }],
    marks: [{ verdict: "done", at: NOW - 2 * DAY, sha: "c1" }],
  });
  const d = derive(pr, rules());
  assert.equal(d.key, "done");
  assert.equal(d.since, NOW - 2 * DAY);
});

test("完成标记后只有 re-request：开关关闭时仍是已完成", () => {
  const pr = makePr({
    commits: [{ sha: "c1", at: NOW - 6 * DAY }],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 5 * DAY, sha: "c1" }],
    marks: [{ verdict: "done", at: NOW - 3 * DAY, sha: "c1" }],
    timeline: [{ type: "rerequest", at: NOW - 2 * DAY }],
  });
  assert.equal(derive(pr, rules({ rerequest: false })).key, "done");
  assert.equal(derive(pr, rules({ rerequest: true })).key, "needs_rereview");
});

test("草稿 → 草稿；转 Ready → 待审查且起点是 Ready 时间", () => {
  const draft = makePr({ isDraft: true, draftAtCreation: true, createdAt: NOW - 3 * DAY });
  assert.equal(derive(draft, rules()).key, "draft");
  const ready = makePr({
    isDraft: false,
    draftAtCreation: true,
    createdAt: NOW - 3 * DAY,
    timeline: [{ type: "ready", at: NOW - DAY }],
  });
  const d = derive(ready, rules());
  assert.equal(d.key, "needs_review");
  assert.equal(d.since, NOW - DAY);
});

test("已合并 / 已关闭优先于一切", () => {
  const merged = makePr({
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, sha: "c0" }],
    timeline: [{ type: "merged", at: NOW - DAY, by: "maintainer" }],
  });
  assert.equal(derive(merged, rules()).key, "merged");
  const closed = makePr({ timeline: [{ type: "closed", at: NOW - DAY }] });
  assert.equal(derive(closed, rules()).key, "closed");
});

test("别人的审查不计入：只认我的账号", () => {
  const pr = makePr({
    commits: [{ sha: "c1", at: NOW - 6 * DAY }],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, mine: false, by: "bob", sha: "c1" }],
  });
  assert.equal(derive(pr, rules()).key, "needs_review");
});

test("轮次统计：多次结论累加，reset 不减", () => {
  const pr = makePr({
    commits: [
      { sha: "c1", at: NOW - 8 * DAY },
      { sha: "c2", at: NOW - 5 * DAY },
    ],
    reviews: [
      { state: "CHANGES_REQUESTED", at: NOW - 7 * DAY, sha: "c1" },
      { state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, sha: "c2" },
    ],
    marks: [{ verdict: "reset", at: NOW - 2 * DAY }],
  });
  assert.equal(derive(pr, rules()).reviews, 2);
});

test("Approve 后的本地 fixed 标记 → 待复审", () => {
  const pr = makePr({
    commits: [{ sha: "c1", at: NOW - 6 * DAY }],
    reviews: [{ state: "APPROVED", at: NOW - 4 * DAY, sha: "c1" }],
    marks: [{ verdict: "fixed", at: NOW - DAY }],
  });
  const d = derive(pr, rules());
  assert.equal(d.key, "needs_rereview");
  assert.equal(d.since, NOW - DAY);
});

test("没有绑定 SHA 的结论按事件顺序判断新提交", () => {
  const pr = makePr({
    commits: [
      { sha: "c1", at: NOW - 6 * DAY },
      { sha: "c2", at: NOW - 2 * DAY },
    ],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, sha: null }],
  });
  assert.equal(derive(pr, rules()).key, "needs_rereview");
});

test("flags：待审查/待复审超时、待修复沉默", () => {
  const review = derive(makePr({ createdAt: NOW - 3 * DAY }), rules());
  assert.equal(flags(review, rules(), NOW).overdue, true);
  const changes = derive(
    makePr({
      reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 8 * DAY, sha: "c0" }],
    }),
    rules(),
  );
  assert.equal(flags(changes, rules(), NOW).silent, true);
  assert.equal(flags(derive(makePr({ createdAt: NOW - DAY }), rules()), rules(), NOW).overdue, false);
});

test("isTracked：自己的 PR / 机器人 / 范围", () => {
  const mine = makePr({ author: "me" });
  assert.equal(isTracked(mine, rules(), new Set(["me"])), false);
  const bot = makePr({ author: "dependabot[bot]" });
  assert.equal(isTracked(bot, rules(), new Set(["me"])), false);
  const other = makePr({ author: "alice" });
  assert.equal(isTracked(other, rules(), new Set(["me"])), true);
  assert.equal(isTracked(other, rules({ scope: "mine" }), new Set(["me"])), false);
  assert.equal(isTracked({ ...other, requested: true }, rules({ scope: "mine" }), new Set(["me"])), true);
});

test("verdictOf 只认结论事件", () => {
  assert.equal(verdictOf({ type: "review", mine: true, state: "APPROVED" }, rules()), "approve");
  assert.equal(verdictOf({ type: "review", mine: true, state: "COMMENTED" }, rules()), "changes");
  assert.equal(verdictOf({ type: "review", mine: true, state: "COMMENTED" }, rules({ commentReview: "ignore" })), null);
  assert.equal(verdictOf({ type: "mark", verdict: "fixed" }, rules()), null);
});

test("since 不会早于审查时间（rebase 兜底用 updatedAt）", () => {
  const pr = makePr({
    commits: [{ sha: "rewritten", at: NOW - 9 * DAY }],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 2 * DAY, sha: "gone" }],
    updatedAt: NOW - DAY,
  });
  const d = derive(pr, rules());
  assert.equal(d.key, "needs_rereview");
  assert.equal(d.since, NOW - DAY);
});

test("基准：14 天前的 PR 仍能正常推算", () => {
  const pr = makePr({ createdAt: NOW - 14 * DAY });
  const d = derive(pr, rules({ overdueReview: 2 }));
  assert.equal(d.key, "needs_review");
  assert.ok(NOW - d.since === 14 * DAY_MS);
});
