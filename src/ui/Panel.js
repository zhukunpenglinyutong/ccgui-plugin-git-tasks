/** 中心页签：头部 / KPI / 图表 / 今日流转 / 看板与列表 / 抽屉与弹窗。 */

import { React } from "./react.js";
import { Icon, RepoDot, cx, h, repoColor, toneColor, useEscape, useNow, useStore } from "./common.js";
import { DailyChart } from "./Chart.js";
import { Board } from "./Board.js";
import { ListView } from "./ListView.js";
import { Drawer } from "./Drawer.js";
import { SettingsModal, SettingsBody } from "./SettingsModal.js";
import { BindModal } from "./BindModal.js";
import { counts, dailySeries, dayStart, flowByDay, selectRows, todayFlow } from "../domain/stats.js";
import { prUrl } from "../domain/text.js";
import { describeGhError } from "../gh/exec.js";

const FILTERS = [
  ["all", "全部", "All"],
  ["mine", "等我处理", "Yours"],
  ["author", "等作者", "Author"],
  ["merge", "等合并", "Merge"],
  ["today", "今日新增", "New today"],
  ["done", "已结束", "Finished"],
];

function relTime(ms, now, t) {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("刚刚", "just now");
  if (min < 60) return t(`${min} 分钟前`, `${min}m ago`);
  const hours = Math.floor(min / 60);
  if (hours < 24) return t(`${hours} 小时前`, `${hours}h ago`);
  return t(`${Math.floor(hours / 24)} 天前`, `${Math.floor(hours / 24)}d ago`);
}

function useToast() {
  const [toast, setToast] = React.useState(null);
  const timer = React.useRef(null);
  const show = React.useCallback((message, undo) => {
    clearTimeout(timer.current);
    const dismiss = (next) => {
      setToast(null);
      if (next) setTimeout(() => show(next), 0);
    };
    setToast({ message, undo, dismiss });
    timer.current = setTimeout(() => setToast(null), undo ? 5000 : 2600);
  }, []);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show];
}

function useTrackedRows(store, index, now) {
  const state = useStore(store);
  const workspaces = useStore(index);
  const repoIndexMap = React.useMemo(
    () => new Map(state.cfg.repos.map((r, i) => [r.slug, i])),
    [state.cfg.repos],
  );
  const ignoredSet = React.useMemo(() => new Set(state.local.ignored), [state.local.ignored]);
  const prs = React.useMemo(() => {
    const ignored = ignoredSet;
    return store.allPrs().map((pr) => ({
      ...pr,
      ignored: ignored.has(pr.key),
      repoIndex: repoIndexMap.get(pr.repoSlug) ?? 0,
    }));
  }, [state.snapshots, state.local.marks, ignoredSet, repoIndexMap, store]);
  const meSet = React.useMemo(
    () =>
      new Set(
        [state.runtime.ghLogin, ...state.cfg.extraAccounts]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase()),
      ),
    [state.runtime.ghLogin, state.cfg.extraAccounts],
  );
  const reposEnabled = React.useMemo(() => {
    const map = {};
    for (const repo of state.cfg.repos) map[repo.slug] = repo.enabled && repo.available !== false;
    return map;
  }, [state.cfg.repos]);
  const rows = React.useMemo(
    () =>
      selectRows(prs, {
        rules: state.cfg.rules,
        meSet,
        repoFilter: state.ui.repoFilter,
        reposEnabled,
        showIgnored: state.ui.showIgnored,
        wts: workspaces.worktrees,
        bindings: state.local.bindings,
        reviewingSince: state.local.reviewing,
        now,
      }),
    [
      prs,
      state.cfg.rules,
      meSet,
      state.ui.repoFilter,
      reposEnabled,
      state.ui.showIgnored,
      workspaces.worktrees,
      state.local.bindings,
      state.local.reviewing,
      now,
    ],
  );
  return { state, prs, rows, workspaces };
}

