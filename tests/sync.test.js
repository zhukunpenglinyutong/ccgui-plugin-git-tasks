import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clampInterval,
  createScheduler,
  createSync,
  fetchPrByNumber,
  fetchRepo,
  needsDetail,
  sinceDate,
} from "../src/sync.js";
import { createStore } from "../src/store.js";
import { assertReadOnlyArgs } from "../src/gh/exec.js";
import { prByNumberArgs } from "../src/gh/queries.js";
import { DEFAULT_RULES } from "../src/constants.js";
import { NOW } from "./helpers.js";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

/** 把列表行改写成“已合并”的单 PR 查询结果。 */
function mergedRowFor(number) {
  const row = fixture("graphql-list.json").prs.find((item) => item[0] === number);
  return [[...row.slice(0, 13), "MERGED", "2026-10-27T05:00:00Z", "2026-10-27T05:00:00Z"]];
}

function fakeExec(overrides = {}) {
  const calls = [];
  const runGh = async (args) => {
    calls.push(args);
    const kind = overrides.pick?.(args);
    if (kind) return { code: 0, stdout: JSON.stringify(fixture(kind)), stderr: "" };
    if (args[1] === "graphql") {
      const query = args.find((a) => a.startsWith("query=")) || "";
      if (query.includes("pullRequests(states:OPEN")) return { code: 0, stdout: JSON.stringify(fixture("graphql-list.json")), stderr: "" };
      return { code: 0, stdout: JSON.stringify(fixture("graphql-detail.json")), stderr: "" };
    }
    if (args.includes("--state") && args[args.indexOf("--state") + 1] === "all") {
      return { code: 0, stdout: JSON.stringify(fixture("pr-list-created.json")), stderr: "" };
    }
    if (args.includes("--state") && args[args.indexOf("--state") + 1] === "merged") {
      return { code: 0, stdout: JSON.stringify(fixture("pr-list-merged.json")), stderr: "" };
    }
    return { code: 0, stdout: JSON.stringify(fixture("pr-list-closed.json")), stderr: "" };
  };
  return { calls, runGh };
}

test("clampInterval / sinceDate", () => {
  assert.equal(clampInterval("15"), 15);
  assert.equal(clampInterval(3), 5);
  assert.equal(clampInterval(0), 0);
  assert.equal(clampInterval(-1), 0);
  assert.equal(sinceDate(NOW, 14), "2026-10-12");
});

test("fetchRepo：列表 + 详情 + 每日统计 + 已结束去重", async () => {
  const exec = fakeExec();
  const snap = await fetchRepo("zhukunpenglinyutong/desktop-cc-gui", {
    exec,
    prev: null,
    rules: DEFAULT_RULES,
    nowMs: NOW,
  });
  assert.equal(snap.syncedAt, NOW);
  const open = snap.prs.filter((p) => p.state === "OPEN");
  assert.equal(open.length, 25);
  const merged = snap.prs.filter((p) => p.state === "MERGED");
  assert.ok(merged.length > 0);
  const keys = snap.prs.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(
    Object.values(snap.daily).reduce((a, b) => a + b, 0),
    fixture("pr-list-created.json").length,
  );
  const first = open.find((p) => p.events.some((e) => e.type === "forcePush"));
  assert.ok(first, "至少一个 PR 有 force-push 事件");
  const detailCalls = exec.calls.filter(
    (args) => args[1] === "graphql" && (args.find((a) => a.startsWith("query=")) || "").includes("pullRequest(number"),
  );
  assert.equal(detailCalls.length, Math.ceil(25 / 4));
});

