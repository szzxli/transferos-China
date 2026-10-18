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
