/* github-tasks · built from src/ by scripts/build.mjs — do not edit by hand */

// src/constants.js
var MINUTE = 6e4;
var HOUR = 60 * MINUTE;
var DAY = 24 * HOUR;
var STATUS_ORDER = [
  "needs_review",
  "reviewing",
  "changes_requested",
  "needs_rereview",
  "approved",
  "draft",
  "merged",
  "closed",
  "done"
];
var DEFAULT_DEFS = {
  needs_review: { label: "\u5F85\u5BA1\u67E5", tone: "blue", owner: "me", badge: true },
  reviewing: { label: "\u5BA1\u67E5\u4E2D", tone: "cyan", owner: "me", badge: true },
  changes_requested: { label: "\u5F85\u4FEE\u590D", tone: "yellow", owner: "author", badge: true },
  needs_rereview: { label: "\u5F85\u590D\u5BA1", tone: "rose", owner: "me", badge: true },
  approved: { label: "\u5DF2\u901A\u8FC7", tone: "green", owner: "merge", badge: true },
  draft: { label: "\u8349\u7A3F", tone: "neutral", owner: "author", badge: false },
  merged: { label: "\u5DF2\u5408\u5E76", tone: "purple", owner: "done", badge: true },
  closed: { label: "\u5DF2\u5173\u95ED", tone: "neutral", owner: "done", badge: true },
  done: { label: "\u5DF2\u5B8C\u6210", tone: "lime", owner: "done", badge: true }
};
var DEFAULT_RULES = {
  scope: "all",
  includeDraft: true,
  excludeMine: true,
  excludeAuthors: ["dependabot[bot]", "renovate[bot]"],
  commentReview: "changes",
  plainComment: "ignore",
  rerequest: true,
  authorReply: false,
  ignoreMergeBase: true,
  approveThenCommit: "rereview",
  overdueReview: 2,
  overdueRereview: 1,
  silentDays: 7,
  endedDays: 7,
  badgeEnabled: true,
  badgeAge: "overdue",
  linkByPr: true,
  linkByBranch: true,
  badgeClick: "detail",
  navCount: true,
  interval: "15",
  foregroundOnly: true,
  dayCutoff: 0
};
var TONES = ["neutral", "blue", "cyan", "green", "lime", "yellow", "rose", "purple"];
var COLUMNS = [
  {
    key: "review",
    main: "needs_review",
    statuses: ["needs_review", "reviewing", "draft"],
    desc: "\u6CA1\u5BA1\u8FC7 / \u5BA1\u67E5\u4E2D / \u4F60\u64A4\u56DE\u4E86\u7ED3\u8BBA"
  },
  { key: "fix", main: "changes_requested", statuses: ["changes_requested"], desc: "\u4F60\u63D0\u4E86\u95EE\u9898\uFF0C\u7B49\u4F5C\u8005\u6539" },
  { key: "rereview", main: "needs_rereview", statuses: ["needs_rereview"], desc: "\u4F5C\u8005\u6539\u5B8C\u4E86\uFF0C\u7B49\u4F60\u518D\u770B" },
  { key: "approved", main: "approved", statuses: ["approved"], desc: "\u4F60\u5DF2\u901A\u8FC7\uFF0C\u7B49\u5408\u5E76" },
  { key: "ended", main: null, statuses: ["merged", "closed", "done"], desc: "\u5DF2\u5408\u5E76 / \u5DF2\u5173\u95ED / \u4F60\u6807\u8BB0\u5B8C\u6210" }
];
var MARK_TEXT = {
  changes: "\u770B\u8FC7\u4E86 \xB7 \u9700\u8981\u4FEE\u590D",
  approve: "\u770B\u8FC7\u4E86 \xB7 \u6CA1\u95EE\u9898",
  reset: "\u64A4\u56DE\u7ED3\u8BBA\uFF0C\u91CD\u65B0\u5BA1\u67E5",
  fixed: "\u4F5C\u8005\u5DF2\u4FEE\u590D\uFF08\u4F60\u786E\u8BA4\uFF09",
  done: "\u6807\u8BB0\u5B8C\u6210"
};
var DROP_MARK = {
  review: "reset",
  fix: "changes",
  rereview: "fixed",
  approved: "approve",
  ended: "done"
};
var STORE_VERSION = 1;
var MAX_OPEN_PRS = 200;
var DETAIL_BATCH = 4;
var MIN_INTERVAL_MINUTES = 5;
var GH_TIMEOUT_MS = 2e4;
var GIT_TIMEOUT_MS = 15e3;
var GH_CONCURRENCY = 1;

// src/domain/derive.js
var VERDICT_TYPES = /* @__PURE__ */ new Set(["changes", "approve"]);
function verdictOf(e, rules) {
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
function newCodeSince(pr, ref, rules) {
  const head = pr.headSha;
  const shas = pr.commitShas || [];
  if (ref.sha) {
    if (head === ref.sha) return null;
    const pos = shas.indexOf(ref.sha);
    if (pos >= 0) {
      const afterShas = shas.slice(pos + 1);
      if (!afterShas.length) return null;
      const bySha = new Map(
        (pr.events || []).filter((e) => e.type === "commit").map((e) => [e.sha, e])
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
  const later = (pr.events || []).slice(ref.index + 1).filter((e) => e.type === "commit" && !(rules.ignoreMergeBase && e.merge));
  if (!later.length) return null;
  return { events: later, at: laterTime(later[0].at, ref, pr), sha: head };
}
function authorUpdatesSince(pr, ref, rules, { includeFixed = true } = {}) {
  const tail = (pr.events || []).slice(ref.index + 1);
  const newCode = newCodeSince(pr, ref, rules);
  const rerequests = rules.rerequest ? tail.filter((e) => e.type === "rerequest") : [];
  const replies = rules.authorReply ? tail.filter((e) => e.type === "comment" && e.isAuthor) : [];
  const fixed = includeFixed ? tail.filter((e) => e.type === "mark" && e.verdict === "fixed") : [];
  const times = [];
  if (newCode) times.push(newCode.at);
  for (const e of rerequests) times.push(e.at);
  for (const e of replies) times.push(e.at);
  for (const e of fixed) times.push(e.at);
  const events = [...newCode ? newCode.events : [], ...rerequests, ...replies, ...fixed].sort(
    (a, b) => a.at - b.at
  );
  return { has: times.length > 0, events, at: times.length ? Math.min(...times) : null, newCode };
}
function ignoredMergeCommits(pr, ref, rules) {
  if (!rules.ignoreMergeBase) return [];
  return (pr.events || []).slice(ref.index + 1).filter((e) => e.type === "commit" && e.merge);
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
    newCode: null
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
    } else if (e.type === "review" && e.mine || e.type === "comment" && e.mine) {
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
      since: update.at
    };
  }
  return { ...base, last, ignoredMB, key: "changes_requested", since: last.at };
}
function approveFact(pr, rules, last, base) {
  const update = authorUpdatesSince(pr, last, rules);
  const ignoredMB = ignoredMergeCommits(pr, last, rules);
  const reopen = [];
  if (rules.approveThenCommit === "rereview" && update.newCode) {
    reopen.push(...update.newCode.events.length ? update.newCode.events : []);
  }
  const fixed = (pr.events || []).slice(last.index + 1).filter((e) => e.type === "mark" && e.verdict === "fixed");
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
      since: Math.min(...times)
    };
  }
  return { ...base, last, ignoredMB, newCode: update.newCode, key: "approved", since: last.at };
}
function derive(pr, rules) {
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
      uncounted: reopened ? null : uncounted
    };
  }
  if (last.v === "changes") return changesFact(pr, rules, last, facts);
  return approveFact(pr, rules, last, facts);
}
function flags(d, rules, now) {
  const age = now - d.since;
  return {
    overdue: (d.key === "needs_review" || d.key === "reviewing") && age > rules.overdueReview * DAY || d.key === "needs_rereview" && age > rules.overdueRereview * DAY,
    silent: d.key === "changes_requested" && age > rules.silentDays * DAY
  };
}
function isTracked(pr, rules, meSet) {
  const author = String(pr.author || "").toLowerCase();
  if (rules.excludeMine && meSet.has(author)) return false;
  if ((rules.excludeAuthors || []).some((a) => String(a).toLowerCase() === author)) return false;
  if (rules.scope === "mine") {
    const participated = (pr.events || []).some(
      (e) => (e.type === "review" || e.type === "comment") && e.mine
    );
    if (!pr.requested && !participated) return false;
  }
  return true;
}
function formatDuration(ms) {
  if (ms < MINUTE) return "\u521A\u521A";
  if (ms < 60 * MINUTE) return `${Math.floor(ms / MINUTE)}\u5206\u949F`;
  if (ms < DAY) return `${Math.floor(ms / (60 * MINUTE))}\u5C0F\u65F6`;
  const d = Math.floor(ms / DAY);
  const h2 = Math.floor(ms % DAY / (60 * MINUTE));
  return h2 && d < 3 ? `${d}\u5929${h2}\u5C0F\u65F6` : `${d}\u5929`;
}

// src/domain/link.js
var PICK_ORDER = { free: 0, taken: 1, current: 2, host: 3 };
function findBoundPr(wt, { prs, bindings }) {
  const key = Object.keys(bindings).find((k) => bindings[k] === wt.workspaceId);
  if (!key) return null;
  return prs.find((p) => p.key === key) || null;
}
function linkPr(wt, { prs, bindings, rules }) {
  const bound = findBoundPr(wt, { prs, bindings });
  if (bound) return bound;
  const sameRepo = prs.filter((p) => p.repoSlug === wt.repo);
  if (rules.linkByPr && wt.prNumber != null) {
    const byPr = sameRepo.find((p) => p.number === wt.prNumber);
    if (byPr) return byPr;
  }
  if (rules.linkByBranch && wt.branch) {
    const byBranch = sameRepo.find((p) => p.headRefName === wt.branch);
    if (byBranch && !bindings[byBranch.key]) return byBranch;
  }
  return null;
}
function wtFor(pr, { wts, prs, bindings, rules }) {
  const boundId = bindings[pr.key];
  if (boundId) return wts.find((w) => w.workspaceId === boundId) || null;
  return wts.find((w) => linkPr(w, { prs, bindings, rules })?.key === pr.key) || null;
}
function linkSource(wt, pr, bindings) {
  if (bindings[pr.key] === wt.workspaceId) return "\u4F60\u624B\u52A8\u7ED1\u5B9A";
  if (wt.prNumber === pr.number) return "\u5BA2\u6237\u7AEF\u4ECE PR \u521B\u5EFA";
  return "\u5206\u652F\u540D\u4E0E PR \u4E00\u81F4";
}
function bindCandidates(pr, { wts, prs, bindings, rules }) {
  return wts.filter((w) => w.repo === pr.repoSlug && !w.creating).map((wt) => {
    const current = linkPr(wt, { prs, bindings, rules });
    const manual = Object.values(bindings).includes(wt.workspaceId);
    if (current && current.key === pr.key) {
      return { wt, state: "current", text: "\u5F53\u524D\u5DF2\u5BF9\u5E94\u8FD9\u4E2A PR", disabled: true };
    }
    if (wt.prNumber != null && !manual) {
      return { wt, state: "host", text: `\u5BA2\u6237\u7AEF\u4ECE #${wt.prNumber} \u521B\u5EFA`, disabled: true };
    }
    if (current) {
      return { wt, state: "taken", text: `\u5DF2\u5BF9\u5E94 #${current.number}\uFF0C\u6539\u7ED1\u540E\u89E3\u9664`, disabled: false };
    }
    return { wt, state: "free", text: "\u7A7A\u95F2", disabled: false };
  }).sort((a, b) => PICK_ORDER[a.state] - PICK_ORDER[b.state]);
}
function newBranchName(pr, random = Math.random) {
  const suffix = String(Math.floor(random() * 1e3)).padStart(3, "0");
  return `pr-${pr.number}-${suffix}`;
}
function reviewingState(d, hasWorktree, since) {
  if (!hasWorktree || d.key !== "needs_review") return d;
  return { ...d, key: "reviewing", since: since || d.since };
}

// src/domain/text.js
var zhOnly = (zh) => zh;
var pad = (n) => String(n).padStart(2, "0");
var VERB = ["Approve", "Request changes", "Comment"];
var VERB_EN = ["approved", "requested changes", "commented"];
var MARK_EN = {
  changes: "Reviewed \xB7 changes needed",
  approve: "Reviewed \xB7 looks good",
  reset: "Withdrew the previous verdict",
  fixed: "Author fixed it (confirmed)",
  done: "Marked done"
};
var prUrl = (pr) => `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;
function compareUrl(pr, from, to) {
  return `https://github.com/${pr.owner}/${pr.repo}/compare/${from}...${to}`;
}
function filesUrl(pr) {
  return `${prUrl(pr)}/files`;
}
function localMidnight(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function fmtAbs(ms, now = Date.now(), t = zhOnly) {
  const d = new Date(ms);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = localMidnight(now);
  if (ms >= today) return `${t("\u4ECA\u5929", "Today")} ${hm}`;
  if (ms >= today - DAY) return `${t("\u6628\u5929", "Yesterday")} ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
function fmtRel(ms, now = Date.now(), t = zhOnly) {
  const x = now - ms;
  if (x < MINUTE) return t("\u521A\u521A", "just now");
  if (x < HOUR) return t(`${Math.floor(x / MINUTE)} \u5206\u949F\u524D`, `${Math.floor(x / MINUTE)}m ago`);
  if (x < DAY) return t(`${Math.floor(x / HOUR)} \u5C0F\u65F6\u524D`, `${Math.floor(x / HOUR)}h ago`);
  return t(`${Math.floor(x / DAY)} \u5929\u524D`, `${Math.floor(x / DAY)}d ago`);
}
function duration(ms, t = zhOnly) {
  const zh = formatDuration(ms);
  if (ms < MINUTE) return t(zh, "just now");
  if (ms < HOUR) return t(zh, `${Math.floor(ms / MINUTE)}m`);
  if (ms < DAY) return t(zh, `${Math.floor(ms / HOUR)}h`);
  return t(zh, zh.replace("\u5929", "d").replace("\u5C0F\u65F6", "h"));
}
function dateLabel(ms, t = zhOnly) {
  const d = new Date(ms);
  const week = t("\u65E5\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D", "SMTWTFS")[d.getDay()];
  return t(
    `${d.getMonth() + 1}/${d.getDate()} \u5468${week}`,
    `${d.getMonth() + 1}/${d.getDate()} ${week}`
  );
}
function verbOf(e, t) {
  const index = e.state === "APPROVED" ? 0 : e.state === "CHANGES_REQUESTED" ? 1 : 2;
  return t(VERB[index], VERB_EN[index]);
}
function isGithubAuthorUpdate(e, rules) {
  if (e.type === "commit") return true;
  if (e.type === "rerequest") return rules.rerequest;
  if (e.type === "comment" && e.isAuthor) return rules.authorReply;
  return false;
}
function reviewText(pr, e, rules, t) {
  if (!e.mine) {
    return {
      text: t(`${e.by} ${verbOf(e, t)}`, `${e.by} ${verbOf(e, t)}`),
      note: t("\u4ED6\u4EBA\u5BA1\u67E5\uFF0C\u4EC5\u5C55\u793A", "someone else's review, shown for context"),
      muted: true
    };
  }
  const counted = !!verdictOf(e, rules);
  return {
    text: t(
      `\u4F60 ${verbOf(e, t)}${e.comments ? ` \xB7 ${e.comments} \u6761\u8BC4\u8BBA` : ""}`,
      `You ${verbOf(e, t)}${e.comments ? ` \xB7 ${e.comments} comments` : ""}`
    ),
    sha: e.sha,
    note: counted ? "" : t("\u6309\u5F53\u524D\u89C4\u5219\u4E0D\u8BA1\u5165", "not counted under current rules"),
    muted: !counted
  };
}
function commentText(pr, e, rules, t) {
  if (e.mine) {
    return {
      text: t("\u4F60\u53D1\u8868\u4E86\u8BC4\u8BBA", "You commented"),
      note: verdictOf(e, rules) ? "" : t("\u666E\u901A\u8BC4\u8BBA\u4E0D\u8BA1\u5165", "plain comments don't count"),
      muted: !verdictOf(e, rules)
    };
  }
  return {
    text: t(`${pr.author} \u56DE\u590D\u4E86\u8BC4\u8BBA`, `${pr.author} replied`),
    note: rules.authorReply ? "" : t("\u4E0D\u7B97\u4FEE\u590D", "not counted as a fix"),
    muted: !rules.authorReply
  };
}
function markText(t, e, evs, rules) {
  const after = evs ? evs.slice(evs.indexOf(e) + 1) : [];
  const expired = e.verdict === "done" && after.some((x) => isGithubAuthorUpdate(x, rules));
  return {
    text: t(`\u4F60\u5728\u63D2\u4EF6\u91CC\u6807\u8BB0\uFF1A${MARK_TEXT[e.verdict]}`, `You marked: ${MARK_EN[e.verdict]}`),
    note: expired ? t("\u4F5C\u8005\u4E4B\u540E\u6709\u65B0\u52A8\u4F5C\uFF0C\u5DF2\u5931\u6548", "expired after the author's next update") : e.via === "drag" ? t("\u770B\u677F\u62D6\u62FD \xB7 \u672C\u5730", "board drag \xB7 local") : t("\u672C\u5730", "local"),
    muted: expired
  };
}
function evText(pr, e, evs, rules, t = zhOnly) {
  switch (e.type) {
    case "opened":
      return {
        text: e.draft ? t(`${pr.author} \u521B\u5EFA\u4E86 PR\uFF08\u8349\u7A3F\uFF09`, `${pr.author} opened a draft PR`) : t(`${pr.author} \u521B\u5EFA\u4E86 PR`, `${pr.author} opened the PR`),
        sha: e.sha
      };
    case "ready":
      return { text: t(`${pr.author} \u6807\u8BB0\u4E3A Ready for review`, `${pr.author} marked it ready for review`) };
    case "toDraft":
      return { text: t(`${pr.author} \u8F6C\u56DE\u8349\u7A3F`, `${pr.author} converted it back to draft`) };
    case "commit": {
      const ignored = e.merge && rules.ignoreMergeBase;
      return {
        text: e.merge ? t(`${pr.author} \u5408\u5E76\u4E86\u4E3B\u5E72`, `${pr.author} merged the base branch`) : t(`${pr.author} \u63A8\u9001\u4E86\u63D0\u4EA4`, `${pr.author} pushed a commit`),
        sha: e.sha,
        note: ignored ? t("\u4E0D\u7B97\u65B0\u6539\u52A8", "not counted as new code") : "",
        muted: ignored
      };
    }
    case "forcePush":
      return {
        text: t(`${pr.author} force-push \u4E86\u5206\u652F`, `${pr.author} force-pushed the branch`),
        sha: e.sha
      };
    case "review":
      return reviewText(pr, e, rules, t);
    case "comment":
      return commentText(pr, e, rules, t);
    case "rerequest":
      return {
        text: t(`${pr.author} \u91CD\u65B0\u8BF7\u6C42\u4F60\u5BA1\u67E5`, `${pr.author} re-requested your review`),
        note: rules.rerequest ? "" : t("\u6309\u5F53\u524D\u89C4\u5219\u4E0D\u7B97\u4FEE\u590D", "not counted as a fix"),
        muted: !rules.rerequest
      };
    case "mark":
      return markText(t, e, evs, rules);
    case "merged":
      return { text: t(`${e.by} \u5408\u5E76\u4E86 PR`, `${e.by} merged the PR`) };
    case "closed":
      return { text: t("PR \u88AB\u5173\u95ED", "The PR was closed") };
    default:
      return { text: e.type };
  }
}
function verdictWord(last, t = zhOnly) {
  const e = last.e;
  if (e.type === "mark") {
    return last.v === "changes" ? t("\u5728\u63D2\u4EF6\u91CC\u6807\u8BB0\u201C\u9700\u8981\u4FEE\u590D\u201D", 'marked "changes needed" in the plugin') : t("\u5728\u63D2\u4EF6\u91CC\u6807\u8BB0\u201C\u6CA1\u95EE\u9898\u201D", 'marked "looks good" in the plugin');
  }
  if (e.type === "comment") {
    return t("\u53D1\u8868\u8BC4\u8BBA\uFF08\u6309\u89C4\u5219\u89C6\u4E3A\u8981\u6C42\u4FEE\u6539\uFF09", "commented (counted as changes under rules)");
  }
  if (e.state === "COMMENTED") {
    return t("\u7559\u4E86 Comment\uFF08\u6309\u89C4\u5219\u89C6\u4E3A\u8981\u6C42\u4FEE\u6539\uFF09", "left a comment review (counted as changes)");
  }
  return last.v === "changes" ? t("\u8981\u6C42\u4FEE\u6539", "requested changes") : t("Approve \u4E86", "approved");
}
function updatesWord(pr, ups, withTime, now, t = zhOnly) {
  const gh = ups.filter((e) => e.type !== "mark");
  if (!gh.length) {
    return t(
      `\u4F60${withTime ? ` ${fmtAbs(ups[0]?.at ?? now, now, t)}` : ""}\u786E\u8BA4\u4F5C\u8005\u5DF2\u4FEE\u590D`,
      `you${withTime ? ` at ${fmtAbs(ups[0]?.at ?? now, now, t)}` : ""} confirmed the fix`
    );
  }
  const n = gh.filter((e) => e.type === "commit").length;
  const parts = [];
  if (n) parts.push(t(`\u63A8\u9001\u4E86 ${n} \u4E2A\u63D0\u4EA4`, `pushed ${n} commit${n > 1 ? "s" : ""}`));
  if (gh.some((e) => e.type === "rerequest")) {
    parts.push(t("\u91CD\u65B0\u8BF7\u6C42\u4F60\u5BA1\u67E5", "re-requested your review"));
  }
  if (gh.some((e) => e.type === "comment")) parts.push(t("\u56DE\u590D\u4E86\u8BC4\u8BBA", "replied"));
  const when = withTime ? ` ${fmtAbs(gh[0].at, now, t)}` : "";
  return `${pr.author}${when} ${parts.join(t("\u3001", ", "))}`;
}
var rel = (ms, now, t) => fmtRel(ms, now, t);
function shortWhy(pr, d, rules, now, t = zhOnly) {
  switch (d.key) {
    case "needs_review":
      if (d.reopened) return t("\u4F60\u64A4\u56DE\u4E86\u4E4B\u524D\u7684\u7ED3\u8BBA\uFF0C\u9700\u8981\u91CD\u65B0\u770B", "you withdrew your verdict \u2014 review again");
      if (d.uncounted) return t("\u7559\u8FC7 Comment\uFF0C\u6309\u89C4\u5219\u4E0D\u7B97\u5BA1\u67E5", "you commented, but it doesn't count as a review");
      return t(
        `${rel(d.since, now, t)}\u63D0\u4EA4\uFF0C\u4F60\u8FD8\u6CA1\u5BA1`,
        `opened ${rel(d.since, now, t)}, not reviewed yet`
      );
    case "reviewing":
      return t("\u5DF2\u521B\u5EFA worktree\uFF0C\u7B49\u4F60\u63D0\u4EA4\u5BA1\u67E5\u7ED3\u8BBA", "worktree ready \u2014 submit your review verdict");
    case "needs_rereview":
      return updatesWord(pr, d.updates, false, now, t);
    case "changes_requested": {
      const e = d.last.e;
      const what = e.type === "mark" ? t("\u6807\u8BB0\u9700\u8981\u4FEE\u590D", "marked changes needed") : e.state === "COMMENTED" ? t("\u7559\u4E86 Comment", "left a comment review") : t("\u8981\u6C42\u4FEE\u6539", "requested changes");
      return t(
        `\u4F60 ${rel(e.at, now, t)}${what}${e.comments ? ` \xB7 ${e.comments} \u6761\u8BC4\u8BBA` : ""}`,
        `you ${what} ${rel(e.at, now, t)}${e.comments ? ` \xB7 ${e.comments} comments` : ""}`
      );
    }
    case "approved":
      return t(
        `\u4F60 ${rel(d.last.e.at, now, t)}\u901A\u8FC7${d.ignoredMB.length ? " \xB7 \u4E4B\u540E\u5408\u5E76\u8FC7\u4E3B\u5E72" : ""}`,
        `you approved ${rel(d.last.e.at, now, t)}${d.ignoredMB.length ? " \xB7 base merged since" : ""}`
      );
    case "draft":
      return t("\u8349\u7A3F\uFF0C\u7B49\u4F5C\u8005\u8F6C Ready", "draft \u2014 waiting for the author to mark ready");
    case "merged":
      return t(`${rel(d.since, now, t)}\u5408\u5E76`, `merged ${rel(d.since, now, t)}`);
    case "closed":
      return t(`${rel(d.since, now, t)}\u5173\u95ED\uFF0C\u672A\u5408\u5E76`, `closed unmerged ${rel(d.since, now, t)}`);
    default:
      return t(`\u4F60 ${rel(d.since, now, t)}\u6807\u8BB0\u5B8C\u6210`, `you marked it done ${rel(d.since, now, t)}`);
  }
}
function shaZh(x) {
  return x ? `\uFF08${x.slice(0, 7)}\uFF09` : "";
}
function shaEn(x) {
  return x ? ` (${x.slice(0, 7)})` : "";
}
function needsReviewStep(pr, d, now, t) {
  const why = d.reopened ? t(
    `\u4F60 ${fmtAbs(d.reopened.at, now, t)} \u64A4\u56DE\u4E86\u4E4B\u524D\u7684\u7ED3\u8BBA\uFF0C\u9700\u8981\u91CD\u65B0\u770B\u4E00\u904D\u3002`,
    `You withdrew your verdict at ${fmtAbs(d.reopened.at, now, t)}; please review again.`
  ) : d.uncounted ? t(
    `\u4F60 ${fmtAbs(d.uncounted.at, now, t)} \u7559\u8FC7 ${d.uncounted.type === "review" ? "Comment" : "\u8BC4\u8BBA"}\uFF0C\u4F46\u6309\u5F53\u524D\u89C4\u5219\u4E0D\u7B97\u5BA1\u67E5\u3002`,
    `You left a ${d.uncounted.type === "review" ? "comment review" : "comment"} at ${fmtAbs(d.uncounted.at, now, t)}, which doesn't count as a review.`
  ) : t(
    `${pr.author} ${fmtAbs(d.since, now, t)} \u63D0\u4EA4\u4E86\u8FD9\u4E2A PR\uFF0C\u4F60\u8FD8\u6CA1\u5BA1\u67E5\u8FC7\u3002`,
    `${pr.author} opened this PR at ${fmtAbs(d.since, now, t)}; you haven't reviewed it yet.`
  );
  return {
    owner: "me",
    head: t("\u8F6E\u5230\u4F60", "Your turn"),
    title: d.reopened ? t("\u91CD\u65B0\u5BA1\u67E5", "Review again") : t("\u9996\u6B21\u5BA1\u67E5", "First review"),
    why,
    plain: why
  };
}
function reviewingStep(pr, d, now, t) {
  const why = t(
    `\u4F60\u5DF2\u4E3A ${pr.repoSlug} #${pr.number} \u521B\u5EFA/\u7ED1\u5B9A worktree\uFF0C\u8FD8\u6CA1\u63D0\u4EA4\u5BA1\u67E5\u7ED3\u8BBA\u3002\u63D0\u4EA4\u540E\u4F1A\u81EA\u52A8\u8FDB\u5165\u300C\u5DF2\u901A\u8FC7\u300D\u6216\u300C\u5F85\u4FEE\u590D\u300D\u3002`,
    `You linked a worktree for ${pr.repoSlug} #${pr.number} but haven't submitted a verdict yet. Submitting moves it to Approved or Changes.`
  );
  return {
    owner: "me",
    head: t("\u5BA1\u67E5\u4E2D", "Reviewing"),
    title: t(`\u7EE7\u7EED\u5BA1\u67E5 ${pr.author} \u7684\u4FEE\u6539`, `Continue reviewing ${pr.author}'s PR`),
    why,
    plain: why
  };
}
function rereviewStep(pr, d, now, t) {
  const why = t(
    `\u4F60 ${fmtAbs(d.last.e.at, now, t)} ${verdictWord(d.last, t)}${shaZh(d.last.sha)}\uFF0C\u4E4B\u540E ${updatesWord(pr, d.updates, true, now, t)}\u3002`,
    `You ${verdictWord(d.last, t)}${shaEn(d.last.sha)} at ${fmtAbs(d.last.e.at, now, t)}, then ${updatesWord(pr, d.updates, true, now, t)}.`
  );
  const compare = d.last.sha && d.headSha !== d.last.sha ? `${d.last.sha}\u2026${d.headSha}` : null;
  return {
    owner: "me",
    head: t("\u8F6E\u5230\u4F60", "Your turn"),
    title: t(`\u590D\u5BA1 ${pr.author} \u7684\u4FEE\u6539`, `Re-review ${pr.author}'s changes`),
    why,
    plain: why,
    compare
  };
}
function changesStep(pr, d, rules, now, t) {
  const silent = now - d.since > rules.silentDays * DAY;
  const why = t(
    `\u4F60 ${fmtAbs(d.last.e.at, now, t)} ${verdictWord(d.last, t)}${shaZh(d.last.sha)}\uFF0C\u4E4B\u540E ${pr.author} \u8FD8\u6CA1\u6709\u65B0\u7684\u63A8\u9001\u3002${silent ? `\u5DF2\u8D85\u8FC7 ${rules.silentDays} \u5929\u6CA1\u52A8\u9759\uFF0C\u53EF\u4EE5\u53BB GitHub \u50AC\u4E00\u4E0B\u6216\u5173\u6389\u3002` : ""}`,
    `You ${verdictWord(d.last, t)}${shaEn(d.last.sha)} at ${fmtAbs(d.last.e.at, now, t)}; ${pr.author} hasn't pushed since.${silent ? ` Silent for over ${rules.silentDays} days \u2014 ping or close it.` : ""}`
  );
  return {
    owner: "author",
    head: t(`\u7B49 ${pr.author}`, `Waiting on ${pr.author}`),
    title: t("\u4FEE\u590D\u4F60\u63D0\u51FA\u7684\u95EE\u9898", "Fix the issues you raised"),
    why,
    plain: why
  };
}
function approvedStep(pr, d, rules, now, t) {
  const mb = d.ignoredMB.length ? t(`\u4E4B\u540E ${pr.author} \u5408\u5E76\u8FC7\u4E3B\u5E72\uFF0C\u6309\u89C4\u5219\u4E0D\u7B97\u65B0\u6539\u52A8\u3002`, `${pr.author} merged the base since; not counted as new code.`) : "";
  const kept = d.newCode && rules.approveThenCommit === "keep" ? t("\u4E4B\u540E\u6709\u65B0\u63D0\u4EA4\uFF0C\u6309\u89C4\u5219\u4FDD\u6301\u5DF2\u901A\u8FC7\u3002", "New commits arrived; keeping the approval by rule.") : "";
  const why = t(
    `\u4F60 ${fmtAbs(d.last.e.at, now, t)} ${verdictWord(d.last, t)}${shaZh(d.last.sha)}\u3002${mb}${kept}`,
    `You ${verdictWord(d.last, t)}${shaEn(d.last.sha)} at ${fmtAbs(d.last.e.at, now, t)}. ${mb}${kept}`
  );
  return {
    owner: "merge",
    head: t("\u7B49\u5408\u5E76", "Ready to merge"),
    title: t("\u53EF\u4EE5\u5408\u5E76\u4E86", "Ready to merge"),
    why,
    plain: why
  };
}
var TERMINAL = {
  draft: {
    title: ["\u5B8C\u6210\u8349\u7A3F", "Finish the draft"],
    why: (pr, d, now, t) => t(
      `${pr.author} ${fmtAbs(d.since, now, t)} \u5F00\u7684\u662F\u8349\u7A3F\uFF0C\u8F6C\u4E3A Ready for review \u540E\u8FDB\u5165\u5F85\u5BA1\u67E5\u3002`,
      `${pr.author} opened this as a draft at ${fmtAbs(d.since, now, t)}; it enters review once marked ready.`
    )
  },
  merged: {
    title: ["\u5DF2\u5408\u5E76", "Merged"],
    why: (pr, d, now, t) => t(`${fmtAbs(d.since, now, t)} \u5DF2\u5408\u5E76\u3002`, `Merged at ${fmtAbs(d.since, now, t)}.`)
  },
  closed: {
    title: ["\u5DF2\u5173\u95ED", "Closed"],
    why: (pr, d, now, t) => t(`${fmtAbs(d.since, now, t)} \u5DF2\u5173\u95ED\uFF0C\u672A\u5408\u5E76\u3002`, `Closed unmerged at ${fmtAbs(d.since, now, t)}.`)
  },
  done: {
    title: ["\u4F60\u6807\u8BB0\u5B8C\u6210", "Marked done"],
    why: (pr, d, now, t) => t(
      `\u4F60 ${fmtAbs(d.since, now, t)} \u5728\u63D2\u4EF6\u91CC\u6807\u8BB0\u5B8C\u6210\uFF0CGitHub \u4E0A\u4ECD\u662F open\u3002\u4F5C\u8005\u4E4B\u540E\u6709\u65B0\u63A8\u9001\u4F1A\u81EA\u52A8\u56DE\u5230\u6B63\u5E38\u6D41\u8F6C\u3002`,
      `You marked it done at ${fmtAbs(d.since, now, t)}; the PR is still open on GitHub. A new push restores normal flow.`
    )
  }
};
function terminalStep(pr, d, now, t) {
  const meta = TERMINAL[d.key] || TERMINAL.done;
  const why = meta.why(pr, d, now, t);
  const plain = d.key === "merged" ? t(`${why}\u5BF9\u5E94\u7684 worktree \u53EF\u4EE5\u5220\u4E86\u3002`, `${why} The linked worktree can be removed.`) : why;
  const head = d.key === "draft" ? t(`\u7B49 ${pr.author}`, `Waiting on ${pr.author}`) : t("\u5DF2\u7ED3\u675F", "Finished");
  return { owner: d.key === "draft" ? "author" : "done", head, title: t(meta.title[0], meta.title[1]), why, plain };
}
function nextStep(pr, d, rules, now, t = zhOnly) {
  switch (d.key) {
    case "needs_review":
      return needsReviewStep(pr, d, now, t);
    case "reviewing":
      return reviewingStep(pr, d, now, t);
    case "needs_rereview":
      return rereviewStep(pr, d, now, t);
    case "changes_requested":
      return changesStep(pr, d, rules, now, t);
    case "approved":
      return approvedStep(pr, d, rules, now, t);
    default:
      return terminalStep(pr, d, now, t);
  }
}

