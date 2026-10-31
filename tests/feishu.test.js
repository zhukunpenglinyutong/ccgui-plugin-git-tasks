import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  classifyFeishuResult,
  describeFeishuFailure,
  maskWebhook,
  sendFeishu,
  signFeishu,
  validateSecret,
  validateWebhook,
} from "../src/notify/feishu.js";

const HOOK = "https://open.feishu.cn/open-apis/bot/v2/hook/1b2c3d4e-aaaa-bbbb-cccc-1234567890ab";

test("webhook 只接受 open.feishu.cn 的自定义机器人地址", () => {
  assert.equal(validateWebhook(HOOK).ok, true);
  assert.equal(validateWebhook(` ${HOOK} `).ok, true);
  assert.equal(validateWebhook("").ok, false);
  assert.equal(validateWebhook("http://open.feishu.cn/open-apis/bot/v2/hook/abcdefgh").ok, false);
  assert.equal(validateWebhook("https://evil.com/open-apis/bot/v2/hook/abcdefgh").ok, false);
  assert.equal(validateWebhook("https://open.feishu.cn.evil.com/open-apis/bot/v2/hook/abcdefgh").ok, false);
  assert.equal(validateWebhook("https://open.feishu.cn/open-apis/bot/v2/hook/abc?x=1").ok, false);
  assert.equal(validateWebhook("https://open.larksuite.com/open-apis/bot/v2/hook/abcdefgh").ok, false);
});

test("签名密钥：可空；不能有空白", () => {
  assert.equal(validateSecret("").ok, true);
  assert.equal(validateSecret("abcDEF123").ok, true);
  assert.equal(validateSecret("ab c").ok, false);
  assert.equal(validateSecret("x".repeat(200)).ok, false);
});

test("webhook 脱敏：只露出首尾 4 位 token", () => {
  const masked = maskWebhook(HOOK);
  assert.match(masked, /^https:\/\/open\.feishu\.cn\/…\/hook\/1b2c…90ab$/);
  assert.ok(!masked.includes("aaaa-bbbb"));
  assert.equal(maskWebhook(""), "");
});

test("签名与飞书文档算法一致：HmacSHA256(key=timestamp\\nsecret, msg=空) 的 base64", async () => {
  const expected = createHmac("sha256", "1700000000\nmysecret").update("").digest("base64");
  assert.equal(await signFeishu("mysecret", 1700000000), expected);
});

test("结果分类：成功 / 限流 / 签名 / 关键词 / IP / 服务端 / 网络", () => {
  assert.equal(classifyFeishuResult({ status: 200, body: '{"code":0,"msg":"success"}' }).kind, "ok");
  assert.equal(classifyFeishuResult({ status: 200, body: '{"StatusCode":0}' }).kind, "ok");
  assert.equal(classifyFeishuResult({ status: 200, body: '{"code":11232,"msg":"frequency limited"}' }).kind, "rate");
  assert.equal(classifyFeishuResult({ status: 429, body: "" }).kind, "rate");
  const sign = classifyFeishuResult({ status: 200, body: '{"code":19021,"msg":"sign match fail"}' });
  assert.equal(sign.kind, "sign");
  assert.equal(sign.fatal, true);
  assert.equal(classifyFeishuResult({ status: 200, body: '{"code":19024,"msg":"Key Words Not Found"}' }).kind, "keyword");
  assert.equal(classifyFeishuResult({ status: 200, body: '{"code":19022,"msg":"Ip Not Allowed"}' }).kind, "ip");
  assert.equal(classifyFeishuResult({ status: 200, body: '{"code":19001,"msg":"param invalid: incoming webhook access token invalid"}' }).fatal, true);
  assert.equal(classifyFeishuResult({ status: 502, body: "bad gateway" }).kind, "server");
  assert.equal(classifyFeishuResult({ status: 404, body: "" }).fatal, true);
  assert.equal(classifyFeishuResult({ status: 200, body: "<html>" }).kind, "server");
  assert.equal(classifyFeishuResult(null, new Error("request failed: timed out")).kind, "network");
  assert.equal(classifyFeishuResult(null, new Error("github-tasks: missing network grant for open.feishu.cn")).fatal, true);
});

test("失败文案不泄露 webhook token", () => {
  const msg = describeFeishuFailure({ kind: "network", message: `request failed: ${HOOK}` }, (zh) => zh);
  assert.ok(!msg.includes("1b2c3d4e-aaaa"));
  assert.match(describeFeishuFailure({ kind: "sign", message: "x" }, (zh) => zh), /签名|时间/);
});

function fakeInvoke(responses) {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { invoke, calls };
}

test("发送：带签名时 body 含 timestamp/sign；成功一次即返回", async () => {
  const { invoke, calls } = fakeInvoke([{ status: 200, body: '{"code":0}' }]);
  const result = await sendFeishu({ invoke, webhook: HOOK, secret: "s3", payload: { msg_type: "text", content: { text: "hi" } }, now: () => 1_700_000_000_000, sleep: async () => {} });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "plugin_http_request");
  assert.equal(calls[0].args.method, "POST");
  assert.equal(calls[0].args.headers["Content-Type"], "application/json; charset=utf-8");
  const body = JSON.parse(calls[0].args.body);
  assert.equal(body.timestamp, "1700000000");
  assert.equal(body.sign, createHmac("sha256", "1700000000\ns3").update("").digest("base64"));
  assert.equal(body.msg_type, "text");
});

test("发送：服务端 / 网络错误重试 2 次；配置错误不重试", async () => {
  const flaky = fakeInvoke([{ status: 502, body: "" }, new Error("request failed: reset"), { status: 200, body: '{"code":0}' }]);
  const ok = await sendFeishu({ invoke: flaky.invoke, webhook: HOOK, secret: "", payload: { msg_type: "text" }, sleep: async () => {} });
  assert.equal(ok.ok, true);
  assert.equal(flaky.calls.length, 3);
  assert.equal(JSON.parse(flaky.calls[0].args.body).sign, undefined);

  const down = fakeInvoke([{ status: 502, body: "" }, { status: 502, body: "" }, { status: 502, body: "" }]);
  const fail = await sendFeishu({ invoke: down.invoke, webhook: HOOK, secret: "", payload: {}, sleep: async () => {} });
  assert.equal(fail.ok, false);
  assert.equal(fail.kind, "server");
  assert.equal(down.calls.length, 3);

  const sign = fakeInvoke([{ status: 200, body: '{"code":19021,"msg":"sign match fail"}' }]);
  const bad = await sendFeishu({ invoke: sign.invoke, webhook: HOOK, secret: "x", payload: {}, sleep: async () => {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.fatal, true);
  assert.equal(sign.calls.length, 1);
});

test("发送：webhook 不合法时不发请求", async () => {
  const { invoke, calls } = fakeInvoke([]);
  const out = await sendFeishu({ invoke, webhook: "https://evil.com/x", secret: "", payload: {}, sleep: async () => {} });
  assert.equal(out.ok, false);
  assert.equal(out.fatal, true);
  assert.equal(calls.length, 0);
});

test("格式类拒绝（19002 / 9499）单独分类：是插件的问题，不是你的配置", () => {
  const fmt = classifyFeishuResult({ status: 200, body: '{"code":19002,"msg":"params error, unknown content value"}' });
  assert.equal(fmt.kind, "format");
  assert.equal(fmt.fatal, true);
  assert.equal(classifyFeishuResult({ status: 200, body: '{"code":9499,"msg":"Bad Request"}' }).kind, "format");
  assert.match(describeFeishuFailure(fmt, (zh) => zh), /格式/);
});
