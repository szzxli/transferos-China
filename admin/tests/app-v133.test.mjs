// 一对一 v13.3 前端断言（jsdom）：
// A. 私密空间常驻求助提示：静态在位（入口卡 + 私密空间内页两处）、中英字典文案与既有关怀页
//    资源一致（988 / 741741 / 12356）、渲染随语言切换；private.js 仍零网络（纯本地静态文案，
//    提示不依赖风险词触发、不经任何请求）。
// B. 课程数据纠错：入口与表单渲染、课程代码候选来自数据集、提交载荷键白名单恰为
//    {s, key, body, category, course_code} 且 category=data_correction（无成绩/考试/日期/私密字段）、
//    空描述前端拦截不发请求、成功后有反馈且表单清空。
// C. 导师工作台：未读留言带 category=data_correction 时渲染「课程数据纠错」徽标，普通留言无徽标。
// D. i18n 字典 zh/en 键对称（app / mentor，含 v13.3 新键）。
// 运行：node tests/app-v133.test.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/home/hatch/workspace/tools/jsdomtest/node_modules/jsdom");

const HTML = readFileSync(new URL("../../one-on-one-app/index.html", import.meta.url), "utf8");
const APP = readFileSync(new URL("../../one-on-one-app/app.js", import.meta.url), "utf8");
const PRIV = readFileSync(new URL("../../one-on-one-app/private.js", import.meta.url), "utf8");
const PROB = readFileSync(new URL("../../one-on-one-app/problems.js", import.meta.url), "utf8");
const MAJORS_JS = readFileSync(new URL("../../one-on-one-app/majors.js", import.meta.url), "utf8");
const MHTML = readFileSync(new URL("../../one-on-one-app/mentor.html", import.meta.url), "utf8");
const MENTOR = readFileSync(new URL("../../one-on-one-app/mentor.js", import.meta.url), "utf8");
const DATASET = JSON.parse(readFileSync(new URL("../../one-on-one-app/data/csi-majors.json", import.meta.url), "utf8"));

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function section(s) { console.log("\n== " + s); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));

/* ---------- fake IndexedDB（与 app-v13 同款最小实现） ---------- */
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

