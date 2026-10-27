/** 宿主注入的 React 实例（Tier-1 插件不得自带 React）。 */

export let React = null;

export function bindReact(instance) {
  React = instance;
}
