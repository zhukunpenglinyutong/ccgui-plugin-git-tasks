/** 设置 › 自动化：自动建 worktree + 飞书每小时汇总。 */

import { React } from "./react.js";
import { h } from "./common.js";
import { Row, Section, Switch } from "./settingsKit.js";
import { AUTO_WT_MAX_LIMIT, AUTO_WT_PER_RUN } from "../constants.js";
import { maskWebhook, validateSecret, validateWebhook } from "../notify/feishu.js";
import { planHint, runResultText } from "./autoText.js";

const pad = (n) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const timeText = (ms) => (ms ? new Date(ms).toLocaleString() : "");

function MaxInput({ value, onCommit }) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft));
    // 清空 / 乱填：回到原值，而不是被夹成 1。
    if (!draft.trim() || !Number.isFinite(n)) return setDraft(String(value));
    onCommit(Math.max(1, Math.min(AUTO_WT_MAX_LIMIT, n)));
  };
  return h("input", {
    className: "ght-numin",
    type: "number",
    min: 1,
    max: AUTO_WT_MAX_LIMIT,
    value: draft,
    onChange: (e) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e) => {
      if (e.key === "Enter") commit();
    },
  });
}

function CleanupRow({ t, auto, toast }) {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const items = auto.cleanable();
  const run = async () => {
    setBusy(true);
    const out = await auto.cleanup(items);
    setBusy(false);
    setConfirming(false);
    const skipped = out.skipped ? t(`；${out.skipped} 个情况已变化未删`, `; ${out.skipped} changed meanwhile`) : "";
    toast(t(`已删除 ${out.removed} 个；${out.dirty} 个有未提交改动已跳过；${out.failed} 个失败${skipped}`, `Removed ${out.removed}; skipped ${out.dirty} with changes; ${out.failed} failed${skipped}`));
  };
  const buttons = confirming
    ? [
        h("button", { key: "y", type: "button", className: "ght-btn ght-btn-danger", disabled: busy, onClick: run }, busy ? t("清理中…", "Cleaning…") : t("确认清理", "Confirm")),
        h("button", { key: "n", type: "button", className: "ght-btn", disabled: busy, onClick: () => setConfirming(false) }, t("取消", "Cancel")),
      ]
    : [h("button", { key: "c", type: "button", className: "ght-btn", disabled: !items.length, onClick: () => setConfirming(true) }, t(`清理 ${items.length} 个`, `Clean ${items.length}`))];
  return h(
    Row,
    {
      label: t("清理已结束 PR 的自动 worktree", "Clean up auto worktrees of ended PRs"),
      hint: t(
        "只删插件自动建、你没开始审查的；有未提交改动的跳过；不删分支。注意：被 .gitignore 忽略的文件（如 .env.local）会随目录一起删除",
        "Only untouched auto worktrees; dirty ones are skipped; branches are kept. Git-ignored files are deleted with the directory",
      ),
    },
    h("span", { className: "ght-btns" }, buttons),
  );
}