// src/badges.js
function compactAge(ms) {
  const minutes = Math.floor(ms / 6e4);
  if (minutes < 60) return `${Math.max(0, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
function composeBadgeLabel(label, age) {
  const withDot = `${label}\xB7${age}`;
  if ([...withDot].length <= 6) return withDot;
  const tight = `${label}${age}`;
  if ([...tight].length <= 6) return tight;
  return [...withDot].slice(0, 6).join("");
}
function badgeTip(wt, pr, def, d, rules, bindings, t) {
  const age = duration(Date.now() - d.since, t);
  return [
    `${pr.repoSlug} #${pr.number} \xB7 ${def.label}${d.reviews ? ` \xB7 ${t(`\u5DF2\u5BA1 ${d.reviews} \u6B21`, `reviewed ${d.reviews}\xD7`)}` : ""}`,
    nextStep(pr, d, rules, Date.now(), t).plain,
    t(`\u505C\u7559 ${age} \xB7 \u5BF9\u5E94\u65B9\u5F0F\uFF1A${linkSource(wt, pr, bindings)}`, `for ${age} \xB7 linked by: ${linkSource(wt, pr, bindings)}`),
    rules.badgeClick === "detail" ? t("\u70B9\u51FB\u67E5\u770B\u6D41\u8F6C\u8BE6\u60C5", "click to open details") : t("\u70B9\u51FB\u5728 GitHub \u6253\u5F00", "click to open on GitHub")
  ].join("\n");
}
function badgeForWorktree({ state, wt, pr, t }) {
  const rules = state.cfg.rules;
  if (!rules.badgeEnabled || !pr || pr.ignored) return null;
  const repo = state.cfg.repos.find((r) => r.slug === pr.repoSlug);
  if (!repo || repo.enabled === false) return null;
  const d = reviewingState(derive(pr, rules), true, state.local.reviewing[pr.key]);
  const def = state.cfg.defs[d.key];
  if (!def?.badge) return null;
  const f = flags(d, rules, Date.now());
  const showAge = rules.badgeAge === "always" || rules.badgeAge === "overdue" && (f.overdue || f.silent);
  const age = duration(Date.now() - d.since, t);
  const label = showAge && def.owner !== "done" ? composeBadgeLabel(def.label, compactAge(Date.now() - d.since)) : def.label;
  return {
    label,
    tone: def.tone,
    tooltip: badgeTip(wt, pr, def, d, rules, state.local.bindings, t)
  };
}
function buildPayload({ state, worktrees, prs, t }) {
  return worktrees.map((wt) => [
    wt.workspaceId,
    badgeForWorktree({
      state,
      wt,
      pr: linkPr(wt, { prs, bindings: state.local.bindings, rules: state.cfg.rules }),
      t
    })
  ]);
}
function openWorktreePr({ ctx, store, index, exec, target }) {
  const state = store.getSnapshot();
  const wt = index.getSnapshot().worktrees.find((w) => w.workspaceId === target.workspaceId);
  if (!wt) return;
  const pr = linkPr(wt, { prs: store.allPrs(), bindings: state.local.bindings, rules: state.cfg.rules });
  if (!pr) return;
  if (state.cfg.rules.badgeClick === "github") {
    exec.openUrl(prUrl(pr)).catch(() => void 0);
    return;
  }
  store.setUi({ drawerKey: pr.key, modal: null });
  try {
    ctx.ui.openCenterTab("board");
  } catch {
  }
}
function createBadges({ ctx, store, index, exec, t }) {
  const supported = typeof ctx.ui.registerWorktreeBadges === "function";
  let handle = null;
  let known = /* @__PURE__ */ new Set();
  let lastSerialized = null;
  let offTargets = null;
  if (supported) {
    handle = ctx.ui.registerWorktreeBadges({
      key: "pr-status",
      order: 10,
      onClick: (target) => openWorktreePr({ ctx, store, index, exec, target })
    });
    if (typeof handle.onChange === "function") {
      offTargets = handle.onChange(() => {
        index.refresh().catch(() => void 0);
      });
    }
  }
  function refresh() {
    if (!supported || !handle) return;
    const state = store.getSnapshot();
    const ignored = new Set(state.local.ignored);
    const prs = store.allPrs().map((pr) => ignored.has(pr.key) ? { ...pr, ignored: true } : pr);
    const worktrees = index.getSnapshot().worktrees;
    const missing = [];
    for (const wt of worktrees) {
      const pr = linkPr(wt, { prs, bindings: state.local.bindings, rules: state.cfg.rules });
      if (!pr || state.local.reviewing[pr.key]) continue;
      if (derive(pr, state.cfg.rules).key === "needs_review") missing.push(pr.key);
    }
    if (missing.length) {
      for (const key of missing) store.markReviewing(key, Date.now());
    }
    const payload = buildPayload({ state, worktrees, prs, t });
    const serialized = JSON.stringify(payload);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    const current = /* @__PURE__ */ new Set();
    for (const [workspaceId, badge] of payload) {
      current.add(workspaceId);
      handle.set(workspaceId, badge);
    }
    for (const id of known) if (!current.has(id)) handle.set(id, null);
    known = current;
  }
  function dispose() {
    if (offTargets) offTargets();
    offTargets = null;
    if (handle) handle.dispose();
    handle = null;
  }
  return { supported, refresh, dispose, openPr: openWorktreePr };
}

// src/gh/exec.js
var GhError = class extends Error {
  constructor(kind, message, details = {}) {
    super(message);
    this.name = "GhError";
    this.kind = kind;
    this.details = details;
  }
};
var MISSING = /command not found|no such file or directory|ENOENT|不是内部或外部命令/i;
var AUTH = /gh auth login|not logged in|authentication failed|bad credentials|HTTP 401|HTTP 40[13].*auth|requires authentication/i;
var RATE = /rate limit|secondary rate|abuse detection|HTTP 429/i;
var NETWORK = /could not resolve host|failed to connect|connection (reset|refused)|timed out|timeout|TLS|network is unreachable|unexpected EOF|\bEOF\b|HTTP 5\d\d/i;
function classifyFailure(message) {
  const text = String(message || "");
  if (MISSING.test(text)) return "missing";
  if (AUTH.test(text)) return "auth";
  if (RATE.test(text)) return "rate_limit";
  if (NETWORK.test(text)) return "network";
  return "other";
}
var READ_ONLY = /* @__PURE__ */ new Set([
  "api:graphql",
  "api:user",
  "pr:list",
  "auth:status"
]);
var FORBIDDEN_FLAGS = /* @__PURE__ */ new Set(["-F", "--field", "--input", "--method", "--web"]);
var PR_LIST_FLAGS = /* @__PURE__ */ new Set(["-R", "--state", "--search", "--limit", "--json", "--jq"]);
function assertReadOnlyArgs(args) {
  const [group, sub] = args || [];
  const key = `${group}:${sub}`;
  if (!READ_ONLY.has(key)) {
    throw new GhError("denied", `\u53EA\u5141\u8BB8\u53EA\u8BFB\u7684 gh \u5B50\u547D\u4EE4\uFF0C\u5DF2\u62D2\u7EDD\uFF1Agh ${[group, sub].filter(Boolean).join(" ")}`);
  }
  if (args.some((arg) => FORBIDDEN_FLAGS.has(arg))) {
    throw new GhError("denied", "\u53EA\u8BFB\u767D\u540D\u5355\u4E0D\u63A5\u53D7 -F / --input / --method / --web \u7B49\u53EF\u5199\u6216\u4EA4\u4E92\u53C2\u6570");
  }
  if (key === "api:graphql") {
    const queries = args.filter((a) => typeof a === "string" && a.startsWith("query="));
    if (queries.length !== 1) throw new GhError("denied", "\u53EA\u5141\u8BB8\u4E00\u6761 GraphQL query");
    if (/mutation\b/i.test(queries[0])) {
      throw new GhError("denied", "\u53EA\u5141\u8BB8\u53EA\u8BFB\u67E5\u8BE2\uFF1A\u5DF2\u62D2\u7EDD GraphQL mutation");
    }
  }
  if (key === "pr:list") {
    for (const arg of args.slice(2)) {
      if (arg.startsWith("-") && !PR_LIST_FLAGS.has(arg)) {
        throw new GhError("denied", `pr list \u4E0D\u63A5\u53D7\u53C2\u6570\uFF1A${arg}`);
      }
    }
  }
}
function assertGitArgs(args) {
  const ok = Array.isArray(args) && args.length === 5 && args[0] === "-C" && args[2] === "remote" && args[3] === "get-url";
  if (!ok) throw new GhError("denied", "git \u53EA\u5141\u8BB8 `git -C <path> remote get-url <remote>`");
}
function detectPlatform() {
  if (typeof navigator !== "undefined" && /win/i.test(navigator.userAgent || "")) return "win32";
  return "darwin";
}
var defaultInvoke = async () => {
  throw new GhError("denied", "\u672A\u63D0\u4F9B exec \u6865");
};
function createLimiter(concurrency) {
  let active = 0;
  const queue = [];
  const acquire = () => {
    if (active < concurrency) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  };
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
  };
  return { acquire, release };
}
async function invokeOnce({ invoke, bin, args, timeoutMs, limiter, stats }) {
  await limiter.acquire();
  stats.calls += 1;
  try {
    const result = await invoke("plugin_exec_run", { bin, args, timeoutMs });
    return {
      code: Number(result?.code ?? 0),
      stdout: String(result?.stdout ?? ""),
      stderr: String(result?.stderr ?? "")
    };
  } catch (error) {
    const message = error?.message || String(error);
    throw new GhError(classifyFailure(message), message, { bin, args });
  } finally {
    limiter.release();
  }
}
function failureOf(result, bin, args) {
  const text = `${result.stderr}
${result.stdout}`.trim();
  return new GhError(classifyFailure(text), text || `${bin} \u6267\u884C\u5931\u8D25\uFF08${result.code}\uFF09`, {
    bin,
    args,
    code: result.code
  });
}
function openerFor(platform, url) {
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  if (platform === "darwin") return ["open", [url]];
  return ["xdg-open", [url]];
}
function assertGitHubUrl(url) {
  const fail = () => {
    throw new GhError("denied", "\u53EA\u5141\u8BB8\u6253\u5F00\u4EE5 https://github.com/ \u5F00\u5934\u7684\u94FE\u63A5");
  };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail();
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") fail();
  if (/[&|^<>"\s]/.test(parsed.href)) fail();
  return parsed.href;
}
function createExec({
  invoke = defaultInvoke,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  platform = detectPlatform(),
  concurrency = GH_CONCURRENCY,
  timeoutMs = GH_TIMEOUT_MS
} = {}) {
  const limiter = createLimiter(concurrency);
  const stats = { calls: 0 };
  const runRaw = (bin, args, timeout) => invokeOnce({ invoke, bin, args, timeoutMs: timeout, limiter, stats });
  async function runGh(args, { retry = true } = {}) {
    assertReadOnlyArgs(args);
    let rateRetried = false;
    let networkRetries = 0;
    for (; ; ) {
      const result = await runRaw("gh", args, timeoutMs);
      if (result.code === 0) return result;
      const error = failureOf(result, "gh", args);
      if (!retry) throw error;
      if (error.kind === "rate_limit" && !rateRetried) {
        rateRetried = true;
        await sleep(1500);
        continue;
      }
      if (error.kind === "network" && networkRetries < 2) {
        networkRetries += 1;
        await sleep(800 * networkRetries);
        continue;
      }
      throw error;
    }
  }
  async function runGit(args) {
    assertGitArgs(args);
    const result = await runRaw("git", args, GIT_TIMEOUT_MS);
    if (result.code !== 0) throw failureOf(result, "git", args);
    return result;
  }
  async function openUrl(url) {
    const href = assertGitHubUrl(url);
    const [bin, args] = openerFor(platform, href);
    const result = await runRaw(bin, args, GIT_TIMEOUT_MS);
    if (result.code !== 0) {
      throw new GhError("other", `\u65E0\u6CD5\u6253\u5F00\u6D4F\u89C8\u5668\uFF1A${result.stderr || result.code}`, { url });
    }
    return true;
  }
  return { runGh, runGit, openUrl, stats };
}
function describeGhError(error) {
  const kind = error?.kind || classifyFailure(error?.message);
  switch (kind) {
    case "missing":
      return "\u6CA1\u6709\u627E\u5230 gh CLI\u3002\u8BF7\u5148\u5B89\u88C5 GitHub CLI\uFF08https://cli.github.com\uFF09\uFF0C\u7136\u540E\u91CD\u542F\u5BA2\u6237\u7AEF\u3002";
    case "auth":
      return "gh \u672A\u767B\u5F55\u3002\u8BF7\u5728\u7EC8\u7AEF\u6267\u884C `gh auth login`\uFF0C\u5B8C\u6210\u540E\u70B9\u300C\u540C\u6B65\u300D\u3002";
    case "rate_limit":
      return "gh \u89E6\u53D1\u4E86 GitHub \u9650\u6D41\u3002\u5DF2\u81EA\u52A8\u91CD\u8BD5\u4E00\u6B21\uFF1B\u7A0D\u540E\u518D\u8BD5\uFF0C\u6216\u628A\u540C\u6B65\u95F4\u9694\u8C03\u5927\u3002";
    case "network":
      return "\u8FDE\u63A5 GitHub \u5931\u8D25\uFF08\u7F51\u7EDC\u6216\u4EE3\u7406\u95EE\u9898\uFF09\u3002\u68C0\u67E5\u7F51\u7EDC\u540E\u70B9\u300C\u540C\u6B65\u300D\u91CD\u8BD5\u3002";
    case "denied":
      return error?.message || "\u64CD\u4F5C\u88AB\u53EA\u8BFB\u767D\u540D\u5355\u62D2\u7EDD\u3002";
    default:
      return error?.message ? `gh \u6267\u884C\u5931\u8D25\uFF1A${error.message.slice(0, 300)}` : "gh \u6267\u884C\u5931\u8D25\u3002";
  }
}

// src/i18n.js
function isEnglish(locale) {
  return !/^zh/i.test(String(locale || ""));
}
function createT(locale) {
  const en = isEnglish(locale);
  return (zh, enText) => en ? enText ?? zh : zh;
}
var DEFAULT_DEFS_EN = {
  needs_review: { label: "New", tone: "blue", owner: "me", badge: true },
  reviewing: { label: "Rev", tone: "cyan", owner: "me", badge: true },
  changes_requested: { label: "Chg", tone: "yellow", owner: "author", badge: true },
  needs_rereview: { label: "Re", tone: "rose", owner: "me", badge: true },
  approved: { label: "OK", tone: "green", owner: "merge", badge: true },
  draft: { label: "Draft", tone: "neutral", owner: "author", badge: false },
  merged: { label: "Merge", tone: "purple", owner: "done", badge: true },
  closed: { label: "Closed", tone: "neutral", owner: "done", badge: true },
  done: { label: "Done", tone: "lime", owner: "done", badge: true }
};
var OWNER_LABELS_EN = { me: "You", author: "Author", merge: "Merge", done: "Done" };
function ownerLabel(owner, t) {
  return t(
    { me: "\u7B49\u6211", author: "\u7B49\u4F5C\u8005", merge: "\u7B49\u5408\u5E76", done: "\u5DF2\u7ED3\u675F" }[owner] || owner,
    OWNER_LABELS_EN[owner] || owner
  );
}

// src/domain/board.js
function colOf(statusKey) {
  const col = COLUMNS.find((c) => c.statuses.includes(statusKey));
  return col ? col.key : "review";
}
function columnByKey(colKey) {
  return COLUMNS.find((c) => c.key === colKey) || COLUMNS[0];
}
function isDoneMark(e) {
  return e.type === "mark" && e.verdict === "done";
}
function dropPlan(pr, rules, toCol) {
  const d = derive(pr, rules);
  const from = colOf(d.key);
  if (from === toCol) return { ok: true, reorder: true, text: "\u8C03\u6574\u987A\u5E8F" };
  if (d.key === "merged" || d.key === "closed") {
    return { ok: false, text: "\u5DF2\u5408\u5E76 / \u5DF2\u5173\u95ED\u7531 GitHub \u51B3\u5B9A" };
  }
  if (d.key === "draft") return { ok: false, text: "\u8349\u7A3F\u8981\u7B49\u4F5C\u8005\u8F6C Ready" };
  const base = d.key === "done" ? pr.events.filter((e) => !isDoneMark(e)) : pr.events;
  const baseKey = derive({ ...pr, events: base }, rules);
  if (d.key === "done" && colOf(baseKey.key) === toCol) {
    return { ok: true, base, mark: null, text: "\u53D6\u6D88\u201C\u5B8C\u6210\u201D\u6807\u8BB0" };
  }
  if (toCol === "rereview" && !baseKey.last) {
    return { ok: false, text: "\u4F60\u8FD8\u6CA1\u5BA1\u8FC7\uFF0C\u8C08\u4E0D\u4E0A\u590D\u5BA1" };
  }
  const mark = DROP_MARK[toCol];
  if (!mark) return { ok: false, text: "\u672A\u77E5\u76EE\u6807\u5217" };
  return { ok: true, base, mark, text: `\u6807\u8BB0\u300C${MARK_TEXT[mark]}\u300D` };
}
function applyDrop(pr, rules, toCol, ids, now) {
  const plan = dropPlan(pr, rules, toCol);
  if (!plan.ok) return { ok: false, reason: plan.text };
  if (plan.reorder) return { ok: true, reorder: true, order: ids };
  const beforeKey = derive(pr, rules).key;
  const markEvent = plan.mark ? { type: "mark", verdict: plan.mark, via: "drag", at: now, sha: pr.headSha } : null;
  const events = markEvent ? [...plan.base, markEvent] : plan.base;
  const afterKey = derive({ ...pr, events }, rules).key;
  return {
    ok: true,
    events,
    order: ids,
    mark: plan.mark,
    beforeKey,
    afterKey,
    text: plan.text
  };
}
function sortColumn(rows, colKey, orderIds) {
  const pos = new Map((orderIds || []).map((id, i) => [id, i]));
  const desc = colKey === "ended";
  return [...rows].sort((a, b) => {
    const pa = pos.has(a.pr.key) ? pos.get(a.pr.key) : Number.POSITIVE_INFINITY;
    const pb = pos.has(b.pr.key) ? pos.get(b.pr.key) : Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    if (colKey === "review") {
      const rank = Number(b.d.key === "reviewing") - Number(a.d.key === "reviewing");
      if (rank) return rank;
    }
    const overdue = Number(b.f.overdue) - Number(a.f.overdue);
    if (overdue) return overdue;
    return desc ? b.d.since - a.d.since : a.d.since - b.d.since;
  });
}
function orderAfterDrop(sortedRows, draggedKey, index) {
  const keys = sortedRows.map((r) => r.pr.key).filter((key) => key !== draggedKey);
  const at = Math.max(0, Math.min(index, keys.length));
  return [...keys.slice(0, at), draggedKey, ...keys.slice(at)];
}
function splitColumn(rows, colKey, { endedDays, now }) {
  const col = columnByKey(colKey);
  const inCol = rows.filter((r) => col.statuses.includes(r.d.key));
  const cut = now - endedDays * DAY;
  const visible = colKey === "ended" ? inCol.filter((r) => r.d.since >= cut) : inCol;
  const hidden = inCol.length - visible.length;
  return {
    main: visible.filter((r) => r.d.key !== "draft"),
    drafts: visible.filter((r) => r.d.key === "draft"),
    hidden
  };
}

// src/store.js
var LOCAL_EMPTY = () => ({ marks: {}, bindings: {}, order: {}, ignored: [], reviewing: {} });
function defaultConfig(repos = []) {
  return {
    rules: { ...DEFAULT_RULES },
    defs: { ...DEFAULT_DEFS },
    repos: repos.map((r) => ({ slug: r.slug, enabled: r.enabled !== false })),
    extraAccounts: []
  };
}
function initialState() {
  return {
    ready: false,
    cfg: defaultConfig(),
    snapshots: {},
    local: LOCAL_EMPTY(),
    runtime: {
      syncing: false,
      syncStartedAt: null,
      progress: { done: 0, total: 0 },
      lastSync: null,
      errors: {},
      ghLogin: null,
      ghError: null,
      calls: 0
    },
    ui: {
      view: "board",
      filter: "all",
      repoFilter: "all",
      query: "",
      chartMode: "chart",
      showIgnored: false,
      drawerKey: null,
      modal: null
    }
  };
}
var NUMERIC_RULES = /* @__PURE__ */ new Set([
  "overdueReview",
  "overdueRereview",
  "silentDays",
  "endedDays"
]);
var OWNERS = /* @__PURE__ */ new Set(["me", "author", "merge", "done"]);
function sanitizeRules(raw) {
  const out = { ...DEFAULT_RULES };
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(DEFAULT_RULES)) {
    const value = raw[key];
    if (value === void 0) continue;
    if (NUMERIC_RULES.has(key)) {
      if (Number.isFinite(Number(value))) out[key] = Math.max(0, Math.min(99, Number(value)));
    } else if (Array.isArray(DEFAULT_RULES[key])) {
      if (Array.isArray(value)) out[key] = value.map(String).filter(Boolean);
    } else if (typeof value === typeof DEFAULT_RULES[key]) {
      out[key] = value;
    }
  }
  if (!["all", "mine"].includes(out.scope)) out.scope = DEFAULT_RULES.scope;
  if (!["0", "5", "15", "30", "60"].includes(String(out.interval))) out.interval = DEFAULT_RULES.interval;
  if (![0, 4, 6].includes(out.dayCutoff)) out.dayCutoff = DEFAULT_RULES.dayCutoff;
  if (!["never", "overdue", "always"].includes(out.badgeAge)) out.badgeAge = DEFAULT_RULES.badgeAge;
  if (!["detail", "github"].includes(out.badgeClick)) out.badgeClick = DEFAULT_RULES.badgeClick;
  return out;
}
function sanitizeDefs(raw) {
  const out = { ...DEFAULT_DEFS };
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(DEFAULT_DEFS)) {
    const def = raw[key];
    if (!def || typeof def !== "object") continue;
    out[key] = {
      label: typeof def.label === "string" && def.label.trim() ? [...def.label.trim()].slice(0, 6).join("") : DEFAULT_DEFS[key].label,
      tone: TONES.includes(def.tone) ? def.tone : DEFAULT_DEFS[key].tone,
      owner: OWNERS.has(def.owner) ? def.owner : DEFAULT_DEFS[key].owner,
      badge: typeof def.badge === "boolean" ? def.badge : DEFAULT_DEFS[key].badge
    };
  }
  return out;
}
function sanitizePr(pr) {
  if (!pr || typeof pr !== "object") return null;
  if (typeof pr.key !== "string" || !pr.key || typeof pr.number !== "number") return null;
  if (!Array.isArray(pr.events)) return null;
  return {
    ...pr,
    author: String(pr.author || ""),
    headSha: String(pr.headSha || ""),
    headRefName: String(pr.headRefName || ""),
    commitShas: Array.isArray(pr.commitShas) ? pr.commitShas.map(String) : [],
    createdAt: Number.isFinite(pr.createdAt) ? pr.createdAt : 0,
    updatedAt: Number.isFinite(pr.updatedAt) ? pr.updatedAt : 0
  };
}
function migrateConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = defaultConfig(Array.isArray(raw.repos) ? raw.repos : []);
  return {
    ...base,
    rules: sanitizeRules(raw.rules),
    defs: sanitizeDefs(raw.defs),
    extraAccounts: Array.isArray(raw.extraAccounts) ? raw.extraAccounts.map(String).filter(Boolean) : []
  };
}
function migrateLocal(raw) {
  if (!raw || raw.v !== STORE_VERSION) return LOCAL_EMPTY();
  const base = LOCAL_EMPTY();
  return {
    marks: raw.marks && typeof raw.marks === "object" ? raw.marks : base.marks,
    bindings: raw.bindings && typeof raw.bindings === "object" ? raw.bindings : base.bindings,
    order: raw.order && typeof raw.order === "object" ? raw.order : base.order,
    ignored: Array.isArray(raw.ignored) ? raw.ignored : base.ignored,
    reviewing: raw.reviewing && typeof raw.reviewing === "object" ? raw.reviewing : base.reviewing
  };
}
function migrateSnapshot(raw) {
  if (!raw || raw.v !== STORE_VERSION) return null;
  return {
    syncedAt: Number(raw.syncedAt) || 0,
    prs: Array.isArray(raw.prs) ? raw.prs.map(sanitizePr).filter(Boolean) : [],
    daily: raw.daily && typeof raw.daily === "object" ? raw.daily : {}
  };
}
function trimSnapshot(snap, now) {
  const cut = now - 30 * DAY;
  const prs = (snap.prs || []).filter((pr) => {
    if (pr.state === "OPEN" || !pr.state) return true;
    const terminal = pr.events?.find((e) => e.type === "merged" || e.type === "closed");
    return (terminal?.at || 0) >= cut;
  });
  return { ...snap, prs };
}
function openedFirst(a, b) {
  if (a.type === "opened") return -1;
  if (b.type === "opened") return 1;
  return a.at - b.at;
}
function createPersistence({ save, debounceMs, schedule, cancel }) {
  const pending = /* @__PURE__ */ new Map();
  const timers = /* @__PURE__ */ new Map();
  const queueSave = (key, value) => {
    pending.set(key, value);
    if (timers.has(key)) return;
    timers.set(key, schedule(() => {
      timers.delete(key);
      flushKey(key);
    }, debounceMs));
  };
  const flushKey = (key) => {
    if (!pending.has(key)) return;
    const value = pending.get(key);
    pending.delete(key);
    const timer = timers.get(key);
    if (timer) {
      cancel(timer);
      timers.delete(key);
    }
    Promise.resolve(save(key, value)).catch(() => void 0);
  };
  const flush = () => {
    for (const key of [...pending.keys()]) flushKey(key);
  };
  return { queueSave, flush };
}
function createCore(options) {
  const { load, save, now, debounceMs, schedule, cancel } = options;
  let state = initialState();
  const listeners = /* @__PURE__ */ new Set();
  const persistence = createPersistence({ save, debounceMs, schedule, cancel });
  const getState = () => state;
  const commit = (next) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { load, now, getState, commit, subscribe, ...persistence };
}
async function loadState(core) {
  const [rawCfg, rawLocal] = await Promise.all([core.load("cfg"), core.load("local")]);
  const cfg = migrateConfig(rawCfg) || defaultConfig();
  const local = migrateLocal(rawLocal);
  const snapshots = {};
  for (const repo of cfg.repos) {
    const snap = migrateSnapshot(await core.load(`snap:${repo.slug}`));
    if (snap) snapshots[repo.slug] = snap;
  }
  core.commit({ ...core.getState(), ready: true, cfg, local, snapshots });
}
function createConfigApi(core) {
  const updateCfg = (patch) => {
    const cfg = { ...core.getState().cfg, ...patch };
    core.commit({ ...core.getState(), cfg });
    core.queueSave("cfg", { v: STORE_VERSION, ...cfg });
  };
  return {
    setRules: (patch) => updateCfg({ rules: { ...core.getState().cfg.rules, ...patch } }),
    setDef: (key, patch) => updateCfg({ defs: { ...core.getState().cfg.defs, [key]: { ...core.getState().cfg.defs[key], ...patch } } }),
    setDefs: (defs) => updateCfg({ defs: { ...defs } }),
    setRepos: (repos) => updateCfg({
      repos: repos.map((r) => ({
        slug: r.slug,
        enabled: r.enabled !== false,
        ...r.available === void 0 ? {} : { available: r.available }
      }))
    }),
    setExtraAccounts: (list) => updateCfg({ extraAccounts: [...list] }),
    resetConfig: () => updateCfg(defaultConfig(core.getState().cfg.repos))
  };
}
function collectPrs(state, withMarks) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const repo of state.cfg.repos) {
    const snap = state.snapshots[repo.slug];
    if (!snap) continue;
    for (const pr of snap.prs) {
      if (seen.has(pr.key)) continue;
      seen.add(pr.key);
      out.push(withMarks(pr));
    }
  }
  return out;
}
function createDataApi(core) {
  const withMarks = (pr) => {
    const marks = core.getState().local.marks[pr.key] || [];
    if (!marks.length) return pr;
    return { ...pr, events: [...pr.events, ...marks].sort(openedFirst) };
  };
  const findPr = (prKey) => {
    for (const snap of Object.values(core.getState().snapshots)) {
      const pr = snap.prs.find((p) => p.key === prKey);
      if (pr) return withMarks(pr);
    }
    return null;
  };
  return {
    prWithMarks: withMarks,
    allPrs: () => collectPrs(core.getState(), withMarks),
    findPr,
    setSnapshot: (slug, snap) => {
      const trimmed = trimSnapshot(snap, core.now());
      const snapshots = { ...core.getState().snapshots, [slug]: trimmed };
      core.commit({ ...core.getState(), snapshots });
      core.queueSave(`snap:${slug}`, { v: STORE_VERSION, ...trimmed });
    },
    setRuntime: (patch) => core.commit({ ...core.getState(), runtime: { ...core.getState().runtime, ...patch } }),
    setUi: (patch) => core.commit({ ...core.getState(), ui: { ...core.getState().ui, ...patch } })
  };
}
function createLocalApi(core) {
  const updateLocal = (patch) => {
    const local = { ...core.getState().local, ...patch };
    core.commit({ ...core.getState(), local });
    core.queueSave("local", { v: STORE_VERSION, ...local });
  };
  const addMark = (prKey, mark) => {
    const current = core.getState().local.marks[prKey] || [];
    updateLocal({ marks: { ...core.getState().local.marks, [prKey]: [...current, { type: "mark", ...mark }] } });
  };
  const unmarkLast = (prKey) => {
    const current = core.getState().local.marks[prKey] || [];
    if (!current.length) return;
    const next = current.slice(0, -1);
    const marks = { ...core.getState().local.marks };
    if (next.length) marks[prKey] = next;
    else delete marks[prKey];
    updateLocal({ marks });
  };
  const setOrder = (colKey, ids) => updateLocal({ order: { ...core.getState().local.order, [colKey]: [...ids] } });
  return { addMark, unmarkLast, setOrder, updateLocal };
}
function createBindingApi(core, data, local) {
  const markReviewing = (prKey, at) => local.updateLocal({
    reviewing: { ...core.getState().local.reviewing, [prKey]: at }
  });
  const clearReviewing = (prKey) => {
    const reviewing = { ...core.getState().local.reviewing };
    delete reviewing[prKey];
    local.updateLocal({ reviewing });
  };
  const bind = (prKey, workspaceId) => {
    const bindings = Object.fromEntries(
      Object.entries(core.getState().local.bindings).filter(([, id]) => id !== workspaceId)
    );
    bindings[prKey] = workspaceId;
    local.updateLocal({ bindings });
  };
  const unbind = (prKey) => {
    const bindings = { ...core.getState().local.bindings };
    delete bindings[prKey];
    local.updateLocal({ bindings });
  };
  const pruneBindings = (workspaceIds) => {
    const bindings = Object.fromEntries(
      Object.entries(core.getState().local.bindings).filter(([, id]) => workspaceIds.has(id))
    );
    if (Object.keys(bindings).length !== Object.keys(core.getState().local.bindings).length) {
      local.updateLocal({ bindings });
    }
  };
  const toggleIgnore = (prKey) => {
    const ignored = core.getState().local.ignored;
    local.updateLocal({
      ignored: ignored.includes(prKey) ? ignored.filter((k) => k !== prKey) : [...ignored, prKey]
    });
  };
  const applyDropLocal = (prKey, toCol, ids, at) => {
    const pr = data.findPr(prKey);
    if (!pr) return { ok: false, reason: "PR \u4E0D\u5728\u5F53\u524D\u540C\u6B65\u5FEB\u7167\u91CC\uFF0C\u8BF7\u5148\u540C\u6B65" };
    const result = applyDrop(pr, core.getState().cfg.rules, toCol, ids, at);
    if (!result.ok) return result;
    if (result.reorder) {
      local.setOrder(toCol, ids);
      return result;
    }
    const marks = result.events.filter((e) => e.type === "mark");
    const nextMarks = { ...core.getState().local.marks };
    if (marks.length) nextMarks[prKey] = marks;
    else delete nextMarks[prKey];
    local.updateLocal({ marks: nextMarks, order: { ...core.getState().local.order, [toCol]: [...ids] } });
    return result;
  };
  return { bind, unbind, pruneBindings, toggleIgnore, applyDropLocal, markReviewing, clearReviewing };
}
function createStore({
  load = async () => null,
  save = async () => {
  },
  now = () => Date.now(),
  debounceMs = 400,
  schedule = setTimeout,
  cancel = clearTimeout
} = {}) {
  const core = createCore({ load, save, now, debounceMs, schedule, cancel });
  const config = createConfigApi(core);
  const data = createDataApi(core);
  const local = createLocalApi(core);
  const bindings = createBindingApi(core, data, local);
  const restoreLocal = (partial) => local.updateLocal({ marks: partial.marks || {}, order: partial.order || {} });
  const clearLocal = () => local.updateLocal(LOCAL_EMPTY());
  return {
    getSnapshot: core.getState,
    subscribe: core.subscribe,
    init: () => loadState(core),
    flush: core.flush,
    ...config,
    ...data,
    ...local,
    ...bindings,
    restoreLocal,
    clearLocal
  };
}

