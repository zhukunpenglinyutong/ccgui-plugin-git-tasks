import test from "node:test";
import assert from "node:assert/strict";
import { counts, dailySeries, dateKey, dayStart, todayFlow } from "../src/domain/stats.js";
import { derive, flags } from "../src/domain/derive.js";
import { DEFAULT_DEFS, DEFAULT_RULES, DAY } from "../src/constants.js";
import { makePr, NOW } from "./helpers.js";

const rules = (over = {}) => ({ ...DEFAULT_RULES, ...over });
const row = (pr, r = rules()) => {
  const d = derive(pr, r);
  return { pr, d, f: flags(d, r, NOW) };
};

test("dayStart：凌晨 2 点、切日 4 点时算前一天", () => {
  const two = new Date(2026, 9, 26, 2, 30).getTime();
  assert.equal(dayStart(two, 0), new Date(2026, 9, 26, 0, 0).getTime());
  assert.equal(dayStart(two, 4), new Date(2026, 9, 25, 4, 0).getTime());
  assert.equal(dayStart(two, 6), new Date(2026, 9, 25, 6, 0).getTime());
  const noon = new Date(2026, 9, 26, 12, 0).getTime();
  assert.equal(dayStart(noon, 4), new Date(2026, 9, 26, 4, 0).getTime());
  assert.equal(dateKey(noon), "2026-10-26");
});

test("counts：状态数、归属数、今日新增、今日合并、超时与沉默", () => {
  const rows = [
    row(makePr({ number: 1, createdAt: NOW - 3600_000 })),
    row(makePr({ number: 2, createdAt: NOW - 3600_000 })),
    row(
      makePr({
        number: 3,
        createdAt: NOW - 4 * DAY,
        reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 3 * DAY, sha: "c0" }],
      }),
    ),
    row(makePr({ number: 4, timeline: [{ type: "merged", at: NOW - 1 * 3600_000 }] })),
    row(makePr({ number: 5, isDraft: true, draftAtCreation: true })),
  ];
  const c = counts(rows, { defs: DEFAULT_DEFS, rules: rules(), now: NOW, excluded: 2 });
  assert.equal(c.needs_review, 2);
  assert.equal(c.changes_requested, 1);
  assert.equal(c.merged, 1);
  assert.equal(c.draft, 1);
  assert.equal(c.all, 5);
  assert.equal(c.mine, 2);
  assert.equal(c.author, 2);
  assert.equal(c.done, 1);
  assert.equal(c.today, 2);
  assert.equal(c.mergedToday, 1);
  assert.equal(c.overdue, 0);
  assert.equal(c.silent, 0);
  assert.equal(c.excluded, 2);
});

test("counts：忽略的 PR 不计入但单独统计", () => {
  const pr = { ...makePr({ number: 9 }), ignored: true };
  const c = counts([row(pr)], { defs: DEFAULT_DEFS, rules: rules(), now: NOW });
  assert.equal(c.all, 0);
  assert.equal(c.ignored, 1);
});

test("todayFlow：今日新增（含草稿）、审查、修复、合并", () => {
  const today = new Date(2026, 9, 26, 10, 0).getTime();
  const prs = [
    makePr({ number: 1, repo: "desktop", createdAt: today - 3600_000 }),
    makePr({ number: 2, repo: "desktop", isDraft: true, draftAtCreation: true, createdAt: today - 3600_000 }),
    makePr({
      number: 3,
      repo: "other",
      createdAt: NOW - 5 * DAY,
      reviews: [{ state: "CHANGES_REQUESTED", at: today - 1800_000, sha: "c0" }],
      commits: [
        { sha: "c0", at: NOW - 5 * DAY },
        { sha: "c1", at: today - 600_000 },
      ],
    }),
    makePr({
      number: 4,
      repo: "other",
      createdAt: NOW - 5 * DAY,
      reviews: [{ state: "APPROVED", at: today - 900_000, sha: "c0" }],
      timeline: [
        { type: "merged", at: today - 300_000 },
        { type: "closed", at: today - 200_000 },
      ],
    }),
  ];
  const f = todayFlow(prs, rules({ dayCutoff: 0 }), NOW);
  assert.equal(f.opened, 2);
  assert.equal(f.drafts, 1);
  assert.equal(f.first, 2);
  assert.equal(f.re, 0);
  assert.equal(f.changes, 1);
  assert.equal(f.approve, 1);
  assert.equal(f.fixed, 1);
  assert.equal(f.merged, 1);
  assert.equal(f.closed, 1);
  assert.deepEqual(f.byRepo, { "acme/desktop": 2 });
});

