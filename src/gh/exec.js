/** gh / git / 系统打开器：只读白名单、并发上限、错误分类与一次退避重试。 */

import { GIT_TIMEOUT_MS, GH_CONCURRENCY, GH_TIMEOUT_MS } from "../constants.js";

export class GhError extends Error {
  constructor(kind, message, details = {}) {
    super(message);
    this.name = "GhError";
    this.kind = kind;
    this.details = details;
  }
}

const MISSING = /command not found|no such file or directory|ENOENT|不是内部或外部命令/i;
const AUTH = /gh auth login|not logged in|authentication failed|bad credentials|HTTP 401|HTTP 40[13].*auth|requires authentication/i;
const RATE = /rate limit|secondary rate|abuse detection|HTTP 429/i;
const NETWORK = /could not resolve host|failed to connect|connection (reset|refused)|timed out|timeout|TLS|network is unreachable|unexpected EOF|\bEOF\b|HTTP 5\d\d/i;

export function classifyFailure(message) {
  const text = String(message || "");
  if (MISSING.test(text)) return "missing";
  if (AUTH.test(text)) return "auth";
  if (RATE.test(text)) return "rate_limit";
  if (NETWORK.test(text)) return "network";
  return "other";
}

const READ_ONLY = new Set([
  "api:graphql",
  "api:user",
  "pr:list",
  "auth:status",
]);

const FORBIDDEN_FLAGS = new Set(["-F", "--field", "--input", "--method", "--web"]);
const PR_LIST_FLAGS = new Set(["-R", "--state", "--search", "--limit", "--json", "--jq"]);

export function assertReadOnlyArgs(args) {
  const [group, sub] = args || [];
  const key = `${group}:${sub}`;
  if (!READ_ONLY.has(key)) {
    throw new GhError("denied", `只允许只读的 gh 子命令，已拒绝：gh ${[group, sub].filter(Boolean).join(" ")}`);
  }
  if (args.some((arg) => FORBIDDEN_FLAGS.has(arg))) {
    throw new GhError("denied", "只读白名单不接受 -F / --input / --method / --web 等可写或交互参数");
  }
  if (key === "api:graphql") {
    const queries = args.filter((a) => typeof a === "string" && a.startsWith("query="));
    if (queries.length !== 1) throw new GhError("denied", "只允许一条 GraphQL query");
    if (/mutation\b/i.test(queries[0])) {
      throw new GhError("denied", "只允许只读查询：已拒绝 GraphQL mutation");
    }
  }
  if (key === "pr:list") {
    for (const arg of args.slice(2)) {
      if (arg.startsWith("-") && !PR_LIST_FLAGS.has(arg)) {
        throw new GhError("denied", `pr list 不接受参数：${arg}`);
      }
    }
  }
}

export function assertGitArgs(args) {
  const scoped = Array.isArray(args) && args[0] === "-C" && typeof args[1] === "string";
  if (scoped && args[2] === "status") {
    // 清理自动 worktree 前检查有没有未提交改动（宿主删除带 --force）。
    if (args.length === 5 && args[3] === "--porcelain" && args[4] === "--ignore-submodules=none") return;
    throw new GhError("denied", "git status 只允许 `git -C <path> status --porcelain --ignore-submodules=none`");
  }
  const ok = scoped && args.length === 5 && args[2] === "remote" && args[3] === "get-url";
  if (!ok) {
    throw new GhError(
      "denied",
      "git 只允许 `git -C <path> remote get-url <remote>` 与 `git -C <path> status --porcelain --ignore-submodules=none`",
    );
  }
}

function detectPlatform() {
  if (typeof navigator !== "undefined" && /win/i.test(navigator.userAgent || "")) return "win32";
  return "darwin";
}

const defaultInvoke = async () => {
  throw new GhError("denied", "未提供 exec 桥");
};

function createLimiter(concurrency) {
  let active = 0;
  const queue = [];
  const acquire = () => {
    if (active < concurrency) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  };
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
  };
  return { acquire, release };
}

