/** 详情抽屉：为什么是这个状态、worktree、流转记录、手动标记。 */

import { React } from "./react.js";
import { Avatar, Chip, Icon, RepoDot, Tag, cx, h, toneColor } from "./common.js";
import { derive } from "../domain/derive.js";
import {
  compareUrl,
  duration,
  evText,
  filesUrl,
  fmtAbs,
  nextStep,
  prUrl,
  shortWhy,
} from "../domain/text.js";
import { linkSource, reviewingState, wtFor } from "../domain/link.js";
import { ownerLabel } from "../i18n.js";

function slicePr(pr, index) {
  const events = pr.events.slice(0, index + 1);
  const commits = events.filter((e) => e.type === "commit").map((e) => e.sha);
  return {
    ...pr,
    events,
    commitShas: commits,
    headSha: commits[commits.length - 1] || pr.headSha,
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
    const dot = changed
      ? toneColor(def.tone)
      : event.mine || event.type === "mark"
        ? "#94a3b8"
        : "#d4d4d4";
    return h(
      "li",
      { key: `${event.type}-${event.at}-${index}`, className: cx("ght-tl-i", text.muted && "ght-muted") },
      h("i", { className: "ght-tl-dot", style: { background: dot } }),
      h(
        "div",
        { className: "ght-tl-txt" },
        text.text,
        text.sha ? h("code", null, text.sha.slice(0, 7)) : null,
        text.note ? h("span", { className: "ght-tl-note" }, text.note) : null,
      ),
      h("div", { className: "ght-tl-time" }, fmtAbs(event.at, now, t)),
      changed
        ? h(
            "div",
            { className: "ght-tl-to" },
            "→ ",
            h(Chip, { tone: def.tone, small: true }, def.label),
          )
        : null,
    );
  });
  return h("ol", { className: "ght-tl" }, items);
}

function nextAction({ t, pr, ns, onGh }) {
  if (ns.owner === "me") {
    const compare = ns.compare ? ns.compare.split("…") : null;
    const url = compare ? compareUrl(pr, compare[0], compare[1]) : filesUrl(pr);
    return h(
      "button",
      { type: "button", className: "ght-btn ght-btn-pri", onClick: () => onGh(url) },
      h(Icon, { name: "ext", size: 13 }),
      ns.compare ? t(`看 ${ns.compare} 的改动`, `View ${ns.compare}`) : t("在 GitHub 审查", "Review on GitHub"),
    );
  }
  if (ns.owner === "merge") {
    return h(
      "button",
      { type: "button", className: "ght-btn ght-btn-pri", onClick: () => onGh(prUrl(pr)) },
      h(Icon, { name: "ext", size: 13 }),
      t("去 GitHub 合并", "Merge on GitHub"),
    );
  }
  return h(
    "button",
    { type: "button", className: "ght-btn", onClick: () => onGh(prUrl(pr)) },
    h(Icon, { name: "ext", size: 13 }),
    t("在 GitHub 打开", "Open on GitHub"),
  );
}

function RefreshButton({ t, onRefresh, primary }) {
  const [busy, setBusy] = React.useState(false);
  const run = () => {
    if (busy) return;
    setBusy(true);
    Promise.resolve()
      .then(() => onRefresh())
      .finally(() => setBusy(false));
  };
  if (!primary) {
    return h(
      "button",
      {
        type: "button",
        className: "ght-icon-btn ght-bare",
        title: busy ? t("正在刷新…", "Refreshing…") : t("从 GitHub 重新读取", "Reload from GitHub"),
        "aria-label": t("刷新状态", "Refresh status"),
        onClick: run,
        disabled: busy,
      },
      h(Icon, { name: "refresh", size: 14 }),
    );
  }
  return h(
    "button",
    {
      type: "button",
      className: "ght-btn",
      title: t("刚在 GitHub 合并了？按编号重新读取状态", "Merged on GitHub? Re-read the state"),
      onClick: run,
      disabled: busy,
    },
    h(Icon, { name: "refresh", size: 13 }),
    busy ? t("刷新中…", "Refreshing…") : t("刷新状态", "Refresh status"),
  );
}

function NextCard({ t, pr, d, def, ns, now, onGh, onRefresh }) {
  return h(
    "div",
    { className: `ght-next ght-next-${ns.owner}` },
    h("div", { className: "ght-next-l" }, `${ns.head} · ${t("停留", "for")} ${duration(now - d.since, t)}`),
    h("div", { className: "ght-next-t" }, ns.title),
    h(
      "div",
      { className: "ght-next-why" },
      h("b", null, t(`为什么是「${def.label}」：`, `Why "${def.label}": `)),
      ns.why,
    ),
    h(
      "div",
      { className: "ght-next-acts" },
      nextAction({ t, pr, ns, onGh }),
      ns.owner === "merge" ? h(RefreshButton, { t, onRefresh, primary: true }) : null,
    ),
  );
}

