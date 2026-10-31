/** 清理已结束 PR 的自动 worktree（只在你点了之后执行）。
 *  宿主删除带 --force：删之前逐个重新确认仍可清理，并检查未提交改动；不删分支。 */

import { cleanableAuto } from "../domain/autowt.js";
import { worktreesOf } from "../rows.js";

export function createCleanup({ ctx, store, index, exec, now, isDisposed }) {
  function cleanable() {
    return cleanableAuto({ wts: worktreesOf(store, index), records: store.getSnapshot().auto, prs: store.allPrs() });
  }

  /** 列表打开后情况可能变了（你点了开始审查 / PR 被重开）：删之前再确认一次。 */
  const stillCleanable = (item) => cleanable().some((c) => c.prKey === item.prKey && c.wt.path === item.wt.path);

  async function removeOne(item) {
    const repo = index.getSnapshot().repos.find((r) => r.slug === item.wt.repo);
    if (!repo || !stillCleanable(item)) return "skipped";
    if (await exec.isDirty(item.wt.path)) return "dirty";
    try {
      await ctx.worktrees.remove({ repoPath: repo.path, worktreePath: item.wt.path, branch: item.wt.branch, deleteBranch: false });
    } catch {
      return "failed";
    }
    if (isDisposed()) return "removed";
    const record = store.getSnapshot().auto[item.prKey];
    if (record) store.setAutoRecord(item.prKey, { ...record, status: "removed", at: now() });
    store.unbind(item.prKey);
    store.clearReviewing(item.prKey);
    return "removed";
  }

  async function cleanup(items) {
    const out = { removed: 0, dirty: 0, failed: 0, skipped: 0 };
    for (const item of items) {
      if (isDisposed()) break;
      out[await removeOne(item)] += 1;
    }
    if (out.removed && !isDisposed()) await index.refresh();
    return out;
  }

  return { cleanable, cleanup, isDirty: (path) => exec.isDirty(path) };
}
