"use strict";
/* 一对一专属客户端（学生端）
 * 数据来自管理后台只读接口 GET /api/client/<学生id 或 slug>?key=<访问密钥>；
 * 写操作只有两个：POST /api/client/signature（签名一次性确认）、POST /api/client/message（导师沟通留言）。
 * 入口：专属链接 ?s=<学生id 或专属名 slug>&k=<密钥>（可加 &api=<接口域名> 覆盖默认接口）；
 * 无参数时显示门页，输入一次后存 localStorage。
 * 展示结构（v10）：底部四页签——首页 / 成长 / 规划 / 导师，纯前端切换；
 * 首屏只渲染首页，其余页签数据在同一份 JSON 内、首次切换时才渲染。
 * 双语（v10）：界面文字走内置 I18N 字典（zh/en），右上角切换、存 localStorage；
 * 数据内容（导师/学生录入的正文、课程名等）不翻译、原文呈现。 */
const DEFAULT_API_BASE = "https://transferos-admin.szzxli711.workers.dev";
const LS_S = "ooo_student_id", LS_K = "ooo_client_key", LS_A = "ooo_api_base", LS_LANG = "ooo_lang";
const KIND_LABELS = { prereq: "必修先修", gened: "通识", elective: "选修" };
const KIND_LABELS_EN = { prereq: "Prerequisites", gened: "General Ed", elective: "Electives" };

