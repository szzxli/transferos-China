/* mentor.js — 导师工作台（v13）：一位导师一个专属密钥链接（mk_…），不做账号体系。
 * 一屏三块（每名学生一节）：近期动态（事件流）/ 她的需求（未关闭问题+待办+待回看数）/ 待回复+快速回复。
 * 数据边界：接口只返回该导师名下学生的方案层内容；本页不请求学生私密层（本就零服务器数据）
 * 与家长通道（一句话/家长留言不在工作台接口内）。 */
"use strict";
const DEFAULT_API_BASE = "https://transferos-admin.szzxli711.workers.dev";
const LS_S = "oom_mentor_id", LS_K = "oom_mentor_key", LS_A = "oom_mentor_api", LS_LANG = "oom_mentor_lang";

const I18N = {
  zh: {
    "app.title": "导师工作台",
    "gate.title": "输入导师专属信息",
    "gate.desc": "链接里已带好工号与密钥时会自动进入；也可以手动填写（向管理员索取你的专属链接）。",
    "gate.s": "导师工号 / 编号",
    "gate.sph": "如 EMP-001",
    "gate.k": "导师密钥",
    "gate.kph": "如 mk_…",
    "gate.btn": "进入工作台",
    "gate.errBoth": "请把工号和导师密钥都填好",
    "state.loading": "正在加载…",
    "state.retry": "重试",
    "state.notfound": "链接不对或已失效，请向管理员索取最新工作台链接。",
    "state.net": "网络不太顺畅，稍后重试。",
    "hero.exclusive": "导师专属 · 名下学生方案层动态",
    "hero.note": "这里只显示你名下学生的方案层内容：近期动态、她的需求与待回复留言。学生的私密空间与家长通道内容不在这里。",
    "foot.forget": "忘记已保存的链接信息",
    "wb.events": "近期动态",
    "wb.eventsEmpty": "暂无动态",
    "wb.needs": "她的需求",
    "wb.noProblems": "暂无未关闭问题",
    "wb.support": "她希望得到的帮助：",
    "wb.actions": "最近待办",
    "wb.revisit": "待回看的导师轨迹：{n} 条",
    "wb.reply": "待回复",
    "wb.noUnread": "没有待回复的留言",
    "wb.replyPh": "回复她…",
    "wb.send": "回复",
    "wb.sent": "已回复",
    "wb.sendFail": "发送失败，稍后再试",
    "wb.noStudents": "你名下暂时没有学生。",
    "wb.notifiable": "可通知",
    "wb.notNotifiable": "不可通知（请联系管理员补齐联系方式）",
  },
  en: {
    "app.title": "Mentor Workspace",
    "gate.title": "Enter your mentor access details",
    "gate.desc": "If your link already carries your ID and key, you'll be signed in automatically; or enter them here (ask the admin for your personal link).",
    "gate.s": "Mentor ID / staff no.",
    "gate.sph": "e.g. EMP-001",
    "gate.k": "Mentor key",
    "gate.kph": "e.g. mk_…",
    "gate.btn": "Open workspace",
    "gate.errBoth": "Please enter both your ID and mentor key",
    "state.loading": "Loading…",
    "state.retry": "Retry",
    "state.notfound": "This link doesn't work or has expired — ask the admin for a fresh workspace link.",
    "state.net": "Connection problem — please retry in a moment.",
    "hero.exclusive": "For mentors · plan-layer activity of your students",
    "hero.note": "This page shows only the plan-layer content of your own students: recent activity, her needs, and messages awaiting your reply. Students' private space and the parent channel are not shown here.",
    "foot.forget": "Forget saved link details",
    "wb.events": "Recent Activity",
    "wb.eventsEmpty": "No activity yet",
    "wb.needs": "Her Needs",
    "wb.noProblems": "No open problems",
    "wb.support": "Help she asked for: ",
    "wb.actions": "Upcoming to-dos",
    "wb.revisit": "Mentor-trail entries to revisit: {n}",
    "wb.reply": "Awaiting Your Reply",
    "wb.noUnread": "No messages awaiting reply",
    "wb.replyPh": "Reply to her…",
    "wb.send": "Reply",
    "wb.sent": "Replied",
    "wb.sendFail": "Send failed — try again later",
    "wb.noStudents": "No students are assigned to you yet.",
    "wb.notifiable": "Reachable",
    "wb.notNotifiable": "Not reachable (ask the admin to complete your contact info)",
  },
};
let LANG = "zh";
try {
  const saved = localStorage.getItem(LS_LANG);
  if (saved === "en" || saved === "zh") LANG = saved;
} catch (e) { /* 忽略 */ }
function t(key) {
  const dict = I18N[LANG] || I18N.zh;
  return typeof dict[key] === "string" ? dict[key] : (I18N.zh[key] || key);
}
function fmt(key, vars) {
  return t(key).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined && vars[k] !== null ? vars[k] : ""));
}
const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
  document.documentElement.lang = LANG === "en" ? "en" : "zh-CN";
  const z = $("lang-zh"), e = $("lang-en");
  if (z && e) { z.classList.toggle("on", LANG === "zh"); e.classList.toggle("on", LANG === "en"); }
  document.title = t("app.title") + " · TransferOS";
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
  $("gate").hidden = true; $("app").hidden = true;
  $("state").hidden = false;
  $("state-text").textContent = text;
  const btn = $("state-retry");
  btn.hidden = !retry;
  if (retry) btn.onclick = () => load();
}
function showGate(errText) {
  $("state").hidden = true; $("app").hidden = true;
  $("gate").hidden = false;
  const e = $("gate-err");
  if (errText) { e.textContent = errText; e.hidden = false; } else { e.hidden = true; }
}
let lastData = null;
async function load() {
  const { s, k, api } = creds();
  if (!s || !k) { showGate(); return; }
  showState(t("state.loading"), false);
  let resp;
  try {
    resp = await fetch(api + "/api/mentor/" + encodeURIComponent(s) + "?key=" + encodeURIComponent(k),
      { headers: { Accept: "application/json" } });
  } catch (e) { showState(t("state.net"), true); return; }
  if (resp.status === 404) { showState(t("state.notfound"), false); return; }
  if (!resp.ok) { showState(t("state.net"), true); return; }
  let data;
  try { data = await resp.json(); } catch (e) { showState(t("state.net"), true); return; }
  if (!data || data.ok !== true) { showState(t("state.notfound"), false); return; }
  lastData = data;
  render(data);
}
function render(d) {
  $("state").hidden = true; $("gate").hidden = true;
  $("app").hidden = false;
  $("m-name").textContent = d.mentor.name || "";
  const st = $("m-status");
  st.textContent = d.mentor.notifiable ? t("wb.notifiable") : t("wb.notNotifiable");
  const box = $("students");
  if (!d.students.length) {
    box.innerHTML = '<section class="card"><p class="empty">' + esc(t("wb.noStudents")) + "</p></section>";
    return;
  }
  box.innerHTML = d.students.map((blk, i) => studentHtml(blk, i)).join("");
  box.querySelectorAll("[data-reply]").forEach((btn) => btn.addEventListener("click", () => sendReply(btn)));
}
function studentHtml(blk, i) {
  const stu = blk.student;
  const evs = blk.recent_events.length
    ? blk.recent_events.map((e) =>
        '<div class="tl-item"><span class="tl-dot"></span><div class="tl-body">' +
        '<div class="tl-date">' + esc(String(e.created_at || "").slice(0, 16).replace("T", " ")) + " · " + esc(e.event_label || e.event_type || "") + "</div>" +
        '<div class="tl-title">' + esc(e.summary || "") + "</div></div></div>").join("")
    : '<p class="empty">' + esc(t("wb.eventsEmpty")) + "</p>";
  const probs = blk.open_problems.length
    ? blk.open_problems.map((p) =>
        '<div class="know-item"><div class="know-title">' + esc(p.title || "") + "</div>" +
        (p.stuck_summary ? '<div class="know-body">' + esc(p.stuck_summary) + "</div>" : "") +
        (p.support_needed ? '<div class="know-body"><b>' + esc(t("wb.support")) + "</b>" + esc(p.support_needed) + "</div>" : "") +
        "</div>").join("")
    : '<p class="empty">' + esc(t("wb.noProblems")) + "</p>";
  const acts = blk.pending_actions.length
    ? '<h3 class="sub-h">' + esc(t("wb.actions")) + "</h3>" + blk.pending_actions.map((a) =>
        '<div class="course"><span class="name">' + esc(a.title || "") + '</span><span class="cr">' + esc(a.due_text || "") + "</span></div>").join("")
    : "";
  const unread = blk.unread_messages.length
    ? blk.unread_messages.map((m) =>
        '<div class="know-item"><div class="know-body">' + esc(m.body || "") + '</div>' +
        '<div class="mut">' + esc(String(m.created_at || "").slice(0, 16).replace("T", " ")) + "</div></div>").join("")
    : '<p class="empty">' + esc(t("wb.noUnread")) + "</p>";
  return '<section class="card"><h2>' + esc(stu.name || "") +
    (stu.stage_label ? ' <span class="pill">' + esc(stu.stage_label) + "</span>" : "") + "</h2>" +
    '<h3 class="sub-h">' + esc(t("wb.events")) + '</h3><div class="tl">' + evs + "</div>" +
    '<h3 class="sub-h">' + esc(t("wb.needs")) + "</h3>" + probs + acts +
    '<p class="mut" style="margin:8px 0 0">' + esc(fmt("wb.revisit", { n: blk.trail_revisit_pending })) + "</p>" +
    '<h3 class="sub-h">' + esc(t("wb.reply")) + "</h3>" + unread +
    '<form class="wb-reply-form" onsubmit="return false">' +
    '<textarea rows="2" maxlength="500" placeholder="' + esc(t("wb.replyPh")) + '" id="wb-reply-' + i + '"></textarea>' +
    '<div class="msg-bar"><span class="mut" id="wb-status-' + i + '"></span>' +
    '<button type="button" class="btn-send" data-reply="' + i + '" data-student="' + stu.id + '">' + esc(t("wb.send")) + "</button></div></form>" +
    "</section>";
}
async function sendReply(btn) {
  const i = btn.getAttribute("data-reply");
  const sid = Number(btn.getAttribute("data-student"));
  const inp = $("wb-reply-" + i);
  const text = (inp.value || "").trim();
  const status = $("wb-status-" + i);
  if (!text) return;
  const { s, k, api } = creds();
  btn.disabled = true;
  try {
    const resp = await fetch(api + "/api/mentor/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ s, key: k, student_id: sid, body: text }),
    });
    const j = await resp.json().catch(() => null);
    if (resp.ok && j && j.ok) {
      status.textContent = t("wb.sent");
      load();
    } else {
      status.textContent = t("wb.sendFail");
      btn.disabled = false;
    }
  } catch (e) {
    status.textContent = t("wb.sendFail");
    btn.disabled = false;
  }
}
$("lang-toggle").addEventListener("click", () => {
  LANG = LANG === "zh" ? "en" : "zh";
  try { localStorage.setItem(LS_LANG, LANG); } catch (e) { /* 忽略 */ }
  applyI18n();
  if (lastData) render(lastData);
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
