/** 自动建 worktree 的说明文案：设置页状态行、「执行」按钮的结果提示。 */

const SKIP_LABELS = {
  fork: ["来自 fork", "from forks"],
  hasWorktree: ["已有 worktree", "already have a worktree"],
  mine: ["你自己的", "yours"],
  record: ["取消过 / 删过 / 已放弃", "canceled / removed / gave up"],
  retryLater: ["失败待重试", "retrying later"],
  syncError: ["仓库同步失败", "repo sync failed"],
  noRepo: ["本地没有对应工作区", "no local workspace"],
};

export function skipText(t, skipped = {}) {
  return Object.keys(SKIP_LABELS)
    .filter((key) => skipped[key])
    .map((key) => `${t(...SKIP_LABELS[key])} ${skipped[key]}`)
    .join(" · ");
}

/** 「上限」那一行的说明：自动 worktree 数 + 待审查里能建几个、为什么跳过。 */
export function planHint(t, info, failed) {
  const parts = [
    t(
      `最多保留 ${info.max} 个，当前 ${info.alive} 个（点了「开始审查」的不计入）`,
      `keeps up to ${info.max}, ${info.alive} now`,
    ),
  ];
  if (info.enabled) {
    const skipped = skipText(t, info.skipped);
    parts.push(
      t(`待审查 ${info.total} 个，可建 ${info.eligible} 个`, `${info.total} awaiting review, ${info.eligible} eligible`) +
        (skipped ? t(`（跳过：${skipped}）`, ` (skipped: ${skipped})`) : ""),
    );
  }
  if (info.capped) parts.push(t(`已达上限，还有 ${info.waiting} 个待建`, `limit reached, ${info.waiting} waiting`));
  if (info.breaker) parts.push(t("连续失败已熔断，每 30 分钟试探 1 个", "paused after repeated failures; probing every 30 min"));
  if (failed) parts.push(t(`失败 ${failed} 个`, `${failed} failed`));
  return parts.join(" · ");
}

function noneText(t, plan, cfg) {
  if (!plan?.total) return t("看板「待审查」里没有 PR，没有可建的", "No PRs awaiting review");
  const forkHint =
    plan.skipped?.fork && !cfg.autoWorktreeForks
      ? t("。要建 fork 来的 PR，打开「包含来自 fork 的 PR」", ". Turn on “Include PRs from forks” to create them")
      : "";
  return t(
    `没有可新建的：待审查 ${plan.total} 个，跳过 ${skipText(t, plan.skipped)}${forkHint}`,
    `Nothing to create: ${plan.total} awaiting review, skipped ${skipText(t, plan.skipped)}${forkHint}`,
  );
}

/** 「执行」一轮之后的提示。`out` 是 auto.run() 的结果。 */
export function runResultText(t, out, cfg, now = Date.now()) {
  switch (out?.reason) {
    case "created": {
      const waiting = out.plan?.waiting || 0;
      const rest = out.manual
        ? t(`已达上限，还有 ${waiting} 个没建`, `limit reached, ${waiting} not created`)
        : t(`还有 ${waiting} 个后台下一轮再建（点「执行」可一次建完）`, `${waiting} more next round (click Run to create all)`);
      const extra = [out.failed ? t(`失败 ${out.failed} 个`, `${out.failed} failed`) : "", waiting ? rest : ""].filter(Boolean);
      return t(`已新建 ${out.created} 个 worktree，侧栏可看进度`, `Created ${out.created} worktrees`) + (extra.length ? `；${extra.join("；")}` : "");
    }
    case "failed":
      return t(`尝试新建 ${out.failed} 个都失败了，原因见侧栏的失败行`, `All ${out.failed} attempts failed; see the sidebar`);
    case "none":
      return noneText(t, out.plan, cfg);
    case "capped":
      return t(`已达上限 ${cfg.autoWorktreeMax} 个：先清理已结束的，或调高上限`, `Limit of ${cfg.autoWorktreeMax} reached`);
    case "breaker": {
      const minutes = Math.max(1, Math.ceil(((out.until || now) - now) / 60_000));
      return t(`连续失败已熔断，${minutes} 分钟后自动试探；点「重置失败」可立即重试`, `Paused after failures; retrying in ${minutes} min`);
    }
    case "noLogin":
      return t("还没拿到 gh 登录名（无法排除你自己的 PR），先同步一次再试", "No gh login yet; sync first");
    case "indexNotReady":
      return t("侧栏工作区还没加载好，稍后再试", "Sidebar workspaces are still loading");
    case "disabled":
      return t("「自动创建 worktree」没开", "Auto-create is off");
    default:
      return t("已执行", "Done");
  }
}
