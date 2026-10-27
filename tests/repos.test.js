import test from "node:test";
import assert from "node:assert/strict";
import { mapWorktrees, parseGitHubRemote, resolveWorkspaceRepos } from "../src/repos.js";

test("parseGitHubRemote：https / ssh / scp 三种写法", () => {
  assert.deepEqual(parseGitHubRemote("https://github.com/acme/desktop.git"), {
    owner: "acme",
    repo: "desktop",
    slug: "acme/desktop",
  });
  assert.deepEqual(parseGitHubRemote("git@github.com:acme/desktop.git"), {
    owner: "acme",
    repo: "desktop",
    slug: "acme/desktop",
  });
  assert.deepEqual(parseGitHubRemote("ssh://git@github.com/acme/desktop"), {
    owner: "acme",
    repo: "desktop",
    slug: "acme/desktop",
  });
  assert.equal(parseGitHubRemote("https://gitlab.com/acme/desktop.git"), null);
  assert.equal(parseGitHubRemote(""), null);
  assert.equal(parseGitHubRemote("git@github.com:only-owner"), null);
});

const workspaces = [
  { id: "w1", path: "/repo/a", name: "a", kind: undefined, parentId: undefined, lastOpenedAt: 3 },
  { id: "w2", path: "/repo/b", name: "b", kind: undefined, parentId: undefined, lastOpenedAt: 2 },
  { id: "w3", path: "/repo/c", name: "c", kind: undefined, parentId: undefined, lastOpenedAt: 1 },
  { id: "wt1", path: "/repo/a-wt", name: "pr-1", kind: "worktree", parentId: "w1" },
];

test("resolveWorkspaceRepos：origin 优先，其次 upstream，跳过 worktree，去重", async () => {
  const urls = {
    "/repo/a": { origin: "https://github.com/acme/desktop.git" },
    "/repo/b": {
      origin: "https://gitlab.com/acme/fork.git",
      upstream: "git@github.com:acme/desktop.git",
    },
    "/repo/c": { origin: "https://example.com/none.git" },
  };
  const runGit = async (args) => {
    const path = args[1];
    const remote = args[4];
    const url = urls[path]?.[remote];
    if (!url) throw new Error("no remote");
    return { code: 0, stdout: `${url}\n`, stderr: "" };
  };
  const repos = await resolveWorkspaceRepos(workspaces, { runGit });
  assert.deepEqual(repos, [
    { workspaceId: "w1", path: "/repo/a", name: "a", owner: "acme", repo: "desktop", slug: "acme/desktop" },
  ]);
});

test("resolveWorkspaceRepos：保留首次出现顺序，单仓库失败不影响其他", async () => {
  const runGit = async (args) => {
    if (args[1] === "/repo/b") throw new Error("boom");
    return { code: 0, stdout: "https://github.com/acme/other.git\n", stderr: "" };
  };
  const repos = await resolveWorkspaceRepos(workspaces, { runGit });
  assert.deepEqual(
    repos.map((r) => r.slug),
    ["acme/other"],
  );
});

test("mapWorktrees：只保留父工作区能映射到 GitHub 仓库的 worktree", () => {
  const repoByWorkspace = new Map([["w1", { slug: "acme/desktop" }]]);
  const wts = mapWorktrees(
    [
      ...workspaces,
      { id: "wt2", path: "/x", name: "x", kind: "worktree", parentId: "zzz", worktree: { branch: "feat/x" } },
    ],
    repoByWorkspace,
  );
  assert.deepEqual(wts, [
    {
      workspaceId: "wt1",
      parentWorkspaceId: "w1",
      path: "/repo/a-wt",
      name: "pr-1",
      repo: "acme/desktop",
      branch: "",
      prNumber: null,
      creating: false,
    },
  ]);
});

test("parseGitHubRemote：拒绝带元字符的 owner/repo", () => {
  assert.equal(parseGitHubRemote("https://github.com/a&b/repo.git"), null);
  assert.equal(parseGitHubRemote("git@github.com:a/b c.git"), null);
  assert.equal(parseGitHubRemote("https://github.com/a/../b.git"), null);
  assert.deepEqual(parseGitHubRemote("https://github.com/a/b_c-d.e.git"), {
    owner: "a",
    repo: "b_c-d.e",
    slug: "a/b_c-d.e",
  });
});