test("todayFlow：同一 PR 的第二次审查算复审", () => {
  const today = new Date(2026, 9, 26, 10, 0).getTime();
  const prs = [
    makePr({
      number: 7,
      createdAt: NOW - 5 * DAY,
      reviews: [
        { state: "CHANGES_REQUESTED", at: today - 5000_000, sha: "c0" },
        { state: "APPROVED", at: today - 4000_000, sha: "c0" },
      ],
    }),
  ];
  const f = todayFlow(prs, rules({ dayCutoff: 0 }), NOW);
  assert.equal(f.first, 1);
  assert.equal(f.re, 1);
  assert.equal(f.changes, 1);
  assert.equal(f.approve, 1);
});

test("todayFlow：切日 4 点把凌晨的审查算到前一天", () => {
  const early = new Date(2026, 9, 26, 2, 0).getTime();
  const prs = [
    makePr({
      number: 1,
      createdAt: NOW - 5 * DAY,
      reviews: [{ state: "APPROVED", at: early, sha: "c0" }],
    }),
  ];
  assert.equal(todayFlow(prs, rules({ dayCutoff: 4 }), NOW).first, 0);
  assert.equal(todayFlow(prs, rules({ dayCutoff: 0 }), NOW).first, 1);
});

test("dailySeries：14 天、按仓库顺序分色、停用不影响其他仓库颜色", () => {
  const repoList = [
    { slug: "acme/a", enabled: true },
    { slug: "acme/b", enabled: false },
    { slug: "acme/c", enabled: true },
  ];
  const snapshots = {
    "acme/a": { daily: { "2026-10-25": 3, "2026-10-26": 1 } },
    "acme/c": { daily: { "2026-10-26": 2 } },
  };
  const series = dailySeries(snapshots, repoList, rules({ dayCutoff: 0 }), NOW);
  assert.deepEqual(
    series.series.map((s) => [s.slug, s.colorIndex]),
    [
      ["acme/a", 0],
      ["acme/c", 2],
    ],
  );
  assert.equal(series.days.length, 14);
  const last = series.days[series.days.length - 1];
  assert.equal(dateKey(last.at), "2026-10-26");
  assert.deepEqual(last.vals, [1, 2]);
  const prev = series.days[series.days.length - 2];
  assert.deepEqual(prev.vals, [3, 0]);
});

test("dailySeries：切日 6 点，凌晨的数据仍算前一天", () => {
  const two = new Date(2026, 9, 26, 2, 0).getTime();
  const snapshots = { "acme/a": { daily: { "2026-10-25": 4 } } };
  const series = dailySeries(
    snapshots,
    [{ slug: "acme/a", enabled: true }],
    rules({ dayCutoff: 6 }),
    two,
  );
  const last = series.days[series.days.length - 1];
  assert.equal(dateKey(last.at), "2026-10-25");
  assert.deepEqual(last.vals, [4]);
});

test("selectRows：仓库过滤支持多选数组", async () => {
  const { selectRows } = await import("../src/domain/stats.js");
  const a = makePr({ number: 1, repo: "a", owner: "acme" });
  const b = makePr({ number: 2, repo: "b", owner: "acme" });
  const c = makePr({ number: 3, repo: "c", owner: "acme" });
  const rows = selectRows([a, b, c], {
    rules: rules(),
    meSet: new Set(["me"]),
    repoFilter: ["acme/a", "acme/c"],
    now: NOW,
  });
  assert.deepEqual(
    rows.map((r) => r.pr.number),
    [1, 3],
  );
});

