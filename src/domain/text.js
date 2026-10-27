/** 文案：事件、为什么、下一步（纯函数）。`t(zh, en)` 由调用方注入。 */

import { DAY, HOUR, MARK_TEXT, MINUTE } from "../constants.js";
import { formatDuration, verdictOf } from "./derive.js";

const zhOnly = (zh) => zh;
const pad = (n) => String(n).padStart(2, "0");
const VERB = ["Approve", "Request changes", "Comment"];
const VERB_EN = ["approved", "requested changes", "commented"];
const MARK_EN = {
  changes: "Reviewed · changes needed",
  approve: "Reviewed · looks good",
  reset: "Withdrew the previous verdict",
  fixed: "Author fixed it (confirmed)",
  done: "Marked done",
};

export const prUrl = (pr) => `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;

export function compareUrl(pr, from, to) {
  return `https://github.com/${pr.owner}/${pr.repo}/compare/${from}...${to}`;
}

export function filesUrl(pr) {
  return `${prUrl(pr)}/files`;
}

function localMidnight(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function fmtAbs(ms, now = Date.now(), t = zhOnly) {
  const d = new Date(ms);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = localMidnight(now);
  if (ms >= today) return `${t("今天", "Today")} ${hm}`;
  if (ms >= today - DAY) return `${t("昨天", "Yesterday")} ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export function fmtRel(ms, now = Date.now(), t = zhOnly) {
  const x = now - ms;
  if (x < MINUTE) return t("刚刚", "just now");
  if (x < HOUR) return t(`${Math.floor(x / MINUTE)} 分钟前`, `${Math.floor(x / MINUTE)}m ago`);
  if (x < DAY) return t(`${Math.floor(x / HOUR)} 小时前`, `${Math.floor(x / HOUR)}h ago`);
  return t(`${Math.floor(x / DAY)} 天前`, `${Math.floor(x / DAY)}d ago`);
}

export function duration(ms, t = zhOnly) {
  const zh = formatDuration(ms);
  if (ms < MINUTE) return t(zh, "just now");
  if (ms < HOUR) return t(zh, `${Math.floor(ms / MINUTE)}m`);
  if (ms < DAY) return t(zh, `${Math.floor(ms / HOUR)}h`);
  return t(zh, zh.replace("天", "d").replace("小时", "h"));
}

export function dateLabel(ms, t = zhOnly) {
  const d = new Date(ms);
  const week = t("日一二三四五六", "SMTWTFS")[d.getDay()];
  return t(
    `${d.getMonth() + 1}/${d.getDate()} 周${week}`,
    `${d.getMonth() + 1}/${d.getDate()} ${week}`,
  );
}

function verbOf(e, t) {
  const index = e.state === "APPROVED" ? 0 : e.state === "CHANGES_REQUESTED" ? 1 : 2;
  return t(VERB[index], VERB_EN[index]);
}

function isGithubAuthorUpdate(e, rules) {
  if (e.type === "commit") return true;
  if (e.type === "rerequest") return rules.rerequest;
  if (e.type === "comment" && e.isAuthor) return rules.authorReply;
  return false;
}

function reviewText(pr, e, rules, t) {
  if (!e.mine) {
    return {
      text: t(`${e.by} ${verbOf(e, t)}`, `${e.by} ${verbOf(e, t)}`),
      note: t("他人审查，仅展示", "someone else's review, shown for context"),
      muted: true,
    };
  }
  const counted = !!verdictOf(e, rules);
  return {
    text: t(
      `你 ${verbOf(e, t)}${e.comments ? ` · ${e.comments} 条评论` : ""}`,
      `You ${verbOf(e, t)}${e.comments ? ` · ${e.comments} comments` : ""}`,
    ),
    sha: e.sha,
    note: counted ? "" : t("按当前规则不计入", "not counted under current rules"),
    muted: !counted,
  };
}

function commentText(pr, e, rules, t) {
  if (e.mine) {
    return {
      text: t("你发表了评论", "You commented"),
      note: verdictOf(e, rules) ? "" : t("普通评论不计入", "plain comments don't count"),
      muted: !verdictOf(e, rules),
    };
  }
  return {
    text: t(`${pr.author} 回复了评论`, `${pr.author} replied`),
    note: rules.authorReply ? "" : t("不算修复", "not counted as a fix"),
    muted: !rules.authorReply,
  };
}

function markText(t, e, evs, rules) {
  const after = evs ? evs.slice(evs.indexOf(e) + 1) : [];
  const expired = e.verdict === "done" && after.some((x) => isGithubAuthorUpdate(x, rules));
  return {
    text: t(`你在插件里标记：${MARK_TEXT[e.verdict]}`, `You marked: ${MARK_EN[e.verdict]}`),
    note: expired
      ? t("作者之后有新动作，已失效", "expired after the author's next update")
      : e.via === "drag"
        ? t("看板拖拽 · 本地", "board drag · local")
        : t("本地", "local"),
    muted: expired,
  };
}

export function evText(pr, e, evs, rules, t = zhOnly) {
  switch (e.type) {
    case "opened":
      return {
        text: e.draft
          ? t(`${pr.author} 创建了 PR（草稿）`, `${pr.author} opened a draft PR`)
          : t(`${pr.author} 创建了 PR`, `${pr.author} opened the PR`),
        sha: e.sha,
      };
    case "ready":
      return { text: t(`${pr.author} 标记为 Ready for review`, `${pr.author} marked it ready for review`) };
    case "toDraft":
      return { text: t(`${pr.author} 转回草稿`, `${pr.author} converted it back to draft`) };
    case "commit": {
      const ignored = e.merge && rules.ignoreMergeBase;
      return {
        text: e.merge
          ? t(`${pr.author} 合并了主干`, `${pr.author} merged the base branch`)
          : t(`${pr.author} 推送了提交`, `${pr.author} pushed a commit`),
        sha: e.sha,
        note: ignored ? t("不算新改动", "not counted as new code") : "",
        muted: ignored,
      };
    }
    case "forcePush":
      return {
        text: t(`${pr.author} force-push 了分支`, `${pr.author} force-pushed the branch`),
        sha: e.sha,
      };
    case "review":
      return reviewText(pr, e, rules, t);
    case "comment":
      return commentText(pr, e, rules, t);
    case "rerequest":
      return {
        text: t(`${pr.author} 重新请求你审查`, `${pr.author} re-requested your review`),
        note: rules.rerequest ? "" : t("按当前规则不算修复", "not counted as a fix"),
        muted: !rules.rerequest,
      };
    case "mark":
      return markText(t, e, evs, rules);
    case "merged":
      return { text: t(`${e.by} 合并了 PR`, `${e.by} merged the PR`) };
    case "closed":
      return { text: t("PR 被关闭", "The PR was closed") };
    default:
      return { text: e.type };
  }
}

export function verdictWord(last, t = zhOnly) {
  const e = last.e;
  if (e.type === "mark") {
    return last.v === "changes"
      ? t("在插件里标记“需要修复”", 'marked "changes needed" in the plugin')
      : t("在插件里标记“没问题”", 'marked "looks good" in the plugin');
  }
  if (e.type === "comment") {
    return t("发表评论（按规则视为要求修改）", "commented (counted as changes under rules)");
  }
  if (e.state === "COMMENTED") {
    return t("留了 Comment（按规则视为要求修改）", "left a comment review (counted as changes)");
  }
  return last.v === "changes" ? t("要求修改", "requested changes") : t("Approve 了", "approved");
}

export function updatesWord(pr, ups, withTime, now, t = zhOnly) {
  const gh = ups.filter((e) => e.type !== "mark");
  if (!gh.length) {
    return t(
      `你${withTime ? ` ${fmtAbs(ups[0]?.at ?? now, now, t)}` : ""}确认作者已修复`,
      `you${withTime ? ` at ${fmtAbs(ups[0]?.at ?? now, now, t)}` : ""} confirmed the fix`,
    );
  }
  const n = gh.filter((e) => e.type === "commit").length;
  const parts = [];
  if (n) parts.push(t(`推送了 ${n} 个提交`, `pushed ${n} commit${n > 1 ? "s" : ""}`));
  if (gh.some((e) => e.type === "rerequest")) {
    parts.push(t("重新请求你审查", "re-requested your review"));
  }
  if (gh.some((e) => e.type === "comment")) parts.push(t("回复了评论", "replied"));
  const when = withTime ? ` ${fmtAbs(gh[0].at, now, t)}` : "";
  return `${pr.author}${when} ${parts.join(t("、", ", "))}`;
}

const rel = (ms, now, t) => fmtRel(ms, now, t);

export function shortWhy(pr, d, rules, now, t = zhOnly) {
  switch (d.key) {
    case "needs_review":
      if (d.reopened) return t("你撤回了之前的结论，需要重新看", "you withdrew your verdict — review again");
      if (d.uncounted) return t("留过 Comment，按规则不算审查", "you commented, but it doesn't count as a review");
      return t(
        `${rel(d.since, now, t)}提交，你还没审`,
        `opened ${rel(d.since, now, t)}, not reviewed yet`,
      );
    case "reviewing":
      return t("已创建 worktree，等你提交审查结论", "worktree ready — submit your review verdict");
    case "needs_rereview":
      return updatesWord(pr, d.updates, false, now, t);
    case "changes_requested": {
      const e = d.last.e;
      const what =
        e.type === "mark"
          ? t("标记需要修复", "marked changes needed")
          : e.state === "COMMENTED"
            ? t("留了 Comment", "left a comment review")
            : t("要求修改", "requested changes");
      return t(
        `你 ${rel(e.at, now, t)}${what}${e.comments ? ` · ${e.comments} 条评论` : ""}`,
        `you ${what} ${rel(e.at, now, t)}${e.comments ? ` · ${e.comments} comments` : ""}`,
      );
    }
    case "approved":
      return t(
        `你 ${rel(d.last.e.at, now, t)}通过${d.ignoredMB.length ? " · 之后合并过主干" : ""}`,
        `you approved ${rel(d.last.e.at, now, t)}${d.ignoredMB.length ? " · base merged since" : ""}`,
      );
    case "draft":
      return t("草稿，等作者转 Ready", "draft — waiting for the author to mark ready");
    case "merged":
      return t(`${rel(d.since, now, t)}合并`, `merged ${rel(d.since, now, t)}`);
    case "closed":
      return t(`${rel(d.since, now, t)}关闭，未合并`, `closed unmerged ${rel(d.since, now, t)}`);
    default:
      return t(`你 ${rel(d.since, now, t)}标记完成`, `you marked it done ${rel(d.since, now, t)}`);
  }
}

function shaZh(x) {
  return x ? `（${x.slice(0, 7)}）` : "";
}

function shaEn(x) {
  return x ? ` (${x.slice(0, 7)})` : "";
}

function needsReviewStep(pr, d, now, t) {
  const why = d.reopened
    ? t(
        `你 ${fmtAbs(d.reopened.at, now, t)} 撤回了之前的结论，需要重新看一遍。`,
        `You withdrew your verdict at ${fmtAbs(d.reopened.at, now, t)}; please review again.`,
      )
    : d.uncounted
      ? t(
          `你 ${fmtAbs(d.uncounted.at, now, t)} 留过 ${d.uncounted.type === "review" ? "Comment" : "评论"}，但按当前规则不算审查。`,
          `You left a ${d.uncounted.type === "review" ? "comment review" : "comment"} at ${fmtAbs(d.uncounted.at, now, t)}, which doesn't count as a review.`,
        )
      : t(
          `${pr.author} ${fmtAbs(d.since, now, t)} 提交了这个 PR，你还没审查过。`,
          `${pr.author} opened this PR at ${fmtAbs(d.since, now, t)}; you haven't reviewed it yet.`,
        );
  return {
    owner: "me",
    head: t("轮到你", "Your turn"),
    title: d.reopened ? t("重新审查", "Review again") : t("首次审查", "First review"),
    why,
    plain: why,
  };
}