// src/domain/stats.js
var pad2 = (n) => String(n).padStart(2, "0");
function dayStart(now, cutoffH = 0) {
  const d = new Date(now);
  d.setHours(cutoffH, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}
function dateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function counts(rows, { defs, rules, now, excluded = 0, statusOrder = STATUS_ORDER }) {
  const live = rows.filter((r) => !r.pr.ignored);
  const byStatus = {};
  for (const key of statusOrder) byStatus[key] = 0;
  for (const r of live) byStatus[r.d.key] = (byStatus[r.d.key] || 0) + 1;
  const ownerOf = (r) => defs[r.d.key].owner;
  const today = dayStart(now, rules.dayCutoff);
  return {
    ...byStatus,
    all: live.length,
    mine: live.filter((r) => ownerOf(r) === "me").length,
    author: live.filter((r) => ownerOf(r) === "author").length,
    merge: live.filter((r) => ownerOf(r) === "merge").length,
    active: live.filter((r) => ownerOf(r) !== "done").length,
    done: live.filter((r) => ownerOf(r) === "done").length,
    today: live.filter((r) => r.pr.createdAt >= today).length,
    mergedToday: live.filter((r) => r.d.key === "merged" && r.d.since >= today).length,
    overdue: live.filter((r) => r.f.overdue).length,
    silent: live.filter((r) => r.f.silent).length,
    ignored: rows.length - live.length,
    excluded
  };
}
function flowForPr(pr, rules, start, s) {
  let seen = 0;
  let waiting = false;
  for (const e of pr.events || []) {
    const isToday = e.at >= start;
    if (e.type === "opened") {
      if (isToday) {
        s.opened += 1;
        const key = pr.repoSlug || pr.repo;
        s.byRepo[key] = (s.byRepo[key] || 0) + 1;
        if (e.draft || pr.isDraft) s.drafts += 1;
      }
      continue;
    }
    if (isToday && e.type === "merged") s.merged += 1;
    if (isToday && e.type === "closed") s.closed += 1;
    if (e.type === "mark" && e.verdict === "reset") {
      waiting = false;
      continue;
    }
    const verdict = verdictOf(e, rules);
    if (verdict) {
      if (isToday) {
        s[seen ? "re" : "first"] += 1;
        s[verdict === "changes" ? "changes" : "approve"] += 1;
      }
      seen += 1;
      waiting = verdict === "changes";
      continue;
    }
    if (waiting && isAuthorFix(e, rules)) {
      if (isToday) s.fixed += 1;
      waiting = false;
    }
  }
}
function todayFlow(prs, rules, now) {
  const start = dayStart(now, rules.dayCutoff);
  const s = { opened: 0, drafts: 0, first: 0, re: 0, changes: 0, approve: 0, fixed: 0, merged: 0, closed: 0, byRepo: {} };
  for (const pr of prs) flowForPr(pr, rules, start, s);
  return s;
}
function isAuthorFix(e, rules) {
  if (e.type === "commit") return !(rules.ignoreMergeBase && e.merge);
  if (e.type === "rerequest") return rules.rerequest;
  if (e.type === "comment" && e.isAuthor) return rules.authorReply;
  return e.type === "mark" && e.verdict === "fixed";
}
function dailySeries(snapshots, repoList, rules, now, days = 14) {
  const series = repoList.filter((r) => r.enabled).map((r) => ({
    slug: r.slug,
    colorIndex: repoList.findIndex((x) => x.slug === r.slug)
  }));
  const anchor = new Date(dayStart(now, rules.dayCutoff));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(anchor);
    d.setDate(d.getDate() - i);
    const at = d.getTime();
    const key = dateKey(at);
    out.push({
      at,
      key,
      vals: series.map((r) => Number(snapshots[r.slug]?.daily?.[key] || 0))
    });
  }
  return { series, days: out };
}
function selectRows(prs, { rules, meSet, repoFilter = "all", reposEnabled = {}, showIgnored = false, wts = [], bindings = {}, reviewingSince = {}, now }) {
  return prs.filter((pr) => reposEnabled[pr.repoSlug] !== false).filter(
    (pr) => repoFilter === "all" ? true : Array.isArray(repoFilter) ? repoFilter.includes(pr.repoSlug) : pr.repoSlug === repoFilter
  ).filter((pr) => isTracked(pr, rules, meSet)).filter((pr) => showIgnored || !pr.ignored).map((pr) => {
    const hasWorktree = wts.some(
      (wt) => linkPr(wt, { prs, bindings, rules })?.key === pr.key
    );
    const d = reviewingState(derive(pr, rules), hasWorktree, reviewingSince[pr.key]);
    return { pr, d, f: flags(d, rules, now) };
  }).filter(({ d }) => rules.includeDraft || d.key !== "draft");
}
function flowByDay(prs, rules, now, days = 14) {
  const anchor = new Date(dayStart(now, rules.dayCutoff));
  const keys = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(anchor);
    d.setDate(d.getDate() - i);
    keys.push(dateKey(d.getTime()));
  }
  const map = Object.fromEntries(keys.map((k) => [k, { reviews: 0, fixed: 0, merged: 0 }]));
  for (const pr of prs) {
    let waiting = false;
    for (const e of pr.events || []) {
      const key = dateKey(dayStart(e.at, rules.dayCutoff));
      const bucket = map[key];
      if (e.type === "mark" && e.verdict === "reset") {
        waiting = false;
        continue;
      }
      const verdict = verdictOf(e, rules);
      if (verdict) {
        if (bucket) bucket.reviews += 1;
        waiting = verdict === "changes";
        continue;
      }
      if (waiting && isAuthorFix(e, rules)) {
        if (bucket) bucket.fixed += 1;
        waiting = false;
        continue;
      }
      if (e.type === "merged" && bucket) bucket.merged += 1;
    }
  }
  return keys.map((key) => ({ key, ...map[key] }));
}

// src/gh/normalize.js
var lower = (value) => String(value || "").toLowerCase();
function parseListRow(row, { owner, repo }) {
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
    isCrossRepository
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
    state: "OPEN"
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
    comments: Number(comments) || 0
  }));
}
function mapCommits(detail) {
  return (detail.c || []).map(([sha, committedDate, parents]) => ({
    type: "commit",
    at: Date.parse(committedDate),
    sha: sha || "",
    merge: Number(parents) >= 2
  })).sort((a, b) => a.at - b.at);
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
        isAuthor: !!actor && actor === pr.author
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
function mergeDetail(pr, detail, { meSet }) {
  const reviews = mapReviews(detail || {}, meSet);
  const commits = mapCommits(detail || {});
  const { events: timeline, requested } = mapTimeline(detail || {}, { meSet, pr, reviews });
  const opened = {
    type: "opened",
    at: pr.createdAt,
    sha: commits[0]?.sha || pr.headSha,
    draft: draftAtCreation(pr, timeline)
  };
  return {
    ...pr,
    requested: pr.requested || requested,
    commitShas: commits.map((c) => c.sha),
    events: sortEvents([opened, ...commits, ...reviews, ...timeline])
  };
}
function normalizeEndedRow(row, { owner, repo }) {
  const mergedAt = row.mergedAt ? Date.parse(row.mergedAt) : null;
  const closedAt = row.closedAt ? Date.parse(row.closedAt) : null;
  const number = row.number;
  const events = [
    {
      type: "opened",
      at: Date.parse(row.createdAt),
      sha: "",
      draft: false
    }
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
    state: mergedAt ? "MERGED" : "CLOSED"
  };
}
function endedRowFromStateRow(row) {
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
    closedAt: closedAt || null
  };
}
function endedRowFromArray(row) {
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
    closedAt: closedAt || null
  };
}
function createdRowFromArray(row) {
  const [number, createdAt, isDraft, author] = row;
  return { number, createdAt, isDraft, author: { login: author || "" } };
}
function dailyCounts(rows, cutoff) {
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

// src/gh/queries.js
var VIEWER_ARGS = ["api", "user", "--jq", ".login"];
var LIST_QUERY = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(states:OPEN, first:50, after:$after, orderBy:{field:UPDATED_AT,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number title url isDraft createdAt updatedAt additions deletions
        author{login} headRefName headRefOid baseRefName isCrossRepository
      }
    }
  }
}`;
var LIST_JQ = ".data.repository.pullRequests | {page:.pageInfo, prs:[.nodes[]|[.number,.title,.url,.isDraft,.createdAt,.updatedAt,.additions,.deletions,.author.login,.headRefName,.headRefOid,.baseRefName,.isCrossRepository]]}";
var DETAIL_NODE = `reviews(last:50){nodes{author{login} state submittedAt commit{oid} comments{totalCount}}}
  commits(last:60){nodes{commit{oid committedDate parents{totalCount}}}}
  timelineItems(last:80, itemTypes:[READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, REVIEW_REQUESTED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, ISSUE_COMMENT]){
    nodes{
      __typename
      ... on ReadyForReviewEvent{createdAt}
      ... on ConvertToDraftEvent{createdAt}
      ... on ReviewRequestedEvent{createdAt actor{login} requestedReviewer{... on User{login}}}
      ... on HeadRefForcePushedEvent{createdAt afterCommit{oid}}
      ... on IssueComment{createdAt author{login}}
    }
  }`;
var DETAIL_JQ = '[.data.repository|to_entries[]|select(.value != null)|{k:.key, r:[(.value.reviews.nodes // [])[]|[.author.login,.state,.submittedAt,(.commit.oid // ""),.comments.totalCount]], c:[(.value.commits.nodes // [])[]|[.commit.oid,.commit.committedDate,.commit.parents.totalCount]], t:[(.value.timelineItems.nodes // [])[]|[.__typename,.createdAt,(.actor.login // .author.login // ""),(.requestedReviewer.login // ""),(.afterCommit.oid // "")]]}]';
function splitSlug(slug) {
  const [owner, name] = String(slug).split("/");
  if (!owner || !name) throw new Error(`\u65E0\u6548\u7684\u4ED3\u5E93\u6807\u8BC6\uFF1A${slug}`);
  return { owner, name };
}
function listArgs(slug, after) {
  const { owner, name } = splitSlug(slug);
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${LIST_QUERY}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`
  ];
  if (after) args.push("-f", `after=${after}`);
  args.push("--jq", LIST_JQ);
  return args;
}
var PR_BY_NUMBER_JQ = ".data.repository.pullRequest | if . == null then [] else [[.number,.title,.url,.isDraft,.createdAt,.updatedAt,.additions,.deletions,.author.login,.headRefName,.headRefOid,.baseRefName,.isCrossRepository,.state,.mergedAt,.closedAt]] end";
function prByNumberArgs(slug, number) {
  const { owner, name } = splitSlug(slug);
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`\u65E0\u6548\u7684 PR \u7F16\u53F7\uFF1A${number}`);
  const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequest(number: ${n}){
    number title url isDraft createdAt updatedAt additions deletions
    author{login} headRefName headRefOid baseRefName isCrossRepository
    state mergedAt closedAt
  }}}`;
  return [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "--jq",
    PR_BY_NUMBER_JQ
  ];
}
function detailQuery(numbers) {
  const aliases = numbers.map((n, i) => `p${i}: pullRequest(number: ${Number(n)}){${DETAIL_NODE}}`).join("\n");
  return `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
${aliases}
}}`;
}
function detailArgs(slug, numbers) {
  const { owner, name } = splitSlug(slug);
  return [
    "api",
    "graphql",
    "-f",
    `query=${detailQuery(numbers)}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "--jq",
    DETAIL_JQ
  ];
}
var CREATED_JQ = "[.[]|[.number,.createdAt,.isDraft,.author.login]]";
var ENDED_JQ = "[.[]|[.number,.title,.url,.createdAt,.updatedAt,.isDraft,.author.login,.headRefName,.baseRefName,.mergedAt,.closedAt]]";
function createdArgs(slug, since) {
  return prListArgs(slug, {
    state: "all",
    search: `created:>=${since}`,
    limit: 300,
    fields: ["number", "createdAt", "isDraft", "author"],
    jq: CREATED_JQ
  });
}
function mergedArgs(slug, since) {
  return prListArgs(slug, {
    state: "merged",
    search: `merged:>=${since}`,
    limit: 100,
    fields: ["number", "title", "url", "createdAt", "updatedAt", "isDraft", "author", "headRefName", "baseRefName", "mergedAt", "closedAt"],
    jq: ENDED_JQ
  });
}
function closedArgs(slug, since) {
  return prListArgs(slug, {
    state: "closed",
    search: `closed:>=${since}`,
    limit: 100,
    fields: ["number", "title", "url", "createdAt", "updatedAt", "isDraft", "author", "headRefName", "baseRefName", "mergedAt", "closedAt"],
    jq: ENDED_JQ
  });
}
function prListArgs(slug, { state, search, limit, fields, jq }) {
  const args = [
    "pr",
    "list",
    "-R",
    slug,
    "--state",
    state,
    "--search",
    search,
    "--limit",
    String(limit),
    "--json",
    fields.join(",")
  ];
  if (jq) args.push("--jq", jq);
  return args;
}

