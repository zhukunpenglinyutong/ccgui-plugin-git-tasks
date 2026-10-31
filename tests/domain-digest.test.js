import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDigestPost,
  cleanTitle,
  errorCategory,
  postToText,
  diffDigest,
  digestSnapshot,
  fitDigestPost,
  isQuietHour,
  postBytes,
  slotKey,
} from "../src/domain/digest.js";
import { selectRows } from "../src/domain/stats.js";
import { DEFAULT_DEFS, DEFAULT_RULES } from "../src/constants.js";
import { createT } from "../src/i18n.js";
import { makePr, NOW } from "./helpers.js";

const t = createT("zh-CN");
const REPOS = [
  { slug: "acme/desktop", enabled: true, available: true },
  { slug: "acme/web", enabled: true, available: true },
  { slug: "acme/off", enabled: false, available: true },
];
const pr = (n, repo = "desktop", extra = {}) => makePr({ number: n, repo, owner: "acme", ...extra });
const rowsOf = (prs) =>
  selectRows(prs, { rules: DEFAULT_RULES, meSet: new Set(["me"]), wts: [], bindings: {}, now: NOW });

test("整点槽位与静默时段（跨午夜）", () => {
  assert.equal(slotKey(new Date(2026, 9, 30, 9, 59).getTime()), "2026-10-30T09");
  assert.equal(slotKey(new Date(2026, 9, 30, 10, 0).getTime()), "2026-10-30T10");
  const cfg = { quiet: true, quietStart: 22, quietEnd: 8 };
  assert.equal(isQuietHour(new Date(2026, 9, 30, 23, 0).getTime(), cfg), true);
  assert.equal(isQuietHour(new Date(2026, 9, 30, 7, 59).getTime(), cfg), true);
  assert.equal(isQuietHour(new Date(2026, 9, 30, 8, 0).getTime(), cfg), false);
  assert.equal(isQuietHour(new Date(2026, 9, 30, 23, 0).getTime(), { ...cfg, quiet: false }), false);
  const day = { quiet: true, quietStart: 12, quietEnd: 14 };
  assert.equal(isQuietHour(new Date(2026, 9, 30, 13, 0).getTime(), day), true);
  assert.equal(isQuietHour(new Date(2026, 9, 30, 14, 0).getTime(), day), false);
  assert.equal(isQuietHour(new Date(2026, 9, 30, 3, 0).getTime(), { quiet: true, quietStart: 5, quietEnd: 5 }), false);
});

test("快照：只收启用仓库；没有 PR 的启用仓库也占位", () => {
  const snap = digestSnapshot(rowsOf([pr(1), pr(2, "off")]), REPOS);
  assert.deepEqual(Object.keys(snap).sort(), ["acme/desktop", "acme/web"]);
  assert.equal(snap["acme/desktop"]["acme/desktop#1"].s, "needs_review");
  assert.deepEqual(snap["acme/web"], {});
});

test("比对：首次 = initial；无变化 = 不发", () => {
  const snap = digestSnapshot(rowsOf([pr(1)]), REPOS);
  assert.equal(diffDigest(null, snap, {}).initial, true);
  assert.equal(diffDigest(null, snap, {}).hasChanges, true);
  const same = diffDigest({ repos: snap, errors: {} }, snap, {});
  assert.equal(same.hasChanges, false);
});

test("比对：新增、状态变化、合并；消失的 PR 不报", () => {
  const before = digestSnapshot(rowsOf([pr(1), pr(2), pr(3)]), REPOS);
  const after = digestSnapshot(
    rowsOf([
      pr(1, "desktop", { reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 1000 }] }),
      pr(2, "desktop", { state: "MERGED", timeline: [{ type: "merged", at: NOW - 500 }] }),
      pr(4),
    ]),
    REPOS,
  );
  const diff = diffDigest({ repos: before, errors: {} }, after, {});
  assert.equal(diff.hasChanges, true);
  const list = diff.changes["acme/desktop"];
  const byNum = Object.fromEntries(list.map((c) => [c.n, c]));
  assert.equal(byNum[4].kind, "new");
  assert.equal(byNum[1].from, "needs_review");
  assert.equal(byNum[1].to, "changes_requested");
  assert.equal(byNum[2].to, "merged");
  assert.equal(byNum[3], undefined);
  assert.equal(list[0].n, 4, "新增排在前面");
});

test("比对：新启用的仓库只提示开始跟踪，不把它的 PR 全当新增", () => {
  const before = { repos: { "acme/desktop": {} }, errors: {} };
  const after = digestSnapshot(rowsOf([pr(1, "web"), pr(2, "web")]), REPOS);
  const diff = diffDigest(before, after, {});
  assert.deepEqual(diff.newRepos, ["acme/web"]);
  assert.equal(diff.changes["acme/web"], undefined);
  assert.equal(diff.hasChanges, true);
});