function useMetrics(state, rows, prs, now, selectedSlugs) {
  const { defs, rules } = state.cfg;
  const c = React.useMemo(
    () => counts(rows, { defs, rules, now, excluded: prs.length - rows.length }),
    [rows, defs, rules, now, prs.length],
  );
  const flow = React.useMemo(() => todayFlow(prs, rules, now), [prs, rules, now]);
  const chart = React.useMemo(() => {
    const full = dailySeries(state.snapshots, state.cfg.repos, rules, now);
    const keep = full.series
      .map((repo, index) => ({ repo, index }))
      .filter(({ repo }) => selectedSlugs.includes(repo.slug));
    return {
      series: keep.map(({ repo }) => repo),
      days: full.days.map((day) => ({
        ...day,
        vals: keep.map(({ index }) => day.vals[index]),
      })),
    };
  }, [state.snapshots, state.cfg.repos, rules, now, selectedSlugs.join("|")]);
  const flows = React.useMemo(() => flowByDay(prs, rules, now), [prs, rules, now]);
  return { c, flow, chart, flows };
}

function usePanelActions({ store, exec, sync, showToast, t }) {
  return React.useMemo(
    () => ({
      ghOpen: (url) => exec.openUrl(url).catch((error) => showToast(describeGhError(error))),
      openPr: (key) => store.setUi({ drawerKey: key, modal: null }),
      openBind: (key) => store.setUi({ modal: { type: "bind", prKey: key } }),
      onWorktree: (wt) => {
        const text = wt.path || "";
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(
            () => showToast(t(`已复制路径：${text}`, `Path copied: ${text}`)),
            () => showToast(text),
          );
        } else {
          showToast(text);
        }
      },
      dismissError: (slug) => {
        const errors = { ...(store.getSnapshot().runtime.errors || {}) };
        delete errors[slug];
        store.setRuntime({ errors });
      },
      dismissGlobalError: () => store.setRuntime({ ghError: null }),
      retryRepo: async (slug) => {
        const result = await sync.run([{ slug, enabled: true, available: true }]);
        if (result?.errors?.[slug]) showToast(result.errors[slug]);
        else showToast(t(`${slug} 已恢复`, `${slug} recovered`));
      },
      refreshPr: async (pr) => {
        if (!sync.refreshPr) return;
        try {
          const updated = await sync.refreshPr(pr.key);
          if (!updated) {
            showToast(t("这个 PR 不在当前同步结果里，请先整体同步", "PR is not in the current snapshot; sync first"));
            return;
          }
          const label =
            updated.state === "MERGED"
              ? t("已合并", "merged")
              : updated.state === "CLOSED"
                ? t("已关闭", "closed")
                : t("仍在进行中", "still open");
          showToast(t(`已刷新 #${updated.number}：${label}`, `#${updated.number} refreshed: ${label}`));
        } catch (error) {
          showToast(describeGhError(error));
        }
      },
      syncNow: async () => {
        await sync.run();
        const snapshot = store.getSnapshot();
        const errors = Object.entries(snapshot.runtime.errors || {});
        if (errors.length) showToast(errors[0][1]);
        else if (snapshot.runtime.ghError) showToast(snapshot.runtime.ghError);
        else showToast(t("已同步", "Synced"));
      },
    }),
    [store, exec, sync, showToast, t],
  );
}

function Toast({ toast, t }) {
  if (!toast) return null;
  return h(
    "div",
    { className: cx("ght-toast", toast.undo && "ght-toast-act") },
    h("span", null, toast.message),
    toast.undo
      ? h(
          "button",
          {
            type: "button",
            onClick: () => {
              toast.undo();
              toast.dismiss(t("已撤销", "Undone"));
            },
          },
          t("撤销", "Undo"),
        )
      : null,
  );
}

