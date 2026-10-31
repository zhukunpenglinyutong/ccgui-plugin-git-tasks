/** 与看板一致的“已跟踪行”：入口计数、自动建 worktree、飞书汇总共用同一套口径。 */

import { autoFlags } from "./domain/autowt.js";
import { selectRows } from "./domain/stats.js";

export function decoratedPrs(state, allPrs) {
  const repoIndexMap = new Map(state.cfg.repos.map((r, i) => [r.slug, i]));
  const ignored = new Set(state.local.ignored);
  return allPrs.map((pr) => ({
    ...pr,
    ignored: ignored.has(pr.key),
    repoIndex: repoIndexMap.get(pr.repoSlug) ?? 0,
  }));
}

export function meSetOf(state) {
  return new Set(
    [state.runtime.ghLogin, ...state.cfg.extraAccounts]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase()),
  );
}

export function reposEnabledOf(state) {
  const out = {};
  for (const repo of state.cfg.repos) out[repo.slug] = repo.enabled && repo.available !== false;
  return out;
}

/** 侧栏 worktree + 是否“插件自动建、还没开始审查”。 */
export function worktreesOf(store, index) {
  return autoFlags(index.getSnapshot().worktrees, store.getSnapshot().auto);
}

export function trackedRows(store, index, now = Date.now()) {
  const state = store.getSnapshot();
  const prs = decoratedPrs(state, store.allPrs());
  const wts = worktreesOf(store, index);
  return {
    prs,
    wts,
    rows: selectRows(prs, {
      rules: state.cfg.rules,
      meSet: meSetOf(state),
      reposEnabled: reposEnabledOf(state),
      wts,
      bindings: state.local.bindings,
      reviewingSince: state.local.reviewing,
      now,
    }),
  };
}