/* —— i18n 字典：只收界面文字；数据内容永不进字典 —— */
const I18N = {
  zh: {
    appTitle: "一对一专属客户端",
    "gate.title": "打开我的专属客户端",
    "gate.desc": "输入导师发给你的专属名（或学生编号）与访问密钥。输入一次后，本设备会自动记住。",
    "gate.labelS": "专属名 / 学生编号", "gate.labelK": "访问密钥",
    "gate.phS": "如 stu-01 或 12", "gate.phK": "如 ck_…",
    "gate.enter": "进入",
    "gate.hint": "小提示：进入后用浏览器菜单把本页「添加到主屏幕」，桌面上出现的就是你的专属APP，点图标即可打开。",
    "gate.errBoth": "编号与密钥都要填。",
    "state.loading": "正在加载…", "state.retry": "重试",
    "state.netErr": "网络不通，没能连上服务器。请检查网络后重试。",
    "state.notFound": "没找到这份客户端：专属名 / 编号或访问密钥不正确，或链接已更新。请核对导师发的最新链接。",
    "state.reenter": "重新输入编号与密钥",
    "state.gateAsk": "请输入导师发给你的专属名（或编号）与访问密钥。",
    "state.serverBusy": "服务器暂时忙（{status}），请稍后重试。",
    "state.badData": "数据格式异常，请稍后重试。",
    "tab.home": "首页", "tab.growth": "成长", "tab.plan": "规划", "tab.mentor": "导师",
    "hero.stage": "当前阶段：", "hero.mainLine": "当前主线",
    "hero.next": "下一步：{x}",
    "hero.exclusive": "本应用为 {name} 专属开发 · 一对一规划服务",
    "hero.exclusiveAnon": "本应用为你专属开发 · 一对一规划服务",
    "app.personalTitle": "{name} 的专属APP", "app.defaultTitle": "我的专属APP",
    "card.mentor": "导师寄语", "card.daily": "每日一句", "card.countdown": "关键日期",
    "card.actions": "行动清单", "card.timeline": "成长时间线", "card.status": "当前状态",
    "card.coursesDone": "选课 · 已修与在修", "card.exams": "考试记录", "card.meetings": "辅导会议",
    "card.lines": "人生线", "card.vision": "愿景板", "card.goalDetail": "学业目标",
    "card.courses": "选课规划", "card.advice": "导师建议", "card.knowledge": "知识卡",
    "card.messages": "导师沟通",
    "sign.prompt": "选一句做你的专属签名——签下后将固定在你的 APP 里，每天陪你打开它。",
    "sign.confirm": "就它了，固定下来", "sign.saving": "正在固定…",
    "sign.err": "没签上，网络或服务器有点问题，请再试一次。",
    "cd.left": "还有 {n} 天", "cd.today": "就是今天", "cd.overdue": "已到期",
    "actions.progress": "已完成 {x} / 共 {y}",
    "status.latestGpa": "最新 GPA", "status.credits": "已修学分 / 总要求",
    "status.empty": "暂无状态快照。", "status.history": "历史快照",
    "status.gpaWord": "GPA", "status.creditsWord": "学分",
    "status.curve": "进步曲线", "status.ring": "学分完成度",
    "status.single": "目前只有一条状态快照——等积累到两条以上，这里会画出你的进步曲线。",
    "cdone.summary": "已完成 {a} 门 · 在修/已选 {b} 门",
    "cdone.empty": "暂无已修或在修课程。",
    "exams.score": "分数 {x}", "exams.line": "达标线 {x}", "exams.empty": "暂无考试记录。",
    "meetings.next": "下次会议：{x}", "meetings.empty": "暂无会议记录。",
    "lines.next": "下一步：{x}", "lines.empty": "目标线尚未记录，请联系导师确认。",
    "goal.fSchool": "目标学校 / 项目", "goal.fTerm": "目标入学季", "goal.fGpa": "目标 GPA",
    "courses.summary": "已完成学分 {a} / 规划总学分 {b} · 先修课已完成 {c}/{d} 门",
    "courses.kind": "已完成 {a}/{b} 门 · 学分 {c}/{d}",
    "courses.termMeta": "{a} 门 · {b} 学分", "courses.unit": " 学分",
    "courses.empty": "暂无选课记录。",
    "msg.label": "给导师留言", "msg.ph": "写下你想对导师说的话…", "msg.send": "发送",
    "msg.sending": "发送中…", "msg.emptyThread": "有问题随时在这里留言，导师会回复",
    "msg.you": "我", "msg.mentor": "导师",
    "msg.errEmpty": "先写点内容再发送。", "msg.errTooLong": "留言最多 500 字。",
    "msg.errNet": "没发出去，网络或服务器有点问题，请再试一次。",
    "msg.errGone": "链接已失效，请联系导师获取最新链接。",
    "msg.errFreq": "发送太频繁了，请过一分钟再试。",
    "page.empty": "这一页暂时还没有内容，导师会陆续为你更新。",
    "foot.line1": "把本页「添加到主屏幕」后即为你的专属APP，点桌面图标即可随时打开。",
    "foot.line2": "数据由导师维护更新；有问题可以在「导师」页留言。",
    "foot.forget": "清除本设备记住的编号与密钥",
  },
  en: {
    appTitle: "One-on-One Client",
    "gate.title": "Open My Client",
    "gate.desc": "Enter the personal name (or student ID) and access key from your mentor. You only need to enter them once on this device.",
    "gate.labelS": "Personal name / Student ID", "gate.labelK": "Access key",
    "gate.phS": "e.g. stu-01 or 12", "gate.phK": "e.g. ck_…",
    "gate.enter": "Enter",
    "gate.hint": "Tip: after entering, use your browser menu to Add to Home Screen — the icon on your home screen is your personal app.",
    "gate.errBoth": "Both the name / ID and the key are required.",
    "state.loading": "Loading…", "state.retry": "Retry",
    "state.netErr": "Network unavailable — could not reach the server. Please check your connection and retry.",
    "state.notFound": "This client was not found: the name / ID or key is incorrect, or the link has been updated. Please check the latest link from your mentor.",
    "state.reenter": "Re-enter name & key",
    "state.gateAsk": "Please enter the personal name (or ID) and access key from your mentor.",
    "state.serverBusy": "The server is busy right now ({status}). Please try again shortly.",
    "state.badData": "Unexpected data format. Please try again shortly.",
    "tab.home": "Home", "tab.growth": "Growth", "tab.plan": "Plan", "tab.mentor": "Mentor",
    "hero.stage": "Current stage: ", "hero.mainLine": "Current Focus",
    "hero.next": "Next step: {x}",
    "hero.exclusive": "Built exclusively for {name} · One-on-one planning service",
    "hero.exclusiveAnon": "Built exclusively for you · One-on-one planning service",
    "app.personalTitle": "{name}'s Personal App", "app.defaultTitle": "My Personal App",
    "card.mentor": "A Note from Your Mentor", "card.daily": "Daily Quote", "card.countdown": "Key Dates",
    "card.actions": "Action List", "card.timeline": "Milestones", "card.status": "Current Status",
    "card.coursesDone": "Courses · Completed & In Progress", "card.exams": "Exams", "card.meetings": "Mentoring Sessions",
    "card.lines": "Life Lines", "card.vision": "Vision Board", "card.goalDetail": "Academic Goal",
    "card.courses": "Course Plan", "card.advice": "Mentor's Advice", "card.knowledge": "Knowledge Cards",
    "card.messages": "Messages",
    "sign.prompt": "Pick a line as your personal signature — once set, it stays in your app and greets you every day.",
    "sign.confirm": "Set it as my signature", "sign.saving": "Setting…",
    "sign.err": "Could not set it — a network or server hiccup. Please try again.",
    "cd.left": "{n} days left", "cd.today": "Today", "cd.overdue": "Past due",
    "actions.progress": "Done {x} of {y}",
    "status.latestGpa": "Latest GPA", "status.credits": "Credits done / required",
    "status.empty": "No status snapshots yet.", "status.history": "Past snapshots",
    "status.gpaWord": "GPA", "status.creditsWord": "credits",
    "status.curve": "Progress Curve", "status.ring": "Credits completed",
    "status.single": "Only one status snapshot so far — once there are two or more, your progress curve will appear here.",
    "cdone.summary": "{a} completed · {b} in progress / enrolled",
    "cdone.empty": "No completed or in-progress courses yet.",
    "exams.score": "Score {x}", "exams.line": "Pass line {x}", "exams.empty": "No exam records yet.",
    "meetings.next": "Next session: {x}", "meetings.empty": "No session records yet.",
    "lines.next": "Next step: {x}", "lines.empty": "No goal lines recorded yet — please confirm with your mentor.",
    "goal.fSchool": "Target school / program", "goal.fTerm": "Target entry term", "goal.fGpa": "Target GPA",
    "courses.summary": "Credits completed {a} / planned {b} · Prerequisites done {c}/{d}",
    "courses.kind": "Done {a}/{b} courses · credits {c}/{d}",
    "courses.termMeta": "{a} courses · {b} credits", "courses.unit": " cr",
    "courses.empty": "No courses recorded yet.",
    "msg.label": "Message your mentor", "msg.ph": "Write what you'd like to tell your mentor…", "msg.send": "Send",
    "msg.sending": "Sending…", "msg.emptyThread": "Questions? Leave a message here anytime — your mentor will reply.",
    "msg.you": "Me", "msg.mentor": "Mentor",
    "msg.errEmpty": "Write something first.", "msg.errTooLong": "Messages are limited to 500 characters.",
    "msg.errNet": "Could not send — a network or server hiccup. Please try again.",
    "msg.errGone": "This link is no longer valid. Please ask your mentor for the latest link.",
    "msg.errFreq": "You're sending too fast — please wait a minute and try again.",
    "page.empty": "Nothing here yet — your mentor will keep this page updated.",
    "foot.line1": "Add this page to your home screen and it becomes your personal app — tap the icon anytime.",
    "foot.line2": "Your data is maintained by your mentor. Questions? Leave a message on the Mentor tab.",
    "foot.forget": "Forget the ID & key saved on this device",
  },
};
let LANG = "zh";
try { LANG = localStorage.getItem(LS_LANG) === "en" ? "en" : "zh"; } catch (e) { /* 存储不可用时默认中文 */ }
function t(key) {
  const dict = I18N[LANG] || I18N.zh;
  return typeof dict[key] === "string" ? dict[key] : (I18N.zh[key] || key);
}
function fmt(key, obj) {
  return t(key).replace(/\{(\w+)\}/g, (_, k) => (obj && obj[k] !== undefined && obj[k] !== null ? obj[k] : ""));
}
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
  document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";
  const z = $("lang-zh"), e = $("lang-en");
  if (z && e) { z.classList.toggle("on", LANG === "zh"); e.classList.toggle("on", LANG === "en"); }
}

const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function pct(done, total) {
  const d = Number(done) || 0, tt = Number(total) || 0;
  return tt > 0 ? Math.min(100, Math.round((d / tt) * 100)) : 0;
}
function bar(done, total) {
  return '<div class="pbar"><i style="width:' + pct(done, total) + '%"></i></div>';
}
function creds() {
  const q = new URLSearchParams(location.search);
  const s = q.get("s") || localStorage.getItem(LS_S) || "";
  const k = q.get("k") || localStorage.getItem(LS_K) || "";
  const api = (q.get("api") || localStorage.getItem(LS_A) || DEFAULT_API_BASE).replace(/\/+$/, "");
  if (q.get("s") && q.get("k")) {
    localStorage.setItem(LS_S, s); localStorage.setItem(LS_K, k); localStorage.setItem(LS_A, api);
  }
  return { s: String(s).trim(), k: String(k).trim(), api };
}

