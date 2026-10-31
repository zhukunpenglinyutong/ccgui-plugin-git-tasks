/** 外部 store（订阅 + 不可变快照）+ 防抖持久化（计划 §8）。
 *
 * 状态分四块：cfg（设置，含仓库顺序）、snapshots（每个仓库的同步结果）、
 * local（本地标记 / 绑定 / 排序 / 忽略）、runtime（同步与 gh 状态）。
 * UI 状态不进持久化。所有写入替换对象，不改旧快照。
 */

import {
  DAY,
  DEFAULT_AUTOMATION,
  DEFAULT_DEFS,
  DEFAULT_NOTIFY,
  DEFAULT_RULES,
  STORE_VERSION,
  TONES,
} from "./constants.js";
import {
  emptyNotifyState,
  sanitizeAutoRecords,
  sanitizeAutomation,
  sanitizeFeishu,
  sanitizeNotifyCfg,
  sanitizeNotifyState,
} from "./automation/config.js";
import { applyDrop } from "./domain/board.js";

const LOCAL_EMPTY = () => ({ marks: {}, bindings: {}, order: {}, ignored: [], reviewing: {} });

export function defaultConfig(repos = []) {
  return {
    rules: { ...DEFAULT_RULES },
    defs: { ...DEFAULT_DEFS },
    repos: repos.map((r) => ({ slug: r.slug, enabled: r.enabled !== false })),
    extraAccounts: [],
    automation: { ...DEFAULT_AUTOMATION },
    notify: { ...DEFAULT_NOTIFY },
  };
}

function initialState() {
  return {
    ready: false,
    cfg: defaultConfig(),
    snapshots: {},
    local: LOCAL_EMPTY(),
    // 自动化数据各存独立 key：「清空本地数据」「恢复默认设置」都不会误删。
    auto: {},
    feishu: { webhook: "", secret: "" },
    notify: emptyNotifyState(),
    runtime: {
      syncing: false,
      syncStartedAt: null,
      progress: { done: 0, total: 0 },
      lastSync: null,
      errors: {},
      ghLogin: null,
      ghError: null,
      calls: 0,
    },
    ui: {
      view: "board",
      filter: "all",
      repoFilter: "all",
      query: "",
      chartMode: "chart",
      showIgnored: false,
      drawerKey: null,
      modal: null,
    },
  };
}

const NUMERIC_RULES = new Set([
  "overdueReview",
  "overdueRereview",
  "silentDays",
  "endedDays",
]);
const OWNERS = new Set(["me", "author", "merge", "done"]);

function sanitizeRules(raw) {
  const out = { ...DEFAULT_RULES };
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(DEFAULT_RULES)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (NUMERIC_RULES.has(key)) {
      if (Number.isFinite(Number(value))) out[key] = Math.max(0, Math.min(99, Number(value)));
    } else if (Array.isArray(DEFAULT_RULES[key])) {
      if (Array.isArray(value)) out[key] = value.map(String).filter(Boolean);
    } else if (typeof value === typeof DEFAULT_RULES[key]) {
      out[key] = value;
    }
  }
  if (!["all", "mine"].includes(out.scope)) out.scope = DEFAULT_RULES.scope;
  if (!["0", "5", "15", "30", "60"].includes(String(out.interval))) out.interval = DEFAULT_RULES.interval;
  if (![0, 4, 6].includes(out.dayCutoff)) out.dayCutoff = DEFAULT_RULES.dayCutoff;
  if (!["never", "overdue", "always"].includes(out.badgeAge)) out.badgeAge = DEFAULT_RULES.badgeAge;
  if (!["detail", "github"].includes(out.badgeClick)) out.badgeClick = DEFAULT_RULES.badgeClick;
  return out;
}

function sanitizeDefs(raw) {
  const out = { ...DEFAULT_DEFS };
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(DEFAULT_DEFS)) {
    const def = raw[key];
    if (!def || typeof def !== "object") continue;
    out[key] = {
      label:
        typeof def.label === "string" && def.label.trim()
          ? [...def.label.trim()].slice(0, 6).join("")
          : DEFAULT_DEFS[key].label,
      tone: TONES.includes(def.tone) ? def.tone : DEFAULT_DEFS[key].tone,
      owner: OWNERS.has(def.owner) ? def.owner : DEFAULT_DEFS[key].owner,
      badge: typeof def.badge === "boolean" ? def.badge : DEFAULT_DEFS[key].badge,
    };
  }
  return out;
}