// src/sync.js
var MAX_PAGES = Math.ceil(MAX_OPEN_PRS / 50);
function clampInterval(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(MIN_INTERVAL_MINUTES, Math.round(n));
}
function sinceDate(nowMs, days) {
  return new Date(nowMs - days * DAY).toISOString().slice(0, 10);
}
function needsDetail(pr, prevPr) {
  if (!prevPr) return true;
  if (pr.headSha !== prevPr.headSha) return true;
  if (pr.updatedAt !== prevPr.updatedAt) return true;
  if (!prevPr.commitShas?.length) return true;
  return false;
}
function ensureOpened(pr) {
  if (pr.events?.length) return pr;
  return {
    ...pr,
    events: [{ type: "opened", at: pr.createdAt, sha: pr.headSha, draft: pr.isDraft }]
  };
}
function reuseDetail(pr, prevPr) {
  if (!prevPr?.events?.length) return ensureOpened(pr);
  return {
    ...pr,
    events: prevPr.events,
    commitShas: prevPr.commitShas || [],
    requested: prevPr.requested || false
  };
}
async function fetchOpenPrs(slug, { exec, prev, rules, meSet }) {
  const rows = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await exec.runGh(listArgs(slug, after));
    const data = JSON.parse(result.stdout);
    rows.push(...data.prs || []);
    if (!data.page?.hasNextPage || rows.length >= MAX_OPEN_PRS) break;
    after = data.page.endCursor;
  }
  const prs = rows.slice(0, MAX_OPEN_PRS).map((row) => {
    const [owner, repo] = slug.split("/");
    return parseListRow(row, { owner, repo });
  });
  const prevByNumber = new Map((prev?.prs || []).map((p) => [p.number, p]));
  const wanted = prs.filter((pr) => needsDetail(pr, prevByNumber.get(pr.number)));
  const details = await loadDetails(
    slug,
    wanted.map((pr) => pr.number),
    exec,
    meSet
  );
  return prs.map((pr) => {
    const detail = details.get(pr.number);
    if (detail) return mergeDetail(pr, detail, { meSet });
    return reuseDetail(pr, prevByNumber.get(pr.number));
  });
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
async function loadDetails(slug, numbers, exec, meSet) {
  const out = /* @__PURE__ */ new Map();
  const chunks = [];
  for (let i = 0; i < numbers.length; i += DETAIL_BATCH) {
    chunks.push(numbers.slice(i, i + DETAIL_BATCH));
  }
  await mapLimit(chunks, 2, async (chunk) => {
    try {
      const result = await exec.runGh(detailArgs(slug, chunk));
      for (const item of JSON.parse(result.stdout)) {
        const index = Number(String(item.k || "").replace(/\D/g, ""));
        if (Number.isInteger(index) && chunk[index] != null) out.set(chunk[index], item);
      }
    } catch {
      await mapLimit(chunk, 2, async (number) => {
        try {
          const result = await exec.runGh(detailArgs(slug, [number]));
          const item = JSON.parse(result.stdout)?.[0];
          if (item) out.set(number, item);
        } catch {
        }
      });
    }
  });
  void meSet;
  return out;
}
function parseRows(stdout) {
  try {
    const data = JSON.parse(stdout || "[]");
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
async function fetchEnded(slug, { exec, rules, nowMs, openKeys, prev }) {
  const since = sinceDate(nowMs, Math.max(1, Number(rules.endedDays) || 7));
  const [owner, repo] = slug.split("/");
  const mergedRows = parseRows((await exec.runGh(mergedArgs(slug, since))).stdout);
  const closedRows = parseRows((await exec.runGh(closedArgs(slug, since))).stdout);
  if (!mergedRows || !closedRows) {
    return (prev?.prs || []).filter((pr) => pr.state !== "OPEN");
  }
  const rows = [
    ...mergedRows.map(endedRowFromArray),
    ...closedRows.map(endedRowFromArray).filter((row) => !row.mergedAt)
  ];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const row of rows) {
    const pr = normalizeEndedRow(row, { owner, repo });
    if (seen.has(pr.key) || openKeys.has(pr.key)) continue;
    seen.add(pr.key);
    out.push(pr);
  }
  return out;
}
function terminalAt(pr) {
  const terminal = (pr.events || []).find((e) => e.type === "merged" || e.type === "closed");
  return terminal?.at || 0;
}
function mergeByKey(lists) {
  const map = /* @__PURE__ */ new Map();
  for (const list of lists) for (const pr of list) map.set(pr.key, pr);
  return [...map.values()];
}
async function fetchPrByNumber(slug, number, { exec, meSet = /* @__PURE__ */ new Set() }) {
  const result = await exec.runGh(prByNumberArgs(slug, number));
  const rows = parseRows(result.stdout);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  const [owner, repo] = slug.split("/");
  const state = row[13];
  if (state === "MERGED" || state === "CLOSED") {
    return normalizeEndedRow(endedRowFromStateRow(row), { owner, repo });
  }
  if (state !== "OPEN") return null;
  const pr = parseListRow(row.slice(0, 13), { owner, repo });
  const details = await loadDetails(slug, [pr.number], exec, meSet);
  const detail = details.get(pr.number);
  return detail ? mergeDetail(pr, detail, { meSet }) : ensureOpened(pr);
}
var AUX_TTL_MS = 30 * 6e4;
async function fetchRepo(slug, { exec, prev, rules, nowMs, meSet = /* @__PURE__ */ new Set() }) {
  const open = await fetchOpenPrs(slug, { exec, prev, rules, meSet });
  const openKeys = new Set(open.map((pr) => pr.key));
  const vanishedPrev = (prev?.prs || []).filter((pr) => pr.state === "OPEN" && !openKeys.has(pr.key));
  const resolved = await mapLimit(vanishedPrev, 2, async (pr) => {
    try {
      return await fetchPrByNumber(slug, pr.number, { exec, meSet }) || pr;
    } catch {
      return pr;
    }
  });
  const stillOpen = resolved.filter((pr) => pr.state === "OPEN");
  const resolvedEnded = resolved.filter((pr) => pr.state !== "OPEN");
  const since = sinceDate(nowMs, Math.max(1, Number(rules.endedDays) || 7));
  const sinceMs = Date.parse(`${since}T00:00:00Z`);
  const carry = (prev?.prs || []).filter(
    (pr) => pr.state !== "OPEN" && !openKeys.has(pr.key) && terminalAt(pr) >= sinceMs
  );
  const needsAux = !prev?.auxAt || nowMs - prev.auxAt >= AUX_TTL_MS;
  if (!needsAux) {
    return {
      ...prev,
      syncedAt: nowMs,
      prs: mergeByKey([carry, resolvedEnded, stillOpen, open]),
      daily: prev.daily || {},
      auxAt: prev.auxAt
    };
  }
  const ended = await fetchEnded(slug, { exec, rules, nowMs, openKeys, prev });
  const createdRows = parseRows((await exec.runGh(createdArgs(slug, sinceDate(nowMs, 14)))).stdout);
  const daily = createdRows ? dailyCounts(createdRows.map(createdRowFromArray), rules.dayCutoff) : prev?.daily || {};
  return {
    syncedAt: nowMs,
    auxAt: nowMs,
    prs: mergeByKey([carry, resolvedEnded, ended, stillOpen, open]),
    daily
  };
}
async function fetchViewerLogin(exec) {
  const result = await exec.runGh(VIEWER_ARGS);
  const login = String(result.stdout || "").trim().toLowerCase();
  if (!login) throw new Error("gh api user \u6CA1\u6709\u8FD4\u56DE\u767B\u5F55\u8D26\u53F7");
  return login;
}
async function runSyncPass({ exec, store, now, viewer, repos }) {
  const before = store.getSnapshot();
  const enabled = (repos || before.cfg.repos).filter(
    (r) => r.enabled !== false && r.available !== false
  );
  const startedAt = now();
  store.setRuntime({
    syncing: true,
    syncStartedAt: startedAt,
    progress: { done: 0, total: enabled.length }
  });
  let login = before.runtime.ghLogin;
  let ghError = null;
  if (!login) {
    try {
      login = await viewer(exec);
    } catch (error) {
      ghError = describeGhError(error);
    }
  }
  const errors = { ...before.runtime.errors || {} };
  let lastSync = before.runtime.lastSync;
  let doneRepos = 0;
  await mapLimit(enabled, 2, async (repo) => {
    try {
      const ruleSet = store.getSnapshot().cfg.rules;
      const snap = await fetchRepo(repo.slug, {
        exec,
        prev: store.getSnapshot().snapshots[repo.slug],
        rules: ruleSet,
        nowMs: now(),
        meSet: new Set(
          [login, ...store.getSnapshot().cfg.extraAccounts.map((a) => String(a).toLowerCase())].filter(Boolean)
        )
      });
      store.setSnapshot(repo.slug, snap);
      delete errors[repo.slug];
      lastSync = snap.syncedAt;
    } catch (error) {
      errors[repo.slug] = describeGhError(error);
    } finally {
      doneRepos += 1;
      store.setRuntime({ progress: { done: doneRepos, total: enabled.length } });
    }
  });
  store.setRuntime({
    syncing: false,
    errors,
    lastSync,
    ghLogin: login,
    ghError,
    progress: { done: enabled.length, total: enabled.length },
    calls: exec.stats?.calls ?? 0
  });
  return { errors, login };
}
function createSync({ exec, store, now = Date.now, viewer = fetchViewerLogin, onAfter }) {
  let running = null;
  async function run(repos) {
    if (running) return running;
    running = runSyncPass({ exec, store, now, viewer, repos }).finally(() => {
      running = null;
      if (onAfter) onAfter();
    });
    return running;
  }
  const meSetOf = (state) => new Set(
    [state.runtime.ghLogin, ...state.cfg.extraAccounts].filter(Boolean).map((v) => String(v).toLowerCase())
  );
  function findSnapshotPr(prKey) {
    for (const [slug, snap] of Object.entries(store.getSnapshot().snapshots)) {
      const pr = snap.prs.find((p) => p.key === prKey);
      if (pr) return { slug, pr };
    }
    return null;
  }
  async function refreshPr(prKey) {
    if (running) await running.catch(() => void 0);
    const hit = findSnapshotPr(prKey);
    if (!hit) return null;
    const updated = await fetchPrByNumber(hit.slug, hit.pr.number, {
      exec,
      meSet: meSetOf(store.getSnapshot())
    });
    if (!updated) return null;
    const snap = store.getSnapshot().snapshots[hit.slug];
    if (!snap) return null;
    store.setSnapshot(hit.slug, {
      ...snap,
      prs: mergeByKey([snap.prs.filter((pr) => pr.key !== prKey), [updated]])
    });
    if (onAfter) onAfter();
    return updated;
  }
  return { run, refreshPr };
}
function createSchedulerApi(box, { run, now, isForeground, setTimer, clearTimer }) {
  const clear = () => {
    if (box.timer) clearTimer(box.timer);
    box.timer = null;
  };
  const schedule = () => {
    clear();
    if (box.stopped || box.interval <= 0) return;
    box.timer = setTimer(tick, box.interval * 6e4);
  };
  async function tick() {
    box.timer = null;
    if (box.stopped) return;
    if (!isForeground()) {
      schedule();
      return;
    }
    box.lastRun = now();
    try {
      await run();
    } finally {
      schedule();
    }
  }
  const start = (minutes) => {
    box.stopped = false;
    box.interval = clampInterval(minutes);
    schedule();
  };
  const stop = () => {
    box.stopped = true;
    clear();
  };
  const isDue = () => box.interval > 0 && now() - box.lastRun >= box.interval * 6e4;
  const wake = () => {
    if (box.stopped || box.timer || !isDue()) return;
    void tick();
  };
  return { start, stop, wake, isDue, getInterval: () => box.interval };
}
function createScheduler({
  run,
  now = Date.now,
  isForeground = () => true,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  const box = { timer: null, interval: 0, lastRun: 0, stopped: true };
  return createSchedulerApi(box, { run, now, isForeground, setTimer, clearTimer });
}

// src/repos.js
var HOST = /(?:^|@|\/\/)github\.com[:/](.+)$/i;
function parseGitHubRemote(raw) {
  const url = String(raw || "").trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!url) return null;
  const match = HOST.exec(url);
  if (!match) return null;
  const parts = match[1].split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const NAME = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
  if (!NAME.test(parts[0]) || !NAME.test(parts[1])) return null;
  return { owner: parts[0], repo: parts[1], slug: `${parts[0]}/${parts[1]}` };
}
async function remoteUrl(runGit, path, remote) {
  try {
    const result = await runGit(["-C", path, "remote", "get-url", remote]);
    return String(result?.stdout || "").trim();
  } catch {
    return "";
  }
}
async function resolveWorkspaceRepos(workspaces, { runGit }) {
  const repos = [];
  const seen = /* @__PURE__ */ new Set();
  for (const ws of workspaces || []) {
    if (ws.kind === "worktree") continue;
    let parsed = null;
    for (const remote of ["origin", "upstream"]) {
      parsed = parseGitHubRemote(await remoteUrl(runGit, ws.path, remote));
      if (parsed) break;
    }
    if (!parsed || seen.has(parsed.slug)) continue;
    seen.add(parsed.slug);
    repos.push({
      workspaceId: ws.id,
      path: ws.path,
      name: ws.name,
      owner: parsed.owner,
      repo: parsed.repo,
      slug: parsed.slug
    });
  }
  return repos;
}
function mapWorktrees(workspaces, repoByWorkspaceId) {
  return (workspaces || []).filter((ws) => ws.kind === "worktree").map((ws) => {
    const repo = repoByWorkspaceId.get(ws.parentId);
    if (!repo) return null;
    return {
      workspaceId: ws.id,
      parentWorkspaceId: ws.parentId,
      path: ws.path,
      name: ws.name,
      repo: repo.slug,
      branch: ws.worktree?.branch || "",
      prNumber: ws.worktree?.prNumber ?? null,
      creating: false
    };
  }).filter(Boolean);
}

// src/workspaces.js
function mergeRepoList(existing, discovered) {
  const found = new Set(discovered.map((d) => d.slug));
  const kept = (existing || []).map((item) => ({ ...item, available: found.has(item.slug) }));
  const known = new Set(kept.map((item) => item.slug));
  const added = discovered.filter((d) => !known.has(d.slug)).map((d) => ({ slug: d.slug, enabled: true, available: true }));
  return [...kept, ...added];
}
function createWorkspaceIndex({ ctx, exec, store, onUpdate }) {
  let snapshot = { repos: [], worktrees: [], loading: false, error: null };
  const listeners = /* @__PURE__ */ new Set();
  const getSnapshot = () => snapshot;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function set(next) {
    snapshot = next;
    for (const listener of listeners) listener();
    if (onUpdate) onUpdate(snapshot);
  }
  async function refresh() {
    set({ ...snapshot, loading: true, error: null });
    try {
      const rows = await ctx.workspaces.list();
      const repos = await resolveWorkspaceRepos(rows, {
        runGit: (args) => exec.runGit(args)
      });
      const byWorkspace = new Map(repos.map((r) => [r.workspaceId, r]));
      const worktrees = mapWorktrees(rows, byWorkspace);
      set({ repos, worktrees, loading: false, error: null });
      if (rows.length > 0) {
        store.setRepos(mergeRepoList(store.getSnapshot().cfg.repos, repos));
        store.pruneBindings(new Set(worktrees.map((w) => w.workspaceId)));
      }
      return snapshot;
    } catch (error) {
      set({ ...snapshot, loading: false, error: error?.message || String(error) });
      return snapshot;
    }
  }
  return { getSnapshot, subscribe, refresh };
}

// src/ui/react.js
var React = null;
function bindReact(instance) {
  React = instance;
}

// src/ui/common.js
var h = (...args) => React.createElement(...args);
var cx = (...parts) => parts.filter(Boolean).join(" ");
var PATHS = {
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  grip: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  board: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
};
function Icon({ name, size = 14, className }) {
  return h("svg", {
    className,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    dangerouslySetInnerHTML: { __html: PATHS[name] || "" }
  });
}
function Avatar({ name = "?" }) {
  return h(
    "span",
    { className: "ght-av", title: name },
    String(name)[0] ? String(name)[0].toUpperCase() : "?"
  );
}
var repoColor = (index) => `var(--ght-repo-${Number(index) % 8 + 1})`;
var toneColor = (tone) => tone === "neutral" ? "var(--color-text-tertiary, #a3a3a3)" : `var(--color-status-${tone}-text, #3b82f6)`;
function RepoDot({ index, color }) {
  return h("i", { className: "ght-rd", style: { background: color || repoColor(index) } });
}
function Chip({ tone, children, small }) {
  return h("span", { className: cx("ght-chip", `ght-tone-${tone || "neutral"}`, small && "ght-chip-sm") }, children);
}
function Tag({ kind = "mute", children }) {
  return h("span", { className: `ght-tag ght-tag-${kind}` }, children);
}
function useStore(store) {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot);
}
function useNow(intervalMs = 6e4) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
function useEscape(handler, active = true) {
  React.useEffect(() => {
    if (!active) return void 0;
    const onKey = (event) => {
      if (event.key === "Escape") handler();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handler, active]);
}

// src/ui/Chart.js
var sum = (xs) => xs.reduce((a, b) => a + b, 0);
function Tooltip({ tip }) {
  if (!tip) return null;
  return h(
    "div",
    { className: "ght-tip", style: { left: tip.x, top: tip.y } },
    h("div", { className: "ght-tip-h" }, tip.title),
    tip.rows.map(
      (row) => h(
        "div",
        { className: "ght-tip-r", key: row.key },
        h("i", { style: { background: row.color } }),
        h("span", { className: "ght-tip-name", title: row.label }, row.label),
        h("b", null, row.value)
      )
    )
  );
}
function ChartColumns({ days, series, totals, top, last, peak, onTip, onLeave }) {
  return h(
    "div",
    { className: "ght-cols" },
    days.map((day, index) => {
      const total = totals[index];
      const isToday = index === last;
      const label = (isToday || index === peak) && total ? h("b", null, total) : null;
      return h(
        "div",
        {
          key: day.key,
          className: "ght-col",
          onMouseEnter: (event) => onTip(event, index),
          onMouseLeave: onLeave
        },
        h(
          "div",
          { className: "ght-stack", style: { height: `${Math.min(100, total / top * 100)}%` } },
          label,
          series.map(
            (repo, i) => day.vals[i] ? h("i", {
              key: repo.slug,
              className: "ght-bar",
              style: { flex: `${day.vals[i]} 1 0`, background: repoColor(repo.colorIndex) }
            }) : null
          )
        )
      );
    })
  );
}
function ChartAxis({ t, days, last }) {
  return h(
    "div",
    { className: "ght-x-axis" },
    days.map((day, index) => {
      const d = new Date(day.at);
      if (index === last) return h("span", { key: day.key, className: "ght-today" }, t("\u4ECA\u5929", "Today"));
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      return h(
        "span",
        { key: day.key, className: cx(weekend && "ght-we") },
        index === 0 ? `${d.getMonth() + 1}/` : "",
        d.getDate()
      );
    })
  );
}
function useChartTip({ t, days, series, totals }) {
  const [tip, setTip] = React.useState(null);
  const showTip = (event, index) => {
    const day = days[index];
    const rect = event.currentTarget.getBoundingClientRect();
    setTip({
      x: Math.max(8, Math.min(rect.left + rect.width / 2 - 90, window.innerWidth - 220)),
      y: rect.bottom + 8,
      title: `${dateLabel(day.at, t)} \xB7 ${t("\u65B0\u589E", "new")} ${totals[index]}`,
      rows: series.map((repo, i) => ({
        key: repo.slug,
        color: repoColor(repo.colorIndex),
        label: repo.slug,
        value: day.vals[i]
      }))
    });
  };
  return { tip, showTip, hideTip: () => setTip(null) };
}
function StackedChart({ t, series, days }) {
  const totals = days.map((d) => sum(d.vals));
  const top = Math.max(10, Math.ceil(Math.max(1, ...totals) / 10) * 10);
  const ticks = [0, top / 2, top];
  const past = totals.slice(0, -1);
  const peak = past.length ? past.indexOf(Math.max(...past)) : -1;
  const last = days.length - 1;
  const { tip, showTip, hideTip } = useChartTip({ t, days, series, totals });
  return h(
    "div",
    { className: "ght-chart-wrap" },
    h(
      "div",
      { className: "ght-chart" },
      h(
        "div",
        { className: "ght-y-axis" },
        ticks.map((tick) => h("span", { key: tick, style: { bottom: `${tick / top * 100}%` } }, tick))
      ),
      h(
        "div",
        { className: "ght-plot" },
        ticks.map(
          (tick, i) => h("i", {
            key: tick,
            className: cx("ght-grid", i === 0 && "ght-grid-base"),
            style: { bottom: `${tick / top * 100}%` }
          })
        ),
        h(ChartColumns, { days, series, totals, top, last, peak, onTip: showTip, onLeave: hideTip })
      ),
      h(ChartAxis, { t, days, last })
    ),
    h(Tooltip, { tip })
  );
}
function TableView({ t, series, days, flow }) {
  const flowByKey = Object.fromEntries(flow.map((row) => [row.key, row]));
  return h(
    "div",
    { className: "ght-tbl-wrap" },
    h(
      "table",
      { className: "ght-tbl" },
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", null, t("\u65E5\u671F", "Date")),
          series.map(
            (repo) => h(
              "th",
              { key: repo.slug },
              h(RepoDot, { index: repo.colorIndex }),
              repo.slug.split("/")[1] || repo.slug
            )
          ),
          h("th", null, t("\u65B0\u589E\u5408\u8BA1", "Total")),
          h("th", null, t("\u6211\u5BA1\u67E5", "Reviewed")),
          h("th", null, t("\u4F5C\u8005\u4FEE\u590D", "Fixed")),
          h("th", null, t("\u5408\u5E76", "Merged"))
        )
      ),
      h(
        "tbody",
        null,
        days.map((day, index) => {
          const f = flowByKey[day.key] || { reviews: 0, fixed: 0, merged: 0 };
          const isToday = index === days.length - 1;
          return h(
            "tr",
            { key: day.key, className: cx(isToday && "ght-today-row") },
            h("td", null, isToday ? t("\u4ECA\u5929", "Today") : dateLabel(day.at, t)),
            day.vals.map((value, i) => h("td", { key: series[i].slug }, value)),
            h("td", { className: "ght-sum" }, sum(day.vals)),
            h("td", null, f.reviews),
            h("td", null, f.fixed),
            h("td", null, f.merged)
          );
        })
      )
    )
  );
}
function DailyChart({ t, series, days, flow, rules, mode, onMode }) {
  return h(
    "section",
    { className: "ght-card" },
    h(
      "header",
      { className: "ght-card-h" },
      h("h3", null, t("\u6BCF\u65E5\u65B0\u589E PR", "New PRs per day")),
      h("span", { className: "ght-sub" }, t("\u8FD1 14 \u5929", "last 14 days")),
      series.length > 1 ? h(
        "div",
        { className: "ght-legend" },
        series.map(
          (repo) => h(
            "span",
            { key: repo.slug },
            h(RepoDot, { index: repo.colorIndex }),
            repo.slug.split("/")[1] || repo.slug
          )
        )
      ) : h("span", { className: "ght-sub" }, series[0]?.slug || ""),
      h("span", { className: "ght-sp" }),
      h(
        "div",
        { className: "ght-seg" },
        h("button", { type: "button", className: cx(mode === "chart" && "on"), onClick: () => onMode("chart") }, t("\u56FE", "Chart")),
        h("button", { type: "button", className: cx(mode === "table" && "on"), onClick: () => onMode("table") }, t("\u8868", "Table"))
      )
    ),
    mode === "chart" ? h(StackedChart, { t, series, days, rules }) : h(TableView, { t, series, days, flow })
  );
}

// src/ui/Board.js
var MARK_EN2 = {
  changes: "changes needed",
  approve: "looks good",
  reset: "withdraw verdict",
  fixed: "author fixed it",
  done: "mark done"
};
var COLUMN_DESC = {
  review: ["\u6CA1\u5BA1\u8FC7 / \u5BA1\u67E5\u4E2D / \u4F60\u64A4\u56DE\u4E86\u7ED3\u8BBA", "Not reviewed / reviewing / verdict withdrawn"],
  fix: ["\u4F60\u63D0\u4E86\u95EE\u9898\uFF0C\u7B49\u4F5C\u8005\u6539", "You raised issues; waiting on the author"],
  rereview: ["\u4F5C\u8005\u6539\u5B8C\u4E86\uFF0C\u7B49\u4F60\u518D\u770B", "Author updated; waiting on you"],
  approved: ["\u4F60\u5DF2\u901A\u8FC7\uFF0C\u7B49\u5408\u5E76", "You approved; waiting for merge"],
  ended: ["\u5DF2\u5408\u5E76 / \u5DF2\u5173\u95ED / \u4F60\u6807\u8BB0\u5B8C\u6210", "Merged / closed / marked done"]
};
function shortAge(d, now, t) {
  const days = Math.floor((now - d.since) / 864e5);
  return days <= 0 ? t("\u4ECA\u5929", "Today") : t(`${days} \u5929\u524D`, `${days}d ago`);
}
function WorktreeButton({ t, wt, pr, bindings, rules, onWorktree, onBind, ended }) {
  if (wt) {
    return h(
      "button",
      {
        type: "button",
        className: "ght-wt-link",
        title: `${linkSource(wt, pr, bindings)} \xB7 ${t("\u70B9\u51FB\u590D\u5236\u8DEF\u5F84", "click to copy path")}`,
        onClick: (event) => {
          event.stopPropagation();
          onWorktree(wt);
        }
      },
      h(Icon, { name: "branch", size: 12 }),
      wt.name
    );
  }
  if (ended) return null;
  return h(
    "button",
    {
      type: "button",
      className: "ght-ghost-btn",
      onClick: (event) => {
        event.stopPropagation();
        onBind(pr.key);
      }
    },
    h(Icon, { name: "link", size: 12 }),
    t("\u5173\u8054 worktree", "Link worktree")
  );
}
function CardTags({ t, d, f, pr }) {
  const tags = [
    f.overdue ? h(Tag, { key: "o", kind: "bad" }, t("\u8D85\u65F6", "Overdue")) : null,
    f.silent ? h(Tag, { key: "s", kind: "warn" }, t("\u4F5C\u8005\u6C89\u9ED8", "Author silent")) : null,
    d.reviews >= 2 ? h(Tag, { key: "r", kind: "mute" }, t(`\u7B2C ${d.reviews} \u8F6E`, `Round ${d.reviews}`)) : null,
    pr.ignored ? h(Tag, { key: "i", kind: "mute" }, t("\u5DF2\u5FFD\u7565", "Ignored")) : null
  ].filter(Boolean);
  return tags.length ? h("div", { className: "ght-kc-tags" }, tags) : null;
}
function CardHead({ t, pr, def, locked, showChip }) {
  return h(
    "div",
    { className: "ght-kc-top" },
    h(RepoDot, { index: pr.repoIndex ?? 0 }),
    h("span", { className: "ght-kc-repo" }, pr.repoSlug || pr.repo),
    h("span", { className: "ght-kc-num" }, `#${pr.number}`),
    h("span", { className: "ght-sp" }),
    showChip ? h(Chip, { tone: def.tone, small: true }, def.label) : null,
    locked ? null : h("span", { className: "ght-grip" }, h(Icon, { name: "grip", size: 13 }))
  );
}
function PrCard({ t, row, defs, rules, now, dim, selected, wts, prs, bindings, onOpen, onBind, onWorktree, dragHandlers }) {
  const { pr, d, f } = row;
  const def = defs[d.key];
  const locked = ["merged", "closed", "draft"].includes(d.key);
  const showChip = ["draft", "merged", "closed", "done", "reviewing"].includes(d.key);
  const wt = wtFor(pr, { wts, prs, bindings, rules });
  return h(
    "article",
    {
      className: cx(
        "ght-kc",
        f.overdue && "ght-kc-overdue",
        dim && "ght-kc-dim",
        selected && "ght-kc-on",
        locked && "ght-kc-locked",
        d.key === "draft" && "ght-kc-draft"
      ),
      draggable: !locked,
      "data-card": pr.key,
      onClick: () => onOpen(pr.key),
      ...locked ? {} : dragHandlers
    },
    h(CardHead, { t, pr, def, locked, showChip }),
    h("div", { className: "ght-kc-title" }, pr.title),
    h("div", { className: "ght-kc-why" }, shortWhy(pr, d, rules, now, t)),
    h(CardTags, { t, d, f, pr }),
    h(
      "div",
      { className: "ght-kc-foot" },
      h(Avatar, { name: pr.author }),
      h("span", { className: "ght-au" }, pr.author),
      h("span", { className: "ght-sp" }),
      h(
        "span",
        { className: cx("ght-age", f.overdue && "bad") },
        h(Icon, { name: "clock", size: 11 }),
        def.owner === "done" ? shortAge(d, now, t) : duration(now - d.since, t)
      )
    ),
    h(WorktreeButton, { t, wt, pr, bindings, rules, onWorktree, onBind, ended: def.owner === "done" })
  );
}
function dropIndexAt(event, dragKey) {
  const cards = [...event.currentTarget.querySelectorAll("[data-card]")].filter(
    (el) => el.dataset.card !== dragKey
  );
  const target = event.target.closest?.("[data-card]");
  if (!target || target.dataset.card === dragKey) return cards.length;
  const rect = target.getBoundingClientRect();
  return cards.indexOf(target) + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
}
function notifyDrop(result, drag, defs, t, toast) {
  if (!result.ok) {
    toast(t(`\u4E0D\u80FD\u653E\u5230\u8FD9\u91CC\uFF1A${result.reason}`, `Can't drop here: ${result.reason}`));
    return;
  }
  if (result.reorder) {
    toast(t(`#${drag.number} \u987A\u5E8F\u5DF2\u8C03\u6574`, `#${drag.number} reordered`));
    return;
  }
  const before = defs[result.beforeKey]?.label || result.beforeKey;
  const after = defs[result.afterKey]?.label || result.afterKey;
  const mark = t(MARK_TEXT[result.mark], MARK_EN2[result.mark]);
  toast(
    t(
      `#${drag.number}\uFF1A${before} \u2192 ${after} \xB7 ${mark}\uFF08\u4EC5\u672C\u5730\uFF09`,
      `#${drag.number}: ${before} \u2192 ${after} \xB7 ${mark} (local only)`
    ),
    result.undo
  );
}
function performDrop({ event, colKey, drag, over, store, defs, visible, order, endedDays, now, toast, t }) {
  const plan = drag.plans[colKey];
  if (!plan?.ok) {
    toast(t(`\u4E0D\u80FD\u653E\u5230\u8FD9\u91CC\uFF1A${plan?.text || ""}`, `Can't drop here: ${plan?.text || ""}`));
    return;
  }
  event.preventDefault();
  const state = store.getSnapshot();
  const prevLocal = { marks: state.local.marks, order: state.local.order };
  const { main } = splitColumn(visible, colKey, { endedDays, now });
  const sorted = sortColumn(main, colKey, order[colKey] || []);
  const index = over?.col === colKey && over.index != null ? over.index : sorted.length;
  const ids = orderAfterDrop(sorted, drag.key, index);
  const result = store.applyDropLocal(drag.key, colKey, ids, Date.now());
  const beforeKey = drag.fromKey === "reviewing" && result.beforeKey === "needs_review" ? "reviewing" : result.beforeKey;
  notifyDrop(
    { ...result, beforeKey, undo: () => store.restoreLocal(prevLocal) },
    drag,
    defs,
    t,
    toast
  );
  return result;
}
function useBoardDrag({ store, rules, defs, visible, order, endedDays, now, toast, t }) {
  const [drag, setDrag] = React.useState(null);
  const [over, setOver] = React.useState(null);
  const dropped = React.useRef(false);
  const start = (event, row) => {
    dropped.current = false;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.pr.key);
    const plans = Object.fromEntries(COLUMNS.map((c) => [c.key, dropPlan(row.pr, rules, c.key)]));
    setDrag({ key: row.pr.key, number: row.pr.number, fromKey: row.d.key, plans });
  };
  const columnOver = (event, colKey) => {
    if (!drag) return;
    const plan = drag.plans[colKey];
    if (!plan?.ok) {
      setOver({ col: colKey, ok: false, index: null });
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const index = dropIndexAt(event, drag.key);
    if (index !== over?.index || over?.col !== colKey) setOver({ col: colKey, ok: true, index });
  };
  const drop = (event, colKey) => {
    if (!drag) return;
    dropped.current = true;
    performDrop({ event, colKey, drag, over, store, defs, visible, order, endedDays, now, toast, t });
    setDrag(null);
    setOver(null);
  };
  const end = () => {
    if (!dropped.current && drag && over && !drag.plans[over.col]?.ok) {
      toast(t(`\u4E0D\u80FD\u653E\u5230\u8FD9\u91CC\uFF1A${drag.plans[over.col].text}`, `Can't drop here: ${drag.plans[over.col].text}`));
    }
    setDrag(null);
    setOver(null);
  };
  const leave = (colKey) => {
    setOver((current) => current?.col === colKey ? { col: colKey, ok: false, index: null } : current);
  };
  return { drag, over, start, columnOver, drop, end, leave };
}
function ColumnHeader({ t, col, def, count, overdue }) {
  return h(
    "header",
    { className: "ght-bcol-h" },
    h(
      "div",
      { className: "ght-bcol-t" },
      h("i", { className: "ght-tdot", style: { background: toneColor(def ? def.tone : "neutral") } }),
      h("b", null, def ? def.label : t("\u5DF2\u7ED3\u675F", "Finished")),
      def ? h("span", { className: `ght-own ght-own-${def.owner}` }, ownerLabel(def.owner, t)) : null,
      h("span", { className: "ght-sp" }),
      h("span", { className: "ght-cnt" }, count)
    ),
    h(
      "div",
      { className: "ght-bcol-d" },
      t(COLUMN_DESC[col.key][0], COLUMN_DESC[col.key][1]),
      overdue ? h("b", { className: "ght-od" }, t(` \xB7 ${overdue} \u4E2A\u8D85\u65F6`, ` \xB7 ${overdue} overdue`)) : null
    )
  );
}
function columnItems({ t, colKey, sorted, drafts, hidden, showPlaceholder, over, cardArgs, dragHandlers }) {
  const items = [];
  sorted.forEach((row, index) => {
    if (showPlaceholder && over.index === index) {
      items.push(h("div", { key: "ph", className: "ght-ph" }));
    }
    items.push(h(PrCard, { key: row.pr.key, row, ...cardArgs, ...dragHandlers(row) }));
  });
  if (showPlaceholder && over.index >= sorted.length) {
    items.push(h("div", { key: "ph-end", className: "ght-ph" }));
  }
  if (!sorted.length && !showPlaceholder) {
    items.push(h("div", { key: "empty", className: "ght-bempty" }, t("\u62D6\u52A8\u5361\u7247\u5230\u8FD9\u91CC", "Drag cards here")));
  }
  if (drafts.length) {
    items.push(
      h("div", { key: "sep", className: "ght-draft-sep" }, t(`\u8349\u7A3F \xB7 \u7B49\u4F5C\u8005\u8F6C Ready\uFF08${drafts.length}\uFF09`, `Drafts \xB7 waiting for ready (${drafts.length})`))
    );
    items.push(
      ...sortColumn(drafts, colKey, []).map(
        (row) => h(PrCard, { key: row.pr.key, row, ...cardArgs, ...dragHandlers(row) })
      )
    );
  }
  if (hidden) {
    items.push(
      h("div", { key: "more", className: "ght-bmore" }, t(`\u66F4\u65E9\u7ED3\u675F\u7684 ${hidden} \u4E2A\u672A\u663E\u793A\uFF08\u8BBE\u7F6E \u203A \u770B\u677F\uFF09`, `${hidden} older items hidden (Settings \u203A Board)`))
    );
  }
  return items;
}
function BoardColumn({ t, col, defs, visible, order, endedDays, now, drag, over, cardArgs, onColumnOver, onDrop, onLeave, dragHandlers }) {
  const { main, drafts, hidden } = splitColumn(visible, col.key, { endedDays, now });
  const sorted = sortColumn(main, col.key, order[col.key] || []);
  const def = col.main ? defs[col.main] : null;
  const overdue = sorted.filter((r) => r.f.overdue).length;
  const plan = drag?.plans[col.key];
  const showPlaceholder = drag && over?.col === col.key && over.ok;
  const hint = drag ? plan?.reorder ? t("\u5217\u5185\u62D6\u52A8 = \u8C03\u6574\u987A\u5E8F", "Same column = reorder") : plan?.ok ? t(`\u653E\u4E0B = ${plan.text}`, `Drop = ${plan.text}`) : t(`\u4E0D\u80FD\u653E\uFF1A${plan?.text || ""}`, `Can't drop: ${plan?.text || ""}`) : "";
  return h(
    "section",
    {
      className: cx("ght-bcol", drag && (plan?.ok ? "ght-can" : "ght-cannot"), over?.col === col.key && over.ok && "ght-over"),
      "data-col": col.key
    },
    h(ColumnHeader, { t, col, def, count: sorted.length, overdue }),
    drag ? h("div", { className: "ght-drop-hint" }, hint) : null,
    h(
      "div",
      {
        className: "ght-bcol-body",
        onDragOver: (event) => onColumnOver(event, col.key),
        onDrop: (event) => onDrop(event, col.key),
        onDragLeave: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onLeave(col.key);
        }
      },
      columnItems({ t, colKey: col.key, sorted, drafts, hidden, showPlaceholder, over, cardArgs, dragHandlers })
    )
  );
}
function Board({ t, store, rows, rules, defs, order, endedDays, now, query, filterFn, wts, prs, bindings, selectedKey, toast, onOpen, onBind, onWorktree }) {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  const visible = rows.filter(
    (row) => !q || `${row.pr.number} ${row.pr.title} ${row.pr.author} ${row.pr.repoSlug}`.toLowerCase().includes(q)
  );
  const dragState = useBoardDrag({ store, rules, defs, visible, order, endedDays, now, toast, t });
  const cardArgs = { t, defs, rules, now, wts, prs, bindings, onOpen, onBind, onWorktree };
  const dragHandlers = (row) => ({
    dim: !filterFn(row),
    selected: selectedKey === row.pr.key,
    dragHandlers: {
      onDragStart: (event) => dragState.start(event, row),
      onDragEnd: dragState.end
    }
  });
  return h(
    "div",
    { className: cx("ght-board", dragState.drag && "ght-dragging") },
    COLUMNS.map(
      (col) => h(BoardColumn, {
        key: col.key,
        t,
        col,
        defs,
        visible,
        order,
        endedDays,
        now,
        drag: dragState.drag,
        over: dragState.over,
        cardArgs,
        dragHandlers,
        onColumnOver: dragState.columnOver,
        onDrop: dragState.drop,
        onLeave: dragState.leave
      })
    )
  );
}

