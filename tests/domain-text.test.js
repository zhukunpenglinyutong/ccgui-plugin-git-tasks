import test from "node:test";
import assert from "node:assert/strict";
import {
  compareUrl,
  evText,
  fmtAbs,
  fmtRel,
  nextStep,
  prUrl,
  shortWhy,
  updatesWord,
} from "../src/domain/text.js";
import { derive } from "../src/domain/derive.js";
import { DEFAULT_RULES, DAY } from "../src/constants.js";
import { makePr, NOW } from "./helpers.js";

const zh = (s) => s;
const rules = (over = {}) => ({ ...DEFAULT_RULES, ...over });
const state = (pr, r = rules()) => {
  const d = derive(pr, r);
  return { pr, d, ns: nextStep(pr, d, r, NOW, zh), why: shortWhy(pr, d, r, NOW, zh) };
};

test("URL：PR / compare", () => {
  const pr = makePr({ owner: "acme", repo: "desktop", number: 7 });
  assert.equal(prUrl(pr), "https://github.com/acme/desktop/pull/7");
  assert.equal(
    compareUrl(pr, "aaa", "bbb"),
    "https://github.com/acme/desktop/compare/aaa...bbb",
  );
});

test("nextStep：待审查（首次 / 撤回 / 留言未计入）", () => {
  const first = state(makePr({ author: "alice" }));
  assert.equal(first.ns.owner, "me");
  assert.equal(first.ns.head, "轮到你");
  assert.equal(first.ns.title, "首次审查");
  assert.match(first.ns.why, /alice/);
  assert.match(first.ns.why, /还没审查过/);

  const reopened = state(
    makePr({
      reviews: [{ state: "APPROVED", at: NOW - 2 * DAY, sha: "c0" }],
      marks: [{ verdict: "reset", at: NOW - DAY }],
    }),
  );
  assert.equal(reopened.ns.title, "重新审查");
  assert.match(reopened.ns.why, /撤回/);

  const uncounted = state(
    makePr({
      reviews: [{ state: "COMMENTED", at: NOW - DAY, sha: "c0" }],
    }),
    rules({ commentReview: "ignore" }),
  );
  assert.match(uncounted.ns.why, /不算审查/);
});

test("nextStep / shortWhy：审查中", () => {
  const pr = makePr({ author: "alice" });
  const d = { ...derive(pr, rules()), key: "reviewing", since: NOW - 3600_000 };
  const ns = nextStep(pr, d, rules(), NOW, zh);
  assert.equal(ns.owner, "me");
  assert.equal(ns.head, "审查中");
  assert.match(ns.why, /worktree/);
  assert.match(shortWhy(pr, d, rules(), NOW, zh), /worktree/);
});

test("nextStep：待复审给出 compare 链接与原因", () => {
  const s = state(
    makePr({
      commits: [
        { sha: "c1", at: NOW - 6 * DAY },
        { sha: "c2", at: NOW - 2 * DAY },
      ],
      reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, sha: "c1" }],
    }),
  );
  assert.equal(s.ns.owner, "me");
  assert.equal(s.ns.compare, "c1…c2");
  assert.match(s.ns.why, /要求修改/);
  assert.match(s.ns.why, /推送了 1 个提交/);
});

test("nextStep：待修复、已通过、草稿、已结束", () => {
  const changes = state(
    makePr({
      author: "bob",
      reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 8 * DAY, sha: "c0" }],
    }),
  );
  assert.equal(changes.ns.owner, "author");
  assert.equal(changes.ns.head, "等 bob");
  assert.match(changes.ns.why, /没有新的推送/);
  assert.match(changes.ns.why, /催一下/);

  const approved = state(
    makePr({ reviews: [{ state: "APPROVED", at: NOW - DAY, sha: "c0" }] }),
  );
  assert.equal(approved.ns.owner, "merge");
  assert.equal(approved.ns.title, "可以合并了");

  const draft = state(makePr({ author: "carol", isDraft: true, draftAtCreation: true }));
  assert.equal(draft.ns.owner, "author");
  assert.equal(draft.ns.title, "完成草稿");

  const merged = state(makePr({ timeline: [{ type: "merged", at: NOW - DAY }] }));
  assert.equal(merged.ns.owner, "done");
  assert.equal(merged.ns.title, "已合并");
  assert.match(merged.ns.plain, /worktree/);

  const closed = state(makePr({ timeline: [{ type: "closed", at: NOW - DAY }] }));
  assert.equal(closed.ns.title, "已关闭");
});

test("shortWhy：每个状态一句话", () => {
  assert.match(state(makePr()).why, /提交，你还没审/);
  assert.match(
    state(makePr({ reviews: [{ state: "APPROVED", at: NOW - DAY, sha: "c0" }] })).why,
    /通过/,
  );
  assert.match(
    state(
      makePr({
        reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 2 * DAY, sha: "c0" }],
        commits: [
          { sha: "c0", at: NOW - 6 * DAY },
          { sha: "c1", at: NOW - DAY },
        ],
      }),
    ).why,
    /推送了 1 个提交/,
  );
  assert.match(state(makePr({ isDraft: true, draftAtCreation: true })).why, /草稿/);
  assert.match(
    state(makePr({ timeline: [{ type: "closed", at: NOW - DAY }] })).why,
    /关闭，未合并/,
  );
});