function sanitizePr(pr) {
  if (!pr || typeof pr !== "object") return null;
  if (typeof pr.key !== "string" || !pr.key || typeof pr.number !== "number") return null;
  if (!Array.isArray(pr.events)) return null;
  return {
    ...pr,
    author: String(pr.author || ""),
    headSha: String(pr.headSha || ""),
    headRefName: String(pr.headRefName || ""),
    commitShas: Array.isArray(pr.commitShas) ? pr.commitShas.map(String) : [],
    createdAt: Number.isFinite(pr.createdAt) ? pr.createdAt : 0,
    updatedAt: Number.isFinite(pr.updatedAt) ? pr.updatedAt : 0,
  };
}

function migrateConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = defaultConfig(Array.isArray(raw.repos) ? raw.repos : []);
  return {
    ...base,
    rules: sanitizeRules(raw.rules),
    defs: sanitizeDefs(raw.defs),
    extraAccounts: Array.isArray(raw.extraAccounts) ? raw.extraAccounts.map(String).filter(Boolean) : [],
    automation: sanitizeAutomation(raw.automation),
    notify: sanitizeNotifyCfg(raw.notify),
  };
}

function migrateLocal(raw) {
  if (!raw || raw.v !== STORE_VERSION) return LOCAL_EMPTY();
  const base = LOCAL_EMPTY();
  return {
    marks: raw.marks && typeof raw.marks === "object" ? raw.marks : base.marks,
    bindings: raw.bindings && typeof raw.bindings === "object" ? raw.bindings : base.bindings,
    order: raw.order && typeof raw.order === "object" ? raw.order : base.order,
    ignored: Array.isArray(raw.ignored) ? raw.ignored : base.ignored,
    reviewing:
      raw.reviewing && typeof raw.reviewing === "object" ? raw.reviewing : base.reviewing,
  };
}

function migrateSnapshot(raw) {
  if (!raw || raw.v !== STORE_VERSION) return null;
  return {
    syncedAt: Number(raw.syncedAt) || 0,
    prs: Array.isArray(raw.prs) ? raw.prs.map(sanitizePr).filter(Boolean) : [],
    daily: raw.daily && typeof raw.daily === "object" ? raw.daily : {},
  };
}

/** 只保留近 30 天结束的 PR；open PR 全留。 */
export function trimSnapshot(snap, now) {
  const cut = now - 30 * DAY;
  const prs = (snap.prs || []).filter((pr) => {
    if (pr.state === "OPEN" || !pr.state) return true;
    const terminal = pr.events?.find((e) => e.type === "merged" || e.type === "closed");
    return (terminal?.at || 0) >= cut;
  });
  return { ...snap, prs };
}

function openedFirst(a, b) {
  if (a.type === "opened") return -1;
  if (b.type === "opened") return 1;
  return a.at - b.at;
}

function createPersistence({ save, debounceMs, schedule, cancel }) {
  const pending = new Map();
  const timers = new Map();
  const queueSave = (key, value) => {
    pending.set(key, value);
    if (timers.has(key)) return;
    timers.set(key, schedule(() => {
      timers.delete(key);
      flushKey(key);
    }, debounceMs));
  };
  const flushKey = (key) => {
    if (!pending.has(key)) return;
    const value = pending.get(key);
    pending.delete(key);
    const timer = timers.get(key);
    if (timer) {
      cancel(timer);
      timers.delete(key);
    }
    Promise.resolve(save(key, value)).catch(() => undefined);
  };
  const flush = () => {
    for (const key of [...pending.keys()]) flushKey(key);
  };
  return { queueSave, flush };
}

function createCore(options) {
  const { load, save, now, debounceMs, schedule, cancel } = options;
  let state = initialState();
  const listeners = new Set();
  const persistence = createPersistence({ save, debounceMs, schedule, cancel });
  const getState = () => state;
  const commit = (next) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { load, now, getState, commit, subscribe, ...persistence };
}

