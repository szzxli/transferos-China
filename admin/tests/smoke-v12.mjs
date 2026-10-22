// TransferOS 管理后台 v12 冒烟测试：问题方案层 + 导师轨迹（会议精神）+ 课程要求集与匹配引擎
// + GET /api/client 扩展字段 + 后台三张新卡 + 家长端零回归边界 + 删除级联。
// 以 v11 形态旧库起步（students 无 parent_key、无家长三表、无 v12 四表），验迁移。
// 隐私红线：所有新写接口/补录段夹带 diary/journal/mood/emotion 哨兵值 → 不落库、不回传、家长端不可见。
// 运行：node tests/smoke-v12.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
import { DatabaseSync } from "node:sqlite";
import worker, {
  normProblemInput, normTrailExtras, normRequirementSets,
  complianceFlag, gradePoints, matchRequirements,
} from "./worker.mjs";

class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid) } }; }
  async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args) }; }
  async first() { const row = this.db.prepare(this.sql).get(...this.args); return row === undefined ? null : row; }
}
class D1Shim {
  constructor() { this.raw = new DatabaseSync(":memory:"); }
  prepare(sql) { return new Stmt(this.raw, sql); }
}

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function section(t) { console.log("\n== " + t); }

const DB = new D1Shim();
// —— 模拟 v11 库：students 有 v11 全部列之前的形态（无 parent_key、无 v12 表）——
DB.raw.exec(`CREATE TABLE students(
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, order_id INTEGER,
  name TEXT, package TEXT, stage TEXT DEFAULT 'diag',
  stage_since TEXT, note TEXT, created_at TEXT, updated_at TEXT,
  client_key TEXT, slug TEXT, signature TEXT, signature_set_at TEXT,
  vision_text TEXT, mentor_message TEXT, mentor_message_at TEXT)`);
DB.raw.exec(`CREATE UNIQUE INDEX idx_students_slug ON students(slug)`);

const env = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123" };
const BASE = "https://admin.test";
async function call(path, opts = {}, cookie) {
  const headers = new Headers(opts.headers || {});
  if (cookie) headers.set("Cookie", cookie);
  const req = new Request(BASE + path, { method: opts.method || "GET", headers, body: opts.body });
  return worker.fetch(req, env);
}
const jsonPost = (obj, token) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
  body: JSON.stringify(obj),
});
const form = (obj) => {
  const b = new URLSearchParams(obj);
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: b.toString() };
};
const imp = (body) => call("/api/admin/students/import", jsonPost(body, "tok-123"));
const enr = (body) => call("/api/admin/students/enrich", jsonPost(body, "tok-123"));
const getClientRaw = (loc, key) => call("/api/client/" + loc + "?key=" + encodeURIComponent(key));
const getClient = (loc, key) => getClientRaw(loc, key).then((r) => r.json());
const getParentRaw = (loc, key) => call("/api/parent/" + loc + "?key=" + encodeURIComponent(key));
const postProblem = (obj) => call("/api/client/problem", jsonPost(obj));
const postProblemStatus = (obj) => call("/api/client/problem/status", jsonPost(obj));
const postTrail = (obj) => call("/api/client/trail", jsonPost(obj));

// ============ 纯函数 ============
section("纯函数：normProblemInput / complianceFlag / gradePoints");
{
  ok(normProblemInput({ domain: "weird", title: "x" }).error === "bad domain", "非法 domain → error");
  ok(normProblemInput({ domain: "exam" }).error === "title required", "缺 title → error");
  const good = normProblemInput({
    domain: "exam", title: "考试规则不清", desired_outcome: "弄清规则",
    strategy_summary: "先查官方原文", actions: [{ title: "查官网" }, "打印规则"],
    support_needed: "导师", source_local_id: "loc-1",
    diary: "SENTINEL_DIARY", journal: "SENTINEL_JOURNAL", mood: "SENTINEL_MOOD", emotion: "SENTINEL_EMOTION",
  });
  ok(!good.error && good.actions.length === 2 && good.actions[1].title === "打印规则", "合法输入归一（字符串行动项兼容）");
  ok(!("diary" in good) && !("journal" in good) && !("mood" in good) && !("emotion" in good),
    "norm 结果不含 diary/journal/mood/emotion 键（白名单丢弃）");
  ok(complianceFlag("我想了解签证政策") === "pending_review", "命中「签证」→ pending_review");
  ok(complianceFlag("食品创业要什么许可") === "pending_review", "命中「食品」→ pending_review");
  ok(complianceFlag("先修课跟不上") === "ok", "普通学业问题 → ok");
  ok(gradePoints("B-") === 2.7 && gradePoints("A") === 4 && gradePoints("CR") === null && gradePoints("") === null,
    "gradePoints：B-=2.7 / A=4 / CR 与空 → null");
}

