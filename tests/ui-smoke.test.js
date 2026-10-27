/** UI 冒烟：在 jsdom 里用宿主注入同一份 React 渲染面板、抽屉、设置、绑定弹窗。
 *  这里不替代真实应用验收，只兜住渲染期崩溃与关键交互路径。 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const React = require("react");
const ReactDOM = require("react-dom/client");
const { act } = require("react-dom/test-utils");

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
Object.defineProperty(globalThis, "Node", { value: dom.window.Node, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { bindReact } = await import("../src/ui/react.js");
const { createPanel } = await import("../src/ui/Panel.js");
const { SettingsBody } = await import("../src/ui/SettingsModal.js");
const { createStore } = await import("../src/store.js");
const { createWorkspaceIndex } = await import("../src/workspaces.js");
const { fetchRepo } = await import("../src/sync.js");
const { createT } = await import("../src/i18n.js");
const { DEFAULT_RULES } = await import("../src/constants.js");

bindReact(React);

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

function fakeExec() {
  return {
    calls: [],
    stats: { calls: 0 },
    async runGh(args) {
      this.calls.push(args);
      if (args[1] === "graphql") {
        const query = args.find((a) => a.startsWith("query=")) || "";
        return {
          code: 0,
          stdout: JSON.stringify(fixture(query.includes("pullRequests(states:OPEN") ? "graphql-list.json" : "graphql-detail.json")),
          stderr: "",
        };
      }
      if (args[args.indexOf("--state") + 1] === "all") {
        return { code: 0, stdout: JSON.stringify(fixture("pr-list-created.json")), stderr: "" };
      }
      if (args[args.indexOf("--state") + 1] === "merged") {
        return { code: 0, stdout: JSON.stringify(fixture("pr-list-merged.json")), stderr: "" };
      }
      return { code: 0, stdout: JSON.stringify(fixture("pr-list-closed.json")), stderr: "" };
    },
    async runGit(args) {
      const path = args[1];
      if (path === "/repo2") {
        return { code: 0, stdout: "https://github.com/zhukunpenglinyutong/jetbrains-cc-gui.git\n", stderr: "" };
      }
      if (path === "/repo3") {
        return { code: 0, stdout: "https://github.com/zhukunpenglinyutong/vscode-cc-gui.git\n", stderr: "" };
      }
      return { code: 0, stdout: "https://github.com/zhukunpenglinyutong/desktop-cc-gui.git\n", stderr: "" };
    },
    async openUrl() {
      return true;
    },
  };
}

function fakeCtx(exec, badgeSets = []) {
  const workspaces = [
    { id: "w1", path: "/repo", name: "desktop-cc-gui", groupId: null, lastOpenedAt: 1 },
    { id: "w2", path: "/repo2", name: "jetbrains-cc-gui", groupId: null, lastOpenedAt: 0 },
    { id: "w3", path: "/repo3", name: "vscode-cc-gui", groupId: null, lastOpenedAt: 0 },
    {
      id: "wt1",
      path: "/repo-worktrees/pr-1436-818",
      name: "pr-1436-818",
      kind: "worktree",
      parentId: "w1",
      worktree: { branch: "pr-1436-818", prNumber: 1436 },
    },
  ];
  return {
    react: React,
    host: { locale: "zh-CN", sdkVersion: "0.3.22", appVersion: "1.1.8" },
    bridge: { invoke: (command, payload) => exec.runGh(payload.args) },
    storage: { get: async () => null, set: async () => {}, delete: async () => {} },
    workspaces: { list: async () => workspaces },
    worktrees: { create: async () => ({ worktreePath: "/x" }), remove: async () => ({}) },
    ui: {
      openCenterTab: () => {},
      openSettings: () => {},
      registerWorktreeBadges: () => ({
        set: (id, badge) => badgeSets.push([id, badge]),
        clear: () => {},
        dispose: () => {},
        list: () => [],
        onChange: () => () => {},
      }),
    },
  };
}

async function mount() {
  const exec = fakeExec();
  const ctx = fakeCtx(exec);
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  await store.init();
  const index = createWorkspaceIndex({ ctx, exec, store });
  await index.refresh();
  const snap = await fetchRepo("zhukunpenglinyutong/desktop-cc-gui", {
    exec,
    prev: null,
    rules: DEFAULT_RULES,
    nowMs: Date.now(),
    meSet: new Set(["zhukunpenglinyutong"]),
  });
  store.setSnapshot("zhukunpenglinyutong/desktop-cc-gui", snap);
  store.setRuntime({ ghLogin: "zhukunpenglinyutong", lastSync: Date.now() });
  const syncCalls = [];
  const sync = {
    run: async (repos) => {
      syncCalls.push(repos);
      return { errors: {}, login: "zhukunpenglinyutong" };
    },
  };
  const Panel = createPanel({
    ctx,
    t: createT("zh-CN"),
    store,
    index,
    exec,
    sync,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  await act(async () => {
    root.render(React.createElement(Panel));
  });
  return { root, container, store, index, exec, ctx, syncCalls };
}

test("面板：KPI、看板、空态文案真实渲染", async () => {
  const { root, container } = await mount();
  const text = container.textContent;
  assert.match(text, /PR 流转/);
  assert.match(text, /今日新增/);
  assert.match(text, /待审查/);
  assert.match(text, /待修复/);
  assert.match(text, /待复审/);
  assert.match(text, /已通过/);
  assert.match(text, /已结束/);
  assert.ok(container.querySelectorAll(".ght-kc").length > 5);
  assert.ok(container.querySelector(".ght-tbl") === null);
  await act(async () => root.unmount());
});

test("图表表视图 / 列表视图可切换", async () => {
  const { root, container } = await mount();
  const segButtons = [...container.querySelectorAll(".ght-seg button")];
  await act(async () => {
    segButtons.find((b) => b.textContent === "表").click();
  });
  assert.ok(container.querySelector(".ght-tbl"));
  await act(async () => {
    [...container.querySelectorAll(".ght-seg button")]
      .find((b) => b.textContent === "列表")
      .click();
  });
  assert.ok(container.querySelectorAll(".ght-pr-row").length > 0);
  await act(async () => root.unmount());
});

test("卡片打开详情抽屉，Esc 关闭", async () => {
  const { root, container } = await mount();
  await act(async () => container.querySelector(".ght-kc").click());
  assert.ok(container.querySelector(".ght-drawer"));
  assert.match(container.querySelector(".ght-drawer").textContent, /流转记录/);
  assert.match(container.querySelector(".ght-drawer").textContent, /为什么是/);
  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  });
  assert.equal(container.querySelector(".ght-drawer"), null);
  await act(async () => root.unmount());
});

test("设置弹窗打开、切换分区、关闭", async () => {
  const { root, container } = await mount();
  const gear = [...container.querySelectorAll(".ght-icon-btn")].at(-1);
  await act(async () => gear.click());
  assert.ok(container.querySelector(".ght-set-modal"));
  const nav = [...container.querySelectorAll(".ght-m-nav button")];
  assert.equal(nav.length, 10);
  await act(async () => nav.find((b) => b.textContent === "Worktree 徽标").click());
  assert.match(container.querySelector(".ght-m-body").textContent, /点击徽标/);
  await act(async () => [...container.querySelectorAll(".ght-m-nav button")].find((b) => b.textContent === "路线图").click());
  assert.match(container.querySelector(".ght-m-body").textContent, /GitLab 支持/);
  assert.match(container.querySelector(".ght-m-body").textContent, /尚未实现/);
  await act(async () => [...container.querySelectorAll(".ght-btn")].find((b) => b.textContent === "完成").click());
  assert.equal(container.querySelector(".ght-set-modal"), null);
  await act(async () => root.unmount());
});

test("关联 worktree 弹窗：默认绑定已有 / 切到新建预览", async () => {
  const { root, container } = await mount();
  const bindBtn = [...container.querySelectorAll(".ght-ghost-btn")].find((b) =>
    b.textContent.includes("关联 worktree"),
  );
  await act(async () => bindBtn.click());
  assert.ok(container.querySelector(".ght-bind-modal"));
  assert.match(container.querySelector(".ght-bind-modal").textContent, /绑定已有的 worktree/);
  await act(async () => container.querySelector('[data-act], .ght-opt:last-of-type, .ght-opt').click());
  const opts = [...container.querySelectorAll(".ght-opt")];
  await act(async () => opts[1].click());
  assert.match(container.querySelector(".ght-create-pv").textContent, /pull\/\d+\/head/);
  await act(async () => root.unmount());
});

function fireDrag(el, type, extra = {}) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  event.dataTransfer = {
    effectAllowed: "",
    dropEffect: "",
    setData() {},
    getData() {
      return "";
    },
  };
  Object.assign(event, extra);
  el.dispatchEvent(event);
  return event;
}

test("拖拽：列内排序写入 order，跨列写入本地标记", async () => {
  const { root, container, store } = await mount();
  const board = container.querySelector(".ght-board");
  const columns = [...board.querySelectorAll(".ght-bcol-body")];
  const firstCard = board.querySelector("[data-card]");
  const key = firstCard.dataset.card;

  await act(async () => {
    fireDrag(firstCard, "dragstart");
  });
  await act(async () => {
    fireDrag(columns[0], "dragover", { clientY: 400 });
    fireDrag(columns[0], "drop", { clientY: 400 });
  });
  assert.ok(store.getSnapshot().local.order.review.includes(key));

  const movable = columns[0].querySelector('[data-card][draggable="true"]');
  const movableKey = movable.dataset.card;
  await act(async () => {
    fireDrag(movable, "dragstart");
  });
  await act(async () => {
    fireDrag(columns[1], "dragover", { clientY: 10 });
    fireDrag(columns[1], "drop", { clientY: 10 });
  });
  const marks = store.getSnapshot().local.marks[movableKey] || [];
  assert.equal(marks.at(-1).verdict, "changes");
  await act(async () => root.unmount());
});

test("错误横幅：每个仓库单独重试，且同步中隐藏", async () => {
  const { root, container, store, syncCalls } = await mount();
  await act(async () => {
    store.setRuntime({
      syncing: false,
      errors: { "acme/a": "连接失败", "acme/b": "连接失败" },
    });
  });
  const rows = [...container.querySelectorAll(".ght-banner-row")];
  assert.equal(rows.length, 2);
  const retry = [...rows[0].querySelectorAll("button")].find((b) => b.textContent === "重试");
  await act(async () => retry.click());
  assert.deepEqual(syncCalls.at(-1), [{ slug: "acme/a", enabled: true, available: true }]);

  const close = [...container.querySelectorAll(".ght-banner-row")][1].querySelector(".ght-banner-close");
  assert.ok(close, "每个错误行右侧有关闭按钮");
  await act(async () => close.click());
  assert.deepEqual(Object.keys(store.getSnapshot().runtime.errors), ["acme/a"]);

  await act(async () => {
    store.setRuntime({ syncing: true, syncStartedAt: Date.now(), progress: { done: 0, total: 1 } });
  });
  assert.equal(container.querySelector(".ght-banner"), null);
  await act(async () => store.setRuntime({ syncing: false, ghError: "gh 未登录" }));
  const globalClose = container.querySelector(".ght-banner .ght-banner-close");
  await act(async () => globalClose.click());
  assert.equal(store.getSnapshot().runtime.ghError, null);
  await act(async () => root.unmount());
});

test("仓库多选：先单选置灰其余，再点累加，选满回到全部", async () => {
  const { root, container } = await mount();
  await act(async () => container.querySelector(".ght-repo-chip").click());
  const option = (slug) =>
    [...container.querySelectorAll(".ght-repo-menu button")].find((b) => b.textContent.includes(slug));

  await act(async () => option("desktop-cc-gui").click());
  assert.match(container.querySelector(".ght-repo-chip").textContent, /desktop-cc-gui/);
  assert.ok(option("jetbrains-cc-gui").classList.contains("ght-dim"));

  await act(async () => option("jetbrains-cc-gui").click());
  assert.match(container.querySelector(".ght-repo-chip").textContent, /2 个仓库/);
  assert.ok(option("vscode-cc-gui").classList.contains("ght-dim"));

  await act(async () => option("vscode-cc-gui").click());
  assert.match(container.querySelector(".ght-repo-chip").textContent, /全部仓库/);
  await act(async () => root.unmount());
});

test("仓库下拉与图表 tooltip 的仓库名单行省略", async () => {
  const { root, container } = await mount();
  await act(async () => container.querySelector(".ght-repo-chip").click());
  const name = container.querySelector(".ght-repo-name");
  assert.ok(name);
  assert.equal(name.getAttribute("title"), "zhukunpenglinyutong/desktop-cc-gui");
  assert.ok(name.classList.contains("ght-repo-name"));
  await act(async () => root.unmount());
});

test("设置分区组件可单独渲染（客户端设置 › 插件）", async () => {
  const exec = fakeExec();
  const ctx = fakeCtx(exec);
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  await store.init();
  const index = createWorkspaceIndex({ ctx, exec, store });
  await index.refresh();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const state = store.getSnapshot();
  await act(async () => {
    root.render(
      React.createElement(
        "div",
        { className: "ght-root ght-embedded" },
        React.createElement(SettingsBody, {
          t: createT("zh-CN"),
          ctx,
          store,
          index,
          rules: state.cfg.rules,
          defs: state.cfg.defs,
          counts: { mine: 0, needs_review: 0, needs_rereview: 0, author: 0, merge: 0 },
          now: Date.now(),
          toast: () => {},
          onSync: () => {},
        }),
      ),
    );
  });
  assert.ok(container.querySelectorAll("[data-sec]").length === 10);
  assert.ok(container.querySelector(".ght-repo-line"));
  await act(async () => root.unmount());
});
