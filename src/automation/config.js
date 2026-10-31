/** 自动化相关的持久化形状与清洗（纯函数）。
 *  存储里任何坏值都回落到安全默认：自动化默认关闭，坏记录直接丢弃。 */

import { AUTO_WT_MAX_LIMIT, DEFAULT_AUTOMATION, DEFAULT_NOTIFY, STORE_VERSION } from "../constants.js";

/** 自动 worktree 记录状态：
 *  creating 创建中 · created 已建（自动）· adopted 你已开始审查（不再算自动）·
 *  failed 失败待重试 · gave_up 放弃 · canceled 你在侧栏取消 · removed 你删掉了 */
export const AUTO_STATUSES = new Set([
  "creating",
  "created",
  "adopted",
  "failed",
  "gave_up",
  "canceled",
  "removed",
]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const str = (value) => (typeof value === "string" ? value.trim() : "");
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const isHour = (value) => Number.isInteger(value) && value >= 0 && value <= 23;

export function sanitizeAutomation(raw) {
  const out = { ...DEFAULT_AUTOMATION };
  if (!isObject(raw)) return out;
  if (typeof raw.autoWorktree === "boolean") out.autoWorktree = raw.autoWorktree;
  if (typeof raw.autoWorktreeForks === "boolean") out.autoWorktreeForks = raw.autoWorktreeForks;
  const max = Number(raw.autoWorktreeMax);
  if (Number.isFinite(max)) out.autoWorktreeMax = Math.max(1, Math.min(AUTO_WT_MAX_LIMIT, Math.round(max)));
  return out;
}

export function sanitizeNotifyCfg(raw) {
  const out = { ...DEFAULT_NOTIFY };
  if (!isObject(raw)) return out;
  if (typeof raw.feishu === "boolean") out.feishu = raw.feishu;
  if (typeof raw.quiet === "boolean") out.quiet = raw.quiet;
  if (isHour(raw.quietStart)) out.quietStart = raw.quietStart;
  if (isHour(raw.quietEnd)) out.quietEnd = raw.quietEnd;
  return out;
}

export function sanitizeFeishu(raw) {
  if (!isObject(raw)) return { webhook: "", secret: "" };
  return { webhook: str(raw.webhook), secret: str(raw.secret) };
}

function sanitizeRecord(raw) {
  if (!isObject(raw) || !AUTO_STATUSES.has(raw.status)) return null;
  return {
    status: raw.status,
    attempts: Math.max(0, Math.floor(num(raw.attempts))),
    at: num(raw.at),
    workspaceId: str(raw.workspaceId),
    path: str(raw.path),
    branch: str(raw.branch),
    repo: str(raw.repo),
    parentId: str(raw.parentId),
    missingSince: num(raw.missingSince),
    lastError: str(raw.lastError).slice(0, 300),
  };
}

export function sanitizeAutoRecords(raw) {
  if (!isObject(raw) || raw.v !== STORE_VERSION || !isObject(raw.records)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw.records)) {
    const record = sanitizeRecord(value);
    if (record) out[key] = record;
  }
  return out;
}

function sanitizeBaselineRepos(raw) {
  if (!isObject(raw)) return {};
  const out = {};
  for (const [slug, prs] of Object.entries(raw)) {
    if (!isObject(prs)) continue;
    const entries = Object.entries(prs).filter(([, v]) => isObject(v) && typeof v.s === "string");
    out[slug] = Object.fromEntries(
      entries.map(([key, v]) => [key, { s: v.s, n: num(v.n), t: str(v.t), u: str(v.u) }]),
    );
  }
  return out;
}

function sanitizeBaseline(raw) {
  if (!isObject(raw)) return null;
  const errors = isObject(raw.errors)
    ? Object.fromEntries(Object.entries(raw.errors).filter(([, v]) => typeof v === "string"))
    : {};
  return { repos: sanitizeBaselineRepos(raw.repos), errors };
}

export function emptyNotifyState() {
  return { lastSlot: "", lastSentAt: 0, baseline: null, paused: null, lastResult: null };
}

export function sanitizeNotifyState(raw) {
  const out = emptyNotifyState();
  if (!isObject(raw) || raw.v !== STORE_VERSION) return out;
  out.lastSlot = str(raw.lastSlot);
  out.lastSentAt = num(raw.lastSentAt);
  out.baseline = sanitizeBaseline(raw.baseline);
  if (isObject(raw.paused) && typeof raw.paused.kind === "string") {
    out.paused = { kind: raw.paused.kind, message: str(raw.paused.message), at: num(raw.paused.at) };
  }
  if (isObject(raw.lastResult)) {
    out.lastResult = {
      ok: raw.lastResult.ok === true,
      at: num(raw.lastResult.at),
      message: str(raw.lastResult.message).slice(0, 300),
    };
  }
  return out;
}