function useRemoveWorktree({ ctx, store, index, pr, wt, toast, t, checkDirty }) {
  const [confirming, setConfirming] = React.useState(false);
  const remove = async () => {
    if (!wt) return;
    // 自动建的 worktree 与「清理」同一承诺：有未提交改动就不删（宿主删除带 --force）。
    if (wt.auto && checkDirty && (await checkDirty(wt.path))) {
      setConfirming(false);
      toast(t("这个 worktree 有未提交改动，已取消删除", "This worktree has uncommitted changes; not removed"));
      return;
    }
    const repo = index.getSnapshot().repos.find((r) => r.slug === wt.repo);
    if (!repo) {
      toast(t("找不到这个 worktree 所属的仓库路径", "Can't resolve the repository path for this worktree"));
      return;
    }
    try {
      const result = await ctx.worktrees.remove({
        repoPath: repo.path,
        worktreePath: wt.path,
        branch: wt.name,
        deleteBranch: false,
      });
      store.unbind(pr.key);
      store.clearReviewing(pr.key);
      await index.refresh();
      setConfirming(false);
      toast(
        result.orphanDirectory
          ? t("worktree 已注销，但目录未能删除", "Worktree unregistered, but the directory was not removed")
          : t("worktree 已删除", "Worktree removed"),
      );
    } catch (error) {
      setConfirming(false);
      toast(t(`删除失败：${error?.message || error}`, `Remove failed: ${error?.message || error}`));
    }
  };
  return { confirming, setConfirming, remove };
}

function AdoptButton({ t, pr, wt, terminal, toast, onAdopt }) {
  if (!wt?.auto || terminal || !onAdopt) return null;
  return h(
    "button",
    {
      key: "adopt",
      type: "button",
      className: "ght-btn ght-btn-pri",
      title: t("这个 worktree 是插件自动建的；点了之后 PR 进入「审查中」", "Auto-created; marks the PR as Reviewing"),
      onClick: () => {
        onAdopt(pr.key);
        toast(t(`#${pr.number} 已进入审查中`, `#${pr.number} is now Reviewing`));
      },
    },
    t("开始审查", "Start review"),
  );
}

function WorktreeActions({ t, ctx, store, index, pr, wt, bindings, terminal, toast, onBind, onWorktree, onAdopt, checkDirty }) {
  const { confirming, setConfirming, remove } = useRemoveWorktree({ ctx, store, index, pr, wt, toast, t, checkDirty });
  if (!wt) {
    return [
      h("span", { key: "s", className: "ght-src" }, t("还没有对应的 worktree", "No worktree linked")),
      h("span", { key: "sp", className: "ght-sp" }),
      terminal
        ? null
        : h(
            "button",
            { key: "b", type: "button", className: "ght-btn", onClick: () => onBind(pr.key) },
            h(Icon, { name: "link", size: 13 }),
            t("关联 worktree…", "Link worktree…"),
          ),
    ];
  }
  const removeButtons = confirming
    ? [
        h("button", { key: "y", type: "button", className: "ght-btn ght-btn-danger", onClick: remove }, t("确认删除", "Confirm removal")),
        h("button", { key: "n", type: "button", className: "ght-btn", onClick: () => setConfirming(false) }, t("取消", "Cancel")),
      ]
    : [h("button", { key: "rm", type: "button", className: "ght-btn", onClick: () => setConfirming(true) }, t("删除 worktree…", "Remove worktree…"))];
  return [
    h(Icon, { key: "i", name: "branch", size: 14 }),
    h("b", { key: "n", className: "ght-mono" }, wt.name),
    h("span", { key: "s", className: "ght-src" }, linkSource(wt, pr, bindings)),
    h("span", { key: "sp", className: "ght-sp" }),
    h(AdoptButton, { key: "adopt", t, pr, wt, terminal, toast, onAdopt }),
    ...(terminal
      ? removeButtons
      : [h("button", { key: "copy", type: "button", className: "ght-btn", onClick: () => onWorktree(wt) }, t("复制路径", "Copy path"))]),
    bindings[pr.key]
      ? h(
          "button",
          {
            key: "unbind",
            type: "button",
            className: "ght-btn",
            onClick: () => {
              store.unbind(pr.key);
              toast(t(`已解除 #${pr.number} 的 worktree 绑定`, `Unlinked #${pr.number}`));
            },
          },
          t("解除绑定", "Unlink"),
        )
      : null,
    terminal
      ? null
      : h("button", { key: "change", type: "button", className: "ght-btn", onClick: () => onBind(pr.key) }, t("换一个…", "Change…")),
  ];
}

function WorktreeSection({ t, ctx, store, index, pr, wt, bindings, terminal, toast, onBind, onWorktree, onAdopt, checkDirty }) {
  return h(
    "div",
    null,
    h(
      "div",
      { className: "ght-sec-h" },
      "Worktree",
      h("span", null, t("手动绑定 > 客户端从 PR 创建 > 分支名一致", "manual > created from PR > matching branch")),
    ),
    h(
      "div",
      { className: "ght-wt-box" },
      h(WorktreeActions, { t, ctx, store, index, pr, wt, bindings, terminal, toast, onBind, onWorktree, onAdopt, checkDirty }),
    ),
  );
}

