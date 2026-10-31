/** 插件级常量：默认设置、状态定义、看板列、调色板、时间单位。
 *  这里不引入任何宿主或 DOM 依赖，测试可直接 import。 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** 状态键的固定顺序（与交互稿一致；设置页与计数都按此顺序）。 */
export const STATUS_ORDER = [
  "needs_review",
  "reviewing",
  "changes_requested",
  "needs_rereview",
  "approved",
  "draft",
  "merged",
  "closed",
  "done",
];

/** 默认状态定义。名称 ≤ 6 字；tone 取宿主状态色；badge = 是否上侧栏徽标。 */
export const DEFAULT_DEFS = {
  needs_review: { label: "待审查", tone: "blue", owner: "me", badge: true },
  reviewing: { label: "审查中", tone: "cyan", owner: "me", badge: true },
  changes_requested: { label: "待修复", tone: "yellow", owner: "author", badge: true },
  needs_rereview: { label: "待复审", tone: "rose", owner: "me", badge: true },
  approved: { label: "已通过", tone: "green", owner: "merge", badge: true },
  draft: { label: "草稿", tone: "neutral", owner: "author", badge: false },
  merged: { label: "已合并", tone: "purple", owner: "done", badge: true },
  closed: { label: "已关闭", tone: "neutral", owner: "done", badge: true },
  done: { label: "已完成", tone: "lime", owner: "done", badge: true },
};

/** 计划 §9.1。 */
export const DEFAULT_RULES = {
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
  dayCutoff: 0,
};

/** 宿主状态色白名单（只收 token 后缀，不收 hex）。 */
export const TONES = ["neutral", "blue", "cyan", "green", "lime", "yellow", "rose", "purple"];

/** 归属标签。 */
export const OWNER_LABELS = {
  me: "等我",
  author: "等作者",
  merge: "等合并",
  done: "已结束",
};

/** 看板列：一列对应一个（或一组）状态。 */
export const COLUMNS = [
  {
    key: "review",
    main: "needs_review",
    statuses: ["needs_review", "reviewing", "draft"],
    desc: "没审过 / 审查中 / 你撤回了结论",
  },
  { key: "fix", main: "changes_requested", statuses: ["changes_requested"], desc: "你提了问题，等作者改" },
  { key: "rereview", main: "needs_rereview", statuses: ["needs_rereview"], desc: "作者改完了，等你再看" },
  { key: "approved", main: "approved", statuses: ["approved"], desc: "你已通过，等合并" },
  { key: "ended", main: null, statuses: ["merged", "closed", "done"], desc: "已合并 / 已关闭 / 你标记完成" },
];

export const MARK_TEXT = {
  changes: "看过了 · 需要修复",
  approve: "看过了 · 没问题",
  reset: "撤回结论，重新审查",
  fixed: "作者已修复（你确认）",
  done: "标记完成",
};

/** 拖到某列时记下的本地标记。 */
export const DROP_MARK = {
  review: "reset",
  fix: "changes",
  rereview: "fixed",
  approved: "approve",
  ended: "done",
};

/** 仓库调色板（dataviz 已校验；计划 §9.3）。仅用于图表数据色，不是主题色。 */
export const REPO_PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

/** 存储结构版本（每个值都带 v）。 */
export const STORE_VERSION = 1;

/** 同步与查询的硬上限。 */
export const MAX_OPEN_PRS = 200;
export const DETAIL_BATCH = 4;
export const MIN_INTERVAL_MINUTES = 5;
export const GH_TIMEOUT_MS = 20_000;
export const GIT_TIMEOUT_MS = 15_000;
// 本机链路对并发 GraphQL 连接敏感：默认串行，避免 EOF。
export const GH_CONCURRENCY = 1;
export const DEFAULT_REMOTE = "origin";

/** 自动化：自动建 worktree。上限可配（1–50），每轮同步最多新建 AUTO_WT_PER_RUN 个，
 *  避免侧栏一次刷出几十条创建进度。 */
export const DEFAULT_AUTOMATION = {
  autoWorktree: false,
  autoWorktreeMax: 10,
  // fork 来的 PR 任何人都能提；自动检出会触发本机 git 钩子（husky 等），默认不建。
  autoWorktreeForks: false,
};
export const AUTO_WT_MAX_LIMIT = 50;
export const AUTO_WT_PER_RUN = 5;
// 宿主每次失败都会在侧栏留一条可重试的失败行：自动重试次数要克制。
export const AUTO_WT_MAX_ATTEMPTS = 2;
export const AUTO_WT_RETRY_MS = 30 * MINUTE;
// 连续这么多次「暂时性失败」就熔断；熔断期间每 AUTO_WT_RETRY_MS 只试探 1 个，成功才恢复。
export const AUTO_WT_BREAKER = 3;
// 侧栏里暂时看不到某个自动 worktree（刷新乱序 / 侧栏重排）时，等这么久仍不见才判为被删。
export const AUTO_WT_MISSING_GRACE_MS = 10 * MINUTE;

/** 自动化：飞书每小时汇总。静默时段内不发，攒到静默结束后合并成一条。 */
export const DEFAULT_NOTIFY = {
  feishu: false,
  quiet: true,
  quietStart: 22,
  quietEnd: 8,
};
// 飞书自定义机器人请求体上限约 20KB，留余量。
export const FEISHU_MAX_BYTES = 18_000;
export const DIGEST_CHANGES_PER_REPO = 15;
export const DIGEST_TICK_MS = MINUTE;