section("纯函数：matchRequirements 精确计数");
const FIX_COURSES = [
  { course_code: "BIO 150", status: "done", grade: "B", term: "2025 秋" },
  { course_code: "BIO 160", status: "done", grade: "B-", term: "2026 春" },
  { course_code: "PSY 100", status: "done", grade: "B-", term: "2025 秋" },
  { course_code: "CHM 110", status: "ongoing", grade: "", term: "2026 秋" },
  { course_code: "ENG 111", status: "done", grade: "A", term: "2025 秋" },
  { course_code: "BIO 350", status: "ongoing", grade: "", term: "2027 春" },
  { course_code: "MTH 113", status: "planned", grade: "", term: "2027 春" },
  { course_code: "NRS 204", status: "planned", grade: "", term: "2027 秋" },
];
const FIX_REQS = [
  { block: "prereq", course_code: "BIO 150", course_name: "解剖生理 I", credits: 4, min_grade: "B", prereq_codes: "" },
  { block: "prereq", course_code: "BIO 160", course_name: "解剖生理 II", credits: 4, min_grade: "B", prereq_codes: "BIO 150" },
  { block: "prereq", course_code: "PSY 100", course_name: "心理学", credits: 3, min_grade: "", prereq_codes: "" },
  { block: "prereq", course_code: "CHM 116", course_name: "化学 II", credits: 3, min_grade: "", prereq_codes: "CHM 110" },
  { block: "prereq", course_code: "BIO 350", course_name: "微生物学", credits: 3, min_grade: "", prereq_codes: "BIO 160" },
  { block: "prereq", course_code: "MTH 113", course_name: "统计", credits: 4, min_grade: "", prereq_codes: "" },
  { block: "core", course_code: "NRS 101", course_name: "护理基础", credits: null, min_grade: "", prereq_codes: "" },
  { block: "core", course_code: "NRS 204", course_name: "护理 II", credits: null, min_grade: "", prereq_codes: "NRS 101" },
  { block: "core", course_code: "NRS 303", course_name: "护理 III", credits: null, min_grade: "", prereq_codes: "NRS 204" },
  { block: "gened", course_code: "ENG 111", course_name: "写作", credits: 3, min_grade: "", prereq_codes: "" },
  { block: "gened", course_code: "COLLEGE-OPTION", course_name: "College Option 缺口", credits: 12, min_grade: "", prereq_codes: "" },
  { block: "elective", course_code: "NRS-ELECT", course_name: "护理选修", credits: 6, min_grade: "", prereq_codes: "" },
];
{
  const m = matchRequirements(FIX_COURSES, FIX_REQS);
  ok(m.totals.requirements === 12 && m.totals.done === 4 && m.totals.in_progress === 1 &&
     m.totals.planned === 2 && m.totals.missing === 5, "总计：12 条 / done 4 / 在修 1 / 计划 2 / 缺 5");
  ok(m.totals.credits_total === 42 && m.totals.credits_done === 14 && m.totals.credits_missing === 21 &&
     m.totals.credits_unknown === 3, "学分：已知总 42 / 已修 14 / 缺 21 / 未知 3 条");
  ok(m.blocks.prereq.total === 6 && m.blocks.prereq.done === 3 && m.blocks.prereq.missing === 1 &&
     m.blocks.core.total === 3 && m.blocks.gened.missing === 1 && m.blocks.elective.missing === 1, "分块计数正确");
  ok(m.missing.map((x) => x.code).join(",") === "CHM 116,NRS 101,NRS 303,COLLEGE-OPTION,NRS-ELECT", "缺课清单顺序与内容");
  ok(m.grade_warnings.length === 2 &&
     m.grade_warnings[0].code === "BIO 160" && m.grade_warnings[0].kind === "below_min" &&
     m.grade_warnings[1].code === "PSY 100" && m.grade_warnings[1].kind === "watch",
     "成绩预警：BIO 160 below_min + PSY 100 watch");
  ok(m.prereq_breaks.length === 1 && m.prereq_breaks[0].code === "NRS 204" &&
     m.prereq_breaks[0].missing_prereq === "NRS 101", "先修断裂：NRS 204 缺 NRS 101");
  const empty = matchRequirements([], []);
  ok(empty.totals.requirements === 0 && empty.missing.length === 0, "空输入 → 空结果");
}

