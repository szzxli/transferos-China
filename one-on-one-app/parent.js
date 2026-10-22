"use strict";
/* 一对一家长端（v11）：家长专属链接 ?s=<专属名或编号>&p=<家长密钥>。
 * 数据边界：本页只读取 /api/parent 接口下发的导师整理内容（家长更新 / 如何托举 / 家长↔导师留言），
 * 不接触学生端接口与学生原始数据（考试 / 成绩 / 课程 / 学生留言等一律不下发到这里）。
 * 机制承接：家长端打通的只能是经学生确认、再由导师整理过的「解决方案与规划结果」；
 * 学生日记、想法与情绪困惑等私密原文按定版只保存在学生本机、永不进服务器，本页不预留此类字段。
 * 凭据与语言存 localStorage（oop_ 家长端专属前缀，与学生端完全独立，互不覆盖）。 */
const DEFAULT_API_BASE = "https://transferos-admin.szzxli711.workers.dev";
const LS_S = "oop_parent_id", LS_K = "oop_parent_key", LS_A = "oop_parent_api", LS_LANG = "oop_parent_lang";

/* —— 双语字典：只覆盖界面文案；导师写的数据正文（更新标题/正文、托举事项、留言）按原文展示，不翻译 —— */
const STAGE_EN = {
  diag: "Assessment & Diagnosis", enroll: "Enrollment Application", planning: "Course Planning",
  coaching: "Semester Coaching", transfer: "Transfer Application", visa: "Visa Coaching",
  admitted: "Admitted", renewal: "Renewal", referral: "Referral",
};
const I18N = {
  zh: {
    "app.title": "家长更新",
    "gate.title": "输入家长专属信息",
    "gate.desc": "链接里已带好专属名与密钥时会自动进入；也可以手动填写。",
    "gate.s": "专属名 / 编号",
    "gate.sph": "如 richa",
    "gate.k": "家长密钥",
    "gate.kph": "如 pk_…",
    "gate.btn": "进入家长端",
    "gate.errBoth": "请把专属名和家长密钥都填好",
    "state.loading": "正在加载…",
    "state.retry": "重试",
    "state.notfound.title": "链接不对或已失效",
    "state.notfound.desc": "请确认链接完整，或向导师索取最新的家长专属链接。",
    "state.net.title": "网络不太顺畅",
    "state.net.desc": "稍后点重试即可。",
    "foot.note": "本页内容由导师专门为家长整理，只在家长与导师之间。",
    "foot.forget": "忘记已保存的链接信息",
    "tab.home": "首页",
    "tab.progress": "进展",
    "tab.support": "托举",
    "tab.mentor": "导师",
    "hero.exclusive": "家长专属 · 进展更新",
    "title.suffix": "家长更新",
    "latest.title": "最新进展",
    "latest.empty": "导师还没有发布进展更新，有新进展会第一时间出现在这里。",
    "upd.progress": "阶段进展",
    "upd.focus": "当前解决策略",
    "upd.next": "下一步",
    "home.unread": "导师有 {n} 条新留言，去「导师」页查看 →",
    "progress.stageTitle": "当前服务阶段",
    "progress.stageDesc": "服务按阶段推进。导师会在每个阶段把孩子的进展整理成更新发到这里；您在这里看到的，都是导师确认过的最新情况。",
    "progress.title": "进展时间线",
    "updates.empty": "还没有进展更新。",
    "support.principleTitle": "如何托举",
    "support.principle": "导师会把需要家庭配合的事项写在这里；不在这里追问成绩与考试细节，给孩子保留稳定的空间。",
    "support.title": "需要家庭配合的事项",
    "support.empty": "暂时没有需要家庭配合的事项，有需要时导师会及时更新到这里。",
    "mentor.title": "与导师沟通",
    "mentor.note": "这里的沟通只在家长与导师之间，不会转成对学生的监视或追问。孩子在学习上的具体细节，导师会在进展更新里以合适的方式同步。",
    "msg.you": "我",
    "msg.mentor": "导师",
    "msg.emptyThread": "有问题可以在这里直接问导师，导师会尽快回复。",
    "msg.label": "给导师留言",
    "msg.ph": "写下您想问导师的问题…",
    "msg.send": "发送",
    "msg.sending": "发送中…",
    "msg.errEmpty": "先写点内容再发送",
    "msg.errTooLong": "留言太长了（最多 500 字）",
    "msg.errFreq": "发送太频繁，请过一分钟再试",
    "msg.errGone": "链接已失效，请向导师索取最新家长链接",
    "msg.errNet": "发送失败，请检查网络后重试",
    "note.title": "孩子想对您说",
    "note.empty": "孩子还没有发来一句话；她主动分享时，会出现在这里。",
    "ach.title": "最近的成就",
    "ach.empty": "还没有可展示的成就，新的进展会出现在这里。",
    "ach.kind.milestone": "完成里程碑",
    "ach.kind.action": "完成了一件事",
    "ach.kind.problem": "解决了一个问题",
    "rem.title": "近期重要日子",
    "rem.empty": "未来 30 天没有特别的日子。",
    "rem.inDays": "{n} 天后",
    "rem.today": "就是今天",
  },
  en: {
    "app.title": "Parent Updates",
    "gate.title": "Enter your parent access details",
    "gate.desc": "If your link already carries your ID and key, you'll be signed in automatically; or enter them here.",
    "gate.s": "ID / name code",
    "gate.sph": "e.g. richa",
    "gate.k": "Parent key",
    "gate.kph": "e.g. pk_…",
    "gate.btn": "Open Parent Updates",
    "gate.errBoth": "Please enter both your ID and parent key",
    "state.loading": "Loading…",
    "state.retry": "Retry",
    "state.notfound.title": "This link doesn't work or has expired",
    "state.notfound.desc": "Please check the link is complete, or ask your mentor for the latest parent link.",
    "state.net.title": "Connection problem",
    "state.net.desc": "Please retry in a moment.",
    "foot.note": "This page is prepared by your mentor for parents only.",
    "foot.forget": "Forget saved link details",
    "tab.home": "Home",
    "tab.progress": "Progress",
    "tab.support": "Support",
    "tab.mentor": "Mentor",
    "hero.exclusive": "For parents · Progress updates",
    "title.suffix": "Parent Updates",
    "latest.title": "Latest Update",
    "latest.empty": "No updates yet — your mentor will post progress here as soon as there is news.",
    "upd.progress": "Stage progress",
    "upd.focus": "Current solution strategy",
    "upd.next": "Next step",
    "home.unread": "{n} new message(s) from your mentor — view →",
    "progress.stageTitle": "Current Service Stage",
    "progress.stageDesc": "The service moves forward in stages. At each stage your mentor posts a prepared update here — everything you see has been reviewed by your mentor first.",
    "progress.title": "Progress Timeline",
    "updates.empty": "No progress updates yet.",
    "support.principleTitle": "How You Can Support",
    "support.principle": "Your mentor lists here anything the family can help with. We don't go into grades or exam details here — that protects a calm, stable space for your child.",
    "support.title": "What the Family Can Help With",
    "support.empty": "Nothing is needed from the family right now — your mentor will update this list whenever something comes up.",
    "mentor.title": "Talk to Your Mentor",
    "mentor.note": "Messages here stay between parents and the mentor — they are never used to monitor or pressure the student. Study details are shared in the progress updates in an appropriate way.",
    "msg.you": "Me",
    "msg.mentor": "Mentor",
    "msg.emptyThread": "Ask your mentor anything here — they'll reply as soon as they can.",
    "msg.label": "Message to your mentor",
    "msg.ph": "Write your question for the mentor…",
    "msg.send": "Send",
    "msg.sending": "Sending…",
    "msg.errEmpty": "Write something first",
    "msg.errTooLong": "Message too long (max 500 characters)",
    "msg.errFreq": "Sending too fast — please wait a minute",
    "msg.errGone": "This link has expired — please ask your mentor for the latest parent link",
    "msg.errNet": "Send failed — please check your connection and retry",
    "note.title": "A Line From Your Child",
    "note.empty": "No line from your child yet — when she chooses to share one, it will appear here.",
    "ach.title": "Recent Achievements",
    "ach.empty": "No achievements to show yet — new milestones will appear here.",
    "ach.kind.milestone": "Milestone reached",
    "ach.kind.action": "Completed a task",
    "ach.kind.problem": "Solved a problem",
    "rem.title": "Coming Up",
    "rem.empty": "No special dates in the next 30 days.",
    "rem.inDays": "in {n} days",
    "rem.today": "Today",
  },
};
let LANG = "zh";
try {
  const savedLang = localStorage.getItem(LS_LANG);
  if (savedLang === "en" || savedLang === "zh") LANG = savedLang;
} catch (e) { /* 隐私模式等场景忽略 */ }
function t(key) {
  return (I18N[LANG] && I18N[LANG][key]) || I18N.zh[key] || key;
}
function fmt(key, vars) {
  return t(key).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? String(vars[k]) : ""));
}
function applyI18n() {
  document.documentElement.lang = LANG === "en" ? "en" : "zh-CN";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
  $("lang-zh").classList.toggle("on", LANG === "zh");
  $("lang-en").classList.toggle("on", LANG === "en");
}

