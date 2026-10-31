/** worktree ↔ PR 对应关系（纯函数）。
 *
 * PR 归一化后带 `repoSlug`（owner/repo）与 `headRefName`；worktree 由宿主
 * `WorktreeBadgeTarget` + 仓库映射拼出，带 `workspaceId` / `repo` / `branch`。
 * `bindings` 是 `{ [prKey]: workspaceId }`。
 */

const PICK_ORDER = { free: 0, taken: 1, current: 2, host: 3 };

function findBoundPr(wt, { prs, bindings }) {
  const key = Object.keys(bindings).find((k) => bindings[k] === wt.workspaceId);
  if (!key) return null;
  return prs.find((p) => p.key === key) || null;
}

export function linkPr(wt, { prs, bindings, rules }) {
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

export function wtFor(pr, { wts, prs, bindings, rules }) {
  const boundId = bindings[pr.key];
  if (boundId) return wts.find((w) => w.workspaceId === boundId) || null;
  return wts.find((w) => linkPr(w, { prs, bindings, rules })?.key === pr.key) || null;
}

export function linkSource(wt, pr, bindings) {
  if (wt.auto) return "插件自动创建（未开始审查）";
  if (bindings[pr.key] === wt.workspaceId) return "你手动绑定";
  if (wt.prNumber === pr.number) return "客户端从 PR 创建";
  return "分支名与 PR 一致";
}

/** 「关联 worktree」弹窗的候选列表与状态。 */
export function bindCandidates(pr, { wts, prs, bindings, rules }) {
  return wts
    .filter((w) => w.repo === pr.repoSlug && !w.creating)
    .map((wt) => {
      const current = linkPr(wt, { prs, bindings, rules });
      const manual = Object.values(bindings).includes(wt.workspaceId);
      if (current && current.key === pr.key) {
        return { wt, state: "current", text: "当前已对应这个 PR", disabled: true };
      }
      if (wt.prNumber != null && !manual) {
        return { wt, state: "host", text: `客户端从 #${wt.prNumber} 创建`, disabled: true };
      }
      if (current) {
        return { wt, state: "taken", text: `已对应 #${current.number}，改绑后解除`, disabled: false };
      }
      return { wt, state: "free", text: "空闲", disabled: false };
    })
    .sort((a, b) => PICK_ORDER[a.state] - PICK_ORDER[b.state]);
}

/** 新建 worktree 的分支名：pr-<n>-<三位随机>（计划 §5 阶段 5）。 */
export function newBranchName(pr, random = Math.random) {
  const suffix = String(Math.floor(random() * 1000)).padStart(3, "0");
  return `pr-${pr.number}-${suffix}`;
}

/** 有 worktree 且还没提交结论 → 审查中。`since` 用本地记录的审查开始时间。 */
export function reviewingState(d, hasWorktree, since) {
  if (!hasWorktree || d.key !== "needs_review") return d;
  return { ...d, key: "reviewing", since: since || d.since };
}
