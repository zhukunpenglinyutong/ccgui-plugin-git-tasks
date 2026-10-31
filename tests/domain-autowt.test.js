import test from "node:test";
import assert from "node:assert/strict";
import {
  autoFlags,
  classifyCreateError,
  cleanableAuto,
  pickAutoCandidates,
  pruneRecords,
  reconcileRecords,
  recordAfterFailure,
} from "../src/domain/autowt.js";
import { selectRows } from "../src/domain/stats.js";
import { DEFAULT_RULES } from "../src/constants.js";
import { makePr, NOW } from "./helpers.js";

const SLUG = "acme/desktop";
const pr = (n, extra = {}) =>
  makePr({ number: n, repo: "desktop", owner: "acme", updatedAt: NOW - n * 1000, ...extra });

function rowsFor(prs, wts = [], bindings = {}) {
  return selectRows(prs, { rules: DEFAULT_RULES, meSet: new Set(["me"]), wts, bindings, now: NOW });
}

function pick(prs, { wts = [], bindings = {}, records = {}, max = 10, perRun = 5, skipSlugs = new Set() } = {}) {
  const decorated = autoFlags(wts, records);
  return pickAutoCandidates({
    rows: rowsFor(prs, decorated, bindings),
    wts: decorated,
    prs,
    bindings,
    rules: DEFAULT_RULES,
    records,
    repoSlugs: new Set([SLUG]),
    skipSlugs,
    max,
    perRun,
    now: NOW,
  });
}

const wt = (id, extra = {}) => ({
  workspaceId: id,
  parentWorkspaceId: "w1",
  path: `/wt/${id}`,
  name: id,
  repo: SLUG,
  branch: `branch-${id}`,
  prNumber: null,
  ...extra,
});

test("候选：只挑待审查、非草稿、未忽略、仓库可用的 PR，按最近更新排序", () => {
  const prs = [
    pr(1),
    pr(2, { isDraft: true, draftAtCreation: true }),
    pr(3, { ignored: true }),
    pr(4, { reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 3600_000 }] }),
    pr(5),
    makePr({ number: 6, repo: "other", owner: "acme" }),
  ];
  const out = pick(prs);
  assert.deepEqual(out.picks.map((p) => p.number), [1, 5]);
  assert.equal(out.capped, false);
});

test("候选：已有 worktree（PR 号 / 分支名 / 手动绑定）一律跳过，不受关联规则开关影响", () => {
  const prs = [pr(1), pr(2), pr(3), pr(4)];
  const wts = [
    wt("a", { prNumber: 1 }),
    wt("b", { branch: "feat/2" }),
    wt("c"),
  ];
  const out = pickAutoCandidates({
    rows: rowsFor(prs, wts, { [prs[2].key]: "c" }),
    wts,
    prs,
    bindings: { [prs[2].key]: "c" },
    rules: { ...DEFAULT_RULES, linkByPr: false, linkByBranch: false },
    records: {},
    repoSlugs: new Set([SLUG]),
    skipSlugs: new Set(),
    max: 10,
    perRun: 5,
    now: NOW,
  });
  assert.deepEqual(out.picks.map((p) => p.number), [4]);
});

test("候选：上限按“仍存在的自动 worktree”计算；每轮最多 perRun 个", () => {
  const prs = Array.from({ length: 8 }, (_, i) => pr(i + 10));
  const records = {
    "acme/desktop#1": { status: "created", workspaceId: "a", attempts: 1, at: 0 },
    "acme/desktop#2": { status: "created", workspaceId: "gone", attempts: 1, at: 0 },
  };
  const wts = [wt("a", { prNumber: 1 })];
  const capped = pick(prs, { wts, records, max: 3 });
  assert.equal(capped.alive, 1);
  assert.equal(capped.picks.length, 2);
  const full = pick(prs, { wts, records, max: 1 });
  assert.equal(full.picks.length, 0);
  assert.equal(full.capped, true);
  const perRun = pick(prs, { max: 30, perRun: 5 });
  assert.equal(perRun.picks.length, 5);
});

