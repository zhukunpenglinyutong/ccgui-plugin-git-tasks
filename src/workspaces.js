/** 工作区索引：仓库映射 + worktree 行；供面板、徽标、设置共用。
 *  激活 / 同步 / 显式刷新时重建；SDK 0.3.22 的徽标 onChange 也会触发刷新
 *  （见 badges.js），因此宿主侧新建/删除 worktree 能跟上。 */

import { mapWorktrees, resolveWorkspaceRepos } from "./repos.js";

/** 合并仓库设置：保留既有顺序与开关（颜色稳定），新仓库追加。 */
export function mergeRepoList(existing, discovered) {
  const found = new Set(discovered.map((d) => d.slug));
  const kept = (existing || []).map((item) => ({ ...item, available: found.has(item.slug) }));
  const known = new Set(kept.map((item) => item.slug));
  const added = discovered
    .filter((d) => !known.has(d.slug))
    .map((d) => ({ slug: d.slug, enabled: true, available: true }));
  return [...kept, ...added];
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createWorkspaceIndex({ ctx, exec, store, onUpdate, now = Date.now, sleep = defaultSleep }) {
  let snapshot = { repos: [], worktrees: [], loading: false, error: null };
  const listeners = new Set();

  const getSnapshot = () => snapshot;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function set(next) {
    snapshot = next;
    for (const listener of listeners) listener();
    if (onUpdate) onUpdate(snapshot);
  }

  async function refresh() {
    set({ ...snapshot, loading: true, error: null });
    try {
      const rows = await ctx.workspaces.list();
      const repos = await resolveWorkspaceRepos(rows, {
        runGit: (args) => exec.runGit(args),
      });
      const byWorkspace = new Map(repos.map((r) => [r.workspaceId, r]));
      const worktrees = mapWorktrees(rows, byWorkspace);
      set({ repos, worktrees, loading: false, error: null });
      // 宿主侧栏尚未加载完时可能短暂返回空数组：不能据此清空仓库设置与绑定。
      if (rows.length > 0) {
        store.setRepos(mergeRepoList(store.getSnapshot().cfg.repos, repos));
        store.pruneBindings(new Set(worktrees.map((w) => w.workspaceId)));
      }
      return snapshot;
    } catch (error) {
      set({ ...snapshot, loading: false, error: error?.message || String(error) });
      return snapshot;
    }
  }

  /** 宿主在创建 resolve 之后才异步刷新侧栏：反复刷新直到 worktree 出现（最多 timeoutMs）。 */
  async function waitForWorktree(path, { timeoutMs = 5000, intervalMs = 400 } = {}) {
    const deadline = now() + timeoutMs;
    for (;;) {
      const snap = await refresh();
      const hit = snap.worktrees.find((w) => w.path === path);
      if (hit) return hit;
      if (now() >= deadline) return null;
      await sleep(intervalMs);
    }
  }

  return { getSnapshot, subscribe, refresh, waitForWorktree };
}