function usePanelModel({ store, index, exec, sync, t }) {
  // 行/统计用 60s 粒度刷新；同步中头部状态单独按秒计时，避免整页重算。
  const coarse = useNow(60_000);
  const { state, prs, rows, workspaces } = useTrackedRows(store, index, coarse);
  const enabledRepos = state.cfg.repos.filter((r) => r.enabled && r.available !== false);
  const filterValue = state.ui.repoFilter;
  const filterList =
    filterValue === "all"
      ? null
      : Array.isArray(filterValue)
        ? filterValue
        : [filterValue];
  const selectedSlugs =
    filterList === null
      ? enabledRepos.map((r) => r.slug)
      : filterList.filter((slug) => enabledRepos.some((r) => r.slug === slug));
  const visiblePrs = React.useMemo(
    () =>
      state.ui.repoFilter === "all"
        ? prs
        : prs.filter((pr) => selectedSlugs.includes(pr.repoSlug)),
    [prs, state.ui.repoFilter, selectedSlugs.join("|")],
  );
  const metrics = useMetrics(state, rows, visiblePrs, coarse, selectedSlugs);
  const now = useNow(state.runtime.syncing ? 1000 : 60_000);
  const [toast, showToast] = useToast();
  const actions = usePanelActions({ store, exec, sync, showToast, t });
  const missingReviewSince = rows
    .filter((row) => row.d.key === "reviewing" && !state.local.reviewing[row.pr.key])
    .map((row) => row.pr.key)
    .join("\n");
  React.useEffect(() => {
    if (!missingReviewSince) return;
    for (const key of missingReviewSince.split("\n")) store.markReviewing(key, Date.now());
  }, [missingReviewSince, store]);
  const filterFn = React.useCallback(
    (row) => {
      switch (state.ui.filter) {
        case "mine":
          return state.cfg.defs[row.d.key].owner === "me";
        case "author":
          return state.cfg.defs[row.d.key].owner === "author";
        case "merge":
          return state.cfg.defs[row.d.key].owner === "merge";
        case "done":
          return state.cfg.defs[row.d.key].owner === "done";
        case "today":
          return row.pr.createdAt >= dayStart(Date.now(), state.cfg.rules.dayCutoff);
        default:
          return true;
      }
    },
    [state.ui.filter, state.cfg.defs, state.cfg.rules.dayCutoff],
  );
  useEscape(() => store.setUi({ modal: null, drawerKey: null }), true);
  const selectedPr = state.ui.drawerKey ? prs.find((p) => p.key === state.ui.drawerKey) : null;
  return { ...metrics, now, state, prs, rows, toast, showToast, actions, workspaces, enabledRepos, selectedSlugs, filterFn, selectedPr };
}

/** 多选仓库：全部 → 点一个只留它；再点累加；点已选的移除；选满回到全部。 */
function nextRepoFilter(state, enabledRepos, slug) {
  const all = enabledRepos.map((r) => r.slug);
  if (slug === "all") return "all";
  const current = state.ui.repoFilter === "all" ? all.slice() : [...state.ui.repoFilter];
  let next;
  if (state.ui.repoFilter === "all") next = [slug];
  else if (current.includes(slug)) next = current.filter((s) => s !== slug);
  else next = [...current, slug];
  const ordered = all.filter((s) => next.includes(s));
  return !ordered.length || ordered.length === all.length ? "all" : ordered;
}

function PanelContent({ t, store, model }) {
  const { state, rows, enabledRepos, selectedSlugs, now, actions, c, flow, chart, flows, workspaces, prs, filterFn, showToast } = model;
  return h(
    "div",
    { className: "ght-scroller" },
    h(
      "div",
      { className: "ght-pv" },
      h(PanelHeader, {
        t,
        state,
        rows,
        enabledRepos,
        selectedSlugs,
        now,
        onSync: actions.syncNow,
        onRetry: actions.retryRepo,
        onDismiss: actions.dismissError,
        onDismissAll: actions.dismissGlobalError,
        onOpenSettings: () => store.setUi({ modal: "settings" }),
        onPickRepo: (slug) => store.setUi({ repoFilter: nextRepoFilter(state, enabledRepos, slug) }),
      }),
      h(Kpis, {
        t,
        c,
        flow,
        chart,
        defs: state.cfg.defs,
        filter: state.ui.filter,
        setFilter: (f) => store.setUi({ filter: f }),
      }),
      h(MetricsGrid, { t, store, state, chart, flows, flow }),
      h(WorkSection, {
        t,
        state,
        store,
        action: actions,
        rows,
        filterFn,
        now,
        enabledRepos,
        workspaces,
        prs,
        filterCounts: c,
        onBind: actions.openBind,
        onWorktree: actions.onWorktree,
        toast: showToast,
      }),
    ),
  );
}