async function loadState(core) {
  const [rawCfg, rawLocal, rawAuto, rawFeishu, rawNotify] = await Promise.all(
    ["cfg", "local", "auto", "feishu", "notify"].map((key) => core.load(key)),
  );
  const cfg = migrateConfig(rawCfg) || defaultConfig();
  const local = migrateLocal(rawLocal);
  const snapshots = {};
  for (const repo of cfg.repos) {
    const snap = migrateSnapshot(await core.load(`snap:${repo.slug}`));
    if (snap) snapshots[repo.slug] = snap;
  }
  core.commit({
    ...core.getState(),
    ready: true,
    cfg,
    local,
    snapshots,
    auto: sanitizeAutoRecords(rawAuto),
    feishu: sanitizeFeishu(rawFeishu),
    notify: sanitizeNotifyState(rawNotify),
  });
}

function createConfigApi(core) {
  const updateCfg = (patch) => {
    const cfg = { ...core.getState().cfg, ...patch };
    core.commit({ ...core.getState(), cfg });
    core.queueSave("cfg", { v: STORE_VERSION, ...cfg });
  };
  return {
    setRules: (patch) => updateCfg({ rules: { ...core.getState().cfg.rules, ...patch } }),
    setDef: (key, patch) =>
      updateCfg({ defs: { ...core.getState().cfg.defs, [key]: { ...core.getState().cfg.defs[key], ...patch } } }),
    setDefs: (defs) => updateCfg({ defs: { ...defs } }),
    setRepos: (repos) =>
      updateCfg({
        repos: repos.map((r) => ({
          slug: r.slug,
          enabled: r.enabled !== false,
          ...(r.available === undefined ? {} : { available: r.available }),
        })),
      }),
    setExtraAccounts: (list) => updateCfg({ extraAccounts: [...list] }),
    setAutomation: (patch) =>
      updateCfg({ automation: sanitizeAutomation({ ...core.getState().cfg.automation, ...patch }) }),
    setNotifyCfg: (patch) =>
      updateCfg({ notify: sanitizeNotifyCfg({ ...core.getState().cfg.notify, ...patch }) }),
    resetConfig: () => updateCfg(defaultConfig(core.getState().cfg.repos)),
  };
}

function collectPrs(state, withMarks) {
  const seen = new Set();
  const out = [];
  for (const repo of state.cfg.repos) {
    const snap = state.snapshots[repo.slug];
    if (!snap) continue;
    for (const pr of snap.prs) {
      if (seen.has(pr.key)) continue;
      seen.add(pr.key);
      out.push(withMarks(pr));
    }
  }
  return out;
}

function createDataApi(core) {
  const withMarks = (pr) => {
    const marks = core.getState().local.marks[pr.key] || [];
    if (!marks.length) return pr;
    return { ...pr, events: [...pr.events, ...marks].sort(openedFirst) };
  };
  const findPr = (prKey) => {
    for (const snap of Object.values(core.getState().snapshots)) {
      const pr = snap.prs.find((p) => p.key === prKey);
      if (pr) return withMarks(pr);
    }
    return null;
  };
  return {
    prWithMarks: withMarks,
    allPrs: () => collectPrs(core.getState(), withMarks),
    findPr,
    setSnapshot: (slug, snap) => {
      const trimmed = trimSnapshot(snap, core.now());
      const snapshots = { ...core.getState().snapshots, [slug]: trimmed };
      core.commit({ ...core.getState(), snapshots });
      core.queueSave(`snap:${slug}`, { v: STORE_VERSION, ...trimmed });
    },
    setRuntime: (patch) =>
      core.commit({ ...core.getState(), runtime: { ...core.getState().runtime, ...patch } }),
    setUi: (patch) => core.commit({ ...core.getState(), ui: { ...core.getState().ui, ...patch } }),
  };
}

function createLocalApi(core) {
  const updateLocal = (patch) => {
    const local = { ...core.getState().local, ...patch };
    core.commit({ ...core.getState(), local });
    core.queueSave("local", { v: STORE_VERSION, ...local });
  };
  const addMark = (prKey, mark) => {
    const current = core.getState().local.marks[prKey] || [];
    updateLocal({ marks: { ...core.getState().local.marks, [prKey]: [...current, { type: "mark", ...mark }] } });
  };
  const unmarkLast = (prKey) => {
    const current = core.getState().local.marks[prKey] || [];
    if (!current.length) return;
    const next = current.slice(0, -1);
    const marks = { ...core.getState().local.marks };
    if (next.length) marks[prKey] = next;
    else delete marks[prKey];
    updateLocal({ marks });
  };
  const setOrder = (colKey, ids) =>
    updateLocal({ order: { ...core.getState().local.order, [colKey]: [...ids] } });
  return { addMark, unmarkLast, setOrder, updateLocal };
}

