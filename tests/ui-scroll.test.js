/** 滚动位置记忆：宿主重挂面板 / 内容塌陷后用户不该被扔回顶部。
 *  jsdom 没有布局，滚动尺寸用 defineProperty 造出来。 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const React = require("react");
const ReactDOM = require("react-dom/client");
const { act } = require("react-dom/test-utils");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
Object.defineProperty(globalThis, "Node", { value: dom.window.Node, configurable: true });
Object.defineProperty(globalThis, "MutationObserver", {
  value: dom.window.MutationObserver,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { bindReact } = await import("../src/ui/react.js");
const { h } = await import("../src/ui/common.js");
const { useScrollMemory } = await import("../src/ui/scroll.js");

bindReact(React);

/** 给定滚动尺寸的滚动容器；尺寸可变，用来模拟内容塌陷 / 长回来。 */
function layoutBox(el, height) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height.content });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => height.viewport });
}

function mountBox(key) {
  const box = { content: 2000, viewport: 400 };
  let node = null;
  function Box() {
    const ref = useScrollMemory(key);
    React.useEffect(() => {
      node = ref.current;
    });
    return h("div", { ref, className: "scroll-box" });
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const render = () => act(async () => root.render(h(Box)));
  return {
    box,
    render,
    unmount: () => act(async () => root.unmount()),
    node: () => node,
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

test("重挂面板后回到原来的滚动位置", async () => {
  const first = mountBox("t:remount");
  await first.render();
  layoutBox(first.node(), first.box);
  first.node().scrollTop = 1200;
  await act(async () => {
    first.node().dispatchEvent(new dom.window.Event("scroll"));
  });
  await first.unmount();

  const second = mountBox("t:remount");
  await second.render();
  layoutBox(second.node(), second.box);
  await settle();
  assert.equal(second.node().scrollTop, 1200);
  await second.unmount();
});

test("内容塌陷的钳位不覆盖位置，长回来再恢复", async () => {
  const box = mountBox("t:collapse");
  await box.render();
  layoutBox(box.node(), box.box);
  box.node().scrollTop = 1800;
  await act(async () => {
    box.node().dispatchEvent(new dom.window.Event("scroll"));
  });

  // 列表短暂为空：内容比视口还短，浏览器把 scrollTop 钳成 0。
  box.box.content = 300;
  box.node().scrollTop = 0;
  await act(async () => {
    box.node().dispatchEvent(new dom.window.Event("scroll"));
  });

  // 内容长回来：列又能滚了，位置应当补回来。
  box.box.content = 2000;
  await act(async () => {
    box.node().appendChild(document.createElement("span"));
  });
  await settle();
  assert.equal(box.node().scrollTop, 1800);
  await box.unmount();
});

test("用户自己滚到顶部后，重挂不会把人拽回底部", async () => {
  const first = mountBox("t:user-top");
  await first.render();
  layoutBox(first.node(), first.box);
  first.node().scrollTop = 1500;
  await act(async () => {
    first.node().dispatchEvent(new dom.window.Event("scroll"));
  });
  first.node().scrollTop = 0;
  await act(async () => {
    first.node().dispatchEvent(new dom.window.Event("scroll"));
  });
  await first.unmount();

  const second = mountBox("t:user-top");
  await second.render();
  layoutBox(second.node(), second.box);
  await settle();
  assert.equal(second.node().scrollTop, 0);
  await second.unmount();
});