test("selectRows：有对应 worktree 且未审 → 审查中", async () => {
  const { selectRows } = await import("../src/domain/stats.js");
  const pr = makePr({ number: 1 });
  const wts = [
    {
      workspaceId: "wt-1",
      parentWorkspaceId: "w1",
      path: "/x",
      name: "pr-1-111",
      repo: "acme/desktop-cc-gui",
      branch: "feat/1",
      prNumber: null,
    },
  ];
  const rows = selectRows([pr], {
    rules: rules(),
    meSet: new Set(["me"]),
    wts,
    bindings: {},
    reviewingSince: { [pr.key]: NOW - 60_000 },
    now: NOW,
  });
  assert.equal(rows[0].d.key, "reviewing");
  assert.equal(rows[0].d.since, NOW - 60_000);
  const noWt = selectRows([pr], { rules: rules(), meSet: new Set(["me"]), now: NOW });
  assert.equal(noWt[0].d.key, "needs_review");
});

test("selectRows：仓库过滤、停用、草稿开关、范围", async () => {
  const { selectRows } = await import("../src/domain/stats.js");
  const mine = makePr({ number: 1, author: "me" });
  const draft = makePr({ number: 2, isDraft: true, draftAtCreation: true });
  const other = makePr({ number: 3, repo: "other" });
  const rows = selectRows([mine, draft, other], {
    rules: rules(),
    meSet: new Set(["me"]),
    repoFilter: "all",
    reposEnabled: { "acme/other": false },
    now: NOW,
  });
  assert.deepEqual(
    rows.map((r) => r.pr.number),
    [2],
  );
  const ignoredRow = { ...makePr({ number: 5 }), ignored: true };
  assert.equal(
    selectRows([ignoredRow], { rules: rules(), meSet: new Set(["me"]), now: NOW }).length,
    0,
  );
  assert.equal(
    selectRows([ignoredRow], { rules: rules(), meSet: new Set(["me"]), showIgnored: true, now: NOW }).length,
    1,
  );
  const withDrafts = selectRows([draft], {
    rules: rules({ includeDraft: false }),
    meSet: new Set(["me"]),
    now: NOW,
  });
  assert.equal(withDrafts.length, 0);
  const scoped = selectRows([other, makePr({ number: 4, requested: true })], {
    rules: rules({ scope: "mine" }),
    meSet: new Set(["me"]),
    now: NOW,
  });
  assert.deepEqual(
    scoped.map((r) => r.pr.number),
    [4],
  );
});

test("flowByDay：按天统计审查 / 修复 / 合并，切日生效", async () => {
  const { flowByDay } = await import("../src/domain/stats.js");
  const today = new Date(2026, 9, 26, 10, 0).getTime();
  const prs = [
    makePr({
      number: 1,
      createdAt: NOW - 10 * DAY,
      reviews: [{ state: "CHANGES_REQUESTED", at: today - 3600_000, sha: "c0" }],
      commits: [
        { sha: "c0", at: NOW - 10 * DAY },
        { sha: "c1", at: today - 1800_000 },
      ],
    }),
    makePr({
      number: 2,
      createdAt: NOW - 2 * DAY,
      timeline: [{ type: "merged", at: today - 600_000 }],
    }),
  ];
  const rows = flowByDay(prs, rules({ dayCutoff: 0 }), NOW, 14);
  const last = rows[rows.length - 1];
  assert.equal(dateKey(last.key ? new Date(last.key + "T00:00:00").getTime() : 0), last.key);
  assert.deepEqual([last.reviews, last.fixed, last.merged], [1, 1, 1]);
});

test("flowByDay：切日 4 点把凌晨的审查算到前一天", async () => {
  const { flowByDay } = await import("../src/domain/stats.js");
  const early = new Date(2026, 9, 26, 2, 0).getTime();
  const prs = [
    makePr({
      number: 1,
      createdAt: NOW - 5 * DAY,
      reviews: [{ state: "APPROVED", at: early, sha: "c0" }],
    }),
  ];
  const rows4 = flowByDay(prs, rules({ dayCutoff: 4 }), NOW, 14);
  const todayKey = dateKey(new Date(2026, 9, 26).getTime());
  const yKey = dateKey(new Date(2026, 9, 25).getTime());
  assert.equal(rows4.find((r) => r.key === todayKey).reviews, 0);
  assert.equal(rows4.find((r) => r.key === yKey).reviews, 1);
});
