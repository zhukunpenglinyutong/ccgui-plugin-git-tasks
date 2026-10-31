/** 设置：插件页签内的弹窗；同一组件也注册到「客户端设置 › 插件」。
 *  每个分区是独立组件，避免一个函数承担整页。 */

import { React } from "./react.js";
import { Icon, cx, h } from "./common.js";
import { DEFAULT_DEFS, STATUS_ORDER, TONES } from "../constants.js";
import { ownerLabel } from "../i18n.js";
import { AutomationSection } from "./AutomationSection.js";
import { Row, Section, Seg, Switch } from "./settingsKit.js";

const pad = (n) => String(n).padStart(2, "0");

const SECTIONS = [
  ["src", "数据来源", "Data source"],
  ["scope", "跟踪范围", "Scope"],
  ["rules", "状态判定", "Verdicts"],
  ["timeout", "超时提醒", "Overdue"],
  ["look", "状态外观", "Appearance"],
  ["board", "看板", "Board"],
  ["wt", "Worktree 徽标", "Worktree badges"],
  ["sync", "同步与统计", "Sync & stats"],
  ["auto", "自动化", "Automation"],
  ["local", "本地数据", "Local data"],
  ["roadmap", "路线图", "Roadmap"],
];

function Num({ value, onChange, suffix }) {
  return h(
    "span",
    { className: "ght-inline" },
    h("input", {
      className: "ght-numin",
      type: "number",
      min: 0,
      max: 99,
      value,
      onChange: (event) => onChange(Math.max(0, Math.min(99, Number(event.target.value) || 0))),
    }),
    suffix,
  );
}

function TagsInput({ t, values, onChange, placeholder }) {
  const [draft, setDraft] = React.useState("");
  return h(
    "div",
    { className: "ght-tags" },
    values.map((value) =>
      h(
        "span",
        { key: value, className: "ght-tagx" },
        value,
        h(
          "button",
          { type: "button", "aria-label": t("移除", "Remove"), onClick: () => onChange(values.filter((v) => v !== value)) },
          "×",
        ),
      ),
    ),
    h("input", {
      className: "ght-tag-in",
      value: draft,
      placeholder,
      onChange: (event) => setDraft(event.target.value),
      onKeyDown: (event) => {
        if (event.key !== "Enter") return;
        const next = draft.trim().replace(/^@/, "");
        if (next && !values.includes(next)) onChange([...values, next]);
        setDraft("");
      },
    }),
  );
}

function RepoLines({ t, store, state }) {
  if (!state.cfg.repos.length) {
    return h("div", { className: "ght-src" }, t("还没有发现 GitHub 仓库", "No GitHub repos discovered"));
  }
  return h(
    "div",
    { className: "ght-repo-list" },
    state.cfg.repos.map((repo) =>
      h(
        "div",
        { key: repo.slug, className: "ght-repo-line" },
        h(Switch, {
          checked: repo.enabled && repo.available,
          label: repo.slug,
          onChange: (checked) => {
            store.setRepos(
              state.cfg.repos.map((r) => (r.slug === repo.slug ? { ...r, enabled: checked } : r)),
            );
          },
        }),
        h("span", { className: "ght-mono" }, repo.slug),
        h("span", { className: "ght-src" }, repo.available ? t("来自工作区", "from workspace") : t("工作区未打开", "workspace closed")),
        h("span", { className: "ght-sp" }),
        h(
          "span",
          { className: "ght-src" },
          repo.available ? (repo.enabled ? t("已跟踪", "tracked") : t("未跟踪", "paused")) : "—",
        ),
      ),
    ),
  );
}

