import test from "node:test";
import assert from "node:assert/strict";
import { bindCandidates, linkPr, linkSource, wtFor } from "../src/domain/link.js";
import { DEFAULT_RULES } from "../src/constants.js";
import { makePr, NOW } from "./helpers.js";

const rules = (over = {}) => ({ ...DEFAULT_RULES, ...over });
const prs = [
  makePr({ number: 1, repo: "desktop", owner: "acme", author: "alice" }),
  makePr({ number: 2, repo: "desktop", owner: "acme", author: "bob" }),
  makePr({ number: 3, repo: "other", owner: "acme", author: "carol" }),
].map((p) => ({ ...p, repoSlug: `${p.owner}/${p.repo}`, headRefName: `feat/${p.number}` }));

const wts = [
  { workspaceId: "wt-host", repo: "acme/desktop", branch: "pr-1-111", prNumber: 1, name: "pr-1-111" },
  { workspaceId: "wt-branch", repo: "acme/desktop", branch: "feat/2", prNumber: null, name: "feat/2" },
  { workspaceId: "wt-free", repo: "acme/desktop", branch: "scratch", prNumber: null, name: "scratch" },
  { workspaceId: "wt-other", repo: "acme/other", branch: "feat/3", prNumber: null, name: "feat/3" },
];

test("手动绑定优先于 PR 号和分支名", () => {
  const ctx = { prs, bindings: { [prs[2].key]: "wt-host" }, rules: rules() };
  assert.equal(linkPr(wts[0], ctx).key, prs[2].key);
});

test("客户端记录的 PR 号优先于分支名", () => {
  const ctx = { prs, bindings: {}, rules: rules() };
  assert.equal(linkPr(wts[0], ctx).number, 1);
});

test("分支名一致可匹配；已手动绑定到别处的 PR 不再按分支匹配", () => {
  const ctx = { prs, bindings: {}, rules: rules() };
  assert.equal(linkPr(wts[1], ctx).number, 2);
  const bound = { prs, bindings: { [prs[1].key]: "wt-free" }, rules: rules() };
  assert.equal(linkPr(wts[1], bound), null);
  assert.equal(linkPr(wts[2], bound).number, 2);
});

test("开关关闭后不再按 PR 号 / 分支匹配", () => {
  const ctx = { prs, bindings: {}, rules: rules({ linkByPr: false, linkByBranch: false }) };
  assert.equal(linkPr(wts[0], ctx), null);
  assert.equal(linkPr(wts[1], ctx), null);
});

test("仓库不同不匹配", () => {
  const ctx = { prs, bindings: {}, rules: rules() };
  assert.equal(linkPr(wts[3], ctx).number, 3);
  assert.equal(linkPr({ ...wts[3], branch: "feat/1" }, ctx), null);
});

test("wtFor：手动绑定 > 自动匹配", () => {
  const ctx = { wts, prs, bindings: {}, rules: rules() };
  assert.equal(wtFor(prs[0], ctx).workspaceId, "wt-host");
  assert.equal(wtFor(prs[2], ctx).workspaceId, "wt-other");
  const manual = { wts, prs, bindings: { [prs[0].key]: "wt-free" }, rules: rules() };
  assert.equal(wtFor(prs[0], manual).workspaceId, "wt-free");
});

test("bindCandidates：排序 空闲 → 已对应其他 → 当前 → 宿主创建", () => {
  const ctx = { wts, prs, bindings: {}, rules: rules() };
  const cands = bindCandidates(prs[0], ctx);
  assert.deepEqual(
    cands.map((c) => [c.wt.workspaceId, c.state, c.disabled]),
    [
      ["wt-free", "free", false],
      ["wt-branch", "taken", false],
      ["wt-host", "current", true],
    ],
  );
  assert.match(cands[0].text, /空闲/);
  assert.match(cands[1].text, /#2/);
  assert.match(cands[2].text, /当前/);
});

test("bindCandidates：客户端从其他 PR 创建的不可选", () => {
  const ctx = { wts, prs, bindings: {}, rules: rules() };
  const cands = bindCandidates(prs[1], ctx);
  const host = cands.find((c) => c.wt.workspaceId === "wt-host");
  assert.equal(host.state, "host");
  assert.equal(host.disabled, true);
});

test("linkSource 文案", () => {
  assert.equal(linkSource(wts[0], prs[0], {}), "客户端从 PR 创建");
  assert.equal(linkSource(wts[1], prs[1], {}), "分支名与 PR 一致");
  assert.equal(linkSource(wts[0], prs[0], { [prs[0].key]: "wt-host" }), "你手动绑定");
});

test("newBranchName：pr-<n>-<三位随机>", async () => {
  const { newBranchName } = await import("../src/domain/link.js");
  assert.equal(newBranchName({ number: 7 }, () => 0.123), "pr-7-123");
  assert.match(newBranchName({ number: 9 }), /^pr-9-\d{3}$/);
});
