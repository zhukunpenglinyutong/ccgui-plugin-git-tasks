#!/usr/bin/env node
/**
 * 生成仓库里的市场展示素材：docs/icon.png + docs/screenshot-*.png。
 *
 * 截图不是手写 HTML：先把真实的 src/ui 组件在 jsdom 里挂载、渲染成 DOM，
 * 再交给本机 Chrome 以 2x 像素密度截图。所以图里的看板、抽屉、设置都是
 * 插件当前代码的真实输出，只有数据是固定夹具（acme/*）且不含真实账号。
 *
 * 用法：npm run assets（需要 macOS + Google Chrome）
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);

// jsdom 必须先于 react-dom 安装到全局，组件里的 document / window 才指向同一个实例。
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
Object.defineProperty(globalThis, "Node", { value: dom.window.Node, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = require("react");
const ReactDOM = require("react-dom/client");
const act = React.act || require("react-dom/test-utils").act;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const TMP = join(ROOT, "node_modules", ".cache", "ght-shots");

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.now();
const DAY0 = new Date(NOW).setHours(0, 0, 0, 0);
/** 保证落在「今天」，同时不晚于当前时间。 */
const today = (minutesAgo) => Math.max(DAY0 + 5 * MINUTE, NOW - minutesAgo * MINUTE);
const dateKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ------------------------------------------------------------------ */
/* 固定夹具：3 个仓库、14 个 PR，覆盖全部状态                            */
/* ------------------------------------------------------------------ */

function makePr({
  repo,
  number,
  title,
  author,
  createdAt,
  commits,
  reviews = [],
  timeline = [],
  isDraft = false,
  state = "OPEN",
  baseRefName = "main",
  additions = 0,
  deletions = 0,
}) {
  const owner = "acme";
  const headSha = commits[commits.length - 1].sha;
  const events = [
    { type: "opened", at: createdAt, sha: commits[0].sha, draft: isDraft },
    ...commits.map((c) => ({ type: "commit", at: c.at, sha: c.sha, merge: !!c.merge })),
    ...reviews.map((r) => ({
      type: "review",
      at: r.at,
      mine: true,
      by: "you",
      state: r.state,
      sha: r.sha ?? headSha,
      comments: r.comments ?? 0,
    })),
    ...timeline.map((e) => ({ ...e })),
  ].sort((a, b) => (a.type === "opened" ? -1 : b.type === "opened" ? 1 : a.at - b.at));
  return {
    key: `${owner}/${repo}#${number}`,
    owner,
    repo,
    repoSlug: `${owner}/${repo}`,
    headRefName: `feat/${number}-${title.length}`,
    baseRefName,
    number,
    title,
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
    author,
    headSha,
    commitShas: commits.map((c) => c.sha),
    additions,
    deletions,
    isDraft,
    requested: false,
    ignored: false,
    state,
    createdAt,
    updatedAt: events[events.length - 1].at,
    events,
  };
}

const DESKTOP = "desktop-cc-gui";
const JETBRAINS = "jetbrains-cc-gui";
const VSCODE = "vscode-cc-gui";