function markButton(t, label, disabled, onClick) {
  return h("button", { type: "button", className: "ght-btn", disabled, onClick }, label);
}

function MarksSection({ t, store, pr, terminal, done, ignored, toast }) {
  const mark = (verdict) => {
    store.addMark(pr.key, { verdict, via: "button", at: Date.now(), sha: pr.headSha });
    toast(t("已记录到本地（不会写到 GitHub）", "Saved locally (nothing written to GitHub)"));
  };
  const hasMarks = (store.getSnapshot().local.marks[pr.key] || []).length > 0;
  return h(
    "div",
    null,
    h(
      "div",
      { className: "ght-sec-h" },
      t("手动标记", "Manual marks"),
      h("span", null, terminal || done
        ? t("已结束的 PR 不能再标记；先在看板上拖回其他列", "Finished PRs can't be marked; drag it back on the board first")
        : t("仅存本地，不写 GitHub；在看板上拖到对应列效果一样", "local only; dragging on the board does the same")),
    ),
    h(
      "div",
      { className: "ght-btns" },
      markButton(t, t("看过了 · 需要修复", "Reviewed · changes needed"), terminal || done, () => mark("changes")),
      markButton(t, t("看过了 · 没问题", "Reviewed · looks good"), terminal || done, () => mark("approve")),
      markButton(t, t("撤销上一次标记", "Undo last mark"), !hasMarks, () => {
        store.unmarkLast(pr.key);
        toast(t("已撤销上一次标记", "Last mark undone"));
      }),
      h(
        "button",
        {
          type: "button",
          className: "ght-btn",
          onClick: () => {
            store.toggleIgnore(pr.key);
            toast(
              ignored
                ? t("已取消忽略", "Unignored")
                : t("已忽略：不再计入看板、统计和侧栏徽标", "Ignored: excluded from board, stats and badges"),
            );
          },
        },
        h(Icon, { name: "eye", size: 13 }),
        ignored ? t("取消忽略", "Unignore") : t("忽略这个 PR", "Ignore this PR"),
      ),
    ),
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
      d.reviews ? h(Tag, null, t(`已审 ${d.reviews} 次`, `Reviewed ${d.reviews}×`)) : null,
      ignored ? h(Tag, null, t("已忽略", "Ignored")) : null,
      h("span", { className: "ght-sp" }),
      h(RefreshButton, { t, onRefresh }),
      h("button", { type: "button", className: "ght-icon-btn ght-bare", title: t("在 GitHub 打开", "Open on GitHub"), onClick: () => onGh(prUrl(pr)) }, h(Icon, { name: "ext", size: 14 })),
      h("button", { type: "button", className: "ght-icon-btn ght-bare", title: t("关闭（Esc）", "Close (Esc)"), onClick: onClose }, h(Icon, { name: "x", size: 15 })),
    ),
    h("h3", null, pr.title),
    h(
      "div",
      { className: "ght-dr-meta" },
      h(Avatar, { name: pr.author }),
      h("span", null, pr.author),
      "·",
      h("span", { className: "ght-mono" }, `${pr.headRefName || "?"} → ${pr.baseRefName || "main"}`),
      pr.additions ? h("span", { className: "ght-add" }, `+${pr.additions}`) : null,
      pr.deletions ? h("span", { className: "ght-del" }, `−${pr.deletions}`) : null,
    ),
  );
}

export function Drawer({ t, ctx, store, pr, rules, defs, now, wts, prs, bindings, index, toast, onClose, onGh, onRefresh, onBind, onWorktree, onAdopt, checkDirty }) {
  const d = derive(pr, rules);
  const wt0 = wtFor(pr, { wts, prs, bindings, rules });
  const dView = reviewingState(d, !!wt0 && !wt0.auto, store.getSnapshot().local.reviewing[pr.key]);
  const def = defs[dView.key];
  const ns = nextStep(pr, dView, rules, now, t);
  const wt = wt0;
  const terminal = dView.key === "merged" || dView.key === "closed";
  return [
    h("div", { key: "scrim", className: "ght-scrim", onClick: onClose }),
    h(
      "aside",
      { key: "drawer", className: "ght-drawer", "aria-label": t("PR 详情", "PR details") },
      h(DrawerHeader, { t, pr, d, def, ignored: pr.ignored, onGh, onClose, onRefresh }),
      h(
        "div",
        { className: "ght-dr-body" },
        h(NextCard, { t, pr, d: dView, def, ns, now, onGh, onRefresh }),
        h(WorktreeSection, { t, ctx, store, index, pr, wt, bindings, terminal, toast, onBind, onWorktree, onAdopt, checkDirty }),
        h(
          "div",
          null,
          h("div", { className: "ght-sec-h" }, t("流转记录", "Timeline"), h("span", null, t("彩色圆点 = 这一步改变了状态", "colored dot = state changed here"))),
          h(Timeline, { t, pr, rules, defs, now }),
        ),
        h(MarksSection, { t, store, pr, terminal, done: dView.key === "done", ignored: pr.ignored, toast }),
        h("div", { className: "ght-why-foot" }, shortWhy(pr, dView, rules, now, t)),
      ),
    ),
  ];
}
