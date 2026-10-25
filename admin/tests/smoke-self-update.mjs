// TransferOS 学生自填冒烟测试：POST /api/client/self-update。
// 覆盖：课程状态自改且汇总同步、学分等非法字段被忽略、错密钥 404、跨学生改课 404、
// 博士检查/论文学生自填、transfer 学生博士动作 400、非法状态 400。运行：node tests/smoke-self-update.mjs
import { DatabaseSync } from "node:sqlite";
import worker from "/home/hatch/workspace/transferos-global/admin/src/index.js";
class Stmt { constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; } bind(...a) { this.args = a; return this; } async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid) } }; } async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args) }; } async first() { const row = this.db.prepare(this.sql).get(...this.args); return row === undefined ? null : row; } }
class D1Shim { constructor() { this.raw = new DatabaseSync(":memory:"); } prepare(sql) { return new Stmt(this.raw, sql); } }
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log("  PASS " + l); } else { fail++; console.log("  FAIL " + l); } };
const DB = new D1Shim(); const env = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123" }; const BASE = "https://admin.test";
const call = (path, opts = {}) => worker.fetch(new Request(BASE + path, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body }), env);
const jsonPost = (o, t) => ({ method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: JSON.stringify(o) });
const imp = (b) => call("/api/admin/students/import", jsonPost(b, "tok-123")).then(r => r.json());
const getClient = (loc, key) => call("/api/client/" + loc + "?key=" + key).then(r => r.json());
const selfPost = (s, key, body) => call("/api/client/self-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ s, key, ...body }) }).then(async (r) => ({ status: r.status, json: await r.json() }));

const ph = await imp({ student: { name: "自填博士生", slug: "selfphd", program_template: "phd" }, courses: [
  { term: "2026-Fall", course_code: "CSCI 500", course_name: "研究生课", credits: 9, kind: "grad_course", status: "planned" },
  { term: "2027-Spring", course_code: "CSCI 999", course_name: "论文研究", credits: 9, kind: "dissertation", status: "planned" },
]});
const tr = await imp({ student: { name: "自填转学生", slug: "selftr" }, courses: [{ term: "2026-Fall", course_code: "BIO 181", credits: 4, kind: "prereq", status: "planned" }] });
ok(ph.ok && tr.ok, "两学生导入成功");
let c0 = await getClient("selfphd", ph.client_key);
const courseId = c0.courses.list[0].id, trCourseId = (await getClient("selftr", tr.client_key)).courses.list[0].id;
ok(c0.courses.progress.creditsDone === 0, "自填前已修学分 0");

// 课程状态自改 + 非法字段忽略
let r = await selfPost("selfphd", ph.client_key, { action: "course_status", course_id: courseId, status: "done", credits: 999, kind: "dissertation" });
ok(r.status === 200 && r.json.ok && r.json.course.status === "done", "课程状态自改成功");
let c1 = await getClient("selfphd", ph.client_key);
ok(c1.courses.progress.creditsDone === 9 && c1.courses.list[0].credits === 9 && c1.courses.list[0].kind === "grad_course", "汇总同步且学分/类别未被非法字段改动");
// 错密钥、跨学生、非法状态
r = await selfPost("selfphd", "ck_wrong", { action: "course_status", course_id: courseId, status: "done" });
ok(r.status === 404, "错密钥 404");
r = await selfPost("selfphd", ph.client_key, { action: "course_status", course_id: trCourseId, status: "done" });
ok(r.status === 404, "跨学生改课 404");
r = await selfPost("selfphd", ph.client_key, { action: "course_status", course_id: courseId, status: "bogus" });
ok(r.status === 400, "非法课程状态 400");
// 博士检查自填
r = await selfPost("selfphd", ph.client_key, { action: "phd_check", check_key: "gqe", status: "done", note: "学生自报通过" });
ok(r.status === 200 && r.json.ok, "博士检查自填成功");
let c2 = await getClient("selfphd", ph.client_key);
ok((c2.phd.checks || []).some(x => x.check_key === "gqe" && x.status === "done"), "博士检查自填下发");
// 论文学生自填：新增 → 改状态 → 删除
r = await selfPost("selfphd", ph.client_key, { action: "phd_paper_add", title: "学生自填论文", paper_type: "journal", target_venue: "", status: "draft", next_step: "写初稿", due_text: "2027-06", note: "" });
ok(r.status === 200 && r.json.ok && r.json.id, "论文学生自填新增成功");
const pid = r.json.id;
r = await selfPost("selfphd", ph.client_key, { action: "phd_paper_update", id: pid, title: "学生自填论文", paper_type: "journal", target_venue: "期刊X", status: "submitted", next_step: "", due_text: "", note: "" });
ok(r.status === 200 && r.json.ok, "论文学生自填改状态成功");
let c3 = await getClient("selfphd", ph.client_key);
ok(c3.phd.papers.summary.journal.submitted === 1, "论文自填改投稿后汇总同步");
r = await selfPost("selfphd", ph.client_key, { action: "phd_paper_delete", id: pid });
ok(r.status === 200 && r.json.ok, "论文学生自填删除成功");
let c4 = await getClient("selfphd", ph.client_key);
ok(c4.phd.papers.list.length === 0, "论文删除后清单为空");
// transfer 学生：课程可改，博士动作 400
r = await selfPost("selftr", tr.client_key, { action: "course_status", course_id: trCourseId, status: "done" });
ok(r.status === 200 && r.json.ok, "转学生课程状态也可自改");
r = await selfPost("selftr", tr.client_key, { action: "phd_check", check_key: "gqe", status: "done" });
ok(r.status === 400 && r.json.error === "phd_only", "转学生博士检查 400 phd_only");
r = await selfPost("selftr", tr.client_key, { action: "phd_paper_add", title: "不应写入", paper_type: "journal", status: "submitted" });
ok(r.status === 400 && r.json.error === "phd_only", "转学生论文新增 400 phd_only");
let ctr = await getClient("selftr", tr.client_key);
ok(ctr.phd === null, "转学生 phd 仍为 null");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
