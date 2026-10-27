/** 滚动位置记忆。
 *
 * 宿主新建 / 删除 worktree、同步结果回写、徽标刷新都会让面板重渲染；一旦
 * 面板整棵树被重挂（宿主切面、插件重载）或者内容高度瞬间塌陷（行列表短暂
 * 为空、宿主把面藏起来再放出来），浏览器会把 scrollTop 钳回 0——用户刚滚到
 * 底部的看板列、面板主体就"跳回顶部"，再也找不到原来的位置。
 *
 * 这里把每个滚动容器（面板主体、看板每列）的 scrollTop 记在内存 + session
 * Storage（模块重新求值也还在），重挂后恢复；内容塌陷导致的钳位不覆盖旧值，
 * 等内容长回来再补一次。用户的真实滚动（滚轮 / 触摸 / 拖滚动条 / 键盘）
 * 优先，绝不在用户动手后把他们拽回去。
 */

import { React } from "./react.js";

const PREFIX = "ght.scroll.";
const memory = new Map();
const pending = new Map();
let flushTimer = null;

function readPos(key) {
  if (memory.has(key)) return memory.get(key);
  let value = 0;
  try {
    value = Number(sessionStorage.getItem(PREFIX + key)) || 0;
  } catch {
    value = 0;
  }
  memory.set(key, value);
  return value;
}

function flush() {
  flushTimer = null;
  if (!pending.size) return;
  try {
    for (const [key, value] of pending) sessionStorage.setItem(PREFIX + key, String(value));
  } catch {
    // 隐私模式等写不进去：内存里的值仍然够本次会话恢复用。
  }
  pending.clear();
}

function writePos(key, value) {
  if (readPos(key) === value) return;
  memory.set(key, value);
  pending.set(key, value);
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flush, 150);
}

if (typeof window !== "undefined") window.addEventListener("pagehide", flush);

const INPUT_EVENTS = ["wheel", "touchmove", "pointerdown", "keydown"];
/** 用户动手后的这段时间里不做恢复，免得把正在滚的人拽回去。 */
const INPUT_GRACE_MS = 400;

const raf =
  typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16);
const cancelRaf =
  typeof cancelAnimationFrame === "function" ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

/** 绑定一个滚动容器的位置记忆；返回 ref，挂到真正的滚动元素上。 */
export function useScrollMemory(key) {
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let lastInput = 0;
    let queued = 0;
    const restore = () => {
      const saved = readPos(key);
      if (saved <= 0) return;
      if (Math.abs(el.scrollTop - saved) < 1) return;
      // 内容还短时浏览器会自己钳到最大可滚距离；长回来再补一次即可。
      el.scrollTop = saved;
    };
    const restoreIfIdle = () => {
      if (Date.now() - lastInput < INPUT_GRACE_MS) return;
      if (queued) return;
      queued = raf(() => {
        queued = 0;
        restore();
      });
    };
    const onScroll = () => {
      // 内容比容器矮时 scrollTop 只能是 0：这是高度塌陷的钳位，不是用户滚到顶，
      // 保留旧位置，等内容长回来再恢复。
      if (el.scrollTop === 0 && el.scrollHeight <= el.clientHeight + 1) return;
      writePos(key, el.scrollTop);
    };
    const markInput = () => {
      lastInput = Date.now();
    };
    restore();
    el.addEventListener("scroll", onScroll, { passive: true });
    for (const type of INPUT_EVENTS) el.addEventListener(type, markInput, { passive: true });
    const resize =
      typeof ResizeObserver === "function" ? new ResizeObserver(restoreIfIdle) : null;
    if (resize) resize.observe(el);
    const mutate =
      typeof MutationObserver === "function"
        ? new MutationObserver(restoreIfIdle)
        : null;
    if (mutate) mutate.observe(el, { childList: true, subtree: true });
    return () => {
      if (queued) cancelRaf(queued);
      el.removeEventListener("scroll", onScroll);
      for (const type of INPUT_EVENTS) el.removeEventListener(type, markInput);
      if (resize) resize.disconnect();
      if (mutate) mutate.disconnect();
      flush();
    };
  }, [key]);
  return ref;
}
