/** 看板：五列 + 跨列拖拽（本地标记）+ 列内排序 + 5 秒撤销。 */

import { React } from "./react.js";
import { Avatar, Chip, Icon, RepoDot, Tag, cx, h, toneColor } from "./common.js";
import { dropPlan, orderAfterDrop, sortColumn, splitColumn } from "../domain/board.js";
import { duration, shortWhy } from "../domain/text.js";
import { linkSource, wtFor } from "../domain/link.js";
import { COLUMNS, MARK_TEXT } from "../constants.js";
import { ownerLabel } from "../i18n.js";
import { useScrollMemory } from "./scroll.js";

const MARK_EN = {
  changes: "changes needed",
  approve: "looks good",
  reset: "withdraw verdict",
  fixed: "author fixed it",
  done: "mark done",
};

const COLUMN_DESC = {
  review: ["没审过 / 审查中 / 你撤回了结论", "Not reviewed / reviewing / verdict withdrawn"],
  fix: ["你提了问题，等作者改", "You raised issues; waiting on the author"],
  rereview: ["作者改完了，等你再看", "Author updated; waiting on you"],
  approved: ["你已通过，等合并", "You approved; waiting for merge"],
  ended: ["已合并 / 已关闭 / 你标记完成", "Merged / closed / marked done"],
};

function shortAge(d, now, t) {
  const days = Math.floor((now - d.since) / 86_400_000);
  return days <= 0 ? t("今天", "Today") : t(`${days} 天前`, `${days}d ago`);
}