const PRS = [
  // desktop-cc-gui
  makePr({
    repo: DESKTOP,
    number: 1442,
    title: "feat: 插件市场展示图标与截图",
    author: "mia",
    createdAt: today(320),
    commits: [{ sha: "9f2c1442", at: today(320) }],
    additions: 184,
    deletions: 12,
  }),
  makePr({
    repo: DESKTOP,
    number: 1439,
    title: "fix: 会话切换后滚动位置丢失",
    author: "lin",
    createdAt: NOW - 9 * DAY,
    commits: [{ sha: "37ab1439", at: NOW - 9 * DAY }],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 8 * DAY, comments: 3 }],
    additions: 46,
    deletions: 21,
  }),
  makePr({
    repo: DESKTOP,
    number: 1437,
    title: "feat: 从 PR 一键创建 worktree",
    author: "kai",
    createdAt: NOW - 6 * DAY,
    commits: [
      { sha: "51dd1437", at: NOW - 6 * DAY },
      { sha: "8c2a1437", at: NOW - 4 * DAY - 2 * HOUR },
      { sha: "d0f71437", at: today(32) },
    ],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, sha: "8c2a1437", comments: 5 }],
    timeline: [{ type: "rerequest", at: today(24) }],
    additions: 312,
    deletions: 74,
  }),
  makePr({
    repo: DESKTOP,
    number: 1436,
    title: "feat: 侧栏显示 PR 状态徽标",
    author: "lin",
    createdAt: NOW - 5 * DAY,
    commits: [{ sha: "b8e21436", at: NOW - 5 * DAY }],
    reviews: [{ state: "APPROVED", at: today(180), comments: 1 }],
    additions: 128,
    deletions: 30,
  }),
  makePr({
    repo: DESKTOP,
    number: 1428,
    title: "wip: 看板拖拽直接写回 GitHub",
    author: "mira",
    createdAt: NOW - 26 * HOUR,
    commits: [{ sha: "2ff01428", at: NOW - 26 * HOUR }],
    isDraft: true,
    additions: 57,
    deletions: 4,
  }),
  makePr({
    repo: DESKTOP,
    number: 1420,
    title: "fix: 今日合并的 PR 不再重复计数",
    author: "kai",
    createdAt: NOW - 8 * DAY,
    commits: [{ sha: "c1f01420", at: NOW - 8 * DAY }],
    reviews: [{ state: "APPROVED", at: NOW - 7 * DAY }],
    timeline: [{ type: "merged", at: today(60), sha: "c1f01420" }],
    state: "MERGED",
    additions: 22,
    deletions: 15,
  }),

  // jetbrains-cc-gui
  makePr({
    repo: JETBRAINS,
    number: 892,
    title: "fix: IDEA 2025.2 流式输出中断",
    author: "alex",
    createdAt: NOW - 7 * DAY,
    commits: [{ sha: "44aa0892", at: NOW - 7 * DAY }],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 4 * DAY, comments: 2 }],
    additions: 63,
    deletions: 58,
  }),
  makePr({
    repo: JETBRAINS,
    number: 901,
    title: "feat: 会话历史全文搜索",
    author: "sara",
    createdAt: today(150),
    commits: [{ sha: "7d1b0901", at: today(150) }],
    additions: 401,
    deletions: 19,
  }),
  makePr({
    repo: JETBRAINS,
    number: 905,
    title: "feat: 审查轮次与超时提醒",
    author: "sara",
    createdAt: NOW - 5 * DAY,
    commits: [
      { sha: "0a3e0905", at: NOW - 5 * DAY },
      { sha: "be9c0905", at: NOW - 10 * HOUR },
    ],
    reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 3 * DAY, sha: "0a3e0905" }],
    additions: 96,
    deletions: 27,
  }),
  makePr({
    repo: JETBRAINS,
    number: 908,
    title: "feat: 插件设置支持搜索",
    author: "alex",
    createdAt: NOW - 4 * DAY,
    commits: [{ sha: "e5d70908", at: NOW - 4 * DAY }],
    reviews: [{ state: "APPROVED", at: NOW - 2 * DAY }],
    additions: 151,
    deletions: 33,
  }),

  // vscode-cc-gui
  makePr({
    repo: VSCODE,
    number: 611,
    title: "feat: 从 PR 创建 worktree 并复用终端",
    author: "noah",
    createdAt: NOW - 3 * DAY,
    commits: [{ sha: "1c6f0611", at: NOW - 3 * DAY }],
    additions: 244,
    deletions: 61,
  }),
  makePr({
    repo: VSCODE,
    number: 620,
    title: "fix: 浅色主题代码块对比度",
    author: "noah",
    createdAt: NOW - 10 * DAY,
    commits: [{ sha: "90b20620", at: NOW - 10 * DAY }],
    reviews: [{ state: "APPROVED", at: NOW - 6 * DAY }],
    additions: 18,
    deletions: 18,
  }),
  makePr({
    repo: VSCODE,
    number: 624,
    title: "feat: 状态栏显示模型与用量",
    author: "noah",
    createdAt: NOW - 12 * DAY,
    commits: [{ sha: "4ae80624", at: NOW - 12 * DAY }],
    reviews: [{ state: "APPROVED", at: NOW - 9 * DAY }],
    timeline: [{ type: "merged", at: today(45), sha: "4ae80624" }],
    state: "MERGED",
    additions: 73,
    deletions: 8,
  }),
  makePr({
    repo: VSCODE,
    number: 618,
    title: "refactor: 旧版设置页下线",
    author: "mia",
    createdAt: NOW - 13 * DAY,
    commits: [{ sha: "a11c0618", at: NOW - 13 * DAY }],
    timeline: [{ type: "closed", at: NOW - 2 * DAY }],
    state: "CLOSED",
    additions: 2,
    deletions: 380,
  }),
];