function reviewingStep(pr, d, now, t) {
  const why = t(
    `你已为 ${pr.repoSlug} #${pr.number} 创建/绑定 worktree，还没提交审查结论。提交后会自动进入「已通过」或「待修复」。`,
    `You linked a worktree for ${pr.repoSlug} #${pr.number} but haven't submitted a verdict yet. Submitting moves it to Approved or Changes.`,
  );
  return {
    owner: "me",
    head: t("审查中", "Reviewing"),
    title: t(`继续审查 ${pr.author} 的修改`, `Continue reviewing ${pr.author}'s PR`),
    why,
    plain: why,
  };
}

function rereviewStep(pr, d, now, t) {
  const why = t(
    `你 ${fmtAbs(d.last.e.at, now, t)} ${verdictWord(d.last, t)}${shaZh(d.last.sha)}，之后 ${updatesWord(pr, d.updates, true, now, t)}。`,
    `You ${verdictWord(d.last, t)}${shaEn(d.last.sha)} at ${fmtAbs(d.last.e.at, now, t)}, then ${updatesWord(pr, d.updates, true, now, t)}.`,
  );
  const compare = d.last.sha && d.headSha !== d.last.sha ? `${d.last.sha}…${d.headSha}` : null;
  return {
    owner: "me",
    head: t("轮到你", "Your turn"),
    title: t(`复审 ${pr.author} 的修改`, `Re-review ${pr.author}'s changes`),
    why,
    plain: why,
    compare,
  };
}