async function invokeOnce({ invoke, bin, args, timeoutMs, limiter, stats }) {
  await limiter.acquire();
  stats.calls += 1;
  try {
    const result = await invoke("plugin_exec_run", { bin, args, timeoutMs });
    return {
      code: Number(result?.code ?? 0),
      stdout: String(result?.stdout ?? ""),
      stderr: String(result?.stderr ?? ""),
    };
  } catch (error) {
    const message = error?.message || String(error);
    throw new GhError(classifyFailure(message), message, { bin, args });
  } finally {
    limiter.release();
  }
}

function failureOf(result, bin, args) {
  const text = `${result.stderr}\n${result.stdout}`.trim();
  return new GhError(classifyFailure(text), text || `${bin} 执行失败（${result.code}）`, {
    bin,
    args,
    code: result.code,
  });
}

function openerFor(platform, url) {
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  if (platform === "darwin") return ["open", [url]];
  return ["xdg-open", [url]];
}

function assertGitHubUrl(url) {
  const fail = () => {
    throw new GhError("denied", "只允许打开以 https://github.com/ 开头的链接");
  };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail();
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") fail();
  // Windows 走 cmd /c start，参数会被 cmd 二次解析；只放行 URL 安全字符。
  if (/[&|^<>"\s]/.test(parsed.href)) fail();
  return parsed.href;
}

export function createExec({
  invoke = defaultInvoke,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  platform = detectPlatform(),
  concurrency = GH_CONCURRENCY,
  timeoutMs = GH_TIMEOUT_MS,
} = {}) {
  const limiter = createLimiter(concurrency);
  const stats = { calls: 0 };
  const runRaw = (bin, args, timeout) =>
    invokeOnce({ invoke, bin, args, timeoutMs: timeout, limiter, stats });

  async function runGh(args, { retry = true } = {}) {
    assertReadOnlyArgs(args);
    let rateRetried = false;
    let networkRetries = 0;
    for (;;) {
      const result = await runRaw("gh", args, timeoutMs);
      if (result.code === 0) return result;
      const error = failureOf(result, "gh", args);
      if (!retry) throw error;
      if (error.kind === "rate_limit" && !rateRetried) {
        rateRetried = true;
        await sleep(1500);
        continue;
      }
      // 只读请求遇到 EOF / 连接重置时重试；本机链路在并发下会丢连接。
      if (error.kind === "network" && networkRetries < 2) {
        networkRetries += 1;
        await sleep(800 * networkRetries);
        continue;
      }
      throw error;
    }
  }

  async function runGit(args) {
    assertGitArgs(args);
    const result = await runRaw("git", args, GIT_TIMEOUT_MS);
    if (result.code !== 0) throw failureOf(result, "git", args);
    return result;
  }

  /** worktree 有没有未提交 / 未跟踪的改动；读不出来按“有改动”处理，宁可不删。 */
  async function isDirty(path) {
    const absolute = typeof path === "string" && (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path));
    if (!absolute) return true;
    try {
      // --ignore-submodules=none：不让仓库里的 .gitmodules 把子模块改动藏起来。
      const result = await runGit(["-C", path, "status", "--porcelain", "--ignore-submodules=none"]);
      return result.stdout.trim().length > 0;
    } catch {
      return true;
    }
  }

  async function openUrl(url) {
    const href = assertGitHubUrl(url);
    const [bin, args] = openerFor(platform, href);
    const result = await runRaw(bin, args, GIT_TIMEOUT_MS);
    if (result.code !== 0) {
      throw new GhError("other", `无法打开浏览器：${result.stderr || result.code}`, { url });
    }
    return true;
  }

  return { runGh, runGit, isDirty, openUrl, stats };
}

/** 把 GhError 变成用户可读提示。 */
export function describeGhError(error) {
  const kind = error?.kind || classifyFailure(error?.message);
  switch (kind) {
    case "missing":
      return "没有找到 gh CLI。请先安装 GitHub CLI（https://cli.github.com），然后重启客户端。";
    case "auth":
      return "gh 未登录。请在终端执行 `gh auth login`，完成后点「同步」。";
    case "rate_limit":
      return "gh 触发了 GitHub 限流。已自动重试一次；稍后再试，或把同步间隔调大。";
    case "network":
      return "连接 GitHub 失败（网络或代理问题）。检查网络后点「同步」重试。";
    case "denied":
      return error?.message || "操作被只读白名单拒绝。";
    default:
      return error?.message ? `gh 执行失败：${error.message.slice(0, 300)}` : "gh 执行失败。";
  }
}
