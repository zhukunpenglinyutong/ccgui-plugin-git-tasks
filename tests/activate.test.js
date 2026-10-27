/** 激活期集成：注册 UI、拉数据、推徽标、清理。用真实 activate + 假 ctx。 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const React = require("react");

const domWindow = {
  visibilityState: "visible",
  addEventListener() {},
  removeEventListener() {},
};
Object.defineProperty(globalThis, "document", {
  value: domWindow,
  configurable: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "node" },
  configurable: true,
});

const activate = (await import("../src/main.js")).default;

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeCtx() {
  const calls = [];
  const registrations = {};
  const badges = { sets: [], disposed: false, handler: null };
  const store = new Map();
  const ctx = {
    react: React,
    pluginId: "github-tasks",
    version: "0.1.0",
    host: { locale: "zh-CN", sdkVersion: "0.3.22", appVersion: "1.1.8" },
    bridge: {
      invoke: async (_command, payload) => {
        calls.push(payload.args);
        const args = payload.args;
        if (payload.bin === "git") {
          return {
            code: 0,
            stdout: "https://github.com/zhukunpenglinyutong/desktop-cc-gui.git\n",
            stderr: "",
          };
        }
        if (args[1] === "graphql") {
          const query = args.find((a) => a.startsWith("query=")) || "";
          return {
            code: 0,
            stdout: JSON.stringify(
              fixture(query.includes("pullRequests(states:OPEN") ? "graphql-list.json" : "graphql-detail.json"),
            ),
            stderr: "",
          };
        }
        if (args[1] === "user") return { code: 0, stdout: "zhukunpenglinyutong\n", stderr: "" };
        if (args[args.indexOf("--state") + 1] === "all") {
          return { code: 0, stdout: JSON.stringify(fixture("pr-list-created.json")), stderr: "" };
        }
        if (args[args.indexOf("--state") + 1] === "merged") {
          return { code: 0, stdout: JSON.stringify(fixture("pr-list-merged.json")), stderr: "" };
        }
        return { code: 0, stdout: JSON.stringify(fixture("pr-list-closed.json")), stderr: "" };
      },
    },
    storage: {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => store.set(key, value),
      delete: async (key) => store.delete(key),
    },
    workspaces: {
      list: async () => [
        { id: "w1", path: "/repo", name: "desktop-cc-gui", groupId: null, lastOpenedAt: 1 },
        {
          id: "wt1",
          path: "/repo-wt",
          name: "pr-1436-818",
          kind: "worktree",
          parentId: "w1",
          worktree: { branch: "feat/session-fork", prNumber: 1436 },
        },
      ],
    },
    worktrees: {
      create: async () => ({ worktreePath: "/x" }),
      remove: async () => ({ orphanDirectory: false, branchKeptReason: null }),
    },
    ui: {
      registerCenterTab: (def) => {
        registrations.centerTab = def;
        return () => {};
      },
      registerSidebarNav: (def) => {
        registrations.sidebarNav = def;
        return () => {};
      },
      registerCommand: (def) => {
        registrations.commands = [...(registrations.commands || []), def];
        return () => {};
      },
      registerSettingsSection: (def) => {
        registrations.settings = def;
        return () => {};
      },
      openCenterTab: (key) => calls.push(["openCenterTab", key]),
      openSettings: () => calls.push(["openSettings"]),
      registerWorktreeBadges: (def) => {
        badges.handler = def.onClick;
        return {
          set: (id, badge) => badges.sets.push([id, badge]),
          clear: () => {},
          dispose: () => {
            badges.disposed = true;
          },
          list: () => [],
          onChange: () => () => {},
        };
      },
    },
  };
  return { ctx, calls, registrations, badges, store };
}

test("activate：注册 UI、同步数据、推徽标、清理", async () => {
  const { ctx, calls, registrations, badges } = makeCtx();
  const dispose = activate(ctx);
  assert.equal(typeof dispose, "function");
  assert.equal(typeof registrations.centerTab.component, "function");
  assert.equal(registrations.centerTab.title(), "Git 任务管理");
  assert.equal(registrations.sidebarNav.label(), "Git 任务管理");
  assert.equal(registrations.commands.length, 2);
  assert.equal(registrations.settings.label(), "Git 任务管理");

  for (let i = 0; i < 100; i += 1) {
    if (badges.sets.some(([, badge]) => badge)) break;
    await sleep(20);
  }

  const timeline = calls.filter((args) => Array.isArray(args) && args[0] === "api");
  assert.ok(timeline.length > 0);
  assert.ok(timeline.every((args) => args[1] === "graphql" || args[1] === "user"));
  assert.ok(calls.some((args) => Array.isArray(args) && args[0] === "pr" && args[1] === "list"));

  const navBadge = registrations.sidebarNav.badge();
  assert.equal(typeof navBadge, "number");
  assert.ok(navBadge > 0, `nav badge should count my PRs, got ${navBadge}`);

  const wtBadge = [...badges.sets].reverse().find(([id]) => id === "wt1")?.[1];
  assert.ok(wtBadge, "worktree badge should be pushed");
  assert.match(wtBadge.label, /审查中/);
  assert.equal(wtBadge.tone, "cyan");

  badges.handler({ workspaceId: "wt1" });
  assert.ok(calls.some((args) => Array.isArray(args) && args[0] === "openCenterTab"));

  dispose();
  assert.equal(badges.disposed, true);
});

test("activate：旧宿主缺少 registerWorktreeBadges 也能启动", async () => {
  const { ctx, registrations } = makeCtx();
  delete ctx.ui.registerWorktreeBadges;
  const dispose = activate(ctx);
  assert.equal(typeof registrations.centerTab.component, "function");
  await sleep(50);
  dispose();
});