function SourceSection({ t, store, state, index }) {
  void index;
  return h(
    Section,
    { id: "src", title: t("数据来源", "Data source"), sub: t("只读，不会往 GitHub 写任何东西", "read-only") },
    h(
      Row,
      { label: "gh CLI", hint: t("用本机 gh 的登录态读取 PR、Review、提交和时间线", "reads PRs, reviews, commits and timeline via local gh") },
      state.runtime.ghLogin
        ? h("span", { className: "ght-gh-ok" }, h("i", null), `@${state.runtime.ghLogin}`)
        : h("span", { className: "ght-src" }, state.runtime.ghError || t("未连接", "not connected")),
    ),
    h(Row, {
      label: t("跟踪的仓库", "Tracked repositories"),
      hint: t("颜色按这里的顺序固定分配，停用某个仓库不会让别的仓库换色。", "Colors follow this order; pausing a repo doesn't recolor others."),
      stack: true,
    }, h(RepoLines, { t, store, state })),
    h(Row, {
      label: t("我的账号", "My accounts"),
      hint: t("“我审查过”只认这些账号。默认是 gh 当前登录账号。", "Only these accounts count as you."),
      stack: true,
    }, h(TagsInput, {
      t,
      values: state.cfg.extraAccounts,
      placeholder: t("+ 附加账号，回车", "+ extra account, Enter"),
      onChange: (list) => store.setExtraAccounts(list),
    })),
  );
}

function ScopeSection({ t, store, rules }) {
  return h(
    Section,
    { id: "scope", title: t("跟踪范围", "Scope") },
    h(Row, { label: t("哪些 PR", "Which PRs") },
      h(Seg, {
        value: rules.scope,
        options: [["all", t("仓库所有 open PR", "All open PRs")], ["mine", t("请求我审查的 / 我参与过的", "Requested / participated")]],
        onChange: (v) => store.setRules({ scope: v }),
      }),
    ),
    h(Row, { label: t("包含草稿", "Include drafts"), hint: t("草稿放在「待审查」列底部", "Drafts sit at the bottom of Review") },
      h(Switch, { checked: rules.includeDraft, label: "includeDraft", onChange: (v) => store.setRules({ includeDraft: v }) }),
    ),
    h(Row, { label: t("排除我自己开的 PR", "Exclude my own PRs") },
      h(Switch, { checked: rules.excludeMine, label: "excludeMine", onChange: (v) => store.setRules({ excludeMine: v }) }),
    ),
    h(Row, { label: t("排除这些作者", "Excluded authors"), hint: t("机器人 PR 默认不跟踪", "Bot PRs are excluded by default"), stack: true },
      h(TagsInput, {
        t,
        values: rules.excludeAuthors,
        placeholder: t("+ 作者名，回车", "+ author, Enter"),
        onChange: (list) => store.setRules({ excludeAuthors: list }),
      }),
    ),
  );
}

function FixChecks({ t, store, rules }) {
  const ck = (checked, onChange, label, small) =>
    h(
      "label",
      { className: "ght-ck" },
      h("input", { type: "checkbox", checked, disabled: !onChange, onChange: (e) => onChange?.(e.target.checked) }),
      label,
      small ? h("small", null, small) : null,
    );
  return h(
    "div",
    { className: "ght-checks" },
    ck(true, null, t("我审查之后 head SHA 变了（推送 / force-push / rebase）", "head SHA changed since my review"), t("始终开启", "always on")),
    ck(true, null, t("我在看板上拖到「待复审」", "I dragged it to Recheck"), t("始终开启", "always on")),
    ck(rules.rerequest, (v) => store.setRules({ rerequest: v }), t("作者重新请求我审查", "Author re-requested my review")),
    ck(rules.authorReply, (v) => store.setRules({ authorReply: v }), t("作者回复了我的评论", "Author replied"), t("容易误判，默认关", "noisy, off by default")),
    ck(rules.ignoreMergeBase, (v) => store.setRules({ ignoreMergeBase: v }), t("忽略“仅合并主干”的提交", "Ignore merge-base commits")),
  );
}

