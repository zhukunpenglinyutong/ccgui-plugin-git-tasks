/** 状态推算（纯函数，计划 §6.2 / §6.3）。
 *
 * 输入 PR 必须满足：`events` 按 `at` 升序排列；`commitShas` 按历史顺序
 * （旧 → 新）；`headSha` 是当前 head。本地标记已经并进 `events`。
 *
 * 这里不做时间排序、不读时钟、不读存储——同样的输入永远得到同样的输出。
 */

import { DAY, MINUTE } from "../constants.js";

const VERDICT_TYPES = new Set(["changes", "approve"]);

/** 单个事件是否构成一个“计入的结论”。 */
export function verdictOf(e, rules) {
  if (e.type === "review" && e.mine) {
    if (e.state === "APPROVED") return "approve";
    if (e.state === "CHANGES_REQUESTED") return "changes";
    if (e.state === "COMMENTED") return rules.commentReview === "changes" ? "changes" : null;
    return null;
  }
  if (e.type === "comment" && e.mine) return rules.plainComment === "changes" ? "changes" : null;
  if (e.type === "mark" && VERDICT_TYPES.has(e.verdict)) return e.verdict;
  return null;
}

/** 作者在 GitHub 上做的“更新”事件（不含本地标记）。 */
export function isAuthorUpdate(e, rules) {
  if (e.type === "commit") return true;
  if (e.type === "rerequest") return rules.rerequest;
  if (e.type === "comment" && e.isAuthor) return rules.authorReply;
  return e.type === "mark" && e.verdict === "fixed";
}

function lastIndex(events, pred) {
  for (let i = events.length - 1; i >= 0; i -= 1) if (pred(events[i])) return i;
  return -1;
}

function firstForcePushAfter(pr, index) {
  const events = pr.events || [];
  for (let i = index + 1; i < events.length; i += 1) {
    if (events[i].type === "forcePush") return events[i];
  }
  return null;
}

function laterTime(candidate, ref, pr) {
  if (candidate >= ref.at) return candidate;
  const fp = firstForcePushAfter(pr, ref.index);
  const fallback = fp ? fp.at : pr.updatedAt || ref.at;
  return Math.max(fallback, ref.at);
}

/** R 之后是否存在“新代码”，以 SHA 为准（计划 §6.3）。 */
export function newCodeSince(pr, ref, rules) {
  const head = pr.headSha;
  const shas = pr.commitShas || [];
  if (ref.sha) {
    if (head === ref.sha) return null;
    const pos = shas.indexOf(ref.sha);
    if (pos >= 0) {
      const afterShas = shas.slice(pos + 1);
      if (!afterShas.length) return null;
      const bySha = new Map(
        (pr.events || []).filter((e) => e.type === "commit").map((e) => [e.sha, e]),
      );
      const events = afterShas.map((sha) => bySha.get(sha)).filter(Boolean);
      const allMerge = events.length === afterShas.length && events.every((e) => e.merge);
      if (rules.ignoreMergeBase && allMerge) return null;
      const usable = rules.ignoreMergeBase ? events.filter((e) => !e.merge) : events;
      const first = usable[0] || events[0];
      const at = laterTime(first ? first.at : pr.updatedAt, ref, pr);
      return { events: usable, at, sha: head };
    }
    const fp = firstForcePushAfter(pr, ref.index);
    return { events: fp ? [fp] : [], at: laterTime(fp ? fp.at : pr.updatedAt, ref, pr), sha: head };
  }
  // 结论没有绑定 SHA（旧数据 / 异常数据）：只能按事件顺序判断。
  const later = (pr.events || [])
    .slice(ref.index + 1)
    .filter((e) => e.type === "commit" && !(rules.ignoreMergeBase && e.merge));
  if (!later.length) return null;
  return { events: later, at: laterTime(later[0].at, ref, pr), sha: head };
}

/** R 之后算作“作者更新”的事件集合与最早时间。 */
export function authorUpdatesSince(pr, ref, rules, { includeFixed = true } = {}) {
  const tail = (pr.events || []).slice(ref.index + 1);
  const newCode = newCodeSince(pr, ref, rules);
  const rerequests = rules.rerequest ? tail.filter((e) => e.type === "rerequest") : [];
  const replies = rules.authorReply
    ? tail.filter((e) => e.type === "comment" && e.isAuthor)
    : [];
  const fixed = includeFixed
    ? tail.filter((e) => e.type === "mark" && e.verdict === "fixed")
    : [];
  const times = [];
  if (newCode) times.push(newCode.at);
  for (const e of rerequests) times.push(e.at);
  for (const e of replies) times.push(e.at);
  for (const e of fixed) times.push(e.at);
  const events = [...(newCode ? newCode.events : []), ...rerequests, ...replies, ...fixed].sort(
    (a, b) => a.at - b.at,
  );
  return { has: times.length > 0, events, at: times.length ? Math.min(...times) : null, newCode };
}

function ignoredMergeCommits(pr, ref, rules) {
  if (!rules.ignoreMergeBase) return [];
  return (pr.events || [])
    .slice(ref.index + 1)
    .filter((e) => e.type === "commit" && e.merge);
}

function baseFacts(pr) {
  return {
    reviews: 0,
    last: null,
    updates: [],
    ignoredMB: [],
    uncounted: null,
    reopened: null,
    headSha: pr.headSha,
    commitShas: pr.commitShas || [],
    newCode: null,
  };
}