function changesStep(pr, d, rules, now, t) {
  const silent = now - d.since > rules.silentDays * DAY;
  const why = t(
    `你 ${fmtAbs(d.last.e.at, now, t)} ${verdictWord(d.last, t)}${shaZh(d.last.sha)}，之后 ${pr.author} 还没有新的推送。${silent ? `已超过 ${rules.silentDays} 天没动静，可以去 GitHub 催一下或关掉。` : ""}`,
    `You ${verdictWord(d.last, t)}${shaEn(d.last.sha)} at ${fmtAbs(d.last.e.at, now, t)}; ${pr.author} hasn't pushed since.${silent ? ` Silent for over ${rules.silentDays} days — ping or close it.` : ""}`,
  );
  return {
    owner: "author",
    head: t(`等 ${pr.author}`, `Waiting on ${pr.author}`),
    title: t("修复你提出的问题", "Fix the issues you raised"),
    why,
    plain: why,
  };
}

function approvedStep(pr, d, rules, now, t) {
  const mb = d.ignoredMB.length
    ? t(`之后 ${pr.author} 合并过主干，按规则不算新改动。`, `${pr.author} merged the base since; not counted as new code.`)
    : "";
  const kept =
    d.newCode && rules.approveThenCommit === "keep"
      ? t("之后有新提交，按规则保持已通过。", "New commits arrived; keeping the approval by rule.")
      : "";
  const why = t(
    `你 ${fmtAbs(d.last.e.at, now, t)} ${verdictWord(d.last, t)}${shaZh(d.last.sha)}。${mb}${kept}`,
    `You ${verdictWord(d.last, t)}${shaEn(d.last.sha)} at ${fmtAbs(d.last.e.at, now, t)}. ${mb}${kept}`,
  );
  return {
    owner: "merge",
    head: t("等合并", "Ready to merge"),
    title: t("可以合并了", "Ready to merge"),
    why,
    plain: why,
  };
}