export function createPanel({ ctx, t, store, index, exec, sync }) {
  function Panel() {
    const model = usePanelModel({ store, index, exec, sync, t });
    return h(
      "div",
      { className: "ght-root" },
      h(PanelContent, { t, store, model }),
      h(Overlays, {
        t,
        ctx,
        store,
        index,
        state: model.state,
        now: model.now,
        prs: model.prs,
        workspaces: model.workspaces,
        selectedPr: model.selectedPr,
        counts: model.c,
        toast: model.toast,
        showToast: model.showToast,
        actions: model.actions,
      }),
    );
  }
  return Panel;
}

function DrawerLayer({ t, ctx, store, index, state, now, prs, workspaces, selectedPr, showToast, actions }) {
  if (!selectedPr) return null;
  return h(Drawer, {
    t,
    ctx,
    store,
    pr: selectedPr,
    rules: state.cfg.rules,
    defs: state.cfg.defs,
    now,
    wts: workspaces.worktrees,
    prs,
    bindings: state.local.bindings,
    index,
    toast: showToast,
    onClose: () => store.setUi({ drawerKey: null }),
    onGh: actions.ghOpen,
    onRefresh: () => actions.refreshPr(selectedPr),
    onBind: actions.openBind,
    onWorktree: actions.onWorktree,
  });
}

function SettingsLayer({ t, ctx, store, index, state, now, counts, showToast, actions }) {
  if (state.ui.modal !== "settings") return null;
  return h(SettingsModal, {
    t,
    ctx,
    store,
    index,
    rules: state.cfg.rules,
    defs: state.cfg.defs,
    counts,
    now,
    toast: showToast,
    onSync: actions.syncNow,
    onClose: () => store.setUi({ modal: null, drawerKey: null }),
  });
}

function BindLayer({ t, ctx, store, index, state, prs, workspaces, showToast }) {
  const bindPr = state.ui.modal?.prKey ? prs.find((p) => p.key === state.ui.modal.prKey) : null;
  if (state.ui.modal?.type !== "bind" || !bindPr) return null;
  return h(BindModal, {
    t,
    ctx,
    store,
    index,
    pr: bindPr,
    wts: workspaces.worktrees,
    prs,
    bindings: state.local.bindings,
    rules: state.cfg.rules,
    toast: showToast,
    onClose: () => store.setUi({ modal: null, drawerKey: null }),
  });
}

function Overlays({ t, ctx, store, index, state, now, prs, workspaces, selectedPr, counts, toast, showToast, actions }) {
  return h(
    React.Fragment,
    null,
    h(DrawerLayer, { t, ctx, store, index, state, now, prs, workspaces, selectedPr, showToast, actions }),
    h(SettingsLayer, { t, ctx, store, index, state, now, counts, showToast, actions }),
    h(BindLayer, { t, ctx, store, index, state, prs, workspaces, showToast }),
    h(Toast, { toast, t }),
  );
}

function SyncStatus({ t, state, now }) {
  const rules = state.cfg.rules;
  const progress = state.runtime.progress || { done: 0, total: 0 };
  const elapsed =
    state.runtime.syncStartedAt && state.runtime.syncing
      ? Math.max(0, Math.round((now - state.runtime.syncStartedAt) / 1000))
      : 0;
  const syncingText =
    progress.total > 0
      ? t(
          `同步中 · ${progress.done}/${progress.total} 仓库${elapsed ? ` · ${elapsed}s` : ""}`,
          `Syncing · ${progress.done}/${progress.total} repos${elapsed ? ` · ${elapsed}s` : ""}`,
        )
      : t(`同步中${elapsed ? ` · ${elapsed}s` : "…"}`, `Syncing${elapsed ? ` · ${elapsed}s` : "…"}`);
  return h(
    "span",
    { className: "ght-sync" },
    h("i", null),
    state.runtime.syncing
      ? syncingText
      : state.runtime.lastSync
        ? `${relTime(state.runtime.lastSync, now, t)} · ${rules.interval === "0" ? t("仅手动", "manual") : t(`每 ${rules.interval} 分钟`, `every ${rules.interval} min`)}`
        : t("还没同步", "Not synced"),
  );
}

