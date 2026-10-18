/* TransferOS-China i18n: zh-CN / zh-TW / en — 纯前端，零后端 */
"use strict";
var I18N = {
  lang: "zh-CN",
  dict: null,
  sortedKeys: [],
  patterns: [],
  observer: null
};

/* 英文词典 data/i18n/en.js 已备好（639 条），全站英文待代理区域确定后启用 */
I18N.PATTERNS = {
  "zh-TW": [],
  "zh-CN": []
};

I18N.init = function () {
  var saved = null;
  try { saved = localStorage.getItem("tog_lang"); } catch (e) {}
  if (saved === "zh-CN" || saved === "zh-TW") {
    this.lang = saved;
  } else {
    var nav = (navigator.language || navigator.userLanguage || "").toLowerCase();
    if (nav.indexOf("zh-tw") === 0 || nav.indexOf("zh-hk") === 0 || nav.indexOf("zh-mo") === 0) this.lang = "zh-TW";
  }
  this.injectSwitcher();
  var self = this;
  if (this.lang === "zh-CN") {
    this.dict = {};
    this.apply();
  } else {
    this.loadDict(this.lang, function () { self.apply(); });
  }
  this.observe();
};

I18N.loadDict = function (lang, cb) {
  var self = this;
  if (this.dict && this._loadedLang === lang) return cb();
  var s = document.createElement("script");
  s.src = "data/i18n/" + lang + ".js";
  s.onload = function () {
    self.dict = (lang === "en") ? (window.I18N_EN || {}) : (window.I18N_TW || {});
    self.patterns = (window.I18N_PATTERNS && window.I18N_PATTERNS[lang]) || self.PATTERNS[lang] || [];
    self.sortedKeys = Object.keys(self.dict).sort(function (a, b) { return b.length - a.length; });
    self._loadedLang = lang;
    cb();
  };
  s.onerror = function () { self.dict = {}; self.sortedKeys = []; cb(); };
  document.head.appendChild(s);
};

I18N.setLang = function (lang) {
  if (this.lang === lang) return;
  try { localStorage.setItem("tog_lang", lang); } catch (e) {}
  location.reload();
};

I18N.injectSwitcher = function () {
  var bar = document.querySelector(".topbar");
  if (!bar || document.getElementById("langSel")) return;
  var d = document.createElement("div");
  d.id = "langSel";
  d.className = "langsel";
  d.innerHTML = '<button type="button" data-lang="zh-CN">简</button>' +
    '<button type="button" data-lang="zh-TW">繁</button>';
  var self = this;
  d.querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () { self.setLang(b.dataset.lang); });
  });
  bar.appendChild(d);
  this.paintSwitcher();
};

I18N.paintSwitcher = function () {
  var d = document.getElementById("langSel");
  if (!d) return;
  var self = this;
  d.querySelectorAll("button").forEach(function (b) {
    b.classList.toggle("on", b.dataset.lang === self.lang);
  });
};

I18N.translateStr = function (txt) {
  if (!txt || !/[\u4e00-\u9fff]/.test(txt) || !this.dict) return txt;
  var out = txt;
  var keys = this.sortedKeys;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (out.indexOf(k) >= 0) out = out.split(k).join(this.dict[k]);
    if (!/[\u4e00-\u9fff]/.test(out)) break;
  }
  var pats = this.patterns;
  for (var j = 0; j < pats.length; j++) {
    out = out.replace(pats[j][0], pats[j][1]);
  }
  return out;
};

I18N.translateNode = function (node) {
  if (node.nodeType === 3) {
    var v = this.translateStr(node.nodeValue);
    if (v !== node.nodeValue) node.nodeValue = v;
  } else if (node.nodeType === 1) {
    var tag = node.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "textarea") return;
    var self = this;
    ["placeholder", "title", "alt"].forEach(function (attr) {
      var val = node.getAttribute && node.getAttribute(attr);
      if (val && /[\u4e00-\u9fff]/.test(val)) {
        var nv = self.translateStr(val);
        if (nv !== val) node.setAttribute(attr, nv);
      }
    });
    var child = node.firstChild;
    while (child) {
      var next = child.nextSibling;
      this.translateNode(child);
      child = next;
    }
  }
};

I18N.apply = function () {
  if (this.lang === "zh-CN") return;
  this.translateNode(document.body);
  var titleEl = document.querySelector("title");
  if (titleEl) {
    var nt = this.translateStr(titleEl.textContent);
    if (nt !== titleEl.textContent) titleEl.textContent = nt;
  }
  this.paintSwitcher();
  document.documentElement.lang = this.lang === "en" ? "en" : "zh-TW";
};

I18N.observe = function () {
  var self = this;
  if (this.observer) return;
  this.observer = new MutationObserver(function (muts) {
    if (self.lang === "zh-CN" || !self.dict) return;
    muts.forEach(function (m) {
      m.addedNodes.forEach(function (n) { self.translateNode(n); });
    });
  });
  if (document.body) this.observer.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener("DOMContentLoaded", function () {
    self.observer.observe(document.body, { childList: true, subtree: true });
  });
};

/* 供动态 JS 调用：t('原文') */
function t(key) {
  if (I18N.lang === "zh-CN" || !I18N.dict) return key;
  return I18N.translateStr(key);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { I18N.init(); });
} else {
  I18N.init();
}