function showState(text, retry) {
  $("gate").hidden = true; $("app").hidden = true; $("tabbar").hidden = true;
  $("state").hidden = false;
  $("state-text").textContent = text;
  const btn = $("state-retry");
  btn.hidden = !retry;
  if (retry) { btn.textContent = t("state.retry"); btn.onclick = () => load(); }
}
function showGate(errText) {
  $("state").hidden = true; $("app").hidden = true; $("tabbar").hidden = true;
  $("gate").hidden = false;
  const e = $("gate-err");
  if (errText) { e.textContent = errText; e.hidden = false; } else { e.hidden = true; }
}

async function load() {
  const { s, k, api } = creds();
  if (!s || !k) { showGate(); return; }
  showState(t("state.loading"), false);
  let resp;
  try {
    resp = await fetch(api + "/api/client/" + encodeURIComponent(s) + "?key=" + encodeURIComponent(k),
      { headers: { "Accept": "application/json" } });
  } catch (e) {
    showState(t("state.netErr"), true);
    return;
  }
  if (resp.status === 404) {
    showState(t("state.notFound"), false);
    const btn = $("state-retry");
    btn.hidden = false;
    btn.textContent = t("state.reenter");
    btn.onclick = () => {
      localStorage.removeItem(LS_S); localStorage.removeItem(LS_K);
      showGate(t("state.gateAsk"));
    };
    return;
  }
  if (!resp.ok) { showState(fmt("state.serverBusy", { status: resp.status }), true); return; }
  let data;
  try { data = await resp.json(); } catch (e) { showState(t("state.badData"), true); return; }
  if (!data || data.ok !== true) { showState(t("state.badData"), true); return; }
  render(data);
}

function setMeta(name, content) {
  let el = document.head.querySelector('meta[name="' + name + '"]');
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}
/* 数据加载后按学生姓名个性化：页面标题、「添加到主屏幕」默认名、主线卡上方专属语。
 * 姓名一律取接口返回值，模板内不写任何具体人名。 */
function personalize(name) {
  const title = name ? fmt("app.personalTitle", { name }) : t("app.defaultTitle");
  document.title = title;
  setMeta("apple-mobile-web-app-title", title);
  setMeta("application-name", title);
  setMeta("theme-color", "#16453a");
  $("stu-exclusive").textContent = name
    ? fmt("hero.exclusive", { name })
    : t("hero.exclusiveAnon");
}

/* —— 每日一句（v9）——
 * 语录库：40 条，中文为主 + 英文小字；短句取公有领域经典与原创改写，不整段引用受版权文本。
 * 标签六组：action 行动 / study 学业坚持 / courage 勇气 / discipline 自律 / dream 梦想 / setback 挫折。
 * 选题确定性：种子 = 学生定位符 + 本地日期，同日不变、跨日轮换；主题池由学生数据决定，
 * 权重向第一优先级人生线的主题（action）倾斜。引擎为纯函数，可独立自测。
 * 双语显示：当前语言为主句、另一语种小字附后。 */