function BannerClose({ t, onClick }) {
  return h(
    "button",
    {
      type: "button",
      className: "ght-banner-close",
      title: t("关闭", "Dismiss"),
      "aria-label": t("关闭", "Dismiss"),
      onClick,
    },
    h(Icon, { name: "x", size: 13 }),
  );
}

function SyncBanner({ t, state, onSync, onRetry, onDismiss, onDismissAll }) {
  // 同步中不展示上一轮错误，避免 "0/4 · 2s" 与旧错误横幅同时出现。
  if (state.runtime.syncing) return null;
  const errors = Object.entries(state.runtime.errors || {});
  if (!errors.length && !state.runtime.ghError) return null;
  if (state.runtime.ghError) {
    return h(
      "div",
      { className: "ght-banner" },
      h("span", { className: "ght-banner-text" }, state.runtime.ghError),
      h("button", { type: "button", className: "ght-linkish", onClick: onSync }, t("重试", "Retry")),
      h(BannerClose, { t, onClick: onDismissAll }),
    );
  }
  return h(
    "div",
    { className: "ght-banner ght-banner-list" },
    errors.map(([slug, message]) =>
      h(
        "div",
        { key: slug, className: "ght-banner-row" },
        h("span", { className: "ght-banner-text" }, `${slug}: ${message}`),
        h(
          "button",
          { type: "button", className: "ght-linkish", onClick: () => onRetry(slug) },
          t("重试", "Retry"),
        ),
        h(BannerClose, { t, onClick: () => onDismiss(slug) }),
      ),
    ),
  );
}

function PanelHeader({ t, state, rows, enabledRepos, selectedSlugs, now, onSync, onRetry, onDismiss, onDismissAll, onOpenSettings, onPickRepo }) {
  return h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "ght-pv-head" },
      h("span", { className: "ght-pv-title" }, t("PR 流转", "PR flow")),
      h(RepoPicker, { t, state, rows, enabledRepos, selectedSlugs, onPick: onPickRepo }),
      h("span", { className: "ght-readonly" }, t("数据来自本机 gh · 只读", "from local gh · read-only")),
      h("span", { className: "ght-sp" }),
      h(SyncStatus, { t, state, now }),
      h(
        "button",
        { type: "button", className: "ght-icon-btn", title: t("立即同步", "Sync now"), onClick: onSync, disabled: state.runtime.syncing },
        h(Icon, { name: "refresh", size: 14 }),
      ),
      h(
        "button",
        { type: "button", className: "ght-icon-btn", title: t("设置", "Settings"), onClick: onOpenSettings },
        h(Icon, { name: "gear", size: 14 }),
      ),
    ),
    h(SyncBanner, { t, state, onSync, onRetry, onDismiss, onDismissAll }),
  );
}

function RepoMenu({ t, state, rows, enabledRepos, current, onPick }) {
  const openCount = (slug) =>
    rows.filter((r) => r.pr.repoSlug === slug && state.cfg.defs[r.d.key].owner !== "done").length;
  return h(
    "div",
    { className: "ght-repo-menu" },
    h(
      "button",
      { type: "button", className: cx(current === "all" && "on"), onClick: () => onPick("all") },
      h(Icon, { name: "pr", size: 14 }),
      t("全部仓库", "All repositories"),
      h("small", null, t(`${enabledRepos.length} 个`, `${enabledRepos.length}`)),
    ),
    h("hr"),
    enabledRepos.map((repo) =>
      h(
        "button",
        {
          key: repo.slug,
          type: "button",
          className: cx(
            current !== "all" && current.includes(repo.slug) && "on",
            current !== "all" && !current.includes(repo.slug) && "ght-dim",
          ),
          onClick: () => onPick(repo.slug),
        },
        h(RepoDot, { index: state.cfg.repos.findIndex((r) => r.slug === repo.slug) }),
        h("span", { className: "ght-repo-name", title: repo.slug }, repo.slug),
        h("small", null, t(`${openCount(repo.slug)} 进行中`, `${openCount(repo.slug)} open`)),
      ),
    ),
  );
}