const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

let lastData = null;
let curTab = "home";
const renderedTabs = {}; // tab -> 渲染时的语言；语言不一致即重渲染（懒渲染，切页签时补）
const TABS = ["home", "progress", "support", "mentor"];

function creds() {
  const q = new URLSearchParams(location.search);
  let s = q.get("s"), k = q.get("p"), api = q.get("api");
  try {
    if (s && k) {
      localStorage.setItem(LS_S, s);
      localStorage.setItem(LS_K, k);
      localStorage.setItem(LS_A, api || DEFAULT_API_BASE);
    } else {
      s = s || localStorage.getItem(LS_S);
      k = k || localStorage.getItem(LS_K);
    }
    api = api || localStorage.getItem(LS_A) || DEFAULT_API_BASE;
  } catch (e) { /* 忽略 */ }
  return { s: s || "", k: k || "", api: (api || DEFAULT_API_BASE).replace(/\/+$/, "") };
}

function showGate(errText) {
  $("gate").hidden = false; $("state").hidden = true; $("app").hidden = true; $("tabbar").hidden = true;
  const e = $("gate-err");
  if (errText) { e.textContent = errText; e.hidden = false; } else { e.hidden = true; }
}
function showState(html, retry) {
  $("gate").hidden = true; $("state").hidden = false; $("app").hidden = true; $("tabbar").hidden = true;
  $("state-text").innerHTML = html;
  $("state-retry").hidden = !retry;
}

