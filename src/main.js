/** github-tasks · Tier-1 入口：组装 store / 数据层 / 领域层 / UI。 */

import { DEFAULT_DEFS } from "./constants.js";
import { createBadges } from "./badges.js";
import { createExec } from "./gh/exec.js";
import { createT, isEnglish, DEFAULT_DEFS_EN } from "./i18n.js";
import { createStore } from "./store.js";
import { createSync, createScheduler } from "./sync.js";
import { createWorkspaceIndex } from "./workspaces.js";
import { counts, selectRows } from "./domain/stats.js";
import { bindReact, React } from "./ui/react.js";
import { h, useStore } from "./ui/common.js";
import { createPanel } from "./ui/Panel.js";
import { SettingsBody } from "./ui/SettingsModal.js";

const ICON_PATHS =
  '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>';

function decorate(store) {
  const state = store.getSnapshot();
  const repoIndexMap = new Map(state.cfg.repos.map((r, i) => [r.slug, i]));
  const ignored = new Set(state.local.ignored);
  return store.allPrs().map((pr) => ({
    ...pr,
    ignored: ignored.has(pr.key),
    repoIndex: repoIndexMap.get(pr.repoSlug) ?? 0,
  }));
}

function rowsOf(store, index) {
  const state = store.getSnapshot();
  const reposEnabled = {};
  for (const repo of state.cfg.repos) reposEnabled[repo.slug] = repo.enabled && repo.available !== false;
  const meSet = new Set(
    [state.runtime.ghLogin, ...state.cfg.extraAccounts]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase()),
  );
  return selectRows(decorate(store), {
    rules: state.cfg.rules,
    meSet,
    reposEnabled,
    wts: index.getSnapshot().worktrees,
    bindings: state.local.bindings,
    reviewingSince: state.local.reviewing,
    now: Date.now(),
  });
}

function navCountOf(store, index) {
  const state = store.getSnapshot();
  if (!state.cfg.rules.navCount) return null;
  const c = counts(rowsOf(store, index), {
    defs: state.cfg.defs,
    rules: state.cfg.rules,
    now: Date.now(),
  });
  return c.mine || null;
}

function NavIcon(props) {
  return h("svg", {
    ...props,
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    dangerouslySetInnerHTML: { __html: ICON_PATHS },
  });
}

function createRuntime(ctx, t) {
  const exec = createExec({ invoke: (command, payload) => ctx.bridge.invoke(command, payload) });
  const store = createStore({
    load: (key) => ctx.storage.get(key),
    save: (key, value) => ctx.storage.set(key, value),
  });
  const index = createWorkspaceIndex({ ctx, exec, store });
  const badges = createBadges({ ctx, store, index, exec, t });
  const sync = createSync({ exec, store, onAfter: () => badges.refresh() });
  return { exec, store, index, badges, sync };
}

function useEmbeddedToast() {
  const [toast, setToast] = React.useState(null);
  const timer = React.useRef(null);
  const show = React.useCallback((message) => {
    clearTimeout(timer.current);
    setToast(message);
    timer.current = setTimeout(() => setToast(null), 2400);
  }, []);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show];
}

function createSettingsSection({ ctx, t, store, index, sync }) {
  return function SettingsSection() {
    const state = useStore(store);
    useStore(index);
    const c = counts(rowsOf(store, index), {
      defs: state.cfg.defs,
      rules: state.cfg.rules,
      now: Date.now(),
    });
    const [toast, show] = useEmbeddedToast();
    return h(
      "div",
      { className: "ght-root ght-embedded" },
      h(SettingsBody, {
        t,
        ctx,
        store,
        index,
        rules: state.cfg.rules,
        defs: state.cfg.defs,
        counts: c,
        now: Date.now(),
        toast: show,
        onSync: () => {
          sync.run();
        },
      }),
      toast ? h("div", { className: "ght-toast" }, toast) : null,
    );
  };
}

