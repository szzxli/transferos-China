// 一对一 v13.4 前端断言（jsdom）：
// A. 家长端「需要关注」区块：进展页渲染（日期/标题/说明/措施）、空态诚实显示、中英双语。
// B. 学生端「家长所见预览」：导师页入口在位、一句话说明文案已改清（家长页不止一句话）、
//    打开预览走 /api/client/parent-preview（学生凭据）、渲染与家长所见一致的六个区块、
//    注明「这就是爸妈打开链接看到的全部内容」、英文同步。
// C. 双语字典 zh/en 键对称（app / parent，含 v13.4 新键）。
// 运行：node tests/app-v134.test.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/home/hatch/workspace/tools/jsdomtest/node_modules/jsdom");

const SHTML = readFileSync(new URL("../../one-on-one-app/index.html", import.meta.url), "utf8");
const APP = readFileSync(new URL("../../one-on-one-app/app.js", import.meta.url), "utf8");
const PRIV = readFileSync(new URL("../../one-on-one-app/private.js", import.meta.url), "utf8");
const PROB = readFileSync(new URL("../../one-on-one-app/problems.js", import.meta.url), "utf8");
const MAJORS_JS = readFileSync(new URL("../../one-on-one-app/majors.js", import.meta.url), "utf8");
const DATASET = JSON.parse(readFileSync(new URL("../../one-on-one-app/data/csi-majors.json", import.meta.url), "utf8"));
const PHTML = readFileSync(new URL("../../one-on-one-app/parent.html", import.meta.url), "utf8");
const PJS = readFileSync(new URL("../../one-on-one-app/parent.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function section(s) { console.log("\n== " + s); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));

/* ---------- fake IndexedDB（与 app-v13/v133 同款最小实现） ---------- */
function makeFakeIDB() {
  const stores = new Map();
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore(name) { if (!stores.has(name)) stores.set(name, new Map()); return { createIndex() {} }; },
    transaction(names) {
      const tx = { error: null, oncomplete: null, onerror: null, onabort: null };
      tx.objectStore = (name) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const map = stores.get(name);
        const clone = (v) => JSON.parse(JSON.stringify(v));
        const req = (fn) => { const r = { result: undefined, error: null, onsuccess: null, onerror: null }; queueMicrotask(() => { try { r.result = fn(); if (r.onsuccess) r.onsuccess(); if (tx.oncomplete) tx.oncomplete(); } catch (e) { r.error = e; if (r.onerror) r.onerror(); } }); return r; };
        return {
          put: (v) => req(() => { map.set(v.local_id, clone(v)); return v.local_id; }),
          add: (v) => req(() => { map.set(v.local_id, clone(v)); return v.local_id; }),
          get: (k) => req(() => clone(map.get(k))),
          delete: (k) => req(() => { map.delete(k); }),
          clear: () => req(() => map.clear()),
          getAll: () => req(() => [...map.values()].map(clone)),
          index: () => ({ getAll: () => req(() => [...map.values()].map(clone)), openCursor: () => req(() => null) }),
          openCursor: () => req(() => null),
        };
      };
      return tx;
    },
  };
  return {
    stores,
    indexedDB: {
      open: () => {
        const r = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
        queueMicrotask(() => { if (r.onupgradeneeded) r.onupgradeneeded({ target: r }); if (r.onsuccess) r.onsuccess(); });
        return r;
      },
    },
  };
}

