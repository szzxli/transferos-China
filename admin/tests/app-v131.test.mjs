// 一对一 v13.1 前端断言（jsdom）：
// A. 护理数据集完整度：42 条全集（四块 + 先修链 + 最低成绩 + 学期编排），逐行来源 official/ledger 可区分
// B. 引擎以 Richa 生产真实 18 门课复算：已修 13 / 在修 4 / 缺 25（与情景一生产口径一致）；
//    AP 满足识别只认档案已登记的 5 门 AP 兑换；本地引擎与后台引擎计数口径一致
// C. 一键导出含项目规则 / 对账差异 / 三态清单 / 外修与 AP 信息
// D. 学生端 UI：默认护理、选中即出三态全量呈现（AP 徽标 / 外修标记 / 来源标记）
// 运行：node tests/app-v131.test.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/home/hatch/workspace/tools/jsdomtest/node_modules/jsdom");
import { matchRequirements as serverMatch } from "./worker.mjs";

const HTML = readFileSync(new URL("../../one-on-one-app/index.html", import.meta.url), "utf8");
const APP = readFileSync(new URL("../../one-on-one-app/app.js", import.meta.url), "utf8");
const PRIV = readFileSync(new URL("../../one-on-one-app/private.js", import.meta.url), "utf8");
const PROB = readFileSync(new URL("../../one-on-one-app/problems.js", import.meta.url), "utf8");
const MAJORS_JS = readFileSync(new URL("../../one-on-one-app/majors.js", import.meta.url), "utf8");
const DATASET = JSON.parse(readFileSync(new URL("../../one-on-one-app/data/csi-majors.json", import.meta.url), "utf8"));

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function section(s) { console.log("\n== " + s); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));

/* Richa 生产课程夹具（2026-10-21 client 接口实测：18 门，含 5 门 AP 兑换登记） */
const RICHA_COURSES = [
  { course_code: "BIO 106", status: "done", grade: "CR", term: "2025 秋季", note: "AP 兑换" },
  { course_code: "BIO 107", status: "done", grade: "CR", term: "2025 秋季", note: "AP 兑换" },
  { course_code: "BIO 150", status: "done", grade: "B", term: "2025 秋季", note: "" },
  { course_code: "CHN 215", status: "done", grade: "CR", term: "2025 秋季", note: "AP 兑换" },
  { course_code: "CSC 119", status: "done", grade: "CR", term: "2025 秋季", note: "AP 兑换" },
  { course_code: "ENG 111", status: "done", grade: "A", term: "2025 秋季", note: "" },
  { course_code: "FCWG 1000", status: "done", grade: "CR", term: "2025 秋季", note: "" },
  { course_code: "MTH 231", status: "done", grade: "CR", term: "2025 秋季", note: "AP 兑换" },
  { course_code: "PHL 130", status: "done", grade: "A-", term: "2025 秋季", note: "" },
  { course_code: "PSY 100", status: "done", grade: "B-", term: "2025 秋季", note: "" },
  { course_code: "BIO 160", status: "done", grade: "B-", term: "2026 春季", note: "" },
  { course_code: "ENG 151", status: "done", grade: "A", term: "2026 春季", note: "" },
  { course_code: "MUS 108", status: "done", grade: "A", term: "2026 春季", note: "" },
  { course_code: "PHY 114", status: "done", grade: "A", term: "2026 春季", note: "" },
  { course_code: "CHM 110", status: "ongoing", grade: "", term: "2026 秋季", note: "" },
  { course_code: "CHM 111", status: "ongoing", grade: "", term: "2026 秋季", note: "" },
  { course_code: "COR 100", status: "ongoing", grade: "", term: "2026 秋季", note: "" },
  { course_code: "MTH 113", status: "ongoing", grade: "", term: "2026 秋季", note: "" },
];

