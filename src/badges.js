/** 把 worktree → PR → 状态推给宿主（ui:worktree-badge）。
 *  宿主渲染路径不调用插件代码；这里只在同步 / 设置 / 标记 / worktree 变化时重算。 */

import { derive, flags } from "./domain/derive.js";
import { linkPr, linkSource, reviewingState } from "./domain/link.js";
import { duration, nextStep, prUrl } from "./domain/text.js";
import { worktreesOf } from "./rows.js";

/** 徽标预算只有 6 码点（宿主截断）；时长用 2–3 字符的紧凑写法。 */
export function compactAge(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(0, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** 先试「名称·时长」，超预算再去掉分隔符，最后按码点截断。 */
export function composeBadgeLabel(label, age) {
  const withDot = `${label}·${age}`;
  if ([...withDot].length <= 6) return withDot;
  const tight = `${label}${age}`;
  if ([...tight].length <= 6) return tight;
  return [...withDot].slice(0, 6).join("");
}

function badgeTip(wt, pr, def, d, rules, bindings, t, now) {
  const age = duration(now - d.since, t);
  return [
    `${pr.repoSlug} #${pr.number} · ${def.label}${d.reviews ? ` · ${t(`已审 ${d.reviews} 次`, `reviewed ${d.reviews}×`)}` : ""}`,
    nextStep(pr, d, rules, now, t).plain,
    t(`停留 ${age} · 对应方式：${linkSource(wt, pr, bindings)}`, `for ${age} · linked by: ${linkSource(wt, pr, bindings)}`),
    rules.badgeClick === "detail"
      ? t("点击查看流转详情", "click to open details")
      : t("点击在 GitHub 打开", "click to open on GitHub"),
  ].join("\n");
}

export function badgeForWorktree({ state, wt, pr, t, now = Date.now() }) {
  const rules = state.cfg.rules;
  if (!rules.badgeEnabled || !pr || pr.ignored) return null;
  const repo = state.cfg.repos.find((r) => r.slug === pr.repoSlug);
  if (!repo || repo.enabled === false) return null;
  // 插件自动建、还没开始审查的 worktree 显示 PR 的原始状态（待审查），不算审查中。
  const d = reviewingState(derive(pr, rules), !wt.auto, state.local.reviewing[pr.key]);
  const def = state.cfg.defs[d.key];
  if (!def?.badge) return null;
  const f = flags(d, rules, now);
  const showAge = rules.badgeAge === "always" || (rules.badgeAge === "overdue" && (f.overdue || f.silent));
  const label =
    showAge && def.owner !== "done" ? composeBadgeLabel(def.label, compactAge(now - d.since)) : def.label;
  return {
    label,
    tone: def.tone,
    tooltip: badgeTip(wt, pr, def, d, rules, state.local.bindings, t, now),
  };
}

function buildPayload({ state, worktrees, prs, t, now }) {
  return worktrees.map((wt) => [
    wt.workspaceId,
    badgeForWorktree({
      state,
      wt,
      pr: linkPr(wt, { prs, bindings: state.local.bindings, rules: state.cfg.rules }),
      t,
      now,
    }),
  ]);
}

function openWorktreePr({ ctx, store, index, exec, target }) {
  const state = store.getSnapshot();
  const wt = index.getSnapshot().worktrees.find((w) => w.workspaceId === target.workspaceId);
  if (!wt) return;
  const pr = linkPr(wt, { prs: store.allPrs(), bindings: state.local.bindings, rules: state.cfg.rules });
  if (!pr) return;
  if (state.cfg.rules.badgeClick === "github") {
    exec.openUrl(prUrl(pr)).catch(() => undefined);
    return;
  }
  store.setUi({ drawerKey: pr.key, modal: null });
  try {
    ctx.ui.openCenterTab("board");
  } catch {
    // 页签不可用（运行时兜底）：抽屉状态已设置，下次打开面板可见。
  }
}

export function createBadges({ ctx, store, index, exec, t, now = Date.now }) {
  const supported = typeof ctx.ui.registerWorktreeBadges === "function";
  let handle = null;
  let known = new Set();
  let lastSerialized = null;
  let offTargets = null;
  if (supported) {
    handle = ctx.ui.registerWorktreeBadges({
      key: "pr-status",
      order: 10,
      onClick: (target) => openWorktreePr({ ctx, store, index, exec, target }),
    });
    // 宿主在 worktree 增删 / 分支 / PR 号变化时广播；插件重新映射仓库与
    // worktree 行，否则新建的 worktree 要重启才挂得上徽标。
    if (typeof handle.onChange === "function") {
      offTargets = handle.onChange(() => {
        index.refresh().catch(() => undefined);
      });
    }
  }

  function refresh() {
    if (!supported || !handle) return;
    const state = store.getSnapshot();
    const ignored = new Set(state.local.ignored);
    const prs = store.allPrs().map((pr) => (ignored.has(pr.key) ? { ...pr, ignored: true } : pr));
    const worktrees = worktreesOf(store, index);
    // 已有 worktree 但没记过审查开始时间（宿主侧创建 / 历史数据）：补一个，
    // 否则徽标会把 PR 的等待时长误显示成审查时长。写入后由 store 通知重入。
    const missing = [];
    for (const wt of worktrees) {
      if (wt.auto) continue;
      const pr = linkPr(wt, { prs, bindings: state.local.bindings, rules: state.cfg.rules });
      if (!pr || state.local.reviewing[pr.key]) continue;
      if (derive(pr, state.cfg.rules).key === "needs_review") missing.push(pr.key);
    }
    if (missing.length) {
      for (const key of missing) store.markReviewing(key, now());
    }
    const payload = buildPayload({ state, worktrees, prs, t, now: now() });
    const serialized = JSON.stringify(payload);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    const current = new Set();
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
