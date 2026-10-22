/* mentor.js — 导师简易沟通台（v14）：一位导师一个专属密钥链接（mk_…），不做账号体系。
 * 主形态 = 沟通台：聚合收件箱（学生留言线 / 家长留言线分开标记）→ 点进对话线 → 文字或
 * 语音转文字回复，后端按 channel 自动分发（学生线进 student_messages、家长线进
 * parent_messages）。语音用浏览器 Web Speech API，转写填入输入框、可编辑、绝不自动发送；
 * 界面明示转写由浏览器厂商服务处理；不支持语音的浏览器禁用按钮并给文字提示。
 * 下方保留 v13 工作台三块（近期动态 / 她的需求 / 待回复+快速回复），数据接口不变。
 * 数据边界：接口只返回该导师名下学生的内容；学生私密层零服务器数据、不在此页；
 * 家长一句话不在沟通台接口内。 */
"use strict";
const DEFAULT_API_BASE = "https://transferos-admin.szzxli711.workers.dev";
const LS_S = "oom_mentor_id", LS_K = "oom_mentor_key", LS_A = "oom_mentor_api", LS_LANG = "oom_mentor_lang";

const I18N = {
  zh: {
    "app.title": "导师沟通台",
    "gate.title": "输入导师专属信息",
    "gate.desc": "链接里已带好工号与密钥时会自动进入；也可以手动填写（向管理员索取你的专属链接）。",
    "gate.s": "导师工号 / 编号",
    "gate.sph": "如 EMP-001",
    "gate.k": "导师密钥",
    "gate.kph": "如 mk_…",
    "gate.btn": "进入沟通台",
    "gate.errBoth": "请把工号和导师密钥都填好",
    "state.loading": "正在加载…",
    "state.retry": "重试",
    "state.notfound": "链接不对或已失效，请向管理员索取最新工作台链接。",
    "state.net": "网络不太顺畅，稍后重试。",
    "hero.exclusive": "导师专属 · 沟通台",
    "hero.note": "这里是你的沟通台：名下学生的留言与家长对话线都在这里回复；学生的私密空间与「给爸妈的一句话」不在这里。",
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
    "wb.correction": "课程数据纠错",
    "cm.inbox": "收件箱",
    "cm.loading": "正在加载…",
    "cm.inboxFail": "收件箱加载失败，稍后重进页面试试。",
    "cm.emptyThreads": "暂时没有消息。有新留言时会出现在这里。",
    "cm.chStudent": "学生留言",
    "cm.chParent": "家长留言",
    "cm.back": "← 返回收件箱",
    "cm.replyPh": "写回复…",
    "cm.send": "发送",
    "cm.sent": "已发送",
    "cm.sendFail": "发送失败，稍后再试",
    "cm.voice": "🎤 语音",
    "cm.voiceNote": "语音输入使用浏览器自带的识别服务，转写由浏览器厂商的服务处理；转成文字后你可以先修改，再点发送。",
    "cm.voiceUnsupported": "当前浏览器不支持语音识别，请打字输入。",
    "cm.youPrefix": "我：",
    "cm.threadFail": "对话加载失败，稍后再试。",
    "cm.emptyThread": "还没有往来消息。",
  },
  en: {
    "app.title": "Mentor Inbox",
    "gate.title": "Enter your mentor access details",
    "gate.desc": "If your link already carries your ID and key, you'll be signed in automatically; or enter them here (ask the admin for your personal link).",
    "gate.s": "Mentor ID / staff no.",
    "gate.sph": "e.g. EMP-001",
    "gate.k": "Mentor key",
    "gate.kph": "e.g. mk_…",
    "gate.btn": "Open inbox",
    "gate.errBoth": "Please enter both your ID and mentor key",
    "state.loading": "Loading…",
    "state.retry": "Retry",
    "state.notfound": "This link doesn't work or has expired — ask the admin for a fresh workspace link.",
    "state.net": "Connection problem — please retry in a moment.",
    "hero.exclusive": "For mentors · Inbox",
    "hero.note": "This is your inbox: reply here to your students' messages and to parent conversations. Students' private space and their notes to parents are not shown here.",
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
    "wb.correction": "Course data correction",
    "cm.inbox": "Inbox",
    "cm.loading": "Loading…",
    "cm.inboxFail": "Inbox failed to load — reopen the page in a moment.",
    "cm.emptyThreads": "No messages yet. New messages will appear here.",
    "cm.chStudent": "Student",
    "cm.chParent": "Parent",
    "cm.back": "← Back to inbox",
    "cm.replyPh": "Write a reply…",
    "cm.send": "Send",
    "cm.sent": "Sent",
    "cm.sendFail": "Send failed — try again later",
    "cm.voice": "🎤 Voice",
    "cm.voiceNote": "Voice input uses your browser's built-in speech recognition, processed by the browser vendor's service. The transcript lands in the box first — edit it, then send.",
    "cm.voiceUnsupported": "This browser doesn't support speech recognition — please type instead.",
    "cm.youPrefix": "Me: ",
    "cm.threadFail": "Conversation failed to load — try again later.",
    "cm.emptyThread": "No messages yet.",
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
    .replace(/&/g, "&amp;").replace(/</g, "&gt;").replace(/>/g, "&gt;")
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
  loadInbox();
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
        '<div class="know-item"><div class="know-body">' +
        (m.category === "data_correction" ? '<span class="pill">' + esc(t("wb.correction")) + "</span> " : "") +
        esc(m.body || "") + '</div>' +
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

/* ===== v14 沟通台：收件箱 → 对话线 → 回复（含语音转文字） ===== */
let lastInbox = null;
let curThread = null;   // { student_id, channel, name }
let lastThread = null;  // thread API 响应
async function loadInbox() {
  const { s, k, api } = creds();
  let d = null;
  try {
    const resp = await fetch(api + "/api/mentor/inbox/" + encodeURIComponent(s) + "?key=" + encodeURIComponent(k),
      { headers: { Accept: "application/json" } });
    if (resp.ok) d = await resp.json();
  } catch (e) { /* 失败走空态文案 */ }
  if (!d || d.ok !== true) {
    $("inbox-list").innerHTML = '<p class="empty">' + esc(t("cm.inboxFail")) + "</p>";
    $("inbox-badge").hidden = true;
    return;
  }
  lastInbox = d;
  renderInbox(d);
}
function renderInbox(d) {
  const badge = $("inbox-badge");
  const total = Number(d.total_unread) || 0;
  badge.hidden = total <= 0;
  badge.textContent = total > 0 ? String(total) : "";
  const threads = Array.isArray(d.threads) ? d.threads : [];
  const box = $("inbox-list");
  if (!threads.length) {
    box.innerHTML = '<p class="empty">' + esc(t("cm.emptyThreads")) + "</p>";
    return;
  }
  box.innerHTML = threads.map((th) => {
    const chLabel = th.channel === "parent" ? t("cm.chParent") : t("cm.chStudent");
    const excerpt = (th.last && th.last.sender === "mentor" ? t("cm.youPrefix") : "") + (th.last ? th.last.body || "" : "");
    return '<button type="button" class="inbox-row" data-th-student="' + th.student_id +
      '" data-th-channel="' + esc(th.channel || "student") + '" data-th-name="' + esc(th.student_name || "") + '">' +
      '<span class="inbox-main"><span class="inbox-top"><span class="inbox-name">' + esc(th.student_name || "") + "</span>" +
      '<span class="pill">' + esc(chLabel) + "</span></span>" +
      '<span class="inbox-excerpt">' + esc(excerpt) + "</span></span>" +
      '<span class="inbox-side"><span class="inbox-time">' +
      esc(th.last ? String(th.last.created_at || "").slice(0, 16).replace("T", " ") : "") + "</span>" +
      (th.unread > 0 ? '<span class="inbox-unread">' + th.unread + "</span>" : "") +
      "</span></button>";
  }).join("");
  box.querySelectorAll("[data-th-student]").forEach((el) => el.addEventListener("click", () => {
    openThread(Number(el.getAttribute("data-th-student")), el.getAttribute("data-th-channel") || "student",
      el.getAttribute("data-th-name") || "");
  }));
}
async function openThread(studentId, channel, name) {
  const { s, k, api } = creds();
  curThread = { student_id: studentId, channel: channel === "parent" ? "parent" : "student", name: name || "" };
  $("thread-card").hidden = false;
  $("th-title").textContent = (name || "") + " · " + (curThread.channel === "parent" ? t("cm.chParent") : t("cm.chStudent"));
  $("th-msgs").innerHTML = '<p class="empty">' + esc(t("cm.loading")) + "</p>";
  $("th-status").textContent = "";
  $("th-input").value = "";
  setupVoice();
  let d = null;
  try {
    const resp = await fetch(api + "/api/mentor/thread/" + encodeURIComponent(s) +
      "?key=" + encodeURIComponent(k) + "&student_id=" + encodeURIComponent(studentId) +
      "&channel=" + encodeURIComponent(curThread.channel),
      { headers: { Accept: "application/json" } });
    if (resp.ok) d = await resp.json();
  } catch (e) { /* 失败提示 */ }
  if (!d || d.ok !== true) {
    $("th-msgs").innerHTML = '<p class="empty">' + esc(t("cm.threadFail")) + "</p>";
    return;
  }
  lastThread = d;
  if (d.student && d.student.name) {
    curThread.name = d.student.name;
    $("th-title").textContent = d.student.name + " · " + (curThread.channel === "parent" ? t("cm.chParent") : t("cm.chStudent"));
  }
  renderThreadMsgs();
  loadInbox(); // 打开即已读 → 刷新徽标与列表未读
  const tc = $("thread-card");
  if (tc.scrollIntoView) tc.scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderThreadMsgs() {
  const box = $("th-msgs");
  const msgs = lastThread && Array.isArray(lastThread.messages) ? lastThread.messages : [];
  if (!msgs.length) {
    box.innerHTML = '<p class="empty">' + esc(t("cm.emptyThread")) + "</p>";
    return;
  }
  box.innerHTML = msgs.map((m) => {
    const mine = m.sender === "mentor";
    const when = String(m.created_at || "").slice(0, 16).replace("T", " ");
    const who = m.sender_label || (mine ? "" : "");
    return '<div class="msg-row ' + (mine ? "mine" : "mentor") + '">' +
      '<div class="msg-meta">' + esc(who) + (when ? " · " + esc(when) : "") + "</div>" +
      '<div class="msg-bubble">' + esc(m.body || "") + "</div></div>";
  }).join("");
  box.scrollTop = box.scrollHeight;
}
function closeThread() {
  stopVoice();
  curThread = null;
  lastThread = null;
  $("thread-card").hidden = true;
}
async function sendThreadReply() {
  if (!curThread) return;
  const inp = $("th-input");
  const text = (inp.value || "").trim();
  const status = $("th-status");
  if (!text) return;
  const { s, k, api } = creds();
  const btn = $("th-send");
  btn.disabled = true;
  try {
    const resp = await fetch(api + "/api/mentor/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ s, key: k, student_id: curThread.student_id, channel: curThread.channel, body: text }),
    });
    const j = await resp.json().catch(() => null);
    if (resp.ok && j && j.ok) {
      status.textContent = t("cm.sent");
      inp.value = "";
      if (lastThread && Array.isArray(lastThread.messages)) {
        lastThread.messages.push(j.message);
        renderThreadMsgs();
      }
      loadInbox();
    } else {
      status.textContent = t("cm.sendFail");
    }
  } catch (e) {
    status.textContent = t("cm.sendFail");
  }
  btn.disabled = false;
}
/* 语音转文字：Web Speech API。转写只填输入框，导师改完再发送，绝不自动直发。 */
let recog = null, voiceOn = false, voiceBase = "", voiceFinal = "";
function speechCtor() {
  try { return window.SpeechRecognition || window.webkitSpeechRecognition || null; } catch (e) { return null; }
}
function setupVoice() {
  const btn = $("th-voice"), uns = $("th-voice-unsupported");
  stopVoice();
  if (!speechCtor()) {
    btn.disabled = true;
    uns.hidden = false;
    return;
  }
  btn.disabled = false;
  uns.hidden = true;
  btn.onclick = toggleVoice;
}
function stopVoice() {
  if (recog) { try { recog.stop(); } catch (e) { /* 忽略 */ } }
  recog = null;
  voiceOn = false;
  const btn = $("th-voice");
  if (btn) btn.classList.remove("voice-on");
}
function toggleVoice() {
  const btn = $("th-voice");
  if (voiceOn) { stopVoice(); return; }
  const Ctor = speechCtor();
  if (!Ctor) return;
  const inp = $("th-input");
  voiceBase = inp.value ? inp.value.replace(/\s+$/, "") + " " : "";
  voiceFinal = "";
  try {
    recog = new Ctor();
  } catch (e) { return; }
  recog.lang = LANG === "en" ? "en-US" : "zh-CN";
  recog.interimResults = true;
  recog.continuous = false;
  recog.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) voiceFinal += r[0].transcript;
      else interim += r[0].transcript;
    }
    inp.value = voiceBase + voiceFinal + interim;
  };
  recog.onend = () => {
    inp.value = voiceBase + voiceFinal;
    voiceOn = false;
    btn.classList.remove("voice-on");
    recog = null;
  };
  recog.onerror = () => {
    voiceOn = false;
    btn.classList.remove("voice-on");
    recog = null;
  };
  try {
    recog.start();
    voiceOn = true;
    btn.classList.add("voice-on");
  } catch (e) { /* 已在录音等异常不崩页 */ }
}
$("lang-toggle").addEventListener("click", () => {
  LANG = LANG === "zh" ? "en" : "zh";
  try { localStorage.setItem(LS_LANG, LANG); } catch (e) { /* 忽略 */ }
  applyI18n();
  if (lastData) render(lastData);
  if (lastInbox) renderInbox(lastInbox);
  if (curThread && lastThread) {
    $("th-title").textContent = (curThread.name || "") + " · " +
      (curThread.channel === "parent" ? t("cm.chParent") : t("cm.chStudent"));
    renderThreadMsgs();
  }
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
$("th-back").addEventListener("click", () => closeThread());
$("th-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  sendThreadReply();
});
applyI18n();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
else load();
