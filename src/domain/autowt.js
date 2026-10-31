/** 自动建 worktree 的规则（纯函数）：挑候选、失败分类、记录对账、可清理列表。
 *
 * `records` 是 `{ [prKey]: record }`，状态含义见 automation/config.js。
 * `wts` 是插件内部 worktree 对象（repos.js#mapWorktrees），经 autoFlags 后带 `auto`。
 */

import {
  AUTO_WT_MAX_ATTEMPTS,
  AUTO_WT_MISSING_GRACE_MS,
  AUTO_WT_PER_RUN,
  AUTO_WT_RETRY_MS,
} from "../constants.js";
import { wtFor } from "./link.js";

const matchesRecord = (wt, record) =>
  (!!record.workspaceId && record.workspaceId === wt.workspaceId) ||
  (!!record.path && record.path === wt.path);

const matchesCreating = (wt, record) =>
  record.status === "creating" && !!record.branch && wt.repo === record.repo && wt.branch === record.branch;

/** 给 worktree 打上 `auto`：插件自动建、你还没开始审查的那些。
 *  创建中的也算（宿主注册后、插件拿到结果前的窗口里，不能被当成“审查中”）。 */
export function autoFlags(wts, records) {
  const list = Object.values(records || {});
  return (wts || []).map((wt) => ({
    ...wt,
    auto: list.some((r) => (r.status === "created" && matchesRecord(wt, r)) || matchesCreating(wt, r)),
  }));
}

/** PR 是否已有任何 worktree：不看关联规则开关，免得规则关掉后反复新建。 */
export function hasAnyWorktree(pr, { wts, prs, bindings, rules }) {
  if (bindings[pr.key]) return true;
  if (wtFor(pr, { wts, prs, bindings, rules })) return true;
  return wts.some(
    (w) =>
      w.repo === pr.repoSlug &&
      ((w.prNumber != null && w.prNumber === pr.number) || (!!w.branch && w.branch === pr.headRefName)),
  );
}

function eligible(record, now) {
  if (!record) return true;
  if (record.status !== "failed") return false;
  return record.attempts < AUTO_WT_MAX_ATTEMPTS && now - record.at >= AUTO_WT_RETRY_MS;
}

const byRecent = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || b.number - a.number;

/** 待审查 PR 为什么没被选中（null = 可以建）。顺序即提示优先级。 */
function skipReason(pr, ctx) {
  if (!ctx.repoSlugs.has(pr.repoSlug)) return "noRepo";
  if (ctx.skipSlugs.has(pr.repoSlug)) return "syncError";
  // 不依赖「排除我自己的 PR」开关：你关掉它只是想在看板上看到自己的 PR。
  if (ctx.meSet.has(String(pr.author || "").toLowerCase())) return "mine";
  if (hasAnyWorktree(pr, ctx)) return "hasWorktree";
  if (!ctx.includeForks && pr.isCrossRepository) return "fork";
  const record = ctx.records[pr.key];
  if (!eligible(record, ctx.now)) return record.status === "failed" ? "retryLater" : "record";
  return null;
}

/** 本轮要自动建的 PR。`rows` 来自 selectRows（auto worktree 不算审查中）。
 *  同时给出待审查总数与各类跳过数，供「执行」与设置页解释为什么没建。 */
export function pickAutoCandidates({
  rows,
  wts,
  prs,
  bindings,
  rules,
  records,
  repoSlugs,
  skipSlugs = new Set(),
  meSet = new Set(),
  includeForks = false,
  max,
  perRun = AUTO_WT_PER_RUN,
  now,
}) {
  const alive = wts.filter((w) => w.auto).length;
  const remaining = Math.max(0, max - alive);
  const ctx = { wts, prs, bindings, rules, records, repoSlugs, skipSlugs, meSet, includeForks, now };
  const waitingReview = rows
    .filter((row) => row.d.key === "needs_review")
    .map((row) => row.pr)
    .filter((pr) => pr.state === "OPEN" && !pr.isDraft && !pr.ignored);
  const skipped = {};
  const pool = [];
  for (const pr of waitingReview) {
    const reason = skipReason(pr, ctx);
    if (reason) skipped[reason] = (skipped[reason] || 0) + 1;
    else pool.push(pr);
  }
  pool.sort(byRecent);
  const take = Math.min(perRun, remaining);
  return {
    picks: pool.slice(0, take),
    alive,
    total: waitingReview.length,
    eligible: pool.length,
    skipped,
    capped: remaining === 0 && pool.length > 0,
    waiting: Math.max(0, pool.length - take),
  };
}

const RENAME = new Set(["branch_exists", "dir_exists", "branch_checked_out"]);
const FATAL = new Set([
  "not_a_repo",
  "repo_open_failed",
  "invalid_branch",
  "branch_not_found",
  "pr_not_found",
  "register_failed",
  "sparse_checkout_empty",
  "invalid_args",
]);