test("evText：事件文案与灰色标记", () => {
  const pr = makePr({
    commits: [{ sha: "c0", at: NOW - 5 * DAY }],
    reviews: [{ state: "COMMENTED", at: NOW - 2 * DAY, sha: "c0", comments: 1 }],
    timeline: [{ type: "ready", at: NOW - 4 * DAY }],
  });
  const opened = evText(pr, { type: "opened", at: NOW - 5 * DAY, sha: "c0", draft: true }, pr.events, rules(), zh);
  assert.match(opened.text, /创建了 PR（草稿）/);
  const ready = evText(pr, { type: "ready", at: NOW - 4 * DAY }, pr.events, rules(), zh);
  assert.match(ready.text, /Ready/);
  const review = evText(pr, pr.events.find((e) => e.type === "review"), pr.events, rules(), zh);
  assert.match(review.text, /Comment/);
  const other = evText(
    pr,
    { type: "review", by: "bob", mine: false, state: "APPROVED", at: NOW },
    pr.events,
    rules(),
    zh,
  );
  assert.equal(other.muted, true);
  assert.equal(other.note, "他人审查，仅展示");
  const merge = evText(
    pr,
    { type: "commit", sha: "c1", at: NOW, merge: true },
    pr.events,
    rules(),
    zh,
  );
  assert.match(merge.text, /合并了主干/);
  assert.equal(merge.muted, true);
  assert.equal(merge.note, "不算新改动");
  const rerequest = evText(
    pr,
    { type: "rerequest", at: NOW },
    pr.events,
    rules({ rerequest: false }),
    zh,
  );
  assert.equal(rerequest.muted, true);
  assert.match(rerequest.note, /不算修复/);
  const reply = evText(pr, { type: "comment", isAuthor: true, at: NOW }, pr.events, rules(), zh);
  assert.equal(reply.muted, true);
  const mark = evText(
    pr,
    { type: "mark", verdict: "done", at: NOW - 3 * DAY },
    [...pr.events, { type: "commit", sha: "c9", at: NOW - DAY }],
    rules(),
    zh,
  );
  assert.equal(mark.muted, true);
  assert.match(mark.note, /已失效/);
  const mine = evText(pr, { type: "comment", mine: true, at: NOW }, pr.events, rules(), zh);
  assert.match(mine.note, /普通评论不计入/);
  const merged = evText(pr, { type: "merged", by: "alice", at: NOW }, pr.events, rules(), zh);
  assert.match(merged.text, /合并/);
  const closed = evText(pr, { type: "closed", at: NOW }, pr.events, rules(), zh);
  assert.match(closed.text, /关闭/);
});

test("updatesWord：本地确认 vs GitHub 更新", () => {
  const pr = makePr({ author: "alice" });
  assert.match(updatesWord(pr, [{ type: "mark", verdict: "fixed", at: NOW }], false, NOW, zh), /确认作者已修复/);
  assert.match(
    updatesWord(
      pr,
      [
        { type: "commit", at: NOW - DAY },
        { type: "rerequest", at: NOW },
        { type: "comment", at: NOW },
      ],
      true,
      NOW,
      zh,
    ),
    /alice .*推送了 1 个提交、重新请求你审查、回复了评论/,
  );
});

test("fmtRel / fmtAbs 本地时区", () => {
  assert.equal(fmtRel(NOW - 30_000, NOW, zh), "刚刚");
  assert.equal(fmtRel(NOW - 5 * 60_000, NOW, zh), "5 分钟前");
  assert.equal(fmtRel(NOW - 3 * 3600_000, NOW, zh), "3 小时前");
  assert.equal(fmtRel(NOW - 3 * DAY, NOW, zh), "3 天前");
  assert.match(fmtAbs(NOW - 3600_000, NOW, zh), /^今天 /);
  assert.match(fmtAbs(NOW - DAY - 3600_000, NOW, zh), /^昨天 /);
});

test("filesUrl / duration / dateLabel", async () => {
  const { filesUrl, duration, dateLabel } = await import("../src/domain/text.js");
  const pr = makePr({ owner: "acme", repo: "desktop", number: 7 });
  assert.equal(filesUrl(pr), "https://github.com/acme/desktop/pull/7/files");
  assert.equal(duration(30_000, zh), "刚刚");
  assert.equal(duration(5 * 60_000, zh), "5分钟");
  assert.equal(duration(3 * 3600_000, zh), "3小时");
  assert.equal(duration(3 * DAY, zh), "3天");
  assert.match(dateLabel(NOW, zh), /周/);
});

test("evText：toDraft / forcePush / 本地按钮标记 / 他人合并", () => {
  const pr = makePr({ author: "alice" });
  assert.match(
    evText(pr, { type: "toDraft", at: NOW }, pr.events, rules(), zh).text,
    /转回草稿/,
  );
  const force = evText(pr, { type: "forcePush", at: NOW, sha: "abc" }, pr.events, rules(), zh);
  assert.match(force.text, /force-push/);
  assert.equal(force.sha, "abc");
  const mark = evText(
    pr,
    { type: "mark", verdict: "approve", via: "button", at: NOW },
    pr.events,
    rules(),
    zh,
  );
  assert.equal(mark.note, "本地");
  assert.equal(mark.muted, false);
  const merged = evText(pr, { type: "merged", by: "bob", at: NOW }, pr.events, rules(), zh);
  assert.match(merged.text, /bob 合并了 PR/);
  const unknown = evText(pr, { type: "strange", at: NOW }, pr.events, rules(), zh);
  assert.equal(unknown.text, "strange");
});

test("nextStep：本地标记完成的分支", () => {
  const s = state(makePr({ marks: [{ verdict: "done", at: NOW - DAY, sha: "c0" }] }));
  assert.equal(s.ns.owner, "done");
  assert.equal(s.ns.title, "你标记完成");
  assert.match(s.ns.why, /GitHub 上仍是 open/);
});
