/** 飞书每小时汇总（纯函数）：整点槽位、静默时段、状态快照、与上次已发送内容比对、
 *  组装飞书 post 消息并按体积裁剪。
 *
 * “重复就不发”的判断对象是**上次成功发出的快照**（baseline），不是上一个小时：
 * 中途跳过 / 发送失败的小时里发生的变化会累积到下一条，不会丢；
 * 状态 A→B→A 来回变也不会打扰你。停留时长这类每小时都变的文字不参与比对。
 */

import { FEISHU_MAX_BYTES, DIGEST_CHANGES_PER_REPO, STATUS_ORDER } from "../constants.js";
import { isEnglish } from "../i18n.js";

const pad = (n) => String(n).padStart(2, "0");
const ENDED = new Set(["merged", "closed"]);
const GITHUB_PR = /^https:\/\/github\.com\/[^\s]+$/;
// 标题由 PR 作者控制：去掉双向控制符与换行，免得伪造出一行“状态”。
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function cleanTitle(raw) {
  return [...String(raw || "").replace(UNSAFE_CHARS, " ")].slice(0, 60).join("");
}

/** 错误只发类别：原始 gh 输出可能带本机路径 / 用户名，不往群里发。 */
export function errorCategory(message) {
  const text = String(message || "");
  const cut = text.search(/[：:]/);
  const head = cut > 0 ? text.slice(0, cut) : text;
  return [...head].slice(0, 40).join("");
}

export function slotKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`;
}

/** 静默时段 [start, end)，start > end 表示跨午夜；start === end 视为不静默。 */
export function isQuietHour(ms, cfg) {
  if (!cfg?.quiet || cfg.quietStart === cfg.quietEnd) return false;
  const hour = new Date(ms).getHours();
  return cfg.quietStart > cfg.quietEnd
    ? hour >= cfg.quietStart || hour < cfg.quietEnd
    : hour >= cfg.quietStart && hour < cfg.quietEnd;
}

const liveRepos = (repos) => repos.filter((r) => r.enabled !== false && r.available !== false);

/** `{ [slug]: { [prKey]: { s 状态, n 编号, t 标题, u 链接 } } }`；启用但没有 PR 的仓库也占位。 */
export function digestSnapshot(rows, repos) {
  const out = Object.fromEntries(liveRepos(repos).map((r) => [r.slug, {}]));
  for (const { pr, d } of rows) {
    const bucket = out[pr.repoSlug];
    if (!bucket || pr.ignored) continue;
    bucket[pr.key] = {
      s: d.key,
      n: pr.number,
      t: cleanTitle(pr.title),
      u: GITHUB_PR.test(pr.url || "") ? pr.url : "",
    };
  }
  return out;
}

function sameErrors(a, b) {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

const changeOrder = (a, b) => (a.kind === b.kind ? b.n - a.n : a.kind === "new" ? -1 : 1);

function repoChanges(before, now) {
  const list = [];
  for (const [key, cur] of Object.entries(now)) {
    const prev = before[key];
    if (!prev) list.push({ key, ...cur, kind: "new", from: null, to: cur.s });
    else if (prev.s !== cur.s) list.push({ key, ...cur, kind: "status", from: prev.s, to: cur.s });
  }
  return list.sort(changeOrder);
}

/** 与上次已发送的基线比对。baseline 为 null 时是首次汇总。 */
export function diffDigest(baseline, current, errors) {
  if (!baseline) return { initial: true, hasChanges: true, changes: {}, newRepos: [], errorChanged: false };
  const changes = {};
  const newRepos = [];
  for (const [slug, prs] of Object.entries(current)) {
    const before = baseline.repos?.[slug];
    if (!before) {
      newRepos.push(slug);
      continue;
    }
    const list = repoChanges(before, prs);
    if (list.length) changes[slug] = list;
  }
  const errorChanged = !sameErrors(baseline.errors, errors);
  const hasChanges = Object.keys(changes).length > 0 || newRepos.length > 0 || errorChanged;
  return { initial: false, hasChanges, changes, newRepos, errorChanged };
}

// 只用飞书文档列出的字段：text 节点只有 tag / text（没有 style），段落里不放空 text。
const text = (value) => ({ tag: "text", text: value });

function statusLine(prs, defs) {
  const counts = {};
  for (const item of Object.values(prs)) {
    if (!ENDED.has(item.s)) counts[item.s] = (counts[item.s] || 0) + 1;
  }
  return STATUS_ORDER.filter((key) => counts[key])
    .map((key) => `${defs[key]?.label || key} ${counts[key]}`)
    .join(" · ");
}

const openCount = (prs) => Object.values(prs).filter((item) => !ENDED.has(item.s)).length;

function changeText(change, defs, t) {
  const label = (key) => defs[key]?.label || key;
  if (change.kind === "new") return `：${t("新增", "new")} · ${label(change.to)}`;
  if (ENDED.has(change.to)) return `：${label(change.to)}`;
  return `：${label(change.from)} → ${label(change.to)}`;
}

function changeLine(change, defs, t) {
  const title = `#${change.n} ${change.t}`;
  const head = change.u ? { tag: "a", text: title, href: change.u } : text(title);
  return [text("· "), head, text(changeText(change, defs, t))];
}

