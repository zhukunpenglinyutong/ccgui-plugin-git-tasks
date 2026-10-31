/** 飞书自定义机器人：地址校验、脱敏、签名、发送与结果分类。
 *  出网只走宿主 `plugin_http_request`，并受 manifest `network:open.feishu.cn` 约束。
 *  webhook 里的 token 等同密码：任何文案、错误信息都不带出完整地址。 */

const WEBHOOK = /^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/([A-Za-z0-9-]{8,128})$/;
const SECRET = /^[\x21-\x7e]{1,128}$/;
const RETRY_DELAYS = [3_000, 15_000];

export function validateWebhook(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: false, value, message: "empty" };
  if (!WEBHOOK.test(value)) return { ok: false, value, message: "format" };
  return { ok: true, value };
}

export function validateSecret(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: true, value };
  return SECRET.test(value) ? { ok: true, value } : { ok: false, value, message: "format" };
}

export function maskWebhook(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const token = WEBHOOK.exec(value)?.[1];
  if (!token) return "…";
  return `https://open.feishu.cn/…/hook/${token.slice(0, 4)}…${token.slice(-4)}`;
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 飞书签名：HmacSHA256，key = `${timestamp}\n${secret}`，消息为空，结果 base64。 */
export async function signFeishu(secret, timestampSec) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${timestampSec}\n${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new Uint8Array(0));
  return toBase64(new Uint8Array(signature));
}

export const redact = (text) => String(text || "").replace(/hook\/[A-Za-z0-9-]+/g, "hook/***").slice(0, 300);

// 19002 params error / 9499 Bad Request：消息格式不被接受，是插件的问题，不是你的配置。
const FATAL_CODES = { 19021: "sign", 19022: "ip", 19024: "keyword", 19002: "format", 9499: "format" };

function classifyBody(body) {
  let data;
  try {
    data = JSON.parse(body || "");
  } catch {
    return { kind: "server", retry: true, message: redact(body) };
  }
  const code = Number(data?.code ?? data?.StatusCode);
  const message = redact(data?.msg ?? data?.StatusMessage ?? "");
  if (code === 0) return { kind: "ok" };
  if (code === 11232) return { kind: "rate", retry: true, code, message };
  if (FATAL_CODES[code]) return { kind: FATAL_CODES[code], fatal: true, code, message };
  return { kind: "rejected", fatal: true, code, message };
}

/** `fatal` = 配置问题，重试没用；`retry` = 暂时性问题。 */
export function classifyFeishuResult(response, error) {
  if (error) {
    const message = redact(error?.message || error);
    if (/grant|permission|not allowed/i.test(message)) return { kind: "permission", fatal: true, message };
    return { kind: "network", retry: true, message };
  }
  const status = Number(response?.status) || 0;
  if (status === 429) return { kind: "rate", retry: true, message: "HTTP 429" };
  if (status >= 500 || status === 0) return { kind: "server", retry: true, message: `HTTP ${status}` };
  if (status >= 400) return { kind: "http", fatal: true, message: `HTTP ${status}` };
  return classifyBody(response?.body);
}

export function describeFeishuFailure(result, t) {
  const detail = result?.message ? `（${redact(result.message)}）` : "";
  switch (result?.kind) {
    case "invalid":
      return t("飞书 webhook 地址不正确，请在设置里重新填写", "Invalid Feishu webhook URL");
    case "sign":
      return t(
        `飞书签名校验失败：签名密钥不对，或本机时间与标准时间相差超过 1 小时${detail}`,
        `Feishu signature rejected: wrong secret or clock off by more than 1 hour${detail}`,
      );
    case "keyword":
      return t(
        `飞书机器人开启了「自定义关键词」，消息里没有命中关键词；可加入关键词“Git 任务汇总”${detail}`,
        `The bot requires keywords; add "Git tasks digest" as a keyword${detail}`,
      );
    case "ip":
      return t(`飞书机器人开启了 IP 白名单，本机 IP 不在名单内${detail}`, `This machine's IP is not whitelisted${detail}`);
    case "permission":
      return t(`插件缺少访问 open.feishu.cn 的授权${detail}`, `Missing network grant for open.feishu.cn${detail}`);
    case "format":
      return t(
        `飞书不接受这条消息的格式（插件的问题，请反馈给插件作者）${detail}`,
        `Feishu rejected the message format (a plugin bug; please report it)${detail}`,
      );
    case "rate":
      return t(`飞书限流，稍后自动重试${detail}`, `Rate limited by Feishu${detail}`);
    case "network":
    case "server":
      return t(`连接飞书失败，下个整点会再试${detail}`, `Could not reach Feishu; will retry next hour${detail}`);
    default:
      return t(`飞书拒绝了这条消息${detail}`, `Feishu rejected the message${detail}`);
  }
}

async function attempt({ invoke, webhook, secret, payload, now }) {
  const body = { ...payload };
  if (secret) {
    const timestamp = Math.floor(now() / 1000);
    body.timestamp = String(timestamp);
    body.sign = await signFeishu(secret, timestamp);
  }
  try {
    const response = await invoke("plugin_http_request", {
      method: "POST",
      url: webhook,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    return classifyFeishuResult(response, null);
  } catch (error) {
    return classifyFeishuResult(null, error);
  }
}

/** 发送一条消息；暂时性失败最多再试 2 次（每次重新签名）。 */
export async function sendFeishu({
  invoke,
  webhook,
  secret = "",
  payload,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  shouldAbort = () => false,
}) {
  const hook = validateWebhook(webhook);
  if (!hook.ok) return { ok: false, kind: "invalid", fatal: true, message: "" };
  let result = null;
  for (let i = 0; i <= RETRY_DELAYS.length; i += 1) {
    // 换了机器人 / 关掉 / 卸载：不再往旧地址重试。
    if (shouldAbort()) return { ok: false, kind: "aborted", message: "" };
    result = await attempt({ invoke, webhook: hook.value, secret: String(secret || "").trim(), payload, now });
    if (result.kind === "ok") return { ok: true };
    if (!result.retry || i === RETRY_DELAYS.length) break;
    await sleep(RETRY_DELAYS[i]);
  }
  return { ok: false, ...result };
}
