// 一对一 v13 前端断言（jsdom）：
// A. 数据集溯源校验（每条已核实要求可溯源到所注官方来源；未核实专业只列名）
// B. 本地匹配引擎与后台 worker 引擎同输入同输出（独立复算三方一致）
// C. 展示收缩：手风琴默认态按页计数（展开块数实测）+ 手动展开可用
// D. 专业选择 UI → 摘要与独立复算一致；导出 Markdown 完整性 + 私密哨兵隔离
// E. 课程库：检索/按专业过滤计数
// F. 给爸妈的一句话：发送载荷白名单（无 diary/mood 字段）+ 撤回
// G. 家长页三卡渲染（成就/一句话/提醒 + 空态）；导师工作台三块 + 回复通道
// 运行：node tests/app-v13.test.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/home/hatch/workspace/tools/jsdomtest/node_modules/jsdom");
import worker, { matchRequirements as serverMatch } from "./worker.mjs";

const HTML = readFileSync(new URL("../../one-on-one-app/index.html", import.meta.url), "utf8");
const APP = readFileSync(new URL("../../one-on-one-app/app.js", import.meta.url), "utf8");
const PRIV = readFileSync(new URL("../../one-on-one-app/private.js", import.meta.url), "utf8");
const PROB = readFileSync(new URL("../../one-on-one-app/problems.js", import.meta.url), "utf8");
const MAJORS_JS = readFileSync(new URL("../../one-on-one-app/majors.js", import.meta.url), "utf8");
const PHTML = readFileSync(new URL("../../one-on-one-app/parent.html", import.meta.url), "utf8");
const PARENT = readFileSync(new URL("../../one-on-one-app/parent.js", import.meta.url), "utf8");
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

/* ---------- fake IndexedDB（与 app-v12 同款最小实现） ---------- */
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

/* ================= A. 数据集溯源 ================= */
section("A. 数据集：溯源 / 待核实标记 / 课程并集");
{
  ok(DATASET._meta && DATASET._meta.retrieved === "2026-10-21" && DATASET._meta.sources.length >= 4,
    "_meta 带抓取日期与官方来源清单");
  /* v13.1 口径修订：来源域名新增 www.cuny.edu（CUNY 中央 AUR 课程文件）与 csitoday.com（CSI 官方新闻站）；
   * 专业 8 → 10（新增 Medical Laboratory Science BS、Chemistry BS，均官方目录核实存在）；
   * 有要求集专业 2 → 3（护理建成完整官方集）；未核实 6 → 7。 */
  const HOSTS = new Set(["csi.cuny.edu", "www.csi.cuny.edu", "csi-undergraduate.catalog.cuny.edu", "cs.csi.cuny.edu", "www.cs.csi.cuny.edu", "coursedog-pdfs-public-prod.s3.us-east-2.amazonaws.com", "www.cuny.edu", "csitoday.com"]);
  ok(DATASET._meta.sources.every((s) => HOSTS.has(new URL(s.url).host)),
    "全部来源为 CSI/CUNY 官方域名（含目录系统 Coursedog 官方 PDF 托管）");
  ok(DATASET.majors.length === 10, "专业共 10 个（v13.1 扩容）");
  const withReq = DATASET.majors.filter((m) => m.requirements.length > 0);
  ok(withReq.length === 3 && withReq.every((m) => m.verified === true), "3 个专业有要求集且 verified（v13.1 护理建成）");
  ok(withReq.every((m) => m.sources.length >= 1 && m.sources.every((u) => DATASET._meta.sources.some((s) => s.url === u))),
    "已核实专业的要求集来源全部登记在 _meta.sources（可溯源）");
  const unver = DATASET.majors.filter((m) => !m.verified);
  ok(unver.length === 7 && unver.every((m) => m.requirements.length === 0 && /待官方核实/.test(m.note)),
    "7 个未核实专业只列名、零要求、note 带「待官方核实」");
  const nursing = DATASET.majors.find((m) => m.id === "nursing-bs");
  ok(nursing && /情景一/.test(nursing.note) && nursing.requirements.length === 42,
    "护理已建成 42 条要求集并注明与情景一的同批课程关系（v13.1 取代 v13 的只列名口径）");
  const union = new Set();
  for (const m of DATASET.majors) for (const r of m.requirements) union.add(r.course_code.toUpperCase());
  ok(DATASET.courses.length === union.size && DATASET.courses.every((c) => union.has(c.course_code.toUpperCase())),
    "课程库 = 要求集课程并集（" + union.size + " 门）");
  ok(DATASET.majors.every((m) => m.requirements.every((r) => ["gened", "prereq", "core", "elective"].includes(r.block))),
    "全部要求 block 在引擎四分块内");
}