function RepoPicker({ t, state, rows, enabledRepos, selectedSlugs, onPick }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  const current = state.ui.repoFilter;
  const allSelected = current === "all";
  const pick = (slug) => {
    // 多选时保持菜单打开，方便连续勾选；只在「全部仓库」后收起。
    if (slug === "all") setOpen(false);
    onPick(slug);
  };
  return h(
    "div",
    { className: "ght-repo-wrap", ref },
    h(
      "button",
      { type: "button", className: "ght-repo-chip", onClick: () => setOpen(!open) },
      allSelected
        ? [h(Icon, { key: "i", name: "pr", size: 14 }), h("b", { key: "b" }, t("全部仓库", "All repositories")), h("em", { key: "e" }, enabledRepos.length)]
        : selectedSlugs.length === 1
          ? [
              h(RepoDot, { key: "d", index: state.cfg.repos.findIndex((r) => r.slug === selectedSlugs[0]) }),
              h("b", { key: "b" }, selectedSlugs[0]),
            ]
          : [
              h(Icon, { key: "i", name: "pr", size: 14 }),
              h("b", { key: "b" }, t(`${selectedSlugs.length} 个仓库`, `${selectedSlugs.length} repos`)),
              h("em", { key: "e" }, `${selectedSlugs.length}/${enabledRepos.length}`),
            ],
      h(Icon, { name: "chevD", size: 12 }),
    ),
    open ? h(RepoMenu, { t, state, rows, enabledRepos, current, onPick: pick }) : null,
  );
}

function MetricsGrid({ t, store, state, chart, flows, flow }) {
  return h(
    "div",
    { className: "ght-grid2" },
    h(DailyChart, {
      t,
      series: chart.series,
      days: chart.days,
      flow: flows,
      mode: state.ui.chartMode,
      onMode: (mode) => store.setUi({ chartMode: mode }),
    }),
    h(TodayFlow, { t, flow, defs: state.cfg.defs, rules: state.cfg.rules }),
  );
}

function WorkToolbar({ t, state, store, filterCounts }) {
  return h(
    "div",
    { className: "ght-work-tb" },
    h(
      "div",
      { className: "ght-seg" },
      h(
        "button",
        { type: "button", className: cx(state.ui.view === "board" && "on"), onClick: () => store.setUi({ view: "board" }) },
        h(Icon, { name: "board", size: 13 }),
        t("看板", "Board"),
      ),
      h(
        "button",
        { type: "button", className: cx(state.ui.view === "list" && "on"), onClick: () => store.setUi({ view: "list" }) },
        h(Icon, { name: "list", size: 13 }),
        t("列表", "List"),
      ),
    ),
    h(
      "div",
      { className: "ght-seg" },
      FILTERS.map(([key, zh, en]) =>
        h(
          "button",
          { key, type: "button", className: cx(state.ui.filter === key && "on"), onClick: () => store.setUi({ filter: key }) },
          t(zh, en),
          h("em", null, filterCounts[key] ?? ""),
        ),
      ),
    ),
    h("span", { className: "ght-sp" }),
    h(
      "label",
      { className: "ght-search" },
      h(Icon, { name: "search", size: 13 }),
      h("input", {
        placeholder: t("搜索标题 / #编号 / 作者 / 仓库", "Search title / #number / author / repo"),
        value: state.ui.query,
        onChange: (event) => store.setUi({ query: event.target.value }),
      }),
    ),
  );
}