function RulesSection({ t, store, rules, counts }) {
  return h(
    Section,
    { id: "rules", title: t("状态判定", "Verdicts"), sub: t("决定 PR 落在哪一列", "decides the column") },
    h(
      "div",
      { className: "ght-effect" },
      t("按当前规则：", "Now: "),
      h("b", null, t(`等我处理 ${counts.mine}`, `yours ${counts.mine}`)),
      t(
        `（待审查 ${counts.needs_review} · 审查中 ${counts.reviewing} · 待复审 ${counts.needs_rereview}）`,
        ` (new ${counts.needs_review} · reviewing ${counts.reviewing} · recheck ${counts.needs_rereview})`,
      ),
      " · ",
      t(`等作者 ${counts.author}`, `author ${counts.author}`),
      " · ",
      t(`等合并 ${counts.merge}`, `merge ${counts.merge}`),
    ),
    h(Row, { label: t("只留了 Comment 的 Review", "Comment-only reviews"), hint: t("很多人提意见只点 Comment 不点 Request changes", "Comment-only reviews often mean changes") },
      h(Seg, { value: rules.commentReview, options: [["changes", t("算要求修复", "Count as changes")], ["ignore", t("不算审查", "Ignore")]], onChange: (v) => store.setRules({ commentReview: v }) }),
    ),
    h(Row, { label: t("我在 PR 下的普通评论", "Plain comments by me"), hint: t("普通评论常常只是提问，默认不算审查", "Usually just questions") },
      h(Seg, { value: rules.plainComment, options: [["ignore", t("不算审查", "Ignore")], ["changes", t("算要求修复", "Count as changes")]], onChange: (v) => store.setRules({ plainComment: v }) }),
    ),
    h(Row, { label: t("怎样算“作者修复了”", "What counts as a fix"), hint: t("满足任意一条，待修复 → 待复审。新提交以 head SHA 是否变化为准。", "Any of these moves Changes → Recheck. New code is SHA-based."), stack: true },
      h(FixChecks, { t, store, rules }),
    ),
    h(Row, { label: t("Approve 之后又有新提交", "New commits after approval") },
      h(Seg, { value: rules.approveThenCommit, options: [["rereview", t("回到待复审", "Back to Recheck")], ["keep", t("保持已通过", "Keep approved")]], onChange: (v) => store.setRules({ approveThenCommit: v }) }),
    ),
  );
}

function TimeoutSection({ t, store, rules }) {
  return h(
    Section,
    { id: "timeout", title: t("超时提醒", "Overdue"), sub: t("只在看板和徽标上标出来，不发通知", "visual only") },
    h(Row, { label: t("待审查超过", "Review idle for") }, h(Num, { value: rules.overdueReview, onChange: (v) => store.setRules({ overdueReview: v }), suffix: t("天", "days") })),
    h(Row, { label: t("待复审超过", "Recheck idle for"), hint: t("作者已经改完在等你，阈值建议更短", "author is waiting on you") }, h(Num, { value: rules.overdueRereview, onChange: (v) => store.setRules({ overdueRereview: v }), suffix: t("天", "days") })),
    h(Row, { label: t("待修复超过", "Changes idle for"), hint: t("标「作者沉默」", "marks the PR silent") }, h(Num, { value: rules.silentDays, onChange: (v) => store.setRules({ silentDays: v }), suffix: t("天", "days") })),
  );
}

function StatusRow({ t, store, defs, statusKey }) {
  const def = defs[statusKey];
  return h(
    "tr",
    null,
    h("td", null, h("span", { className: `ght-chip ght-tone-${def.tone}` }, def.label)),
    h("td", null, h("input", {
      className: "ght-lbl-in",
      maxLength: 6,
      value: def.label,
      onChange: (e) => store.setDef(statusKey, { label: e.target.value.slice(0, 6) || DEFAULT_DEFS[statusKey].label }),
    })),
    h("td", null, h("div", { className: "ght-swatches" }, TONES.map((tone) =>
      h("button", {
        key: tone,
        type: "button",
        title: tone,
        className: cx("ght-swatch", `ght-tone-${tone}`, def.tone === tone && "on"),
        onClick: () => store.setDef(statusKey, { tone }),
      }),
    ))),
    h("td", null, h(Switch, { checked: def.badge, label: `${statusKey} badge`, onChange: (v) => store.setDef(statusKey, { badge: v }) })),
    h("td", { className: "ght-owner" }, ownerLabel(def.owner, t)),
  );
}

