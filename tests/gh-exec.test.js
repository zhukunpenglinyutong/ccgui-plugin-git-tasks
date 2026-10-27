import test from "node:test";
import assert from "node:assert/strict";
import {
  assertGitArgs,
  assertReadOnlyArgs,
  classifyFailure,
  createExec,
  GhError,
} from "../src/gh/exec.js";

const ok = (stdout = "{}") => ({ code: 0, stdout, stderr: "" });

test("只读白名单：允许 graphql / user / pr list / auth status", () => {
  assert.doesNotThrow(() =>
    assertReadOnlyArgs(["api", "graphql", "-f", "query=query { viewer { login } }"]),
  );
  assert.doesNotThrow(() => assertReadOnlyArgs(["api", "user", "--jq", ".login"]));
  assert.doesNotThrow(() => assertReadOnlyArgs(["pr", "list", "-R", "a/b"]));
  assert.doesNotThrow(() => assertReadOnlyArgs(["auth", "status"]));
});

test("只读白名单：拒绝 mutation 与其它子命令", () => {
  assert.throws(
    () => assertReadOnlyArgs(["api", "graphql", "-f", "query=mutation { x }"]),
    /只允许只读/,
  );
  assert.throws(() => assertReadOnlyArgs(["pr", "create"]), /只读/);
  assert.throws(() => assertReadOnlyArgs(["api", "repos/a/b"]), /只读/);
  assert.throws(() => assertReadOnlyArgs(["repo", "delete"]), /只读/);
});

test("git 只允许 remote get-url", () => {
  assert.doesNotThrow(() => assertGitArgs(["-C", "/tmp/repo", "remote", "get-url", "origin"]));
  assert.throws(() => assertGitArgs(["-C", "/tmp/repo", "push"]), /remote get-url/);
  assert.throws(() => assertGitArgs(["remote", "get-url", "origin"]), /remote get-url/);
});

test("错误分类", () => {
  assert.equal(classifyFailure("gh: command not found"), "missing");
  assert.equal(classifyFailure("To get started with GitHub CLI, please run: gh auth login"), "auth");
  assert.equal(classifyFailure("HTTP 401: Bad credentials"), "auth");
  assert.equal(classifyFailure("API rate limit exceeded for user"), "rate_limit");
  assert.equal(classifyFailure("You have exceeded a secondary rate limit"), "rate_limit");
  assert.equal(classifyFailure("Could not resolve host: api.github.com"), "network");
  assert.equal(classifyFailure("dial tcp: connection reset by peer"), "network");
  assert.equal(classifyFailure("something exploded"), "other");
});

test("限流时退避重试一次后成功", async () => {
  let calls = 0;
  const sleeps = [];
  const exec = createExec({
    invoke: async () => {
      calls += 1;
      if (calls === 1) return { code: 1, stdout: "", stderr: "API rate limit exceeded" };
      return ok('{"ok":1}');
    },
    sleep: async (ms) => sleeps.push(ms),
  });
  const result = await exec.runGh(["api", "user", "--jq", ".login"]);
  assert.equal(result.stdout, '{"ok":1}');
  assert.equal(calls, 2);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 1000);
});

test("限流重试后仍失败 → GhError(rate_limit)", async () => {
  let calls = 0;
  const exec = createExec({
    invoke: async () => {
      calls += 1;
      return { code: 1, stdout: "", stderr: "API rate limit exceeded" };
    },
    sleep: async () => {},
  });
  await assert.rejects(
    () => exec.runGh(["api", "user"]),
    (error) => error instanceof GhError && error.kind === "rate_limit",
  );
  assert.equal(calls, 2);
});

test("invoke 抛错也归类", async () => {
  const exec = createExec({
    invoke: async () => {
      throw new Error("spawn gh ENOENT");
    },
    sleep: async () => {},
  });
  await assert.rejects(
    () => exec.runGh(["api", "user"]),
    (error) => error instanceof GhError && error.kind === "missing",
  );
});

test("并发上限 2", async () => {
  let active = 0;
  let peak = 0;
  const exec = createExec({
    invoke: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return ok();
    },
    sleep: async () => {},
    concurrency: 2,
  });
  await Promise.all(
    Array.from({ length: 6 }, () => exec.runGh(["api", "user"])),
  );
  assert.equal(peak, 2);
});