section("纯函数：normTrailExtras / normRequirementSets");
{
  ok(normTrailExtras({ trail_entries: [{ spirit_line: "x" }] }).error.includes("mentor_name"), "轨迹缺导师名 → error");
  ok(normTrailExtras({ trail_entries: [{ mentor_name: "A", spirit_line: "长".repeat(61) }] }).error.includes("60"), "一句话精神 >60 字 → error");
  const lt = normTrailExtras({ trail_entries: [{ mentor_name: "A", spirit_line: "稳住", student_takeaway: "SENTINEL_TK", takeaway_local: 1, diary: "SENTINEL_D" }] });
  ok(!lt.error && lt.trail[0].student_takeaway === "" && lt.trail[0].takeaway_local === 1, "takeaway_local=1 → 领受正文归零、只留标记");
  ok(!("diary" in lt.trail[0]), "轨迹 norm 不含 diary 键");
  ok(normRequirementSets({ requirement_sets: [{ name: "S", requirements: [{ course_code: "X", block: "weird" }] }] }).error.includes("block"), "要求非法 block → error");
  const rs = normRequirementSets({ requirement_sets: [{ name: "S", requirements: [{ course_code: "X 1" }] }] });
  ok(!rs.error && rs.sets[0].requirements[0].credits === null && rs.sets[0].verified === 0, "要求 credits 缺省 null、verified 缺省 0");
}

// ============ 建学生 + 迁移 ============
let sid, ckey, pkey;
section("导入夹具学生 + v12 迁移");
{
  const r = await (await imp({
    student: { name: "V12Fix", slug: "v12-fix", package: "一对一辅导" },
    goal: { target_school: "目标护理项目", school_system: "CUNY" },
    goal_lines: [{ name: "调料包创业", line_type: "main", priority: 1, next_step: "定版配方" }],
    status: [{ snapshot_date: "2026-06-01", gpa: 3.481, credits_done: 55, credits_total: 120 }],
    courses: FIX_COURSES.map((c) => ({
      term: c.term, course_code: c.course_code, course_name: c.course_code + " 课",
      credits: 3, kind: "prereq", status: c.status, grade: c.grade,
    })),
    meetings: [{ meeting_date: "2026-10-01", topic: "首谈", summary: "纪要" }],
  })).json();
  ok(r.ok === true && r.student_id > 0, "导入成功");
  sid = r.student_id; ckey = r.client_key; pkey = r.parent_key;
  const tables = DB.raw.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('student_problem_shares','mentor_trail_entries','course_requirement_sets','course_requirements')").all();
  ok(tables.length === 4, "迁移后 v12 四表齐备");
}