function WorktreeButton({ t, wt, pr, bindings, rules, onWorktree, onBind, ended }) {
  if (wt) {
    return h(
      "button",
      {
        type: "button",
        className: "ght-wt-link",
        title: `${linkSource(wt, pr, bindings)} · ${t("点击复制路径", "click to copy path")}`,
        onClick: (event) => {
          event.stopPropagation();
          onWorktree(wt);
        },
      },
      h(Icon, { name: "branch", size: 12 }),
      wt.name,
      wt.auto ? h("span", { className: "ght-wt-auto" }, t("自动 · 已就绪", "auto · ready")) : null,
    );
  }
  if (ended) return null;
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

function CardTags({ t, d, f, pr }) {
  const tags = [
    f.overdue ? h(Tag, { key: "o", kind: "bad" }, t("超时", "Overdue")) : null,
    f.silent ? h(Tag, { key: "s", kind: "warn" }, t("作者沉默", "Author silent")) : null,
    d.reviews >= 2
      ? h(Tag, { key: "r", kind: "mute" }, t(`第 ${d.reviews} 轮`, `Round ${d.reviews}`))
      : null,
    pr.ignored ? h(Tag, { key: "i", kind: "mute" }, t("已忽略", "Ignored")) : null,
  ].filter(Boolean);
  return tags.length ? h("div", { className: "ght-kc-tags" }, tags) : null;
}

function CardHead({ t, pr, def, locked, showChip }) {
  return h(
    "div",
    { className: "ght-kc-top" },
    h(RepoDot, { index: pr.repoIndex ?? 0 }),
    h("span", { className: "ght-kc-repo" }, pr.repoSlug || pr.repo),
    h("span", { className: "ght-kc-num" }, `#${pr.number}`),
    h("span", { className: "ght-sp" }),
    showChip ? h(Chip, { tone: def.tone, small: true }, def.label) : null,
    locked ? null : h("span", { className: "ght-grip" }, h(Icon, { name: "grip", size: 13 })),
  );
}

export function PrCard({ t, row, defs, rules, now, dim, selected, wts, prs, bindings, onOpen, onBind, onWorktree, dragHandlers }) {
  const { pr, d, f } = row;
  const def = defs[d.key];
  const locked = ["merged", "closed", "draft"].includes(d.key);
  const showChip = ["draft", "merged", "closed", "done", "reviewing"].includes(d.key);
  const wt = wtFor(pr, { wts, prs, bindings, rules });
  return h(
    "article",
    {
      className: cx(
        "ght-kc",
        f.overdue && "ght-kc-overdue",
        dim && "ght-kc-dim",
        selected && "ght-kc-on",
        locked && "ght-kc-locked",
        d.key === "draft" && "ght-kc-draft",
      ),
      draggable: !locked,
      "data-card": pr.key,
      onClick: () => onOpen(pr.key),
      ...(locked ? {} : dragHandlers),
    },
    h(CardHead, { t, pr, def, locked, showChip }),
    h("div", { className: "ght-kc-title" }, pr.title),
    h("div", { className: "ght-kc-why" }, shortWhy(pr, d, rules, now, t)),
    h(CardTags, { t, d, f, pr }),
    h(
      "div",
      { className: "ght-kc-foot" },
      h(Avatar, { name: pr.author }),
      h("span", { className: "ght-au" }, pr.author),
      h("span", { className: "ght-sp" }),
      h(
        "span",
        { className: cx("ght-age", f.overdue && "bad") },
        h(Icon, { name: "clock", size: 11 }),
        def.owner === "done" ? shortAge(d, now, t) : duration(now - d.since, t),
      ),
    ),
    h(WorktreeButton, { t, wt, pr, bindings, rules, onWorktree, onBind, ended: def.owner === "done" }),
  );
}

function dropIndexAt(event, dragKey) {
  const cards = [...event.currentTarget.querySelectorAll("[data-card]")].filter(
    (el) => el.dataset.card !== dragKey,
  );
  const target = event.target.closest?.("[data-card]");
  if (!target || target.dataset.card === dragKey) return cards.length;
  const rect = target.getBoundingClientRect();
  return cards.indexOf(target) + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
}

function notifyDrop(result, drag, defs, t, toast) {
  if (!result.ok) {
    toast(t(`不能放到这里：${result.reason}`, `Can't drop here: ${result.reason}`));
    return;
  }
  if (result.reorder) {
    toast(t(`#${drag.number} 顺序已调整`, `#${drag.number} reordered`));
    return;
  }
  const before = defs[result.beforeKey]?.label || result.beforeKey;
  const after = defs[result.afterKey]?.label || result.afterKey;
  const mark = t(MARK_TEXT[result.mark], MARK_EN[result.mark]);
  toast(
    t(
      `#${drag.number}：${before} → ${after} · ${mark}（仅本地）`,
      `#${drag.number}: ${before} → ${after} · ${mark} (local only)`,
    ),
    result.undo,
  );
}

function performDrop({ event, colKey, drag, over, store, defs, visible, order, endedDays, now, toast, t }) {
  const plan = drag.plans[colKey];
  if (!plan?.ok) {
    toast(t(`不能放到这里：${plan?.text || ""}`, `Can't drop here: ${plan?.text || ""}`));
    return;
  }
  event.preventDefault();
  const state = store.getSnapshot();
  const prevLocal = { marks: state.local.marks, order: state.local.order };
  const { main } = splitColumn(visible, colKey, { endedDays, now });
  const sorted = sortColumn(main, colKey, order[colKey] || []);
  const index = over?.col === colKey && over.index != null ? over.index : sorted.length;
  const ids = orderAfterDrop(sorted, drag.key, index);
  const result = store.applyDropLocal(drag.key, colKey, ids, Date.now());
  const beforeKey =
    drag.fromKey === "reviewing" && result.beforeKey === "needs_review" ? "reviewing" : result.beforeKey;
  notifyDrop(
    { ...result, beforeKey, undo: () => store.restoreLocal(prevLocal) },
    drag,
    defs,
    t,
    toast,
  );
  return result;
}

function useBoardDrag({ store, rules, defs, visible, order, endedDays, now, toast, t }) {
  const [drag, setDrag] = React.useState(null);
  const [over, setOver] = React.useState(null);
  const dropped = React.useRef(false);
  const start = (event, row) => {
    dropped.current = false;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.pr.key);
    const plans = Object.fromEntries(COLUMNS.map((c) => [c.key, dropPlan(row.pr, rules, c.key)]));
    setDrag({ key: row.pr.key, number: row.pr.number, fromKey: row.d.key, plans });
  };
  const columnOver = (event, colKey) => {
    if (!drag) return;
    const plan = drag.plans[colKey];
    if (!plan?.ok) {
      setOver({ col: colKey, ok: false, index: null });
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const index = dropIndexAt(event, drag.key);
    if (index !== over?.index || over?.col !== colKey) setOver({ col: colKey, ok: true, index });
  };
  const drop = (event, colKey) => {
    if (!drag) return;
    dropped.current = true;
    performDrop({ event, colKey, drag, over, store, defs, visible, order, endedDays, now, toast, t });
    setDrag(null);
    setOver(null);
  };
  const end = () => {
    if (!dropped.current && drag && over && !drag.plans[over.col]?.ok) {
      toast(t(`不能放到这里：${drag.plans[over.col].text}`, `Can't drop here: ${drag.plans[over.col].text}`));
    }
    setDrag(null);
    setOver(null);
  };
  const leave = (colKey) => {
    setOver((current) => (current?.col === colKey ? { col: colKey, ok: false, index: null } : current));
  };
  return { drag, over, start, columnOver, drop, end, leave };
}

function ColumnHeader({ t, col, def, count, overdue }) {
  return h(
    "header",
    { className: "ght-bcol-h" },
    h(
      "div",
      { className: "ght-bcol-t" },
      h("i", { className: "ght-tdot", style: { background: toneColor(def ? def.tone : "neutral") } }),
      h("b", null, def ? def.label : t("已结束", "Finished")),
      def ? h("span", { className: `ght-own ght-own-${def.owner}` }, ownerLabel(def.owner, t)) : null,
      h("span", { className: "ght-sp" }),
      h("span", { className: "ght-cnt" }, count),
    ),
    h(
      "div",
      { className: "ght-bcol-d" },
      t(COLUMN_DESC[col.key][0], COLUMN_DESC[col.key][1]),
      overdue ? h("b", { className: "ght-od" }, t(` · ${overdue} 个超时`, ` · ${overdue} overdue`)) : null,
    ),
  );
}

function columnItems({ t, colKey, sorted, drafts, hidden, showPlaceholder, over, cardArgs, dragHandlers }) {
  const items = [];
  sorted.forEach((row, index) => {
    if (showPlaceholder && over.index === index) {
      items.push(h("div", { key: "ph", className: "ght-ph" }));
    }
    items.push(h(PrCard, { key: row.pr.key, row, ...cardArgs, ...dragHandlers(row) }));
  });
  if (showPlaceholder && over.index >= sorted.length) {
    items.push(h("div", { key: "ph-end", className: "ght-ph" }));
  }
  if (!sorted.length && !showPlaceholder) {
    items.push(h("div", { key: "empty", className: "ght-bempty" }, t("拖动卡片到这里", "Drag cards here")));
  }
  if (drafts.length) {
    items.push(
      h("div", { key: "sep", className: "ght-draft-sep" }, t(`草稿 · 等作者转 Ready（${drafts.length}）`, `Drafts · waiting for ready (${drafts.length})`)),
    );
    items.push(
      ...sortColumn(drafts, colKey, []).map((row) =>
        h(PrCard, { key: row.pr.key, row, ...cardArgs, ...dragHandlers(row) }),
      ),
    );
  }
  if (hidden) {
    items.push(
      h("div", { key: "more", className: "ght-bmore" }, t(`更早结束的 ${hidden} 个未显示（设置 › 看板）`, `${hidden} older items hidden (Settings › Board)`)),
    );
  }
  return items;
}

function BoardColumn({ t, col, defs, visible, order, endedDays, now, drag, over, cardArgs, onColumnOver, onDrop, onLeave, dragHandlers }) {
  const { main, drafts, hidden } = splitColumn(visible, col.key, { endedDays, now });
  const sorted = sortColumn(main, col.key, order[col.key] || []);
  const def = col.main ? defs[col.main] : null;
  const overdue = sorted.filter((r) => r.f.overdue).length;
  const plan = drag?.plans[col.key];
  const showPlaceholder = drag && over?.col === col.key && over.ok;
  // 每列各自记住滚动位置：新建 / 关联 worktree 后卡片会换列或换序，列别跳回顶部。
  const body = useScrollMemory(`col:${col.key}`);
  const hint = drag
    ? plan?.reorder
      ? t("列内拖动 = 调整顺序", "Same column = reorder")
      : plan?.ok
        ? t(`放下 = ${plan.text}`, `Drop = ${plan.text}`)
        : t(`不能放：${plan?.text || ""}`, `Can't drop: ${plan?.text || ""}`)
    : "";
  return h(
    "section",
    {
      className: cx("ght-bcol", drag && (plan?.ok ? "ght-can" : "ght-cannot"), over?.col === col.key && over.ok && "ght-over"),
      "data-col": col.key,
    },
    h(ColumnHeader, { t, col, def, count: sorted.length, overdue }),
    drag ? h("div", { className: "ght-drop-hint" }, hint) : null,
    h(
      "div",
      {
        className: "ght-bcol-body",
        ref: body,
        onDragOver: (event) => onColumnOver(event, col.key),
        onDrop: (event) => onDrop(event, col.key),
        onDragLeave: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onLeave(col.key);
        },
      },
      columnItems({ t, colKey: col.key, sorted, drafts, hidden, showPlaceholder, over, cardArgs, dragHandlers }),
    ),
  );
}

