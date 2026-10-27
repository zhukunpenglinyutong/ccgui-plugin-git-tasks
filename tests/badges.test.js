import test from "node:test";
import assert from "node:assert/strict";
import { createBadges } from "../src/badges.js";
import { createStore } from "../src/store.js";
import { createT } from "../src/i18n.js";
import { DEFAULT_DEFS } from "../src/constants.js";
import { makePr, NOW } from "./helpers.js";

function harness({ supported = true } = {}) {
  const sets = [];
  const opened = [];
  let clickHandler = null;
  const ctx = {
    host: { locale: "zh-CN" },
    ui: {
      openCenterTab: (key) => opened.push(key),
      ...(supported
        ? {
            registerWorktreeBadges: (def) => {
              clickHandler = def.onClick;
              return {
                set: (id, badge) => sets.push([id, badge]),
                clear: () => {},
                dispose: () => sets.push(["__disposed__", null]),
              };
            },
          }
        : {}),
    },
  };
  const exec = { openUrl: async (url) => opened.push(url) };
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  const worktrees = [
    {
      workspaceId: "wt-1",
      parentWorkspaceId: "w1",
      path: "/repo-wt",
      name: "pr-1-111",
      repo: "acme/desktop",
      branch: "feat/1",
      prNumber: null,
    },
  ];
  const index = {
    getSnapshot: () => ({ worktrees, repos: [] }),
    subscribe: () => () => {},
    refresh: async () => ({ worktrees }),
  };
  const t = createT("zh-CN");
  return { ctx, exec, store, index, sets, opened, t, click: () => clickHandler, worktrees };
}

async function seed(store, pr) {
  await store.init();
  store.setRepos([{ slug: "acme/desktop", enabled: true, available: true }]);
  store.setSnapshot("acme/desktop", { syncedAt: NOW, prs: [pr], daily: {} });
}

test("徽标：状态、颜色、tooltip 四行", async () => {
  const harnessed = harness();
  await seed(harnessed.store, makePr({ number: 1, repo: "desktop", owner: "acme", createdAt: NOW - 3600_000 }));
  const badges = createBadges(harnessed);
  badges.refresh();
  const [id, badge] = harnessed.sets.at(-1);
  assert.equal(id, "wt-1");
  assert.equal(badge.tone, "cyan");
  assert.equal(badge.label, "审查中");
  const lines = badge.tooltip.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /acme\/desktop #1 · 审查中/);
  assert.match(lines[2], /对应方式：分支名与 PR 一致/);
  assert.match(lines[3], /点击查看流转详情/);
  badges.dispose();
});

test("徽标：停留时长后缀按设置；草稿不上侧栏", async () => {
  const harnessed = harness();
  await seed(harnessed.store, makePr({ number: 1, repo: "desktop", owner: "acme", createdAt: NOW - 3600_000 }));
  harnessed.store.setRules({ badgeAge: "always" });
  const badges = createBadges(harnessed);
  badges.refresh();
  const agedLabel = harnessed.sets.at(-1)[1].label;
  assert.match(agedLabel, /^审查中/);
  assert.ok([...agedLabel].length <= 6);

  const draft = harness();
  await seed(draft.store, makePr({ number: 2, repo: "desktop", owner: "acme", isDraft: true, draftAtCreation: true }));
  const draftBadges = createBadges(draft);
  draftBadges.refresh();
  assert.equal(draft.sets.at(-1)[1], null);
});