const TERMINAL = {
  draft: {
    title: ["完成草稿", "Finish the draft"],
    why: (pr, d, now, t) =>
      t(
        `${pr.author} ${fmtAbs(d.since, now, t)} 开的是草稿，转为 Ready for review 后进入待审查。`,
        `${pr.author} opened this as a draft at ${fmtAbs(d.since, now, t)}; it enters review once marked ready.`,
      ),
  },
  merged: {
    title: ["已合并", "Merged"],
    why: (pr, d, now, t) => t(`${fmtAbs(d.since, now, t)} 已合并。`, `Merged at ${fmtAbs(d.since, now, t)}.`),
  },
  closed: {
    title: ["已关闭", "Closed"],
    why: (pr, d, now, t) => t(`${fmtAbs(d.since, now, t)} 已关闭，未合并。`, `Closed unmerged at ${fmtAbs(d.since, now, t)}.`),
  },
  done: {
    title: ["你标记完成", "Marked done"],
    why: (pr, d, now, t) =>
      t(
        `你 ${fmtAbs(d.since, now, t)} 在插件里标记完成，GitHub 上仍是 open。作者之后有新推送会自动回到正常流转。`,
        `You marked it done at ${fmtAbs(d.since, now, t)}; the PR is still open on GitHub. A new push restores normal flow.`,
      ),
  },
};

function terminalStep(pr, d, now, t) {
  const meta = TERMINAL[d.key] || TERMINAL.done;
  const why = meta.why(pr, d, now, t);
  const plain =
    d.key === "merged"
      ? t(`${why}对应的 worktree 可以删了。`, `${why} The linked worktree can be removed.`)
      : why;
  const head = d.key === "draft" ? t(`等 ${pr.author}`, `Waiting on ${pr.author}`) : t("已结束", "Finished");
  return { owner: d.key === "draft" ? "author" : "done", head, title: t(meta.title[0], meta.title[1]), why, plain };
}

export function nextStep(pr, d, rules, now, t = zhOnly) {
  switch (d.key) {
    case "needs_review":
      return needsReviewStep(pr, d, now, t);
    case "reviewing":
      return reviewingStep(pr, d, now, t);
    case "needs_rereview":
      return rereviewStep(pr, d, now, t);
    case "changes_requested":
      return changesStep(pr, d, rules, now, t);
    case "approved":
      return approvedStep(pr, d, rules, now, t);
    default:
      return terminalStep(pr, d, now, t);
  }
}