const QUOTES = [
  // action 行动（7）
  { tags: ["action"], zh: "千里之行，始于足下。", en: "A journey of a thousand miles begins with a single step." },
  { tags: ["action"], zh: "想到和得到之间，还有一个词：做到。", en: "Between thinking and getting lies one more word: doing." },
  { tags: ["action", "discipline"], zh: "先完成，再完美。", en: "Done first, perfect later." },
  { tags: ["action", "dream"], zh: "种一棵树最好的时间是十年前，其次是现在。", en: "The best time to plant a tree was ten years ago; the second best time is now." },
  { tags: ["action"], zh: "不怕慢，只怕站。", en: "Fear not slowness; fear standing still." },
  { tags: ["action", "courage"], zh: "机会，留给已经在路上的人。", en: "Opportunity favors those already on the road." },
  { tags: ["action", "discipline"], zh: "把大事拆小，把今天过完。", en: "Break the big thing into small pieces, and finish today." },
  // study 学业坚持（7）
  { tags: ["study"], zh: "学而不思则罔，思而不学则殆。", en: "Learning without thought is labor lost; thought without learning is perilous." },
  { tags: ["study", "discipline"], zh: "日拱一卒，功不唐捐。", en: "A pawn advances a little each day; no effort is ever wasted." },
  { tags: ["study"], zh: "书山有路勤为径。", en: "Diligence is the path up the mountain of books." },
  { tags: ["study"], zh: "今天多读一页，明天少求一人。", en: "One more page today, one less favor to ask tomorrow." },
  { tags: ["study", "discipline"], zh: "重复，是学会的捷径。", en: "Repetition is the shortcut to mastery." },
  { tags: ["study"], zh: "不积跬步，无以至千里。", en: "Without accumulating small steps, one cannot reach a thousand miles." },
  { tags: ["study", "setback"], zh: "把不会的变成会的，就是学习。", en: "Turning what you can't do into what you can — that is learning." },
  // courage 勇气（6）
  { tags: ["courage"], zh: "勇气不是不害怕，是害怕也往前走。", en: "Courage is not the absence of fear; it is moving forward while afraid." },
  { tags: ["courage", "setback"], zh: "狭路相逢勇者胜。", en: "On a narrow road, the brave prevail." },
  { tags: ["courage", "action"], zh: "先迈出第一步，路会自己出现。", en: "Take the first step, and the road will appear." },
  { tags: ["courage"], zh: "怕输的人，已经输了一半。", en: "Whoever fears losing has already half lost." },
  { tags: ["courage", "setback"], zh: "迎难而上，难就会让路。", en: "Face the difficulty, and it will make way." },
  { tags: ["courage"], zh: "不需要等状态好了再开始。", en: "You don't have to feel ready to begin." },
  // discipline 自律（6）
  { tags: ["discipline"], zh: "自律即自由。", en: "Discipline is freedom." },
  { tags: ["discipline"], zh: "每天进步一点点，一年就是一大步。", en: "A little progress each day adds up to a leap in a year." },
  { tags: ["discipline"], zh: "管理好今天，时间就站在你这边。", en: "Manage today well, and time is on your side." },
  { tags: ["discipline"], zh: "说到做到，是最小单位的信用。", en: "Keeping your word is the smallest unit of trust." },
  { tags: ["discipline"], zh: "好习惯是复利，坏习惯也是。", en: "Habits compound — the good ones and the bad ones alike." },
  { tags: ["discipline", "study"], zh: "把手机放远，把目标放近。", en: "Keep the phone far away and the goal close." },
  // dream 梦想（6）
  { tags: ["dream"], zh: "有梦就去追，醒来就去做。", en: "Chase the dream, and when you wake, go do it." },
  { tags: ["dream"], zh: "星光不问赶路人。", en: "The starlight asks nothing of those traveling the road." },
  { tags: ["dream"], zh: "你想成为的样子，就是努力的方向。", en: "Who you want to become points to where you should strive." },
  { tags: ["dream", "discipline"], zh: "愿你走得慢，但从不停。", en: "May you walk slowly, but never stop." },
  { tags: ["dream", "courage"], zh: "心里有光，脚下就有路。", en: "With light in your heart, a road appears beneath your feet." },
  { tags: ["dream"], zh: "梦想不会逃走，逃走的总是自己。", en: "Dreams don't run away; people do." },
  // setback 挫折（8）
  { tags: ["setback"], zh: "吃一堑，长一智。", en: "Fall into a pit, and gain in wit." },
  { tags: ["setback"], zh: "失败不是终点，放弃才是。", en: "Failure is not the end; giving up is." },
  { tags: ["setback", "study"], zh: "这次没过，下次更近。", en: "Not this time — closer next time." },
  { tags: ["setback", "dream"], zh: "山重水复疑无路，柳暗花明又一村。", en: "Where hills double and streams wind, a village of willows and blossoms appears." },
  { tags: ["setback"], zh: "把挫折当学费，把经验当文凭。", en: "Treat setbacks as tuition, and experience as the diploma." },
  { tags: ["setback", "courage"], zh: "摔倒了，就顺势看看地上的地图。", en: "When you fall, take a good look at the map on the ground." },
  { tags: ["setback"], zh: "暂时没赢，不等于会输。", en: "Not winning yet is not the same as losing." },
  { tags: ["setback", "study"], zh: "错题本越厚，底气越足。", en: "The thicker the mistake notebook, the stronger the foundation." },
];
const WEEKDAYS = {
  zh: ["日", "一", "二", "三", "四", "五", "六"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateLine(now) {
  const d = now || new Date();
  if (LANG === "en") {
    return WEEKDAYS.en[d.getDay()] + ", " + MONTHS_EN[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }
  return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 · 星期" + WEEKDAYS.zh[d.getDay()];
}
function localDateStr(dt) {
  const d = dt || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function hashSeed(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/* 主题池：通用三组打底；有主线在推进 → action；有学业目标 → study；
 * 有考试未达标记录 → setback + study。第一优先级人生线在场时主主题为 action。 */
function quoteThemes(d) {
  const themes = ["dream", "courage", "discipline"];
  if (d && d.main_line) themes.push("action");
  if (d && d.goal) themes.push("study");
  if (d && (d.exams || []).some((e) => e && e.result === "fail")) themes.push("setback", "study");
  return [...new Set(themes)];
}
function quotePrimaryTheme(d) { return d && d.main_line ? "action" : ""; }
/* 纯函数选题：pool 为与主题池相交的条目，主主题条目双倍权重（入池两次）；
 * 下标 = hash(种子) % pool 长度。全程无随机源，给定 (quotes, themes, primary, seed) 结果恒定。 */
function pickDailyQuote(quotes, themes, primary, seedStr) {
  const pool = [];
  for (const q of quotes || []) {
    if (!q.tags.some((tg) => themes.includes(tg))) continue;
    pool.push(q);
    if (primary && q.tags.includes(primary)) pool.push(q);
  }
  const list = pool.length ? pool : (quotes || []);
  if (!list.length) return null;
  return list[hashSeed(seedStr) % list.length];
}
function renderDaily(d) {
  const now = new Date();
  $("daily-date").textContent = dateLine(now);
  const { s } = creds();
  const q = pickDailyQuote(QUOTES, quoteThemes(d), quotePrimaryTheme(d), String(d.student.id || s) + "|" + localDateStr(now));
  const main = q ? (LANG === "en" ? q.en : q.zh) : "";
  const sub = q ? (LANG === "en" ? q.zh : q.en) : "";
  $("daily-quote").textContent = main;
  $("daily-quote-en").textContent = sub;
  renderSignature(d);
}
function renderSignature(d) {
  const box = $("daily-sign");
  if (d.signature) {
    box.innerHTML = '<div class="sign-line">—— ' + esc(d.signature) + "</div>";
    return;
  }
  const sugg = Array.isArray(d.signature_suggestions) ? d.signature_suggestions : [];
  if (!sugg.length) { box.innerHTML = ""; return; }
  box.innerHTML =
    '<div class="sign-pick"><p class="mut" style="margin:0">' + esc(t("sign.prompt")) + "</p>" +
    '<div class="sign-opts">' + sugg.map((sug, i) =>
      '<button type="button" class="sign-opt" data-i="' + i + '">' + esc(sug) + "</button>").join("") + "</div>" +
    '<button type="button" class="btn-sign" id="sign-confirm" disabled>' + esc(t("sign.confirm")) + "</button>" +
    '<p id="sign-err" class="err" hidden></p></div>';
  let picked = -1;
  box.querySelectorAll(".sign-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      picked = Number(btn.getAttribute("data-i"));
      box.querySelectorAll(".sign-opt").forEach((b) => b.classList.toggle("sel", b === btn));
      $("sign-confirm").disabled = false;
    });
  });
  $("sign-confirm").addEventListener("click", async () => {
    if (picked < 0) return;
    const btn = $("sign-confirm");
    btn.disabled = true; btn.textContent = t("sign.saving");
    const { s, k, api } = creds();
    try {
      const resp = await fetch(api + "/api/client/signature", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ s, key: k, signature: sugg[picked] }),
      });
      if (resp.status === 409) { load(); return; } // 已被设置（可能导师刚改）→ 刷新为固定态
      if (!resp.ok) throw new Error("bad status");
      const j = await resp.json();
      if (!j || j.ok !== true) throw new Error("bad body");
      d.signature = j.signature;
      if (lastData) lastData.signature = j.signature;
      renderSignature(d);
    } catch (e) {
      btn.disabled = false; btn.textContent = t("sign.confirm");
      const err = $("sign-err");
      err.textContent = t("sign.err");
      err.hidden = false;
    }
  });
}