/* ---------- 学生端夹具 ---------- */
function fixtureData() {
  return {
    ok: true,
    student: { id: 7, name: "测试学生", slug: "fix", stage: "plan", stage_label: "规划确认", package: "一对一辅导" },
    school_system: "CUNY · CSI",
    goal: { target_school: "CSI", target_term: "2027 秋", gpa_target: "", goal_note: "", school_system: "CUNY" },
    goal_lines: [{ id: 1, name: "学业", line_type: "main", line_type_label: "主线", priority: 1, status: "active", status_label: "进行中", next_step: "补齐先修课" }],
    main_line: { id: 1, name: "学业", line_type: "main", line_type_label: "主线", priority: 1, status: "active", status_label: "进行中", next_step: "补齐先修课" },
    status: { latest: { id: 2, snapshot_date: "2026-06-01", gpa: 3.481, credits_done: 55, credits_total: 120, note: "" }, history: [{ id: 2, snapshot_date: "2026-06-01", gpa: 3.481, credits_done: 55, credits_total: 120, note: "" }] },
    exams: [{ id: 1, exam_name: "护理入学考试", exam_date: "", score: "EXAM-SCORE-SENTINEL-313", pass_line: "", result: "fail", result_label: "未达标", note: "" }],
    courses: { progress: {}, groups: [], list: [] },
    meetings: [],
    vision_text: "拿到学位，成为专业人士",
    mentor_message: "", mentor_message_at: "",
    milestones: [{ id: 1, date_text: "2025 秋季", title: "入学", detail: "", kind: "school", sort: 1, created_at: "2026-10-01T00:00:00.000Z" }],
    key_dates: [{ id: 1, date: "2026-11-01", title: "提交材料" }],
    actions: [{ id: 1, title: "待办一", detail: "", due_text: "", status: "todo", status_label: "待办", sort: 1, updated_at: "2026-10-20T00:00:00.000Z" }],
    advice: [{ id: 1, title: "建议一", body: "建议正文", sort: 1 }],
    knowledge: [{ id: 1, title: "考试规则卡", body: "知识正文", tag: "exam" }],
    messages: [], unread_mentor: 0,
    problems: [],
    mentor_trail: [],
    course_match: [],
    parent_notes: [],
  };
}
function previewData() {
  return {
    ok: true,
    student: { name: "测试学生", slug: "fix", stage: "plan", stage_label: "规划确认", package: "一对一辅导" },
    updates: [{ id: 5, update_date: "2026-10-15", title: "预览进展标题", body: "预览进展正文", current_focus: "预览策略", next_step: "预览下一步", created_at: "2026-10-15T00:00:00.000Z" }],
    support_actions: [{ id: 1, title: "预览托举事项", detail: "托举说明", category: "", due_text: "本周内", status: "active", status_label: "进行中", sort: 1 }],
    achievements: [{ kind: "milestone", title: "预览成就标题", date_text: "2025 秋季" }],
    student_notes: [{ id: 3, body: "预览一句话", feeling_tag: "steady", feeling_tag_label: "平稳", created_at: "2026-10-19T00:00:00.000Z" }],
    upcoming_reminders: [{ date: "2026-11-01", date_fmt: "2026-11-01", title: "预览重要日子", kind: "key_date", days_left: 3 }],
    concerns: [{ id: 2, concern_date: "2026-10-18", title: "预览关注标题", body: "预览关注说明", action_text: "预览关注措施", created_at: "2026-10-18T00:00:00.000Z" }],
  };
}
function makeStudentWindow() {
  const dom = new JSDOM(SHTML, {
    url: "https://zhuanuc.com/one-on-one-app/?s=fix&k=key-fix&api=https://api.test",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const fake = makeFakeIDB();
  w.indexedDB = fake.indexedDB;
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.URL.createObjectURL = () => "blob:fake";
  w.URL.revokeObjectURL = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillStyle: "", font: "", createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {}, measureText: (s) => ({ width: String(s).length * 20 }), fillText() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
  const requests = [];
  const data = fixtureData();
  w.fetch = async (url, o) => {
    const u = String(url);
    requests.push({ url: u, method: (o && o.method) || "GET" });
    const j = (status, obj) => ({ status, ok: status >= 200 && status < 300, json: async () => obj });
    if (u.includes("data/csi-majors.json")) return j(200, JSON.parse(JSON.stringify(DATASET)));
    if (u.includes("/api/client/parent-preview")) return j(200, previewData());
    if (u.includes("/api/client/signature")) return j(200, { ok: true, signature: "签名" });
    return j(200, JSON.parse(JSON.stringify(data)));
  };
  w.eval(PRIV + "\n" + PROB + "\n" + MAJORS_JS + "\n" + APP);
  return { w, requests };
}

/* ---------- 家长端夹具 ---------- */
function parentData(concerns) {
  return {
    ok: true,
    student: { name: "娃娃 Fixture", slug: "fixkid", stage: "diag", stage_label: "评估诊断", package: "一对一辅导" },
    updates: [{ id: 2, update_date: "2026-06-01", title: "评估诊断阶段进展", body: "目前处于评估诊断阶段。", current_focus: "核对学业记录", next_step: "形成考试策略", created_at: "2026-06-01T00:00:00.000Z" }],
    support_actions: [], messages: [], unread_mentor_parent: 0,
    achievements: [], student_notes: [], upcoming_reminders: [],
    concerns,
  };
}
function makeParentWindow(data, lang) {
  const dom = new JSDOM(PHTML, {
    url: "https://zhuanuc.com/one-on-one-app/parent.html?s=fixkid&p=pk_fixtoken&api=https://api.test",
    runScripts: "outside-only",
  });
  const w = dom.window;
  if (lang) w.localStorage.setItem("oop_parent_lang", lang);
  w.fetch = async () => ({ status: 200, ok: true, json: async () => JSON.parse(JSON.stringify(data)) });
  w.eval(PJS);
  return w;
}

/* ================= A. 家长端需要关注 ================= */
section("A. 家长端「需要关注」：渲染 / 空态 / 双语");
{
  ok(PHTML.includes('id="concerns-list"') && PHTML.includes('data-i18n="concerns.title"'), "parent.html 需要关注区块骨架在位");
  const w = makeParentWindow(parentData([
    { id: 1, concern_date: "2026-10-18", title: "家长关注标题", body: "家长关注说明", action_text: "家长关注措施", created_at: "2026-10-18T00:00:00.000Z" },
  ]));
  await tick();
  w.document.querySelector('.tab-btn[data-tab="progress"]').click();
  await tick(30);
  const box = w.document.getElementById("concerns-list");
  ok(box.textContent.includes("家长关注标题") && box.textContent.includes("家长关注说明"), "关注事项标题与说明渲染");
  ok(box.textContent.includes("正在采取的措施") && box.textContent.includes("家长关注措施"), "措施小节标签与内容渲染");
  ok(box.textContent.includes("2026-10-18"), "关注日期渲染");
  ok(w.document.querySelector('[data-i18n="concerns.title"]').textContent === "需要关注", "区块标题中文在位");

  const wE = makeParentWindow(parentData([]));
  await tick();
  wE.document.querySelector('.tab-btn[data-tab="progress"]').click();
  await tick(30);
  ok(wE.document.getElementById("concerns-list").textContent.includes("目前没有需要特别关注的事项。"),
    "无关注事项时如实空态（不编造）");

  const wEn = makeParentWindow(parentData([]), "en");
  await tick();
  wEn.document.querySelector('.tab-btn[data-tab="progress"]').click();
  await tick(30);
  ok(wEn.document.querySelector('[data-i18n="concerns.title"]').textContent === "Needs Attention", "区块标题英文在位");
  ok(wEn.document.getElementById("concerns-list").textContent.includes("Nothing needs special attention right now."),
    "空态英文在位");
}

/* ================= B. 学生端预览 ================= */
section("B. 学生端「家长所见预览」：入口 / 文案 / 请求 / 渲染 / 双语");
{
  ok(SHTML.includes('data-open="parent-preview"') && SHTML.includes('id="view-parent-preview"'), "index.html 预览入口与 sheet 骨架在位");
  const { w, requests } = makeStudentWindow();
  const $ = (id) => w.document.getElementById(id);
  await tick(150);
  const desc = w.document.querySelector('[data-i18n="pnote.desc"]');
  ok(desc.textContent.includes("需要关注") && desc.textContent.includes("预览爸妈看到的全部内容"),
    "一句话说明文案已改清：家长页还有导师整理的进展/成就/需要关注/重要日子");
  ok(!desc.textContent.includes("只有你主动发出的这一句会出现在家长页"), "旧误导文案已删除");
  w.document.querySelector('.tab-btn[data-tab="mentor"]').click();
  await tick(30);
  w.document.querySelector('[data-open="parent-preview"]').click();
  await tick(80);
  const pvReq = requests.find((r) => r.url.includes("/api/client/parent-preview"));
  ok(!!pvReq && pvReq.url.includes("s=fix") && pvReq.url.includes("key=key-fix"), "预览请求走学生凭据：" + (pvReq && pvReq.url));
  ok(!$("view-parent-preview").hidden, "预览 sheet 已打开");
  const body = $("pprev-body").textContent;
  ok(body.includes("这就是爸妈打开链接看到的全部内容。"), "预览注明「这就是爸妈打开链接看到的全部内容」");
  ok(body.includes("预览进展标题") && body.includes("预览关注标题") && body.includes("预览成就标题"), "进展/需要关注/成就三区块渲染");
  ok(body.includes("正在采取的措施") && body.includes("预览关注措施"), "关注措施渲染");
  ok(body.includes("预览一句话") && body.includes("预览托举事项") && body.includes("预览重要日子"), "一句话/托举/重要日子渲染");
  // 英文：关 sheet → 切语言 → 重开
  w.document.querySelector('[data-close="view-parent-preview"]').click();
  await tick(20);
  $("lang-toggle").click();
  await tick(30);
  w.document.querySelector('[data-open="parent-preview"]').click();
  await tick(80);
  const bodyEn = $("pprev-body").textContent;
  ok(bodyEn.includes("This is everything Mom & Dad see when they open their link."), "英文注明在位");
  ok(bodyEn.includes("Needs Attention"), "英文需要关注区块在位");
}

/* ================= C. 字典对称 ================= */
section("C. 双语字典 zh/en 键对称（含 v13.4 新键）");
{
  const grab = (src) => eval("(" + src.match(/const I18N = (\{[\s\S]*?\n\});/)[1] + ")");
  const appD = grab(APP), parD = grab(PJS);
  const sym = (d) => JSON.stringify(Object.keys(d.zh).sort()) === JSON.stringify(Object.keys(d.en).sort());
  ok(sym(appD), "app.js 字典 zh/en 键集一致（" + Object.keys(appD.zh).length + " 键）");
  ok(sym(parD), "parent.js 字典 zh/en 键集一致（" + Object.keys(parD.zh).length + " 键）");
  ok(!!appD.zh["pprev.note"] && !!appD.en["pprev.note"] && !!parD.zh["concerns.title"] && !!parD.en["concerns.title"],
    "v13.4 新键双语齐备");
}

console.log("\n==== app-v134: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
