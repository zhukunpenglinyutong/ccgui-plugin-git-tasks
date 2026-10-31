/** 统计：KPI 计数、今日流转、每日新增序列（纯函数，计划 §6）。 */

import { STATUS_ORDER } from "../constants.js";
import { derive, flags, isTracked, verdictOf } from "./derive.js";
import { linkPr, reviewingState } from "./link.js";

const pad = (n) => String(n).padStart(2, "0");

/** 本地时区的“今天”起点；`cutoffH` 点之前算前一天。 */
export function dayStart(now, cutoffH = 0) {
  const d = new Date(now);
  d.setHours(cutoffH, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

export function dateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** KPI 数字。`rows` 是已跟踪、未过滤的 `{pr,d,f}`；`excluded` 由调用方给。 */
export function counts(rows, { defs, rules, now, excluded = 0, statusOrder = STATUS_ORDER }) {
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
    excluded,
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

/** 今日流转：新增（含草稿）、我审查（首审/复审）、作者修复、合并/关闭。 */
export function todayFlow(prs, rules, now) {
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

/** 近 N 天每日新增（数据来自每个仓库快照的 daily 计数）。 */
export function dailySeries(snapshots, repoList, rules, now, days = 14) {
  const series = repoList
    .filter((r) => r.enabled)
    .map((r) => ({
      slug: r.slug,
      colorIndex: repoList.findIndex((x) => x.slug === r.slug),
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
      vals: series.map((r) => Number(snapshots[r.slug]?.daily?.[key] || 0)),
    });
  }
  return { series, days: out };
}

/** 供 UI 使用的行选择器：仓库过滤 + 跟踪范围 + 草稿开关。 */
export function selectRows(prs, { rules, meSet, repoFilter = "all", reposEnabled = {}, showIgnored = false, wts = [], bindings = {}, reviewingSince = {}, now }) {
  return prs
    .filter((pr) => reposEnabled[pr.repoSlug] !== false)
    .filter((pr) =>
      repoFilter === "all"
        ? true
        : Array.isArray(repoFilter)
          ? repoFilter.includes(pr.repoSlug)
          : pr.repoSlug === repoFilter,
    )
    .filter((pr) => isTracked(pr, rules, meSet))
    .filter((pr) => showIgnored || !pr.ignored)
    .map((pr) => {
      // 插件自动建、你还没开始审查的 worktree 不算“审查中”。
      const hasWorktree = wts.some(
        (wt) => !wt.auto && linkPr(wt, { prs, bindings, rules })?.key === pr.key,
      );
      const d = reviewingState(derive(pr, rules), hasWorktree, reviewingSince[pr.key]);
      return { pr, d, f: flags(d, rules, now) };
    })
    .filter(({ d }) => rules.includeDraft || d.key !== "draft");
}

/** 近 N 天「我审查 / 作者修复 / 合并」按天统计（图表表视图用）。 */
export function flowByDay(prs, rules, now, days = 14) {
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