test("needsDetail：只有新增或 head / updatedAt 变化才重新拉详情", async () => {
  const exec = fakeExec();
  const snap = await fetchRepo("zhukunpenglinyutong/desktop-cc-gui", {
    exec,
    prev: null,
    rules: DEFAULT_RULES,
    nowMs: NOW,
  });
  const again = fakeExec();
  const second = await fetchRepo("zhukunpenglinyutong/desktop-cc-gui", {
    exec: again,
    prev: snap,
    rules: DEFAULT_RULES,
    nowMs: NOW + 60_000,
  });
  const detailCalls = again.calls.filter(
    (args) => args[1] === "graphql" && (args.find((a) => a.startsWith("query=")) || "").includes("pullRequest(number"),
  );
  assert.equal(detailCalls.length, 0);
  assert.equal(second.prs.filter((p) => p.state === "OPEN").length, 25);
  assert.equal(needsDetail({ number: 1, headSha: "a", updatedAt: 1 }, { headSha: "b", updatedAt: 1 }), true);
  assert.equal(needsDetail({ number: 1, headSha: "a", updatedAt: 2 }, { headSha: "a", updatedAt: 1 }), true);
  assert.equal(needsDetail({ number: 1, headSha: "a", updatedAt: 1 }, null), true);
  assert.equal(needsDetail({ number: 1, headSha: "a", updatedAt: 1 }, { headSha: "a", updatedAt: 1, commitShas: ["x"] }), false);
  assert.equal(needsDetail({ number: 1, headSha: "a", updatedAt: 1 }, { headSha: "a", updatedAt: 1, commitShas: [] }), true);
});

