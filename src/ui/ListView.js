/** 列表视图：筛选是过滤（与看板的“变淡”不同）。 */

import { React } from "./react.js";
import { Avatar, Chip, Icon, RepoDot, Tag, cx, h } from "./common.js";
import { sortColumn } from "../domain/board.js";
import { duration, evText, fmtRel } from "../domain/text.js";
import { linkSource, wtFor } from "../domain/link.js";

function WtCell({ t, pr, d, defs, wts, prs, bindings, rules, onWorktree, onBind }) {
  const def = defs[d.key];
  const wt = wtFor(pr, { wts, prs, bindings, rules });
  if (wt) {
    return h(
      "button",
      {
        type: "button",
        className: "ght-wt-link",
        title: linkSource(wt, pr, bindings),
        onClick: (event) => {
          event.stopPropagation();
          onWorktree(wt);
        },
      },
      h(Icon, { name: "branch", size: 12 }),
      wt.name,
    );
  }
  if (def.owner === "done") return null;
  return h(
    "button",
    {
      type: "button",
      className: "ght-ghost-btn",
      onClick: (event) => {
        event.stopPropagation();
        onBind(pr.key);
      },
    },
    h(Icon, { name: "link", size: 12 }),
    t("关联 worktree", "Link worktree"),
  );
}

function RowHeading({ t, pr, f, ignored }) {
  const tags = [
    f.overdue ? h(Tag, { key: "o", kind: "bad" }, t("超时", "Overdue")) : null,
    f.silent ? h(Tag, { key: "s", kind: "warn" }, t("作者沉默", "Author silent")) : null,
    ignored ? h(Tag, { key: "i", kind: "mute" }, t("已忽略", "Ignored")) : null,
  ].filter(Boolean);
  return h(
    "div",
    { className: "ght-pr-title" },
    h("span", { className: "ght-prnum" }, `#${pr.number}`),
    h("span", { className: "ght-pr-t" }, pr.title),
    tags,
  );
}

function RowMeta({ t, pr, rules, now, event }) {
  return h(
    "div",
    { className: "ght-pr-meta" },
    h(RepoDot, { index: pr.repoIndex ?? 0 }),
    h("span", null, pr.repoSlug || pr.repo),
    "·",
    h(Avatar, { name: pr.author }),
    h("span", null, pr.author),
    "·",
    h(
      "span",
      null,
      event ? `${evText(pr, event, pr.events, rules, t).text} ${fmtRel(event.at, now, t)}` : "",
    ),
  );
}

function PrTitleBlock({ t, pr, f, rules, now, event }) {
  return h(
    "div",
    { className: "ght-pr-main" },
    h(RowHeading, { t, pr, f, ignored: pr.ignored }),
    h(RowMeta, { t, pr, rules, now, event }),
  );
}

function RowTail({ t, pr, d, def, f, defs, rules, now, wts, prs, bindings, onWorktree, onBind, onGh }) {
  return h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "ght-pr-rounds" },
      d.reviews
        ? t(`已审 ${d.reviews} 次`, `Reviewed ${d.reviews}×`)
        : def.owner === "done"
          ? "—"
          : t("未审", "Not reviewed"),
    ),
    h(
      "div",
      { className: cx("ght-pr-age", f.overdue && "bad") },
      def.owner === "done" ? fmtRel(d.since, now, t) : duration(now - d.since, t),
    ),
    h("div", { className: "ght-pr-wt" }, h(WtCell, { t, pr, d, defs, wts, prs, bindings, rules, onWorktree, onBind })),
    h(
      "div",
      null,
      h(
        "button",
        {
          type: "button",
          className: "ght-icon-btn ght-bare",
          title: t("在 GitHub 打开", "Open on GitHub"),
          onClick: (event) => {
            event.stopPropagation();
            onGh(pr);
          },
        },
        h(Icon, { name: "ext", size: 14 }),
      ),
    ),
  );
}

function PrRow({ t, row, defs, rules, now, wts, prs, bindings, selectedKey, onOpen, onBind, onWorktree, onGh }) {
  const { pr, d, f } = row;
  const def = defs[d.key];
  const event = pr.events[pr.events.length - 1];
  return h(
    "div",
    {
      className: cx(
        "ght-pr-row",
        selectedKey === pr.key && "ght-pr-row-on",
        pr.ignored && "ght-pr-row-ignored",
      ),
      onClick: () => onOpen(pr.key),
    },
    h("div", null, h(Chip, { tone: def.tone }, def.label)),
    h(PrTitleBlock, { t, pr, f, rules, now, event }),
    h(RowTail, { t, pr, d, def, f, defs, rules, now, wts, prs, bindings, onWorktree, onBind, onGh }),
  );
}

export function ListView({
  t,
  rows,
  defs,
  rules,
  now,
  query,
  filterFn,
  wts,
  prs,
  bindings,
  selectedKey,
  onOpen,
  onBind,
  onWorktree,
  onGh,
}) {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  const list = rows
    .filter(filterFn)
    .filter(
      (row) =>
        !q ||
        `${row.pr.number} ${row.pr.title} ${row.pr.author} ${row.pr.repoSlug}`.toLowerCase().includes(q),
    );
  const sorted = sortColumn(list, "list", []);
  const rowArgs = { t, defs, rules, now, wts, prs, bindings, selectedKey, onOpen, onBind, onWorktree, onGh };
  return h(
    "div",
    { className: "ght-list" },
    h(
      "div",
      { className: "ght-list-head" },
      h("span", null, t("状态", "Status")),
      h("span", null, "PR"),
      h("span", null, t("审查", "Reviews")),
      h("span", null, t("停留", "Age")),
      h("span", null, "Worktree"),
      h("span", null),
    ),
    sorted.length
      ? sorted.map((row) => h(PrRow, { key: row.pr.key, row, ...rowArgs }))
      : h("div", { className: "ght-empty" }, t("这里没有 PR。", "No PRs here.")),
  );
}