function createBindingApi(core, data, local) {
  const markReviewing = (prKey, at) =>
    local.updateLocal({
      reviewing: { ...core.getState().local.reviewing, [prKey]: at },
    });
  const clearReviewing = (prKey) => {
    const reviewing = { ...core.getState().local.reviewing };
    delete reviewing[prKey];
    local.updateLocal({ reviewing });
  };
  const bind = (prKey, workspaceId) => {
    const bindings = Object.fromEntries(
      Object.entries(core.getState().local.bindings).filter(([, id]) => id !== workspaceId),
    );
    bindings[prKey] = workspaceId;
    local.updateLocal({ bindings });
  };
  const unbind = (prKey) => {
    const bindings = { ...core.getState().local.bindings };
    delete bindings[prKey];
    local.updateLocal({ bindings });
  };
  const pruneBindings = (workspaceIds) => {
    const bindings = Object.fromEntries(
      Object.entries(core.getState().local.bindings).filter(([, id]) => workspaceIds.has(id)),
    );
    if (Object.keys(bindings).length !== Object.keys(core.getState().local.bindings).length) {
      local.updateLocal({ bindings });
    }
  };
  const toggleIgnore = (prKey) => {
    const ignored = core.getState().local.ignored;
    local.updateLocal({
      ignored: ignored.includes(prKey) ? ignored.filter((k) => k !== prKey) : [...ignored, prKey],
    });
  };
  const applyDropLocal = (prKey, toCol, ids, at) => {
    const pr = data.findPr(prKey);
    if (!pr) return { ok: false, reason: "PR 不在当前同步快照里，请先同步" };
    const result = applyDrop(pr, core.getState().cfg.rules, toCol, ids, at);
    if (!result.ok) return result;
    if (result.reorder) {
      local.setOrder(toCol, ids);
      return result;
    }
    const marks = result.events.filter((e) => e.type === "mark");
    const nextMarks = { ...core.getState().local.marks };
    if (marks.length) nextMarks[prKey] = marks;
    else delete nextMarks[prKey];
    local.updateLocal({ marks: nextMarks, order: { ...core.getState().local.order, [toCol]: [...ids] } });
    return result;
  };
  return { bind, unbind, pruneBindings, toggleIgnore, applyDropLocal, markReviewing, clearReviewing };
}

function createAutomationApi(core) {
  const setAutoRecords = (records) => {
    core.commit({ ...core.getState(), auto: records });
    core.queueSave("auto", { v: STORE_VERSION, records });
  };
  const setAutoRecord = (prKey, record) => {
    const next = { ...core.getState().auto };
    if (record) next[prKey] = record;
    else delete next[prKey];
    setAutoRecords(next);
  };
  const setFeishu = (patch) => {
    const feishu = sanitizeFeishu({ ...core.getState().feishu, ...patch });
    core.commit({ ...core.getState(), feishu });
    core.queueSave("feishu", feishu);
  };
  const setNotifyState = (patch) => {
    const notify = { ...core.getState().notify, ...patch };
    core.commit({ ...core.getState(), notify });
    core.queueSave("notify", { v: STORE_VERSION, ...notify });
  };
  return { setAutoRecords, setAutoRecord, setFeishu, setNotifyState };
}

export function createStore({
  load = async () => null,
  save = async () => {},
  now = () => Date.now(),
  debounceMs = 400,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  const core = createCore({ load, save, now, debounceMs, schedule, cancel });
  const config = createConfigApi(core);
  const data = createDataApi(core);
  const local = createLocalApi(core);
  const bindings = createBindingApi(core, data, local);
  const automation = createAutomationApi(core);
  const restoreLocal = (partial) =>
    local.updateLocal({ marks: partial.marks || {}, order: partial.order || {} });
  const clearLocal = () => local.updateLocal(LOCAL_EMPTY());
  return {
    getSnapshot: core.getState,
    subscribe: core.subscribe,
    init: () => loadState(core),
    flush: core.flush,
    ...config,
    ...data,
    ...local,
    ...bindings,
    ...automation,
    restoreLocal,
    clearLocal,
  };
}