async function load() {
  const { s, k, api } = creds();
  if (!s || !k) { showGate(); return; }
  showState(esc(t("state.loading")), false);
  let resp;
  try {
    resp = await fetch(api + "/api/parent/" + encodeURIComponent(s) + "?key=" + encodeURIComponent(k), {
      headers: { "Accept": "application/json" },
    });
  } catch (e) {
    showState("<b>" + esc(t("state.net.title")) + "</b><br>" + esc(t("state.net.desc")), true);
    return;
  }
  if (resp.status === 404) {
    showState("<b>" + esc(t("state.notfound.title")) + "</b><br>" + esc(t("state.notfound.desc")), false);
    return;
  }
  if (!resp.ok) {
    showState("<b>" + esc(t("state.net.title")) + "</b><br>" + esc(t("state.net.desc")), true);
    return;
  }
  let data;
  try { data = await resp.json(); } catch (e) {
    showState("<b>" + esc(t("state.net.title")) + "</b><br>" + esc(t("state.net.desc")), true);
    return;
  }
  if (!data || data.ok !== true || !data.student) {
    showState("<b>" + esc(t("state.net.title")) + "</b><br>" + esc(t("state.net.desc")), true);
    return;
  }
  lastData = data;
  render(data);
}

/* 标题与「添加到主屏幕」名称动态带上孩子姓名：<姓名> 家长更新 */
function personalize(name) {
  const title = name ? name + " " + t("title.suffix") : t("app.title");
  document.title = title;
  const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (meta) meta.setAttribute("content", title);
}

function stageLabel(d) {
  const st = (d.student && d.student.stage) || "";
  if (LANG === "en") return STAGE_EN[st] || (d.student && d.student.stage_label) || st;
  return (d.student && d.student.stage_label) || st;
}