function LookSection({ t, store, defs }) {
  return h(
    Section,
    { id: "look", title: t("状态外观", "Appearance"), sub: t("名称和颜色由插件定义；客户端只负责画", "names and tones are plugin-defined") },
    h(
      "table",
      { className: "ght-st-table" },
      h("thead", null, h("tr", null,
        h("th", null, t("预览", "Preview")),
        h("th", null, t("名称（≤6 字）", "Label")),
        h("th", null, t("颜色（宿主状态色）", "Tone")),
        h("th", null, t("上侧栏徽标", "Badge")),
        h("th", null, t("归属", "Owner")),
      )),
      h("tbody", null, STATUS_ORDER.map((statusKey) => h(StatusRow, { key: statusKey, t, store, defs, statusKey }))),
    ),
  );
}

function BoardSection({ t, store, rules, state, toast }) {
  const hasOrder = Object.keys(state.local.order).length > 0;
  return h(
    Section,
    { id: "board", title: t("看板", "Board") },
    h(Row, { label: t("「已结束」列显示最近", "Show finished items from"), hint: t("更早的合并 / 关闭不占地方", "older items are hidden") },
      h(Num, { value: rules.endedDays, onChange: (v) => store.setRules({ endedDays: v }), suffix: t("天", "days") }),
    ),
    h(Row, { label: t("跨列拖拽", "Cross-column drag"), hint: t("只在本地记一笔标记，不写 GitHub；放下后 5 秒内可撤销", "local only, undoable for 5s") },
      h("span", { className: "ght-owner" }, t("直接生效 · 可撤销", "applies immediately")),
    ),
    h(Row, { label: t("清空手动排序", "Clear manual order") },
      h("button", {
        type: "button",
        className: "ght-btn",
        disabled: !hasOrder,
        onClick: () => {
          ["review", "fix", "rereview", "approved", "ended"].forEach((k) => store.setOrder(k, []));
          toast(t("已清空手动排序", "Manual order cleared"));
        },
      }, t("清空", "Clear")),
    ),
  );
}

function BadgeSection({ t, store, rules }) {
  return h(
    Section,
    { id: "wt", title: t("Worktree 徽标", "Worktree badges") },
    h(Row, { label: t("显示状态徽标", "Show status badges"), hint: t("在 worktree 分支名后面、PR# 前面", "after the branch label, before PR#") },
      h(Switch, { checked: rules.badgeEnabled, label: "badgeEnabled", onChange: (v) => store.setRules({ badgeEnabled: v }) }),
    ),
    h(Row, { label: t("徽标上显示停留时长", "Show age on badge") },
      h(Seg, { value: rules.badgeAge, options: [["never", t("不显示", "Never")], ["overdue", t("仅超时", "Overdue only")], ["always", t("总是", "Always")]], onChange: (v) => store.setRules({ badgeAge: v }) }),
    ),
    h(Row, { label: t("怎样把 worktree 对应到 PR", "How worktrees map to PRs"), stack: true },
      h("div", { className: "ght-checks" },
        h("label", { className: "ght-ck" }, h("input", { type: "checkbox", checked: true, disabled: true }), t("手动绑定的", "Manual bindings"), h("small", null, t("始终优先", "always first"))),
        h("label", { className: "ght-ck" }, h("input", { type: "checkbox", checked: rules.linkByPr, onChange: (e) => store.setRules({ linkByPr: e.target.checked }) }), t("客户端「从 PR 创建」时记录的 PR 号", "PR number recorded by the host")),
        h("label", { className: "ght-ck" }, h("input", { type: "checkbox", checked: rules.linkByBranch, onChange: (e) => store.setRules({ linkByBranch: e.target.checked }) }), t("分支名和 PR 的 head 分支一致", "branch equals the PR head branch")),
      ),
    ),
    h(Row, { label: t("点击徽标", "Badge click") },
      h(Seg, { value: rules.badgeClick, options: [["detail", t("打开流转详情", "Open details")], ["github", t("在 GitHub 打开", "Open GitHub")]], onChange: (v) => store.setRules({ badgeClick: v }) }),
    ),
    h(Row, { label: t("侧栏入口显示待办数", "Sidebar count") },
      h(Switch, { checked: rules.navCount, label: "navCount", onChange: (v) => store.setRules({ navCount: v }) }),
    ),
  );
}