test("徽标：总开关 / 已忽略 / 仓库停用 / 无对应 PR 都清空", async () => {
  const disabled = harness();
  await seed(disabled.store, makePr({ number: 1, repo: "desktop", owner: "acme", createdAt: NOW - 3600_000 }));
  disabled.store.setRules({ badgeEnabled: false });
  const b1 = createBadges(disabled);
  b1.refresh();
  assert.equal(disabled.sets.at(-1)[1], null);

  const ignored = harness();
  await seed(ignored.store, makePr({ number: 1, repo: "desktop", owner: "acme", createdAt: NOW - 3600_000 }));
  ignored.store.toggleIgnore("acme/desktop#1");
  const b2 = createBadges(ignored);
  b2.refresh();
  assert.equal(ignored.sets.at(-1)[1], null);

  const noLink = harness();
  await seed(noLink.store, makePr({ number: 9, repo: "other", owner: "acme" }));
  const b3 = createBadges(noLink);
  b3.refresh();
  assert.equal(noLink.sets.at(-1)[1], null);
});

test("徽标：点击打开详情 / GitHub；移除 worktree 会清空", async () => {
  const harnessed = harness();
  const pr = makePr({ number: 1, repo: "desktop", owner: "acme" });
  await seed(harnessed.store, pr);
  const badges = createBadges(harnessed);
  badges.refresh();
  harnessed.click()({ workspaceId: "wt-1" });
  assert.equal(harnessed.store.getSnapshot().ui.drawerKey, pr.key);
  assert.deepEqual(harnessed.opened, ["board"]);

  harnessed.store.setRules({ badgeClick: "github" });
  badges.refresh();
  harnessed.click()({ workspaceId: "wt-1" });
  assert.match(harnessed.opened.at(-1), /github\.com\/acme\/desktop\/pull\/1$/);

  harnessed.worktrees.length = 0;
  badges.refresh();
  assert.deepEqual(harnessed.sets.at(-1), ["wt-1", null]);
  badges.dispose();
  assert.ok(harnessed.sets.some(([id]) => id === "__disposed__"));
});

test("旧宿主没有 registerWorktreeBadges 时静默跳过", async () => {
  const harnessed = harness({ supported: false });
  await seed(harnessed.store, makePr({ number: 1, repo: "desktop", owner: "acme" }));
  const badges = createBadges(harnessed);
  badges.refresh();
  badges.dispose();
  assert.equal(badges.supported, false);
  assert.equal(harnessed.sets.length, 0);
});

test("英文环境 tooltip / 状态名走英文", async () => {
  const harnessed = harness();
  harnessed.t = createT("en");
  await seed(harnessed.store, makePr({ number: 1, repo: "desktop", owner: "acme", createdAt: NOW - 3600_000 }));
  harnessed.store.setDefs({
    ...DEFAULT_DEFS,
    reviewing: { ...DEFAULT_DEFS.reviewing, label: "Rev" },
  });
  const badges = createBadges(harnessed);
  badges.refresh();
  const badge = harnessed.sets.at(-1)[1];
  assert.equal(badge.label, "Rev");
  assert.match(badge.tooltip, /click to open details/);
});

test("徽标预算：默认名与“名称·时长”都落在宿主 6 码点内", async () => {
  const { compactAge, composeBadgeLabel } = await import("../src/badges.js");
  const { DEFAULT_DEFS_EN } = await import("../src/i18n.js");
  const AGED = ["needs_review", "changes_requested", "needs_rereview", "approved"];
  for (const [key, def] of Object.entries(DEFAULT_DEFS_EN)) {
    if (AGED.includes(key)) assert.ok([...def.label].length <= 3, `${def.label} too long`);
    else assert.ok([...def.label].length <= 6, `${def.label} too long`);
  }
  for (const def of Object.values(DEFAULT_DEFS)) {
    assert.ok([...def.label].length <= 6, `${def.label} too long`);
  }
  assert.equal(compactAge(5 * 60_000), "5m");
  assert.equal(compactAge(3 * 3600_000), "3h");
  assert.equal(compactAge(2 * 86_400_000), "2d");
  assert.equal(composeBadgeLabel("待复审", "2d"), "待复审·2d");
  assert.ok([...composeBadgeLabel("待复审", "12h")].length <= 6);
  assert.ok([...composeBadgeLabel("Re", "12h")].length <= 6);
  assert.ok([...composeBadgeLabel("Merge", "2d")].length <= 6);
});