function WorkFooter({ t, state, store, filterCounts }) {
  return h(
    "div",
    { className: "ght-list-foot" },
    h(
      "span",
      null,
      state.ui.view === "board"
        ? t("新卡片默认“超时优先、等得最久优先”；你手动排过的顺序会保留", "New cards sort by overdue, then longest waiting")
        : t("按“超时优先、等得最久优先”排序", "Sorted by overdue, then longest waiting"),
    ),
    h("span", { className: "ght-sp" }),
    filterCounts.ignored
      ? h(
          "button",
          { type: "button", className: "ght-linkish", onClick: () => store.setUi({ showIgnored: !state.ui.showIgnored }) },
          state.ui.showIgnored
            ? t(`隐藏已忽略 ${filterCounts.ignored} 个`, `Hide ${filterCounts.ignored} ignored`)
            : t(`显示已忽略 ${filterCounts.ignored} 个`, `Show ${filterCounts.ignored} ignored`),
        )
      : null,
    h("span", null, t(`已排除 ${filterCounts.excluded} 个（机器人 / 自己的 PR，见设置）`, `${filterCounts.excluded} excluded (bots / your own PRs)`)),
  );
}

function WorkBody({ t, state, store, action, rows, filterFn, now, enabledRepos, workspaces, prs }) {
  if (!enabledRepos.length) {
    return h("div", { className: "ght-empty" }, t("没有可跟踪的仓库。打开一个 GitHub 仓库工作区后会自动出现。", "No trackable repositories. Open a GitHub workspace."));
  }
  if (state.ui.view === "board") {
    return h(Board, {
      t,
      store,
      rows,
      rules: state.cfg.rules,
      defs: state.cfg.defs,
      order: state.local.order,
      endedDays: state.cfg.rules.endedDays,
      now,
      query: state.ui.query,
      filterFn,
      wts: workspaces.worktrees,
      prs,
      bindings: state.local.bindings,
      selectedKey: state.ui.drawerKey,
      toast: action.toast,
      onOpen: action.openPr,
      onBind: action.openBind,
      onWorktree: action.onWorktree,
    });
  }
  return h(ListView, {
    t,
    rows,
    defs: state.cfg.defs,
    rules: state.cfg.rules,
    order: state.local.order,
    now,
    query: state.ui.query,
    filterFn,
    wts: workspaces.worktrees,
    prs,
    bindings: state.local.bindings,
    selectedKey: state.ui.drawerKey,
    onOpen: action.openPr,
    onBind: action.openBind,
    onWorktree: action.onWorktree,
    onGh: (pr) => action.ghOpen(prUrl(pr)),
  });
}

function WorkSection({ t, state, store, action, rows, filterFn, now, enabledRepos, workspaces, prs, filterCounts, toast }) {
  const actions = { ...action, toast };
  return h(
    "section",
    { className: "ght-card ght-work" },
    h(WorkToolbar, { t, state, store, filterCounts }),
    state.ui.view === "board"
      ? h(
          "div",
          { className: "ght-board-hint" },
          h("span", null, h("b", null, t("拖到其他列", "Drag across columns")), t(" = 在本地记一笔（不写 GitHub，可撤销）", " = local mark (no GitHub write, undoable)")),
          h("span", null, h("b", null, t("列内拖动", "Drag within a column")), t(" = 调整顺序", " = reorder")),
          h("span", null, t("已合并 / 已关闭 / 草稿由 GitHub 决定，不能拖", "Merged / closed / draft are locked")),
        )
      : null,
    h(WorkBody, { t, state, store, action: actions, rows, filterFn, now, enabledRepos, workspaces, prs }),
    h(WorkFooter, { t, state, store, filterCounts }),
  );
}