// src/ui/ListView.js
function WtCell({ t, pr, d, defs, wts, prs, bindings, rules, onWorktree, onBind }) {
  const def = defs[d.key];
  const wt = wtFor(pr, { wts, prs, bindings, rules });
  if (wt) {
    return h(
      "button",
      {
        type: "button",
        className: "ght-wt-link",
        title: linkSource(wt, pr, bindings),
        onClick: (event) => {
          event.stopPropagation();
          onWorktree(wt);
        }
      },
      h(Icon, { name: "branch", size: 12 }),
      wt.name
    );
  }
  if (def.owner === "done") return null;
  return h(
    "button",
    {
      type: "button",
      className: "ght-ghost-btn",
      onClick: (event) => {
        event.stopPropagation();
        onBind(pr.key);
      }
    },
    h(Icon, { name: "link", size: 12 }),
    t("\u5173\u8054 worktree", "Link worktree")
  );
}
function RowHeading({ t, pr, f, ignored }) {
  const tags = [
    f.overdue ? h(Tag, { key: "o", kind: "bad" }, t("\u8D85\u65F6", "Overdue")) : null,
    f.silent ? h(Tag, { key: "s", kind: "warn" }, t("\u4F5C\u8005\u6C89\u9ED8", "Author silent")) : null,
    ignored ? h(Tag, { key: "i", kind: "mute" }, t("\u5DF2\u5FFD\u7565", "Ignored")) : null
  ].filter(Boolean);
  return h(
    "div",
    { className: "ght-pr-title" },
    h("span", { className: "ght-prnum" }, `#${pr.number}`),
    h("span", { className: "ght-pr-t" }, pr.title),
    tags
  );
}
function RowMeta({ t, pr, rules, now, event }) {
  return h(
    "div",
    { className: "ght-pr-meta" },
    h(RepoDot, { index: pr.repoIndex ?? 0 }),
    h("span", null, pr.repoSlug || pr.repo),
    "\xB7",
    h(Avatar, { name: pr.author }),
    h("span", null, pr.author),
    "\xB7",
    h(
      "span",
      null,
      event ? `${evText(pr, event, pr.events, rules, t).text} ${fmtRel(event.at, now, t)}` : ""
    )
  );
}
function PrTitleBlock({ t, pr, f, rules, now, event }) {
  return h(
    "div",
    { className: "ght-pr-main" },
    h(RowHeading, { t, pr, f, ignored: pr.ignored }),
    h(RowMeta, { t, pr, rules, now, event })
  );
}
function RowTail({ t, pr, d, def, f, defs, rules, now, wts, prs, bindings, onWorktree, onBind, onGh }) {
  return h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "ght-pr-rounds" },
      d.reviews ? t(`\u5DF2\u5BA1 ${d.reviews} \u6B21`, `Reviewed ${d.reviews}\xD7`) : def.owner === "done" ? "\u2014" : t("\u672A\u5BA1", "Not reviewed")
    ),
    h(
      "div",
      { className: cx("ght-pr-age", f.overdue && "bad") },
      def.owner === "done" ? fmtRel(d.since, now, t) : duration(now - d.since, t)
    ),
    h("div", { className: "ght-pr-wt" }, h(WtCell, { t, pr, d, defs, wts, prs, bindings, rules, onWorktree, onBind })),
    h(
      "div",
      null,
      h(
        "button",
        {
          type: "button",
          className: "ght-icon-btn ght-bare",
          title: t("\u5728 GitHub \u6253\u5F00", "Open on GitHub"),
          onClick: (event) => {
            event.stopPropagation();
            onGh(pr);
          }
        },
        h(Icon, { name: "ext", size: 14 })
      )
    )
  );
}
function PrRow({ t, row, defs, rules, now, wts, prs, bindings, selectedKey, onOpen, onBind, onWorktree, onGh }) {
  const { pr, d, f } = row;
  const def = defs[d.key];
  const event = pr.events[pr.events.length - 1];
  return h(
    "div",
    {
      className: cx(
        "ght-pr-row",
        selectedKey === pr.key && "ght-pr-row-on",
        pr.ignored && "ght-pr-row-ignored"
      ),
      onClick: () => onOpen(pr.key)
    },
    h("div", null, h(Chip, { tone: def.tone }, def.label)),
    h(PrTitleBlock, { t, pr, f, rules, now, event }),
    h(RowTail, { t, pr, d, def, f, defs, rules, now, wts, prs, bindings, onWorktree, onBind, onGh })
  );
}
function ListView({
  t,
  rows,
  defs,
  rules,
  now,
  query,
  filterFn,
  wts,
  prs,
  bindings,
  selectedKey,
  onOpen,
  onBind,
  onWorktree,
  onGh
}) {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  const list = rows.filter(filterFn).filter(
    (row) => !q || `${row.pr.number} ${row.pr.title} ${row.pr.author} ${row.pr.repoSlug}`.toLowerCase().includes(q)
  );
  const sorted = sortColumn(list, "list", []);
  const rowArgs = { t, defs, rules, now, wts, prs, bindings, selectedKey, onOpen, onBind, onWorktree, onGh };
  return h(
    "div",
    { className: "ght-list" },
    h(
      "div",
      { className: "ght-list-head" },
      h("span", null, t("\u72B6\u6001", "Status")),
      h("span", null, "PR"),
      h("span", null, t("\u5BA1\u67E5", "Reviews")),
      h("span", null, t("\u505C\u7559", "Age")),
      h("span", null, "Worktree"),
      h("span", null)
    ),
    sorted.length ? sorted.map((row) => h(PrRow, { key: row.pr.key, row, ...rowArgs })) : h("div", { className: "ght-empty" }, t("\u8FD9\u91CC\u6CA1\u6709 PR\u3002", "No PRs here."))
  );
}

// src/ui/Drawer.js
function slicePr(pr, index) {
  const events = pr.events.slice(0, index + 1);
  const commits = events.filter((e) => e.type === "commit").map((e) => e.sha);
  return {
    ...pr,
    events,
    commitShas: commits,
    headSha: commits[commits.length - 1] || pr.headSha
  };
}
function Timeline({ t, pr, rules, defs, now }) {
  let prev = null;
  const items = pr.events.map((event, index) => {
    const state = derive(slicePr(pr, index), rules);
    const changed = state.key !== prev;
    prev = state.key;
    const text = evText(pr, event, pr.events, rules, t);
    const def = defs[state.key];
    const dot = changed ? toneColor(def.tone) : event.mine || event.type === "mark" ? "#94a3b8" : "#d4d4d4";
    return h(
      "li",
      { key: `${event.type}-${event.at}-${index}`, className: cx("ght-tl-i", text.muted && "ght-muted") },
      h("i", { className: "ght-tl-dot", style: { background: dot } }),
      h(
        "div",
        { className: "ght-tl-txt" },
        text.text,
        text.sha ? h("code", null, text.sha.slice(0, 7)) : null,
        text.note ? h("span", { className: "ght-tl-note" }, text.note) : null
      ),
      h("div", { className: "ght-tl-time" }, fmtAbs(event.at, now, t)),
      changed ? h(
        "div",
        { className: "ght-tl-to" },
        "\u2192 ",
        h(Chip, { tone: def.tone, small: true }, def.label)
      ) : null
    );
  });
  return h("ol", { className: "ght-tl" }, items);
}
function nextAction({ t, pr, ns, onGh }) {
  if (ns.owner === "me") {
    const compare = ns.compare ? ns.compare.split("\u2026") : null;
    const url = compare ? compareUrl(pr, compare[0], compare[1]) : filesUrl(pr);
    return h(
      "button",
      { type: "button", className: "ght-btn ght-btn-pri", onClick: () => onGh(url) },
      h(Icon, { name: "ext", size: 13 }),
      ns.compare ? t(`\u770B ${ns.compare} \u7684\u6539\u52A8`, `View ${ns.compare}`) : t("\u5728 GitHub \u5BA1\u67E5", "Review on GitHub")
    );
  }
  if (ns.owner === "merge") {
    return h(
      "button",
      { type: "button", className: "ght-btn ght-btn-pri", onClick: () => onGh(prUrl(pr)) },
      h(Icon, { name: "ext", size: 13 }),
      t("\u53BB GitHub \u5408\u5E76", "Merge on GitHub")
    );
  }
  return h(
    "button",
    { type: "button", className: "ght-btn", onClick: () => onGh(prUrl(pr)) },
    h(Icon, { name: "ext", size: 13 }),
    t("\u5728 GitHub \u6253\u5F00", "Open on GitHub")
  );
}
function RefreshButton({ t, onRefresh, primary }) {
  const [busy, setBusy] = React.useState(false);
  const run = () => {
    if (busy) return;
    setBusy(true);
    Promise.resolve().then(() => onRefresh()).finally(() => setBusy(false));
  };
  if (!primary) {
    return h(
      "button",
      {
        type: "button",
        className: "ght-icon-btn ght-bare",
        title: busy ? t("\u6B63\u5728\u5237\u65B0\u2026", "Refreshing\u2026") : t("\u4ECE GitHub \u91CD\u65B0\u8BFB\u53D6", "Reload from GitHub"),
        "aria-label": t("\u5237\u65B0\u72B6\u6001", "Refresh status"),
        onClick: run,
        disabled: busy
      },
      h(Icon, { name: "refresh", size: 14 })
    );
  }
  return h(
    "button",
    {
      type: "button",
      className: "ght-btn",
      title: t("\u521A\u5728 GitHub \u5408\u5E76\u4E86\uFF1F\u6309\u7F16\u53F7\u91CD\u65B0\u8BFB\u53D6\u72B6\u6001", "Merged on GitHub? Re-read the state"),
      onClick: run,
      disabled: busy
    },
    h(Icon, { name: "refresh", size: 13 }),
    busy ? t("\u5237\u65B0\u4E2D\u2026", "Refreshing\u2026") : t("\u5237\u65B0\u72B6\u6001", "Refresh status")
  );
}
function NextCard({ t, pr, d, def, ns, now, onGh, onRefresh }) {
  return h(
    "div",
    { className: `ght-next ght-next-${ns.owner}` },
    h("div", { className: "ght-next-l" }, `${ns.head} \xB7 ${t("\u505C\u7559", "for")} ${duration(now - d.since, t)}`),
    h("div", { className: "ght-next-t" }, ns.title),
    h(
      "div",
      { className: "ght-next-why" },
      h("b", null, t(`\u4E3A\u4EC0\u4E48\u662F\u300C${def.label}\u300D\uFF1A`, `Why "${def.label}": `)),
      ns.why
    ),
    h(
      "div",
      { className: "ght-next-acts" },
      nextAction({ t, pr, ns, onGh }),
      ns.owner === "merge" ? h(RefreshButton, { t, onRefresh, primary: true }) : null
    )
  );
}
function useRemoveWorktree({ ctx, store, index, pr, wt, toast, t }) {
  const [confirming, setConfirming] = React.useState(false);
  const remove = async () => {
    if (!wt) return;
    const repo = index.getSnapshot().repos.find((r) => r.slug === wt.repo);
    if (!repo) {
      toast(t("\u627E\u4E0D\u5230\u8FD9\u4E2A worktree \u6240\u5C5E\u7684\u4ED3\u5E93\u8DEF\u5F84", "Can't resolve the repository path for this worktree"));
      return;
    }
    try {
      const result = await ctx.worktrees.remove({
        repoPath: repo.path,
        worktreePath: wt.path,
        branch: wt.name,
        deleteBranch: false
      });
      store.unbind(pr.key);
      store.clearReviewing(pr.key);
      await index.refresh();
      setConfirming(false);
      toast(
        result.orphanDirectory ? t("worktree \u5DF2\u6CE8\u9500\uFF0C\u4F46\u76EE\u5F55\u672A\u80FD\u5220\u9664", "Worktree unregistered, but the directory was not removed") : t("worktree \u5DF2\u5220\u9664", "Worktree removed")
      );
    } catch (error) {
      setConfirming(false);
      toast(t(`\u5220\u9664\u5931\u8D25\uFF1A${error?.message || error}`, `Remove failed: ${error?.message || error}`));
    }
  };
  return { confirming, setConfirming, remove };
}
function WorktreeActions({ t, ctx, store, index, pr, wt, bindings, terminal, toast, onBind, onWorktree }) {
  const { confirming, setConfirming, remove } = useRemoveWorktree({ ctx, store, index, pr, wt, toast, t });
  if (!wt) {
    return [
      h("span", { key: "s", className: "ght-src" }, t("\u8FD8\u6CA1\u6709\u5BF9\u5E94\u7684 worktree", "No worktree linked")),
      h("span", { key: "sp", className: "ght-sp" }),
      terminal ? null : h(
        "button",
        { key: "b", type: "button", className: "ght-btn", onClick: () => onBind(pr.key) },
        h(Icon, { name: "link", size: 13 }),
        t("\u5173\u8054 worktree\u2026", "Link worktree\u2026")
      )
    ];
  }
  const removeButtons = confirming ? [
    h("button", { key: "y", type: "button", className: "ght-btn ght-btn-danger", onClick: remove }, t("\u786E\u8BA4\u5220\u9664", "Confirm removal")),
    h("button", { key: "n", type: "button", className: "ght-btn", onClick: () => setConfirming(false) }, t("\u53D6\u6D88", "Cancel"))
  ] : [h("button", { key: "rm", type: "button", className: "ght-btn", onClick: () => setConfirming(true) }, t("\u5220\u9664 worktree\u2026", "Remove worktree\u2026"))];
  return [
    h(Icon, { key: "i", name: "branch", size: 14 }),
    h("b", { key: "n", className: "ght-mono" }, wt.name),
    h("span", { key: "s", className: "ght-src" }, linkSource(wt, pr, bindings)),
    h("span", { key: "sp", className: "ght-sp" }),
    ...terminal ? removeButtons : [h("button", { key: "copy", type: "button", className: "ght-btn", onClick: () => onWorktree(wt) }, t("\u590D\u5236\u8DEF\u5F84", "Copy path"))],
    bindings[pr.key] ? h(
      "button",
      {
        key: "unbind",
        type: "button",
        className: "ght-btn",
        onClick: () => {
          store.unbind(pr.key);
          toast(t(`\u5DF2\u89E3\u9664 #${pr.number} \u7684 worktree \u7ED1\u5B9A`, `Unlinked #${pr.number}`));
        }
      },
      t("\u89E3\u9664\u7ED1\u5B9A", "Unlink")
    ) : null,
    terminal ? null : h("button", { key: "change", type: "button", className: "ght-btn", onClick: () => onBind(pr.key) }, t("\u6362\u4E00\u4E2A\u2026", "Change\u2026"))
  ];
}
function WorktreeSection({ t, ctx, store, index, pr, wt, bindings, terminal, toast, onBind, onWorktree }) {
  return h(
    "div",
    null,
    h(
      "div",
      { className: "ght-sec-h" },
      "Worktree",
      h("span", null, t("\u624B\u52A8\u7ED1\u5B9A > \u5BA2\u6237\u7AEF\u4ECE PR \u521B\u5EFA > \u5206\u652F\u540D\u4E00\u81F4", "manual > created from PR > matching branch"))
    ),
    h(
      "div",
      { className: "ght-wt-box" },
      h(WorktreeActions, { t, ctx, store, index, pr, wt, bindings, terminal, toast, onBind, onWorktree })
    )
  );
}
function markButton(t, label, disabled, onClick) {
  return h("button", { type: "button", className: "ght-btn", disabled, onClick }, label);
}
function MarksSection({ t, store, pr, terminal, done, ignored, toast }) {
  const mark = (verdict) => {
    store.addMark(pr.key, { verdict, via: "button", at: Date.now(), sha: pr.headSha });
    toast(t("\u5DF2\u8BB0\u5F55\u5230\u672C\u5730\uFF08\u4E0D\u4F1A\u5199\u5230 GitHub\uFF09", "Saved locally (nothing written to GitHub)"));
  };
  const hasMarks = (store.getSnapshot().local.marks[pr.key] || []).length > 0;
  return h(
    "div",
    null,
    h(
      "div",
      { className: "ght-sec-h" },
      t("\u624B\u52A8\u6807\u8BB0", "Manual marks"),
      h("span", null, terminal || done ? t("\u5DF2\u7ED3\u675F\u7684 PR \u4E0D\u80FD\u518D\u6807\u8BB0\uFF1B\u5148\u5728\u770B\u677F\u4E0A\u62D6\u56DE\u5176\u4ED6\u5217", "Finished PRs can't be marked; drag it back on the board first") : t("\u4EC5\u5B58\u672C\u5730\uFF0C\u4E0D\u5199 GitHub\uFF1B\u5728\u770B\u677F\u4E0A\u62D6\u5230\u5BF9\u5E94\u5217\u6548\u679C\u4E00\u6837", "local only; dragging on the board does the same"))
    ),
    h(
      "div",
      { className: "ght-btns" },
      markButton(t, t("\u770B\u8FC7\u4E86 \xB7 \u9700\u8981\u4FEE\u590D", "Reviewed \xB7 changes needed"), terminal || done, () => mark("changes")),
      markButton(t, t("\u770B\u8FC7\u4E86 \xB7 \u6CA1\u95EE\u9898", "Reviewed \xB7 looks good"), terminal || done, () => mark("approve")),
      markButton(t, t("\u64A4\u9500\u4E0A\u4E00\u6B21\u6807\u8BB0", "Undo last mark"), !hasMarks, () => {
        store.unmarkLast(pr.key);
        toast(t("\u5DF2\u64A4\u9500\u4E0A\u4E00\u6B21\u6807\u8BB0", "Last mark undone"));
      }),
      h(
        "button",
        {
          type: "button",
          className: "ght-btn",
          onClick: () => {
            store.toggleIgnore(pr.key);
            toast(
              ignored ? t("\u5DF2\u53D6\u6D88\u5FFD\u7565", "Unignored") : t("\u5DF2\u5FFD\u7565\uFF1A\u4E0D\u518D\u8BA1\u5165\u770B\u677F\u3001\u7EDF\u8BA1\u548C\u4FA7\u680F\u5FBD\u6807", "Ignored: excluded from board, stats and badges")
            );
          }
        },
        h(Icon, { name: "eye", size: 13 }),
        ignored ? t("\u53D6\u6D88\u5FFD\u7565", "Unignore") : t("\u5FFD\u7565\u8FD9\u4E2A PR", "Ignore this PR")
      )
    )
  );
}
function DrawerHeader({ t, pr, d, def, ignored, onGh, onClose, onRefresh }) {
  return h(
    "div",
    { className: "ght-dr-head" },
    h(
      "div",
      { className: "ght-dr-top" },
      h(Chip, { tone: def.tone }, def.label),
      h(RepoDot, { index: pr.repoIndex ?? 0 }),
      h("span", { className: "ght-mono ght-dim-txt" }, `${pr.repoSlug} #${pr.number}`),
      d.reviews ? h(Tag, null, t(`\u5DF2\u5BA1 ${d.reviews} \u6B21`, `Reviewed ${d.reviews}\xD7`)) : null,
      ignored ? h(Tag, null, t("\u5DF2\u5FFD\u7565", "Ignored")) : null,
      h("span", { className: "ght-sp" }),
      h(RefreshButton, { t, onRefresh }),
      h("button", { type: "button", className: "ght-icon-btn ght-bare", title: t("\u5728 GitHub \u6253\u5F00", "Open on GitHub"), onClick: () => onGh(prUrl(pr)) }, h(Icon, { name: "ext", size: 14 })),
      h("button", { type: "button", className: "ght-icon-btn ght-bare", title: t("\u5173\u95ED\uFF08Esc\uFF09", "Close (Esc)"), onClick: onClose }, h(Icon, { name: "x", size: 15 }))
    ),
    h("h3", null, pr.title),
    h(
      "div",
      { className: "ght-dr-meta" },
      h(Avatar, { name: pr.author }),
      h("span", null, pr.author),
      "\xB7",
      h("span", { className: "ght-mono" }, `${pr.headRefName || "?"} \u2192 ${pr.baseRefName || "main"}`),
      pr.additions ? h("span", { className: "ght-add" }, `+${pr.additions}`) : null,
      pr.deletions ? h("span", { className: "ght-del" }, `\u2212${pr.deletions}`) : null
    )
  );
}
function Drawer({ t, ctx, store, pr, rules, defs, now, wts, prs, bindings, index, toast, onClose, onGh, onRefresh, onBind, onWorktree }) {
  const d = derive(pr, rules);
  const wt0 = wtFor(pr, { wts, prs, bindings, rules });
  const dView = reviewingState(d, !!wt0, store.getSnapshot().local.reviewing[pr.key]);
  const def = defs[dView.key];
  const ns = nextStep(pr, dView, rules, now, t);
  const wt = wt0;
  const terminal = dView.key === "merged" || dView.key === "closed";
  return [
    h("div", { key: "scrim", className: "ght-scrim", onClick: onClose }),
    h(
      "aside",
      { key: "drawer", className: "ght-drawer", "aria-label": t("PR \u8BE6\u60C5", "PR details") },
      h(DrawerHeader, { t, pr, d, def, ignored: pr.ignored, onGh, onClose, onRefresh }),
      h(
        "div",
        { className: "ght-dr-body" },
        h(NextCard, { t, pr, d: dView, def, ns, now, onGh, onRefresh }),
        h(WorktreeSection, { t, ctx, store, index, pr, wt, bindings, terminal, toast, onBind, onWorktree }),
        h(
          "div",
          null,
          h("div", { className: "ght-sec-h" }, t("\u6D41\u8F6C\u8BB0\u5F55", "Timeline"), h("span", null, t("\u5F69\u8272\u5706\u70B9 = \u8FD9\u4E00\u6B65\u6539\u53D8\u4E86\u72B6\u6001", "colored dot = state changed here"))),
          h(Timeline, { t, pr, rules, defs, now })
        ),
        h(MarksSection, { t, store, pr, terminal, done: dView.key === "done", ignored: pr.ignored, toast }),
        h("div", { className: "ght-why-foot" }, shortWhy(pr, dView, rules, now, t))
      )
    )
  ];
}