// ============ 问题方案接口 ============
let probA;
section("POST /api/client/problem：鉴权 / 落库 / 合规 / 去重 / 限频 / 哨兵");
{
  ok((await postProblem({ s: "v12-fix", key: "wrong", domain: "exam", title: "x" })).status === 404, "错 key → 404");
  ok((await postProblem({ s: "v12-fix", key: pkey, domain: "exam", title: "x" })).status === 404, "家长 key 冒充学生 key → 404");
  const r1 = await (await postProblem({
    s: "v12-fix", key: ckey, domain: "exam", title: "入学考试规则不清",
    desired_outcome: "弄清官方规则", strategy_summary: "先查官网原文",
    actions: [{ title: "查官网考试页" }], support_needed: "导师确认", source_local_id: "loc-a",
    diary: "SENTINEL_DIARY", journal: "SENTINEL_JOURNAL", mood: "SENTINEL_MOOD", emotion: "SENTINEL_EMOTION",
  })).json();
  ok(r1.ok === true && r1.problem.progress === "open" && r1.problem.compliance === "ok", "同步成功：progress=open、compliance=ok");
  probA = r1.problem.id;
  const rawRow = JSON.stringify(DB.raw.prepare("SELECT * FROM student_problem_shares WHERE id = ?").get(probA));
  ok(!rawRow.includes("SENTINEL"), "落库行不含任何私密哨兵值");
  const r2 = await (await postProblem({
    s: "v12-fix", key: ckey, domain: "business", title: "调料包要不要签证和食品许可",
    strategy_summary: "先核实", source_local_id: "loc-b",
  })).json();
  ok(r2.ok === true && r2.problem.compliance === "pending_review", "含签证/食品 → 服务端复算 compliance=pending_review");
  const dup = await (await postProblem({
    s: "v12-fix", key: ckey, domain: "exam", title: "入学考试规则不清", source_local_id: "loc-a",
  })).json();
  ok(dup.ok === true && dup.existed === true && dup.problem.id === probA, "同 source_local_id 重提 → existed、不重复落库");
  const r3 = await postProblem({ s: "v12-fix", key: ckey, domain: "study", title: "第三条" });
  ok(r3.status === 200, "窗口内第 3 条落库成功");
  const r4 = await postProblem({ s: "v12-fix", key: ckey, domain: "study", title: "第四条" });
  ok(r4.status === 429, "60 秒内第 4 条 → 429");
  ok((await postProblem({ s: "v12-fix", key: ckey, domain: "bad", title: "x" })).status === 400, "非法 domain → 400");
}

section("POST /api/client/problem/status：进度回写");
{
  const u = await (await postProblemStatus({ s: "v12-fix", key: ckey, id: probA, progress: "resolved", resolved_note: "已查官网确认" })).json();
  ok(u.ok === true && u.problem.progress === "resolved" && u.problem.resolved_note === "已查官网确认", "标已解决 + 小结落库");
  ok((await postProblemStatus({ s: "v12-fix", key: ckey, id: probA, progress: "weird" })).status === 400, "非法 progress → 400");
  ok((await postProblemStatus({ s: "v12-fix", key: "wrong", id: probA, progress: "open" })).status === 404, "错 key → 404");
  ok((await postProblemStatus({ s: "v12-fix", key: ckey, id: 99999, progress: "open" })).status === 404, "他人/不存在的问题 → 404");
}

