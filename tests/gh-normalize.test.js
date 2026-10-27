import test from "node:test";
import assert from "node:assert/strict";
import {
  createdRowFromArray,
  dailyCounts,
  endedRowFromArray,
  mergeDetail,
  normalizeEndedRow,
  parseListRow,
  viewerLogin,
} from "../src/gh/normalize.js";

const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.parse("2026-10-20T10:00:00Z");
const T1 = Date.parse("2026-10-21T10:00:00Z");
const T2 = Date.parse("2026-10-22T10:00:00Z");
const T3 = Date.parse("2026-10-23T10:00:00Z");

const listRow = (over = {}) => {
  const m = {
    number: 7,
    title: "fix: something",
    url: "https://github.com/acme/desktop/pull/7",
    isDraft: false,
    createdAt: iso(T0),
    updatedAt: iso(T3),
    additions: 12,
    deletions: 3,
    author: "alice",
    headRefName: "fix/something",
    headRefOid: "sha3",
    baseRefName: "main",
    isCrossRepository: false,
    ...over,
  };
  return [
    m.number,
    m.title,
    m.url,
    m.isDraft,
    m.createdAt,
    m.updatedAt,
    m.additions,
    m.deletions,
    m.author,
    m.headRefName,
    m.headRefOid,
    m.baseRefName,
    m.isCrossRepository,
  ];
};

test("parseListRow：基础字段与 repoSlug", () => {
  const pr = parseListRow(listRow(), { owner: "acme", repo: "desktop" });
  assert.equal(pr.key, "acme/desktop#7");
  assert.equal(pr.repoSlug, "acme/desktop");
  assert.equal(pr.number, 7);
  assert.equal(pr.title, "fix: something");
  assert.equal(pr.url, "https://github.com/acme/desktop/pull/7");
  assert.equal(pr.isDraft, false);
  assert.equal(pr.createdAt, T0);
  assert.equal(pr.updatedAt, T3);
  assert.equal(pr.additions, 12);
  assert.equal(pr.deletions, 3);
  assert.equal(pr.author, "alice");
  assert.equal(pr.headRefName, "fix/something");
  assert.equal(pr.headSha, "sha3");
  assert.equal(pr.baseRefName, "main");
  assert.equal(pr.isCrossRepository, false);
  assert.equal(pr.requested, false);
  assert.deepEqual(pr.commitShas, []);
});

test("mergeDetail：审查、提交、时间线归一化", () => {
  const pr = parseListRow(listRow(), { owner: "acme", repo: "desktop" });
  const detail = {
    k: "p0",
    r: [
      ["bob", "APPROVED", iso(T1 + 30_000), "sha2", 0],
      ["ME", "CHANGES_REQUESTED", iso(T2 + 30_000), "sha3", 4],
    ],
    c: [
      ["sha1", iso(T0 + 60_000), 1],
      ["sha2", iso(T1), 1],
      ["sha3", iso(T2 + 60_000), 2],
    ],
    t: [
      ["ReadyForReviewEvent", iso(T0 + 30_000), "", "", ""],
      ["ReviewRequestedEvent", iso(T3), "alice", "me", ""],
      ["HeadRefForcePushedEvent", iso(T3 + 1000), "alice", "", "sha3"],
      ["IssueComment", iso(T3 + 2000), "alice", "", ""],
      ["IssueComment", iso(T3 + 3000), "bob", "", ""],
    ],
  };
  const merged = mergeDetail(pr, detail, { meSet: new Set(["me"]), author: "alice" });
  assert.equal(merged.requested, true);
  assert.equal(merged.commitShas.length, 3);
  assert.equal(merged.headSha, "sha3");
  const types = merged.events.map((e) => e.type);
  assert.deepEqual(types, [
    "opened",
    "ready",
    "commit",
    "commit",
    "review",
    "review",
    "commit",
    "rerequest",
    "forcePush",
    "comment",
    "comment",
  ]);
  const mine = merged.events.find((e) => e.type === "review" && e.mine);
  assert.equal(mine.state, "CHANGES_REQUESTED");
  assert.equal(mine.comments, 4);
  assert.equal(mine.sha, "sha3");
  const other = merged.events.find((e) => e.type === "review" && !e.mine);
  assert.equal(other.by, "bob");
  const commits = merged.events.filter((e) => e.type === "commit");
  assert.equal(commits[2].merge, true);
  const comments = merged.events.filter((e) => e.type === "comment");
  assert.equal(comments[0].mine, false);
  assert.equal(comments[0].isAuthor, true);
  assert.equal(comments[1].isAuthor, false);
});