function SyncSection({ t, store, rules, state, onSync }) {
  return h(
    Section,
    { id: "sync", title: t("同步与统计", "Sync & stats") },
    h(Row, { label: t("自动同步", "Auto sync"), hint: t("每个仓库每次约 2–4 次 gh 调用", "2–4 gh calls per repo") },
      h("select", { className: "ght-sel", value: rules.interval, onChange: (e) => store.setRules({ interval: e.target.value }) },
        [["5", t("每 5 分钟", "Every 5 min")], ["15", t("每 15 分钟", "Every 15 min")], ["30", t("每 30 分钟", "Every 30 min")], ["60", t("每小时", "Hourly")], ["0", t("仅手动", "Manual only")]].map(([v, label]) => h("option", { key: v, value: v }, label)),
      ),
    ),
    h(Row, { label: t("仅在窗口激活时同步", "Only when foreground") },
      h(Switch, { checked: rules.foregroundOnly, label: "foregroundOnly", onChange: (v) => store.setRules({ foregroundOnly: v }) }),
    ),
    h(Row, { label: t("每天从几点算起", "Day starts at"), hint: t("影响「今日新增」「今日流转」和每日统计", "affects today metrics") },
      h("select", { className: "ght-sel", value: String(rules.dayCutoff), onChange: (e) => store.setRules({ dayCutoff: Number(e.target.value) }) },
        [0, 4, 6].map((hour) => h("option", { key: hour, value: String(hour) }, `${pad(hour)}:00`)),
      ),
    ),
    h(Row, { label: t("立即同步", "Sync now"), hint: state.runtime.lastSync ? `${t("上次", "Last")} ${new Date(state.runtime.lastSync).toLocaleString()}` : t("还没同步过", "Never synced") },
      h("button", { type: "button", className: "ght-btn", onClick: onSync, disabled: state.runtime.syncing }, h(Icon, { name: "refresh", size: 13 }), t("同步", "Sync")),
    ),
  );
}

function LocalSection({ t, store, state, toast }) {
  const marks = Object.values(state.local.marks).reduce((a, list) => a + list.length, 0);
  const binds = Object.keys(state.local.bindings).length;
  const ignored = state.local.ignored.length;
  return h(
    Section,
    { id: "local", title: t("本地数据", "Local data") },
    h(Row, { label: t("手动标记、worktree 绑定与忽略", "Marks, bindings and ignores"), hint: t(`标记 ${marks} 条（含拖拽）· 绑定 ${binds} 个 · 忽略 ${ignored} 个 PR`, `${marks} marks · ${binds} bindings · ${ignored} ignored`) },
      h("button", { type: "button", className: "ght-btn", disabled: !(marks || binds || ignored), onClick: () => { store.clearLocal(); toast(t("已清空本地标记、绑定和忽略", "Local data cleared")); } }, t("清空", "Clear")),
    ),
    h(Row, { label: t("恢复默认设置", "Restore defaults") },
      h("button", { type: "button", className: "ght-btn", onClick: () => { store.resetConfig(); toast(t("已恢复默认设置", "Defaults restored")); } }, t("恢复默认", "Restore")),
    ),
  );
}