export function Board({ t, store, rows, rules, defs, order, endedDays, now, query, filterFn, wts, prs, bindings, selectedKey, toast, onOpen, onBind, onWorktree }) {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  const visible = rows.filter(
    (row) =>
      !q ||
      `${row.pr.number} ${row.pr.title} ${row.pr.author} ${row.pr.repoSlug}`.toLowerCase().includes(q),
  );
  const dragState = useBoardDrag({ store, rules, defs, visible, order, endedDays, now, toast, t });
  const cardArgs = { t, defs, rules, now, wts, prs, bindings, onOpen, onBind, onWorktree };
  const dragHandlers = (row) => ({
    dim: !filterFn(row),
    selected: selectedKey === row.pr.key,
    dragHandlers: {
      onDragStart: (event) => dragState.start(event, row),
      onDragEnd: dragState.end,
    },
  });
  return h(
    "div",
    { className: cx("ght-board", dragState.drag && "ght-dragging") },
    COLUMNS.map((col) =>
      h(BoardColumn, {
        key: col.key,
        t,
        col,
        defs,
        visible,
        order,
        endedDays,
        now,
        drag: dragState.drag,
        over: dragState.over,
        cardArgs,
        dragHandlers,
        onColumnOver: dragState.columnOver,
        onDrop: dragState.drop,
        onLeave: dragState.leave,
      }),
    ),
  );
}