/* ================= B. 引擎三方一致 ================= */
const FIX_COURSES = [
  { course_code: "BIO 170", status: "done", grade: "B+", term: "2025 Fall" },
  { course_code: "BIO 171", status: "done", grade: "A", term: "2025 Fall" },
  { course_code: "BIO 180", status: "ongoing", grade: "", term: "2026 Spring" },
  { course_code: "CHM 141", status: "done", grade: "C", term: "2025 Fall" },
  { course_code: "ENG 111", status: "done", grade: "A", term: "2025 Fall" },
  { course_code: "MTH 231", status: "planned", grade: "", term: "" },
  { course_code: "PSY 100", status: "done", grade: "B-", term: "2025 Fall" },
];
section("B. 本地引擎 × 后台引擎 × 独立复算");
{
  const w1 = new JSDOM("", { runScripts: "outside-only" });
  w1.window.eval(MAJORS_JS);
  const M = w1.window.OOOMajors;
  const bio = DATASET.majors.find((m) => m.id === "biology-bs");
  const local = M.matchRequirements(FIX_COURSES, bio.requirements);
  const server = serverMatch(FIX_COURSES, bio.requirements);
  ok(JSON.stringify(local.totals) === JSON.stringify(server.totals) &&
     JSON.stringify(local.missing.map((x) => x.code)) === JSON.stringify(server.missing.map((x) => x.code)) &&
     JSON.stringify(local.grade_warnings) === JSON.stringify(server.grade_warnings) &&
     JSON.stringify(local.prereq_breaks) === JSON.stringify(server.prereq_breaks),
    "本地引擎与后台 worker 引擎同输入同输出（totals/missing/warnings/breaks 全等）");
  // 独立复算（测试内手算口径，不复用任一引擎代码）
  const byCode = {};
  for (const c of FIX_COURSES) byCode[c.course_code] = c;
  let done = 0, inp = 0, plan = 0, miss = 0, crT = 0, crD = 0, crM = 0;
  for (const r of bio.requirements) {
    const c = byCode[r.course_code];
    crT += r.credits || 0;
    if (!c) { miss++; crM += r.credits || 0; }
    else if (c.status === "done") { done++; crD += r.credits || 0; }
    else if (c.status === "ongoing") inp++;
    else if (c.status === "planned") plan++;
  }
  ok(local.totals.done === done && local.totals.in_progress === inp && local.totals.planned === plan &&
     local.totals.missing === miss && local.totals.credits_total === crT && local.totals.credits_done === crD &&
     local.totals.credits_missing === crM,
    "独立复算一致：done " + done + " / 在修 " + inp + " / 计划 " + plan + " / 缺 " + miss + " / 学分 " + crD + "/" + crT);
  ok(local.grade_warnings.length === 1 && local.grade_warnings[0].code === "CHM 141" && local.grade_warnings[0].kind === "watch",
    "成绩预警：CHM 141 已修 C（先修块 <B）→ watch 1 条");
  ok(local.prereq_breaks.length === 0, "先修断裂 0（BIO 180 的先修 BIO 170 已修）");
}