test("候选：失败的按退避重试；放弃 / 取消 / 已删 / 创建中不再自动建", () => {
  const prs = [pr(1), pr(2), pr(3), pr(4), pr(5), pr(6)];
  const records = {
    "acme/desktop#1": { status: "failed", attempts: 1, at: NOW - 60 * 60_000 },
    "acme/desktop#2": { status: "failed", attempts: 1, at: NOW - 60_000 },
    "acme/desktop#3": { status: "failed", attempts: 2, at: NOW - 24 * 3600_000 },
    "acme/desktop#4": { status: "gave_up", attempts: 1, at: 0 },
    "acme/desktop#5": { status: "canceled", attempts: 1, at: 0 },
    "acme/desktop#6": { status: "removed", attempts: 1, at: 0 },
  };
  assert.deepEqual(pick(prs, { records }).picks.map((p) => p.number), [1]);
});

test("候选：同步失败的仓库这一轮不建（快照可能过期）", () => {
  const out = pick([pr(1)], { skipSlugs: new Set([SLUG]) });
  assert.equal(out.picks.length, 0);
});

test("自动建的 worktree 不让 PR 进入审查中；手动的照旧", () => {
  const prs = [pr(1), pr(2)];
  const records = { "acme/desktop#1": { status: "created", workspaceId: "a", attempts: 1, at: 0 } };
  const wts = autoFlags([wt("a", { prNumber: 1 }), wt("b", { prNumber: 2 })], records);
  assert.equal(wts[0].auto, true);
  assert.equal(wts[1].auto, false);
  const rows = rowsFor(prs, wts);
  const byNum = Object.fromEntries(rows.map((r) => [r.pr.number, r.d.key]));
  assert.equal(byNum[1], "needs_review");
  assert.equal(byNum[2], "reviewing");
});

test("创建失败分类", () => {
  assert.equal(classifyCreateError("canceled").action, "canceled");
  assert.equal(classifyCreateError("branch_exists: pr-1-001").action, "rename");
  assert.equal(classifyCreateError("dir_exists: /x").action, "rename");
  assert.equal(classifyCreateError("branch_checked_out: x").action, "rename");
  assert.equal(classifyCreateError("pr_not_found: #1").action, "give_up");
  assert.equal(classifyCreateError("not_a_repo: /x").action, "give_up");
  assert.equal(classifyCreateError("repo_open_failed: GIT_UNSAFE_REPO: x").action, "give_up");
  assert.equal(classifyCreateError("invalid_args: x").action, "give_up");
  assert.equal(classifyCreateError("fetch_failed: timeout").action, "retry");
  assert.equal(classifyCreateError("unknown").action, "retry");
  assert.equal(classifyCreateError("").action, "retry");
});

test("失败记录：重试次数用完转放弃；取消记为取消", () => {
  const first = recordAfterFailure({ status: "creating", attempts: 1, at: 1 }, "fetch_failed: x", NOW);
  assert.equal(first.status, "failed");
  const last = recordAfterFailure({ status: "creating", attempts: 2, at: 1 }, "fetch_failed: x", NOW);
  assert.equal(last.status, "gave_up");
  const canceled = recordAfterFailure({ status: "creating", attempts: 1, at: 1 }, "canceled", NOW);
  assert.equal(canceled.status, "canceled");
  const fatal = recordAfterFailure({ status: "creating", attempts: 1, at: 1 }, "pr_not_found: x", NOW);
  assert.equal(fatal.status, "gave_up");
  assert.match(fatal.lastError, /pr_not_found/);
});