/* ---------- 学生端窗口（夹具与 app-v13 同口径，最小集） ---------- */
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
function makeStudentWindow() {
  const dom = new JSDOM(HTML, {
    url: "https://zhuanuc.com/one-on-one-app/?s=fix&k=key-fix&api=https://api.test",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const fake = makeFakeIDB();
  fake.stores.set("entries", new Map([
    ["seed-diary", { local_id: "seed-diary", type: "diary", body: "PRIV-SENTINEL-999 日记原文", mood_tag: null, problem_tags: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
  ]));
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
    const body = o && o.body ? String(o.body) : "";
    requests.push({ url: u, method: (o && o.method) || "GET", body });
    const j = (status, obj) => ({ status, ok: status >= 200 && status < 300, json: async () => obj });
    if (u.includes("data/csi-majors.json")) return j(200, JSON.parse(JSON.stringify(DATASET)));
    if (u.includes("/api/client/message")) {
      const b = JSON.parse(body);
      const composed = b.category === "data_correction" && b.course_code
        ? "课程 " + String(b.course_code).toUpperCase() + "：" + b.body : b.body;
      return j(200, { ok: true, message: { id: 900, sender: "student", sender_label: "我", body: composed, created_at: new Date().toISOString(), category: b.category === "data_correction" ? "data_correction" : "" } });
    }
    if (u.includes("/api/client/signature")) return j(200, { ok: true, signature: "签名" });
    return j(200, JSON.parse(JSON.stringify(data)));
  };
  w.eval(PRIV + "\n" + PROB + "\n" + MAJORS_JS + "\n" + APP);
  return { w, requests };
}

/* ================= A. 常驻求助提示 ================= */
section("A. 私密空间常驻求助提示：静态在位 / 资源一致 / 零网络");
{
  const spots = [...HTML.matchAll(/data-i18n="private\.helpNotice"/g)];
  ok(spots.length === 2, "index.html 恰有两处常驻提示（入口卡 + 私密空间内页）实测 " + spots.length);
  ok((HTML.match(/741741/g) || []).length === 2 && (HTML.match(/12356/g) || []).length === 2,
    "两处静态默认文案均含 741741 与 12356（与既有关怀页资源一致、不新增号码）");
  const privCode = PRIV.replace(/\/\*[\s\S]*?\*\//g, ""); // 去注释：头部注释仅以文字列举禁用 API 名，非调用
  ok(!/fetch\s*\(|new\s+XMLHttpRequest|WebSocket\s*\(|sendBeacon\s*\(/.test(privCode), "private.js 仍零网络 API 调用（提示为纯静态文案，不经任何请求）");
  const grab = (src) => eval("(" + src.match(/const I18N = (\{[\s\S]*?\n\});/)[1] + ")");
  const dict = grab(APP);
  ok(dict.zh["private.helpNotice"].includes("988") && dict.zh["private.helpNotice"].includes("741741") &&
     dict.zh["private.helpNotice"].includes("12356") && dict.zh["private.helpNotice"].includes("不会上传"),
    "zh 字典 helpNotice 含 988/741741/12356 与「不会上传」口径");
  ok(dict.en["private.helpNotice"].includes("988") && dict.en["private.helpNotice"].includes("741741") &&
     dict.en["private.helpNotice"].includes("12356") && dict.en["private.helpNotice"].includes("Suicide and Crisis Lifeline"),
    "en 字典 helpNotice 含同一组资源（988/741741/12356）");
}

/* ================= B. 渲染与纠错提交 ================= */
const S = makeStudentWindow();
const w = S.w;
const $ = (id) => w.document.getElementById(id);
await tick(150);
section("B. 学生端：提示渲染随语言切换；纠错表单与载荷白名单");
{
  const notices = [...w.document.querySelectorAll('[data-i18n="private.helpNotice"]')];
  ok(notices.length === 2 && notices.every((n) => n.textContent.includes("只有你能看到") && n.textContent.includes("988")),
    "两处提示渲染为中文定版文案（含 988）");
  $("lang-toggle").click();
  await tick(30);
  ok(notices.every((n) => n.textContent.includes("Suicide and Crisis Lifeline") && n.textContent.includes("12356")),
    "切英文后两处提示同步切换（资源号码不变）");
  ok($("corr-toggle").textContent === "Course data looks wrong?", "纠错入口英文文案在位");
  $("lang-toggle").click();
  await tick(30);
  ok($("corr-toggle").textContent === "课程数据有误？", "切回中文纠错入口文案恢复");

  w.document.querySelector('[data-tab="plan"]').click();
  await tick(150);
  ok($("corr-form").hidden === true, "纠错表单默认收起");
  $("corr-toggle").click();
  await tick(120);
  ok($("corr-form").hidden === false, "点入口展开纠错表单");
  ok($("corr-codes").options.length === DATASET.courses.length,
    "课程代码候选来自数据集课程库（" + DATASET.courses.length + " 门）实测 " + $("corr-codes").options.length);

  const before = S.requests.filter((r) => r.url.includes("/api/client/message")).length;
  $("corr-code").value = "bio 150";
  $("corr-desc").value = "这门课学分应为 4 分";
  $("corr-form").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  await tick(80);
  const posts = S.requests.filter((r) => r.url.includes("/api/client/message"));
  ok(posts.length === before + 1, "提交发出恰 1 条留言请求");
  const payload = JSON.parse(posts[posts.length - 1].body);
  ok(Object.keys(payload).sort().join(",") === "body,category,course_code,key,s",
    "★ 载荷键白名单恰为 {s, key, body, category, course_code}（实测 " + Object.keys(payload).sort().join(",") + "）");
  ok(payload.category === "data_correction", "category=data_correction");
  ok(payload.body === "这门课学分应为 4 分" && payload.course_code === "BIO 150", "载荷只有描述原文与课程代码（前端已规范化为大写，服务端再核一遍）");
  const rawPayload = posts[posts.length - 1].body;
  for (const bad of ["mood", "diary", "key_dates", "EXAM-SCORE-SENTINEL-313", "PRIV-SENTINEL-999", "score", "gpa"]) {
    ok(!rawPayload.includes(bad), "载荷不含越界字段/值：" + bad);
  }
  ok($("corr-msg").textContent.includes("已提交"), "提交成功有反馈");
  ok($("corr-desc").value === "" && $("corr-code").value === "", "提交后表单清空");

  const before2 = S.requests.filter((r) => r.url.includes("/api/client/message")).length;
  $("corr-form").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  await tick(50);
  ok(S.requests.filter((r) => r.url.includes("/api/client/message")).length === before2 &&
     !$("corr-err").hidden && $("corr-err").textContent.includes("先写一下"),
    "空描述被前端拦截：不发请求且给出提示");
}

/* ================= C. 导师工作台纠错徽标 ================= */
section("C. 导师工作台：纠错留言徽标");
{
  const dom = new JSDOM(MHTML, {
    url: "https://zhuanuc.com/one-on-one-app/mentor.html?s=EMP-T01&k=mk-fix&api=https://api.test",
    runScripts: "outside-only",
  });
  const w3 = dom.window;
  const wb = {
    ok: true,
    mentor: { id: 3, name: "测试导师", emp_no: "EMP-T01", kind: "mentor", mentor_status: "verified", mentor_status_label: "已核验", notifiable: true },
    students: [{
      student: { id: 7, name: "测试学生", slug: "fix", stage: "plan", stage_label: "规划确认" },
      recent_events: [], open_problems: [], pending_actions: [], trail_revisit_pending: 0,
      unread_messages: [
        { id: 21, body: "课程 BIO 150：这门课学分应为 4 分", created_at: "2026-10-21T07:00:00.000Z", category: "data_correction" },
        { id: 22, body: "导师，我想确认安排", created_at: "2026-10-21T08:00:00.000Z", category: "" },
      ],
    }],
  };
  w3.fetch = async () => ({ status: 200, ok: true, json: async () => JSON.parse(JSON.stringify(wb)) });
  w3.eval(MENTOR);
  await tick(100);
  const stu = w3.document.getElementById("students");
  ok(stu.textContent.includes("课程数据纠错"), "纠错留言渲染出「课程数据纠错」徽标（导师可辨识）");
  ok((stu.textContent.match(/课程数据纠错/g) || []).length === 1, "普通留言无徽标（徽标恰出现 1 次）");
}

/* ================= D. 字典对称 ================= */
section("D. i18n 字典 zh/en 键对称（app / mentor）");
{
  const grab = (src) => eval("(" + src.match(/const I18N = (\{[\s\S]*?\n\});/)[1] + ")");
  for (const [name, dict] of [["app", grab(APP)], ["mentor", grab(MENTOR)]]) {
    const zk = Object.keys(dict.zh).sort().join(",");
    const ek = Object.keys(dict.en).sort().join(",");
    ok(zk === ek, name + " 字典对称（zh " + Object.keys(dict.zh).length + " 键 / en " + Object.keys(dict.en).length + " 键）");
  }
  const appDict = grab(APP);
  ok(!!appDict.zh["corr.open"] && !!appDict.en["corr.open"] && !!appDict.zh["private.helpNotice"] && !!appDict.en["private.helpNotice"],
    "v13.3 新键（corr.* / private.helpNotice）中英都在位");
}

console.log("\n==== app-v133: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