test("mergeDetail：re-request 只认“作者请求我、且我之前审过”", () => {
  const pr = parseListRow(listRow(), { owner: "acme", repo: "desktop" });
  const beforeReview = mergeDetail(
    pr,
    {
      k: "p0",
      r: [],
      c: [],
      t: [["ReviewRequestedEvent", iso(T1), "alice", "me", ""]],
    },
    { meSet: new Set(["me"]) },
  );
  assert.equal(beforeReview.events.some((e) => e.type === "rerequest"), false);
  assert.equal(beforeReview.requested, true);

  const afterReview = mergeDetail(
    pr,
    {
      k: "p0",
      r: [["me", "CHANGES_REQUESTED", iso(T1), "sha1", 1]],
      c: [],
      t: [["ReviewRequestedEvent", iso(T2), "alice", "me", ""]],
    },
    { meSet: new Set(["me"]) },
  );
  assert.equal(afterReview.events.some((e) => e.type === "rerequest"), true);

  const otherActor = mergeDetail(
    pr,
    {
      k: "p0",
      r: [["me", "CHANGES_REQUESTED", iso(T1), "sha1", 1]],
      c: [],
      t: [["ReviewRequestedEvent", iso(T2), "bob", "me", ""]],
    },
    { meSet: new Set(["me"]) },
  );
  assert.equal(otherActor.events.some((e) => e.type === "rerequest"), false);

  const otherReviewer = mergeDetail(
    pr,
    {
      k: "p0",
      r: [["me", "CHANGES_REQUESTED", iso(T1), "sha1", 1]],
      c: [],
      t: [["ReviewRequestedEvent", iso(T2), "alice", "bob", ""]],
    },
    { meSet: new Set(["me"]) },
  );
  assert.equal(otherReviewer.events.some((e) => e.type === "rerequest"), false);
});

test("mergeDetail：草稿创建推断（ready / toDraft / 当前草稿）", () => {
  const draftPr = { ...parseListRow(listRow({ isDraft: true }), { owner: "acme", repo: "desktop" }) };
  const stillDraft = mergeDetail(draftPr, { k: "p0", r: [], c: [], t: [] }, { meSet: new Set() });
  assert.equal(stillDraft.events[0].draft, true);
  const ready = mergeDetail(
    draftPr,
    { k: "p0", r: [], c: [], t: [["ReadyForReviewEvent", iso(T1), "", "", ""]] },
    { meSet: new Set() },
  );
  assert.equal(ready.events[0].draft, true);
  assert.equal(ready.events[1].type, "ready");
  const neverDraft = mergeDetail(
    { ...draftPr, isDraft: false },
    { k: "p0", r: [], c: [], t: [["ConvertToDraftEvent", iso(T1), "", "", ""]] },
    { meSet: new Set() },
  );
  assert.equal(neverDraft.events[0].draft, false);
  assert.equal(neverDraft.events[1].type, "toDraft");
});

test("normalizeEndedRow：合并 / 关闭", () => {
  const merged = normalizeEndedRow(
    {
      number: 9,
      title: "feat: x",
      url: "https://github.com/acme/desktop/pull/9",
      createdAt: iso(T0),
      updatedAt: iso(T3),
      isDraft: false,
      author: { login: "alice" },
      headRefName: "feat/x",
      baseRefName: "main",
      mergedAt: iso(T2),
      closedAt: null,
    },
    { owner: "acme", repo: "desktop" },
  );
  assert.equal(merged.key, "acme/desktop#9");
  assert.equal(merged.state, "MERGED");
  assert.equal(merged.events.at(-1).type, "merged");
  assert.equal(merged.events.at(-1).at, T2);
  const closed = normalizeEndedRow(
    {
      number: 10,
      createdAt: iso(T0),
      updatedAt: iso(T3),
      author: { login: "bob" },
      mergedAt: null,
      closedAt: iso(T2),
    },
    { owner: "acme", repo: "desktop" },
  );
  assert.equal(closed.state, "CLOSED");
  assert.equal(closed.events.at(-1).type, "closed");
  assert.equal(closed.events.at(-1).at, T2);
});

