/** 每日新增堆叠柱 + 表视图（表视图是青色对比度不足的补偿，不能省）。 */

import { React } from "./react.js";
import { RepoDot, cx, h, repoColor } from "./common.js";
import { dateLabel } from "../domain/text.js";

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function Tooltip({ tip }) {
  if (!tip) return null;
  return h(
    "div",
    { className: "ght-tip", style: { left: tip.x, top: tip.y } },
    h("div", { className: "ght-tip-h" }, tip.title),
    tip.rows.map((row) =>
      h(
        "div",
        { className: "ght-tip-r", key: row.key },
        h("i", { style: { background: row.color } }),
        h("span", { className: "ght-tip-name", title: row.label }, row.label),
        h("b", null, row.value),
      ),
    ),
  );
}

function ChartColumns({ days, series, totals, top, last, peak, onTip, onLeave }) {
  return h(
    "div",
    { className: "ght-cols" },
    days.map((day, index) => {
      const total = totals[index];
      const isToday = index === last;
      const label = (isToday || index === peak) && total ? h("b", null, total) : null;
      return h(
        "div",
        {
          key: day.key,
          className: "ght-col",
          onMouseEnter: (event) => onTip(event, index),
          onMouseLeave: onLeave,
        },
        h(
          "div",
          { className: "ght-stack", style: { height: `${Math.min(100, (total / top) * 100)}%` } },
          label,
          series.map((repo, i) =>
            day.vals[i]
              ? h("i", {
                  key: repo.slug,
                  className: "ght-bar",
                  style: { flex: `${day.vals[i]} 1 0`, background: repoColor(repo.colorIndex) },
                })
              : null,
          ),
        ),
      );
    }),
  );
}

function ChartAxis({ t, days, last }) {
  return h(
    "div",
    { className: "ght-x-axis" },
    days.map((day, index) => {
      const d = new Date(day.at);
      if (index === last) return h("span", { key: day.key, className: "ght-today" }, t("今天", "Today"));
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      return h(
        "span",
        { key: day.key, className: cx(weekend && "ght-we") },
        index === 0 ? `${d.getMonth() + 1}/` : "",
        d.getDate(),
      );
    }),
  );
}

function useChartTip({ t, days, series, totals }) {
  const [tip, setTip] = React.useState(null);
  const showTip = (event, index) => {
    const day = days[index];
    const rect = event.currentTarget.getBoundingClientRect();
    setTip({
      x: Math.max(8, Math.min(rect.left + rect.width / 2 - 90, window.innerWidth - 220)),
      y: rect.bottom + 8,
      title: `${dateLabel(day.at, t)} · ${t("新增", "new")} ${totals[index]}`,
      rows: series.map((repo, i) => ({
        key: repo.slug,
        color: repoColor(repo.colorIndex),
        label: repo.slug,
        value: day.vals[i],
      })),
    });
  };
  return { tip, showTip, hideTip: () => setTip(null) };
}

function StackedChart({ t, series, days }) {
  const totals = days.map((d) => sum(d.vals));
  const top = Math.max(10, Math.ceil(Math.max(1, ...totals) / 10) * 10);
  const ticks = [0, top / 2, top];
  const past = totals.slice(0, -1);
  const peak = past.length ? past.indexOf(Math.max(...past)) : -1;
  const last = days.length - 1;
  const { tip, showTip, hideTip } = useChartTip({ t, days, series, totals });
  return h(
    "div",
    { className: "ght-chart-wrap" },
    h(
      "div",
      { className: "ght-chart" },
      h(
        "div",
        { className: "ght-y-axis" },
        ticks.map((tick) => h("span", { key: tick, style: { bottom: `${(tick / top) * 100}%` } }, tick)),
      ),
      h(
        "div",
        { className: "ght-plot" },
        ticks.map((tick, i) =>
          h("i", {
            key: tick,
            className: cx("ght-grid", i === 0 && "ght-grid-base"),
            style: { bottom: `${(tick / top) * 100}%` },
          }),
        ),
        h(ChartColumns, { days, series, totals, top, last, peak, onTip: showTip, onLeave: hideTip }),
      ),
      h(ChartAxis, { t, days, last }),
    ),
    h(Tooltip, { tip }),
  );
}

function TableView({ t, series, days, flow }) {
  const flowByKey = Object.fromEntries(flow.map((row) => [row.key, row]));
  return h(
    "div",
    { className: "ght-tbl-wrap" },
    h(
      "table",
      { className: "ght-tbl" },
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", null, t("日期", "Date")),
          series.map((repo) =>
            h(
              "th",
              { key: repo.slug },
              h(RepoDot, { index: repo.colorIndex }),
              repo.slug.split("/")[1] || repo.slug,
            ),
          ),
          h("th", null, t("新增合计", "Total")),
          h("th", null, t("我审查", "Reviewed")),
          h("th", null, t("作者修复", "Fixed")),
          h("th", null, t("合并", "Merged")),
        ),
      ),
      h(
        "tbody",
        null,
        days.map((day, index) => {
          const f = flowByKey[day.key] || { reviews: 0, fixed: 0, merged: 0 };
          const isToday = index === days.length - 1;
          return h(
            "tr",
            { key: day.key, className: cx(isToday && "ght-today-row") },
            h("td", null, isToday ? t("今天", "Today") : dateLabel(day.at, t)),
            day.vals.map((value, i) => h("td", { key: series[i].slug }, value)),
            h("td", { className: "ght-sum" }, sum(day.vals)),
            h("td", null, f.reviews),
            h("td", null, f.fixed),
            h("td", null, f.merged),
          );
        }),
      ),
    ),
  );
}

export function DailyChart({ t, series, days, flow, rules, mode, onMode }) {
  return h(
    "section",
    { className: "ght-card" },
    h(
      "header",
      { className: "ght-card-h" },
      h("h3", null, t("每日新增 PR", "New PRs per day")),
      h("span", { className: "ght-sub" }, t("近 14 天", "last 14 days")),
      series.length > 1
        ? h(
            "div",
            { className: "ght-legend" },
            series.map((repo) =>
              h(
                "span",
                { key: repo.slug },
                h(RepoDot, { index: repo.colorIndex }),
                repo.slug.split("/")[1] || repo.slug,
              ),
            ),
          )
        : h("span", { className: "ght-sub" }, series[0]?.slug || ""),
      h("span", { className: "ght-sp" }),
      h(
        "div",
        { className: "ght-seg" },
        h("button", { type: "button", className: cx(mode === "chart" && "on"), onClick: () => onMode("chart") }, t("图", "Chart")),
        h("button", { type: "button", className: cx(mode === "table" && "on"), onClick: () => onMode("table") }, t("表", "Table")),
      ),
    ),
    mode === "chart"
      ? h(StackedChart, { t, series, days, rules })
      : h(TableView, { t, series, days, flow }),
  );
}
