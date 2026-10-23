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
/* 复制小工具（剪贴板 API + 降级） */
function togCopy(text, btn) {
  function done() { if (btn) { var t = btn.textContent; btn.textContent = "已复制 ✓"; setTimeout(function () { btn.textContent = t; }, 1600); } }
  function fallback() {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) {}
    document.body.removeChild(ta);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done).catch(fallback); } else { fallback(); }
}
/* 邮件咨询：点后在卡内展开邮箱面板（mailto 在无默认邮件应用的设备上会静默无反应，面板兜底） */
function mailConsult(source, btn) {
  var ctx = funnelCtx();
  var ref = togGet("ref", "");
  var subject = "TransferOS咨询·" + source + (ctx ? "·" + ctx : "") + (ref ? "·代理:" + ref : "");
  var body = "我的情况：\n我想问的问题：\n我的联系方式（微信/电话）：";
  var mailto = "mailto:info@zhuanuc.com?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  var card = btn && btn.closest ? btn.closest(".funnel-card") : null;
  if (!card) { window.location.href = mailto; return; }
  var old = card.querySelector(".mail-panel");
  if (old) old.remove();
  var d = document.createElement("div");
  d.className = "mail-panel";
  var wx = "";
  if (typeof wechatBlockHTML === "function") { wx = wechatBlockHTML(subject); }
  else if (typeof CHAT_CONFIG !== "undefined" && CHAT_CONFIG.wechatQr) {
    wx = '<div class="lead-wx"><b>① 微信（最快）</b><img class="lead-qr" src="' + CHAT_CONFIG.wechatQr + '" alt="客服微信二维码"><p>微信扫一扫加好友，昵称「' + esc(CHAT_CONFIG.wechatId) + '」，加好友时请带备注：<b>' + esc(subject) + '</b></p></div>';
  }
  var srcKeys = { "评估页": "assess", "选课规划页": "track", "转学页": "apply" };
  var formHtml = (typeof leadFormHTML === "function") ? leadFormHTML(srcKeys[source] || "manual", subject) : "";
  d.innerHTML = wx + formHtml +
    '<div class="lead-mail"><b>③ 邮件（打开你自己的邮箱窗口写）</b>' +
    '<p>收件人：<b>info@zhuanuc.com</b> <button type="button" class="mini-btn" onclick="togCopy(\'info@zhuanuc.com\', this)">复制邮箱</button></p>' +
    '<p>主题请写：<b>' + esc(subject) + '</b></p>' +
    '<p class="hint">点下面按钮会打开你的邮件应用并自动填好；如果点了没反应，就复制上面的邮箱和主题，手动发一封到这个邮箱。</p>' +
    '<p><a class="btn" href="' + mailto + '">✉️ 打开邮件应用</a></p>' +
    '<p class="hint">用网页邮箱？<a target="_blank" rel="noopener" href="https://mail.google.com/mail/?view=cm&fs=1&to=info@zhuanuc.com&su=' + encodeURIComponent(subject) + '">用 Gmail 写</a>（海外或可科学上网时可用） · <a target="_blank" rel="noopener" href="https://mail.qq.com/cgi-bin/qm_share?t=qm_mailme&email=info@zhuanuc.com">用 QQ 邮箱写</a>（收件人已填好，Gmail 连主题一起填好）</p></div>';
  card.appendChild(d);
  if (d.scrollIntoView) d.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
