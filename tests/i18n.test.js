import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DEFS } from "../src/constants.js";
import { DEFAULT_DEFS_EN, createT, isEnglish } from "../src/i18n.js";

test("createT：zh 走中文，其余走英文", () => {
  assert.equal(createT("zh-CN")("中文", "English"), "中文");
  assert.equal(createT("en")("中文", "English"), "English");
  assert.equal(createT("ko")("中文", "English"), "English");
  assert.equal(isEnglish("zh-TW"), false);
});

test("localeDefsFor：默认表随语言双向翻转，用户改过则保持", async () => {
  const { localeDefsFor } = await import("../src/main.js");
  assert.deepEqual(localeDefsFor({ ...DEFAULT_DEFS }, "en"), DEFAULT_DEFS_EN);
  assert.deepEqual(localeDefsFor({ ...DEFAULT_DEFS_EN }, "zh-CN"), DEFAULT_DEFS);
  assert.equal(localeDefsFor({ ...DEFAULT_DEFS }, "zh-CN"), null);
  const custom = {
    ...DEFAULT_DEFS,
    needs_review: { ...DEFAULT_DEFS.needs_review, label: "我看看" },
  };
  assert.equal(localeDefsFor(custom, "en"), null);
});