const ROADMAP = [
  {
    key: "gitlab",
    tone: "blue",
    status: ["规划中", "Planned"],
    title: ["GitLab 支持", "GitLab support"],
    desc: [
      "用 glab 读取 GitLab MR 的审查 / 批准 / 提交与时间线，复用同一套流转看板；需要先确认 gitlab.com 与自建实例的登录方式和 MR 审查语义映射。",
      "Read GitLab MR reviews, approvals, commits and timeline via glab and reuse the same flow board. Needs decisions on gitlab.com vs self-hosted auth and MR review mapping.",
    ],
  },
  {
    key: "ai",
    tone: "blue",
    status: ["规划中", "Planned"],
    title: ["AI 自动审查", "AI pre-review"],
    desc: [
      "后台用一个只读 AI 轮次给出预审建议，结果只展示、不自动提交审查；需要额外的模型/会话权限。",
      "A read-only AI turn drafts review suggestions. Suggestions are shown only, never submitted automatically.",
    ],
  },
  {
    key: "write",
    tone: "neutral",
    status: ["后续", "Later"],
    title: ["自动评论 / 批准 / 合并", "Auto comment / approve / merge"],
    desc: [
      "需要显式授权与二次确认，默认关闭；当前插件对 GitHub 只读。",
      "Requires explicit opt-in and confirmation, off by default. The plugin is read-only today.",
    ],
  },
  {
    key: "notify",
    tone: "neutral",
    status: ["后续", "Later"],
    title: ["系统通知", "System notifications"],
    desc: [
      "飞书每小时汇总已在「自动化」里提供；系统通知（PR 超时、作者修复时即时弹出）仍在规划。",
      "The hourly Feishu digest ships under Automation; instant system notifications are still planned.",
    ],
  },
  {
    key: "dragwrite",
    tone: "neutral",
    status: ["后续", "Later"],
    title: ["拖拽触发 GitHub 操作", "Drag to write GitHub"],
    desc: [
      "看板拖拽直接 Request changes / Approve。当前拖拽只记本地标记，可撤销、不写 GitHub。",
      "Dragging would Request changes / Approve on GitHub. Today it only records a local, undoable mark.",
    ],
  },
  {
    key: "issue",
    tone: "neutral",
    status: ["后续", "Later"],
    title: ["Issue 看板", "Issue board"],
    desc: [
      "把 Issue 也纳入同一套流转视图，与 PR 分开统计。",
      "Bring issues into the same flow view, counted separately from PRs.",
    ],
  },
];

function RoadmapItem({ t, item }) {
  return h(
    "div",
    { className: "ght-roadmap-item" },
    h(
      "div",
      { className: "ght-roadmap-body" },
      h(
        "div",
        { className: "ght-roadmap-title" },
        t(item.title[0], item.title[1]),
        h("span", { className: `ght-chip ght-chip-sm ght-tone-${item.tone}` }, t(item.status[0], item.status[1])),
      ),
      h("div", { className: "ght-roadmap-desc" }, t(item.desc[0], item.desc[1])),
    ),
  );
}

function RoadmapSection({ t }) {
  return h(
    Section,
    { id: "roadmap", title: t("路线图", "Roadmap"), sub: t("尚未实现，不会申请对应权限", "Not implemented yet; no extra permissions requested") },
    h(
      "div",
      { className: "ght-roadmap" },
      ROADMAP.map((item) => h(RoadmapItem, { key: item.key, t, item })),
      h(
        "div",
        { className: "ght-roadmap-note" },
        t(
          "路线图会随版本更新；实现前不会在 manifest 里申请这些能力。",
          "This list evolves; capabilities are not requested in the manifest before they ship.",
        ),
      ),
    ),
  );
}