test("fetchRepo：批量详情失败时逐个重试，坏 PR 不影响其他", async () => {
  const exec = fakeExec();
  const base = exec.runGh;
  let batchTried = false;
  exec.runGh = async (args) => {
    const query = args.find((a) => a.startsWith("query=")) || "";
    if (query.includes("pullRequest(number") && !batchTried) {
      batchTried = true;
      throw new Error("Could not resolve to a PullRequest");
    }
    if (query.includes("pullRequest(number") && (query.match(/pullRequest\(number/g) || []).length > 1) {
      throw new Error("Could not resolve to a PullRequest");
    }
    return base(args);
  };
  const snap = await fetchRepo("zhukunpenglinyutong/desktop-cc-gui", {
    exec,
    prev: null,
    rules: DEFAULT_RULES,
    nowMs: NOW,
  });
  const open = snap.prs.filter((p) => p.state === "OPEN");
  assert.equal(open.length, 25);
  assert.ok(open.filter((p) => p.events.length > 1).length >= 4);
});

test("createSync：单仓库失败不影响其他仓库，运行状态可读", async () => {
  const backendWrites = [];
  const store = createStore({
    load: async () => null,
    save: async (key, value) => backendWrites.push([key, value]),
    debounceMs: 0,
  });
  await store.init();
  const exec = {
    runGh: async (args) => {
      const slug = args[args.indexOf("-R") + 1];
      if (slug === "acme/broken") throw new Error("boom");
      return fakeExec().runGh(args);
    },
  };
  const sync = createSync({ exec, store, now: () => NOW, viewer: async () => "me" });
  await sync.run([{ slug: "acme/broken" }, { slug: "zhukunpenglinyutong/desktop-cc-gui" }]);
  const s = store.getSnapshot();
  assert.equal(s.runtime.syncing, false);
  assert.equal(s.runtime.lastSync, NOW);
  assert.match(s.runtime.errors["acme/broken"], /boom/);
  assert.equal(s.runtime.errors["zhukunpenglinyutong/desktop-cc-gui"], undefined);
  assert.ok(s.snapshots["zhukunpenglinyutong/desktop-cc-gui"].prs.length > 0);
  assert.equal(s.runtime.ghLogin, "me");
  assert.deepEqual(s.runtime.progress, { done: 2, total: 2 });
});

test("scheduler：最小间隔、仅手动、前台门控与唤醒", async () => {
  let timer = null;
  let runs = 0;
  let foreground = true;
  const scheduler = createScheduler({
    run: async () => {
      runs += 1;
    },
    now: () => NOW,
    isForeground: () => foreground,
    setTimer: (fn, ms) => {
      timer = { fn, ms };
      return 1;
    },
    clearTimer: () => {
      timer = null;
    },
  });
  scheduler.start(3);
  assert.equal(scheduler.getInterval(), 5);
  assert.equal(timer.ms, 5 * 60_000);
  await timer.fn();
  assert.equal(runs, 1);
  assert.ok(timer, "运行后重新排期");
  foreground = false;
  await timer.fn();
  assert.equal(runs, 1);
  assert.ok(timer, "后台跳过但仍排期");
  foreground = true;
  scheduler.wake();
  assert.equal(runs, 1, "未到间隔不唤醒");
  scheduler.start(0);
  assert.equal(timer, null);
  assert.equal(scheduler.isDue(), false);
  scheduler.stop();
});

test("单仓库重试：保留其他仓库上一轮的错误，成功仓库的错误被清掉", async () => {
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  await store.init();
  store.setRuntime({ errors: { "acme/old": "旧错误", "zhukunpenglinyutong/desktop-cc-gui": "旧错误" } });
  const { runSyncPass } = await import("../src/sync.js");
  await runSyncPass({
    exec: fakeExec(),
    store,
    now: () => NOW,
    viewer: async () => "me",
    repos: [{ slug: "zhukunpenglinyutong/desktop-cc-gui", enabled: true, available: true }],
  });
  const errors = store.getSnapshot().runtime.errors;
  assert.equal(errors["acme/old"], "旧错误");
  assert.equal(errors["zhukunpenglinyutong/desktop-cc-gui"], undefined);
});

test("runSyncPass：available=false 的仓库不查 gh", async () => {
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  await store.init();
  const { runSyncPass } = await import("../src/sync.js");
  const exec = fakeExec();
  await runSyncPass({
    exec,
    store,
    now: () => NOW,
    viewer: async () => "me",
    repos: [
      { slug: "acme/closed", enabled: true, available: false },
      { slug: "zhukunpenglinyutong/desktop-cc-gui", enabled: true, available: true },
    ],
  });
  const touched = exec.calls.filter((args) => args.includes("-R") && args.includes("acme/closed"));
  assert.equal(touched.length, 0);
  assert.ok(store.getSnapshot().snapshots["zhukunpenglinyutong/desktop-cc-gui"]);
});

test("fetchRepo：已结束/每日统计 30 分钟内复用，减少 gh 调用", async () => {
  const exec = fakeExec();
  const first = await fetchRepo("zhukunpenglinyutong/desktop-cc-gui", {
    exec,
    prev: null,
    rules: DEFAULT_RULES,
    nowMs: NOW,
  });
  const auxCalls = () => exec.calls.filter((args) => args[1] === "list").length;
  assert.equal(auxCalls(), 3);
  const secondExec = fakeExec();
  const second = await fetchRepo("zhukunpenglinyutong/desktop-cc-gui", {
    exec: secondExec,
    prev: first,
    rules: DEFAULT_RULES,
    nowMs: NOW + 10 * 60_000,
  });
  assert.equal(secondExec.calls.filter((args) => args[1] === "list").length, 0);
  assert.equal(second.auxAt, first.auxAt);
  assert.deepEqual(second.daily, first.daily);
  assert.equal(
    second.prs.filter((p) => p.state !== "OPEN").length,
    first.prs.filter((p) => p.state !== "OPEN").length,
  );
  const thirdExec = fakeExec();
  await fetchRepo("zhukunpenglinyutong/desktop-cc-gui", {
    exec: thirdExec,
    prev: first,
    rules: DEFAULT_RULES,
    nowMs: NOW + 31 * 60_000,
  });
  assert.equal(thirdExec.calls.filter((args) => args[1] === "list").length, 3);
});

test("prByNumberArgs：参数通过只读白名单，非法编号被拒绝", () => {
  assert.doesNotThrow(() => assertReadOnlyArgs(prByNumberArgs("acme/repo", 1446)));
  const query = prByNumberArgs("acme/repo", 1446).find((arg) => arg.startsWith("query="));
  assert.match(query, /pullRequest\(number: 1446\)/);
  assert.throws(() => prByNumberArgs("acme/repo", "abc"), /无效的 PR 编号/);
});

test("fetchPrByNumber：按编号直查合并状态，不依赖已结束列表缓存", async () => {
  const calls = [];
  const exec = {
    runGh: async (args) => {
      calls.push(args);
      const query = args.find((a) => a.startsWith("query=")) || "";
      if (/pullRequest\(number: \d+\)/.test(query)) {
        return { code: 0, stdout: JSON.stringify(fixture("graphql-pr-by-number-merged.json")), stderr: "" };
      }
      return { code: 0, stdout: JSON.stringify(fixture("graphql-detail.json")), stderr: "" };
    },
  };
  const pr = await fetchPrByNumber("zhukunpenglinyutong/desktop-cc-gui", 1446, { exec });
  assert.equal(pr.key, "zhukunpenglinyutong/desktop-cc-gui#1446");
  assert.equal(pr.state, "MERGED");
  assert.equal(pr.mergedAt, Date.parse("2026-10-27T04:00:00Z"));
  assert.ok(pr.events.some((event) => event.type === "merged"));
  assert.equal(calls.length, 1, "合并态无需再拉详情");
});

test("fetchRepo：open 列表消失的 PR 按编号核对，合并状态不等 30 分钟缓存", async () => {
  const slug = "zhukunpenglinyutong/desktop-cc-gui";
  const first = await fetchRepo(slug, {
    exec: fakeExec(),
    prev: null,
    rules: DEFAULT_RULES,
    nowMs: NOW,
  });
  const listed = fixture("graphql-list.json");
  const prs = listed.prs.filter((row) => row[0] !== 1437);
  const mergedRow = mergedRowFor(1437);
  const calls = [];
  const exec = {
    runGh: async (args) => {
      calls.push(args);
      const query = args.find((a) => a.startsWith("query=")) || "";
      if (query.includes("pullRequests(states:OPEN")) {
        return { code: 0, stdout: JSON.stringify({ ...listed, prs }), stderr: "" };
      }
      if (/pullRequest\(number: \d+\)/.test(query)) {
        return { code: 0, stdout: JSON.stringify(mergedRow), stderr: "" };
      }
      if (args[1] === "list") throw new Error("已结束列表不应在 30 分钟缓存内被调用");
      return { code: 0, stdout: JSON.stringify(fixture("graphql-detail.json")), stderr: "" };
    },
  };
  const second = await fetchRepo(slug, {
    exec,
    prev: first,
    rules: DEFAULT_RULES,
    nowMs: NOW + 60_000,
  });
  const merged = second.prs.find((pr) => pr.number === 1437);
  assert.ok(merged, "合并的 PR 不能从看板消失");
  assert.equal(merged.state, "MERGED");
  assert.equal(calls.filter((args) => args[1] === "list").length, 0);
  const keys = second.prs.map((pr) => pr.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("createSync.refreshPr：单 PR 重读后写回快照并触发刷新", async () => {
  const slug = "zhukunpenglinyutong/desktop-cc-gui";
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  await store.init();
  const first = await fetchRepo(slug, {
    exec: fakeExec(),
    prev: null,
    rules: DEFAULT_RULES,
    nowMs: NOW,
  });
  store.setSnapshot(slug, first);
  const exec = {
    runGh: async (args) => {
      const query = args.find((a) => a.startsWith("query=")) || "";
      assert.match(query, /pullRequest\(number: 1437\)/);
      return { code: 0, stdout: JSON.stringify(mergedRowFor(1437)), stderr: "" };
    },
  };
  let after = 0;
  const sync = createSync({
    exec,
    store,
    now: () => NOW,
    viewer: async () => "me",
    onAfter: () => {
      after += 1;
    },
  });
  const updated = await sync.refreshPr(`${slug}#1437`);
  assert.equal(updated.state, "MERGED");
  assert.equal(after, 1);
  const prs = store.getSnapshot().snapshots[slug].prs;
  assert.equal(prs.find((pr) => pr.number === 1437).state, "MERGED");
  const keys = prs.map((pr) => pr.key);
  assert.equal(new Set(keys).size, keys.length);
});