/** 跑一轮并提示结果：建了几个，或者为什么一个都没建。 */
function useRunAuto({ t, auto, cfg, toast }) {
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(null);
  /** manual：你点的「执行」一次建到上限；开关刚打开时按后台节奏（每轮 5 个）。 */
  const run = async (manual = true) => {
    setBusy(true);
    setProgress(null);
    try {
      toast(runResultText(t, await auto.run({ manual, onProgress: setProgress }), cfg));
    } catch (error) {
      toast(t(`执行失败：${error?.message || error}`, `Run failed: ${error?.message || error}`));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const label = !busy
    ? t("执行", "Run")
    : progress?.total
      ? t(`执行中 ${progress.done}/${progress.total}…`, `Running ${progress.done}/${progress.total}…`)
      : t("执行中…", "Running…");
  return { busy, run, label };
}

function AutoWorktreeBlock({ t, store, state, auto, toast }) {
  const cfg = state.cfg.automation;
  const info = auto.status();
  const runner = useRunAuto({ t, auto, cfg, toast });
  const failed = Object.values(state.auto).filter((r) => r.status === "failed" || r.status === "gave_up").length;
  return [
    h(Row, {
      key: "on",
      label: t("自动创建 worktree", "Auto-create worktrees"),
      hint: t(
        `看板「待审查」里还没有 worktree 的 PR 自动建（跳过草稿 / 已忽略 / 你自己的 PR）。后台每次同步最多新建 ${AUTO_WT_PER_RUN} 个，点下面的「执行」一次建到上限。自动建的不算「审查中」，在详情里点「开始审查」才算`,
        `PRs in "To review" without a worktree get one (drafts, ignored and your own PRs skipped). Background syncs create up to ${AUTO_WT_PER_RUN} each; "Run" creates up to the limit at once. Auto worktrees don't count as "Reviewing" until you click "Start review"`,
      ),
    }, h(Switch, {
      checked: cfg.autoWorktree,
      label: "autoWorktree",
      onChange: (v) => {
        store.setAutomation({ autoWorktree: v });
        if (v) runner.run(false);
      },
    })),
    h(Row, {
      key: "forks",
      label: t("包含来自 fork 的 PR", "Include PRs from forks"),
      hint: t(
        "默认不建：fork 的 PR 任何人都能提，检出时会触发你本机的 git 钩子（husky / lefthook 等可能执行 PR 里的安装脚本）",
        "Off by default: anyone can open a fork PR, and checkout runs your local git hooks",
      ),
    }, h(Switch, { checked: cfg.autoWorktreeForks, label: "autoWorktreeForks", onChange: (v) => store.setAutomation({ autoWorktreeForks: v }) })),
    h(Row, { key: "max", label: t("自动 worktree 上限", "Auto worktree limit"), hint: planHint(t, info, failed) },
      h("span", { className: "ght-inline" }, h(MaxInput, { value: cfg.autoWorktreeMax, onCommit: (n) => store.setAutomation({ autoWorktreeMax: n }) }), t("个", "")),
    ),
    h(Row, { key: "act", label: t("立即执行", "Run now"), hint: t("一次建到上限（不受后台每轮 5 个的限制）；重置会清掉失败记录，让这些 PR 重新尝试", "Creates up to the limit at once; reset clears failures so those PRs are retried") },
      h("span", { className: "ght-btns" },
        h("button", { type: "button", className: "ght-btn", disabled: !cfg.autoWorktree || runner.busy, onClick: () => runner.run(true) }, runner.label),
        h("button", {
          type: "button",
          className: "ght-btn",
          disabled: !failed && !info.breaker,
          onClick: () => {
            const n = auto.resetFailures();
            toast(t(`已重置 ${n} 条失败记录`, `Reset ${n} failures`));
          },
        }, t("重置失败", "Reset failures")),
      ),
    ),
    h(CleanupRow, { key: "clean", t, auto, toast }),
  ];
}

function SecretField({ t, store, digest, toast, field, label, hint, placeholder, validate, display }) {
  const saved = store.getSnapshot().feishu[field];
  const [editing, setEditing] = React.useState(!saved);
  const [draft, setDraft] = React.useState("");
  const save = () => {
    const clearing = !draft.trim();
    const check = clearing ? { ok: true, value: "" } : validate(draft);
    if (!check.ok) return toast(t("格式不对，请检查后再保存", "Invalid format"));
    store.setFeishu({ [field]: check.value });
    if (field === "webhook") {
      // 清空地址 = 关掉汇总，token 不再留在本地存储。
      if (clearing) store.setNotifyCfg({ feishu: false });
      digest.onTargetChanged();
    }
    setDraft("");
    setEditing(!check.value);
    toast(clearing ? t("已清除", "Cleared") : t("已保存", "Saved"));
  };
  const body = editing
    ? [
        h("input", { key: "i", className: "ght-sel ght-secret-in", type: "password", autoComplete: "off", value: draft, placeholder, onChange: (e) => setDraft(e.target.value) }),
        h("button", { key: "s", type: "button", className: "ght-btn", onClick: save }, t("保存", "Save")),
      ]
    : [
        h("code", { key: "v", className: "ght-mono ght-secret-v" }, display(saved)),
        h("button", { key: "e", type: "button", className: "ght-btn", onClick: () => setEditing(true) }, t("修改", "Edit")),
      ];
  return h(Row, { label, hint }, h("span", { className: "ght-btns" }, body));
}

function QuietRow({ t, store, cfg }) {
  const select = (key) =>
    h("select", { className: "ght-sel", value: String(cfg[key]), disabled: !cfg.quiet, onChange: (e) => store.setNotifyCfg({ [key]: Number(e.target.value) }) },
      HOURS.map((hour) => h("option", { key: hour, value: String(hour) }, `${pad(hour)}:00`)),
    );
  return h(Row, { label: t("静默时段", "Quiet hours"), hint: t("这段时间不发，结束后把累积的变化合并成一条", "Changes during quiet hours are merged into the next message") },
    h("span", { className: "ght-inline" },
      h(Switch, { checked: cfg.quiet, label: "quiet", onChange: (v) => store.setNotifyCfg({ quiet: v }) }),
      select("quietStart"), "—", select("quietEnd"),
    ),
  );
}

function notifyStatus(t, notify) {
  if (notify.paused) return t(`已暂停：${notify.paused.message}`, `Paused: ${notify.paused.message}`);
  const parts = [];
  if (notify.lastSentAt) parts.push(t(`上次发送 ${timeText(notify.lastSentAt)}`, `Last sent ${timeText(notify.lastSentAt)}`));
  if (notify.lastResult && !notify.lastResult.ok) parts.push(notify.lastResult.message);
  return parts.join(" · ") || t("还没发过", "Nothing sent yet");
}

function NotifyStatusRow({ t, state, digest, toast }) {
  const [busy, setBusy] = React.useState(false);
  const test = async () => {
    setBusy(true);
    try {
      const out = await digest.sendTest();
      toast(out.ok ? t("测试消息已发送，请到飞书群查看", "Test message sent") : out.message);
    } finally {
      setBusy(false);
    }
  };
  return h(Row, { label: t("状态", "Status"), hint: notifyStatus(t, state.notify) },
    h("span", { className: "ght-btns" },
      state.notify.paused ? h("button", { type: "button", className: "ght-btn", onClick: () => digest.resume() }, t("恢复", "Resume")) : null,
      h("button", { type: "button", className: "ght-btn", disabled: busy || !validateWebhook(state.feishu.webhook).ok, onClick: test }, busy ? t("发送中…", "Sending…") : t("发送测试消息", "Send test")),
    ),
  );
}

function FeishuBlock({ t, store, state, digest, toast }) {
  const cfg = state.cfg.notify;
  const hookOk = validateWebhook(state.feishu.webhook).ok;
  const shared = { t, store, digest, toast };
  return [
    h(Row, {
      key: "on",
      label: t("飞书每小时汇总", "Hourly Feishu digest"),
      hint: hookOk
        ? t("整点发送：每个仓库未合并几个、哪些 PR 状态变了；和上次发出的相比没有变化就不发", "Sent on the hour; skipped when nothing changed since the last message")
        : t("先填写下面的 webhook 地址", "Fill in the webhook URL below first"),
    }, h(Switch, {
      checked: cfg.feishu && hookOk,
      label: "feishu",
      onChange: (v) => {
        if (v && !hookOk) return;
        store.setNotifyCfg({ feishu: v });
        if (v) {
          digest.onTargetChanged();
          digest.check();
        }
      },
    })),
    h(SecretField, {
      ...shared,
      key: "hook",
      field: "webhook",
      label: t("Webhook 地址", "Webhook URL"),
      hint: t(
        "飞书群 › 设置 › 群机器人 › 添加自定义机器人；只支持 open.feishu.cn。留空保存即清除。PR 标题会发到群里，私有仓库请确认群成员可见范围；多台电脑配置同一个机器人会各自发送",
        "Group settings › Bots › Custom bot; open.feishu.cn only. Save empty to clear. PR titles are posted to the group",
      ),
      placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/…",
      validate: validateWebhook,
      display: maskWebhook,
    }),
    h(SecretField, {
      ...shared,
      key: "secret",
      field: "secret",
      label: t("签名密钥（可选）", "Signing secret (optional)"),
      hint: t("机器人开启「签名校验」时填写；留空保存即清除", "Required when signature verification is on; save empty to clear"),
      placeholder: t("留空 = 不签名", "empty = no signature"),
      validate: validateSecret,
      display: () => "••••••",
    }),
    h(QuietRow, { key: "quiet", t, store, cfg }),
    h(NotifyStatusRow, { key: "status", t, state, digest, toast }),
  ];
}

export function AutomationSection({ t, store, state, toast, auto, digest }) {
  if (!auto || !digest) return null;
  return h(
    Section,
    { id: "auto", title: t("自动化", "Automation"), sub: t("客户端运行时在后台工作；关闭或电脑睡眠时暂停", "Runs while the app is open") },
    h(AutoWorktreeBlock, { t, store, state, auto, toast }),
    h(FeishuBlock, { t, store, state, digest, toast }),
  );
}
