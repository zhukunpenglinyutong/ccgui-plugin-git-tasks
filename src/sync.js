/** 同步：列表 + 批量详情 + 已结束 + 每日统计；以及定时调度。 */

import {
  DAY,
  DETAIL_BATCH,
  MAX_OPEN_PRS,
  MIN_INTERVAL_MINUTES,
} from "./constants.js";
import { describeGhError } from "./gh/exec.js";
import {
  createdRowFromArray,
  dailyCounts,
  endedRowFromArray,
  mergeDetail,
  normalizeEndedRow,
  parseListRow,
} from "./gh/normalize.js";
import {
  VIEWER_ARGS,
  closedArgs,
  createdArgs,
  detailArgs,
  listArgs,
  mergedArgs,
} from "./gh/queries.js";

const MAX_PAGES = Math.ceil(MAX_OPEN_PRS / 50);

export function clampInterval(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(MIN_INTERVAL_MINUTES, Math.round(n));
}

export function sinceDate(nowMs, days) {
  return new Date(nowMs - days * DAY).toISOString().slice(0, 10);
}

export function needsDetail(pr, prevPr) {
  if (!prevPr) return true;
  if (pr.headSha !== prevPr.headSha) return true;
  if (pr.updatedAt !== prevPr.updatedAt) return true;
  if (!prevPr.commitShas?.length) return true;
  return false;
}

function ensureOpened(pr) {
  if (pr.events?.length) return pr;
  return {
    ...pr,
    events: [{ type: "opened", at: pr.createdAt, sha: pr.headSha, draft: pr.isDraft }],
  };
}

function reuseDetail(pr, prevPr) {
  if (!prevPr?.events?.length) return ensureOpened(pr);
  return {
    ...pr,
    events: prevPr.events,
    commitShas: prevPr.commitShas || [],
    requested: prevPr.requested || false,
  };
}

async function fetchOpenPrs(slug, { exec, prev, rules, meSet }) {
  const rows = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await exec.runGh(listArgs(slug, after));
    const data = JSON.parse(result.stdout);
    rows.push(...(data.prs || []));
    if (!data.page?.hasNextPage || rows.length >= MAX_OPEN_PRS) break;
    after = data.page.endCursor;
  }
  const prs = rows.slice(0, MAX_OPEN_PRS).map((row) => {
    const [owner, repo] = slug.split("/");
    return parseListRow(row, { owner, repo });
  });
  const prevByNumber = new Map((prev?.prs || []).map((p) => [p.number, p]));
  const wanted = prs.filter((pr) => needsDetail(pr, prevByNumber.get(pr.number)));
  const details = await loadDetails(
    slug,
    wanted.map((pr) => pr.number),
    exec,
    meSet,
  );
  return prs.map((pr) => {
    const detail = details.get(pr.number);
    if (detail) return mergeDetail(pr, detail, { meSet });
    return reuseDetail(pr, prevByNumber.get(pr.number));
  });
}

/** 并发上限内跑一组任务，保持结果顺序。 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** 详情批量拉取；批量失败时逐个重试，坏 PR 只丢它自己的详情。 */
async function loadDetails(slug, numbers, exec, meSet) {
  const out = new Map();
  const chunks = [];
  for (let i = 0; i < numbers.length; i += DETAIL_BATCH) {
    chunks.push(numbers.slice(i, i + DETAIL_BATCH));
  }
  await mapLimit(chunks, 2, async (chunk) => {
    try {
      const result = await exec.runGh(detailArgs(slug, chunk));
      for (const item of JSON.parse(result.stdout)) {
        const index = Number(String(item.k || "").replace(/\D/g, ""));
        if (Number.isInteger(index) && chunk[index] != null) out.set(chunk[index], item);
      }
    } catch {
      await mapLimit(chunk, 2, async (number) => {
        try {
          const result = await exec.runGh(detailArgs(slug, [number]));
          const item = JSON.parse(result.stdout)?.[0];
          if (item) out.set(number, item);
        } catch {
          // 单个 PR 拿不到详情：保留上次归一化结果；没有就只显示 opened。
        }
      });
    }
  });
  void meSet;
  return out;
}

