/* TransferOS-Global v0.1 共享工具 — 纯前端，无后端调用 */
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
/* 评估状态栏：选课/规划/指南页顶部按评估结果高亮定制路径 */
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
  var note = "TransferOS咨询·" + source + (ctx ? "·" + ctx : "");
  if (typeof chatBotSay === "function") chatBotSay("👋 你好！我是从<b>" + esc(source) + "</b>过来的" + (ctx ? "（" + esc(ctx) + "）" : "") + "，想咨询一下。");
  if (typeof chatHumanCard === "function") chatHumanCard(note);
}
function funnelShow(id) {
  if (typeof FUNNEL_OPEN !== "undefined" && FUNNEL_OPEN) {
    var el = document.getElementById(id);
    if (el) el.hidden = false;
  }
}
