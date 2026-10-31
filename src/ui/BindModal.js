/** 关联 worktree：绑定已有 或 从 PR 新建。 */

import { React } from "./react.js";
import { Icon, cx, h } from "./common.js";
import { bindCandidates, newBranchName } from "../domain/link.js";

function Option({ active, disabled, onSelect, title, desc }) {
  return h(
    "div",
    {
      className: cx("ght-opt", active && "on", disabled && "off"),
      onClick: disabled ? undefined : onSelect,
      role: "button",
      tabIndex: disabled ? -1 : 0,
      onKeyDown: (event) => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) onSelect();
      },
    },
    h("span", { className: "ght-radio" }),
    h("div", null, h("b", null, title), h("p", null, desc)),
  );
}

function CandidateList({ t, cands, pick, onPick }) {
  if (!cands.length) {
    return h("div", { className: "ght-pick-empty" }, t("这个仓库下还没有 worktree", "No worktrees under this repository"));
  }
  return h(
    "div",
    { className: "ght-picks" },
    cands.map((c) =>
      h(
        "button",
        {
          key: c.wt.workspaceId,
          type: "button",
          className: cx("ght-pick", pick === c.wt.workspaceId && "on"),
          disabled: c.disabled,
          onClick: () => onPick(c.wt.workspaceId),
        },
        h("span", { className: "ght-radio" }),
        h(Icon, { name: "branch", size: 13 }),
        h("span", { className: "ght-pick-l" }, c.wt.name),
        h("span", { className: "ght-mono ght-pick-b" }, c.wt.branch),
        h("span", { className: "ght-sp" }),
        h("span", { className: `ght-pick-s ght-${c.state}` }, c.text),
      ),
    ),
  );
}

function CreatePreview({ t, pr, branch, repo }) {
  return h(
    "div",
    { className: "ght-create-pv" },
    h("div", null, h("span", null, t("分支", "Branch")), h("code", null, branch)),
    h(
      "div",
      null,
      h("span", null, t("来源", "Source")),
      h("code", null, `pull/${pr.number}/head`),
      h("small", null, `${pr.author}:${pr.headRefName}`),
    ),
    h(
      "div",
      null,
      h("span", null, t("位置", "Path")),
      h("code", null, repo ? `${repo.path}-worktrees/${branch}` : "—"),
    ),
  );
}

function useCreateWorktree({ t, ctx, store, index, auto, pr, repo, branch, toast, onClose }) {
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState(null);
  const create = async () => {
    if (!repo) {
      setError(t("找不到这个仓库对应的工作区，无法创建", "No workspace found for this repository"));
      return;
    }
    // 与自动建共用“创建中”登记：同一个 PR 不会被手动和自动各建一个。
    if (auto && !auto.claim(pr.key)) {
      setError(t("插件正在为这个 PR 自动创建 worktree，请稍候", "This PR's worktree is being created automatically"));
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
        prUrl: pr.url,
      });
      // 宿主刷新侧栏晚于创建完成：等新 worktree 出现再绑定，否则关掉「按 PR 号对应」时会对不上。
      const created = await index.waitForWorktree(result.worktreePath);
      if (created) {
        store.bind(pr.key, created.workspaceId);
        store.markReviewing(pr.key, Date.now());
      }
      toast(t(`worktree ${branch} 已创建`, `Worktree ${branch} created`));
      onClose();
    } catch (err) {
      const message = err?.message || String(err);
      setError(t(`创建失败：${message}`, `Create failed: ${message}`));
    } finally {
      if (auto) auto.release(pr.key);
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
      mode === "bind"
        ? t("绑定关系存在插件本地，随时可以解除", "Stored locally; you can unlink anytime")
        : t("创建完成后自动对应到这个 PR", "Links automatically once created"),
    ),
    h("span", { className: "ght-sp" }),
    h("button", { type: "button", className: "ght-btn", onClick: onCancel }, t("取消", "Cancel")),
    h(
      "button",
      {
        type: "button",
        className: "ght-btn ght-btn-pri",
        disabled: creating || (mode === "bind" && !pick),
        onClick: onConfirm,
      },
      creating ? t("创建中…", "Creating…") : mode === "bind" ? t("绑定", "Link") : t("创建 worktree", "Create worktree"),
    ),
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
      title: t("绑定已有的 worktree", "Link an existing worktree"),
      desc: t(
        "只在插件里记一笔对应关系，不动 git、不切分支。绑定后这个 worktree 的侧栏徽标显示这个 PR 的状态。",
        "Stored in the plugin only; no git operations. The sidebar badge then shows this PR's state.",
      ),
    }),
    mode === "bind" ? h(CandidateList, { t, cands, pick, onPick: setPick }) : null,
    h(Option, {
      active: mode === "create",
      onSelect: () => setMode("create"),
      title: t("新建 worktree（从 PR 创建）", "Create a worktree from this PR"),
      desc: t(
        "走客户端「新建 Worktree › 从 PR 创建」同一条管线，侧栏会出现创建进度；fork 的 PR 也适用。",
        "Uses the host's create-from-PR pipeline; progress appears in the sidebar. Works for forks.",
      ),
    }),
    mode === "create" ? h(CreatePreview, { t, pr, branch, repo }) : null,
    error ? h("div", { className: "ght-bind-error" }, error) : null,
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

function confirmBind({ store, auto, cands, pick, pr, t, toast, onClose }) {
  if (!pick) return;
  const candidate = cands.find((c) => c.wt.workspaceId === pick);
  // 你主动绑定了一个自动建的 worktree：它就是你的了。
  if (candidate?.wt.auto && auto) auto.adoptWorktree(pick);
  store.bind(pr.key, pick);
  store.markReviewing(pr.key, Date.now());
  toast(
    candidate?.state === "taken"
      ? t(`已绑定 ${candidate.wt.name}（已解除原来的对应）`, `Linked ${candidate.wt.name} (previous link removed)`)
      : t(`已绑定 ${candidate?.wt.name || ""} ↔ #${pr.number}`, `Linked ${candidate?.wt.name || ""} ↔ #${pr.number}`),
  );
  onClose();
}

export function BindModal({ t, ctx, store, index, auto, pr, wts, prs, bindings, rules, toast, onClose }) {
  const { cands, firstFree, mode, setMode, pick, setPick, branch, repo } = useBindState({ pr, index, wts, prs, bindings, rules });
  const creation = useCreateWorktree({ t, ctx, store, index, auto, pr, repo, branch, toast, onClose });
  const confirm = () => {
    if (mode !== "bind") creation.create();
    else confirmBind({ store, auto, cands, pick, pr, t, toast, onClose });
  };
  return [
    h("div", { key: "scrim", className: "ght-mscrim", onClick: onClose }),
    h(
      "div",
      { key: "modal", className: "ght-modal ght-bind-modal", role: "dialog", "aria-label": t("关联 worktree", "Link worktree") },
      h(
        "div",
        { className: "ght-m-head" },
        h("div", null, h("b", null, t("关联 Worktree", "Link worktree")), h("div", { className: "ght-m-sub" }, `${pr.repoSlug} #${pr.number} · ${pr.title}`)),
        h("span", { className: "ght-sp" }),
        h("button", { type: "button", className: "ght-icon-btn ght-bare", onClick: onClose }, h(Icon, { name: "x", size: 15 })),
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
        error: creation.error,
      }),
      h(BindFooter, {
        t,
        mode,
        pick,
        creating: creation.creating,
        onCancel: onClose,
        onConfirm: confirm,
      }),
    ),
  ];
}