// ============ 导师轨迹学生侧 ============
let trailMentorId;
section("POST /api/client/trail：自建 / 领受本机标记 / 回看");
{
  // 导师条目先经 enrich 录入（模拟后台录入的方案层数据）
  const e = await (await enr({
    student: { slug: "v12-fix" },
    trail_entries: [{ mentor_name: "主导师", mentor_role: "lead", spirit_line: "先保住资格门，再谈加速", key_judgments: "考试是头号变量", followup_actions: "提交考试完整信息\n确认配方方向" }],
  })).json();
  ok(e.ok === true && e.counts.trail_entries.inserted === 1, "enrich 录入导师轨迹 1 条");
  const trow = DB.raw.prepare("SELECT * FROM mentor_trail_entries WHERE student_id = ?").get(sid);
  trailMentorId = trow.id;
  ok(trow.revisit_due && /^\d{4}-\d{2}-\d{2}$/.test(trow.revisit_due), "回看日期默认 +30 天");
  const actN = DB.raw.prepare("SELECT COUNT(*) AS n FROM student_actions WHERE student_id = ?").get(sid).n;
  ok(actN === 2, "会后行动 2 行并入行动清单");
  // 学生补领受（同步版）
  const tk = await (await postTrail({ s: "v12-fix", key: ckey, action: "takeaway", id: trailMentorId, takeaway: "我听懂了先保资格" })).json();
  ok(tk.ok === true, "补领受（同步）成功");
  let d = await getClient("v12-fix", ckey);
  let entry = d.mentor_trail.find((x) => x.id === trailMentorId);
  ok(entry && entry.student_takeaway === "我听懂了先保资格" && entry.takeaway_local === false, "GET 下发同步版领受");
  // 改为只存本机：正文清空、只留标记
  const tk2 = await (await postTrail({ s: "v12-fix", key: ckey, action: "takeaway", id: trailMentorId, takeaway_local: true })).json();
  ok(tk2.ok === true, "改领受为只存本机成功");
  const dbRow = DB.raw.prepare("SELECT student_takeaway, takeaway_local FROM mentor_trail_entries WHERE id = ?").get(trailMentorId);
  ok(dbRow.student_takeaway === null && dbRow.takeaway_local === 1, "服务器正文清空、只留 takeaway_local 标记");
  d = await getClient("v12-fix", ckey);
  entry = d.mentor_trail.find((x) => x.id === trailMentorId);
  ok(entry.student_takeaway === "" && entry.takeaway_local === true, "GET 只回占位标记、不回正文");
  // 回看补录
  const rv = await (await postTrail({ s: "v12-fix", key: ckey, action: "revisit", id: trailMentorId, revisit_result: "资格门信息已提交" })).json();
  ok(rv.ok === true, "补回看结果成功");
  // 学生自建（校外导师），领受带哨兵 + takeaway_local → 服务端不得留哨兵
  const cr = await (await postTrail({
    s: "v12-fix", key: ckey, action: "create", mentor_name: "王老师", mentor_role: "teacher",
    spirit_line: "先修课要稳", student_takeaway: "SENTINEL_TAKEAWAY", takeaway_local: true,
  })).json();
  ok(cr.ok === true && cr.id > 0, "学生自建轨迹成功");
  const rawAll = JSON.stringify(DB.raw.prepare("SELECT * FROM mentor_trail_entries WHERE student_id = ?").all(sid));
  ok(!rawAll.includes("SENTINEL_TAKEAWAY"), "自建条目 takeaway_local 时哨兵正文不落库");
  ok((await postTrail({ s: "v12-fix", key: ckey, action: "takeaway", id: 99999, takeaway: "x" })).status === 404, "不存在的条目 → 404");
  ok((await postTrail({ s: "v12-fix", key: pkey, action: "create", mentor_name: "X", spirit_line: "y" })).status === 404, "家长 key 调学生轨迹接口 → 404");
}

