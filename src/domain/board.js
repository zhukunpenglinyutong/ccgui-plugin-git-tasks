/** 看板列、拖拽计划与排序（纯函数，计划 §6.4）。 */

import { COLUMNS, DAY, DROP_MARK, MARK_TEXT } from "../constants.js";
import { derive } from "./derive.js";

export function colOf(statusKey) {
  const col = COLUMNS.find((c) => c.statuses.includes(statusKey));
  return col ? col.key : "review";
}

export function columnByKey(colKey) {
  return COLUMNS.find((c) => c.key === colKey) || COLUMNS[0];
}

function isDoneMark(e) {
  return e.type === "mark" && e.verdict === "done";
}

/** 拖拽计划：允许 / 不允许，以及放下时会记下的标记。 */
export function dropPlan(pr, rules, toCol) {
  const d = derive(pr, rules);
  const from = colOf(d.key);
  if (from === toCol) return { ok: true, reorder: true, text: "调整顺序" };
  if (d.key === "merged" || d.key === "closed") {
    return { ok: false, text: "已合并 / 已关闭由 GitHub 决定" };
  }
  if (d.key === "draft") return { ok: false, text: "草稿要等作者转 Ready" };

  const base = d.key === "done" ? pr.events.filter((e) => !isDoneMark(e)) : pr.events;
  const baseKey = derive({ ...pr, events: base }, rules);
  if (d.key === "done" && colOf(baseKey.key) === toCol) {
    return { ok: true, base, mark: null, text: "取消“完成”标记" };
  }
  if (toCol === "rereview" && !baseKey.last) {
    return { ok: false, text: "你还没审过，谈不上复审" };
  }
  const mark = DROP_MARK[toCol];
  if (!mark) return { ok: false, text: "未知目标列" };
  return { ok: true, base, mark, text: `标记「${MARK_TEXT[mark]}」` };
}

/** 应用一次拖拽：返回新事件、排序、前后状态键。
 *  `ids` 是目标列的卡片顺序（含被拖动的卡片）。 */
export function applyDrop(pr, rules, toCol, ids, now) {
  const plan = dropPlan(pr, rules, toCol);
  if (!plan.ok) return { ok: false, reason: plan.text };
  if (plan.reorder) return { ok: true, reorder: true, order: ids };
  const beforeKey = derive(pr, rules).key;
  const markEvent = plan.mark
    ? { type: "mark", verdict: plan.mark, via: "drag", at: now, sha: pr.headSha }
    : null;
  const events = markEvent ? [...plan.base, markEvent] : plan.base;
  const afterKey = derive({ ...pr, events }, rules).key;
  return {
    ok: true,
    events,
    order: ids,
    mark: plan.mark,
    beforeKey,
    afterKey,
    text: plan.text,
  };
}

/** 列内排序：手动顺序优先；未排过的按“超时优先、等得最久优先”，
 *  已结束列按结束时间倒序。 */
export function sortColumn(rows, colKey, orderIds) {
  const pos = new Map((orderIds || []).map((id, i) => [id, i]));
  const desc = colKey === "ended";
  return [...rows].sort((a, b) => {
    const pa = pos.has(a.pr.key) ? pos.get(a.pr.key) : Number.POSITIVE_INFINITY;
    const pb = pos.has(b.pr.key) ? pos.get(b.pr.key) : Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    if (colKey === "review") {
      const rank = Number(b.d.key === "reviewing") - Number(a.d.key === "reviewing");
      if (rank) return rank;
    }
    const overdue = Number(b.f.overdue) - Number(a.f.overdue);
    if (overdue) return overdue;
    return desc ? b.d.since - a.d.since : a.d.since - b.d.since;
  });
}

/** 落列后的卡片顺序：从排序结果里拿掉被拖动的卡片，再插到指定位置。 */
export function orderAfterDrop(sortedRows, draggedKey, index) {
  const keys = sortedRows.map((r) => r.pr.key).filter((key) => key !== draggedKey);
  const at = Math.max(0, Math.min(index, keys.length));
  return [...keys.slice(0, at), draggedKey, ...keys.slice(at)];
}

/** 一列里要显示的卡片：草稿拆出来放底部；已结束按设置截断。 */
export function splitColumn(rows, colKey, { endedDays, now }) {
  const col = columnByKey(colKey);
  const inCol = rows.filter((r) => col.statuses.includes(r.d.key));
  const cut = now - endedDays * DAY;
  const visible = colKey === "ended" ? inCol.filter((r) => r.d.since >= cut) : inCol;
  const hidden = inCol.length - visible.length;
  return {
    main: visible.filter((r) => r.d.key !== "draft"),
    drafts: visible.filter((r) => r.d.key === "draft"),
    hidden,
  };
}