test("对账：看不到满 10 分钟、且父工作区可见才判为被删；重新出现就恢复", () => {
  const records = {
    "acme/desktop#1": { status: "created", workspaceId: "a", path: "/wt/a", repo: SLUG, parentId: "w1", attempts: 1, at: 0 },
    "acme/desktop#2": { status: "created", workspaceId: "zz", path: "/wt/zz", repo: SLUG, parentId: "w1", attempts: 1, at: 0 },
    "acme/desktop#3": { status: "created", workspaceId: "q", path: "/wt/q", repo: SLUG, parentId: "w-other", attempts: 1, at: 0 },
    "acme/gone#4": { status: "created", workspaceId: "g", path: "/wt/g", repo: "acme/gone", attempts: 1, at: 0 },
  };
  const ctx = { wts: [wt("a")], repoSlugs: new Set([SLUG]), parentIds: new Set(["w1"]) };
  const first = reconcileRecords({ records, ...ctx, now: NOW }).records;
  assert.equal(first["acme/desktop#2"].status, "created", "第一次看不到只记下时间");
  assert.equal(first["acme/desktop#2"].missingSince, NOW);
  const early = reconcileRecords({ records: first, ...ctx, now: NOW + 5 * 60_000 }).records;
  assert.equal(early["acme/desktop#2"].status, "created");
  const late = reconcileRecords({ records: first, ...ctx, now: NOW + 11 * 60_000 }).records;
  assert.equal(late["acme/desktop#2"].status, "removed");
  assert.equal(late["acme/desktop#1"].status, "created");
  assert.equal(late["acme/desktop#3"].status, "created", "父工作区不可见（侧栏重排 / 同仓库多工作区）不判");
  assert.equal(late["acme/gone#4"].status, "created");
  const back = reconcileRecords({ records: first, ...ctx, wts: [wt("a"), wt("zz")], now: NOW + 60_000 }).records;
  assert.equal(back["acme/desktop#2"].missingSince, 0);
});

test("对账：上次中断的 creating —— 找到同分支 worktree 记为已建，否则记失败", () => {
  const records = {
    "acme/desktop#1": { status: "creating", branch: "pr-1-001", repo: SLUG, attempts: 1, at: 0 },
    "acme/desktop#2": { status: "creating", branch: "pr-2-002", repo: SLUG, attempts: 1, at: 0 },
    "acme/desktop#3": { status: "creating", branch: "pr-3-003", repo: SLUG, attempts: 1, at: 0 },
  };
  const { records: out } = reconcileRecords({
    records,
    wts: [wt("x", { branch: "pr-1-001", prNumber: 1 })],
    repoSlugs: new Set([SLUG]),
    inFlight: new Set(["acme/desktop#3"]),
  });
  assert.equal(out["acme/desktop#1"].status, "created");
  assert.equal(out["acme/desktop#1"].workspaceId, "x");
  assert.equal(out["acme/desktop#2"].status, "failed");
  assert.equal(out["acme/desktop#3"].status, "creating");
});

test("可清理：只列 PR 已结束、仍存在、仍是自动的 worktree", () => {
  const prs = [pr(1, { state: "MERGED" }), pr(2), pr(3, { state: "CLOSED" })];
  const records = {
    "acme/desktop#1": { status: "created", workspaceId: "a", attempts: 1, at: 0 },
    "acme/desktop#2": { status: "created", workspaceId: "b", attempts: 1, at: 0 },
    "acme/desktop#3": { status: "adopted", workspaceId: "c", attempts: 1, at: 0 },
  };
  const wts = autoFlags([wt("a"), wt("b"), wt("c")], records);
  const out = cleanableAuto({ wts, records, prs });
  assert.deepEqual(out.map((item) => item.pr.number), [1]);
  assert.equal(out[0].wt.workspaceId, "a");
});

test("对账：失败记录如果宿主其实建好了（同分支），认领为已建", () => {
  const records = {
    "acme/desktop#1": { status: "failed", branch: "pr-1-001", repo: SLUG, attempts: 1, at: 0, lastError: "interrupted" },
  };
  const { records: out } = reconcileRecords({
    records,
    wts: [wt("x", { branch: "pr-1-001" })],
    repoSlugs: new Set([SLUG]),
  });
  assert.equal(out["acme/desktop#1"].status, "created");
  assert.equal(out["acme/desktop#1"].lastError, "");
});

test("记录清理：只删 PR 已不在快照、且早已结束的非活跃记录", () => {
  const old = NOW - 40 * 86_400_000;
  const records = {
    "a#1": { status: "removed", at: old },
    "a#2": { status: "removed", at: old },
    "a#3": { status: "created", at: old },
    "a#4": { status: "failed", at: NOW },
  };
  const { records: out, changed } = pruneRecords(records, new Set(["a#2"]), NOW, 30 * 86_400_000);
  assert.equal(changed, true);
  assert.deepEqual(Object.keys(out).sort(), ["a#2", "a#3", "a#4"]);
});

