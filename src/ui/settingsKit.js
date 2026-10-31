/** 设置页共用的小组件（行 / 开关 / 分段 / 分区）。 */

import { cx, h } from "./common.js";

export function Row({ label, hint, children, stack }) {
  return h(
    "div",
    { className: cx("ght-srow", stack && "ght-srow-stack") },
    h(
      "div",
      null,
      h("div", { className: "ght-lab" }, label),
      hint ? h("div", { className: "ght-hint" }, hint) : null,
    ),
    stack ? h("div", { className: "ght-stack-body" }, children) : h("div", null, children),
  );
}

export function Switch({ checked, onChange, label }) {
  return h(
    "label",
    { className: "ght-sw", "aria-label": label },
    h("input", { type: "checkbox", checked, onChange: (e) => onChange(e.target.checked) }),
    h("i", null),
  );
}

export function Seg({ value, options, onChange }) {
  return h(
    "div",
    { className: "ght-seg" },
    options.map(([v, label]) =>
      h(
        "button",
        {
          key: String(v),
          type: "button",
          className: cx(String(value) === String(v) && "on"),
          onClick: () => onChange(v),
        },
        label,
      ),
    ),
  );
}

export function Section({ id, title, sub, children }) {
  return h(
    "div",
    { className: "ght-sec", "data-sec": id, id: `ght-sec-${id}` },
    h("div", { className: "ght-sec-h2" }, h("h4", null, title), sub ? h("span", null, sub) : null),
    h("div", { className: "ght-sec-box" }, children),
  );
}
