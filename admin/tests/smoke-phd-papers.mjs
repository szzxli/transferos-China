// TransferOS 管理后台 博士论文规划冒烟测试。
// 覆盖：phdPaperSummary 投稿口径（已投稿/返修/已接受才计入，在写不计，已放弃排除）、
// 论文增改删经后台表单走通并下发学生端、毕业卡期刊/会议“当前”自动汇总、
// transfer 学生提交论文动作被忽略且 phd 仍为 null。运行：node tests/smoke-phd-papers.mjs
import { DatabaseSync } from "node:sqlite";
import worker, { phdPaperSummary } from "/home/hatch/workspace/transferos-global/admin/src/index.js";
class Stmt { constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; } bind(...a) { this.args = a; return this; } async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid) } }; } async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args) }; } async first() { const row = this.db.prepare(this.sql).get(...this.args); return row === undefined ? null : row; } }
class D1Shim { constructor() { this.raw = new DatabaseSync(":memory:"); } prepare(sql) { return new Stmt(this.raw, sql); } }
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log("  PASS " + l); } else { fail++; console.log("  FAIL " + l); } };
const DB = new D1Shim(); const env = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123" }; const BASE = "https://admin.test";
const call = (path, opts = {}) => worker.fetch(new Request(BASE + path, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body }), env);
const jsonPost = (o, t) => ({ method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: JSON.stringify(o) });
const imp = (b) => call("/api/admin/students/import", jsonPost(b, "tok-123")).then(r => r.json());
const getClient = (loc, key) => call("/api/client/" + loc + "?key=" + key).then(r => r.json());

// pure: 投稿口径
const sum = phdPaperSummary([
  { paper_type: "journal", status: "draft" },
  { paper_type: "journal", status: "submitted" },
  { paper_type: "conference", status: "revision" },
  { paper_type: "conference", status: "dropped" },
  { paper_type: "conference", status: "accepted" },
]);
ok(sum.journal.submitted === 1 && sum.journal.in_progress === 1 && sum.journal.accepted === 0, "投稿口径：期刊 在写1/已投稿1/已接受0");
ok(sum.conference.submitted === 2 && sum.conference.accepted === 1 && sum.conference.total === 2, "投稿口径：会议 已投稿2（含返修+已接受），已放弃不计入总数");
ok(sum.totalSubmitted === 3 && sum.firstSubmitted === true, "投稿口径：合计已投稿3，第一篇一作已投稿");
ok(phdPaperSummary([{ paper_type: "journal", status: "idea" }]).firstSubmitted === false, "投稿口径：在写不算第一篇投稿");

// phd student + papers via admin form
const ph = await imp({ student: { name: "论文博士生", slug: "phdpapers", program_template: "phd" }, courses: [{ term: "2026-Fall", course_code: "CSCI 500", credits: 9, kind: "grad_course", status: "done" }] });
ok(ph.ok && ph.student_id, "博士生导入成功");
const loginRes = await call("/admin/login", { method: "POST", body: (() => { const f = new FormData(); f.append("password", "test-pw"); return f; })() });
const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];
ok(loginRes.status === 303 && cookie, "后台登录拿到 cookie");
const postForm = (sid, fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return call("/admin/client/" + sid, { method: "POST", headers: { Cookie: cookie }, body: f }); };
const addPaper = (sid, fields) => postForm(sid, { action: "phd_paper_add", ...fields });
ok((await addPaper(ph.student_id, { title: "EPA 方向初探", paper_type: "journal", target_venue: "", status: "draft", next_step: "完成实验", due_text: "2027-03" })).status === 303, "论文新增：期刊在写");
ok((await addPaper(ph.student_id, { title: "会议首篇", paper_type: "conference", target_venue: "安全会议", status: "submitted", next_step: "等返修", due_text: "" })).status === 303, "论文新增：会议已投稿");
ok((await addPaper(ph.student_id, { title: "放弃方向", paper_type: "conference", target_venue: "", status: "dropped", next_step: "", due_text: "" })).status === 303, "论文新增：已放弃");
let c1 = await getClient("phdpapers", ph.client_key);
ok(c1.ok && c1.phd && c1.phd.papers && c1.phd.papers.summary.journal.submitted === 0 && c1.phd.papers.summary.journal.in_progress === 1, "学生端：期刊在写不计投稿");
ok(c1.phd.papers.summary.conference.submitted === 1 && c1.phd.papers.summary.totalSubmitted === 1 && c1.phd.papers.summary.firstSubmitted === true, "学生端：会议已投稿计入，第一篇已投稿");
ok(c1.phd.papers.list.length === 3 && c1.phd.papers.list[1].paper_type_label.includes("会议") && c1.phd.papers.list[1].status_label === "已投稿", "学生端：论文清单类型与状态标签正确");
const adminHtml = await call("/admin/client/" + ph.student_id, { headers: { Cookie: cookie } }).then(r => r.text());
ok(adminHtml.includes("论文规划 · 一作投稿管线") && adminHtml.includes("EPA 方向初探"), "博士后台页：论文规划卡与论文出现");
ok(adminHtml.includes("已投稿 1 / 2（已接受 0）"), "博士后台页：毕业卡会议当前自动汇总为已投稿 1/2");
// update draft -> submitted, then delete submitted conference
const p1 = c1.phd.papers.list[0], p2 = c1.phd.papers.list[1];
ok((await postForm(ph.student_id, { action: "phd_paper_update", id: String(p1.id), title: "EPA 方向初探", paper_type: "journal", target_venue: "", status: "submitted", next_step: "等返修", due_text: "2027-05" })).status === 303, "论文修改：在写改已投稿");
let c2 = await getClient("phdpapers", ph.client_key);
ok(c2.phd.papers.summary.journal.submitted === 1 && c2.phd.papers.summary.totalSubmitted === 2, "学生端：修改后期刊投稿数更新");
ok((await postForm(ph.student_id, { action: "phd_paper_delete", id: String(p2.id) })).status === 303, "论文删除");
let c3 = await getClient("phdpapers", ph.client_key);
ok(c3.phd.papers.list.length === 2 && c3.phd.papers.summary.conference.total === 0, "学生端：删除后清单与汇总同步（已放弃不计总数）");
// transfer student: paper action ignored, phd stays null
const tr = await imp({ student: { name: "论文转学生", slug: "phdpaperstr" }, courses: [{ term: "2026-Fall", course_code: "BIO 181", credits: 4, kind: "prereq", status: "done" }] });
ok((await addPaper(tr.student_id, { title: "不应写入", paper_type: "journal", status: "submitted" })).status === 303, "转学生提交论文动作返回重定向（被忽略）");
const trClient = await getClient("phdpaperstr", tr.client_key);
ok(trClient.ok && trClient.phd === null, "转学生只读接口：phd 仍为 null，论文未下发");
const trHtml = await call("/admin/client/" + tr.student_id, { headers: { Cookie: cookie } }).then(r => r.text());
ok(!trHtml.includes("论文规划 · 一作投稿管线"), "转学生后台页：无论文规划卡");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
