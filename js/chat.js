/* TransferOS-China 客服组件：FAQ 机器人 + 转人工（微信）——纯前端，零后端 */
"use strict";

var CHAT_CONFIG = {
  wechatId: "",              /* 客服微信号：填上后显示 */
  wechatQr: "img/wechat-qr.png", /* 客服微信二维码图片路径 */
  botName: "TransferOS 小助手"
};

var CHAT_FAQ = [];
var CHAT_READY = false;

function chatInit() {
  var root = document.getElementById("chatRoot");
  if (!root) return;
  root.innerHTML =
    '<button id="chatFab" aria-label="客服">💬</button>' +
    '<div id="chatPanel" hidden>' +
    '  <div class="chat-head"><b>🤖 ' + esc(CHAT_CONFIG.botName) + '</b>' +
    '  <span><button id="chatHuman" class="chat-link">转人工</button>' +
    '  <button id="chatClose" class="chat-link">✕</button></span></div>' +
    '  <div id="chatMsgs" class="chat-msgs"></div>' +
    '  <div id="chatChips" class="chat-chips"></div>' +
    '  <div class="chat-input"><input id="chatText" type="text" placeholder="输入问题…" autocomplete="off">' +
    '  <button id="chatSend">发送</button></div>' +
    '</div>';
  document.getElementById("chatFab").addEventListener("click", chatToggle);
  document.getElementById("chatClose").addEventListener("click", chatToggle);
  document.getElementById("chatHuman").addEventListener("click", function () { chatHumanCard(); });
  document.getElementById("chatSend").addEventListener("click", chatSend);
  document.getElementById("chatText").addEventListener("keydown", function (e) {
    if (e.key === "Enter") chatSend();
  });
  fetch("data/faq.json?v=1").then(function (r) { return r.json(); }).then(function (j) {
    CHAT_FAQ = j; CHAT_READY = true;
    chatBotSay(faqFind("你好").a);
    chatChips(["费用怎么算？", "哪些学校能上？", "TAG是什么？", "签证有风险吗？", "申请要什么材料？"]);
  }).catch(function () {
    chatBotSay("知识库加载失败，请稍后重试，或直接转人工。");
  });
}

/* ---- 纯逻辑：可在 node 里单元测试 ---- */
function faqScore(entry, msg) {
  var m = msg.toLowerCase(), s = 0;
  (entry.keys || []).forEach(function (k) {
    if (k && m.indexOf(String(k).toLowerCase()) >= 0) s++;
  });
  return s;
}
function faqFind(msg) {
  var best = null, bestScore = 0;
  CHAT_FAQ.forEach(function (e) {
    var s = faqScore(e, msg);
    if (s > bestScore) { bestScore = s; best = e; }
  });
  return bestScore > 0 ? best : null;
}
function humanCardHTML() {
  var wx = CHAT_CONFIG.wechatId
    ? "添加微信：<b>" + esc(CHAT_CONFIG.wechatId) + "</b>"
    : "客服微信号即将公布";
  return '<div class="human-card"><b>👩‍💼 人工客服</b><p>' + wx + '</p>' +
    '<img src="' + esc(CHAT_CONFIG.wechatQr) + '" alt="客服微信二维码" onerror="this.style.display=\'none\'">' +
    '<p class="hint">添加时请备注：TransferOS咨询</p></div>';
}
if (typeof module !== "undefined") { module.exports = { faqScore: faqScore, faqFind: faqFind, humanCardHTML: humanCardHTML }; }

/* ---- 页面交互 ---- */
function chatToggle() {
  var p = document.getElementById("chatPanel");
  p.hidden = !p.hidden;
}
function chatScroll() {
  var m = document.getElementById("chatMsgs");
  m.scrollTop = m.scrollHeight;
}
function chatBotSay(html) {
  var m = document.getElementById("chatMsgs");
  var d = document.createElement("div");
  d.className = "msg bot";
  d.innerHTML = html;
  m.appendChild(d);
  chatScroll();
}
function chatUserSay(t) {
  var m = document.getElementById("chatMsgs");
  var d = document.createElement("div");
  d.className = "msg user";
  d.textContent = t;
  m.appendChild(d);
  chatScroll();
}
function chatChips(list) {
  var c = document.getElementById("chatChips");
  c.innerHTML = "";
  list.forEach(function (t) {
    var b = document.createElement("button");
    b.className = "chip";
    b.textContent = t;
    b.addEventListener("click", function () { chatAsk(t); });
    c.appendChild(b);
  });
}
function chatAsk(text) {
  chatUserSay(text);
  document.getElementById("chatText").value = "";
  setTimeout(function () {
    var hit = faqFind(text);
    if (hit && hit.a === "__HUMAN__") { chatHumanCard(); return; }
    if (hit) { chatBotSay(esc(hit.a)); return; }
    chatBotSay("这个问题我答不上来，为你转人工客服 👇");
    chatHumanCard();
  }, 350);
}
function chatSend() {
  var t = document.getElementById("chatText").value.trim();
  if (!t) return;
  chatAsk(t);
}
function chatHumanCard() {
  chatBotSay(humanCardHTML());
}
document.addEventListener("DOMContentLoaded", chatInit);