// src/ui/SettingsModal.js
var pad3 = (n) => String(n).padStart(2, "0");
var SECTIONS = [
  ["src", "\u6570\u636E\u6765\u6E90", "Data source"],
  ["scope", "\u8DDF\u8E2A\u8303\u56F4", "Scope"],
  ["rules", "\u72B6\u6001\u5224\u5B9A", "Verdicts"],
  ["timeout", "\u8D85\u65F6\u63D0\u9192", "Overdue"],
  ["look", "\u72B6\u6001\u5916\u89C2", "Appearance"],
  ["board", "\u770B\u677F", "Board"],
  ["wt", "Worktree \u5FBD\u6807", "Worktree badges"],
  ["sync", "\u540C\u6B65\u4E0E\u7EDF\u8BA1", "Sync & stats"],
  ["local", "\u672C\u5730\u6570\u636E", "Local data"],
  ["roadmap", "\u8DEF\u7EBF\u56FE", "Roadmap"]
];
function Row({ label, hint, children, stack }) {
  return h(
    "div",
    { className: cx("ght-srow", stack && "ght-srow-stack") },
    h(
      "div",
      null,
      h("div", { className: "ght-lab" }, label),
      hint ? h("div", { className: "ght-hint" }, hint) : null
    ),
    stack ? h("div", { className: "ght-stack-body" }, children) : h("div", null, children)
  );
}
function Switch({ checked, onChange, label }) {
  return h(
    "label",
    { className: "ght-sw", "aria-label": label },
    h("input", { type: "checkbox", checked, onChange: (e) => onChange(e.target.checked) }),
    h("i", null)
  );
}
function Seg({ value, options, onChange }) {
  return h(
    "div",
    { className: "ght-seg" },
    options.map(
      ([v, label]) => h(
        "button",
        {
          key: String(v),
          type: "button",
          className: cx(String(value) === String(v) && "on"),
          onClick: () => onChange(v)
        },
        label
      )
    )
  );
}
function Num({ value, onChange, suffix }) {
  return h(
    "span",
    { className: "ght-inline" },
    h("input", {
      className: "ght-numin",
      type: "number",
      min: 0,
      max: 99,
      value,
      onChange: (event) => onChange(Math.max(0, Math.min(99, Number(event.target.value) || 0)))
    }),
    suffix
  );
}
function Section({ id, title, sub, children }) {
  return h(
    "div",
    { className: "ght-sec", "data-sec": id, id: `ght-sec-${id}` },
    h("div", { className: "ght-sec-h2" }, h("h4", null, title), sub ? h("span", null, sub) : null),
    h("div", { className: "ght-sec-box" }, children)
  );
}
function TagsInput({ t, values, onChange, placeholder }) {
  const [draft, setDraft] = React.useState("");
  return h(
    "div",
    { className: "ght-tags" },
    values.map(
      (value) => h(
        "span",
        { key: value, className: "ght-tagx" },
        value,
        h(
          "button",
          { type: "button", "aria-label": t("\u79FB\u9664", "Remove"), onClick: () => onChange(values.filter((v) => v !== value)) },
          "\xD7"
        )
      )
    ),
    h("input", {
      className: "ght-tag-in",
      value: draft,
      placeholder,
      onChange: (event) => setDraft(event.target.value),
      onKeyDown: (event) => {
        if (event.key !== "Enter") return;
        const next = draft.trim().replace(/^@/, "");
        if (next && !values.includes(next)) onChange([...values, next]);
        setDraft("");
      }
    })
  );
}
function RepoLines({ t, store, state }) {
  if (!state.cfg.repos.length) {
    return h("div", { className: "ght-src" }, t("\u8FD8\u6CA1\u6709\u53D1\u73B0 GitHub \u4ED3\u5E93", "No GitHub repos discovered"));
  }
  return h(
    "div",
    { className: "ght-repo-list" },
    state.cfg.repos.map(
      (repo) => h(
        "div",
        { key: repo.slug, className: "ght-repo-line" },
        h(Switch, {
          checked: repo.enabled && repo.available,
          label: repo.slug,
          onChange: (checked) => {
            store.setRepos(
              state.cfg.repos.map((r) => r.slug === repo.slug ? { ...r, enabled: checked } : r)
            );
          }
        }),
        h("span", { className: "ght-mono" }, repo.slug),
        h("span", { className: "ght-src" }, repo.available ? t("\u6765\u81EA\u5DE5\u4F5C\u533A", "from workspace") : t("\u5DE5\u4F5C\u533A\u672A\u6253\u5F00", "workspace closed")),
        h("span", { className: "ght-sp" }),
        h(
          "span",
          { className: "ght-src" },
          repo.available ? repo.enabled ? t("\u5DF2\u8DDF\u8E2A", "tracked") : t("\u672A\u8DDF\u8E2A", "paused") : "\u2014"
        )
      )
    )
  );
}
function SourceSection({ t, store, state, index }) {
  void index;
  return h(
    Section,
    { id: "src", title: t("\u6570\u636E\u6765\u6E90", "Data source"), sub: t("\u53EA\u8BFB\uFF0C\u4E0D\u4F1A\u5F80 GitHub \u5199\u4EFB\u4F55\u4E1C\u897F", "read-only") },
    h(
      Row,
      { label: "gh CLI", hint: t("\u7528\u672C\u673A gh \u7684\u767B\u5F55\u6001\u8BFB\u53D6 PR\u3001Review\u3001\u63D0\u4EA4\u548C\u65F6\u95F4\u7EBF", "reads PRs, reviews, commits and timeline via local gh") },
      state.runtime.ghLogin ? h("span", { className: "ght-gh-ok" }, h("i", null), `@${state.runtime.ghLogin}`) : h("span", { className: "ght-src" }, state.runtime.ghError || t("\u672A\u8FDE\u63A5", "not connected"))
    ),
    h(Row, {
      label: t("\u8DDF\u8E2A\u7684\u4ED3\u5E93", "Tracked repositories"),
      hint: t("\u989C\u8272\u6309\u8FD9\u91CC\u7684\u987A\u5E8F\u56FA\u5B9A\u5206\u914D\uFF0C\u505C\u7528\u67D0\u4E2A\u4ED3\u5E93\u4E0D\u4F1A\u8BA9\u522B\u7684\u4ED3\u5E93\u6362\u8272\u3002", "Colors follow this order; pausing a repo doesn't recolor others."),
      stack: true
    }, h(RepoLines, { t, store, state })),
    h(Row, {
      label: t("\u6211\u7684\u8D26\u53F7", "My accounts"),
      hint: t("\u201C\u6211\u5BA1\u67E5\u8FC7\u201D\u53EA\u8BA4\u8FD9\u4E9B\u8D26\u53F7\u3002\u9ED8\u8BA4\u662F gh \u5F53\u524D\u767B\u5F55\u8D26\u53F7\u3002", "Only these accounts count as you."),
      stack: true
    }, h(TagsInput, {
      t,
      values: state.cfg.extraAccounts,
      placeholder: t("+ \u9644\u52A0\u8D26\u53F7\uFF0C\u56DE\u8F66", "+ extra account, Enter"),
      onChange: (list) => store.setExtraAccounts(list)
    }))
  );
}
function ScopeSection({ t, store, rules }) {
  return h(
    Section,
    { id: "scope", title: t("\u8DDF\u8E2A\u8303\u56F4", "Scope") },
    h(
      Row,
      { label: t("\u54EA\u4E9B PR", "Which PRs") },
      h(Seg, {
        value: rules.scope,
        options: [["all", t("\u4ED3\u5E93\u6240\u6709 open PR", "All open PRs")], ["mine", t("\u8BF7\u6C42\u6211\u5BA1\u67E5\u7684 / \u6211\u53C2\u4E0E\u8FC7\u7684", "Requested / participated")]],
        onChange: (v) => store.setRules({ scope: v })
      })
    ),
    h(
      Row,
      { label: t("\u5305\u542B\u8349\u7A3F", "Include drafts"), hint: t("\u8349\u7A3F\u653E\u5728\u300C\u5F85\u5BA1\u67E5\u300D\u5217\u5E95\u90E8", "Drafts sit at the bottom of Review") },
      h(Switch, { checked: rules.includeDraft, label: "includeDraft", onChange: (v) => store.setRules({ includeDraft: v }) })
    ),
    h(
      Row,
      { label: t("\u6392\u9664\u6211\u81EA\u5DF1\u5F00\u7684 PR", "Exclude my own PRs") },
      h(Switch, { checked: rules.excludeMine, label: "excludeMine", onChange: (v) => store.setRules({ excludeMine: v }) })
    ),
    h(
      Row,
      { label: t("\u6392\u9664\u8FD9\u4E9B\u4F5C\u8005", "Excluded authors"), hint: t("\u673A\u5668\u4EBA PR \u9ED8\u8BA4\u4E0D\u8DDF\u8E2A", "Bot PRs are excluded by default"), stack: true },
      h(TagsInput, {
        t,
        values: rules.excludeAuthors,
        placeholder: t("+ \u4F5C\u8005\u540D\uFF0C\u56DE\u8F66", "+ author, Enter"),
        onChange: (list) => store.setRules({ excludeAuthors: list })
      })
    )
  );
}
function FixChecks({ t, store, rules }) {
  const ck = (checked, onChange, label, small) => h(
    "label",
    { className: "ght-ck" },
    h("input", { type: "checkbox", checked, disabled: !onChange, onChange: (e) => onChange?.(e.target.checked) }),
    label,
    small ? h("small", null, small) : null
  );
  return h(
    "div",
    { className: "ght-checks" },
    ck(true, null, t("\u6211\u5BA1\u67E5\u4E4B\u540E head SHA \u53D8\u4E86\uFF08\u63A8\u9001 / force-push / rebase\uFF09", "head SHA changed since my review"), t("\u59CB\u7EC8\u5F00\u542F", "always on")),
    ck(true, null, t("\u6211\u5728\u770B\u677F\u4E0A\u62D6\u5230\u300C\u5F85\u590D\u5BA1\u300D", "I dragged it to Recheck"), t("\u59CB\u7EC8\u5F00\u542F", "always on")),
    ck(rules.rerequest, (v) => store.setRules({ rerequest: v }), t("\u4F5C\u8005\u91CD\u65B0\u8BF7\u6C42\u6211\u5BA1\u67E5", "Author re-requested my review")),
    ck(rules.authorReply, (v) => store.setRules({ authorReply: v }), t("\u4F5C\u8005\u56DE\u590D\u4E86\u6211\u7684\u8BC4\u8BBA", "Author replied"), t("\u5BB9\u6613\u8BEF\u5224\uFF0C\u9ED8\u8BA4\u5173", "noisy, off by default")),
    ck(rules.ignoreMergeBase, (v) => store.setRules({ ignoreMergeBase: v }), t("\u5FFD\u7565\u201C\u4EC5\u5408\u5E76\u4E3B\u5E72\u201D\u7684\u63D0\u4EA4", "Ignore merge-base commits"))
  );
}
function RulesSection({ t, store, rules, counts: counts2 }) {
  return h(
    Section,
    { id: "rules", title: t("\u72B6\u6001\u5224\u5B9A", "Verdicts"), sub: t("\u51B3\u5B9A PR \u843D\u5728\u54EA\u4E00\u5217", "decides the column") },
    h(
      "div",
      { className: "ght-effect" },
      t("\u6309\u5F53\u524D\u89C4\u5219\uFF1A", "Now: "),
      h("b", null, t(`\u7B49\u6211\u5904\u7406 ${counts2.mine}`, `yours ${counts2.mine}`)),
      t(
        `\uFF08\u5F85\u5BA1\u67E5 ${counts2.needs_review} \xB7 \u5BA1\u67E5\u4E2D ${counts2.reviewing} \xB7 \u5F85\u590D\u5BA1 ${counts2.needs_rereview}\uFF09`,
        ` (new ${counts2.needs_review} \xB7 reviewing ${counts2.reviewing} \xB7 recheck ${counts2.needs_rereview})`
      ),
      " \xB7 ",
      t(`\u7B49\u4F5C\u8005 ${counts2.author}`, `author ${counts2.author}`),
      " \xB7 ",
      t(`\u7B49\u5408\u5E76 ${counts2.merge}`, `merge ${counts2.merge}`)
    ),
    h(
      Row,
      { label: t("\u53EA\u7559\u4E86 Comment \u7684 Review", "Comment-only reviews"), hint: t("\u5F88\u591A\u4EBA\u63D0\u610F\u89C1\u53EA\u70B9 Comment \u4E0D\u70B9 Request changes", "Comment-only reviews often mean changes") },
      h(Seg, { value: rules.commentReview, options: [["changes", t("\u7B97\u8981\u6C42\u4FEE\u590D", "Count as changes")], ["ignore", t("\u4E0D\u7B97\u5BA1\u67E5", "Ignore")]], onChange: (v) => store.setRules({ commentReview: v }) })
    ),
    h(
      Row,
      { label: t("\u6211\u5728 PR \u4E0B\u7684\u666E\u901A\u8BC4\u8BBA", "Plain comments by me"), hint: t("\u666E\u901A\u8BC4\u8BBA\u5E38\u5E38\u53EA\u662F\u63D0\u95EE\uFF0C\u9ED8\u8BA4\u4E0D\u7B97\u5BA1\u67E5", "Usually just questions") },
      h(Seg, { value: rules.plainComment, options: [["ignore", t("\u4E0D\u7B97\u5BA1\u67E5", "Ignore")], ["changes", t("\u7B97\u8981\u6C42\u4FEE\u590D", "Count as changes")]], onChange: (v) => store.setRules({ plainComment: v }) })
    ),
    h(
      Row,
      { label: t("\u600E\u6837\u7B97\u201C\u4F5C\u8005\u4FEE\u590D\u4E86\u201D", "What counts as a fix"), hint: t("\u6EE1\u8DB3\u4EFB\u610F\u4E00\u6761\uFF0C\u5F85\u4FEE\u590D \u2192 \u5F85\u590D\u5BA1\u3002\u65B0\u63D0\u4EA4\u4EE5 head SHA \u662F\u5426\u53D8\u5316\u4E3A\u51C6\u3002", "Any of these moves Changes \u2192 Recheck. New code is SHA-based."), stack: true },
      h(FixChecks, { t, store, rules })
    ),
    h(
      Row,
      { label: t("Approve \u4E4B\u540E\u53C8\u6709\u65B0\u63D0\u4EA4", "New commits after approval") },
      h(Seg, { value: rules.approveThenCommit, options: [["rereview", t("\u56DE\u5230\u5F85\u590D\u5BA1", "Back to Recheck")], ["keep", t("\u4FDD\u6301\u5DF2\u901A\u8FC7", "Keep approved")]], onChange: (v) => store.setRules({ approveThenCommit: v }) })
    )
  );
}
function TimeoutSection({ t, store, rules }) {
  return h(
    Section,
    { id: "timeout", title: t("\u8D85\u65F6\u63D0\u9192", "Overdue"), sub: t("\u53EA\u5728\u770B\u677F\u548C\u5FBD\u6807\u4E0A\u6807\u51FA\u6765\uFF0C\u4E0D\u53D1\u901A\u77E5", "visual only") },
    h(Row, { label: t("\u5F85\u5BA1\u67E5\u8D85\u8FC7", "Review idle for") }, h(Num, { value: rules.overdueReview, onChange: (v) => store.setRules({ overdueReview: v }), suffix: t("\u5929", "days") })),
    h(Row, { label: t("\u5F85\u590D\u5BA1\u8D85\u8FC7", "Recheck idle for"), hint: t("\u4F5C\u8005\u5DF2\u7ECF\u6539\u5B8C\u5728\u7B49\u4F60\uFF0C\u9608\u503C\u5EFA\u8BAE\u66F4\u77ED", "author is waiting on you") }, h(Num, { value: rules.overdueRereview, onChange: (v) => store.setRules({ overdueRereview: v }), suffix: t("\u5929", "days") })),
    h(Row, { label: t("\u5F85\u4FEE\u590D\u8D85\u8FC7", "Changes idle for"), hint: t("\u6807\u300C\u4F5C\u8005\u6C89\u9ED8\u300D", "marks the PR silent") }, h(Num, { value: rules.silentDays, onChange: (v) => store.setRules({ silentDays: v }), suffix: t("\u5929", "days") }))
  );
}
function StatusRow({ t, store, defs, statusKey }) {
  const def = defs[statusKey];
  return h(
    "tr",
    null,
    h("td", null, h("span", { className: `ght-chip ght-tone-${def.tone}` }, def.label)),
    h("td", null, h("input", {
      className: "ght-lbl-in",
      maxLength: 6,
      value: def.label,
      onChange: (e) => store.setDef(statusKey, { label: e.target.value.slice(0, 6) || DEFAULT_DEFS[statusKey].label })
    })),
    h("td", null, h("div", { className: "ght-swatches" }, TONES.map(
      (tone) => h("button", {
        key: tone,
        type: "button",
        title: tone,
        className: cx("ght-swatch", `ght-tone-${tone}`, def.tone === tone && "on"),
        onClick: () => store.setDef(statusKey, { tone })
      })
    ))),
    h("td", null, h(Switch, { checked: def.badge, label: `${statusKey} badge`, onChange: (v) => store.setDef(statusKey, { badge: v }) })),
    h("td", { className: "ght-owner" }, ownerLabel(def.owner, t))
  );
}
function LookSection({ t, store, defs }) {
  return h(
    Section,
    { id: "look", title: t("\u72B6\u6001\u5916\u89C2", "Appearance"), sub: t("\u540D\u79F0\u548C\u989C\u8272\u7531\u63D2\u4EF6\u5B9A\u4E49\uFF1B\u5BA2\u6237\u7AEF\u53EA\u8D1F\u8D23\u753B", "names and tones are plugin-defined") },
    h(
      "table",
      { className: "ght-st-table" },
      h("thead", null, h(
        "tr",
        null,
        h("th", null, t("\u9884\u89C8", "Preview")),
        h("th", null, t("\u540D\u79F0\uFF08\u22646 \u5B57\uFF09", "Label")),
        h("th", null, t("\u989C\u8272\uFF08\u5BBF\u4E3B\u72B6\u6001\u8272\uFF09", "Tone")),
        h("th", null, t("\u4E0A\u4FA7\u680F\u5FBD\u6807", "Badge")),
        h("th", null, t("\u5F52\u5C5E", "Owner"))
      )),
      h("tbody", null, STATUS_ORDER.map((statusKey) => h(StatusRow, { key: statusKey, t, store, defs, statusKey })))
    )
  );
}
function BoardSection({ t, store, rules, state, toast }) {
  const hasOrder = Object.keys(state.local.order).length > 0;
  return h(
    Section,
    { id: "board", title: t("\u770B\u677F", "Board") },
    h(
      Row,
      { label: t("\u300C\u5DF2\u7ED3\u675F\u300D\u5217\u663E\u793A\u6700\u8FD1", "Show finished items from"), hint: t("\u66F4\u65E9\u7684\u5408\u5E76 / \u5173\u95ED\u4E0D\u5360\u5730\u65B9", "older items are hidden") },
      h(Num, { value: rules.endedDays, onChange: (v) => store.setRules({ endedDays: v }), suffix: t("\u5929", "days") })
    ),
    h(
      Row,
      { label: t("\u8DE8\u5217\u62D6\u62FD", "Cross-column drag"), hint: t("\u53EA\u5728\u672C\u5730\u8BB0\u4E00\u7B14\u6807\u8BB0\uFF0C\u4E0D\u5199 GitHub\uFF1B\u653E\u4E0B\u540E 5 \u79D2\u5185\u53EF\u64A4\u9500", "local only, undoable for 5s") },
      h("span", { className: "ght-owner" }, t("\u76F4\u63A5\u751F\u6548 \xB7 \u53EF\u64A4\u9500", "applies immediately"))
    ),
    h(
      Row,
      { label: t("\u6E05\u7A7A\u624B\u52A8\u6392\u5E8F", "Clear manual order") },
      h("button", {
        type: "button",
        className: "ght-btn",
        disabled: !hasOrder,
        onClick: () => {
          ["review", "fix", "rereview", "approved", "ended"].forEach((k) => store.setOrder(k, []));
          toast(t("\u5DF2\u6E05\u7A7A\u624B\u52A8\u6392\u5E8F", "Manual order cleared"));
        }
      }, t("\u6E05\u7A7A", "Clear"))
    )
  );
}
function BadgeSection({ t, store, rules }) {
  return h(
    Section,
    { id: "wt", title: t("Worktree \u5FBD\u6807", "Worktree badges") },
    h(
      Row,
      { label: t("\u663E\u793A\u72B6\u6001\u5FBD\u6807", "Show status badges"), hint: t("\u5728 worktree \u5206\u652F\u540D\u540E\u9762\u3001PR# \u524D\u9762", "after the branch label, before PR#") },
      h(Switch, { checked: rules.badgeEnabled, label: "badgeEnabled", onChange: (v) => store.setRules({ badgeEnabled: v }) })
    ),
    h(
      Row,
      { label: t("\u5FBD\u6807\u4E0A\u663E\u793A\u505C\u7559\u65F6\u957F", "Show age on badge") },
      h(Seg, { value: rules.badgeAge, options: [["never", t("\u4E0D\u663E\u793A", "Never")], ["overdue", t("\u4EC5\u8D85\u65F6", "Overdue only")], ["always", t("\u603B\u662F", "Always")]], onChange: (v) => store.setRules({ badgeAge: v }) })
    ),
    h(
      Row,
      { label: t("\u600E\u6837\u628A worktree \u5BF9\u5E94\u5230 PR", "How worktrees map to PRs"), stack: true },
      h(
        "div",
        { className: "ght-checks" },
        h("label", { className: "ght-ck" }, h("input", { type: "checkbox", checked: true, disabled: true }), t("\u624B\u52A8\u7ED1\u5B9A\u7684", "Manual bindings"), h("small", null, t("\u59CB\u7EC8\u4F18\u5148", "always first"))),
        h("label", { className: "ght-ck" }, h("input", { type: "checkbox", checked: rules.linkByPr, onChange: (e) => store.setRules({ linkByPr: e.target.checked }) }), t("\u5BA2\u6237\u7AEF\u300C\u4ECE PR \u521B\u5EFA\u300D\u65F6\u8BB0\u5F55\u7684 PR \u53F7", "PR number recorded by the host")),
        h("label", { className: "ght-ck" }, h("input", { type: "checkbox", checked: rules.linkByBranch, onChange: (e) => store.setRules({ linkByBranch: e.target.checked }) }), t("\u5206\u652F\u540D\u548C PR \u7684 head \u5206\u652F\u4E00\u81F4", "branch equals the PR head branch"))
      )
    ),
    h(
      Row,
      { label: t("\u70B9\u51FB\u5FBD\u6807", "Badge click") },
      h(Seg, { value: rules.badgeClick, options: [["detail", t("\u6253\u5F00\u6D41\u8F6C\u8BE6\u60C5", "Open details")], ["github", t("\u5728 GitHub \u6253\u5F00", "Open GitHub")]], onChange: (v) => store.setRules({ badgeClick: v }) })
    ),
    h(
      Row,
      { label: t("\u4FA7\u680F\u5165\u53E3\u663E\u793A\u5F85\u529E\u6570", "Sidebar count") },
      h(Switch, { checked: rules.navCount, label: "navCount", onChange: (v) => store.setRules({ navCount: v }) })
    )
  );
}
function SyncSection({ t, store, rules, state, onSync }) {
  return h(
    Section,
    { id: "sync", title: t("\u540C\u6B65\u4E0E\u7EDF\u8BA1", "Sync & stats") },
    h(
      Row,
      { label: t("\u81EA\u52A8\u540C\u6B65", "Auto sync"), hint: t("\u6BCF\u4E2A\u4ED3\u5E93\u6BCF\u6B21\u7EA6 2\u20134 \u6B21 gh \u8C03\u7528", "2\u20134 gh calls per repo") },
      h(
        "select",
        { className: "ght-sel", value: rules.interval, onChange: (e) => store.setRules({ interval: e.target.value }) },
        [["5", t("\u6BCF 5 \u5206\u949F", "Every 5 min")], ["15", t("\u6BCF 15 \u5206\u949F", "Every 15 min")], ["30", t("\u6BCF 30 \u5206\u949F", "Every 30 min")], ["60", t("\u6BCF\u5C0F\u65F6", "Hourly")], ["0", t("\u4EC5\u624B\u52A8", "Manual only")]].map(([v, label]) => h("option", { key: v, value: v }, label))
      )
    ),
    h(
      Row,
      { label: t("\u4EC5\u5728\u7A97\u53E3\u6FC0\u6D3B\u65F6\u540C\u6B65", "Only when foreground") },
      h(Switch, { checked: rules.foregroundOnly, label: "foregroundOnly", onChange: (v) => store.setRules({ foregroundOnly: v }) })
    ),
    h(
      Row,
      { label: t("\u6BCF\u5929\u4ECE\u51E0\u70B9\u7B97\u8D77", "Day starts at"), hint: t("\u5F71\u54CD\u300C\u4ECA\u65E5\u65B0\u589E\u300D\u300C\u4ECA\u65E5\u6D41\u8F6C\u300D\u548C\u6BCF\u65E5\u7EDF\u8BA1", "affects today metrics") },
      h(
        "select",
        { className: "ght-sel", value: String(rules.dayCutoff), onChange: (e) => store.setRules({ dayCutoff: Number(e.target.value) }) },
        [0, 4, 6].map((hour) => h("option", { key: hour, value: String(hour) }, `${pad3(hour)}:00`))
      )
    ),
    h(
      Row,
      { label: t("\u7ACB\u5373\u540C\u6B65", "Sync now"), hint: state.runtime.lastSync ? `${t("\u4E0A\u6B21", "Last")} ${new Date(state.runtime.lastSync).toLocaleString()}` : t("\u8FD8\u6CA1\u540C\u6B65\u8FC7", "Never synced") },
      h("button", { type: "button", className: "ght-btn", onClick: onSync, disabled: state.runtime.syncing }, h(Icon, { name: "refresh", size: 13 }), t("\u540C\u6B65", "Sync"))
    )
  );
}
function LocalSection({ t, store, state, toast }) {
  const marks = Object.values(state.local.marks).reduce((a, list) => a + list.length, 0);
  const binds = Object.keys(state.local.bindings).length;
  const ignored = state.local.ignored.length;
  return h(
    Section,
    { id: "local", title: t("\u672C\u5730\u6570\u636E", "Local data") },
    h(
      Row,
      { label: t("\u624B\u52A8\u6807\u8BB0\u3001worktree \u7ED1\u5B9A\u4E0E\u5FFD\u7565", "Marks, bindings and ignores"), hint: t(`\u6807\u8BB0 ${marks} \u6761\uFF08\u542B\u62D6\u62FD\uFF09\xB7 \u7ED1\u5B9A ${binds} \u4E2A \xB7 \u5FFD\u7565 ${ignored} \u4E2A PR`, `${marks} marks \xB7 ${binds} bindings \xB7 ${ignored} ignored`) },
      h("button", { type: "button", className: "ght-btn", disabled: !(marks || binds || ignored), onClick: () => {
        store.clearLocal();
        toast(t("\u5DF2\u6E05\u7A7A\u672C\u5730\u6807\u8BB0\u3001\u7ED1\u5B9A\u548C\u5FFD\u7565", "Local data cleared"));
      } }, t("\u6E05\u7A7A", "Clear"))
    ),
    h(
      Row,
      { label: t("\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E", "Restore defaults") },
      h("button", { type: "button", className: "ght-btn", onClick: () => {
        store.resetConfig();
        toast(t("\u5DF2\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E", "Defaults restored"));
      } }, t("\u6062\u590D\u9ED8\u8BA4", "Restore"))
    )
  );
}
var ROADMAP = [
  {
    key: "gitlab",
    tone: "blue",
    status: ["\u89C4\u5212\u4E2D", "Planned"],
    title: ["GitLab \u652F\u6301", "GitLab support"],
    desc: [
      "\u7528 glab \u8BFB\u53D6 GitLab MR \u7684\u5BA1\u67E5 / \u6279\u51C6 / \u63D0\u4EA4\u4E0E\u65F6\u95F4\u7EBF\uFF0C\u590D\u7528\u540C\u4E00\u5957\u6D41\u8F6C\u770B\u677F\uFF1B\u9700\u8981\u5148\u786E\u8BA4 gitlab.com \u4E0E\u81EA\u5EFA\u5B9E\u4F8B\u7684\u767B\u5F55\u65B9\u5F0F\u548C MR \u5BA1\u67E5\u8BED\u4E49\u6620\u5C04\u3002",
      "Read GitLab MR reviews, approvals, commits and timeline via glab and reuse the same flow board. Needs decisions on gitlab.com vs self-hosted auth and MR review mapping."
    ]
  },
  {
    key: "ai",
    tone: "blue",
    status: ["\u89C4\u5212\u4E2D", "Planned"],
    title: ["AI \u81EA\u52A8\u5BA1\u67E5", "AI pre-review"],
    desc: [
      "\u540E\u53F0\u7528\u4E00\u4E2A\u53EA\u8BFB AI \u8F6E\u6B21\u7ED9\u51FA\u9884\u5BA1\u5EFA\u8BAE\uFF0C\u7ED3\u679C\u53EA\u5C55\u793A\u3001\u4E0D\u81EA\u52A8\u63D0\u4EA4\u5BA1\u67E5\uFF1B\u9700\u8981\u989D\u5916\u7684\u6A21\u578B/\u4F1A\u8BDD\u6743\u9650\u3002",
      "A read-only AI turn drafts review suggestions. Suggestions are shown only, never submitted automatically."
    ]
  },
  {
    key: "write",
    tone: "neutral",
    status: ["\u540E\u7EED", "Later"],
    title: ["\u81EA\u52A8\u8BC4\u8BBA / \u6279\u51C6 / \u5408\u5E76", "Auto comment / approve / merge"],
    desc: [
      "\u9700\u8981\u663E\u5F0F\u6388\u6743\u4E0E\u4E8C\u6B21\u786E\u8BA4\uFF0C\u9ED8\u8BA4\u5173\u95ED\uFF1B\u5F53\u524D\u63D2\u4EF6\u5BF9 GitHub \u53EA\u8BFB\u3002",
      "Requires explicit opt-in and confirmation, off by default. The plugin is read-only today."
    ]
  },
  {
    key: "notify",
    tone: "neutral",
    status: ["\u540E\u7EED", "Later"],
    title: ["\u98DE\u4E66 / \u7CFB\u7EDF\u901A\u77E5", "Feishu / system notifications"],
    desc: [
      "PR \u8D85\u65F6\u3001\u4F5C\u8005\u4FEE\u590D\u3001\u91CD\u65B0\u8BF7\u6C42\u5BA1\u67E5\u65F6\u63A8\u9001\uFF1B\u9700\u8981\u7F51\u7EDC\u4E0E\u901A\u77E5\u6743\u9650\u3002",
      "Notify on overdue PRs, author fixes and re-review requests; needs network and notification permissions."
    ]
  },
  {
    key: "dragwrite",
    tone: "neutral",
    status: ["\u540E\u7EED", "Later"],
    title: ["\u62D6\u62FD\u89E6\u53D1 GitHub \u64CD\u4F5C", "Drag to write GitHub"],
    desc: [
      "\u770B\u677F\u62D6\u62FD\u76F4\u63A5 Request changes / Approve\u3002\u5F53\u524D\u62D6\u62FD\u53EA\u8BB0\u672C\u5730\u6807\u8BB0\uFF0C\u53EF\u64A4\u9500\u3001\u4E0D\u5199 GitHub\u3002",
      "Dragging would Request changes / Approve on GitHub. Today it only records a local, undoable mark."
    ]
  },
  {
    key: "issue",
    tone: "neutral",
    status: ["\u540E\u7EED", "Later"],
    title: ["Issue \u770B\u677F", "Issue board"],
    desc: [
      "\u628A Issue \u4E5F\u7EB3\u5165\u540C\u4E00\u5957\u6D41\u8F6C\u89C6\u56FE\uFF0C\u4E0E PR \u5206\u5F00\u7EDF\u8BA1\u3002",
      "Bring issues into the same flow view, counted separately from PRs."
    ]
  }
];
function RoadmapItem({ t, item }) {
  return h(
    "div",
    { className: "ght-roadmap-item" },
    h(
      "div",
      { className: "ght-roadmap-body" },
      h(
        "div",
        { className: "ght-roadmap-title" },
        t(item.title[0], item.title[1]),
        h("span", { className: `ght-chip ght-chip-sm ght-tone-${item.tone}` }, t(item.status[0], item.status[1]))
      ),
      h("div", { className: "ght-roadmap-desc" }, t(item.desc[0], item.desc[1]))
    )
  );
}
function RoadmapSection({ t }) {
  return h(
    Section,
    { id: "roadmap", title: t("\u8DEF\u7EBF\u56FE", "Roadmap"), sub: t("\u5C1A\u672A\u5B9E\u73B0\uFF0C\u4E0D\u4F1A\u7533\u8BF7\u5BF9\u5E94\u6743\u9650", "Not implemented yet; no extra permissions requested") },
    h(
      "div",
      { className: "ght-roadmap" },
      ROADMAP.map((item) => h(RoadmapItem, { key: item.key, t, item })),
      h(
        "div",
        { className: "ght-roadmap-note" },
        t(
          "\u8DEF\u7EBF\u56FE\u4F1A\u968F\u7248\u672C\u66F4\u65B0\uFF1B\u5B9E\u73B0\u524D\u4E0D\u4F1A\u5728 manifest \u91CC\u7533\u8BF7\u8FD9\u4E9B\u80FD\u529B\u3002",
          "This list evolves; capabilities are not requested in the manifest before they ship."
        )
      )
    )
  );
}
function SettingsNav({ t, active, onPick }) {
  return h(
    "nav",
    { className: "ght-m-nav" },
    SECTIONS.map(
      ([key, zh, en]) => h("button", { key, type: "button", className: cx(active === key && "on"), onClick: () => onPick(key) }, t(zh, en))
    )
  );
}
function useSectionSpy(active, setActive) {
  const bodyRef = React.useRef(null);
  const scrollTo = (id) => {
    setActive(id);
    const body = bodyRef.current;
    const target = body?.querySelector(`[data-sec="${id}"]`);
    if (!body || !target) return;
    if (typeof body.scrollTo === "function") {
      body.scrollTo({ top: target.offsetTop - 12, behavior: "smooth" });
    } else {
      body.scrollTop = target.offsetTop - 12;
    }
  };
  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    let current = SECTIONS[0][0];
    body.querySelectorAll("[data-sec]").forEach((el) => {
      if (el.offsetTop - body.scrollTop <= 40) current = el.dataset.sec;
    });
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) {
      current = SECTIONS[SECTIONS.length - 1][0];
    }
    if (current !== active) setActive(current);
  };
  return { bodyRef, scrollTo, onScroll };
}
function SettingsBody({ t, ctx, store, index, rules, defs, counts: counts2, now, toast, onSync }) {
  void ctx;
  void now;
  const [active, setActive] = React.useState("src");
  const state = store.getSnapshot();
  const { bodyRef, scrollTo, onScroll } = useSectionSpy(active, setActive);
  const shared = { t, store, state, rules, defs, counts: counts2, toast, onSync };
  return h(
    "div",
    { className: "ght-set-main" },
    h(SettingsNav, { t, active, onPick: scrollTo }),
    h(
      "div",
      { className: "ght-m-body", ref: bodyRef, onScroll },
      h(SourceSection, { ...shared, index }),
      h(ScopeSection, shared),
      h(RulesSection, shared),
      h(TimeoutSection, shared),
      h(LookSection, shared),
      h(BoardSection, shared),
      h(BadgeSection, shared),
      h(SyncSection, shared),
      h(LocalSection, shared),
      h(RoadmapSection, { t }),
      h("div", { className: "ght-m-foot-note" }, t("\u540C\u4E00\u4EFD\u8BBE\u7F6E\u4E5F\u5728\u300C\u5BA2\u6237\u7AEF\u8BBE\u7F6E \u203A \u63D2\u4EF6 \u203A CCGUI \xB7 Git \u4EFB\u52A1\u7BA1\u7406\u300D", "The same settings live under Settings \u203A Plugins"))
    )
  );
}
function SettingsModal({ t, ctx, store, index, rules, defs, counts: counts2, now, toast, onClose, onSync }) {
  return [
    h("div", { key: "scrim", className: "ght-mscrim", onClick: onClose }),
    h(
      "div",
      { key: "modal", className: "ght-modal ght-set-modal", role: "dialog", "aria-label": t("\u8BBE\u7F6E", "Settings") },
      h(
        "div",
        { className: "ght-m-head" },
        h("div", null, h("b", null, t("\u8BBE\u7F6E \xB7 Git \u4EFB\u52A1\u7BA1\u7406", "Settings \xB7 Git Tasks")), h("div", { className: "ght-m-sub" }, t("\u6539\u52A8\u5373\u65F6\u751F\u6548 \u2014\u2014 \u5F39\u7A97\u540E\u9762\u7684\u770B\u677F\u3001\u5DE6\u4FA7\u4FA7\u680F\u5FBD\u6807\u4F1A\u8DDF\u7740\u53D8", "Changes apply immediately"))),
        h("span", { className: "ght-sp" }),
        h("button", { type: "button", className: "ght-icon-btn ght-bare", onClick: onClose, title: t("\u5173\u95ED\uFF08Esc\uFF09", "Close (Esc)") }, h(Icon, { name: "x", size: 15 }))
      ),
      h(SettingsBody, { t, ctx, store, index, rules, defs, counts: counts2, now, toast, onSync }),
      h("div", { className: "ght-m-foot" }, h("span", { className: "ght-m-note" }, t("\u53EA\u8BFB gh \xB7 \u4E0D\u5199 GitHub", "read-only gh \xB7 no writes")), h("span", { className: "ght-sp" }), h("button", { type: "button", className: "ght-btn ght-btn-pri", onClick: onClose }, t("\u5B8C\u6210", "Done")))
    )
  ];
}

