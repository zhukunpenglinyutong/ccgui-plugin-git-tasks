/** gh 数据 → 归一化 PR 与事件（纯函数，无 IO）。
 *
 * 两个输入形状与 `gh/../scripts` 里的 jq 投影一一对应，避免把 GraphQL 的
 * 原始嵌套结构（体积大、超出 exec 64KB 上限）带进插件：
 *  - list row: 见 `parseListRow` 的数组顺序；
 *  - detail: `{ k, r, c, t }`，含义见 `mergeDetail`。
 */

import { dateKey, dayStart } from "../domain/stats.js";

const lower = (value) => String(value || "").toLowerCase();

export function parseListRow(row, { owner, repo }) {
  const [
    number,
    title,
    url,
    isDraft,
    createdAt,
    updatedAt,
    additions,
    deletions,
    author,
    headRefName,
    headRefOid,
    baseRefName,
    isCrossRepository,
  ] = row;
  return {
    key: `${owner}/${repo}#${number}`,
    owner,
    repo,
    repoSlug: `${owner}/${repo}`,
    number,
    title: title || "",
    url: url || "",
    isDraft: !!isDraft,
    createdAt: Date.parse(createdAt),
    updatedAt: Date.parse(updatedAt),
    additions: Number(additions) || 0,
    deletions: Number(deletions) || 0,
    author: author || "",
    headRefName: headRefName || "",
    headSha: headRefOid || "",
    baseRefName: baseRefName || "",
    isCrossRepository: !!isCrossRepository,
    requested: false,
    commitShas: [],
    events: [],
    state: "OPEN",
  };
}

function mapReviews(detail, meSet) {
  return (detail.r || []).map(([login, state, submittedAt, sha, comments]) => ({
    type: "review",
    at: Date.parse(submittedAt),
    by: login || "unknown",
    mine: meSet.has(lower(login)),
    state: state || "COMMENTED",
    sha: sha || null,
    comments: Number(comments) || 0,
  }));
}

function mapCommits(detail) {
  return (detail.c || [])
    .map(([sha, committedDate, parents]) => ({
      type: "commit",
      at: Date.parse(committedDate),
      sha: sha || "",
      merge: Number(parents) >= 2,
    }))
    .sort((a, b) => a.at - b.at);
}

function mapTimeline(detail, { meSet, pr, reviews }) {
  const out = [];
  let requested = false;
  const reviewedBefore = (at) => reviews.some((r) => r.mine && r.at <= at);
  for (const [type, createdAt, actor, reviewer, sha] of detail.t || []) {
    const at = Date.parse(createdAt);
    if (type === "ReadyForReviewEvent") {
      out.push({ type: "ready", at });
    } else if (type === "ConvertToDraftEvent") {
      out.push({ type: "toDraft", at });
    } else if (type === "ReviewRequestedEvent") {
      const mineTarget = meSet.has(lower(reviewer));
      if (mineTarget) requested = true;
      if (mineTarget && actor && actor === pr.author && reviewedBefore(at)) {
        out.push({ type: "rerequest", at });
      }
    } else if (type === "HeadRefForcePushedEvent") {
      out.push({ type: "forcePush", at, sha: sha || "" });
    } else if (type === "IssueComment") {
      out.push({
        type: "comment",
        at,
        by: actor || "unknown",
        mine: meSet.has(lower(actor)),
        isAuthor: !!actor && actor === pr.author,
      });
    }
  }
  return { events: out, requested };
}

function draftAtCreation(pr, timeline) {
  if (timeline.some((e) => e.type === "ready")) return true;
  if (timeline.some((e) => e.type === "toDraft")) return false;
  return pr.isDraft;
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    if (a.type === "opened") return -1;
    if (b.type === "opened") return 1;
    return a.at - b.at;
  });
}

/** 把一批 PR 的 detail 结果并回 list 行结果。 */
export function mergeDetail(pr, detail, { meSet }) {
  const reviews = mapReviews(detail || {}, meSet);
  const commits = mapCommits(detail || {});
  const { events: timeline, requested } = mapTimeline(detail || {}, { meSet, pr, reviews });
  const opened = {
    type: "opened",
    at: pr.createdAt,
    sha: commits[0]?.sha || pr.headSha,
    draft: draftAtCreation(pr, timeline),
  };
  return {
    ...pr,
    requested: pr.requested || requested,
    commitShas: commits.map((c) => c.sha),
    events: sortEvents([opened, ...commits, ...reviews, ...timeline]),
  };
}

/** `gh pr list --state merged|closed --json …` 的一行。 */
export function normalizeEndedRow(row, { owner, repo }) {
  const mergedAt = row.mergedAt ? Date.parse(row.mergedAt) : null;
  const closedAt = row.closedAt ? Date.parse(row.closedAt) : null;
  const number = row.number;
  const events = [
    {
      type: "opened",
      at: Date.parse(row.createdAt),
      sha: "",
      draft: false,
    },
  ];
  if (mergedAt) {
    events.push({ type: "merged", at: mergedAt, by: "GitHub" });
  } else if (closedAt) {
    events.push({ type: "closed", at: closedAt, by: "GitHub" });
  }
  return {
    key: `${owner}/${repo}#${number}`,
    owner,
    repo,
    repoSlug: `${owner}/${repo}`,
    number,
    title: row.title || "",
    url: row.url || "",
    isDraft: !!row.isDraft,
    createdAt: Date.parse(row.createdAt),
    updatedAt: Date.parse(row.updatedAt || row.createdAt),
    additions: 0,
    deletions: 0,
    author: row.author?.login || "",
    headRefName: row.headRefName || "",
    headSha: "",
    baseRefName: row.baseRefName || "",
    isCrossRepository: false,
    requested: false,
    commitShas: [],
    events,
    mergedAt,
    closedAt,
    state: mergedAt ? "MERGED" : "CLOSED",
  };
}

/** `prByNumberArgs` 的紧凑行 → `normalizeEndedRow` 的输入（已结束分支）。 */
export function endedRowFromStateRow(row) {
  const [number, title, url, isDraft, createdAt, updatedAt, , , author, headRefName, , baseRefName, , , mergedAt, closedAt] = row;
  return {
    number,
    title,
    url,
    createdAt,
    updatedAt,
    isDraft,
    author: { login: author || "" },
    headRefName,
    baseRefName,
    mergedAt: mergedAt || null,
    closedAt: closedAt || null,
  };
}

/** `gh pr list --jq` 的紧凑行 → 对象（已结束）。 */
export function endedRowFromArray(row) {
  const [number, title, url, createdAt, updatedAt, isDraft, author, headRefName, baseRefName, mergedAt, closedAt] = row;
  return {
    number,
    title,
    url,
    createdAt,
    updatedAt,
    isDraft,
    author: { login: author || "" },
    headRefName,
    baseRefName,
    mergedAt: mergedAt || null,
    closedAt: closedAt || null,
  };
}

/** `gh pr list --jq` 的紧凑行 → 对象（创建量）。 */
export function createdRowFromArray(row) {
  const [number, createdAt, isDraft, author] = row;
  return { number, createdAt, isDraft, author: { login: author || "" } };
}

/** 近 N 天创建量 → `{ "YYYY-MM-DD": n }`（按本地切日）。 */
export function dailyCounts(rows, cutoff) {
  const out = {};
  for (const row of rows || []) {
    if (!row?.createdAt) continue;
    const at = Date.parse(row.createdAt);
    if (Number.isNaN(at)) continue;
    const key = dateKey(dayStart(at, cutoff));
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

export function viewerLogin(data) {
  const login = data?.login;
  return login ? lower(login) : null;
}