function render(d) {
  $("gate").hidden = true; $("state").hidden = true; $("app").hidden = false; $("tabbar").hidden = false;
  personalize(d.student.name || "");
  for (const k of Object.keys(renderedTabs)) delete renderedTabs[k];
  switchTab(curTab);
  updateDot();
}

function switchTab(tab) {
  if (!TABS.includes(tab)) tab = "home";
  curTab = tab;
  // 进入导师页即视为已读完导师留言（服务端在 GET 时已标记）：本地未读数清零，红点与首页入口同步消失
  if (tab === "mentor" && lastData) lastData.unread_mentor_parent = 0;
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("on", b.getAttribute("data-tab") === tab));
  TABS.forEach((x) => { $("page-" + x).hidden = x !== tab; });
  if (lastData && renderedTabs[tab] !== LANG) {
    ({ home: renderHome, progress: renderProgress, support: renderSupport, mentor: renderMentor })[tab](lastData);
    renderedTabs[tab] = LANG;
  }
  updateDot();
  try { window.scrollTo(0, 0); } catch (e) { /* 忽略 */ }
}

function updateDot() {
  const n = lastData ? (lastData.unread_mentor_parent || 0) : 0;
  $("tab-dot").hidden = !(n > 0 && curTab !== "mentor");
  const hu = $("home-unread");
  if (n > 0) {
    hu.hidden = false;
    hu.textContent = fmt("home.unread", { n });
  } else {
    hu.hidden = true;
  }
}

/* 一条家长更新的正文块（首页最新一条与进展时间线共用）。
 * 呈现口径（机制定版）：body=阶段进展、current_focus=当前解决策略、next_step=下一步——
 * 家长看到的只能是经学生确认、再由导师整理过的解决方案与规划结果，
 * 不承接学生日记/情绪等私密原文（那些只存学生本机、永不进服务器，本页不设此类字段）。 */
function updateBodyHtml(u) {
  return (u.body ? '<div class="pu-sec-label">' + esc(t("upd.progress")) + '</div><div class="pu-sec-text">' + esc(u.body) + "</div>" : "") +
    (u.current_focus ? '<div class="pu-sec-label">' + esc(t("upd.focus")) + '</div><div class="pu-sec-text">' + esc(u.current_focus) + "</div>" : "") +
    (u.next_step ? '<div class="pu-sec-label">' + esc(t("upd.next")) + '</div><div class="pu-sec-text">' + esc(u.next_step) + "</div>" : "");
}

/* —— 页1 首页 —— */
function renderHome(d) {
  $("p-name").textContent = d.student.name || "";
  $("p-stage").textContent = stageLabel(d);
  const pkg = $("p-package");
  if (d.student.package) { pkg.hidden = false; pkg.textContent = d.student.package; }
  else { pkg.hidden = true; pkg.textContent = ""; }
  const ups = d.updates || [];
  const latest = ups[0];
  $("latest-date").textContent = latest ? (latest.update_date || "") : "";
  $("latest-body").innerHTML = latest
    ? '<div class="tl-title">' + esc(latest.title || "") + "</div>" + updateBodyHtml(latest)
    : '<p class="empty">' + esc(t("latest.empty")) + "</p>";
  renderParentExtras(d);
}