/* —— 四页签（v10）——
 * 首屏只渲染首页；其余页签数据已在同一份 JSON 内，首次切换时才渲染（renderedTabs 标记）。
 * 页签红点：GET 返回的 unread_mentor > 0 时在「导师」页签亮红点；点进该页后本地消点
 * （服务端已在 GET 时标记已读，下次加载即为 0）。 */
const TABS = ["home", "growth", "plan", "mentor"];
let curTab = "home";
let lastData = null;
const renderedTabs = {};
function updateDot() {
  const dot = $("tab-dot");
  if (dot) dot.hidden = !(lastData && Number(lastData.unread_mentor) > 0);
}
function switchTab(name) {
  if (!TABS.includes(name)) name = "home";
  curTab = name;
  for (const tb of TABS) {
    $("page-" + tb).hidden = tb !== name;
    document.querySelectorAll(".tab-btn").forEach((b) =>
      b.classList.toggle("on", b.getAttribute("data-tab") === tb && tb === name));
  }
  if (name === "mentor" && lastData) lastData.unread_mentor = 0;
  if (lastData && renderedTabs[name] !== LANG) renderTab(name);
  updateDot();
  window.scrollTo(0, 0);
}
function renderTab(name) {
  if (!lastData) return;
  renderedTabs[name] = LANG; // 记录渲染时语言：切换语言后再次进入该页会自动按新语言重渲染
  if (name === "home") renderHome(lastData);
  else if (name === "growth") renderGrowth(lastData);
  else if (name === "plan") renderPlan(lastData);
  else if (name === "mentor") renderMentor(lastData);
}
function render(d) {
  lastData = d;
  $("state").hidden = true; $("gate").hidden = true;
  $("app").hidden = false; $("tabbar").hidden = false;
  for (const k of Object.keys(renderedTabs)) delete renderedTabs[k];
  curTab = "home";
  for (const tb of TABS) $("page-" + tb).hidden = tb !== "home";
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("on", b.getAttribute("data-tab") === "home"));
  renderTab("home");
  updateDot();
}