function parseRows(stdout) {
  try {
    const data = JSON.parse(stdout || "[]");
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function fetchEnded(slug, { exec, rules, nowMs, openKeys, prev }) {
  const since = sinceDate(nowMs, Math.max(1, Number(rules.endedDays) || 7));
  const [owner, repo] = slug.split("/");
  const mergedRows = parseRows((await exec.runGh(mergedArgs(slug, since))).stdout);
  const closedRows = parseRows((await exec.runGh(closedArgs(slug, since))).stdout);
  if (!mergedRows || !closedRows) {
    // 输出被截断 / gh 返回异常：保留上一轮已结束数据，别让整仓同步失败。
    return (prev?.prs || []).filter((pr) => pr.state !== "OPEN");
  }
  const rows = [
    ...mergedRows.map(endedRowFromArray),
    ...closedRows.map(endedRowFromArray).filter((row) => !row.mergedAt),
  ];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const pr = normalizeEndedRow(row, { owner, repo });
    if (seen.has(pr.key) || openKeys.has(pr.key)) continue;
    seen.add(pr.key);
    out.push(pr);
  }
  return out;
}

/** 拉一个仓库的快照。`prev` 是上一份快照，用于增量与失败兜底。 */
const AUX_TTL_MS = 30 * 60_000;

export async function fetchRepo(slug, { exec, prev, rules, nowMs, meSet = new Set() }) {
  const open = await fetchOpenPrs(slug, { exec, prev, rules, meSet });
  // 已结束列表与每日统计变化慢：30 分钟内复用上一轮，避免每 15 分钟都多打 3 次 gh。
  const needsAux = !prev?.auxAt || nowMs - prev.auxAt >= AUX_TTL_MS;
  if (!needsAux) {
    return {
      ...prev,
      syncedAt: nowMs,
      prs: [...open, ...(prev.prs || []).filter((pr) => pr.state !== "OPEN")],
      daily: prev.daily || {},
      auxAt: prev.auxAt,
    };
  }
  const openKeys = new Set(open.map((pr) => pr.key));
  const ended = await fetchEnded(slug, { exec, rules, nowMs, openKeys, prev });
  const createdRows = parseRows((await exec.runGh(createdArgs(slug, sinceDate(nowMs, 14)))).stdout);
  const daily = createdRows
    ? dailyCounts(createdRows.map(createdRowFromArray), rules.dayCutoff)
    : prev?.daily || {};
  return {
    syncedAt: nowMs,
    auxAt: nowMs,
    prs: [...open, ...ended],
    daily,
  };
}

export async function fetchViewerLogin(exec) {
  const result = await exec.runGh(VIEWER_ARGS);
  const login = String(result.stdout || "").trim().toLowerCase();
  if (!login) throw new Error("gh api user 没有返回登录账号");
  return login;
}

/** 一次同步：逐个仓库拉取并写回 store。repo 失败不阻断其他仓库。 */
export async function runSyncPass({ exec, store, now, viewer, repos }) {
  const before = store.getSnapshot();
  const enabled = (repos || before.cfg.repos).filter(
    (r) => r.enabled !== false && r.available !== false,
  );
  const startedAt = now();
  store.setRuntime({
    syncing: true,
    syncStartedAt: startedAt,
    progress: { done: 0, total: enabled.length },
  });
  let login = before.runtime.ghLogin;
  let ghError = null;
  if (!login) {
    try {
      login = await viewer(exec);
    } catch (error) {
      ghError = describeGhError(error);
    }
  }
  // 只重试单个仓库时，保留其他仓库上一次的错误，成功时再逐条清掉。
  const errors = { ...(before.runtime.errors || {}) };
  let lastSync = before.runtime.lastSync;
  let doneRepos = 0;
  // 两个仓库并行（exec 自身也有并发上限 2）；单仓库失败不影响其他仓库。
  await mapLimit(enabled, 2, async (repo) => {
    try {
      const ruleSet = store.getSnapshot().cfg.rules;
      const snap = await fetchRepo(repo.slug, {
        exec,
        prev: store.getSnapshot().snapshots[repo.slug],
        rules: ruleSet,
        nowMs: now(),
        meSet: new Set(
          [login, ...store.getSnapshot().cfg.extraAccounts.map((a) => String(a).toLowerCase())].filter(Boolean),
        ),
      });
      store.setSnapshot(repo.slug, snap);
      delete errors[repo.slug];
      lastSync = snap.syncedAt;
    } catch (error) {
      errors[repo.slug] = describeGhError(error);
    } finally {
      doneRepos += 1;
      store.setRuntime({ progress: { done: doneRepos, total: enabled.length } });
    }
  });
  store.setRuntime({
    syncing: false,
    errors,
    lastSync,
    ghLogin: login,
    ghError,
    progress: { done: enabled.length, total: enabled.length },
    calls: exec.stats?.calls ?? 0,
  });
  return { errors, login };
}

/** 串起同步流程（并发去重）并写回 store。 */
export function createSync({ exec, store, now = Date.now, viewer = fetchViewerLogin, onAfter }) {
  let running = null;
  async function run(repos) {
    if (running) return running;
    running = runSyncPass({ exec, store, now, viewer, repos }).finally(() => {
      running = null;
      if (onAfter) onAfter();
    });
    return running;
  }
  return { run };
}

function createSchedulerApi(box, { run, now, isForeground, setTimer, clearTimer }) {
  const clear = () => {
    if (box.timer) clearTimer(box.timer);
    box.timer = null;
  };
  const schedule = () => {
    clear();
    if (box.stopped || box.interval <= 0) return;
    box.timer = setTimer(tick, box.interval * 60_000);
  };
  async function tick() {
    box.timer = null;
    if (box.stopped) return;
    if (!isForeground()) {
      schedule();
      return;
    }
    box.lastRun = now();
    try {
      await run();
    } finally {
      schedule();
    }
  }
  const start = (minutes) => {
    box.stopped = false;
    box.interval = clampInterval(minutes);
    schedule();
  };
  const stop = () => {
    box.stopped = true;
    clear();
  };
  const isDue = () => box.interval > 0 && now() - box.lastRun >= box.interval * 60_000;
  const wake = () => {
    if (box.stopped || box.timer || !isDue()) return;
    void tick();
  };
  return { start, stop, wake, isDue, getInterval: () => box.interval };
}

/** 定时器：最小间隔、仅手动、前台门控。 */
export function createScheduler({
  run,
  now = Date.now,
  isForeground = () => true,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const box = { timer: null, interval: 0, lastRun: 0, stopped: true };
  return createSchedulerApi(box, { run, now, isForeground, setTimer, clearTimer });
}