test("候选：fork 来的 PR 默认不建，打开开关才建", () => {
  const prs = [pr(1, {}), pr(2, {})].map((p, i) => (i === 1 ? { ...p, isCrossRepository: true } : p));
  const base = {
    rows: rowsFor(prs),
    wts: [],
    prs,
    bindings: {},
    rules: DEFAULT_RULES,
    records: {},
    repoSlugs: new Set([SLUG]),
    max: 10,
    now: NOW,
  };
  assert.deepEqual(pickAutoCandidates(base).picks.map((p) => p.number), [1]);
  assert.deepEqual(pickAutoCandidates({ ...base, includeForks: true }).picks.map((p) => p.number), [1, 2]);
});

test("对账：失败后你在侧栏点重试建出来的 worktree 算你的（adopted），不会被清理", () => {
  const records = {
    "acme/desktop#1": { status: "gave_up", branch: "pr-1-001", repo: SLUG, attempts: 2, at: 0, lastError: "fetch_failed: x" },
  };
  const { records: out } = reconcileRecords({
    records,
    wts: [wt("x", { branch: "pr-1-001" })],
    repoSlugs: new Set([SLUG]),
  });
  assert.equal(out["acme/desktop#1"].status, "adopted");
});

test("候选：你自己的 PR 永远不自动建（即使关掉了「排除我自己的 PR」）", () => {
  const prs = [pr(1, { author: "me" }), pr(2)];
  const rules = { ...DEFAULT_RULES, excludeMine: false };
  const rows = selectRows(prs, { rules, meSet: new Set(["me"]), wts: [], bindings: {}, now: NOW });
  const out = pickAutoCandidates({
    rows, wts: [], prs, bindings: {}, rules, records: {}, repoSlugs: new Set([SLUG]),
    meSet: new Set(["me"]), max: 10, now: NOW,
  });
  assert.deepEqual(out.picks.map((p) => p.number), [2]);
});

test("创建中的 worktree 一出现在侧栏就算自动（不会短暂变成审查中）", () => {
  const records = { "acme/desktop#1": { status: "creating", branch: "pr-1-001", repo: SLUG, attempts: 1, at: 0 } };
  const wts = autoFlags([wt("x", { branch: "pr-1-001", prNumber: 1 })], records);
  assert.equal(wts[0].auto, true);
  const byNum = Object.fromEntries(rowsFor([pr(1)], wts).map((r) => [r.pr.number, r.d.key]));
  assert.equal(byNum[1], "needs_review");
});

test("对账：第 2 次尝试中途重载 → 记为放弃，不会永远卡在失败", () => {
  const records = { "acme/desktop#1": { status: "creating", branch: "pr-1-002", repo: SLUG, attempts: 2, at: 0 } };
  const { records: out } = reconcileRecords({ records, wts: [], repoSlugs: new Set([SLUG]) });
  assert.equal(out["acme/desktop#1"].status, "gave_up");
});

test("候选：给出待审查总数与各类跳过原因（点「执行」时能说清为什么没建）", () => {
  const fork = (p) => ({ ...p, isCrossRepository: true });
  const prs = [fork(pr(1)), fork(pr(2)), pr(3, { author: "me" }), pr(4), pr(5)];
  const wts = [wt("a", { prNumber: 4 })];
  const rows = selectRows(prs, { rules: { ...DEFAULT_RULES, excludeMine: false }, meSet: new Set(["me"]), wts, bindings: {}, now: NOW });
  const out = pickAutoCandidates({
    rows,
    wts,
    prs,
    bindings: {},
    rules: DEFAULT_RULES,
    records: { "acme/desktop#5": { status: "canceled", attempts: 1, at: 0 } },
    repoSlugs: new Set([SLUG]),
    meSet: new Set(["me"]),
    max: 10,
    now: NOW,
  });
  assert.equal(out.total, 4, "#4 有 worktree 且是手动的 → 审查中，不在待审查里");
  assert.deepEqual(out.skipped, { fork: 2, mine: 1, record: 1 });
  assert.equal(out.picks.length, 0);
});