// src/ui/BindModal.js
function Option({ active, disabled, onSelect, title, desc }) {
  return h(
    "div",
    {
      className: cx("ght-opt", active && "on", disabled && "off"),
      onClick: disabled ? void 0 : onSelect,
      role: "button",
      tabIndex: disabled ? -1 : 0,
      onKeyDown: (event) => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) onSelect();
      }
    },
    h("span", { className: "ght-radio" }),
    h("div", null, h("b", null, title), h("p", null, desc))
  );
}
function CandidateList({ t, cands, pick, onPick }) {
  if (!cands.length) {
    return h("div", { className: "ght-pick-empty" }, t("\u8FD9\u4E2A\u4ED3\u5E93\u4E0B\u8FD8\u6CA1\u6709 worktree", "No worktrees under this repository"));
  }
  return h(
    "div",
    { className: "ght-picks" },
    cands.map(
      (c) => h(
        "button",
        {
          key: c.wt.workspaceId,
          type: "button",
          className: cx("ght-pick", pick === c.wt.workspaceId && "on"),
          disabled: c.disabled,
          onClick: () => onPick(c.wt.workspaceId)
        },
        h("span", { className: "ght-radio" }),
        h(Icon, { name: "branch", size: 13 }),
        h("span", { className: "ght-pick-l" }, c.wt.name),
        h("span", { className: "ght-mono ght-pick-b" }, c.wt.branch),
        h("span", { className: "ght-sp" }),
        h("span", { className: `ght-pick-s ght-${c.state}` }, c.text)
      )
    )
  );
}
function CreatePreview({ t, pr, branch, repo }) {
  return h(
    "div",
    { className: "ght-create-pv" },
    h("div", null, h("span", null, t("\u5206\u652F", "Branch")), h("code", null, branch)),
    h(
      "div",
      null,
      h("span", null, t("\u6765\u6E90", "Source")),
      h("code", null, `pull/${pr.number}/head`),
      h("small", null, `${pr.author}:${pr.headRefName}`)
    ),
    h(
      "div",
      null,
      h("span", null, t("\u4F4D\u7F6E", "Path")),
      h("code", null, repo ? `${repo.path}-worktrees/${branch}` : "\u2014")
    )
  );
}
function useCreateWorktree({ t, ctx, store, index, pr, repo, branch, toast, onClose }) {
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState(null);
  const create = async () => {
    if (!repo) {
      setError(t("\u627E\u4E0D\u5230\u8FD9\u4E2A\u4ED3\u5E93\u5BF9\u5E94\u7684\u5DE5\u4F5C\u533A\uFF0C\u65E0\u6CD5\u521B\u5EFA", "No workspace found for this repository"));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const result = await ctx.worktrees.create({
        repoPath: repo.path,
        parentWorkspaceId: repo.workspaceId,
        branch,
        prNumber: pr.number,
        prTitle: pr.title,
        prUrl: pr.url
      });
      const snapshot = await index.refresh();
      const created = snapshot.worktrees.find((w) => w.path === result.worktreePath);
      if (created) {
        store.bind(pr.key, created.workspaceId);
        store.markReviewing(pr.key, Date.now());
      }
      toast(t(`worktree ${branch} \u5DF2\u521B\u5EFA`, `Worktree ${branch} created`));
      onClose();
    } catch (err) {
      const message = err?.message || String(err);
      setError(t(`\u521B\u5EFA\u5931\u8D25\uFF1A${message}`, `Create failed: ${message}`));
    } finally {
      setCreating(false);
    }
  };
  return { creating, error, create };
}
function BindFooter({ t, mode, pick, creating, onCancel, onConfirm }) {
  return h(
    "div",
    { className: "ght-m-foot" },
    h(
      "span",
      { className: "ght-m-note" },
      mode === "bind" ? t("\u7ED1\u5B9A\u5173\u7CFB\u5B58\u5728\u63D2\u4EF6\u672C\u5730\uFF0C\u968F\u65F6\u53EF\u4EE5\u89E3\u9664", "Stored locally; you can unlink anytime") : t("\u521B\u5EFA\u5B8C\u6210\u540E\u81EA\u52A8\u5BF9\u5E94\u5230\u8FD9\u4E2A PR", "Links automatically once created")
    ),
    h("span", { className: "ght-sp" }),
    h("button", { type: "button", className: "ght-btn", onClick: onCancel }, t("\u53D6\u6D88", "Cancel")),
    h(
      "button",
      {
        type: "button",
        className: "ght-btn ght-btn-pri",
        disabled: creating || mode === "bind" && !pick,
        onClick: onConfirm
      },
      creating ? t("\u521B\u5EFA\u4E2D\u2026", "Creating\u2026") : mode === "bind" ? t("\u7ED1\u5B9A", "Link") : t("\u521B\u5EFA worktree", "Create worktree")
    )
  );
}
function BindBody({ t, mode, setMode, cands, pick, setPick, firstFree, pr, branch, repo, error }) {
  return h(
    "div",
    { className: "ght-bind-body" },
    h(Option, {
      active: mode === "bind",
      disabled: !cands.some((c) => !c.disabled),
      onSelect: () => {
        setMode("bind");
        if (pick == null) setPick(firstFree?.wt.workspaceId ?? null);
      },
      title: t("\u7ED1\u5B9A\u5DF2\u6709\u7684 worktree", "Link an existing worktree"),
      desc: t(
        "\u53EA\u5728\u63D2\u4EF6\u91CC\u8BB0\u4E00\u7B14\u5BF9\u5E94\u5173\u7CFB\uFF0C\u4E0D\u52A8 git\u3001\u4E0D\u5207\u5206\u652F\u3002\u7ED1\u5B9A\u540E\u8FD9\u4E2A worktree \u7684\u4FA7\u680F\u5FBD\u6807\u663E\u793A\u8FD9\u4E2A PR \u7684\u72B6\u6001\u3002",
        "Stored in the plugin only; no git operations. The sidebar badge then shows this PR's state."
      )
    }),
    mode === "bind" ? h(CandidateList, { t, cands, pick, onPick: setPick }) : null,
    h(Option, {
      active: mode === "create",
      onSelect: () => setMode("create"),
      title: t("\u65B0\u5EFA worktree\uFF08\u4ECE PR \u521B\u5EFA\uFF09", "Create a worktree from this PR"),
      desc: t(
        "\u8D70\u5BA2\u6237\u7AEF\u300C\u65B0\u5EFA Worktree \u203A \u4ECE PR \u521B\u5EFA\u300D\u540C\u4E00\u6761\u7BA1\u7EBF\uFF0C\u4FA7\u680F\u4F1A\u51FA\u73B0\u521B\u5EFA\u8FDB\u5EA6\uFF1Bfork \u7684 PR \u4E5F\u9002\u7528\u3002",
        "Uses the host's create-from-PR pipeline; progress appears in the sidebar. Works for forks."
      )
    }),
    mode === "create" ? h(CreatePreview, { t, pr, branch, repo }) : null,
    error ? h("div", { className: "ght-bind-error" }, error) : null
  );
}
function useBindState({ pr, index, wts, prs, bindings, rules }) {
  const cands = bindCandidates(pr, { wts, prs, bindings, rules });
  const firstFree = cands.find((c) => !c.disabled) || null;
  const [mode, setMode] = React.useState(firstFree ? "bind" : "create");
  const [pick, setPick] = React.useState(firstFree ? firstFree.wt.workspaceId : null);
  const branch = React.useMemo(() => newBranchName(pr), [pr.number]);
  const repo = index.getSnapshot().repos.find((r) => r.slug === pr.repoSlug);
  return { cands, firstFree, mode, setMode, pick, setPick, branch, repo };
}
function confirmBind({ store, cands, pick, pr, t, toast, onClose }) {
  if (!pick) return;
  const candidate = cands.find((c) => c.wt.workspaceId === pick);
  store.bind(pr.key, pick);
  store.markReviewing(pr.key, Date.now());
  toast(
    candidate?.state === "taken" ? t(`\u5DF2\u7ED1\u5B9A ${candidate.wt.name}\uFF08\u5DF2\u89E3\u9664\u539F\u6765\u7684\u5BF9\u5E94\uFF09`, `Linked ${candidate.wt.name} (previous link removed)`) : t(`\u5DF2\u7ED1\u5B9A ${candidate?.wt.name || ""} \u2194 #${pr.number}`, `Linked ${candidate?.wt.name || ""} \u2194 #${pr.number}`)
  );
  onClose();
}
function BindModal({ t, ctx, store, index, pr, wts, prs, bindings, rules, toast, onClose }) {
  const { cands, firstFree, mode, setMode, pick, setPick, branch, repo } = useBindState({ pr, index, wts, prs, bindings, rules });
  const creation = useCreateWorktree({ t, ctx, store, index, pr, repo, branch, toast, onClose });
  const confirm = () => {
    if (mode !== "bind") creation.create();
    else confirmBind({ store, cands, pick, pr, t, toast, onClose });
  };
  return [
    h("div", { key: "scrim", className: "ght-mscrim", onClick: onClose }),
    h(
      "div",
      { key: "modal", className: "ght-modal ght-bind-modal", role: "dialog", "aria-label": t("\u5173\u8054 worktree", "Link worktree") },
      h(
        "div",
        { className: "ght-m-head" },
        h("div", null, h("b", null, t("\u5173\u8054 Worktree", "Link worktree")), h("div", { className: "ght-m-sub" }, `${pr.repoSlug} #${pr.number} \xB7 ${pr.title}`)),
        h("span", { className: "ght-sp" }),
        h("button", { type: "button", className: "ght-icon-btn ght-bare", onClick: onClose }, h(Icon, { name: "x", size: 15 }))
      ),
      h(BindBody, {
        t,
        mode,
        setMode,
        cands,
        pick,
        setPick,
        firstFree,
        pr,
        branch,
        repo,
        error: creation.error
      }),
      h(BindFooter, {
        t,
        mode,
        pick,
        creating: creation.creating,
        onCancel: onClose,
        onConfirm: confirm
      })
    )
  ];
}