/* ================= 学生端窗口 ================= */
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
    courses: { progress: {}, groups: [], list: FIX_COURSES.map((c, i) => ({ id: i + 1, course_code: c.course_code, course_name: "", credits: null, kind: "major", kind_label: "", status: c.status, status_label: "", grade: c.grade, term: c.term, note: "" })) },
    meetings: [{ id: 1, meeting_date: "2026-10-01", topic: "首谈", summary: "", action_items: "", next_date: "" }],
    vision_text: "拿到学位，成为专业人士",
    mentor_message: "寄语正文夹具", mentor_message_at: "2026-10-01T00:00:00.000Z",
    milestones: [{ id: 1, date_text: "2025 秋季", title: "入学", detail: "", kind: "school", sort: 1, created_at: "2026-10-01T00:00:00.000Z" }],
    key_dates: [{ id: 1, date: "2026-11-01", title: "提交材料" }],
    actions: [
      { id: 1, title: "待办一", detail: "", due_text: "", status: "todo", status_label: "待办", sort: 1, updated_at: "2026-10-20T00:00:00.000Z" },
      { id: 2, title: "已完成一", detail: "", due_text: "", status: "done", status_label: "已完成", sort: 2, updated_at: "2026-10-21T00:00:00.000Z" },
    ],
    advice: [{ id: 1, title: "建议一", body: "建议正文", sort: 1 }],
    knowledge: [{ id: 1, title: "考试规则卡", body: "知识正文", tag: "exam" }],
    messages: [], unread_mentor: 0,
    problems: [{ id: 11, domain: "exam", domain_label: "考试", title: "考试规则未确认", desired_outcome: "", strategy_summary: "", actions: [], support_needed: "", progress: "open", progress_label: "处理中", compliance: "ok", resolved_note: "", source_local_id: "", created_at: "2026-10-20T00:00:00.000Z", updated_at: "2026-10-20T00:00:00.000Z" }],
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
  const blobs = [];
  w.URL.createObjectURL = (b) => { blobs.push(b); return "blob:fake-" + blobs.length; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillStyle: "", font: "", createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {}, measureText: (s) => ({ width: String(s).length * 20 }), fillText() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
  const requests = [];
  const data = fixtureData();
  let noteSeq = 100;
  w.fetch = async (url, o) => {
    const u = String(url);
    const body = o && o.body ? String(o.body) : "";
    requests.push({ url: u, method: (o && o.method) || "GET", body });
    const j = (status, obj) => ({ status, ok: status >= 200 && status < 300, json: async () => obj });
    if (u.includes("data/csi-majors.json")) return j(200, JSON.parse(JSON.stringify(DATASET)));
    if (u.includes("/api/client/parent-note/withdraw")) return j(200, { ok: true, id: JSON.parse(body).id });
    if (u.includes("/api/client/parent-note")) {
      const b = JSON.parse(body);
      return j(200, { ok: true, note: { id: ++noteSeq, body: b.body, feeling_tag: b.feeling_tag || "", feeling_tag_label: b.feeling_tag === "tired" ? "有点累" : "", created_at: "2026-10-21T10:00:00.000Z" } });
    }
    if (u.includes("/api/client/message")) return j(200, { ok: true, message: { id: 900, sender: "student", body: JSON.parse(body).body || "", created_at: new Date().toISOString() } });
    if (u.includes("/api/client/trail")) return j(200, { ok: true, id: 777 });
    if (u.includes("/api/client/problem")) return j(200, { ok: true, problem: { id: 501, domain: "exam", domain_label: "考试", title: "x", desired_outcome: "", strategy_summary: "", actions: [], support_needed: "", progress: "open", progress_label: "处理中", compliance: "ok", resolved_note: "", source_local_id: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    if (u.includes("/api/client/signature")) return j(200, { ok: true, signature: "签名" });
    return j(200, JSON.parse(JSON.stringify(data)));
  };
  w.eval(PRIV + "\n" + PROB + "\n" + MAJORS_JS + "\n" + APP);
  return { w, requests, blobs, fake };
}
const S = makeStudentWindow();
const w = S.w;
const $ = (id) => w.document.getElementById(id);
await tick(120);

function visibleSections(pageId) {
  return [...w.document.querySelectorAll("#" + pageId + " section.card")].filter((s) => !s.hidden);
}
function expandedSections(pageId) {
  return visibleSections(pageId).filter((s) => {
    const b = s.querySelector(".acc-body");
    return !b || !b.hidden;
  });
}

/* ================= C. 展示收缩 ================= */
section("C. 手风琴默认态（满数据夹具实测计数）");
{
  const homeAll = visibleSections("page-home");
  ok(homeAll.length === 9, "首页收缩前可见块 = 9（hero+梦+今日+障碍+私密+寄语+每日+倒计时+行动）实测 " + homeAll.length);
  const homeOpen = expandedSections("page-home").filter((s) => !s.classList.contains("hero"));
  ok(homeOpen.map((s) => s.id).join(",") === "sec-dream,sec-obstacles,sec-actions",
    "首页默认展开恰为驾驶舱核心三块（梦想距离/今日行动/当前障碍）实测展开 " + homeOpen.map((s) => s.id).join(","));
  ok($("sec-today").classList.contains("acc-closed") && $("sec-private").classList.contains("acc-closed") &&
     $("sec-daily").classList.contains("acc-closed") && $("sec-countdown").classList.contains("acc-closed"),
    "首页次级卡（今日状态/私密入口/每日一句/关键日期）默认收起");
  // 手动展开可用
  $("sec-today").querySelector("h2").click();
  ok(!$("sec-today").querySelector(".acc-body").hidden, "点标题栏可展开收起的卡片");
  // 成长页
  w.document.querySelector('[data-tab="growth"]').click();
  await tick(60);
  const gAll = visibleSections("page-growth");
  const gOpen = expandedSections("page-growth");
  ok(gAll.length === 7 && gOpen.length === 1 && gOpen[0].id === "sec-feed",
    "成长页 7 块默认只展开第一项（我的动态）实测 " + gAll.length + "/" + gOpen.length);
  // 规划页
  w.document.querySelector('[data-tab="plan"]').click();
  await tick(120);
  const pAll = visibleSections("page-plan");
  const pOpen = expandedSections("page-plan");
  ok(pAll.length === 8 && pOpen.length === 1 && pOpen[0].id === "sec-goals",
    "规划页 8 块（含新增专业选择）默认只展开第一项（人生线）实测 " + pAll.length + "/" + pOpen.length);
  // 导师页
  w.document.querySelector('[data-tab="mentor"]').click();
  await tick(60);
  const mAll = visibleSections("page-mentor");
  const mOpen = expandedSections("page-mentor");
  ok(mAll.length === 3 && mOpen.length === 1 && mOpen[0].id === "sec-knowledge",
    "导师页 3 块（含新增一句话）默认只展开第一项（知识卡）实测 " + mAll.length + "/" + mOpen.length);
}

/* ================= D. 专业选择 + 导出 ================= */
section("D. 专业选择与一键导出");
{
  w.document.querySelector('[data-tab="plan"]').click();
  await tick(120);
  const sel = $("major-select");
  ok(sel.options.length === 10, "专业下拉共 10 项（v13.1 扩容）");
  /* v13.1 口径修订：默认重点专业 = 护理（创始人定版），不再默认第一个专业 */
  ok(sel.value === "nursing-bs", "默认选中护理（默认重点专业）");
  ok($("major-body").textContent.includes("已修 2 · 在修 0 · 缺 39 门"),
    "护理摘要与夹具独立复算一致（夹具 7 门课命中护理要求：已修 2 / 在修 0 / 计划 1 / 缺 39）");
  sel.value = "biology-bs";
  sel.dispatchEvent(new w.Event("change"));
  await tick(30);
  const body = $("major-body");
  ok(body.textContent.includes("已修 4 · 在修 1 · 缺 8 门"), "Biology 摘要与独立复算一致（4/1/8）");
  ok(body.textContent.includes("已修 10 / 已知总 36"), "Biology 学分行一致（10/36，未知 0）");
  ok(body.textContent.includes("CHM 250"), "缺口清单含 CHM 250");
  // 导出
  $("major-export").click();
  await tick(30);
  ok(S.blobs.length >= 1, "点击导出生成 Blob 文件");
  const md = await S.blobs[S.blobs.length - 1].text();
  ok(md.includes("# 专业匹配导出") && md.includes("Biology BS") && md.includes("## 缺口清单") && md.includes("CHM 256"),
    "导出含标题/专业/缺口清单/课程清单");
  ok(md.includes("coursedog-pdfs-public-prod") && md.includes("2026-10-21") && md.includes("以学校官方学位审计为准"),
    "导出带数据来源 URL、抓取日期与学位审计声明");
  ok(!md.includes("PRIV-SENTINEL-999"), "★ 导出不含私密层哨兵（IndexedDB 日记原文）");
  ok(!md.includes("EXAM-SCORE-SENTINEL-313"), "★ 导出不含考试分数哨兵（只含方案层）");
  ok($("major-export-msg").textContent.includes("已生成"), "导出后有成功反馈");
  // 护理（v13.1 口径修订）：即时计算并三态全量呈现，不再只给情景一指引
  sel.value = "nursing-bs";
  sel.dispatchEvent(new w.Event("change"));
  await tick(30);
  ok($("major-body").textContent.includes("情景一") && $("major-body").textContent.includes("缺课（未修）")
    && $("major-body").textContent.includes("NRS 424"),
    "护理选中即出三态全量清单（含与情景一关系说明）");
  // CS：缺口数与数据集一致（17 条要求，MTH 231 为 planned → 缺 16）
  sel.value = "computer-science-bs";
  sel.dispatchEvent(new w.Event("change"));
  await tick(30);
  ok($("major-body").textContent.includes("缺 16 门"), "CS 摘要：17 条要求中 1 计划 → 缺 16 门");
}

/* ================= E. 课程库 ================= */
section("E. 课程库检索与过滤");
{
  w.document.querySelector('[data-open="catalog"]').click();
  await tick(80);
  ok(!$("view-catalog").hidden, "课程库视图打开");
  ok($("catalog-list").querySelectorAll(".course").length === 68, "全部课程 68 门（v13.1 护理 42 条并入并集）");
  const msel = $("catalog-major");
  msel.value = "computer-science-bs";
  msel.dispatchEvent(new w.Event("change"));
  await tick(30);
  ok($("catalog-list").querySelectorAll(".course").length === 17, "按 CS 专业过滤 = 17 门");
  msel.value = "";
  msel.dispatchEvent(new w.Event("change"));
  const q = $("catalog-q");
  q.value = "BIO 1";
  q.dispatchEvent(new w.Event("input"));
  await tick(30);
  const codes = [...$("catalog-list").querySelectorAll(".course .code")].map((e) => e.textContent);
  /* v13.1 口径修订：护理集并入后 BIO 1xx 共 9 门（新增 BIO 106/107/146/150/160） */
  ok(codes.join(",") === "BIO 106,BIO 107,BIO 146,BIO 150,BIO 160,BIO 170,BIO 171,BIO 180,BIO 181", "搜索 BIO 1 → 9 门生物课（v13.1 护理并入）");
  w.document.querySelector('[data-close="view-catalog"]').click();
}

/* ================= F. 给爸妈的一句话 ================= */
section("F. 一句话：发送载荷白名单 + 撤回");
{
  w.document.querySelector('[data-tab="mentor"]').click();
  await tick(60);
  $("pnote-input").value = "最近挺好的";
  const tiredBtn = $("pnote-tags").querySelector('[data-tag="tired"]');
  tiredBtn.click();
  const before = S.requests.length;
  $("pnote-send").click();
  await tick(60);
  const post = S.requests.slice(before).find((r) => r.url.includes("/api/client/parent-note") && r.method === "POST");
  ok(!!post, "发送请求发出");
  const payload = JSON.parse(post.body);
  ok(payload.body === "最近挺好的" && payload.feeling_tag === "tired", "载荷含正文与自选标签 tired");
  ok(!("diary" in payload) && !("journal" in payload) && !("mood" in payload) && !("emotion" in payload),
    "★ 载荷无 diary/journal/mood/emotion 字段");
  ok($("pnote-list").textContent.includes("最近挺好的") && $("pnote-list").textContent.includes("有点累"),
    "已发列表显示正文与标签中文名");
  const wBefore = S.requests.length;
  $("pnote-list").querySelector("[data-withdraw]").click();
  await tick(60);
  ok(S.requests.slice(wBefore).some((r) => r.url.includes("/parent-note/withdraw")), "撤回请求发出");
  ok($("pnote-list").textContent.includes("还没有发过"), "撤回后列表回空态");
}

/* ================= G. 家长页三卡 + 导师工作台 ================= */
function makeParentWindow(parentData) {
  const dom = new JSDOM(PHTML, {
    url: "https://zhuanuc.com/one-on-one-app/parent.html?s=fix&p=pk-fix&api=https://api.test",
    runScripts: "outside-only",
  });
  const w2 = dom.window;
  w2.confirm = () => true;
  w2.fetch = async (url) => {
    const u = String(url);
    const j = (status, obj) => ({ status, ok: status >= 200 && status < 300, json: async () => obj });
    if (u.includes("/api/parent/message")) return j(200, { ok: true, message: { id: 1, sender: "parent", body: "x", created_at: new Date().toISOString() } });
    return j(200, JSON.parse(JSON.stringify(parentData)));
  };
  w2.eval(PARENT);
  return w2;
}
section("G1. 家长页：成就 / 一句话 / 提醒渲染与空态");
{
  const pd = {
    ok: true,
    student: { name: "测试学生", slug: "fix", stage: "plan", stage_label: "规划确认", package: "一对一辅导" },
    updates: [{ id: 1, update_date: "2026-10-20", title: "十月进展", body: "正文", current_focus: "", next_step: "" }],
    support_actions: [], messages: [], unread_mentor_parent: 0,
    achievements: [
      { kind: "milestone", title: "完成第一学期复盘", date_text: "2026-01-15" },
      { kind: "action", title: "提交考试信息", date_text: "2026-10-19" },
      { kind: "problem", title: "考试规则未确认", date_text: "2026-10-21" },
    ],
    student_notes: [{ id: 5, body: "最近挺好的，别担心", feeling_tag: "steady", feeling_tag_label: "平稳", created_at: "2026-10-21T09:00:00.000Z" }],
    upcoming_reminders: [{ date: "2026-10-26", title: "她的生日", kind: "birthday", days_left: 5, date_fmt: "2026-10-26" }],
  };
  const pw = makeParentWindow(pd);
  await tick(100);
  const $p = (id) => pw.document.getElementById(id);
  ok($p("note-body").textContent.includes("最近挺好的，别担心") && $p("note-body").textContent.includes("平稳"),
    "家长页展示学生一句话与心情标签");
  ok($p("ach-body").textContent.includes("完成第一学期复盘") && $p("ach-body").textContent.includes("解决了一个问题"),
    "成就卡三源标题与类型文案齐全");
  ok($p("rem-body").textContent.includes("她的生日") && $p("rem-body").textContent.includes("10 月 26 日") &&
     $p("rem-body").textContent.includes("5 天后"), "提醒卡温和文案（M 月 D 日 · 事项 · N 天后）");
  const pw2 = makeParentWindow({ ...pd, achievements: [], student_notes: [], upcoming_reminders: [] });
  await tick(100);
  const $q = (id) => pw2.document.getElementById(id);
  ok($q("note-body").textContent.includes("还没有发来") && $q("ach-body").textContent.includes("还没有可展示") &&
     $q("rem-body").textContent.includes("没有特别的日子"), "三卡空态文案齐全（不编造）");
}

function makeMentorWindow() {
  const dom = new JSDOM(MHTML, {
    url: "https://zhuanuc.com/one-on-one-app/mentor.html?s=EMP-T01&k=mk-fix&api=https://api.test",
    runScripts: "outside-only",
  });
  const w3 = dom.window;
  const requests = [];
  const wb = {
    ok: true,
    mentor: { id: 3, name: "测试导师", emp_no: "EMP-T01", kind: "mentor", mentor_status: "verified", mentor_status_label: "已核验", notifiable: true },
    students: [{
      student: { id: 7, name: "测试学生", slug: "fix", stage: "plan", stage_label: "规划确认" },
      recent_events: [{ id: 9, event_type: "mentor_reply", event_label: "导师回复", summary: "导师回复留言", created_at: "2026-10-21T08:00:00.000Z" },
                      { id: 8, event_type: "message_student", event_label: "学生留言", summary: "学生给导师留言", created_at: "2026-10-21T07:00:00.000Z" }],
      open_problems: [{ id: 11, title: "考试规则未确认", domain: "exam", domain_label: "考试", stuck_summary: "卡点摘要", support_needed: "需要模考资源", progress: "escalated", progress_label: "已升级", created_at: "2026-10-20T00:00:00.000Z" }],
      pending_actions: [{ id: 1, title: "待办一", detail: "", due_text: "本周五" }],
      trail_revisit_pending: 2,
      unread_messages: [{ id: 21, body: "导师，我想确认安排", created_at: "2026-10-21T07:00:00.000Z" }],
    }],
  };
  w3.fetch = async (url, o) => {
    const u = String(url);
    requests.push({ url: u, method: (o && o.method) || "GET", body: o && o.body ? String(o.body) : "" });
    const j = (status, obj) => ({ status, ok: status >= 200 && status < 300, json: async () => obj });
    if (u.includes("/api/mentor/reply")) return j(200, { ok: true, message: { id: 99, sender: "mentor", body: JSON.parse(o.body).body, created_at: new Date().toISOString() } });
    return j(200, JSON.parse(JSON.stringify(wb)));
  };
  w3.eval(MENTOR);
  return { w: w3, requests };
}
section("G2. 导师工作台：一屏三块 + 快速回复");
{
  const MW = makeMentorWindow();
  const w3 = MW.w;
  await tick(100);
  const $m = (id) => w3.document.getElementById(id);
  ok($m("m-name").textContent === "测试导师", "工作台导师名渲染");
  const stu = $m("students");
  ok(stu.textContent.includes("近期动态") && stu.textContent.includes("学生给导师留言"), "块一：近期动态（事件流）");
  ok(stu.textContent.includes("她的需求") && stu.textContent.includes("考试规则未确认") && stu.textContent.includes("需要模考资源") &&
     stu.textContent.includes("待回看的导师轨迹：2 条"), "块二：她的需求（问题+期望帮助+待办+待回看数）");
  ok(stu.textContent.includes("待回复") && stu.textContent.includes("导师，我想确认安排"), "块三：待回复留言在列");
  ok(!stu.textContent.includes("最近挺好的，别担心"), "工作台不含家长一句话内容（夹具外断言）");
  const ta = $m("wb-reply-0");
  ta.value = "周三晚细聊";
  stu.querySelector("[data-reply]").click();
  await tick(80);
  const post = MW.requests.find((r) => r.url.includes("/api/mentor/reply"));
  ok(!!post && JSON.parse(post.body).student_id === 7 && JSON.parse(post.body).body === "周三晚细聊",
    "快速回复经 /api/mentor/reply 发出（student_id+正文）");
}

/* ================= H. 双语字典对称 ================= */
section("H. i18n 字典 zh/en 键对称（app / parent / mentor）");
{
  const grab = (src) => {
    const m = src.match(/const I18N = (\{[\s\S]*?\n\});/);
    return eval("(" + m[1] + ")");
  };
  for (const [name, dict] of [["app", grab(APP)], ["parent", grab(PARENT)], ["mentor", grab(MENTOR)]]) {
    const zk = Object.keys(dict.zh).sort().join(",");
    const ek = Object.keys(dict.en).sort().join(",");
    ok(zk === ek, name + " 字典对称（zh " + Object.keys(dict.zh).length + " 键 / en " + Object.keys(dict.en).length + " 键）");
  }
}

console.log("\n==== app-v13: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