/* ================= A. 护理数据集完整度 ================= */
section("A. 护理数据集：完整度 / 来源构成 / 字段纪律");
const nursing = DATASET.majors.find((m) => m.id === "nursing-bs");
{
  ok(!!nursing && nursing.verified === true && nursing.partial === false, "护理 verified 且非部分集（完整集交付）");
  const reqs = nursing.requirements;
  ok(reqs.length === 42, "护理要求共 42 条（与情景一台账条数一致）");
  const byBlock = {};
  for (const r of reqs) byBlock[r.block] = (byBlock[r.block] || 0) + 1;
  ok(byBlock.gened === 12 && byBlock.prereq === 12 && byBlock.core === 17 && byBlock.elective === 1,
    "四块齐全：通识 12 / 先修 12 / 核心 17 / 选修 1");
  const off = reqs.filter((r) => r.source === "official").length;
  const led = reqs.filter((r) => r.source === "ledger").length;
  ok(off === 29 && led === 13 && off + led === 42, "来源构成：官方 29 条 / 台账 13 条，逐行可区分、无无来源行");
  ok(reqs.every((r) => ["epermit", "csi_only", "same_school_pair"].includes(r.permit)), "每行带外修口径（epermit / csi_only / same_school_pair）");
  const core = reqs.filter((r) => r.block === "core");
  ok(core.every((r) => r.permit === "csi_only" && r.credits !== null && r.min_grade === "C+" && r.term),
    "17 门 NRS 核心：学分全标注（官方逐门）、最低成绩 C+、须在 CSI 修、带学期编排");
  ok(core.reduce((s, r) => s + r.credits, 0) === 58, "NRS 核心官方学分合计 58（+选修 6 = 64；台账称 65 的 1 学分差已记入对账）");
  ok(nursing.program_rules && nursing.program_rules.length >= 6, "项目规则齐备（总学分/GPA/科学课小组/同校修读/入学考试等）");
  ok(nursing.diff_notes && nursing.diff_notes.length >= 4, "与情景一的对账差异逐条在册（diff_notes）");
  ok(Array.isArray(DATASET._meta.permit_sources) && /epermit/.test(DATASET._meta.permit_sources[0]) && /advanced-placement/.test(DATASET._meta.ap_source),
    "_meta 登记外修（CSI ePermit 页）与 AP（CSI AP 页）官方来源");
  ok(DATASET.majors.length === 10 && DATASET.majors[0].id === "nursing-bs", "专业共 10 个，护理居首（默认重点专业）");
  const mls = DATASET.majors.find((m) => m.id === "medical-lab-science-bs");
  const chm = DATASET.majors.find((m) => m.id === "chemistry-bs");
  ok(mls && mls.verified === false && /MDT-BS/.test((mls.sources || []).join()), "Medical Laboratory Science BS 列名（官方目录 MDT-BS 核实存在）");
  ok(chm && chm.verified === false && /CHM-BS/.test((chm.sources || []).join()), "Chemistry BS 列名（官方目录 CHM-BS 核实存在）");
  ok(!DATASET.majors.some((m) => /nutrition/i.test(m.id)), "营养学未列入：CSI 无独立 Nutrition 学士项目（不编造）");
  const lib = DATASET.courses.filter((c) => (c.majors || []).includes("nursing-bs"));
  ok(lib.length === 42 && lib.every((c) => c.permit && c.ap_note && /Transfer Explorer/.test(c.ap_note)),
    "课程库护理 42 门全带外修口径与 AP 说明（T-Rex 官方查询口径）");
}