function repoBlock({ slug, prs, diff, errors, defs, t, perRepo }) {
  const lines = [[text(`■ ${slug} · ${t("未合并", "open")} ${openCount(prs)}`)]];
  const dist = statusLine(prs, defs);
  if (dist) lines.push([text(dist)]);
  if (errors[slug]) lines.push([text(`${t("同步失败", "Sync failed")}：${errorCategory(errors[slug])}`)]);
  if (diff.newRepos.includes(slug)) lines.push([text(t("开始跟踪这个仓库", "Now tracking this repository"))]);
  const changes = diff.changes[slug] || [];
  for (const change of changes.slice(0, perRepo)) lines.push(changeLine(change, defs, t));
  const rest = changes.length - Math.min(perRepo, changes.length);
  if (rest > 0) lines.push([text(t(`…还有 ${rest} 条变化`, `…${rest} more changes`))]);
  return lines;
}

function overview(current, defs, t) {
  const open = Object.values(current)
    .flatMap((prs) => Object.values(prs))
    .filter((item) => !ENDED.has(item.s));
  const by = (owner) => open.filter((item) => defs[item.s]?.owner === owner).length;
  const [me, author, merge] = [by("me"), by("author"), by("merge")];
  return t(
    `等我处理 ${me} · 等作者 ${author} · 等合并 ${merge} · 未合并共 ${open.length}`,
    `On me ${me} · on author ${author} · to merge ${merge} · open ${open.length}`,
  );
}

export function buildDigestPost({ current, diff, errors, defs, repos, now, t, locale, perRepo = DIGEST_CHANGES_PER_REPO, maxRepos = Infinity, test = false }) {
  const d = new Date(now);
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const suffix = test ? t("（测试）", " (test)") : diff.initial ? t("（首次）", " (first)") : "";
  const title = `${t("Git 任务汇总", "Git tasks digest")} · ${hhmm}${suffix}`;
  const content = [[text(overview(current, defs, t))]];
  const global = errors["*"];
  if (global) content.push([text(`${t("同步失败", "Sync failed")}：${errorCategory(global)}`)]);
  const shown = liveRepos(repos).filter((repo) => current[repo.slug]);
  for (const repo of shown.slice(0, maxRepos)) {
    content.push(...repoBlock({ slug: repo.slug, prs: current[repo.slug], diff, errors, defs, t, perRepo }));
  }
  const hidden = shown.length - Math.min(maxRepos, shown.length);
  if (hidden > 0) content.push([text(t(`…还有 ${hidden} 个仓库`, `…${hidden} more repositories`))]);
  const lang = isEnglish(locale) ? "en_us" : "zh_cn";
  return { msg_type: "post", content: { post: { [lang]: { title, content } } } };
}

/** 富文本被飞书拒收时的兜底：同样的内容发成纯文本，链接写成「文字 网址」。 */
export function postToText(post) {
  const body = Object.values(post.content.post)[0];
  const line = (para) => para.map((el) => (el.tag === "a" ? `${el.text} ${el.href}` : el.text)).join("");
  return { msg_type: "text", content: { text: [body.title, ...body.content.map(line)].join("\n") } };
}

export function postBytes(post) {
  return new TextEncoder().encode(JSON.stringify(post)).length;
}

/** 体积超限时逐级减少每个仓库列出的变化条数（飞书请求体约 20KB 上限）。 */
export function fitDigestPost(args, maxBytes = FEISHU_MAX_BYTES) {
  for (const perRepo of [DIGEST_CHANGES_PER_REPO, 8, 4, 2, 0]) {
    const post = buildDigestPost({ ...args, perRepo });
    if (postBytes(post) <= maxBytes) return post;
  }
  // 仓库太多：变化一条不列也超限，再按仓库截断。
  let maxRepos = Object.keys(args.current).length;
  let post = buildDigestPost({ ...args, perRepo: 0, maxRepos });
  while (maxRepos > 1 && postBytes(post) > maxBytes) {
    maxRepos = Math.floor(maxRepos / 2);
    post = buildDigestPost({ ...args, perRepo: 0, maxRepos });
  }
  return post;
}
