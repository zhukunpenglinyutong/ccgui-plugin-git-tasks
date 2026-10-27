/** 工作区 → GitHub 仓库映射（git remote 解析，只读）。 */

const HOST = /(?:^|@|\/\/)github\.com[:/](.+)$/i;

export function parseGitHubRemote(raw) {
  const url = String(raw || "").trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!url) return null;
  const match = HOST.exec(url);
  if (!match) return null;
  const parts = match[1].split("/").filter(Boolean);
  if (parts.length < 2) return null;
  // GitHub owner/repo 只允许字母数字与 . _ -；收窄后 slug 才能安全进 argv / URL / 存储键。
  const NAME = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
  if (!NAME.test(parts[0]) || !NAME.test(parts[1])) return null;
  return { owner: parts[0], repo: parts[1], slug: `${parts[0]}/${parts[1]}` };
}

async function remoteUrl(runGit, path, remote) {
  try {
    const result = await runGit(["-C", path, "remote", "get-url", remote]);
    return String(result?.stdout || "").trim();
  } catch {
    return "";
  }
}

/** 侧栏普通工作区 → `[{workspaceId, path, name, owner, repo, slug}]`（去重、保留顺序）。 */
export async function resolveWorkspaceRepos(workspaces, { runGit }) {
  const repos = [];
  const seen = new Set();
  for (const ws of workspaces || []) {
    if (ws.kind === "worktree") continue;
    let parsed = null;
    for (const remote of ["origin", "upstream"]) {
      parsed = parseGitHubRemote(await remoteUrl(runGit, ws.path, remote));
      if (parsed) break;
    }
    if (!parsed || seen.has(parsed.slug)) continue;
    seen.add(parsed.slug);
    repos.push({
      workspaceId: ws.id,
      path: ws.path,
      name: ws.name,
      owner: parsed.owner,
      repo: parsed.repo,
      slug: parsed.slug,
    });
  }
  return repos;
}

/** worktree 子行 → 插件内部 worktree 对象（repo 用 slug 对齐 PR）。 */
export function mapWorktrees(workspaces, repoByWorkspaceId) {
  return (workspaces || [])
    .filter((ws) => ws.kind === "worktree")
    .map((ws) => {
      const repo = repoByWorkspaceId.get(ws.parentId);
      if (!repo) return null;
      return {
        workspaceId: ws.id,
        parentWorkspaceId: ws.parentId,
        path: ws.path,
        name: ws.name,
        repo: repo.slug,
        branch: ws.worktree?.branch || "",
        prNumber: ws.worktree?.prNumber ?? null,
        creating: false,
      };
    })
    .filter(Boolean);
}