function Kpis({ t, c, flow, chart, defs, filter, setFilter }) {
  const card = (key, label, value, sub, tone) =>
    h(
      "button",
      { type: "button", className: cx("ght-kpi", filter === key && "on"), onClick: () => setFilter(filter === key ? "all" : key) },
      h("div", { className: "ght-kpi-l" }, tone ? h("i", { style: { background: toneColor(tone) } }) : null, label),
      h("div", { className: "ght-kpi-v" }, value),
      h("div", { className: "ght-kpi-s" }, sub),
    );
  const todaySub =
    chart.series.length > 1
      ? chart.series.map((repo) =>
          h("span", { key: repo.slug, className: "ght-rb" }, h(RepoDot, { index: repo.colorIndex }), flow.byRepo[repo.slug] || 0),
        )
      : t(`近 14 天共 ${chart.days.reduce((a, d) => a + d.vals[0], 0)} 个`, "last 14 days");
  return h(
    "div",
    { className: "ght-kpis" },
    card("today", t("今日新增", "New today"), c.today, todaySub),
    card(
      "mine",
      t("等我处理", "Yours"),
      c.mine,
      h(
        "span",
        null,
        t(
          `待审查 ${c.needs_review} · 审查中 ${c.reviewing} · 待复审 ${c.needs_rereview}`,
          `New ${c.needs_review} · Reviewing ${c.reviewing} · Recheck ${c.needs_rereview}`,
        ),
        c.overdue ? h("b", null, t(` · 超时 ${c.overdue}`, ` · ${c.overdue} overdue`)) : null,
      ),
      defs.needs_rereview.tone,
    ),
    card(
      "author",
      t("等作者修复", "With author"),
      c.author,
      h(
        "span",
        null,
        t(`${c.changes_requested} 待修复${c.draft ? ` · ${c.draft} 草稿` : ""}`, `${c.changes_requested} changes${c.draft ? ` · ${c.draft} drafts` : ""}`),
        c.silent ? h("b", null, t(` · 沉默 ${c.silent}`, ` · ${c.silent} silent`)) : null,
      ),
      defs.changes_requested.tone,
    ),
    card("merge", t("等合并", "To merge"), c.merge, t("你已通过，未合并", "approved, unmerged"), defs.approved.tone),
    card("done", t("今日合并", "Merged today"), c.mergedToday, t(`进行中共 ${c.active} 个`, `${c.active} active`), defs.merged.tone),
  );
}

function TodayFlow({ t, flow, defs, rules }) {
  const row = (tone, label, value, sub) =>
    h(
      "div",
      { className: "ght-flow-row", key: label },
      h("span", { className: "ght-flow-ic", style: { background: `${toneColor(tone)}22`, color: toneColor(tone) } }, h(Icon, { name: "chevR", size: 12 })),
      h("span", { className: "ght-flow-l" }, label, sub ? h("small", null, sub) : null),
      h("span", { className: "ght-flow-v" }, value),
    );
  const subRow = (label, value) =>
    h("div", { className: "ght-flow-row ght-flow-sub", key: label }, h("span", { className: "ght-flow-l" }, label), h("span", { className: "ght-flow-v" }, value));
  return h(
    "section",
    { className: "ght-card" },
    h(
      "header",
      { className: "ght-card-h" },
      h("h3", null, t("今日流转", "Today")),
      h("span", { className: "ght-sub" }, t(`按 ${String(rules.dayCutoff).padStart(2, "0")}:00 切日`, `day starts ${String(rules.dayCutoff).padStart(2, "0")}:00`)),
    ),
    h(
      "div",
      { className: "ght-flow" },
      row("neutral", t("新增 PR", "New PRs"), flow.opened, flow.drafts ? t(`含草稿 ${flow.drafts}`, `${flow.drafts} drafts`) : ""),
      row(defs.needs_review.tone, t("我审查了", "I reviewed"), flow.first + flow.re, t(`首审 ${flow.first} · 复审 ${flow.re}`, `first ${flow.first} · re ${flow.re}`)),
      subRow(t("其中要求修复", "changes"), flow.changes),
      subRow(t("其中通过", "approved"), flow.approve),
      row(defs.changes_requested.tone, t("作者完成修复", "Author fixed"), flow.fixed, t("推送 / 重新请求审查", "push / re-request")),
      row(defs.merged.tone, t("合并 / 关闭", "Merged / closed"), `${flow.merged} / ${flow.closed}`, ""),
    ),
    h("div", { className: "ght-flow-foot" }, t("“审查”只算你自己的、按当前规则计入的审查", "Only your reviews, as counted by current rules")),
  );
}

export { SettingsBody };
