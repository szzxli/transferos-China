// TransferOS 管理后台 博士模板冒烟测试。
// 覆盖：两模板课程类别互不串、博士只读接口 phd 字段与 GQE 窗口、转学生 phd 为 null、
// 后台博士页出现毕业需求卡而转学生页不出现、毕业检查写入下发。运行：node tests/smoke-phd-template.mjs
import { DatabaseSync } from "node:sqlite";
import worker, { phdCourseProgress, courseKindsFor } from "/home/hatch/workspace/transferos-global/admin/src/index.js";
class Stmt { constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; } bind(...a) { this.args = a; return this; } async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid) } }; } async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args) }; } async first() { const row = this.db.prepare(this.sql).get(...this.args); return row === undefined ? null : row; } }
class D1Shim { constructor() { this.raw = new DatabaseSync(":memory:"); } prepare(sql) { return new Stmt(this.raw, sql); } }
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log("  PASS " + l); } else { fail++; console.log("  FAIL " + l); } };
const DB = new D1Shim(); const env = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123" }; const BASE = "https://admin.test";
const call = (path, opts = {}) => worker.fetch(new Request(BASE + path, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body }), env);
const jsonPost = (o, t) => ({ method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: JSON.stringify(o) });
const imp = (b) => call("/api/admin/students/import", jsonPost(b, "tok-123")).then(r => r.json());
const getClient = (loc, key) => call("/api/client/" + loc + "?key=" + key).then(r => r.json());

// pure
const pp = phdCourseProgress([{ kind: "grad_course", credits: 9, status: "done" }, { kind: "dissertation", credits: 9, status: "done" }, { kind: "seminar", credits: 3, status: "planned" }]);
ok(pp.creditsDone === 18 && pp.gqe_window === "in_window" && pp.comprehensive_window === "not_yet" && pp.byKind.grad_course.target === 15, "phdCourseProgress: 18学分 GQE窗口内，目标15/24/3/18");
ok(courseKindsFor("transfer").prereq && !courseKindsFor("transfer").grad_course && courseKindsFor("phd").grad_course && !courseKindsFor("phd").prereq, "courseKindsFor: 两模板类别互不串");

// transfer student (Richa-like): default template, phd null
const tr = await imp({ student: { name: "V17转学生", slug: "v17transfer" }, courses: [{ term: "2026-Fall", course_code: "BIO 181", course_name: "生物", credits: 4, kind: "prereq", status: "done" }] });
ok(tr.ok && tr.student_id, "转学生导入成功");
const trClient = await getClient("v17transfer", tr.client_key);
ok(trClient.ok && trClient.student.program_template === "transfer" && trClient.phd === null, "转学生只读接口：模板transfer，phd为null");
ok(trClient.courses.progress.prereqDone === 1, "转学生汇总：先修完成数不变");

// phd student
const ph = await imp({ student: { name: "V17博士生", slug: "v17phd", program_template: "phd" }, courses: [
  { term: "2026-Fall", course_code: "CSCI 500", course_name: "研究生课", credits: 9, kind: "grad_course", status: "done" },
  { term: "2026-Fall", course_code: "CSCI 999", course_name: "论文研究", credits: 9, kind: "dissertation", status: "done" },
  { term: "2027-Spring", course_code: "EECS 500", course_name: "研讨", credits: 3, kind: "seminar", status: "planned" },
]});
ok(ph.ok && ph.student_id, "博士生导入成功");
const phClient = await getClient("v17phd", ph.client_key);
ok(phClient.ok && phClient.student.program_template === "phd" && phClient.phd && phClient.phd.progress.creditsDone === 18 && phClient.phd.progress.gqe_window === "in_window", "博士生只读接口：phd字段、18学分、GQE窗口内");
ok(phClient.phd.requirements.credits_target_total === 60 && phClient.phd.requirements.gqe_window.includes("27"), "博士生只读接口：毕业需求口径60学分/GQE窗口");
ok(phClient.courses.list.find(c => c.kind === "dissertation").kind_label.includes("CSCI 999"), "博士课程类别标签正确");

// kind cross-contamination rejected
const badPh = await imp({ student: { name: "V17博士错类", slug: "v17badph", program_template: "phd" }, courses: [{ term: "2026-Fall", course_code: "BIO 181", credits: 4, kind: "prereq", status: "planned" }] });
ok(badPh.ok === false, "博士模板拒绝转学类别 prereq");
const badTr = await imp({ student: { name: "V17转学错类", slug: "v17badtr" }, courses: [{ term: "2026-Fall", course_code: "CSCI 999", credits: 9, kind: "dissertation", status: "planned" }] });
ok(badTr.ok === false, "转学模板拒绝博士类别 dissertation");

// admin HTML: login -> cookie -> client pages
const loginRes = await call("/admin/login", { method: "POST", body: (() => { const f = new FormData(); f.append("password", "test-pw"); return f; })() });
const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];
ok(loginRes.status === 303 && cookie, "后台登录拿到 cookie");
const adminGet = (path) => call(path, { headers: { Cookie: cookie } }).then(r => r.text());
const phHtml = await adminGet("/admin/client/" + ph.student_id);
ok(phHtml.includes("研究生选课规划") && phHtml.includes("博士毕业需求") && phHtml.includes("研究生课程"), "博士后台页：研究生选课+毕业需求卡出现");
const trHtml = await adminGet("/admin/client/" + tr.student_id);
ok(!trHtml.includes("博士毕业需求 · UND") && trHtml.includes("必修先修"), "转学生后台页：无博士卡（模板切换说明提及除外），仍是原有类别");
ok(phHtml.includes("客户端模板") && trHtml.includes("客户端模板"), "两后台页都有模板切换入口");
// phd check write via admin form
const fd = new FormData(); fd.append("action", "phd_check_set"); fd.append("check_key", "gqe"); fd.append("status", "done"); fd.append("note", "论文清单已指定");
const postRes = await call("/admin/client/" + ph.student_id, { method: "POST", headers: { Cookie: cookie }, body: fd });
ok(postRes.status === 303, "博士毕业检查写入重定向");
const phClient2 = await getClient("v17phd", ph.client_key);
ok((phClient2.phd.checks || []).some(c => c.check_key === "gqe" && c.status === "done"), "博士毕业检查 GQE=done 已下发学生端接口");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