/* —— 页1 首页 —— */
function renderHome(d) {
  $("stu-name").textContent = d.student.name || "我的客户端";
  personalize(d.student.name || "");
  renderDaily(d);
  const sys = $("stu-system");
  if (d.school_system) { sys.textContent = d.school_system; sys.hidden = false; } else { sys.hidden = true; }
  const meta = [];
  if (d.student.stage_label) meta.push(t("hero.stage") + d.student.stage_label);
  if (d.student.package) meta.push(d.student.package);
  $("stu-meta").textContent = meta.join(" · ");
  const ml = $("main-line");
  if (d.main_line) {
    ml.hidden = false;
    $("main-line-name").textContent =
      d.main_line.name + (d.main_line.status_label ? "（" + d.main_line.status_label + "）" : "");
    $("main-line-next").textContent = d.main_line.next_step ? fmt("hero.next", { x: d.main_line.next_step }) : "";
  } else { ml.hidden = true; }
  // 导师寄语：为空整卡不渲染
  const msec = $("sec-mentor");
  if (d.mentor_message) {
    msec.hidden = false;
    $("mentor-body").textContent = d.mentor_message;
    $("mentor-date").textContent = d.mentor_message_at ? String(d.mentor_message_at).slice(0, 10) : "";
  } else { msec.hidden = true; }
  renderCountdown(d);
  renderActions(d);
}
function dayDiff(iso) {
  const parts = String(iso || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 864e5);
}
function renderCountdown(d) {
  const list = d.key_dates || [];
  const sec = $("sec-countdown");
  if (!list.length) { sec.hidden = true; return; }
  sec.hidden = false;
  $("countdown-list").innerHTML = list.map((k) => {
    const n = dayDiff(k.date);
    let cls = "", txt;
    if (n === null) { txt = k.date || ""; }
    else if (n < 0) { cls = "over"; txt = t("cd.overdue"); }
    else if (n === 0) { cls = "today"; txt = t("cd.today"); }
    else { txt = fmt("cd.left", { n }); }
    return '<div class="cd-item"><div class="cd-main">' +
      '<div class="cd-title">' + esc(k.title) + '</div>' +
      '<div class="cd-date">' + esc(k.date) + '</div></div>' +
      '<div class="cd-days ' + cls + '">' + esc(txt) + "</div></div>";
  }).join("");
}
function renderActions(d) {
  const acts = d.actions || [];
  const sec = $("sec-actions");
  if (!acts.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const done = acts.filter((a) => a.status === "done").length;
  $("actions-progress").textContent = fmt("actions.progress", { x: done, y: acts.length });
  $("actions-list").innerHTML = acts.map((a) => {
    const isDone = a.status === "done";
    return '<div class="act-item' + (isDone ? " done" : "") + '">' +
      '<span class="act-check" aria-hidden="true">' + (isDone ? "✓" : "○") + "</span>" +
      '<div class="act-body"><div class="act-title">' + esc(a.title) + "</div>" +
      (a.detail ? '<div class="act-detail">' + esc(a.detail) + "</div>" : "") +
      "</div>" +
      (a.due_text ? '<span class="act-due">' + esc(a.due_text) + "</span>" : "") +
      "</div>";
  }).join("");
}

/* —— 页2 成长 —— */
function renderGrowth(d) {
  // 成长时间线：无数据整卡不渲染
  const ms = d.milestones || [];
  const msec = $("sec-timeline");
  if (ms.length) {
    msec.hidden = false;
    $("timeline").innerHTML = '<div class="tl">' + ms.map((m) =>
      '<div class="tl-item"><span class="tl-dot" aria-hidden="true"></span><div class="tl-body">' +
      (m.date_text ? '<div class="tl-date">' + esc(m.date_text) + "</div>" : "") +
      '<div class="tl-title">' + esc(m.title) + "</div>" +
      (m.detail ? '<div class="tl-detail">' + esc(m.detail) + "</div>" : "") +
      "</div></div>").join("") + "</div>";
  } else { msec.hidden = true; }
  renderStatus(d);
  renderCoursesDone(d);
  // 考试
  const exams = d.exams || [];
  $("exams").innerHTML = exams.length ? exams.map((e) => {
    const sub = [];
    if (e.exam_date) sub.push(e.exam_date);
    if (e.score) sub.push(fmt("exams.score", { x: e.score }));
    if (e.pass_line) sub.push(fmt("exams.line", { x: e.pass_line }));
    return '<div class="exam"><div class="exam-main">' +
      '<div class="exam-name">' + esc(e.exam_name) + "</div>" +
      (sub.length ? '<div class="exam-sub">' + esc(sub.join(" · ")) + "</div>" : "") +
      (e.note ? '<div class="exam-note">' + esc(e.note) + "</div>" : "") +
      '</div><span class="badge ' + esc(e.result || "pending") + '">' + esc(e.result_label || "") + "</span></div>";
  }).join("") : '<p class="empty">' + esc(t("exams.empty")) + "</p>";
  // 会议（记录类，归成长页）
  const ms2 = d.meetings || [];
  $("meetings").innerHTML = ms2.length ? ms2.map((m) => {
    const todos = String(m.action_items || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    return '<div class="meeting"><div class="meeting-top">' +
      '<span class="meeting-date">' + esc(m.meeting_date || "") + "</span>" +
      '<span class="meeting-topic">' + esc(m.topic || "") + "</span></div>" +
      (m.summary ? '<div class="meeting-summary">' + esc(m.summary) + "</div>" : "") +
      (todos.length ? '<ul class="todo-list">' + todos.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") +
      (m.next_date ? '<div class="meeting-next">' + esc(fmt("meetings.next", { x: m.next_date })) + "</div>" : "") +
      "</div>";
  }).join("") : '<p class="empty">' + esc(t("meetings.empty")) + "</p>";
  // 整页空 → 占位
  const growthCourses = (d.courses && d.courses.list) || [];
  const has = ms.length || (d.status && d.status.latest) || exams.length || ms2.length ||
    growthCourses.some((c) => c.status === "done" || c.status === "ongoing" || c.status === "enrolled");
  const eg = $("empty-growth");
  eg.hidden = !!has;
  if (!has) eg.textContent = t("page.empty");
}
function renderStatus(d) {
  const st = d.status || {};
  const latest = st.latest;
  $("status-latest").innerHTML = latest ? (() => {
    const cd = latest.credits_done, ct = latest.credits_total;
    return '<div class="stat-big">' +
      '<div class="cell"><div class="v">' + (latest.gpa === null || latest.gpa === undefined ? "—" : esc(latest.gpa)) + '</div><div class="l">' + esc(t("status.latestGpa")) + (latest.snapshot_date ? "（" + esc(latest.snapshot_date) + "）" : "") + "</div></div>" +
      '<div class="cell"><div class="v">' + (cd === null || cd === undefined ? "—" : esc(cd)) + (ct ? ' <span style="font-size:16px;color:var(--mut)">/ ' + esc(ct) + "</span>" : "") + '</div><div class="l">' + esc(t("status.credits")) + "</div></div>" +
      "</div>" +
      ((cd !== null && cd !== undefined && ct) ? bar(cd, ct) : "") +
      (latest.note ? '<p style="margin:6px 0 0;white-space:pre-wrap">' + esc(latest.note) + "</p>" : "");
  })() : '<p class="empty">' + esc(t("status.empty")) + "</p>";
  renderCurve(st);
  const hist = (st.history || []).slice(1);
  $("status-history").innerHTML = hist.length ?
    '<h3 class="sub-h">' + esc(t("status.history")) + "</h3>" + hist.map((s) =>
      '<div class="snap"><span class="d">' + esc(s.snapshot_date || "") + "</span>" +
      "<span>" + esc(t("status.gpaWord")) + " " + (s.gpa === null || s.gpa === undefined ? "—" : esc(s.gpa)) + " · " + esc(t("status.creditsWord")) + " " +
      (s.credits_done === null || s.credits_done === undefined ? "—" : esc(s.credits_done)) + " / " +
      (s.credits_total === null || s.credits_total === undefined ? "—" : esc(s.credits_total)) +
      (s.note ? '<span class="note">' + esc(s.note) + "</span>" : "") + "</span></div>").join("")
    : "";
}
/* 进步曲线：由快照序列（时间升序）绘 SVG 折线 + 最新学分进度环。
 * 快照 <2 条时只给单点说明，不画假线；GPA 点 <2 时同样不画线。纯前端计算。 */
function ringSVG(done, total) {
  const C = 2 * Math.PI * 30;
  const p = pct(done, total);
  return '<svg class="ring" viewBox="0 0 80 80" width="76" height="76" role="img" aria-label="' + esc(t("status.ring")) + '">' +
    '<circle cx="40" cy="40" r="30" fill="none" stroke="#eef0ec" stroke-width="9"/>' +
    '<circle cx="40" cy="40" r="30" fill="none" stroke="#16453a" stroke-width="9" stroke-linecap="round" ' +
    'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - p / 100)).toFixed(1) + '" transform="rotate(-90 40 40)"/>' +
    '<text x="40" y="45" text-anchor="middle" font-size="15" font-weight="700" fill="#16453a">' + p + "%</text></svg>";
}
function gpaSVG(pts) {
  const W = 320, H = 118, PL = 10, PR = 10, PT = 18, PB = 20;
  const vals = pts.map((s) => Number(s.gpa));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 0.4) { const mid = (hi + lo) / 2; lo = mid - 0.2; hi = mid + 0.2; }
  lo -= 0.1; hi += 0.1;
  const X = (i) => PL + (W - PL - PR) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
  const Y = (v) => PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo));
  const coords = pts.map((s, i) => X(i).toFixed(1) + "," + Y(Number(s.gpa)).toFixed(1)).join(" ");
  const dots = pts.map((s, i) =>
    '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(Number(s.gpa)).toFixed(1) + '" r="3.5" fill="#16453a"/>' +
    '<text x="' + X(i).toFixed(1) + '" y="' + (Y(Number(s.gpa)) - 7).toFixed(1) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#16453a">' + esc(s.gpa) + "</text>"
  ).join("");
  const first = pts[0], last = pts[pts.length - 1];
  const dates = '<text x="' + X(0) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="9.5" fill="#6b7a72">' + esc(first.snapshot_date || "") + "</text>" +
    (pts.length > 1 ? '<text x="' + X(pts.length - 1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="9.5" fill="#6b7a72">' + esc(last.snapshot_date || "") + "</text>" : "");
  return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(t("status.curve")) + '">' +
    '<polyline points="' + coords + '" fill="none" stroke="#16453a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots + dates + "</svg>";
}
function renderCurve(st) {
  const box = $("status-curve");
  const snaps = st.history || []; // 接口按时间倒序
  if (!snaps.length) { box.innerHTML = ""; return; }
  const latest = snaps[0];
  const asc = snaps.slice().reverse();
  let html = "";
  if (latest.credits_total !== null && latest.credits_total !== undefined && latest.credits_done !== null && latest.credits_done !== undefined) {
    html += '<div class="curve-flex">' + ringSVG(latest.credits_done, latest.credits_total) +
      '<div><div class="curve-ring-label">' + esc(t("status.ring")) + "</div>" +
      '<div class="mut">' + esc(latest.credits_done) + " / " + esc(latest.credits_total) + " " + esc(t("status.creditsWord")) + "</div></div></div>";
  }
  const gpaPts = asc.filter((s) => s.gpa !== null && s.gpa !== undefined);
  if (snaps.length >= 2 && gpaPts.length >= 2) {
    html += '<h3 class="sub-h">' + esc(t("status.curve")) + " · " + esc(t("status.gpaWord")) + "</h3>" + gpaSVG(gpaPts);
  } else if (snaps.length < 2) {
    html += '<p class="mut" style="margin:10px 0 0">' + esc(t("status.single")) + "</p>";
  }
  box.innerHTML = html;
}
function renderCoursesDone(d) {
  const list = (d.courses && d.courses.list) || [];
  const doneL = list.filter((c) => c.status === "done");
  const onL = list.filter((c) => c.status === "ongoing" || c.status === "enrolled");
  $("courses-done-summary").innerHTML = (doneL.length || onL.length)
    ? '<p style="margin:0">' + esc(fmt("cdone.summary", { a: doneL.length, b: onL.length })) + "</p>"
    : '<p class="empty">' + esc(t("cdone.empty")) + "</p>";
  const rows = onL.concat(doneL);
  $("courses-done-list").innerHTML = rows.map((c) =>
    '<div class="course"><span class="code">' + esc(c.course_code || "") + "</span>" +
    '<span class="name">' + esc(c.course_name || "") +
    (c.note ? '<span class="mut">（' + esc(c.note) + "）</span>" : "") + "</span>" +
    '<span class="cr">' + esc(c.term || "") + "</span>" +
    (c.grade ? '<span class="grade">' + esc(c.grade) + "</span>" : "") +
    '<span class="st st-' + esc(c.status || "planned") + '">' + esc(c.status_label || "") + "</span></div>"
  ).join("");
}

/* —— 页3 规划 —— */
function renderPlan(d) {
  // 人生线
  const lines = d.goal_lines || [];
  const g = d.goal;
  const goalsSec = $("sec-goals");
  if (!lines.length && !g) { goalsSec.hidden = true; } else {
    goalsSec.hidden = false;
    $("goal-lines").innerHTML = lines.length ? lines.map((l) =>
      '<div class="line-item"><div class="line-prio">' + esc(l.priority) + "</div>" +
      '<div class="line-body"><div class="line-top">' +
      '<span class="line-name">' + esc(l.name) + "</span>" +
      '<span class="pill type-' + esc(l.line_type) + '">' + esc(l.line_type_label || "") + "</span>" +
      (l.status_label ? '<span class="line-status">' + esc(l.status_label) + "</span>" : "") +
      "</div>" +
      (l.next_step ? '<div class="line-next">' + esc(fmt("lines.next", { x: l.next_step })) + "</div>" : "") +
      "</div></div>").join("")
      : '<p class="empty">' + esc(t("lines.empty")) + "</p>";
  }
  // 愿景板：vision_text 与目标都空 → 不渲染
  const vsec = $("sec-vision");
  const hasVision = !!(d.vision_text || (g && g.target_school));
  if (hasVision) {
    vsec.hidden = false;
    $("vision-text").textContent = d.vision_text || "";
    $("vision-text").hidden = !d.vision_text;
    $("vision-goal").innerHTML = g && g.target_school
      ? '<div class="vision-goal"><span class="mut">' + esc(t("goal.fSchool")) + "</span><b>" + esc(g.target_school) + "</b></div>"
      : "";
  } else { vsec.hidden = true; }
  // 学业目标详情
  const gdSec = $("sec-goal-detail");
  const hasGoal = !!(g && (g.target_school || g.target_term || g.gpa_target || g.goal_note));
  if (hasGoal) {
    gdSec.hidden = false;
    $("goal-detail").innerHTML = (() => {
      const facts = [];
      if (g.target_school) facts.push('<span class="fact">' + esc(t("goal.fSchool")) + "<b>" + esc(g.target_school) + "</b></span>");
      if (g.target_term) facts.push('<span class="fact">' + esc(t("goal.fTerm")) + "<b>" + esc(g.target_term) + "</b></span>");
      if (g.gpa_target) facts.push('<span class="fact">' + esc(t("goal.fGpa")) + "<b>" + esc(g.gpa_target) + "</b></span>");
      return (facts.length ? '<div class="goal-facts">' + facts.join("") + "</div>" : "") +
        (g.goal_note ? '<div class="goal-note">' + esc(g.goal_note) + "</div>" : "");
    })();
  } else { gdSec.hidden = true; }
  renderCoursesPlan(d);
  // 导师建议：无数据不渲染
  const adv = d.advice || [];
  const asec = $("sec-advice");
  if (adv.length) {
    asec.hidden = false;
    $("advice-list").innerHTML = adv.map((a) =>
      '<div class="advice-item"><div class="advice-top">' +
      '<span class="advice-title">' + esc(a.title) + "</span>" +
      (a.created_at ? '<span class="advice-date">' + esc(String(a.created_at).slice(0, 10)) + "</span>" : "") +
      "</div>" +
      (a.body ? '<div class="advice-body">' + esc(a.body) + "</div>" : "") +
      "</div>").join("");
  } else { asec.hidden = true; }
  // 整页空 → 占位
  const has = lines.length || hasVision || hasGoal || adv.length ||
    ((d.courses && d.courses.list) || []).length;
  const ep = $("empty-plan");
  ep.hidden = !!has;
  if (!has) ep.textContent = t("page.empty");
}
function renderCoursesPlan(d) {
  const c = d.courses || { progress: {}, groups: [], list: [] };
  const p = c.progress || {};
  const labels = LANG === "en" ? KIND_LABELS_EN : KIND_LABELS;
  const byId = new Map((c.list || []).map((x) => [x.id, x]));
  const kindRows = Object.keys(KIND_LABELS).map((k) => {
    const kk = (p.byKind || {})[k];
    if (!kk || !kk.total) return "";
    return '<div class="row"><div class="l"><span>' + esc(labels[k]) + "</span><span>" +
      esc(fmt("courses.kind", { a: kk.done, b: kk.total, c: kk.creditsDone, d: kk.credits })) + "</span></div>" +
      bar(kk.done, kk.total) + "</div>";
  }).join("");
  $("course-progress").innerHTML =
    "<p style=\"margin:0\">" + esc(fmt("courses.summary", {
      a: p.creditsDone || 0, b: p.creditsTotal || 0, c: p.prereqDone || 0, d: p.prereqTotal || 0,
    })) + "</p>" +
    (kindRows ? '<div class="kind-bars">' + kindRows + "</div>" : "");
  $("course-groups").innerHTML = (c.groups || []).length ? (c.groups || []).map((gr) => {
    const items = gr.courses.map((raw) => byId.get(raw.id) || raw);
    const sumCr = items.reduce((a, x) => a + (Number(x.credits) || 0), 0);
    return '<div class="term-title">' + esc(gr.term) + '<span class="mut">' +
      esc(fmt("courses.termMeta", { a: items.length, b: sumCr })) + "</span></div>" +
      items.map((x) =>
        '<div class="course"><span class="code">' + esc(x.course_code || "") + "</span>" +
        '<span class="name">' + esc(x.course_name || "") +
        (x.note ? '<span class="mut">（' + esc(x.note) + "）</span>" : "") + "</span>" +
        '<span class="cr">' + (x.credits === null || x.credits === undefined ? "" : esc(x.credits) + esc(t("courses.unit"))) + "</span>" +
        (x.grade ? '<span class="grade">' + esc(x.grade) + "</span>" : "") +
        '<span class="st st-' + esc(x.status || "planned") + '">' + esc(x.status_label || "") + "</span></div>"
      ).join("");
  }).join("") : '<p class="empty">' + esc(t("courses.empty")) + "</p>";
}

/* —— 页4 导师 —— */
function renderMentor(d) {
  const ks = d.knowledge || [];
  const ksec = $("sec-knowledge");
  if (ks.length) {
    ksec.hidden = false;
    $("knowledge-list").innerHTML = ks.map((k) =>
      '<div class="know-item"><div class="know-top">' +
      '<span class="know-title">' + esc(k.title) + "</span>" +
      (k.tag ? '<span class="pill">' + esc(k.tag) + "</span>" : "") +
      "</div>" +
      (k.body ? '<div class="know-body">' + esc(k.body) + "</div>" : "") +
      "</div>").join("");
  } else { ksec.hidden = true; }
  renderThread(d);
}
function renderThread(d) {
  const msgs = (d && d.messages) || [];
  const box = $("msg-thread");
  if (!msgs.length) {
    box.innerHTML = '<p class="empty">' + esc(t("msg.emptyThread")) + "</p>";
    return;
  }
  box.innerHTML = msgs.map((m) => {
    const mine = m.sender === "student";
    const who = mine ? t("msg.you") : t("msg.mentor");
    const when = m.created_at ? String(m.created_at).slice(0, 16).replace("T", " ") : "";
    return '<div class="msg-row ' + (mine ? "mine" : "mentor") + '">' +
      '<div class="msg-meta">' + esc(who) + (when ? " · " + esc(when) : "") + "</div>" +
      '<div class="msg-bubble">' + esc(m.body) + "</div></div>";
  }).join("");
}
function showMsgErr(text) {
  const e = $("msg-err");
  if (text) { e.textContent = text; e.hidden = false; } else { e.hidden = true; }
}
async function sendMessage(ev) {
  ev.preventDefault();
  const input = $("msg-input");
  const text = input.value.trim();
  if (!text) { showMsgErr(t("msg.errEmpty")); return; }
  if ([...text].length > 500) { showMsgErr(t("msg.errTooLong")); return; }
  const btn = $("msg-send");
  btn.disabled = true; btn.textContent = t("msg.sending");
  showMsgErr("");
  const { s, k, api } = creds();
  try {
    const resp = await fetch(api + "/api/client/message", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ s, key: k, body: text }),
    });
    if (resp.status === 404) { showMsgErr(t("msg.errGone")); return; }
    if (resp.status === 429) { showMsgErr(t("msg.errFreq")); return; }
    if (!resp.ok) { showMsgErr(t("msg.errNet")); return; }
    const j = await resp.json();
    if (!j || j.ok !== true) { showMsgErr(t("msg.errNet")); return; }
    if (lastData) {
      lastData.messages = (lastData.messages || []).concat([j.message]);
      renderThread(lastData);
    }
    input.value = "";
    $("msg-count").textContent = "0 / 500";
  } catch (e) {
    showMsgErr(t("msg.errNet"));
  } finally {
    btn.disabled = false; btn.textContent = t("msg.send");
  }
}