function registerSurfaces(ctx, { t, store, index, sync, Panel }) {
  const openPanel = () => {
    try {
      ctx.ui.openCenterTab("board");
    } catch {
      ctx.ui.openSettings();
    }
  };
  let navValue;
  let navDisposer = null;
  const registerNav = () => {
    navValue = navCountOf(store, index);
    if (navDisposer) navDisposer();
    navDisposer = ctx.ui.registerSidebarNav({
      key: "entry",
      label: () => t("Git 任务管理", "Git Tasks"),
      icon: NavIcon,
      order: 10,
      badge: () => navValue,
      onOpen: openPanel,
    });
    return navValue;
  };
  ctx.ui.registerCenterTab({
    key: "board",
    title: () => t("Git 任务管理", "Git Tasks"),
    icon: NavIcon,
    component: Panel,
  });
  registerNav();
  ctx.ui.registerCommand({
    key: "open",
    title: () => t("打开 Git 任务管理", "Open Git Tasks"),
    keywords: () => ["pr", "github", "任务", "流转"],
    run: openPanel,
  });
  ctx.ui.registerCommand({
    key: "sync",
    title: () => t("Git 任务管理：立即同步", "Git Tasks: sync now"),
    keywords: () => ["pr", "sync", "同步"],
    run: () => {
      sync.run();
    },
  });
  ctx.ui.registerSettingsSection({
    key: "settings",
    label: () => t("Git 任务管理", "Git Tasks"),
    component: createSettingsSection({ ctx, t, store, index, sync }),
  });
  return { openPanel, registerNav };
}

function bootstrap({ ctx, store, index, badges, registerNav, startScheduler, sync, isDisposed }) {
  return (async () => {
    await store.init();
    const cachedViewer = await ctx.storage.get("viewer").catch(() => null);
    if (cachedViewer?.login) store.setRuntime({ ghLogin: cachedViewer.login });
    await index.refresh();
    if (isDisposed()) return;
    badges.refresh();
    registerNav();
    startScheduler();
    const result = await sync.run();
    if (result?.login) {
      ctx.storage.set("viewer", { v: 1, login: result.login }).catch(() => undefined);
    }
  })().catch((error) => {
    store.setRuntime({ ghError: error?.message || String(error) });
  });
}

function createLiveScheduler({ store, sync }) {
  const scheduler = createScheduler({
    run: () => sync.run(),
    isForeground: () =>
      !store.getSnapshot().cfg.rules.foregroundOnly || document.visibilityState === "visible",
  });
  let scheduledInterval;
  const start = () => {
    scheduledInterval = store.getSnapshot().cfg.rules.interval;
    scheduler.start(scheduledInterval);
  };
  return { scheduler, start, scheduled: () => scheduledInterval };
}

function installWatchers({ ctx, store, index, badges, registerNav, live }) {
  let lastNav = navCountOf(store, index);
  const syncNav = () => {
    const value = navCountOf(store, index);
    if (value === lastNav) return;
    lastNav = value;
    registerNav();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") live.scheduler.wake();
  };
  const onStoreChange = () => {
    badges.refresh();
    syncNav();
    if (store.getSnapshot().cfg.rules.interval !== live.scheduled()) live.start();
    const state = store.getSnapshot();
    if (state.ready) {
      const nextDefs = localeDefsFor(state.cfg.defs, ctx.host?.locale);
      if (nextDefs) store.setDefs(nextDefs);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  const offs = [store.subscribe(onStoreChange), index.subscribe(() => badges.refresh())];
  return {
    setLastNav: (value) => {
      lastNav = value;
    },
    off: () => {
      document.removeEventListener("visibilitychange", onVisibility);
      for (const fn of offs) fn();
    },
  };
}

function startLifecycle(ctx, { store, index, badges, sync, registerNav }) {
  let disposed = false;
  const live = createLiveScheduler({ store, sync });
  const watchers = installWatchers({ ctx, store, index, badges, registerNav, live });
  bootstrap({
    ctx,
    store,
    index,
    badges,
    registerNav: () => {
      watchers.setLastNav(registerNav());
    },
    startScheduler: live.start,
    sync,
    isDisposed: () => disposed,
  });
  return () => {
    disposed = true;
    live.scheduler.stop();
    badges.dispose();
    watchers.off();
    store.flush();
  };
}

function matchesDefs(defs, table) {
  return Object.keys(table).every(
    (key) => defs[key]?.label === table[key].label && defs[key]?.tone === table[key].tone,
  );
}

/** 语言切换时只翻转“仍是默认表”的 defs；用户改过名称/颜色就保持原样。 */
export function localeDefsFor(defs, locale) {
  const target = isEnglish(locale) ? DEFAULT_DEFS_EN : DEFAULT_DEFS;
  const other = isEnglish(locale) ? DEFAULT_DEFS : DEFAULT_DEFS_EN;
  if (matchesDefs(defs, target)) return null;
  return matchesDefs(defs, other) ? target : null;
}

export default function activate(ctx) {
  bindReact(ctx.react);
  const t = createT(ctx.host?.locale);
  const runtime = createRuntime(ctx, t);
  const Panel = createPanel({ ctx, t, store: runtime.store, index: runtime.index, exec: runtime.exec, sync: runtime.sync });
  const surfaces = registerSurfaces(ctx, { t, ...runtime, Panel });
  return startLifecycle(ctx, { ...runtime, registerNav: surfaces.registerNav });
}
