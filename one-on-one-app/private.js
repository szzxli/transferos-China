"use strict";
/* 私密空间（阶段 B · 私密层）
 * 硬纪律（蓝图第二节）：私密正文只存本机 IndexedDB，本文件不出现任何网络调用
 *（fetch / XMLHttpRequest / WebSocket / sendBeacon），也不直接做语音识别——
 * 语音按钮由 app.js 的统一组件经 hooks.attachVoice 注入，按私密口径（默认关闭 + 云端明示）接入。
 * localStorage 在本文件只存轻量标量：上次导出时间 / 已导出条数水位。不存任何正文。 */
const OOOPrivate = (() => {
  const DB_NAME = "ooo_private_v1";
  const STORE = "entries";
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const st = db.createObjectStore(STORE, { keyPath: "local_id" });
          st.createIndex("by_type", "type", { unique: false });
          st.createIndex("by_created", "created_at", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  /* 单次事务助手：请求必须在事务活跃期内发出，故「开事务 → 发请求 → 等 oncomplete」一次完成，不跨 await 持有事务 */
  async function withStore(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], mode);
      const st = tx.objectStore(STORE);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("tx aborted"));
      try {
        const req = fn(st);
        if (req) {
          req.onsuccess = () => { result = req.result; };
          req.onerror = () => reject(req.error);
        }
      } catch (e) { reject(e); }
    });
  }
  async function add(entry) {
    await withStore("readwrite", (st) => st.add(entry));
    return entry;
  }
  async function put(entry) {
    await withStore("readwrite", (st) => st.put(entry));
    return entry;
  }
  async function all() {
    const rows = await withStore("readonly", (st) => st.getAll());
    return (rows || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  async function get(id) {
    return withStore("readonly", (st) => st.get(id));
  }
  async function del(id) {
    await withStore("readwrite", (st) => st.delete(id));
  }
  async function clearAll() {
    await withStore("readwrite", (st) => st.clear());
  }
  function newId() {
    return "loc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }
  function nowIso() { return new Date().toISOString(); }
  function localDay(iso) {
    const d = new Date(iso || Date.now());
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  /* 连续记录天数：有 mood 条目的本地日期集合，从今天（或昨天，若今天还没记）往前数连续天数 */
  function streakDays(entries, now) {
    const days = new Set((entries || []).filter((e) => e.type === "mood").map((e) => localDay(e.created_at)));
    let cursor = new Date(now || Date.now());
    const fmtD = (d) => {
      const p = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    };
    if (!days.has(fmtD(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
      if (!days.has(fmtD(cursor))) return 0;
    }
    let n = 0;
    while (days.has(fmtD(cursor))) { n++; cursor.setDate(cursor.getDate() - 1); }
    return n;
  }
  /* 本地标签建议：关键词只在本机匹配，学生可采纳或忽略；结果只存本地 */
  const TAG_RULES = [
    { re: /考试|考|没过|补考|exam|test/i, tag: "exam" },
    { re: /焦虑|紧张|睡不着|失眠|anxious|anxiety/i, tag: "anxiety" },
    { re: /钱|资金|预算|学费|money|budget/i, tag: "money" },
    { re: /父母|家里|爸|妈|parent|family/i, tag: "family" },
    { re: /课|学分|成绩|作业|study|course/i, tag: "study" },
    { re: /创业|生意|产品|客户|business/i, tag: "business" },
    { re: /累|疲惫|撑不住|tired/i, tag: "tired" },
  ];
  function suggestTags(text) {
    const s = String(text || "");
    return TAG_RULES.filter((r) => r.re.test(s)).map((r) => r.tag);
  }
  /* 情绪安全关键词（本地维护，中英双语；命中只在本机弹关怀页，不上传、不记录、不通知任何人） */
  const RISK_WORDS = ["自杀", "想死", "不想活", "活不下去", "结束自己", "伤害自己", "割腕", "跳楼", "轻生",
    "suicide", "kill myself", "end my life", "self-harm", "self harm", "hurt myself", "want to die", "no reason to live"];
  function checkRisk(text) {
    const s = String(text || "").toLowerCase();
    return RISK_WORDS.some((w) => s.includes(w));
  }
  function buildMarkdown(entries) {
    const rows = (entries || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    let out = "# 我的私密记录（本机导出）\n\n导出时间：" + nowIso().slice(0, 16).replace("T", " ") + "\n";
    let curDay = "";
    for (const e of rows) {
      const day = localDay(e.created_at);
      if (day !== curDay) { curDay = day; out += "\n## " + day + "\n"; }
      const kind = { diary: "日记", note: "随记", mood: "今日状态", problem_draft: "问题草稿" }[e.type] || e.type;
      out += "\n### " + String(e.created_at).slice(11, 16) + " · " + kind +
        (e.mood_tag ? " · 心情 " + e.mood_tag + "/5" : "") +
        ((e.problem_tags || []).length ? " · 标签：" + e.problem_tags.join("、") : "") + "\n\n" + (e.body || "") + "\n";
    }
    return out;
  }
  function buildJSON(entries) {
    return JSON.stringify({
      app: "one-on-one-private", version: 1, exported_at: nowIso(),
      entries: (entries || []).map((e) => ({
        local_id: e.local_id, type: e.type, body: e.body || "",
        mood_tag: e.mood_tag || null, problem_tags: e.problem_tags || [],
        created_at: e.created_at, updated_at: e.updated_at || e.created_at,
      })),
    }, null, 2);
  }
  function parseImport(text) {
    const data = JSON.parse(text);
    const rows = Array.isArray(data) ? data : data && data.entries;
    if (!Array.isArray(rows)) throw new Error("bad format");
    const okTypes = ["diary", "note", "mood", "problem_draft"];
    return rows.filter((e) => e && e.local_id && okTypes.includes(e.type)).map((e) => ({
      local_id: String(e.local_id), type: e.type, body: String(e.body || ""),
      mood_tag: e.mood_tag || null,
      problem_tags: Array.isArray(e.problem_tags) ? e.problem_tags.map(String).slice(0, 10) : [],
      created_at: String(e.created_at || nowIso()), updated_at: String(e.updated_at || e.created_at || nowIso()),
    }));
  }

  /* ================= 私密空间视图 ================= */
  const LS_EXPORT_AT = "ooo_last_export_at";
  const LS_EXPORT_N = "ooo_exported_count";
  function mount(root, hooks) {
    const t = hooks.t, esc = hooks.esc;
    root.innerHTML =
      '<div class="priv-privacy card">' +
        '<h2>' + esc(t("priv.title")) + "</h2>" +
        '<p class="priv-line">' + esc(t("priv.only")) + "</p>" +
        '<p class="priv-line">' + esc(t("priv.lost")) + "</p>" +
        '<p class="priv-line">' + esc(t("priv.noRecover")) + "</p>" +
      "</div>" +
      '<div class="card" id="pv-care" hidden>' +
        '<h2>' + esc(t("care.title")) + "</h2>" +
        '<p class="care-lead">' + esc(t("care.lead")) + "</p>" +
        '<ul class="care-list">' +
          "<li>" + esc(t("care.us")) + "</li>" +
          "<li>" + esc(t("care.textline")) + "</li>" +
          "<li>" + esc(t("care.school")) + "</li>" +
          "<li>" + esc(t("care.cn")) + "</li>" +
        "</ul>" +
        '<p class="mut">' + esc(t("care.note")) + "</p>" +
        '<button type="button" class="btn-ghost" id="pv-care-mentor">' + esc(t("care.toMentor")) + "</button>" +
      "</div>" +
      '<section class="card">' +
        '<h2>' + esc(t("priv.write")) + "</h2>" +
        '<div class="priv-types" id="pv-types">' +
          ["diary", "note", "mood", "problem_draft"].map((ty) =>
            '<button type="button" class="chip' + (ty === "diary" ? " on" : "") + '" data-ty="' + ty + '">' + esc(t("priv.ty." + ty)) + "</button>").join("") +
        "</div>" +
        '<div class="mood-row" id="pv-moods" hidden>' +
          [1, 2, 3, 4, 5].map((n) =>
            '<button type="button" class="mood-btn" data-mood="' + n + '">' + esc(t("today.m" + n)) + "</button>").join("") +
        "</div>" +
        '<textarea id="pv-body" rows="5" placeholder="' + esc(t("priv.ph")) + '"></textarea>' +
        '<div id="pv-mic"></div>' +
        '<div class="priv-tags" id="pv-tags"></div>' +
        '<div class="priv-actions">' +
          '<button type="button" class="btn-primary priv-save" id="pv-save">' + esc(t("priv.save")) + "</button>" +
          '<span class="mut" id="pv-saved"></span>' +
        "</div>" +
        '<p class="mut">' + esc(t("priv.offline")) + "</p>" +
      "</section>" +
      '<section class="card">' +
        '<h2>' + esc(t("priv.list")) + '<span class="card-note" id="pv-count"></span></h2>' +
        '<div id="pv-backup" class="priv-backup" hidden></div>' +
        '<div class="priv-filters" id="pv-filters">' +
          '<button type="button" class="chip on" data-f="all">' + esc(t("priv.all")) + "</button>" +
          ["diary", "note", "mood", "problem_draft"].map((ty) =>
            '<button type="button" class="chip" data-f="' + ty + '">' + esc(t("priv.ty." + ty)) + "</button>").join("") +
        "</div>" +
        '<div id="pv-list"></div>' +
        '<div class="priv-tools">' +
          '<button type="button" class="btn-ghost" id="pv-exp-md">' + esc(t("priv.expMd")) + "</button>" +
          '<button type="button" class="btn-ghost" id="pv-exp-json">' + esc(t("priv.expJson")) + "</button>" +
          '<label class="btn-ghost priv-import">' + esc(t("priv.import")) +
            '<input type="file" id="pv-imp-file" accept="application/json,.json" hidden></label>' +
          '<button type="button" class="btn-ghost danger" id="pv-clear">' + esc(t("priv.clear")) + "</button>" +
        "</div>" +
        '<p class="mut" id="pv-toolmsg"></p>' +
      "</section>";

    let curType = "diary";
    let curMood = 0;
    let curFilter = "all";
    let acceptedTags = [];
    const $id = (i) => root.querySelector("#" + i);

    if (hooks.attachVoice) hooks.attachVoice($id("pv-body"), { scope: "private", mount: $id("pv-mic") });
    $id("pv-care-mentor").addEventListener("click", () => hooks.gotoTab("mentor"));

    root.querySelectorAll("#pv-types .chip").forEach((b) => b.addEventListener("click", () => {
      curType = b.getAttribute("data-ty");
      root.querySelectorAll("#pv-types .chip").forEach((x) => x.classList.toggle("on", x === b));
      $id("pv-moods").hidden = curType !== "mood";
    }));
    root.querySelectorAll("#pv-moods .mood-btn").forEach((b) => b.addEventListener("click", () => {
      curMood = Number(b.getAttribute("data-mood"));
      root.querySelectorAll("#pv-moods .mood-btn").forEach((x) => x.classList.toggle("on", x === b));
    }));
    root.querySelectorAll("#pv-filters .chip").forEach((b) => b.addEventListener("click", () => {
      curFilter = b.getAttribute("data-f");
      root.querySelectorAll("#pv-filters .chip").forEach((x) => x.classList.toggle("on", x === b));
      refresh();
    }));
    $id("pv-body").addEventListener("input", () => {
      const sugg = suggestTags($id("pv-body").value).filter((x) => !acceptedTags.includes(x));
      $id("pv-tags").innerHTML = sugg.length
        ? '<span class="mut">' + esc(t("priv.tagSugg")) + "</span>" + sugg.map((x) =>
            '<button type="button" class="chip tag-chip" data-tag="' + esc(x) + '">+ ' + esc(x) + "</button>").join("")
        : "";
      $id("pv-tags").querySelectorAll(".tag-chip").forEach((b) => b.addEventListener("click", () => {
        acceptedTags.push(b.getAttribute("data-tag"));
        b.remove();
      }));
    });

    function download(name, text, mime) {
      const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    function markExported(n) {
      try {
        localStorage.setItem(LS_EXPORT_AT, String(Date.now()));
        localStorage.setItem(LS_EXPORT_N, String(n));
      } catch (e) { /* 存储不可用时忽略 */ }
    }
    async function refresh() {
      const rows = await all();
      $id("pv-count").textContent = rows.length ? String(rows.length) : "";
      // 备份提醒：累计 20 条未导出，或距上次导出超过 30 天且已有条目
      let lastAt = 0, lastN = 0;
      try { lastAt = Number(localStorage.getItem(LS_EXPORT_AT) || 0); lastN = Number(localStorage.getItem(LS_EXPORT_N) || 0); } catch (e) { /* 忽略 */ }
      const stale = rows.length > 0 && (rows.length - lastN >= 20 || (lastAt > 0 && Date.now() - lastAt > 30 * 864e5) || (lastAt === 0 && rows.length >= 20));
      $id("pv-backup").hidden = !stale;
      if (stale) $id("pv-backup").textContent = t("priv.backupTip");
      const list = rows.filter((e) => curFilter === "all" || e.type === curFilter);
      $id("pv-list").innerHTML = list.length ? list.map((e) =>
        '<div class="priv-item" data-id="' + esc(e.local_id) + '">' +
          '<div class="priv-meta"><span class="pill">' + esc(t("priv.ty." + e.type)) + "</span>" +
          '<span class="mut">' + esc(String(e.created_at).slice(0, 16).replace("T", " ")) + "</span>" +
          (e.mood_tag ? '<span class="pill">' + esc(t("today.m" + e.mood_tag) || "") + "</span>" : "") +
          ((e.problem_tags || []).map((x) => '<span class="pill">#' + esc(x) + "</span>").join("")) +
          "</div>" +
          '<div class="priv-body">' + esc(e.body || "") + "</div>" +
          '<div class="priv-item-actions">' +
            (e.type === "problem_draft" ? '<button type="button" class="btn-ghost small" data-act="toProblem">' + esc(t("priv.toProblem")) + "</button>" : "") +
            '<button type="button" class="btn-ghost small" data-act="share">' + esc(t("priv.shareLine")) + "</button>" +
            '<button type="button" class="btn-ghost small danger" data-act="del">' + esc(t("priv.del")) + "</button>" +
          "</div></div>").join("")
        : '<p class="empty">' + esc(t("priv.empty")) + "</p>";
      $id("pv-list").querySelectorAll(".priv-item").forEach((item) => {
        const id = item.getAttribute("data-id");
        item.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
          const act = b.getAttribute("data-act");
          if (act === "del") {
            if (!window.confirm(t("priv.delConfirm"))) return;
            await del(id);
            refresh();
            if (hooks.onPrivateChange) hooks.onPrivateChange();
          } else if (act === "share") {
            const e = await get(id);
            if (e && hooks.openShareText) hooks.openShareText(e.body || "", { fromPrivate: true });
          } else if (act === "toProblem") {
            const e = await get(id);
            if (e && hooks.openProblems) hooks.openProblems({ draftText: e.body || "", draftId: e.local_id });
          }
        }));
      });
    }

    $id("pv-save").addEventListener("click", async () => {
      const body = $id("pv-body").value.trim();
      if (!body) { $id("pv-saved").textContent = t("priv.needBody"); return; }
      const entry = {
        local_id: newId(), type: curType, body,
        mood_tag: curType === "mood" && curMood ? curMood : null,
        problem_tags: acceptedTags.slice(),
        created_at: nowIso(), updated_at: nowIso(),
      };
      await add(entry);
      const risk = checkRisk(body);
      $id("pv-body").value = "";
      acceptedTags = [];
      $id("pv-tags").innerHTML = "";
      $id("pv-saved").textContent = t("priv.savedLocal");
      if (risk) { $id("pv-care").hidden = false; $id("pv-care").scrollIntoView({ block: "start" }); }
      refresh();
      if (hooks.onPrivateChange) hooks.onPrivateChange();
    });
    $id("pv-exp-md").addEventListener("click", async () => {
      const rows = await all();
      download("my-private-notes.md", buildMarkdown(rows), "text/markdown;charset=utf-8");
      markExported(rows.length);
      $id("pv-toolmsg").textContent = t("priv.exported");
      refresh();
    });
    $id("pv-exp-json").addEventListener("click", async () => {
      const rows = await all();
      download("my-private-notes.json", buildJSON(rows), "application/json;charset=utf-8");
      markExported(rows.length);
      $id("pv-toolmsg").textContent = t("priv.exported");
      refresh();
    });
    $id("pv-imp-file").addEventListener("change", async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const incoming = parseImport(text);
        const existing = await all();
        const byId = new Map(existing.map((e) => [e.local_id, e]));
        let added = 0, updated = 0;
        for (const e of incoming) {
          const prev = byId.get(e.local_id);
          if (!prev) { await add(e); added++; }
          else if (String(e.updated_at) > String(prev.updated_at)) { await put(e); updated++; }
        }
        $id("pv-toolmsg").textContent = t("priv.imported") + " +" + added + " / ↻" + updated;
      } catch (err) {
        $id("pv-toolmsg").textContent = t("priv.importBad");
      }
      ev.target.value = "";
      refresh();
      if (hooks.onPrivateChange) hooks.onPrivateChange();
    });
    $id("pv-clear").addEventListener("click", async () => {
      if (!window.confirm(t("priv.clearConfirm1"))) return;
      if (!window.confirm(t("priv.clearConfirm2"))) return;
      await clearAll();
      $id("pv-toolmsg").textContent = t("priv.cleared");
      refresh();
      if (hooks.onPrivateChange) hooks.onPrivateChange();
    });

    refresh();
    return {
      refresh,
      showCare: () => {
        const el = $id("pv-care");
        if (el) { el.hidden = false; el.scrollIntoView({ block: "start" }); }
      },
    };
  }

  return {
    open, add, put, all, get, del, clearAll, newId, nowIso, localDay,
    streakDays, suggestTags, checkRisk, buildMarkdown, buildJSON, parseImport,
    mount, RISK_WORDS, TAG_RULES,
  };
})();
