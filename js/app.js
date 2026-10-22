/* TransferOS-China v0.1 共享工具 — 前端工具 + 匿名访问计数上报 */
"use strict";

var LS_PREFIX = "tog_";

function togGet(key, fallback) {
  try {
    var v = localStorage.getItem(LS_PREFIX + key);
    return v === null ? fallback : JSON.parse(v);
  } catch (e) { return fallback; }
}
function togSet(key, val) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch (e) {}
}
/* 代理推荐归因：?ref=代理码 → tog_ref（首次触达归因） */
(function () {
  try {
    var qm = /[?&]ref=([A-Za-z0-9_-]{1,24})/.exec(location.search || "");
    if (qm) togSet("ref", qm[1]);
  } catch (e) {}
})();
/* 匿名访问计数：页面加载时向管理后台上报一次（仅归因码 + 页面名，失败静默，不影响页面功能） */
var TOG_API_BASE = "https://transferos-admin.szzxli711.workers.dev";
(function () {
  try {
    var ref = togGet("ref", null);
    if (typeof ref !== "string" || !/^[A-Za-z0-9_-]{1,24}$/.test(ref)) ref = "DIRECT";
    var seg = (location.pathname || "/").split("/").pop() || "";
    var page = seg.replace(/\.html$/i, "") || "index";
    fetch(TOG_API_BASE + "/api/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: ref, page: page }),
      keepalive: true
    }).catch(function () {});
  } catch (e) {}
})();
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function fmtUSD(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}
/* 底部导航激活态 */
function togNavActive(page) {
  document.querySelectorAll(".tabbar a").forEach(function (a) {
    a.classList.toggle("active", a.dataset.page === page);
  });
}
/* 评估状态栏：选课/规划/指南页顶部按评估结果高亮定制通道 */
function renderEvalBanner(slotId) {
  var slot = document.getElementById(slotId || "evalBanner");
  if (!slot) return;
  var e = togGet("eval", null);
  if (!e || !e.verdict) { slot.innerHTML = ""; return; }
  var modeTxt = e.mode === "inperson" ? "赴美线下" : "纯线上";
  var h = "";
  if (e.verdict === "ok") {
    h = '<div class="evalbar ok">✅ 评估通过 · ' + esc(modeTxt) + '模式</div>';
  } else if (e.verdict === "warn") {
    h = '<div class="evalbar warn">⚠️ 评估有短板' + (e.esl ? ' · 英语未达标，ESL 桥梁约 +$2,840' : '')
      + ' · <a href="evaluate.html">重新评估</a></div>';
  } else {
    h = '<div class="evalbar bad">❌ 评估未通过 · <a href="evaluate.html">查看原因</a></div>';
  }
  slot.innerHTML = h;
}

/* ---- 咨询漏斗 A：总开关（资质结论前保持 false，卡片不渲染） ---- */
var FUNNEL_OPEN = false;
/* 咨询卡独立开关（2026-10-22 用户拍板）：只放行咨询口径的承接卡，FUNNEL_OPEN 服务闸不动 */
var FUNNEL_CONSULT_OPEN = true;
function funnelCtx() {
  var e = togGet("eval", null), parts = [];
  if (e && e.verdict) {
    parts.push(e.mode === "inperson" ? "赴美" : "纯线上");
    parts.push(e.verdict === "ok" ? "评估通过" : e.verdict === "warn" ? "评估有短板" : "评估未通过");
  }
  return parts.join("·");
}
function funnelAsk(source) {
  var p = document.getElementById("chatPanel");
  if (p && p.hidden && typeof chatToggle === "function") chatToggle();
  var ctx = funnelCtx();
  var __ref = togGet("ref", "");
  var note = "TransferOS\u54a8\u8be2\u00b7" + source + (ctx ? "\u00b7" + ctx : "") + (__ref ? "\u00b7\u4ee3\u7406:" + __ref : "");
  if (typeof chatBotSay === "function") chatBotSay("👋 你好！我是从<b>" + esc(source) + "</b>过来的" + (ctx ? "（" + esc(ctx) + "）" : "") + "，想咨询一下。");
  if (typeof chatHumanCard === "function") chatHumanCard(note);
}
function funnelShow(id) {
  if ((typeof FUNNEL_OPEN !== "undefined" && FUNNEL_OPEN) || (typeof FUNNEL_CONSULT_OPEN !== "undefined" && FUNNEL_CONSULT_OPEN)) {
    var el = document.getElementById(id);
    if (el) el.hidden = false;
  }
}
/* 邮件咨询直达：主题自动带来源与评估结论，正文预填三行 */
function mailConsult(source) {
  var ctx = funnelCtx();
  var ref = togGet("ref", "");
  var subject = "TransferOS咨询·" + source + (ctx ? "·" + ctx : "") + (ref ? "·代理:" + ref : "");
  var body = "我的情况：\n我想问的问题：\n我的联系方式（微信/电话）：";
  window.location.href = "mailto:info@zhuanuc.com?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
}

/* ---- 步骤式折叠：点一步→展开→提交→✅→下一步 ---- */
var STEP_ORDER = {};
function paintSteps(page) {
  var st = togGet("steps_" + page, {});
  (STEP_ORDER[page] || []).forEach(function (id) {
    var done = !!st[id];
    var stepEl = document.getElementById("step-" + id);
    if (stepEl) stepEl.classList.toggle("done", done);
    var chk = document.getElementById("check-" + id);
    if (chk) chk.textContent = done ? "✅" : "";
  });
}
function setStepOpen(id, open) {
  var body = document.getElementById("body-" + id);
  var stepEl = document.getElementById("step-" + id);
  if (!body || !stepEl) return;
  body.hidden = !open;
  stepEl.classList.toggle("open", open);
}
function stepToggle(page, id) {
  var body = document.getElementById("body-" + id);
  var willOpen = body.hidden;
  (STEP_ORDER[page] || []).forEach(function (oid) { setStepOpen(oid, false); });
  setStepOpen(id, willOpen);
}
function stepMark(page, id) {
  var st = togGet("steps_" + page, {});
  st[id] = true;
  togSet("steps_" + page, st);
  paintSteps(page);
}
function stepNext(page, id) {
  stepMark(page, id);
  var order = STEP_ORDER[page] || [];
  var i = order.indexOf(id);
  var next = order[Math.min(i + 1, order.length - 1)];
  order.forEach(function (oid) { setStepOpen(oid, false); });
  setStepOpen(next, true);
  var el = document.getElementById("step-" + next);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}
function stepInit(page, order) {
  STEP_ORDER[page] = order;
  paintSteps(page);
  var hash = (location.hash || "").replace("#", "").replace(/^sec-/, "");
  var target = null;
  if (hash && order.indexOf(hash) >= 0) target = hash;
  if (!target) {
    var st = togGet("steps_" + page, {});
    for (var i = 0; i < order.length; i++) { if (!st[order[i]]) { target = order[i]; break; } }
    target = target || order[0];
  }
  setStepOpen(target, true);
}