function terminalKey(events) {
  const merged = events.find((e) => e.type === "merged");
  if (merged) return { key: "merged", at: merged.at };
  const closed = events.find((e) => e.type === "closed");
  if (closed) return { key: "closed", at: closed.at };
  return null;
}

function doneFact(pr, rules, doneIndex) {
  const done = pr.events[doneIndex];
  const ref = { sha: done.sha || pr.headSha, index: doneIndex, at: done.at };
  const update = authorUpdatesSince(pr, ref, rules, { includeFixed: false });
  return update.has ? null : { key: "done", since: done.at };
}

function draftFact(pr, events) {
  if (!pr.isDraft) return null;
  const lastDraft = lastIndex(events, (e) => e.type === "toDraft" || e.type === "opened");
  return { key: "draft", since: events[lastDraft]?.at ?? pr.createdAt };
}

function scanVerdicts(pr, rules) {
  let last = null;
  let reviews = 0;
  let uncounted = null;
  let reopened = null;
  (pr.events || []).forEach((e, index) => {
    if (e.type === "mark" && e.verdict === "reset") {
      last = null;
      reopened = e;
      return;
    }
    const verdict = verdictOf(e, rules);
    if (verdict) {
      last = { e, v: verdict, index, sha: e.sha ?? null, at: e.at };
      reviews += 1;
      reopened = null;
    } else if ((e.type === "review" && e.mine) || (e.type === "comment" && e.mine)) {
      uncounted = e;
    }
  });
  return { last, reviews, uncounted, reopened };
}

function changesFact(pr, rules, last, base) {
  const update = authorUpdatesSince(pr, last, rules);
  const ignoredMB = ignoredMergeCommits(pr, last, rules);
  if (update.has) {
    return {
      ...base,
      last,
      reviews: base.reviews,
      updates: update.events,
      ignoredMB,
      newCode: update.newCode,
      key: "needs_rereview",
      since: update.at,
    };
  }
  return { ...base, last, ignoredMB, key: "changes_requested", since: last.at };
}

function approveFact(pr, rules, last, base) {
  const update = authorUpdatesSince(pr, last, rules);
  const ignoredMB = ignoredMergeCommits(pr, last, rules);
  const reopen = [];
  if (rules.approveThenCommit === "rereview" && update.newCode) {
    reopen.push(...(update.newCode.events.length ? update.newCode.events : []));
  }
  const fixed = (pr.events || [])
    .slice(last.index + 1)
    .filter((e) => e.type === "mark" && e.verdict === "fixed");
  const times = [];
  if (reopen.length) times.push(update.newCode.at);
  for (const e of fixed) times.push(e.at);
  if (times.length) {
    return {
      ...base,
      last,
      ignoredMB,
      updates: [...reopen, ...fixed].sort((a, b) => a.at - b.at),
      newCode: update.newCode,
      key: "needs_rereview",
      since: Math.min(...times),
    };
  }
  return { ...base, last, ignoredMB, newCode: update.newCode, key: "approved", since: last.at };
}

/** 推算一个 PR 的当前状态。 */
export function derive(pr, rules) {
  const events = pr.events || [];
  const base = baseFacts(pr);
  const terminal = terminalKey(events);
  if (terminal) return { ...base, key: terminal.key, since: terminal.at };

  const doneIndex = lastIndex(events, (e) => e.type === "mark" && e.verdict === "done");
  if (doneIndex >= 0) {
    const done = doneFact(pr, rules, doneIndex);
    if (done) return { ...base, key: done.key, since: done.since };
  }

  const draft = draftFact(pr, events);
  if (draft) return { ...base, key: draft.key, since: draft.since };

  const { last, reviews, uncounted, reopened } = scanVerdicts(pr, rules);
  const facts = { ...base, reviews, uncounted };
  if (!last) {
    const ready = lastIndex(events, (e) => e.type === "ready");
    const since = reopened ? reopened.at : ready >= 0 ? events[ready].at : pr.createdAt;
    return {
      ...facts,
      key: "needs_review",
      since,
      reopened,
      uncounted: reopened ? null : uncounted,
    };
  }
  if (last.v === "changes") return changesFact(pr, rules, last, facts);
  return approveFact(pr, rules, last, facts);
}

/** 超时 / 沉默标记。 */
export function flags(d, rules, now) {
  const age = now - d.since;
  return {
    overdue:
      ((d.key === "needs_review" || d.key === "reviewing") && age > rules.overdueReview * DAY) ||
      (d.key === "needs_rereview" && age > rules.overdueRereview * DAY),
    silent: d.key === "changes_requested" && age > rules.silentDays * DAY,
  };
}

/** 跟踪范围（计划 §9.1）。`meSet` 是小写账号集合。 */
export function isTracked(pr, rules, meSet) {
  const author = String(pr.author || "").toLowerCase();
  if (rules.excludeMine && meSet.has(author)) return false;
  if ((rules.excludeAuthors || []).some((a) => String(a).toLowerCase() === author)) return false;
  if (rules.scope === "mine") {
    const participated = (pr.events || []).some(
      (e) => (e.type === "review" || e.type === "comment") && e.mine,
    );
    if (!pr.requested && !participated) return false;
  }
  return true;
}

/** 停留时长的可读文本（与交互稿一致）。 */
export function formatDuration(ms) {
  if (ms < MINUTE) return "刚刚";
  if (ms < 60 * MINUTE) return `${Math.floor(ms / MINUTE)}分钟`;
  if (ms < DAY) return `${Math.floor(ms / (60 * MINUTE))}小时`;
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / (60 * MINUTE));
  return h && d < 3 ? `${d}天${h}小时` : `${d}天`;
}