/* —— 初始化 —— */
document.querySelectorAll(".tab-btn").forEach((b) => {
  b.addEventListener("click", () => switchTab(b.getAttribute("data-tab")));
});
$("lang-toggle").addEventListener("click", () => {
  LANG = LANG === "zh" ? "en" : "zh";
  try { localStorage.setItem(LS_LANG, LANG); } catch (e) { /* 忽略 */ }
  applyI18n();
  if (lastData) {
    personalize(lastData.student.name || "");
    renderTab(curTab); // 当前页立即按新语言重渲染；其余页签下次进入时按语言标记自动重渲染
    updateDot();
  }
});
$("msg-form").addEventListener("submit", sendMessage);
$("msg-input").addEventListener("input", () => {
  $("msg-count").textContent = [...$("msg-input").value].length + " / 500";
});
$("gate-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const s = $("gate-s").value.trim(), k = $("gate-k").value.trim();
  if (!s || !k) { showGate(t("gate.errBoth")); return; }
  localStorage.setItem(LS_S, s); localStorage.setItem(LS_K, k);
  if (!localStorage.getItem(LS_A)) localStorage.setItem(LS_A, DEFAULT_API_BASE);
  load();
});
$("forget").addEventListener("click", (ev) => {
  ev.preventDefault();
  localStorage.removeItem(LS_S); localStorage.removeItem(LS_K);
  history.replaceState(null, "", location.pathname);
  showGate();
});
applyI18n();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
else load();