/* —— v13：孩子的一句话 / 成就 / 重要日子（数据源均为方案层事实，见后台口径） —— */
function fmtRemDate(isoStr) {
  const m = String(isoStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(isoStr || "");
  return LANG === "en"
    ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1] + " " + Number(m[3])
    : Number(m[2]) + " 月 " + Number(m[3]) + " 日";
}
function renderParentExtras(d) {
  // 一句话：只展示学生主动发出、未撤回的
  const notes = d.student_notes || [];
  $("note-body").innerHTML = notes.length
    ? notes.slice(0, 3).map((n) =>
        '<div class="pnote-item"><div class="pnote-main"><span>「' + esc(n.body) + "」</span>" +
        (n.feeling_tag_label ? ' <span class="pill">' + esc(n.feeling_tag_label) + "</span>" : "") +
        ' <span class="mut">' + esc(String(n.created_at || "").slice(0, 10)) + "</span></div></div>").join("")
    : '<p class="empty">' + esc(t("note.empty")) + "</p>";
  // 成就：方案层事实（里程碑/已完成行动/已解决的问题），按日期倒序展示（无日期排后）
  const ach = (d.achievements || []).slice().sort((a, b) => String(b.date_text || "").localeCompare(String(a.date_text || "")));
  $("ach-body").innerHTML = ach.length
    ? ach.slice(0, 10).map((a) =>
        '<div class="tl-item"><span class="tl-dot"></span><div class="tl-body">' +
        '<div class="tl-date">' + esc(t("ach.kind." + a.kind)) + (a.date_text ? " · " + esc(a.date_text) : "") + "</div>" +
        '<div class="tl-title">' + esc(a.title || "") + "</div></div></div>").join("")
    : '<p class="empty">' + esc(t("ach.empty")) + "</p>";
  // 重要日子：未来 30 天（服务端已算好窗口与 days_left），温和提醒文案
  const rems = d.upcoming_reminders || [];
  $("rem-body").innerHTML = rems.length
    ? rems.map((r) =>
        '<div class="cd-item"><div class="cd-main"><div class="cd-title">' + esc(r.title || "") + "</div>" +
        '<div class="cd-date">' + esc(fmtRemDate(r.date)) + '</div></div><div class="cd-days">' +
        esc(r.days_left === 0 ? t("rem.today") : fmt("rem.inDays", { n: r.days_left })) + "</div></div>").join("")
    : '<p class="empty">' + esc(t("rem.empty")) + "</p>";
}

/* —— 页2 进展 —— */
function renderProgress(d) {
  $("stage-chip").textContent = stageLabel(d);
  const ups = d.updates || [];
  $("updates-list").innerHTML = ups.length
    ? '<div class="tl">' + ups.map((u) =>
        '<div class="tl-item"><span class="tl-dot"></span>' +
        '<div class="tl-date">' + esc(u.update_date || "") + "</div>" +
        '<div class="tl-title">' + esc(u.title || "") + "</div>" +
        updateBodyHtml(u) + "</div>").join("") + "</div>"
    : '<p class="empty">' + esc(t("updates.empty")) + "</p>";
}

/* —— 页3 托举 —— */
function renderSupport(d) {
  const list = (d.support_actions || []).filter((a) => a.status !== "archived");
  $("support-list").innerHTML = list.length ? list.map((a) => {
    const done = a.status === "done";
    return '<div class="act-item' + (done ? " done" : "") + '">' +
      '<span class="act-check">' + (done ? "✓" : "") + "</span>" +
      '<div class="act-body"><div class="act-title">' + esc(a.title || "") + "</div>" +
      (a.detail ? '<div class="act-detail">' + esc(a.detail) + "</div>" : "") +
      "</div>" +
      (a.due_text ? '<span class="act-due">' + esc(a.due_text) + "</span>" : "") +
      "</div>";
  }).join("") : '<p class="empty">' + esc(t("support.empty")) + "</p>";
}

/* —— 页4 导师 —— */
function renderMentor(d) {
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
    const mine = m.sender === "parent";
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
    const resp = await fetch(api + "/api/parent/message", {
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
$("home-unread").addEventListener("click", () => switchTab("mentor"));
$("lang-toggle").addEventListener("click", () => {
  LANG = LANG === "zh" ? "en" : "zh";
  try { localStorage.setItem(LS_LANG, LANG); } catch (e) { /* 忽略 */ }
  applyI18n();
  if (lastData) {
    personalize(lastData.student.name || "");
    switchTab(curTab); // renderedTabs 语言标记不一致 → 当前页重渲染；其余页签下次进入时重渲染
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
  try {
    localStorage.setItem(LS_S, s); localStorage.setItem(LS_K, k);
    if (!localStorage.getItem(LS_A)) localStorage.setItem(LS_A, DEFAULT_API_BASE);
  } catch (e) { /* 忽略 */ }
  load();
});
$("state-retry").addEventListener("click", () => load());
$("forget").addEventListener("click", (ev) => {
  ev.preventDefault();
  try {
    localStorage.removeItem(LS_S); localStorage.removeItem(LS_K);
  } catch (e) { /* 忽略 */ }
  try { history.replaceState(null, "", location.pathname); } catch (e) { /* 忽略 */ }
  showGate();
});
applyI18n();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
else load();