// ============ GET client 扩展 + enrich 要求集 ============
section("GET /api/client：v12 字段与课程匹配");
{
  const e = await (await enr({
    student: { slug: "v12-fix" },
    requirement_sets: [
      { name: "FIX 本校情景", source_note: "来源：测试夹具", version_text: "v-test", verified: 0, requirements: FIX_REQS },
      { name: "FIX 待核实情景", source_note: "官方要求待核实", requirements: [] },
    ],
  })).json();
  ok(e.ok === true && e.counts.requirement_sets.inserted === 2 && e.counts.requirement_sets.requirements_inserted === 12,
    "enrich 灌入 2 份要求集 / 12 条要求");
  const e2 = await (await enr({
    student: { slug: "v12-fix" },
    requirement_sets: [{ name: "FIX 本校情景", requirements: FIX_REQS }],
  })).json();
  ok(e2.counts.requirement_sets.inserted === 0 && e2.counts.requirement_sets.requirements_inserted === 0,
    "重复 enrich 要求集 → 全去重");
  const d = await getClient("v12-fix", ckey);
  ok(Array.isArray(d.problems) && d.problems.length === 3, "GET 带 problems（3 条）");
  ok(d.problems.some((x) => x.id === probA && x.progress === "resolved"), "problems 含已解决条目与进度");
  ok(Array.isArray(d.mentor_trail) && d.mentor_trail.length === 2, "GET 带 mentor_trail（2 条）");
  ok(Array.isArray(d.course_match) && d.course_match.length === 2, "GET 带 course_match（2 个情景）");
  const m1 = d.course_match.find((x) => x.name === "FIX 本校情景");
  ok(m1 && m1.match && m1.match.totals.done === 4 && m1.match.totals.missing === 5 &&
     m1.match.grade_warnings.length === 2 && m1.match.prereq_breaks.length === 1,
     "情景一匹配与纯函数同数（done 4 / 缺 5 / 预警 2 / 断裂 1）");
  ok(m1.verified === false && m1.source_note === "来源：测试夹具", "情景一来源与未核实标记下发");
  const m2 = d.course_match.find((x) => x.name === "FIX 待核实情景");
  ok(m2 && m2.match === null, "无要求条目的情景 → match=null（只建框架）");
  ok(d.actions.every((a) => "updated_at" in a) && d.milestones !== undefined, "actions 带 updated_at（动态流用）");
  const rawClient = await (await getClientRaw("v12-fix", ckey)).text();
  ok(!rawClient.includes("SENTINEL"), "GET client 全文无私密哨兵");
}

// ============ 家长端边界（零回归）============
section("家长端边界：v12 数据不可见 + 密钥交叉 404");
{
  const raw = await (await getParentRaw("v12-fix", pkey)).text();
  // v13 口径修订（创始人定版）：已解决问题「标题」作为成就进家长端是合法的（方案层事实）；
  // 但问题的期望结果/策略摘要/解决小结/期望帮助等细节仍不得出现在家长响应中。
  for (const probe of ["弄清官方规则", "先查官网原文", "已查官网确认", "导师确认", "先保住资格门", "王老师", "FIX 本校情景", "course_match", "mentor_trail",
                       '"problems"', "NRS 101", "SENTINEL"]) {
    ok(!raw.includes(probe), "家长响应不含：" + probe);
  }
  ok(raw.includes("入学考试规则不清"), "v13：已解决问题的标题作为成就出现在家长端（创始人定版）");
  ok((await getParentRaw("v12-fix", ckey)).status === 404, "学生 key 查家长接口 → 404");
  const pd = JSON.parse(raw);
  ok(pd.ok === true && Array.isArray(pd.updates) && Array.isArray(pd.support_actions), "家长接口结构不变（v11 口径）");
}