// src/ui/Panel.js
var FILTERS = [
  ["all", "\u5168\u90E8", "All"],
  ["mine", "\u7B49\u6211\u5904\u7406", "Yours"],
  ["author", "\u7B49\u4F5C\u8005", "Author"],
  ["merge", "\u7B49\u5408\u5E76", "Merge"],
  ["today", "\u4ECA\u65E5\u65B0\u589E", "New today"],
  ["done", "\u5DF2\u7ED3\u675F", "Finished"]
];
function relTime(ms, now, t) {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 6e4);
  if (min < 1) return t("\u521A\u521A", "just now");
  if (min < 60) return t(`${min} \u5206\u949F\u524D`, `${min}m ago`);
  const hours = Math.floor(min / 60);
  if (hours < 24) return t(`${hours} \u5C0F\u65F6\u524D`, `${hours}h ago`);
  return t(`${Math.floor(hours / 24)} \u5929\u524D`, `${Math.floor(hours / 24)}d ago`);
}
function useToast() {
  const [toast, setToast] = React.useState(null);
  const timer = React.useRef(null);
  const show = React.useCallback((message, undo) => {
    clearTimeout(timer.current);
    const dismiss = (next) => {
      setToast(null);
      if (next) setTimeout(() => show(next), 0);
    };
    setToast({ message, undo, dismiss });
    timer.current = setTimeout(() => setToast(null), undo ? 5e3 : 2600);
  }, []);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show];
}
function useTrackedRows(store, index, now) {
  const state = useStore(store);
  const workspaces = useStore(index);
  const repoIndexMap = React.useMemo(
    () => new Map(state.cfg.repos.map((r, i) => [r.slug, i])),
    [state.cfg.repos]
  );
  const ignoredSet = React.useMemo(() => new Set(state.local.ignored), [state.local.ignored]);
  const prs = React.useMemo(() => {
    const ignored = ignoredSet;
    return store.allPrs().map((pr) => ({
      ...pr,
      ignored: ignored.has(pr.key),
      repoIndex: repoIndexMap.get(pr.repoSlug) ?? 0
    }));
  }, [state.snapshots, state.local.marks, ignoredSet, repoIndexMap, store]);
  const meSet = React.useMemo(
    () => new Set(
      [state.runtime.ghLogin, ...state.cfg.extraAccounts].filter(Boolean).map((v) => String(v).toLowerCase())
    ),
    [state.runtime.ghLogin, state.cfg.extraAccounts]
  );
  const reposEnabled = React.useMemo(() => {
    const map = {};
    for (const repo of state.cfg.repos) map[repo.slug] = repo.enabled && repo.available !== false;
    return map;
  }, [state.cfg.repos]);
  const rows = React.useMemo(
    () => selectRows(prs, {
      rules: state.cfg.rules,
      meSet,
      repoFilter: state.ui.repoFilter,
      reposEnabled,
      showIgnored: state.ui.showIgnored,
      wts: workspaces.worktrees,
      bindings: state.local.bindings,
      reviewingSince: state.local.reviewing,
      now
    }),
    [
      prs,
      state.cfg.rules,
      meSet,
      state.ui.repoFilter,
      reposEnabled,
      state.ui.showIgnored,
      workspaces.worktrees,
      state.local.bindings,
      state.local.reviewing,
      now
    ]
  );
  return { state, prs, rows, workspaces };
}
function useMetrics(state, rows, prs, now, selectedSlugs) {
  const { defs, rules } = state.cfg;
  const c = React.useMemo(
    () => counts(rows, { defs, rules, now, excluded: prs.length - rows.length }),
    [rows, defs, rules, now, prs.length]
  );
  const flow = React.useMemo(() => todayFlow(prs, rules, now), [prs, rules, now]);
  const chart = React.useMemo(() => {
    const full = dailySeries(state.snapshots, state.cfg.repos, rules, now);
    const keep = full.series.map((repo, index) => ({ repo, index })).filter(({ repo }) => selectedSlugs.includes(repo.slug));
    return {
      series: keep.map(({ repo }) => repo),
      days: full.days.map((day) => ({
        ...day,
        vals: keep.map(({ index }) => day.vals[index])
      }))
    };
  }, [state.snapshots, state.cfg.repos, rules, now, selectedSlugs.join("|")]);
  const flows = React.useMemo(() => flowByDay(prs, rules, now), [prs, rules, now]);
  return { c, flow, chart, flows };
}
function usePanelActions({ store, exec, sync, showToast, t }) {
  return React.useMemo(
    () => ({
      ghOpen: (url) => exec.openUrl(url).catch((error) => showToast(describeGhError(error))),
      openPr: (key) => store.setUi({ drawerKey: key, modal: null }),
      openBind: (key) => store.setUi({ modal: { type: "bind", prKey: key } }),
      onWorktree: (wt) => {
        const text = wt.path || "";
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(
            () => showToast(t(`\u5DF2\u590D\u5236\u8DEF\u5F84\uFF1A${text}`, `Path copied: ${text}`)),
            () => showToast(text)
          );
        } else {
          showToast(text);
        }
      },
      dismissError: (slug) => {
        const errors = { ...store.getSnapshot().runtime.errors || {} };
        delete errors[slug];
        store.setRuntime({ errors });
      },
      dismissGlobalError: () => store.setRuntime({ ghError: null }),
      retryRepo: async (slug) => {
        const result = await sync.run([{ slug, enabled: true, available: true }]);
        if (result?.errors?.[slug]) showToast(result.errors[slug]);
        else showToast(t(`${slug} \u5DF2\u6062\u590D`, `${slug} recovered`));
      },
      refreshPr: async (pr) => {
        if (!sync.refreshPr) return;
        try {
          const updated = await sync.refreshPr(pr.key);
          if (!updated) {
            showToast(t("\u8FD9\u4E2A PR \u4E0D\u5728\u5F53\u524D\u540C\u6B65\u7ED3\u679C\u91CC\uFF0C\u8BF7\u5148\u6574\u4F53\u540C\u6B65", "PR is not in the current snapshot; sync first"));
            return;
          }
          const label = updated.state === "MERGED" ? t("\u5DF2\u5408\u5E76", "merged") : updated.state === "CLOSED" ? t("\u5DF2\u5173\u95ED", "closed") : t("\u4ECD\u5728\u8FDB\u884C\u4E2D", "still open");
          showToast(t(`\u5DF2\u5237\u65B0 #${updated.number}\uFF1A${label}`, `#${updated.number} refreshed: ${label}`));
        } catch (error) {
          showToast(describeGhError(error));
        }
      },
      syncNow: async () => {
        await sync.run();
        const snapshot = store.getSnapshot();
        const errors = Object.entries(snapshot.runtime.errors || {});
        if (errors.length) showToast(errors[0][1]);
        else if (snapshot.runtime.ghError) showToast(snapshot.runtime.ghError);
        else showToast(t("\u5DF2\u540C\u6B65", "Synced"));
      }
    }),
    [store, exec, sync, showToast, t]
  );
}
function Toast({ toast, t }) {
  if (!toast) return null;
  return h(
    "div",
    { className: cx("ght-toast", toast.undo && "ght-toast-act") },
    h("span", null, toast.message),
    toast.undo ? h(
      "button",
      {
        type: "button",
        onClick: () => {
          toast.undo();
          toast.dismiss(t("\u5DF2\u64A4\u9500", "Undone"));
        }
      },
      t("\u64A4\u9500", "Undo")
    ) : null
  );
}
function usePanelModel({ store, index, exec, sync, t }) {
  const coarse = useNow(6e4);
  const { state, prs, rows, workspaces } = useTrackedRows(store, index, coarse);
  const enabledRepos = state.cfg.repos.filter((r) => r.enabled && r.available !== false);
  const filterValue = state.ui.repoFilter;
  const filterList = filterValue === "all" ? null : Array.isArray(filterValue) ? filterValue : [filterValue];
  const selectedSlugs = filterList === null ? enabledRepos.map((r) => r.slug) : filterList.filter((slug) => enabledRepos.some((r) => r.slug === slug));
  const visiblePrs = React.useMemo(
    () => state.ui.repoFilter === "all" ? prs : prs.filter((pr) => selectedSlugs.includes(pr.repoSlug)),
    [prs, state.ui.repoFilter, selectedSlugs.join("|")]
  );
  const metrics = useMetrics(state, rows, visiblePrs, coarse, selectedSlugs);
  const now = useNow(state.runtime.syncing ? 1e3 : 6e4);
  const [toast, showToast] = useToast();
  const actions = usePanelActions({ store, exec, sync, showToast, t });
  const missingReviewSince = rows.filter((row) => row.d.key === "reviewing" && !state.local.reviewing[row.pr.key]).map((row) => row.pr.key).join("\n");
  React.useEffect(() => {
    if (!missingReviewSince) return;
    for (const key of missingReviewSince.split("\n")) store.markReviewing(key, Date.now());
  }, [missingReviewSince, store]);
  const filterFn = React.useCallback(
    (row) => {
      switch (state.ui.filter) {
        case "mine":
          return state.cfg.defs[row.d.key].owner === "me";
        case "author":
          return state.cfg.defs[row.d.key].owner === "author";
        case "merge":
          return state.cfg.defs[row.d.key].owner === "merge";
        case "done":
          return state.cfg.defs[row.d.key].owner === "done";
        case "today":
          return row.pr.createdAt >= dayStart(Date.now(), state.cfg.rules.dayCutoff);
        default:
          return true;
      }
    },
    [state.ui.filter, state.cfg.defs, state.cfg.rules.dayCutoff]
  );
  useEscape(() => store.setUi({ modal: null, drawerKey: null }), true);
  const selectedPr = state.ui.drawerKey ? prs.find((p) => p.key === state.ui.drawerKey) : null;
  return { ...metrics, now, state, prs, rows, toast, showToast, actions, workspaces, enabledRepos, selectedSlugs, filterFn, selectedPr };
}
function nextRepoFilter(state, enabledRepos, slug) {
  const all = enabledRepos.map((r) => r.slug);
  if (slug === "all") return "all";
  const current = state.ui.repoFilter === "all" ? all.slice() : [...state.ui.repoFilter];
  let next;
  if (state.ui.repoFilter === "all") next = [slug];
  else if (current.includes(slug)) next = current.filter((s) => s !== slug);
  else next = [...current, slug];
  const ordered = all.filter((s) => next.includes(s));
  return !ordered.length || ordered.length === all.length ? "all" : ordered;
}
function PanelContent({ t, store, model }) {
  const { state, rows, enabledRepos, selectedSlugs, now, actions, c, flow, chart, flows, workspaces, prs, filterFn, showToast } = model;
  return h(
    "div",
    { className: "ght-scroller" },
    h(
      "div",
      { className: "ght-pv" },
      h(PanelHeader, {
        t,
        state,
        rows,
        enabledRepos,
        selectedSlugs,
        now,
        onSync: actions.syncNow,
        onRetry: actions.retryRepo,
        onDismiss: actions.dismissError,
        onDismissAll: actions.dismissGlobalError,
        onOpenSettings: () => store.setUi({ modal: "settings" }),
        onPickRepo: (slug) => store.setUi({ repoFilter: nextRepoFilter(state, enabledRepos, slug) })
      }),
      h(Kpis, {
        t,
        c,
        flow,
        chart,
        defs: state.cfg.defs,
        filter: state.ui.filter,
        setFilter: (f) => store.setUi({ filter: f })
      }),
      h(MetricsGrid, { t, store, state, chart, flows, flow }),
      h(WorkSection, {
        t,
        state,
        store,
        action: actions,
        rows,
        filterFn,
        now,
        enabledRepos,
        workspaces,
        prs,
        filterCounts: c,
        onBind: actions.openBind,
        onWorktree: actions.onWorktree,
        toast: showToast
      })
    )
  );
}
function createPanel({ ctx, t, store, index, exec, sync }) {
  function Panel() {
    const model = usePanelModel({ store, index, exec, sync, t });
    return h(
      "div",
      { className: "ght-root" },
      h(PanelContent, { t, store, model }),
      h(Overlays, {
        t,
        ctx,
        store,
        index,
        state: model.state,
        now: model.now,
        prs: model.prs,
        workspaces: model.workspaces,
        selectedPr: model.selectedPr,
        counts: model.c,
        toast: model.toast,
        showToast: model.showToast,
        actions: model.actions
      })
    );
  }
  return Panel;
}
function DrawerLayer({ t, ctx, store, index, state, now, prs, workspaces, selectedPr, showToast, actions }) {
  if (!selectedPr) return null;
  return h(Drawer, {
    t,
    ctx,
    store,
    pr: selectedPr,
    rules: state.cfg.rules,
    defs: state.cfg.defs,
    now,
    wts: workspaces.worktrees,
    prs,
    bindings: state.local.bindings,
    index,
    toast: showToast,
    onClose: () => store.setUi({ drawerKey: null }),
    onGh: actions.ghOpen,
    onRefresh: () => actions.refreshPr(selectedPr),
    onBind: actions.openBind,
    onWorktree: actions.onWorktree
  });
}
function SettingsLayer({ t, ctx, store, index, state, now, counts: counts2, showToast, actions }) {
  if (state.ui.modal !== "settings") return null;
  return h(SettingsModal, {
    t,
    ctx,
    store,
    index,
    rules: state.cfg.rules,
    defs: state.cfg.defs,
    counts: counts2,
    now,
    toast: showToast,
    onSync: actions.syncNow,
    onClose: () => store.setUi({ modal: null, drawerKey: null })
  });
}
function BindLayer({ t, ctx, store, index, state, prs, workspaces, showToast }) {
  const bindPr = state.ui.modal?.prKey ? prs.find((p) => p.key === state.ui.modal.prKey) : null;
  if (state.ui.modal?.type !== "bind" || !bindPr) return null;
  return h(BindModal, {
    t,
    ctx,
    store,
    index,
    pr: bindPr,
    wts: workspaces.worktrees,
    prs,
    bindings: state.local.bindings,
    rules: state.cfg.rules,
    toast: showToast,
    onClose: () => store.setUi({ modal: null, drawerKey: null })
  });
}
function Overlays({ t, ctx, store, index, state, now, prs, workspaces, selectedPr, counts: counts2, toast, showToast, actions }) {
  return h(
    React.Fragment,
    null,
    h(DrawerLayer, { t, ctx, store, index, state, now, prs, workspaces, selectedPr, showToast, actions }),
    h(SettingsLayer, { t, ctx, store, index, state, now, counts: counts2, showToast, actions }),
    h(BindLayer, { t, ctx, store, index, state, prs, workspaces, showToast }),
    h(Toast, { toast, t })
  );
}
function SyncStatus({ t, state, now }) {
  const rules = state.cfg.rules;
  const progress = state.runtime.progress || { done: 0, total: 0 };
  const elapsed = state.runtime.syncStartedAt && state.runtime.syncing ? Math.max(0, Math.round((now - state.runtime.syncStartedAt) / 1e3)) : 0;
  const syncingText = progress.total > 0 ? t(
    `\u540C\u6B65\u4E2D \xB7 ${progress.done}/${progress.total} \u4ED3\u5E93${elapsed ? ` \xB7 ${elapsed}s` : ""}`,
    `Syncing \xB7 ${progress.done}/${progress.total} repos${elapsed ? ` \xB7 ${elapsed}s` : ""}`
  ) : t(`\u540C\u6B65\u4E2D${elapsed ? ` \xB7 ${elapsed}s` : "\u2026"}`, `Syncing${elapsed ? ` \xB7 ${elapsed}s` : "\u2026"}`);
  return h(
    "span",
    { className: "ght-sync" },
    h("i", null),
    state.runtime.syncing ? syncingText : state.runtime.lastSync ? `${relTime(state.runtime.lastSync, now, t)} \xB7 ${rules.interval === "0" ? t("\u4EC5\u624B\u52A8", "manual") : t(`\u6BCF ${rules.interval} \u5206\u949F`, `every ${rules.interval} min`)}` : t("\u8FD8\u6CA1\u540C\u6B65", "Not synced")
  );
}
function BannerClose({ t, onClick }) {
  return h(
    "button",
    {
      type: "button",
      className: "ght-banner-close",
      title: t("\u5173\u95ED", "Dismiss"),
      "aria-label": t("\u5173\u95ED", "Dismiss"),
      onClick
    },
    h(Icon, { name: "x", size: 13 })
  );
}
function SyncBanner({ t, state, onSync, onRetry, onDismiss, onDismissAll }) {
  if (state.runtime.syncing) return null;
  const errors = Object.entries(state.runtime.errors || {});
  if (!errors.length && !state.runtime.ghError) return null;
  if (state.runtime.ghError) {
    return h(
      "div",
      { className: "ght-banner" },
      h("span", { className: "ght-banner-text" }, state.runtime.ghError),
      h("button", { type: "button", className: "ght-linkish", onClick: onSync }, t("\u91CD\u8BD5", "Retry")),
      h(BannerClose, { t, onClick: onDismissAll })
    );
  }
  return h(
    "div",
    { className: "ght-banner ght-banner-list" },
    errors.map(
      ([slug, message]) => h(
        "div",
        { key: slug, className: "ght-banner-row" },
        h("span", { className: "ght-banner-text" }, `${slug}: ${message}`),
        h(
          "button",
          { type: "button", className: "ght-linkish", onClick: () => onRetry(slug) },
          t("\u91CD\u8BD5", "Retry")
        ),
        h(BannerClose, { t, onClick: () => onDismiss(slug) })
      )
    )
  );
}
function PanelHeader({ t, state, rows, enabledRepos, selectedSlugs, now, onSync, onRetry, onDismiss, onDismissAll, onOpenSettings, onPickRepo }) {
  return h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "ght-pv-head" },
      h("span", { className: "ght-pv-title" }, t("PR \u6D41\u8F6C", "PR flow")),
      h(RepoPicker, { t, state, rows, enabledRepos, selectedSlugs, onPick: onPickRepo }),
      h("span", { className: "ght-readonly" }, t("\u6570\u636E\u6765\u81EA\u672C\u673A gh \xB7 \u53EA\u8BFB", "from local gh \xB7 read-only")),
      h("span", { className: "ght-sp" }),
      h(SyncStatus, { t, state, now }),
      h(
        "button",
        { type: "button", className: "ght-icon-btn", title: t("\u7ACB\u5373\u540C\u6B65", "Sync now"), onClick: onSync, disabled: state.runtime.syncing },
        h(Icon, { name: "refresh", size: 14 })
      ),
      h(
        "button",
        { type: "button", className: "ght-icon-btn", title: t("\u8BBE\u7F6E", "Settings"), onClick: onOpenSettings },
        h(Icon, { name: "gear", size: 14 })
      )
    ),
    h(SyncBanner, { t, state, onSync, onRetry, onDismiss, onDismissAll })
  );
}
function RepoMenu({ t, state, rows, enabledRepos, current, onPick }) {
  const openCount = (slug) => rows.filter((r) => r.pr.repoSlug === slug && state.cfg.defs[r.d.key].owner !== "done").length;
  return h(
    "div",
    { className: "ght-repo-menu" },
    h(
      "button",
      { type: "button", className: cx(current === "all" && "on"), onClick: () => onPick("all") },
      h(Icon, { name: "pr", size: 14 }),
      t("\u5168\u90E8\u4ED3\u5E93", "All repositories"),
      h("small", null, t(`${enabledRepos.length} \u4E2A`, `${enabledRepos.length}`))
    ),
    h("hr"),
    enabledRepos.map(
      (repo) => h(
        "button",
        {
          key: repo.slug,
          type: "button",
          className: cx(
            current !== "all" && current.includes(repo.slug) && "on",
            current !== "all" && !current.includes(repo.slug) && "ght-dim"
          ),
          onClick: () => onPick(repo.slug)
        },
        h(RepoDot, { index: state.cfg.repos.findIndex((r) => r.slug === repo.slug) }),
        h("span", { className: "ght-repo-name", title: repo.slug }, repo.slug),
        h("small", null, t(`${openCount(repo.slug)} \u8FDB\u884C\u4E2D`, `${openCount(repo.slug)} open`))
      )
    )
  );
}
function RepoPicker({ t, state, rows, enabledRepos, selectedSlugs, onPick }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  const current = state.ui.repoFilter;
  const allSelected = current === "all";
  const pick = (slug) => {
    if (slug === "all") setOpen(false);
    onPick(slug);
  };
  return h(
    "div",
    { className: "ght-repo-wrap", ref },
    h(
      "button",
      { type: "button", className: "ght-repo-chip", onClick: () => setOpen(!open) },
      allSelected ? [h(Icon, { key: "i", name: "pr", size: 14 }), h("b", { key: "b" }, t("\u5168\u90E8\u4ED3\u5E93", "All repositories")), h("em", { key: "e" }, enabledRepos.length)] : selectedSlugs.length === 1 ? [
        h(RepoDot, { key: "d", index: state.cfg.repos.findIndex((r) => r.slug === selectedSlugs[0]) }),
        h("b", { key: "b" }, selectedSlugs[0])
      ] : [
        h(Icon, { key: "i", name: "pr", size: 14 }),
        h("b", { key: "b" }, t(`${selectedSlugs.length} \u4E2A\u4ED3\u5E93`, `${selectedSlugs.length} repos`)),
        h("em", { key: "e" }, `${selectedSlugs.length}/${enabledRepos.length}`)
      ],
      h(Icon, { name: "chevD", size: 12 })
    ),
    open ? h(RepoMenu, { t, state, rows, enabledRepos, current, onPick: pick }) : null
  );
}
function MetricsGrid({ t, store, state, chart, flows, flow }) {
  return h(
    "div",
    { className: "ght-grid2" },
    h(DailyChart, {
      t,
      series: chart.series,
      days: chart.days,
      flow: flows,
      mode: state.ui.chartMode,
      onMode: (mode) => store.setUi({ chartMode: mode })
    }),
    h(TodayFlow, { t, flow, defs: state.cfg.defs, rules: state.cfg.rules })
  );
}
function WorkToolbar({ t, state, store, filterCounts }) {
  return h(
    "div",
    { className: "ght-work-tb" },
    h(
      "div",
      { className: "ght-seg" },
      h(
        "button",
        { type: "button", className: cx(state.ui.view === "board" && "on"), onClick: () => store.setUi({ view: "board" }) },
        h(Icon, { name: "board", size: 13 }),
        t("\u770B\u677F", "Board")
      ),
      h(
        "button",
        { type: "button", className: cx(state.ui.view === "list" && "on"), onClick: () => store.setUi({ view: "list" }) },
        h(Icon, { name: "list", size: 13 }),
        t("\u5217\u8868", "List")
      )
    ),
    h(
      "div",
      { className: "ght-seg" },
      FILTERS.map(
        ([key, zh, en]) => h(
          "button",
          { key, type: "button", className: cx(state.ui.filter === key && "on"), onClick: () => store.setUi({ filter: key }) },
          t(zh, en),
          h("em", null, filterCounts[key] ?? "")
        )
      )
    ),
    h("span", { className: "ght-sp" }),
    h(
      "label",
      { className: "ght-search" },
      h(Icon, { name: "search", size: 13 }),
      h("input", {
        placeholder: t("\u641C\u7D22\u6807\u9898 / #\u7F16\u53F7 / \u4F5C\u8005 / \u4ED3\u5E93", "Search title / #number / author / repo"),
        value: state.ui.query,
        onChange: (event) => store.setUi({ query: event.target.value })
      })
    )
  );
}
function WorkFooter({ t, state, store, filterCounts }) {
  return h(
    "div",
    { className: "ght-list-foot" },
    h(
      "span",
      null,
      state.ui.view === "board" ? t("\u65B0\u5361\u7247\u9ED8\u8BA4\u201C\u8D85\u65F6\u4F18\u5148\u3001\u7B49\u5F97\u6700\u4E45\u4F18\u5148\u201D\uFF1B\u4F60\u624B\u52A8\u6392\u8FC7\u7684\u987A\u5E8F\u4F1A\u4FDD\u7559", "New cards sort by overdue, then longest waiting") : t("\u6309\u201C\u8D85\u65F6\u4F18\u5148\u3001\u7B49\u5F97\u6700\u4E45\u4F18\u5148\u201D\u6392\u5E8F", "Sorted by overdue, then longest waiting")
    ),
    h("span", { className: "ght-sp" }),
    filterCounts.ignored ? h(
      "button",
      { type: "button", className: "ght-linkish", onClick: () => store.setUi({ showIgnored: !state.ui.showIgnored }) },
      state.ui.showIgnored ? t(`\u9690\u85CF\u5DF2\u5FFD\u7565 ${filterCounts.ignored} \u4E2A`, `Hide ${filterCounts.ignored} ignored`) : t(`\u663E\u793A\u5DF2\u5FFD\u7565 ${filterCounts.ignored} \u4E2A`, `Show ${filterCounts.ignored} ignored`)
    ) : null,
    h("span", null, t(`\u5DF2\u6392\u9664 ${filterCounts.excluded} \u4E2A\uFF08\u673A\u5668\u4EBA / \u81EA\u5DF1\u7684 PR\uFF0C\u89C1\u8BBE\u7F6E\uFF09`, `${filterCounts.excluded} excluded (bots / your own PRs)`))
  );
}
function WorkBody({ t, state, store, action, rows, filterFn, now, enabledRepos, workspaces, prs }) {
  if (!enabledRepos.length) {
    return h("div", { className: "ght-empty" }, t("\u6CA1\u6709\u53EF\u8DDF\u8E2A\u7684\u4ED3\u5E93\u3002\u6253\u5F00\u4E00\u4E2A GitHub \u4ED3\u5E93\u5DE5\u4F5C\u533A\u540E\u4F1A\u81EA\u52A8\u51FA\u73B0\u3002", "No trackable repositories. Open a GitHub workspace."));
  }
  if (state.ui.view === "board") {
    return h(Board, {
      t,
      store,
      rows,
      rules: state.cfg.rules,
      defs: state.cfg.defs,
      order: state.local.order,
      endedDays: state.cfg.rules.endedDays,
      now,
      query: state.ui.query,
      filterFn,
      wts: workspaces.worktrees,
      prs,
      bindings: state.local.bindings,
      selectedKey: state.ui.drawerKey,
      toast: action.toast,
      onOpen: action.openPr,
      onBind: action.openBind,
      onWorktree: action.onWorktree
    });
  }
  return h(ListView, {
    t,
    rows,
    defs: state.cfg.defs,
    rules: state.cfg.rules,
    order: state.local.order,
    now,
    query: state.ui.query,
    filterFn,
    wts: workspaces.worktrees,
    prs,
    bindings: state.local.bindings,
    selectedKey: state.ui.drawerKey,
    onOpen: action.openPr,
    onBind: action.openBind,
    onWorktree: action.onWorktree,
    onGh: (pr) => action.ghOpen(prUrl(pr))
  });
}
function WorkSection({ t, state, store, action, rows, filterFn, now, enabledRepos, workspaces, prs, filterCounts, toast }) {
  const actions = { ...action, toast };
  return h(
    "section",
    { className: "ght-card ght-work" },
    h(WorkToolbar, { t, state, store, filterCounts }),
    state.ui.view === "board" ? h(
      "div",
      { className: "ght-board-hint" },
      h("span", null, h("b", null, t("\u62D6\u5230\u5176\u4ED6\u5217", "Drag across columns")), t(" = \u5728\u672C\u5730\u8BB0\u4E00\u7B14\uFF08\u4E0D\u5199 GitHub\uFF0C\u53EF\u64A4\u9500\uFF09", " = local mark (no GitHub write, undoable)")),
      h("span", null, h("b", null, t("\u5217\u5185\u62D6\u52A8", "Drag within a column")), t(" = \u8C03\u6574\u987A\u5E8F", " = reorder")),
      h("span", null, t("\u5DF2\u5408\u5E76 / \u5DF2\u5173\u95ED / \u8349\u7A3F\u7531 GitHub \u51B3\u5B9A\uFF0C\u4E0D\u80FD\u62D6", "Merged / closed / draft are locked"))
    ) : null,
    h(WorkBody, { t, state, store, action: actions, rows, filterFn, now, enabledRepos, workspaces, prs }),
    h(WorkFooter, { t, state, store, filterCounts })
  );
}
function Kpis({ t, c, flow, chart, defs, filter, setFilter }) {
  const card = (key, label, value, sub, tone) => h(
    "button",
    { type: "button", className: cx("ght-kpi", filter === key && "on"), onClick: () => setFilter(filter === key ? "all" : key) },
    h("div", { className: "ght-kpi-l" }, tone ? h("i", { style: { background: toneColor(tone) } }) : null, label),
    h("div", { className: "ght-kpi-v" }, value),
    h("div", { className: "ght-kpi-s" }, sub)
  );
  const todaySub = chart.series.length > 1 ? chart.series.map(
    (repo) => h("span", { key: repo.slug, className: "ght-rb" }, h(RepoDot, { index: repo.colorIndex }), flow.byRepo[repo.slug] || 0)
  ) : t(`\u8FD1 14 \u5929\u5171 ${chart.days.reduce((a, d) => a + d.vals[0], 0)} \u4E2A`, "last 14 days");
  return h(
    "div",
    { className: "ght-kpis" },
    card("today", t("\u4ECA\u65E5\u65B0\u589E", "New today"), c.today, todaySub),
    card(
      "mine",
      t("\u7B49\u6211\u5904\u7406", "Yours"),
      c.mine,
      h(
        "span",
        null,
        t(
          `\u5F85\u5BA1\u67E5 ${c.needs_review} \xB7 \u5BA1\u67E5\u4E2D ${c.reviewing} \xB7 \u5F85\u590D\u5BA1 ${c.needs_rereview}`,
          `New ${c.needs_review} \xB7 Reviewing ${c.reviewing} \xB7 Recheck ${c.needs_rereview}`
        ),
        c.overdue ? h("b", null, t(` \xB7 \u8D85\u65F6 ${c.overdue}`, ` \xB7 ${c.overdue} overdue`)) : null
      ),
      defs.needs_rereview.tone
    ),
    card(
      "author",
      t("\u7B49\u4F5C\u8005\u4FEE\u590D", "With author"),
      c.author,
      h(
        "span",
        null,
        t(`${c.changes_requested} \u5F85\u4FEE\u590D${c.draft ? ` \xB7 ${c.draft} \u8349\u7A3F` : ""}`, `${c.changes_requested} changes${c.draft ? ` \xB7 ${c.draft} drafts` : ""}`),
        c.silent ? h("b", null, t(` \xB7 \u6C89\u9ED8 ${c.silent}`, ` \xB7 ${c.silent} silent`)) : null
      ),
      defs.changes_requested.tone
    ),
    card("merge", t("\u7B49\u5408\u5E76", "To merge"), c.merge, t("\u4F60\u5DF2\u901A\u8FC7\uFF0C\u672A\u5408\u5E76", "approved, unmerged"), defs.approved.tone),
    card("done", t("\u4ECA\u65E5\u5408\u5E76", "Merged today"), c.mergedToday, t(`\u8FDB\u884C\u4E2D\u5171 ${c.active} \u4E2A`, `${c.active} active`), defs.merged.tone)
  );
}
function TodayFlow({ t, flow, defs, rules }) {
  const row = (tone, label, value, sub) => h(
    "div",
    { className: "ght-flow-row", key: label },
    h("span", { className: "ght-flow-ic", style: { background: `${toneColor(tone)}22`, color: toneColor(tone) } }, h(Icon, { name: "chevR", size: 12 })),
    h("span", { className: "ght-flow-l" }, label, sub ? h("small", null, sub) : null),
    h("span", { className: "ght-flow-v" }, value)
  );
  const subRow = (label, value) => h("div", { className: "ght-flow-row ght-flow-sub", key: label }, h("span", { className: "ght-flow-l" }, label), h("span", { className: "ght-flow-v" }, value));
  return h(
    "section",
    { className: "ght-card" },
    h(
      "header",
      { className: "ght-card-h" },
      h("h3", null, t("\u4ECA\u65E5\u6D41\u8F6C", "Today")),
      h("span", { className: "ght-sub" }, t(`\u6309 ${String(rules.dayCutoff).padStart(2, "0")}:00 \u5207\u65E5`, `day starts ${String(rules.dayCutoff).padStart(2, "0")}:00`))
    ),
    h(
      "div",
      { className: "ght-flow" },
      row("neutral", t("\u65B0\u589E PR", "New PRs"), flow.opened, flow.drafts ? t(`\u542B\u8349\u7A3F ${flow.drafts}`, `${flow.drafts} drafts`) : ""),
      row(defs.needs_review.tone, t("\u6211\u5BA1\u67E5\u4E86", "I reviewed"), flow.first + flow.re, t(`\u9996\u5BA1 ${flow.first} \xB7 \u590D\u5BA1 ${flow.re}`, `first ${flow.first} \xB7 re ${flow.re}`)),
      subRow(t("\u5176\u4E2D\u8981\u6C42\u4FEE\u590D", "changes"), flow.changes),
      subRow(t("\u5176\u4E2D\u901A\u8FC7", "approved"), flow.approve),
      row(defs.changes_requested.tone, t("\u4F5C\u8005\u5B8C\u6210\u4FEE\u590D", "Author fixed"), flow.fixed, t("\u63A8\u9001 / \u91CD\u65B0\u8BF7\u6C42\u5BA1\u67E5", "push / re-request")),
      row(defs.merged.tone, t("\u5408\u5E76 / \u5173\u95ED", "Merged / closed"), `${flow.merged} / ${flow.closed}`, "")
    ),
    h("div", { className: "ght-flow-foot" }, t("\u201C\u5BA1\u67E5\u201D\u53EA\u7B97\u4F60\u81EA\u5DF1\u7684\u3001\u6309\u5F53\u524D\u89C4\u5219\u8BA1\u5165\u7684\u5BA1\u67E5", "Only your reviews, as counted by current rules"))
  );
}

// src/main.js
var ICON_PATHS = '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>';
function decorate(store) {
  const state = store.getSnapshot();
  const repoIndexMap = new Map(state.cfg.repos.map((r, i) => [r.slug, i]));
  const ignored = new Set(state.local.ignored);
  return store.allPrs().map((pr) => ({
    ...pr,
    ignored: ignored.has(pr.key),
    repoIndex: repoIndexMap.get(pr.repoSlug) ?? 0
  }));
}
function rowsOf(store, index) {
  const state = store.getSnapshot();
  const reposEnabled = {};
  for (const repo of state.cfg.repos) reposEnabled[repo.slug] = repo.enabled && repo.available !== false;
  const meSet = new Set(
    [state.runtime.ghLogin, ...state.cfg.extraAccounts].filter(Boolean).map((v) => String(v).toLowerCase())
  );
  return selectRows(decorate(store), {
    rules: state.cfg.rules,
    meSet,
    reposEnabled,
    wts: index.getSnapshot().worktrees,
    bindings: state.local.bindings,
    reviewingSince: state.local.reviewing,
    now: Date.now()
  });
}
function navCountOf(store, index) {
  const state = store.getSnapshot();
  if (!state.cfg.rules.navCount) return null;
  const c = counts(rowsOf(store, index), {
    defs: state.cfg.defs,
    rules: state.cfg.rules,
    now: Date.now()
  });
  return c.mine || null;
}
function NavIcon(props) {
  return h("svg", {
    ...props,
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    dangerouslySetInnerHTML: { __html: ICON_PATHS }
  });
}
function createRuntime(ctx, t) {
  const exec = createExec({ invoke: (command, payload) => ctx.bridge.invoke(command, payload) });
  const store = createStore({
    load: (key) => ctx.storage.get(key),
    save: (key, value) => ctx.storage.set(key, value)
  });
  const index = createWorkspaceIndex({ ctx, exec, store });
  const badges = createBadges({ ctx, store, index, exec, t });
  const sync = createSync({ exec, store, onAfter: () => badges.refresh() });
  return { exec, store, index, badges, sync };
}
function useEmbeddedToast() {
  const [toast, setToast] = React.useState(null);
  const timer = React.useRef(null);
  const show = React.useCallback((message) => {
    clearTimeout(timer.current);
    setToast(message);
    timer.current = setTimeout(() => setToast(null), 2400);
  }, []);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show];
}
function createSettingsSection({ ctx, t, store, index, sync }) {
  return function SettingsSection() {
    const state = useStore(store);
    useStore(index);
    const c = counts(rowsOf(store, index), {
      defs: state.cfg.defs,
      rules: state.cfg.rules,
      now: Date.now()
    });
    const [toast, show] = useEmbeddedToast();
    return h(
      "div",
      { className: "ght-root ght-embedded" },
      h(SettingsBody, {
        t,
        ctx,
        store,
        index,
        rules: state.cfg.rules,
        defs: state.cfg.defs,
        counts: c,
        now: Date.now(),
        toast: show,
        onSync: () => {
          sync.run();
        }
      }),
      toast ? h("div", { className: "ght-toast" }, toast) : null
    );
  };
}
function registerSurfaces(ctx, { t, store, index, sync, Panel }) {
  const openPanel = () => {
    try {
      ctx.ui.openCenterTab("board");
    } catch {
      ctx.ui.openSettings();
    }
  };
  let navValue;
  let navDisposer = null;
  const registerNav = () => {
    navValue = navCountOf(store, index);
    if (navDisposer) navDisposer();
    navDisposer = ctx.ui.registerSidebarNav({
      key: "entry",
      label: () => t("Git \u4EFB\u52A1\u7BA1\u7406", "Git Tasks"),
      icon: NavIcon,
      order: 10,
      badge: () => navValue,
      onOpen: openPanel
    });
    return navValue;
  };
  ctx.ui.registerCenterTab({
    key: "board",
    title: () => t("Git \u4EFB\u52A1\u7BA1\u7406", "Git Tasks"),
    icon: NavIcon,
    component: Panel
  });
  registerNav();
  ctx.ui.registerCommand({
    key: "open",
    title: () => t("\u6253\u5F00 Git \u4EFB\u52A1\u7BA1\u7406", "Open Git Tasks"),
    keywords: () => ["pr", "github", "\u4EFB\u52A1", "\u6D41\u8F6C"],
    run: openPanel
  });
  ctx.ui.registerCommand({
    key: "sync",
    title: () => t("Git \u4EFB\u52A1\u7BA1\u7406\uFF1A\u7ACB\u5373\u540C\u6B65", "Git Tasks: sync now"),
    keywords: () => ["pr", "sync", "\u540C\u6B65"],
    run: () => {
      sync.run();
    }
  });
  ctx.ui.registerSettingsSection({
    key: "settings",
    label: () => t("Git \u4EFB\u52A1\u7BA1\u7406", "Git Tasks"),
    component: createSettingsSection({ ctx, t, store, index, sync })
  });
  return { openPanel, registerNav };
}
function bootstrap({ ctx, store, index, badges, registerNav, startScheduler, sync, isDisposed }) {
  return (async () => {
    await store.init();
    const cachedViewer = await ctx.storage.get("viewer").catch(() => null);
    if (cachedViewer?.login) store.setRuntime({ ghLogin: cachedViewer.login });
    await index.refresh();
    if (isDisposed()) return;
    badges.refresh();
    registerNav();
    startScheduler();
    const result = await sync.run();
    if (result?.login) {
      ctx.storage.set("viewer", { v: 1, login: result.login }).catch(() => void 0);
    }
  })().catch((error) => {
    store.setRuntime({ ghError: error?.message || String(error) });
  });
}
function createLiveScheduler({ store, sync }) {
  const scheduler = createScheduler({
    run: () => sync.run(),
    isForeground: () => !store.getSnapshot().cfg.rules.foregroundOnly || document.visibilityState === "visible"
  });
  let scheduledInterval;
  const start = () => {
    scheduledInterval = store.getSnapshot().cfg.rules.interval;
    scheduler.start(scheduledInterval);
  };
  return { scheduler, start, scheduled: () => scheduledInterval };
}
function installWatchers({ ctx, store, index, badges, registerNav, live }) {
  let lastNav = navCountOf(store, index);
  const syncNav = () => {
    const value = navCountOf(store, index);
    if (value === lastNav) return;
    lastNav = value;
    registerNav();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") live.scheduler.wake();
  };
  const onStoreChange = () => {
    badges.refresh();
    syncNav();
    if (store.getSnapshot().cfg.rules.interval !== live.scheduled()) live.start();
    const state = store.getSnapshot();
    if (state.ready) {
      const nextDefs = localeDefsFor(state.cfg.defs, ctx.host?.locale);
      if (nextDefs) store.setDefs(nextDefs);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  const offs = [store.subscribe(onStoreChange), index.subscribe(() => badges.refresh())];
  return {
    setLastNav: (value) => {
      lastNav = value;
    },
    off: () => {
      document.removeEventListener("visibilitychange", onVisibility);
      for (const fn of offs) fn();
    }
  };
}
function startLifecycle(ctx, { store, index, badges, sync, registerNav }) {
  let disposed = false;
  const live = createLiveScheduler({ store, sync });
  const watchers = installWatchers({ ctx, store, index, badges, registerNav, live });
  bootstrap({
    ctx,
    store,
    index,
    badges,
    registerNav: () => {
      watchers.setLastNav(registerNav());
    },
    startScheduler: live.start,
    sync,
    isDisposed: () => disposed
  });
  return () => {
    disposed = true;
    live.scheduler.stop();
    badges.dispose();
    watchers.off();
    store.flush();
  };
}
function matchesDefs(defs, table) {
  return Object.keys(table).every(
    (key) => defs[key]?.label === table[key].label && defs[key]?.tone === table[key].tone
  );
}
function localeDefsFor(defs, locale) {
  const target = isEnglish(locale) ? DEFAULT_DEFS_EN : DEFAULT_DEFS;
  const other = isEnglish(locale) ? DEFAULT_DEFS : DEFAULT_DEFS_EN;
  if (matchesDefs(defs, target)) return null;
  return matchesDefs(defs, other) ? target : null;
}
function activate(ctx) {
  bindReact(ctx.react);
  const t = createT(ctx.host?.locale);
  const runtime = createRuntime(ctx, t);
  const Panel = createPanel({ ctx, t, store: runtime.store, index: runtime.index, exec: runtime.exec, sync: runtime.sync });
  const surfaces = registerSurfaces(ctx, { t, ...runtime, Panel });
  return startLifecycle(ctx, { ...runtime, registerNav: surfaces.registerNav });
}
export {
  activate as default,
  localeDefsFor
};
