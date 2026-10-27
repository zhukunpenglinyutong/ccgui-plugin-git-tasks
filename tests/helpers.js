/** 测试夹具：本地时区的固定“现在”，以及归一化 PR 构造器。 */

export const NOW = new Date(2026, 9, 26, 15, 40).getTime();
export const DAY_MS = 24 * 60 * 60 * 1000;

export function makePr({
  author = "alice",
  number = 1,
  repo = "desktop-cc-gui",
  owner = "acme",
  title = "fix something",
  createdAt = NOW - 10 * DAY_MS,
  updatedAt = NOW - DAY_MS,
  isDraft = false,
  draftAtCreation = false,
  commits = [{ sha: "c0", at: NOW - 10 * DAY_MS }],
  reviews = [],
  comments = [],
  marks = [],
  timeline = [],
  requested = false,
  ignored = false,
  state = "OPEN",
} = {}) {
  const headSha = commits.length ? commits[commits.length - 1].sha : "c0";
  const events = [
    { type: "opened", at: createdAt, sha: commits[0]?.sha ?? "c0", draft: draftAtCreation },
    ...commits.map((c) => ({ type: "commit", at: c.at, sha: c.sha, merge: !!c.merge })),
    ...reviews.map((r) => ({
      type: "review",
      at: r.at,
      mine: r.mine ?? true,
      by: r.by ?? "me",
      state: r.state,
      sha: "sha" in r ? r.sha : headSha,
      comments: r.comments ?? 0,
    })),
    ...comments.map((c) => ({
      type: "comment",
      at: c.at,
      by: c.by ?? author,
      mine: !!c.mine,
      isAuthor: c.isAuthor ?? !c.mine,
    })),
    ...timeline.map((t) => ({ ...t })),
    ...marks.map((m) => ({
      type: "mark",
      at: m.at,
      verdict: m.verdict,
      via: m.via ?? "drag",
      sha: m.sha ?? headSha,
    })),
  ].sort((a, b) => a.at - b.at);
  return {
    key: `${owner}/${repo}#${number}`,
    owner,
    repo,
    repoSlug: `${owner}/${repo}`,
    headRefName: `feat/${number}`,
    number,
    title,
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
    author,
    headSha,
    commitShas: commits.map((c) => c.sha),
    isDraft,
    requested,
    ignored,
    state,
    createdAt,
    updatedAt,
    events,
  };
}