// ============ 后台三张新卡 ============
section("后台：pageClient 新卡 + postClient 新动作");
{
  const loginRes = await call("/admin/login", form({ password: "test-pw" }));
  const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];
  const page = await (await call("/admin/client/" + sid, {}, cookie)).text();
  ok(page.includes("导师轨迹 · 会议精神"), "后台页含导师轨迹卡");
  ok(page.includes("问题方案（学生确认同步"), "后台页含问题方案卡");
  ok(page.includes("课程要求集（匹配引擎"), "后台页含课程要求集卡");
  ok(page.includes("待核实"), "问题方案卡显示待核实标记（签证条目）");
  ok(page.includes("先保住资格门，再谈加速"), "轨迹卡显示导师录入的精神");
  ok(page.includes("已在本机记录（正文不入库）"), "轨迹卡对本机领受只显示占位标记");
  // trail_add（后台录入）
  await call("/admin/client/" + sid, form({
    action: "trail_add", mentor_name: "行业前辈 L", mentor_role: "industry",
    spirit_line: "先验证再投入", key_judgments: "现金流优先", followup_actions: "做一版成本表",
  }), cookie);
  const t2 = DB.raw.prepare("SELECT * FROM mentor_trail_entries WHERE student_id = ? AND mentor_name = '行业前辈 L'").get(sid);
  ok(!!t2 && t2.source === "mentor" && t2.visibility === "plan", "后台 trail_add 落库（source=mentor）");
  const actN2 = DB.raw.prepare("SELECT COUNT(*) AS n FROM student_actions WHERE student_id = ? AND title = '做一版成本表'").get(sid).n;
  ok(actN2 === 1, "后台录入的会后行动并入行动清单");
  // problem_progress（导师更新进度）
  await call("/admin/client/" + sid, form({ action: "problem_progress", id: String(probA), progress: "in_progress" }), cookie);
  const pr = DB.raw.prepare("SELECT progress FROM student_problem_shares WHERE id = ?").get(probA);
  ok(pr.progress === "in_progress", "后台 problem_progress 生效");
  // reqset_add + req_add + req_delete
  await call("/admin/client/" + sid, form({
    action: "reqset_add", name: "后台新建集", source_note: "后台录入", version_text: "2026-10", verified: "1",
  }), cookie);
  const setRow = DB.raw.prepare("SELECT * FROM course_requirement_sets WHERE student_id = ? AND name = '后台新建集'").get(sid);
  ok(!!setRow && setRow.verified === 1, "后台 reqset_add 落库（verified=1）");
  await call("/admin/client/" + sid, form({
    action: "req_add", set_id: String(setRow.id), block: "core", course_code: "NRS 999",
    course_name: "测试课", credits: "3", min_grade: "B", prereq_codes: "NRS 101",
  }), cookie);
  const reqRow = DB.raw.prepare("SELECT * FROM course_requirements WHERE set_id = ?").get(setRow.id);
  ok(!!reqRow && reqRow.credits === 3 && reqRow.min_grade === "B", "后台 req_add 落库");
  await call("/admin/client/" + sid, form({ action: "req_delete", id: String(reqRow.id) }), cookie);
  ok(!DB.raw.prepare("SELECT id FROM course_requirements WHERE id = ?").get(reqRow.id), "后台 req_delete 生效");
  await call("/admin/client/" + sid, form({ action: "reqset_delete", id: String(setRow.id) }), cookie);
  ok(!DB.raw.prepare("SELECT id FROM course_requirement_sets WHERE id = ?").get(setRow.id), "后台 reqset_delete 生效");
  // trail_delete + problem_delete
  await call("/admin/client/" + sid, form({ action: "trail_delete", id: String(t2.id) }), cookie);
  ok(!DB.raw.prepare("SELECT id FROM mentor_trail_entries WHERE id = ?").get(t2.id), "后台 trail_delete 生效");
  await call("/admin/client/" + sid, form({ action: "problem_delete", id: String(probA) }), cookie);
  ok(!DB.raw.prepare("SELECT id FROM student_problem_shares WHERE id = ?").get(probA), "后台 problem_delete 生效");
}

// ============ 删除级联 ============
section("删除学生：v12 四表级联清理");
{
  const r2 = await (await imp({ student: { name: "V12Del", slug: "v12-del" } })).json();
  const sid2 = r2.student_id;
  await enr({
    student: { slug: "v12-del" },
    trail_entries: [{ mentor_name: "主导师", spirit_line: "待删轨迹" }],
    requirement_sets: [{ name: "待删集", requirements: [{ course_code: "X 1" }] }],
  });
  await postProblem({ s: "v12-del", key: r2.client_key, domain: "study", title: "待删问题" });
  const loginRes = await call("/admin/login", form({ password: "test-pw" }));
  const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];
  await call("/admin/delivery", form({ action: "delete", id: String(sid2) }), cookie);
  for (const tb of ["student_problem_shares", "mentor_trail_entries", "course_requirement_sets", "course_requirements"]) {
    const n = DB.raw.prepare("SELECT COUNT(*) AS n FROM " + tb + " WHERE student_id = ?").get(sid2).n;
    ok(n === 0, "删除后 " + tb + " 无残留");
  }
  const alive = await getClient("v12-fix", ckey);
  ok(alive.ok === true && alive.course_match.length === 2, "其他学生 v12 数据不受影响");
}

console.log("\n==== smoke-v12: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