test("比对：同步错误出现 / 恢复各提醒一次，同一错误不重复", () => {
  const snap = digestSnapshot(rowsOf([pr(1)]), REPOS);
  const err = { "acme/desktop": "gh 未登录" };
  assert.equal(diffDigest({ repos: snap, errors: {} }, snap, err).hasChanges, true);
  assert.equal(diffDigest({ repos: snap, errors: err }, snap, err).hasChanges, false);
  assert.equal(diffDigest({ repos: snap, errors: err }, snap, {}).hasChanges, true);
});

function texts(post) {
  const body = post.content.post.zh_cn;
  return [body.title, ...body.content.map((line) => line.map((el) => el.text).join(""))];
}

test("消息：每个仓库未合并数 + 状态分布 + 变化，链接走 a 标签不做 markdown", () => {
  const before = digestSnapshot(rowsOf([pr(1), pr(2)]), REPOS);
  const prs = [
    pr(1, "desktop", { title: "修复 *登录* [bug] <script>", reviews: [{ state: "CHANGES_REQUESTED", at: NOW - 1000 }] }),
    pr(2),
    pr(5),
    pr(9, "web"),
  ];
  const current = digestSnapshot(rowsOf(prs), REPOS);
  const diff = diffDigest({ repos: before, errors: {} }, current, {});
  const post = buildDigestPost({ current, diff, errors: {}, defs: DEFAULT_DEFS, repos: REPOS, now: NOW, t, locale: "zh-CN" });
  assert.equal(post.msg_type, "post");
  const lines = texts(post);
  assert.match(lines[0], /Git 任务汇总 · 15:40/);
  assert.ok(lines.some((l) => /acme\/desktop · 未合并 3/.test(l)));
  assert.ok(lines.some((l) => /待审查 2 · 待修复 1/.test(l)));
  assert.ok(lines.some((l) => /acme\/web · 未合并 1/.test(l)));
  assert.ok(lines.some((l) => /#1 修复 \*登录\* \[bug\] <script>：待审查 → 待修复/.test(l)));
  assert.ok(lines.some((l) => /#5 .*：新增 · 待审查/.test(l)));
  const link = post.content.post.zh_cn.content.flat().find((el) => el.tag === "a");
  assert.match(link.href, /^https:\/\/github\.com\/acme\/desktop\/pull\//);
});

test("消息：首次汇总不列变化；同步失败写原因", () => {
  const current = digestSnapshot(rowsOf([pr(1)]), REPOS);
  const diff = diffDigest(null, current, { "acme/web": "连接 GitHub 失败" });
  const post = buildDigestPost({ current, diff, errors: { "acme/web": "连接 GitHub 失败" }, defs: DEFAULT_DEFS, repos: REPOS, now: NOW, t, locale: "zh-CN" });
  const lines = texts(post);
  assert.match(lines[0], /首次/);
  assert.ok(lines.some((l) => /同步失败：连接 GitHub 失败/.test(l)));
  assert.ok(!lines.some((l) => /新增 ·/.test(l)));
});

test("消息：英文环境走 en_us", () => {
  const current = digestSnapshot(rowsOf([pr(1)]), REPOS);
  const post = buildDigestPost({
    current,
    diff: diffDigest(null, current, {}),
    errors: {},
    defs: DEFAULT_DEFS,
    repos: REPOS,
    now: NOW,
    t: createT("en"),
    locale: "en",
  });
  assert.ok(post.content.post.en_us);
  assert.match(post.content.post.en_us.title, /Git tasks digest/);
});

test("消息：超出体积时逐级减少每仓库列出的变化条数", () => {
  const many = Array.from({ length: 120 }, (_, i) => pr(i + 1, "desktop", { title: "很长的标题".repeat(12) }));
  const current = digestSnapshot(rowsOf(many), REPOS);
  const diff = diffDigest({ repos: { "acme/desktop": {}, "acme/web": {} }, errors: {} }, current, {});
  const args = { current, diff, errors: {}, defs: DEFAULT_DEFS, repos: REPOS, now: NOW, t, locale: "zh-CN" };
  const post = fitDigestPost(args, 4000);
  assert.ok(postBytes(post) <= 4000, `bytes ${postBytes(post)}`);
  assert.ok(texts(post).some((l) => /还有 \d+ 条变化/.test(l)));
});

test("标题去掉双向控制符与换行；错误只发类别不发原始输出", () => {
  assert.equal(cleanTitle("ok\u202e：已通过 → 可合并\nx"), "ok ：已通过 → 可合并 x");
  assert.equal([...cleanTitle("长".repeat(80))].length, 60);
  assert.equal(errorCategory("gh 执行失败：/Users/alice/secret/path not found"), "gh 执行失败");
  assert.equal(errorCategory("gh 未登录。请在终端执行 `gh auth login`"), "gh 未登录。请在终端执行 `gh auth login`");
});

test("消息：仓库很多时按仓库截断兜底", () => {
  const repos = Array.from({ length: 300 }, (_, i) => ({ slug: `acme/repo-${i}`, enabled: true, available: true }));
  const current = Object.fromEntries(repos.map((r) => [r.slug, {}]));
  const diff = diffDigest(null, current, {});
  const post = fitDigestPost({ current, diff, errors: {}, defs: DEFAULT_DEFS, repos, now: NOW, t, locale: "zh-CN" }, 4000);
  assert.ok(postBytes(post) <= 4000, `bytes ${postBytes(post)}`);
  assert.ok(texts(post).some((l) => /还有 \d+ 个仓库/.test(l)));
});

/** 飞书官方文档：post 段落是非空数组；text 只有 text / un_escape，a 只有 text / href。 */
function assertFeishuPostSchema(post) {
  assert.equal(post.msg_type, "post");
  const langs = Object.values(post.content.post);
  assert.ok(langs.length >= 1);
  for (const body of langs) {
    assert.equal(typeof body.title, "string");
    assert.ok(Array.isArray(body.content) && body.content.length > 0);
    for (const para of body.content) {
      assert.ok(Array.isArray(para) && para.length > 0, "段落不能为空数组");
      for (const el of para) {
        if (el.tag === "text") {
          assert.deepEqual(Object.keys(el).sort(), ["tag", "text"], `text 只允许 tag/text：${JSON.stringify(el)}`);
          assert.ok(typeof el.text === "string" && el.text.trim().length > 0, "text 不能为空");
        } else if (el.tag === "a") {
          assert.deepEqual(Object.keys(el).sort(), ["href", "tag", "text"]);
          assert.ok(el.text.trim().length > 0);
          assert.match(el.href, /^https:\/\/github\.com\//);
        } else {
          assert.fail(`不支持的 tag：${el.tag}`);
        }
      }
    }
  }
}

test("消息结构严格符合飞书文档：无 style、无空 text、无空段落", () => {
  const before = digestSnapshot(rowsOf([pr(1), pr(2)]), REPOS);
  const current = digestSnapshot(
    rowsOf([pr(1, "desktop", { reviews: [{ state: "APPROVED", at: NOW - 1000 }] }), pr(2), pr(5), pr(9, "web")]),
    REPOS,
  );
  const errors = { "acme/web": "连接 GitHub 失败", "*": "gh 未登录" };
  const cases = [
    buildDigestPost({ current, diff: diffDigest(null, current, {}), errors: {}, defs: DEFAULT_DEFS, repos: REPOS, now: NOW, t, locale: "zh-CN" }),
    buildDigestPost({ current, diff: diffDigest({ repos: before, errors: {} }, current, errors), errors, defs: DEFAULT_DEFS, repos: REPOS, now: NOW, t, locale: "zh-CN" }),
    buildDigestPost({ current, diff: diffDigest(null, current, {}), errors: {}, defs: DEFAULT_DEFS, repos: REPOS, now: NOW, t: createT("en"), locale: "en", test: true }),
    fitDigestPost({ current, diff: diffDigest({ repos: { "acme/desktop": {}, "acme/web": {} }, errors: {} }, current, {}), errors: {}, defs: DEFAULT_DEFS, repos: REPOS, now: NOW, t, locale: "zh-CN" }, 600),
  ];
  for (const post of cases) assertFeishuPostSchema(post);
});

test("富文本被拒时的纯文本版本：标题 + 每段一行，链接写成「文字 网址」", () => {
  const before = digestSnapshot(rowsOf([pr(1)]), REPOS);
  const current = digestSnapshot(rowsOf([pr(1, "desktop", { reviews: [{ state: "APPROVED", at: NOW - 1000 }] })]), REPOS);
  const post = buildDigestPost({ current, diff: diffDigest({ repos: before, errors: {} }, current, {}), errors: {}, defs: DEFAULT_DEFS, repos: REPOS, now: NOW, t, locale: "zh-CN" });
  const plain = postToText(post);
  assert.equal(plain.msg_type, "text");
  const lines = plain.content.text.split("\n");
  assert.match(lines[0], /^Git 任务汇总 · 15:40$/);
  assert.ok(lines.some((l) => /#1 .* https:\/\/github\.com\/acme\/desktop\/pull\/1：待审查 → 已通过/.test(l)), plain.content.text);
});
