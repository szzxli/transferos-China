// TransferOS 管理后台 2026-10-24 导师轻量改进：转给创始人接口测试。
// 覆盖：专题导师学生通道转发成功（创始人发件箱 + 邮箱自动发信 + 摘要含姓名/阶段/原文）；
// 创始人本人转发拒（is_founder）；错钥 404；专题导师 parent 通道 404；无关系学生 404。
// 运行：node tests/forward-20261024.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
import { DatabaseSync } from "node:sqlite";
import worker from "./worker.mjs";

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
const env = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123", RESEND_API_KEY: "re_test" };
const BASE = "https://admin.test";
const ctx = { promises: [], waitUntil(p) { this.promises.push(Promise.resolve(p)); } };
async function call(path, opts = {}, e = env) {
  const req = new Request(BASE + path, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
  return worker.fetch(req, e, ctx);
}

// Resend 桩：只拦截 api.resend.com，其余走原 fetch（测试不触网）。
const resendCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.resend.com")) {
    resendCalls.push({ url: String(url), body: opts && opts.body ? String(opts.body) : "" });
    return new Response(JSON.stringify({ id: "re_test1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, opts);
};

// ===== 造数：先触发一次 ensureSchema，再补导师密钥/渠道列 =====
await call("/api/mentor/forward", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
const db = DB.raw;
db.prepare(`INSERT INTO staff(name, emp_no, kind) VALUES('李军','EMP-001','human')`).run();
db.prepare(`INSERT INTO staff(name, emp_no, kind) VALUES('专题导师','EMP-002','human')`).run();
db.prepare(`UPDATE staff SET mentor_key='mk_founder', notify_channel='email', contact_email='founder@example.com', mentor_status='verified' WHERE emp_no='EMP-001'`).run();
db.prepare(`UPDATE staff SET mentor_key='mk_topic', notify_channel='email', contact_email='topic@example.com', mentor_status='verified' WHERE emp_no='EMP-002'`).run();
const founder = db.prepare(`SELECT id FROM staff WHERE emp_no='EMP-001'`).get();
const topic = db.prepare(`SELECT id FROM staff WHERE emp_no='EMP-002'`).get();
db.prepare(`INSERT INTO students(name, stage, mentor_id) VALUES('转发学生','planning', ?)`).run(founder.id);
const stu = db.prepare(`SELECT id FROM students WHERE name='转发学生'`).get();
db.prepare(`INSERT INTO student_topic_mentors(student_id, staff_id, topic) VALUES(?, ?, '创业辅导')`).run(stu.id, topic.id);
db.prepare(`INSERT INTO student_messages(student_id, sender, body, created_at, read_by_student, read_by_mentor, mentor_id) VALUES(?, 'student', '最近创业方向有点卡，想聊聊', '2026-10-24T10:00:00Z', 0, 0, ?)`).run(stu.id, topic.id);
db.prepare(`INSERT INTO parent_messages(student_id, sender, body, created_at, read_by_parent, read_by_mentor) VALUES(?, 'parent', '家长想问进度', '2026-10-24T10:05:00Z', 0, 0)`).run(stu.id);

async function forward(body) {
  const r = await call("/api/mentor/forward", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
}

section("专题导师学生通道转发");
const f1 = await forward({ s: "EMP-002", key: "mk_topic", student_id: stu.id, channel: "student" });
ok(f1.status === 200 && f1.j && f1.j.ok === true && f1.j.outbox_id, "转发成功返回 outbox_id");
const ob = db.prepare(`SELECT * FROM notifications_outbox WHERE id = ?`).get(f1.j.outbox_id);
ok(ob && ob.mentor_staff_id === founder.id && ob.event_type === "mentor_forwarded", "发件箱归属创始人、事件类型正确");
ok(ob && String(ob.summary).includes("转发学生") && String(ob.summary).includes("课程规划") && String(ob.summary).includes("最近创业方向有点卡"), "摘要含学生姓名/阶段/留言原文");
ok(ob && ob.status === "sent", "创始人邮箱渠道自动发信，状态已转达");
ok(resendCalls.length === 1 && resendCalls[0].body.includes("founder@example.com"), "Resend 恰一封发往创始人邮箱");
const ml = db.prepare(`SELECT * FROM mail_log WHERE outbox_id = ?`).get(f1.j.outbox_id);
ok(ml && ml.status === "sent", "mail_log 记 sent");

section("拒绝口径");
const f2 = await forward({ s: "EMP-001", key: "mk_founder", student_id: stu.id, channel: "student" });
ok(f2.status === 400 && f2.j && f2.j.error === "is_founder", "创始人本人转发拒 is_founder");
const f3 = await forward({ s: "EMP-002", key: "mk_wrong", student_id: stu.id, channel: "student" });
ok(f3.status === 404, "错钥 404");
const f4 = await forward({ s: "EMP-002", key: "mk_topic", student_id: stu.id, channel: "parent" });
ok(f4.status === 404, "专题导师 parent 通道 404");
const f5 = await forward({ s: "EMP-002", key: "mk_topic", student_id: 9999, channel: "student" });
ok(f5.status === 404, "无关系学生 404");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