const DAILY = {
  [DESKTOP]: [2, 1, 3, 0, 4, 2, 1, 3, 2, 5, 1, 2, 1, 1],
  [JETBRAINS]: [1, 0, 2, 1, 1, 3, 0, 2, 1, 2, 4, 1, 0, 1],
  [VSCODE]: [0, 1, 1, 2, 0, 1, 2, 1, 3, 1, 2, 0, 0, 0],
};

function snapshot(repo) {
  const daily = {};
  for (let i = 0; i < 14; i += 1) {
    const key = dateKey(DAY0 - (13 - i) * DAY);
    daily[key] = DAILY[repo][i];
  }
  return {
    syncedAt: NOW - 2 * MINUTE,
    auxAt: NOW - 2 * MINUTE,
    prs: PRS.filter((pr) => pr.repo === repo),
    daily,
  };
}

/* ------------------------------------------------------------------ */
/* 宿主替身：workspace index + store                                    */
/* ------------------------------------------------------------------ */

const WORKSPACES = [
  { id: "w1", path: "/demo/desktop-cc-gui", name: DESKTOP, groupId: null, lastOpenedAt: 1 },
  { id: "w2", path: "/demo/jetbrains-cc-gui", name: JETBRAINS, groupId: null, lastOpenedAt: 2 },
  { id: "w3", path: "/demo/vscode-cc-gui", name: VSCODE, groupId: null, lastOpenedAt: 3 },
  {
    id: "wt1",
    path: "/demo/desktop-cc-gui-worktrees/pr-1437-318",
    name: "pr-1437-318",
    kind: "worktree",
    parentId: "w1",
    worktree: { branch: "pr-1437-318", prNumber: 1437 },
  },
  {
    id: "wt2",
    path: "/demo/jetbrains-cc-gui-worktrees/pr-905-117",
    name: "pr-905-117",
    kind: "worktree",
    parentId: "w2",
    worktree: { branch: "pr-905-117", prNumber: 905 },
  },
  {
    id: "wt3",
    path: "/demo/vscode-cc-gui-worktrees/pr-611-204",
    name: "pr-611-204",
    kind: "worktree",
    parentId: "w3",
    worktree: { branch: "pr-611-204", prNumber: 611 },
  },
];

function fakeExec() {
  const remotes = {
    "/demo/desktop-cc-gui": "https://github.com/acme/desktop-cc-gui.git",
    "/demo/jetbrains-cc-gui": "https://github.com/acme/jetbrains-cc-gui.git",
    "/demo/vscode-cc-gui": "https://github.com/acme/vscode-cc-gui.git",
  };
  return {
    stats: { calls: 0 },
    async runGh() {
      return { code: 0, stdout: "[]", stderr: "" };
    },
    async runGit(args) {
      return { code: 0, stdout: `${remotes[args[1]] || ""}\n`, stderr: "" };
    },
    async openUrl() {
      return true;
    },
  };
}