test("openUrl 只接受 github https 链接", async () => {
  const calls = [];
  const exec = createExec({
    invoke: async (command, payload) => {
      calls.push(payload);
      return ok();
    },
    sleep: async () => {},
    platform: "darwin",
  });
  await exec.openUrl("https://github.com/acme/desktop/pull/1");
  assert.deepEqual(calls[0], { bin: "open", args: ["https://github.com/acme/desktop/pull/1"], timeoutMs: 15000 });
  await assert.rejects(() => exec.openUrl("javascript:alert(1)"), /只允许打开/);
  await assert.rejects(() => exec.openUrl("https://evil.example/pull/1"), /只允许打开/);
});

test("openUrl 在 Linux / Windows 用对应打开器", async () => {
  const calls = [];
  const mk = (platform) =>
    createExec({
      invoke: async (_command, payload) => {
        calls.push(payload);
        return ok();
      },
      sleep: async () => {},
      platform,
    });
  await mk("linux").openUrl("https://github.com/a/b/pull/2");
  assert.equal(calls[0].bin, "xdg-open");
  await mk("win32").openUrl("https://github.com/a/b/pull/2");
  assert.equal(calls[1].bin, "cmd");
  assert.deepEqual(calls[1].args.slice(0, 3), ["/c", "start", ""]);
});

test("只读白名单：拒绝可写/交互参数与多条 query", () => {
  assert.throws(
    () => assertReadOnlyArgs(["api", "graphql", "-F", "query=@file.graphql"]),
    /只读白名单/,
  );
  assert.throws(
    () => assertReadOnlyArgs(["api", "graphql", "-f", "query=query{x}", "--input", "/tmp/q"]),
    /只读白名单/,
  );
  assert.throws(
    () => assertReadOnlyArgs(["api", "graphql", "-f", "query=query{x}", "-f", "query=query{y}"]),
    /一条 GraphQL query/,
  );
  assert.throws(() => assertReadOnlyArgs(["pr", "list", "--web"]), /只读白名单/);
  assert.throws(() => assertReadOnlyArgs(["pr", "list", "--state", "open", "--head", "x"]), /pr list/);
  assert.doesNotThrow(() => assertReadOnlyArgs(["pr", "list", "-R", "a/b", "--state", "all", "--jq", "."]));
});

test("openUrl：拒绝含 cmd 元字符的 URL，并对合法链接做规范化", async () => {
  const calls = [];
  const exec = createExec({
    invoke: async (_command, payload) => {
      calls.push(payload);
      return ok();
    },
    sleep: async () => {},
    platform: "win32",
  });
  await assert.rejects(
    () => exec.openUrl("https://github.com/a/b/pull/2?x=1&y=2"),
    /只允许打开/,
  );
  await exec.openUrl("https://github.com/a/b/pull/2#frag");
  assert.deepEqual(calls[0].args, ["/c", "start", "", "https://github.com/a/b/pull/2#frag"]);
});

test("默认串行：未显式给并发时同时只有一个 gh 进程", async () => {
  let active = 0;
  let peak = 0;
  const exec = createExec({
    invoke: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return ok();
    },
    sleep: async () => {},
  });
  await Promise.all(Array.from({ length: 3 }, () => exec.runGh(["api", "user"])));
  assert.equal(peak, 1);
});

test("网络 EOF 自动重试两次后成功", async () => {
  let calls = 0;
  const sleeps = [];
  const exec = createExec({
    invoke: async () => {
      calls += 1;
      if (calls < 3) return { code: 1, stdout: "", stderr: 'Post "https://api.github.com/graphql": EOF' };
      return ok('{"ok":1}');
    },
    sleep: async (ms) => sleeps.push(ms),
  });
  const result = await exec.runGh(["api", "graphql", "-f", "query=query{viewer{login}}"]);
  assert.equal(result.stdout, '{"ok":1}');
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [800, 1600]);
});

test("网络错误重试耗尽后抛旧错误", async () => {
  const exec = createExec({
    invoke: async () => ({ code: 1, stdout: "", stderr: "connection reset by peer" }),
    sleep: async () => {},
  });
  await assert.rejects(
    () => exec.runGh(["api", "user"]),
    (error) => error instanceof GhError && error.kind === "network",
  );
});