/* ================= B. 引擎复算（Richa 真实课程） ================= */
section("B. 匹配引擎：护理 × Richa 真实课程 = 情景一口径");
let match;
{
  const w1 = new JSDOM("", { runScripts: "outside-only" });
  w1.window.eval(MAJORS_JS);
  const M = w1.window.OOOMajors;
  match = M.matchRequirements(RICHA_COURSES, nursing.requirements);
  const tt = match.totals;
  ok(tt.requirements === 42 && tt.done === 13 && tt.in_progress === 4 && tt.planned === 0 && tt.missing === 25,
    "计数与情景一生产口径完全一致：已修 13 / 在修 4 / 缺 25（实测 " + tt.done + "/" + tt.in_progress + "/" + tt.missing + "）");
  ok(tt.credits_unknown === 0, "学分未知 0 条（台账未拆分的 NRS 学分已按官方逐门补齐）");
  const apCodes = match.items.filter((x) => x.via_ap).map((x) => x.code).sort();
  ok(JSON.stringify(apCodes) === JSON.stringify(["BIO 106", "BIO 107", "CHN 215", "CSC 119", "MTH 231"]),
    "AP 满足恰为档案已登记的 5 门（BIO 106/107、CHN 215、CSC 119、MTH 231），不多不少");
  ok(match.items.filter((x) => x.status === "done").every((x) => x.status !== "missing"), "三态互斥：每条要求只有已满足/在修/缺一种状态");
  ok(match.grade_warnings.every((x) => x.kind === "watch") && match.grade_warnings.length === 2,
    "成绩预警只有 2 条 watch（BIO 160、PSY 100 的 B-），无 below_min 误报（官方最低成绩标注不产生假警报）");
  ok(match.prereq_breaks.length === 0, "先修断裂 0（她的在修课先修均已满足）");
  const server = serverMatch(RICHA_COURSES, nursing.requirements);
  ok(JSON.stringify(server.totals) === JSON.stringify(tt) &&
     JSON.stringify(server.items.map((x) => x.code + ":" + x.status)) === JSON.stringify(match.items.map((x) => x.code + ":" + x.status)),
    "本地引擎与后台引擎对护理集同输入同输出（totals + 逐条状态全等）");
  const missingNrs = match.missing.filter((x) => x.block === "core");
  ok(missingNrs.length === 17 && missingNrs.every((x) => x.permit === "csi_only" && x.term_hint && x.min_grade === "C+"),
    "缺课中的 17 门 NRS 核心课逐门带：须在 CSI 修 + 建议学期 + 最低成绩 C+（选修行最低成绩 C 单独口径，不并入）");
  ok(missingNrs.every((x) => x.credits !== null), "缺课 NRS 学分无一为空（不出现含义不明的灰色条目）");
}

/* ================= C. 一键导出 ================= */
section("C. 导出：护理规则 / 对账 / 三态 / 外修与 AP");
{
  const w1 = new JSDOM("", { runScripts: "outside-only" });
  w1.window.eval(MAJORS_JS);
  const M = w1.window.OOOMajors;
  const md = M.buildExportMarkdown({ studentName: "Richa", major: nursing, match, dataset: DATASET, today: "2026-10-21" });
  ok(md.includes("## 项目规则（官方）") && md.includes("学位总学分 120"), "导出含项目规则（官方）");
  ok(md.includes("## 与台账情景的对账差异") && md.includes("差 1 学分待核实"), "导出含对账差异（含 65 vs 64 的 1 学分待核实）");
  ok(md.includes("## 已满足（已修）") && md.includes("## 在修") && md.includes("## 缺口清单"), "导出三态分列");
  ok(md.includes("已由 AP 兑换满足") && md.includes("BIO 106"), "导出标明 AP 兑换满足的条目");
  ok(md.includes("须在 CSI 项目内修读") && md.includes("NRS 424"), "导出缺口含外修口径：NRS 课须在 CSI 修");
  ok(md.includes("可申请 CUNY ePermit 外修") && md.includes("PSY 242"), "导出缺口含外修口径：支持课可 ePermit");
  ok(md.includes("来源：台账（未经官网复核）"), "导出逐行来源可区分（台账行明示未经官网复核）");
  ok(md.includes("Transfer Explorer"), "导出课程清单含 AP 等效查询口径");
  ok(!md.includes("EXAM-SCORE") && !md.includes("PRIV-"), "导出不含考试分数/私密层内容（结构隔离）");
}

