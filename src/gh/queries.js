/** gh 的查询文本与参数（只读）。
 *
 * 所有 GraphQL 结果都经 `--jq` 投影成紧凑数组：`plugin_exec_run` 每路输出
 * 只有 64KB，原始嵌套结构（nodes/commit/oid…）在几十个 PR 时会超限。
 */

export const VIEWER_ARGS = ["api", "user", "--jq", ".login"];

export const LIST_QUERY = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(states:OPEN, first:50, after:$after, orderBy:{field:UPDATED_AT,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number title url isDraft createdAt updatedAt additions deletions
        author{login} headRefName headRefOid baseRefName isCrossRepository
      }
    }
  }
}`;

export const LIST_JQ =
  '.data.repository.pullRequests | {page:.pageInfo, prs:[.nodes[]|[.number,.title,.url,.isDraft,.createdAt,.updatedAt,.additions,.deletions,.author.login,.headRefName,.headRefOid,.baseRefName,.isCrossRepository]]}';

const DETAIL_NODE = `reviews(last:50){nodes{author{login} state submittedAt commit{oid} comments{totalCount}}}
  commits(last:60){nodes{commit{oid committedDate parents{totalCount}}}}
  timelineItems(last:80, itemTypes:[READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, REVIEW_REQUESTED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, ISSUE_COMMENT]){
    nodes{
      __typename
      ... on ReadyForReviewEvent{createdAt}
      ... on ConvertToDraftEvent{createdAt}
      ... on ReviewRequestedEvent{createdAt actor{login} requestedReviewer{... on User{login}}}
      ... on HeadRefForcePushedEvent{createdAt afterCommit{oid}}
      ... on IssueComment{createdAt author{login}}
    }
  }`;

export const DETAIL_JQ =
  '[.data.repository|to_entries[]|select(.value != null)|{k:.key, r:[(.value.reviews.nodes // [])[]|[.author.login,.state,.submittedAt,(.commit.oid // ""),.comments.totalCount]], c:[(.value.commits.nodes // [])[]|[.commit.oid,.commit.committedDate,.commit.parents.totalCount]], t:[(.value.timelineItems.nodes // [])[]|[.__typename,.createdAt,(.actor.login // .author.login // ""),(.requestedReviewer.login // ""),(.afterCommit.oid // "")]]}]';

function splitSlug(slug) {
  const [owner, name] = String(slug).split("/");
  if (!owner || !name) throw new Error(`无效的仓库标识：${slug}`);
  return { owner, name };
}

export function listArgs(slug, after) {
  const { owner, name } = splitSlug(slug);
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${LIST_QUERY}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
  ];
  if (after) args.push("-f", `after=${after}`);
  args.push("--jq", LIST_JQ);
  return args;
}

/** 一批 PR 的详情（别名 p0…pN，控制单次输出体积）。 */
export function detailQuery(numbers) {
  const aliases = numbers
    .map((n, i) => `p${i}: pullRequest(number: ${Number(n)}){${DETAIL_NODE}}`)
    .join("\n");
  return `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){\n${aliases}\n}}`;
}

export function detailArgs(slug, numbers) {
  const { owner, name } = splitSlug(slug);
  return [
    "api",
    "graphql",
    "-f",
    `query=${detailQuery(numbers)}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "--jq",
    DETAIL_JQ,
  ];
}

/** 近 N 天创建量（含草稿 / 已结束），用于每日统计。`since` = YYYY-MM-DD。 */
const CREATED_JQ = "[.[]|[.number,.createdAt,.isDraft,.author.login]]";
const ENDED_JQ =
  "[.[]|[.number,.title,.url,.createdAt,.updatedAt,.isDraft,.author.login,.headRefName,.baseRefName,.mergedAt,.closedAt]]";

export function createdArgs(slug, since) {
  return prListArgs(slug, {
    state: "all",
    search: `created:>=${since}`,
    limit: 300,
    fields: ["number", "createdAt", "isDraft", "author"],
    jq: CREATED_JQ,
  });
}

export function mergedArgs(slug, since) {
  return prListArgs(slug, {
    state: "merged",
    search: `merged:>=${since}`,
    limit: 100,
    fields: ["number", "title", "url", "createdAt", "updatedAt", "isDraft", "author", "headRefName", "baseRefName", "mergedAt", "closedAt"],
    jq: ENDED_JQ,
  });
}

export function closedArgs(slug, since) {
  return prListArgs(slug, {
    state: "closed",
    search: `closed:>=${since}`,
    limit: 100,
    fields: ["number", "title", "url", "createdAt", "updatedAt", "isDraft", "author", "headRefName", "baseRefName", "mergedAt", "closedAt"],
    jq: ENDED_JQ,
  });
}

export function prListArgs(slug, { state, search, limit, fields, jq }) {
  const args = [
    "pr",
    "list",
    "-R",
    slug,
    "--state",
    state,
    "--search",
    search,
    "--limit",
    String(limit),
    "--json",
    fields.join(","),
  ];
  // gh pr list 的 --json 输出带缩进；64KB 上限下必须走 jq 紧凑投影。
  if (jq) args.push("--jq", jq);
  return args;
}