function SettingsNav({ t, active, onPick }) {
  return h(
    "nav",
    { className: "ght-m-nav" },
    SECTIONS.map(([key, zh, en]) =>
      h("button", { key, type: "button", className: cx(active === key && "on"), onClick: () => onPick(key) }, t(zh, en)),
    ),
  );
}

function useSectionSpy(active, setActive) {
  const bodyRef = React.useRef(null);
  const scrollTo = (id) => {
    setActive(id);
    const body = bodyRef.current;
    const target = body?.querySelector(`[data-sec="${id}"]`);
    if (!body || !target) return;
    if (typeof body.scrollTo === "function") {
      body.scrollTo({ top: target.offsetTop - 12, behavior: "smooth" });
    } else {
      body.scrollTop = target.offsetTop - 12;
    }
  };
  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    let current = SECTIONS[0][0];
    body.querySelectorAll("[data-sec]").forEach((el) => {
      if (el.offsetTop - body.scrollTop <= 40) current = el.dataset.sec;
    });
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) {
      current = SECTIONS[SECTIONS.length - 1][0];
    }
    if (current !== active) setActive(current);
  };
  return { bodyRef, scrollTo, onScroll };
}

export function SettingsBody({ t, ctx, store, index, rules, defs, counts, now, toast, onSync, auto, digest }) {
  void ctx;
  void now;
  const [active, setActive] = React.useState("src");
  const state = store.getSnapshot();
  const { bodyRef, scrollTo, onScroll } = useSectionSpy(active, setActive);
  const shared = { t, store, state, rules, defs, counts, toast, onSync };
  return h(
    "div",
    { className: "ght-set-main" },
    h(SettingsNav, { t, active, onPick: scrollTo }),
    h(
      "div",
      { className: "ght-m-body", ref: bodyRef, onScroll },
      h(SourceSection, { ...shared, index }),
      h(ScopeSection, shared),
      h(RulesSection, shared),
      h(TimeoutSection, shared),
      h(LookSection, shared),
      h(BoardSection, shared),
      h(BadgeSection, shared),
      h(SyncSection, shared),
      h(AutomationSection, { ...shared, auto, digest }),
      h(LocalSection, shared),
      h(RoadmapSection, { t }),
      h("div", { className: "ght-m-foot-note" }, t("同一份设置也在「客户端设置 › 插件 › CCGUI · Git 任务管理」", "The same settings live under Settings › Plugins")),
    ),
  );
}

export function SettingsModal({ t, ctx, store, index, rules, defs, counts, now, toast, onClose, onSync, auto, digest }) {
  return [
    h("div", { key: "scrim", className: "ght-mscrim", onClick: onClose }),
    h(
      "div",
      { key: "modal", className: "ght-modal ght-set-modal", role: "dialog", "aria-label": t("设置", "Settings") },
      h(
        "div",
        { className: "ght-m-head" },
        h("div", null, h("b", null, t("设置 · Git 任务管理", "Settings · Git Tasks")), h("div", { className: "ght-m-sub" }, t("改动即时生效 —— 弹窗后面的看板、左侧侧栏徽标会跟着变", "Changes apply immediately"))),
        h("span", { className: "ght-sp" }),
        h("button", { type: "button", className: "ght-icon-btn ght-bare", onClick: onClose, title: t("关闭（Esc）", "Close (Esc)") }, h(Icon, { name: "x", size: 15 })),
      ),
      h(SettingsBody, { t, ctx, store, index, rules, defs, counts, now, toast, onSync, auto, digest }),
      h("div", { className: "ght-m-foot" }, h("span", { className: "ght-m-note" }, t("只读 gh · 不写 GitHub · 飞书汇总需手动开启", "read-only gh · no GitHub writes · Feishu digest is opt-in")), h("span", { className: "ght-sp" }), h("button", { type: "button", className: "ght-btn ght-btn-pri", onClick: onClose }, t("完成", "Done"))),
    ),
  ];
}
