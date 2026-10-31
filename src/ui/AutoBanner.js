/** 面板头部的自动化提示：上限 / 熔断 / 可清理 / 飞书暂停。可关闭（本次会话内）。 */

import { Icon, h } from "./common.js";

function lines({ t, state, auto }) {
  const out = [];
  const info = auto.status();
  if (info.breaker) {
    out.push(["breaker", t("自动建 worktree 连续失败已熔断，每 30 分钟试探 1 个", "Auto worktree creation paused after repeated failures")]);
  }
  if (info.capped) {
    out.push([
      "capped",
      t(
        `自动 worktree 已达上限 ${state.cfg.automation.autoWorktreeMax} 个，还有 ${info.waiting} 个待审查 PR 没建`,
        `Auto worktree limit (${state.cfg.automation.autoWorktreeMax}) reached; ${info.waiting} PRs waiting`,
      ),
    ]);
  }
  const cleanable = auto.cleanable().length;
  if (cleanable) {
    out.push(["clean", t(`${cleanable} 个自动 worktree 对应的 PR 已结束，可以清理`, `${cleanable} auto worktrees belong to ended PRs`)]);
  }
  if (state.cfg.notify.feishu && state.notify.paused) {
    out.push(["notify", t(`飞书汇总已暂停：${state.notify.paused.message}`, `Feishu digest paused: ${state.notify.paused.message}`)]);
  }
  return out;
}

export function AutoBanner({ t, store, state, auto, onOpenSettings }) {
  if (!auto) return null;
  const items = lines({ t, state, auto });
  const signature = items.map(([key, text]) => `${key}:${text}`).join("|");
  if (!items.length || state.ui.autoBannerHidden === signature) return null;
  return h(
    "div",
    { className: "ght-banner ght-banner-list ght-banner-info" },
    items.map(([key, text], i) =>
      h(
        "div",
        { key, className: "ght-banner-row" },
        h("span", { className: "ght-banner-text" }, text),
        h("button", { type: "button", className: "ght-linkish", onClick: onOpenSettings }, t("去设置", "Settings")),
        i === 0
          ? h(
              "button",
              {
                type: "button",
                className: "ght-banner-close",
                title: t("关闭", "Dismiss"),
                "aria-label": t("关闭", "Dismiss"),
                onClick: () => store.setUi({ autoBannerHidden: signature }),
              },
              h(Icon, { name: "x", size: 13 }),
            )
          : null,
      ),
    ),
  );
}