function fakeCtx(exec) {
  return {
    react: React,
    host: { locale: "zh-CN", sdkVersion: "0.3.22", appVersion: "1.1.8" },
    bridge: { invoke: () => Promise.resolve({ code: 0, stdout: "[]", stderr: "" }) },
    storage: { get: async () => null, set: async () => {}, delete: async () => {} },
    workspaces: { list: async () => WORKSPACES },
    worktrees: { create: async () => ({ worktreePath: "/demo/x" }), remove: async () => ({}) },
    ui: {
      openCenterTab: () => {},
      openSettings: () => {},
      registerWorktreeBadges: () => ({
        set: () => {},
        clear: () => {},
        dispose: () => {},
        list: () => [],
        onChange: () => () => {},
      }),
    },
  };
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                 */
/* ------------------------------------------------------------------ */

async function renderPanel(store, index, exec, ctx) {
  const { bindReact } = await import("../src/ui/react.js");
  bindReact(React);
  const { createPanel } = await import("../src/ui/Panel.js");
  const { createT } = await import("../src/i18n.js");
  const Panel = createPanel({ ctx, t: createT("zh-CN"), store, index, exec, sync: { run: async () => ({}) } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  await act(async () => {
    root.render(React.createElement(Panel));
  });
  // 面板挂载后会补记「审查中」开始时间并触发一次重渲染。
  await act(async () => {
    await Promise.resolve();
  });
  return container.innerHTML;
}

const RESET = `
  html, body { margin: 0; }
  body.shot {
    width: 1600px; height: 1080px; box-sizing: border-box; padding: 40px;
    display: flex; align-items: stretch; justify-content: stretch;
    background-color: #edf0f6;
    background-image:
      radial-gradient(1100px 620px at 8% -12%, #dfe8ff 0%, rgba(223, 232, 255, 0) 62%),
      radial-gradient(900px 560px at 100% 112%, #f2e6ff 0%, rgba(242, 230, 255, 0) 58%);
  }
  .win {
    flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden;
    border-radius: 16px; border: 1px solid rgba(20, 22, 34, 0.10); background: #fff;
    box-shadow: 0 34px 90px -34px rgba(23, 25, 40, 0.48), 0 2px 8px rgba(23, 25, 40, 0.08);
  }
  .win-bar {
    height: 40px; flex: none; display: flex; align-items: center; gap: 8px;
    padding: 0 14px; background: #f7f8fa; border-bottom: 1px solid #ebedf2;
  }
  .win-bar i { width: 11px; height: 11px; border-radius: 50%; display: block; }
  .win-bar .r { background: #ff5f57; }
  .win-bar .y { background: #febc2e; }
  .win-bar .g { background: #28c840; }
  .win-title { margin-left: 10px; font: 600 12.5px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; color: #3a3f4b; }
  .win-tag {
    margin-left: 8px; padding: 1px 7px; border-radius: 999px; background: #eceef4;
    font: 500 10.5px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; color: #6b7280;
  }
  .win-app { flex: 1; min-height: 0; display: flex; position: relative; overflow: hidden; }
  .win-app > .ght-root { flex: 1; width: 100%; height: 100%; }
`;

function page(inner, extraCss = "", script = "") {
  const css = readFileSync(join(ROOT, "styles.css"), "utf8");
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Git 任务管理</title>
<style>${RESET}${css}\n${extraCss}</style></head>
<body class="shot">
  <div class="win">
    <div class="win-bar"><i class="r"></i><i class="y"></i><i class="g"></i>
      <span class="win-title">Git 任务管理</span><span class="win-tag">CC GUI 插件</span>
    </div>
    <div class="win-app">${inner}</div>
  </div>
  ${script ? `<script>${script}</script>` : ""}
</body></html>`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, { timeout = 15_000, interval = 100 } = {}) {
  const until = Date.now() + timeout;
  let lastError;
  while (Date.now() < until) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw lastError || new Error("等待超时");
}

/**
 * 用 CDP 截图：设备指标先固定成 width×height，再以 2x 抓图。
 * CLI 的 --window-size 在 headless 下会让视口比窗口矮 87px，
 * 页面底部会被截掉；这里直接控制视口，顺便能做布局断言。
 */
async function capture(name, html, { width = 1600, height = 1080, transparent = false, check } = {}) {
  mkdirSync(TMP, { recursive: true });
  const file = join(TMP, `${name}.html`);
  const out = join(DOCS, `${name}.png`);
  writeFileSync(file, html);

  const port = 9334 + Math.floor(Math.random() * 400);
  const profile = join(TMP, `profile-${port}`);
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const target = await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, {
        method: "PUT",
      });
      return res.ok ? res.json() : null;
    });

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: false,
    });
    if (transparent) {
      await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    }
    await send("Page.navigate", { url: `file://${file}` });
    await waitFor(async () => {
      const result = await send("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      });
      return result.result?.result?.value === "complete";
    });
    await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
    await sleep(120);

    if (check) {
      const result = await send("Runtime.evaluate", { expression: check, returnByValue: true });
      const value = result.result?.result?.value;
      if (value) console.log(`  ${name}: ${value}`);
    }

    const shot = await send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    if (!shot.result?.data) throw new Error(`截图数据为空（${name}）`);
    writeFileSync(out, Buffer.from(shot.result.data, "base64"));
    console.log(`✓ docs/${name}.png`);
    ws.close();
  } finally {
    chrome.kill();
  }
}

async function main() {
  if (!existsSync(CHROME)) {
    throw new Error(`找不到 Chrome：${CHROME}（可用 CHROME_PATH 指定）`);
  }
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(DOCS, { recursive: true });
  mkdirSync(TMP, { recursive: true });

  const { createStore } = await import("../src/store.js");
  const { createWorkspaceIndex } = await import("../src/workspaces.js");
  const exec = fakeExec();
  const ctx = fakeCtx(exec);
  const store = createStore({ load: async () => null, save: async () => {}, debounceMs: 0 });
  await store.init();
  const index = createWorkspaceIndex({ ctx, exec, store });
  await index.refresh();
  for (const repo of [DESKTOP, JETBRAINS, VSCODE]) {
    store.setSnapshot(`acme/${repo}`, snapshot(repo));
  }
  store.setRuntime({
    ghLogin: "you",
    lastSync: NOW - 4 * MINUTE,
    syncing: false,
    progress: { done: 3, total: 3 },
    errors: {},
    ghError: null,
  });

  const layoutCheck = `(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [Math.round(b.top), Math.round(b.bottom)];
    };
    return JSON.stringify({ vh: innerHeight, work: r('.ght-work'), board: r('.ght-board'), drawer: r('.ght-drawer'), list: r('.ght-list'), modal: r('.ght-set-modal') });
  })()`;

  const variants = [
    {
      name: "screenshot-1",
      ui: { view: "board", filter: "all", repoFilter: "all", modal: null, drawerKey: null },
      // 看板单屏铺满：图表区在列表视图那张里展示，这里让五列完整可见。
      css: ".ght-grid2 { display: none; }",
      script: "",
    },
    {
      name: "screenshot-2",
      ui: {
        view: "board",
        filter: "all",
        repoFilter: "all",
        modal: null,
        drawerKey: "acme/desktop-cc-gui#1437",
      },
      script: "",
    },
    {
      name: "screenshot-3",
      ui: { view: "list", filter: "mine", repoFilter: "all", modal: null, drawerKey: null },
      script: "",
    },
    {
      name: "screenshot-4",
      ui: { view: "board", filter: "all", repoFilter: "all", modal: "settings", drawerKey: null },
      // 设置内容是可滚动的：真实滚动后侧栏高亮由 scroll spy 更新，
      // 静态截图里补上这一步（导航按钮的点击事件不在序列化后的 DOM 里）。
      script: `(() => {
        const body = document.querySelector('.ght-m-body');
        const sec = document.querySelector('#ght-sec-rules');
        if (body && sec) body.scrollTop = sec.offsetTop - 14;
        const nav = [...document.querySelectorAll('.ght-m-nav button')];
        for (const b of nav) b.classList.toggle('on', b.textContent.trim() === '状态判定');
      })();`,
    },
  ];

  for (const variant of variants) {
    store.setUi(variant.ui);
    const html = await renderPanel(store, index, exec, ctx);
    await capture(variant.name, page(html, variant.css || "", variant.script), { check: layoutCheck });
  }

  // 图标：直接用 SVG 源文件渲染，保留透明圆角。
  const iconSvg = readFileSync(join(DOCS, "icon.svg"), "utf8");
  const iconHtml = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style></head>
<body>${iconSvg}</body></html>`;
  writeFileSync(join(TMP, "icon.html"), iconHtml);
  await capture("icon", iconHtml, { width: 512, height: 512, transparent: true });
  // 2x 渲染后缩回 512，保证小尺寸清晰。
  execFileSync("sips", ["-z", "512", "512", join(DOCS, "icon.png")], { stdio: "ignore" });

  if (!process.env.KEEP) rmSync(TMP, { recursive: true, force: true });
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error?.stack || error);
    process.exit(1);
  },
);