test("dailyCounts：按本地切日归并", () => {
  const rows = [
    { createdAt: new Date(2026, 9, 26, 1, 0).toISOString() },
    { createdAt: new Date(2026, 9, 26, 1, 30).toISOString() },
    { createdAt: new Date(2026, 9, 25, 12, 0).toISOString() },
    { createdAt: null },
  ];
  assert.deepEqual(dailyCounts(rows, 4), { "2026-10-25": 3 });
  assert.deepEqual(dailyCounts(rows, 0), { "2026-10-26": 2, "2026-10-25": 1 });
});

test("紧凑行 → 对象：已结束 / 创建量", () => {
  const merged = endedRowFromArray([
    9, "feat: x", "https://github.com/acme/desktop/pull/9", iso(T0), iso(T3), false,
    "alice", "feat/x", "main", iso(T2), null,
  ]);
  assert.equal(merged.mergedAt, iso(T2));
  assert.equal(merged.author.login, "alice");
  const closed = endedRowFromArray([10, "x", "u", iso(T0), iso(T3), false, "bob", "b", "main", null, iso(T2)]);
  assert.equal(closed.closedAt, iso(T2));
  assert.equal(closed.mergedAt, null);
  const created = createdRowFromArray([7, iso(T0), true, "carol"]);
  assert.equal(created.author.login, "carol");
  assert.equal(created.isDraft, true);
});

test("viewerLogin：取不到时返回 null", () => {
  assert.equal(viewerLogin({ login: "ME" }), "me");
  assert.equal(viewerLogin(null), null);
  assert.equal(viewerLogin({}), null);
});

import { readFileSync } from "node:fs";
import { derive } from "../src/domain/derive.js";
import { DEFAULT_RULES, STATUS_ORDER } from "../src/constants.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("真实仓库样例：list + detail 归一化后能推算状态", () => {
  const list = fixture("graphql-list.json");
  const rows = list.prs.map((row) => parseListRow(row, { owner: "zhukunpenglinyutong", repo: "desktop-cc-gui" }));
  assert.equal(rows.length, 25);
  assert.ok(rows.every((pr) => !Number.isNaN(pr.createdAt) && pr.headSha.length === 40));
  const details = fixture("graphql-detail.json");
  const merged = rows.slice(0, 4).map((pr, i) => {
    const detail = details.find((d) => d.k === `p${i}`);
    return mergeDetail(pr, detail, { meSet: new Set(["zhukunpenglinyutong"]) });
  });
  assert.equal(merged[0].commitShas.length, 4);
  assert.ok(merged[0].events.some((e) => e.type === "forcePush"));
  assert.ok(merged.every((pr) => pr.events[0].type === "opened"));
  for (const pr of merged) {
    assert.ok(STATUS_ORDER.includes(derive(pr, DEFAULT_RULES).key));
  }
});

test("真实仓库样例：创建量 / 已结束", () => {
  const created = fixture("pr-list-created.json").map(createdRowFromArray);
  const daily = dailyCounts(created, 0);
  assert.equal(
    Object.values(daily).reduce((a, b) => a + b, 0),
    created.length,
  );
  const ended = fixture("pr-list-merged.json").map((row) =>
    normalizeEndedRow(endedRowFromArray(row), { owner: "zhukunpenglinyutong", repo: "desktop-cc-gui" }),
  );
  assert.ok(ended.length > 0);
  assert.ok(ended.every((pr) => pr.state === "MERGED" && pr.events.at(-1).type === "merged"));
});
