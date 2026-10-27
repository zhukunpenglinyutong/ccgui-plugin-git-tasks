/** 极简双语：`t(zh, en)`。宿主 SDK 没有插件侧查表 API（i18n 只能注册资源），
 *  与旧 git-tasks 在宿主上验证过的做法一致。至少覆盖 zh-CN 与 en。 */

export function isEnglish(locale) {
  return !/^zh/i.test(String(locale || ""));
}

export function createT(locale) {
  const en = isEnglish(locale);
  return (zh, enText) => (en ? enText ?? zh : zh);
}

/** 英文下的默认状态名（≤6 字符，与中文默认同名位）。 */
/** 宿主把侧栏徽标截到 6 码点，且插件可能在后面拼 `·2d`；英文默认名
 *  必须留出预算，否则会出现 `Approv` 这类截断。 */
export const DEFAULT_DEFS_EN = {
  needs_review: { label: "New", tone: "blue", owner: "me", badge: true },
  reviewing: { label: "Rev", tone: "cyan", owner: "me", badge: true },
  changes_requested: { label: "Chg", tone: "yellow", owner: "author", badge: true },
  needs_rereview: { label: "Re", tone: "rose", owner: "me", badge: true },
  approved: { label: "OK", tone: "green", owner: "merge", badge: true },
  draft: { label: "Draft", tone: "neutral", owner: "author", badge: false },
  merged: { label: "Merge", tone: "purple", owner: "done", badge: true },
  closed: { label: "Closed", tone: "neutral", owner: "done", badge: true },
  done: { label: "Done", tone: "lime", owner: "done", badge: true },
};

export const OWNER_LABELS_EN = { me: "You", author: "Author", merge: "Merge", done: "Done" };

export function ownerLabel(owner, t) {
  return t(
    { me: "等我", author: "等作者", merge: "等合并", done: "已结束" }[owner] || owner,
    OWNER_LABELS_EN[owner] || owner,
  );
}