/** 宿主 reject message 形如 "<errorKind>: <detail>"。 */
export function classifyCreateError(message) {
  const text = String(message || "").trim();
  const kind = (/^([a-z_]+)(?::|$)/.exec(text)?.[1] || "unknown").toLowerCase();
  if (kind === "canceled") return { kind, action: "canceled" };
  if (RENAME.has(kind)) return { kind, action: "rename" };
  if (FATAL.has(kind)) return { kind, action: "give_up" };
  return { kind, action: "retry" };
}

export function recordAfterFailure(prev, message, now) {
  const { action } = classifyCreateError(message);
  const base = { ...prev, at: now, lastError: String(message || "unknown").slice(0, 300) };
  if (action === "canceled") return { ...base, status: "canceled" };
  if (action === "give_up") return { ...base, status: "gave_up" };
  return { ...base, status: prev.attempts >= AUTO_WT_MAX_ATTEMPTS ? "gave_up" : "failed" };
}

function parentVisible(record, { repoSlugs, parentIds }) {
  return record.parentId ? parentIds.has(record.parentId) : repoSlugs.has(record.repo);
}

/** 已建的记录：找到就同步 id；连续一段时间看不到、且父工作区可见，才判为你删了。 */
function reconcileLive(record, ctx) {
  const found = ctx.wts.find((w) => matchesRecord(w, record));
  if (found) {
    const same = found.workspaceId === record.workspaceId && found.path === record.path && !record.missingSince;
    return same ? record : { ...record, workspaceId: found.workspaceId, path: found.path, missingSince: 0 };
  }
  if (!parentVisible(record, ctx)) return record;
  if (!record.missingSince) return { ...record, missingSince: ctx.now };
  return ctx.now - record.missingSince >= AUTO_WT_MISSING_GRACE_MS
    ? { ...record, status: "removed", missingSince: 0, at: ctx.now }
    : record;
}

function reconcileOne(key, record, ctx) {
  const { wts, inFlight } = ctx;
  if (record.status === "created" || record.status === "adopted") return reconcileLive(record, ctx);
  const settling = record.status === "creating" || record.status === "failed" || record.status === "gave_up";
  if (settling && !inFlight.has(key)) {
    // 插件重载 / 应用退出时宿主可能仍在后台建完：按分支名认领回来。
    const found = wts.find((w) => w.repo === record.repo && !!record.branch && w.branch === record.branch);
    if (found) {
      // 中断后宿主自己建完的算自动；失败后你在侧栏点「重试」建出来的算你的。
      const ours = record.status === "creating" || record.lastError === "interrupted";
      return { ...record, status: ours ? "created" : "adopted", workspaceId: found.workspaceId, path: found.path, lastError: "" };
    }
    if (record.status === "creating") {
      const spent = record.attempts >= AUTO_WT_MAX_ATTEMPTS;
      return { ...record, status: spent ? "gave_up" : "failed", lastError: "interrupted" };
    }
  }
  return record;
}

const KEEP_STATUSES = new Set(["creating", "created", "adopted"]);

/** PR 已不在任何快照里（结束超过 30 天 / 仓库移除）且记录已无意义：清掉，避免无限增长。 */
export function pruneRecords(records, livePrKeys, now, maxAgeMs) {
  let changed = false;
  const out = {};
  for (const [key, record] of Object.entries(records || {})) {
    if (!KEEP_STATUSES.has(record.status) && !livePrKeys.has(key) && now - record.at > maxAgeMs) {
      changed = true;
      continue;
    }
    out[key] = record;
  }
  return { records: changed ? out : records, changed };
}

/** 让记录跟上宿主侧栏的真实情况。 */
export function reconcileRecords({ records, wts, repoSlugs, parentIds = new Set(), inFlight = new Set(), now = 0 }) {
  let changed = false;
  const out = {};
  const ctx = { wts, repoSlugs, parentIds, inFlight, now };
  for (const [key, record] of Object.entries(records || {})) {
    const next = reconcileOne(key, record, ctx);
    if (next !== record) changed = true;
    out[key] = next;
  }
  return { records: changed ? out : records, changed };
}

/** PR 已合并 / 关闭、worktree 仍在、仍是自动的 —— 可以提示清理。 */
export function cleanableAuto({ wts, records, prs }) {
  const byKey = new Map(prs.map((p) => [p.key, p]));
  const out = [];
  for (const [key, record] of Object.entries(records || {})) {
    if (record.status !== "created") continue;
    const pr = byKey.get(key);
    if (!pr || (pr.state !== "MERGED" && pr.state !== "CLOSED")) continue;
    const wt = wts.find((w) => w.auto && matchesRecord(w, record));
    if (wt) out.push({ prKey: key, pr, wt });
  }
  return out;
}