/* ================= D. 学生端 UI ================= */
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
function fixtureData() {
  return {
    ok: true,
    student: { id: 1, name: "Richa", slug: "richa", stage: "assess", stage_label: "评估诊断", package: "" },
    school_system: "CUNY · CSI",
    goal: null, goal_lines: [], main_line: null,
    status: { latest: { id: 1, snapshot_date: "2026-06-01", gpa: 3.481, credits_done: 55, credits_total: 120, note: "" }, history: [] },
    exams: [], courses: { progress: {}, groups: [], list: RICHA_COURSES.map((c, i) => ({ id: i + 1, ...c, course_name: "", credits: null, kind: "major", kind_label: "", status_label: "" })) },
    meetings: [], vision_text: "", mentor_message: "", mentor_message_at: "",
    milestones: [], key_dates: [], actions: [], advice: [], knowledge: [],
    messages: [], unread_mentor: 0, problems: [], mentor_trail: [], course_match: [], parent_notes: [],
  };
}
section("D. UI：默认护理 + 选中即出三态全量");
{
  const dom = new JSDOM(HTML, { url: "https://zhuanuc.com/one-on-one-app/?s=richa&k=key&api=https://api.test", runScripts: "outside-only" });
  const w = dom.window;
  const fake = makeFakeIDB();
  w.indexedDB = fake.indexedDB;
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  const blobs = [];
  w.URL.createObjectURL = (b) => { blobs.push(b); return "blob:fake-" + blobs.length; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillStyle: "", font: "", createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {}, measureText: (s) => ({ width: String(s).length * 20 }), fillText() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
  const data = fixtureData();
  w.fetch = async (url) => {
    const u = String(url);
    const j = (obj) => ({ status: 200, ok: true, json: async () => obj });
    if (u.includes("data/csi-majors.json")) return j(JSON.parse(JSON.stringify(DATASET)));
    return j(JSON.parse(JSON.stringify(data)));
  };
  w.eval(PRIV + "\n" + PROB + "\n" + MAJORS_JS + "\n" + APP);
  await tick(150);
  const $ = (id) => w.document.getElementById(id);
  w.document.querySelector('[data-tab="plan"]').click();
  await tick(150);
  const sel = $("major-select");
  ok(sel && sel.value === "nursing-bs", "进入规划页默认选中护理（默认重点专业）");
  const body = $("major-body");
  ok(body.textContent.includes("已修 13 · 在修 4 · 缺 25 门"), "护理摘要即时呈现且与生产口径一致（13/4/25），无二次点击");
  ok(body.textContent.includes("已修（已满足）（13）") && body.textContent.includes("在修（4）") && body.textContent.includes("缺课（未修）（25）"),
    "三态分组全量呈现，各组计数与摘要一致");
  ok(body.textContent.includes("AP 兑换满足"), "已修组标明 AP 兑换满足的条目");
  ok(body.textContent.includes("须在 CSI 修") && body.textContent.includes("可 ePermit 外修"), "课程行带外修标记（CSI only / ePermit 两类都在）");
  ok(body.textContent.includes("建议学期 Y4S2") || body.textContent.includes("Y4S2"), "缺课行带建议学期（如 NRS 424 的 Y4S2）");
  ok(body.textContent.includes("台账") && body.textContent.includes("官方"), "课程行带来源标记（官方/台账可区分）");
  $("major-export").click();
  await tick(40);
  ok(blobs.length >= 1, "护理一键导出生成文件");
  const md = await blobs[blobs.length - 1].text();
  ok(md.includes("Nursing BS") && md.includes("须在 CSI 项目内修读") && md.includes("已由 AP 兑换满足"),
    "UI 导出内容含护理全集与外修/AP 信息");
}

console.log("\n==== app-v131: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
