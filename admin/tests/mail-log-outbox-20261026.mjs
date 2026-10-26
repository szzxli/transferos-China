// TransferOS 管理后台 2026-10-26 导师通知页发信记录：/admin/outbox 下加独立
// 「发信记录」表（读 mail_log），与事件发件箱分开两张表、不混状态。
// 覆盖：发件箱段 intact；新段呈现；收件邮箱匹配导师档案时显示姓名+工号，
// 匹配不上显示邮箱原文；手动/旁路与事件通知来源区分；已发出/失败状态区分；
// 手动发信标题只出现在发信记录段、不混入发件箱段。
// 运行：node tests/mail-log-outbox-20261026.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
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
const BASE = "https://admin.test";
const env = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123", RESEND_API_KEY: "re_test" };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.resend.com")) {
    return new Response(JSON.stringify({ id: "re_seed" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, opts);
};
async function call(path, opts = {}, cookie) {
  const headers = new Headers(opts.headers || {});
  if (cookie) headers.set("Cookie", cookie);
  const req = new Request(BASE + path, { method: opts.method || "GET", headers, body: opts.body });
  return worker.fetch(req, env);
}
const form = (obj) => {
  const b = new URLSearchParams(obj);
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: b.toString() };
};

// 建表：走一次 mail/send 触发 ensureSchema（Resend 已 mock）
const seed = await call("/api/admin/mail/send", {
  method: "POST",
  headers: { Authorization: "Bearer tok-123", "Content-Type": "application/json" },
  body: JSON.stringify({ to: "bootstrap@example.com", subject: "建表", text: "x" }),
});
ok(seed.status === 200, "mail/send 建表成功");
DB.raw.prepare(`DELETE FROM mail_log`).run();

// 种子：导师 Elaine（邮箱匹配）+ 发件箱事件行 + 三条发信记录
DB.raw.prepare(`INSERT INTO staff(name, kind, emp_no, contact_email, mentor_status)
  VALUES('Elaine Sun', 'mentor', 'EMP-004', 'elaine@example.com', '已登记')`).run();
const staffId = DB.raw.prepare(`SELECT id FROM staff WHERE emp_no = 'EMP-004'`).get().id;
DB.raw.prepare(`INSERT INTO notifications_outbox(mentor_staff_id, student_id, channel, event_type, summary, status, created_at)
  VALUES(?, 0, 'email', 'student_message', '学生留言待转达', 'queued', '2026-10-26T10:00:00Z')`).run(staffId);
const obId = DB.raw.prepare(`SELECT id FROM notifications_outbox ORDER BY id DESC LIMIT 1`).get().id;
DB.raw.prepare(`INSERT INTO mail_log(outbox_id, to_addr, subject, status, error, created_at)
  VALUES(NULL, 'elaine@example.com', 'TransferOS 导师工作台链接', 'sent', NULL, '2026-10-26T11:00:00Z')`).run();
DB.raw.prepare(`INSERT INTO mail_log(outbox_id, to_addr, subject, status, error, created_at)
  VALUES(NULL, 'unknown@example.com', '手动测试失败信', 'failed', 'resend 500', '2026-10-26T11:05:00Z')`).run();
DB.raw.prepare(`INSERT INTO mail_log(outbox_id, to_addr, subject, status, error, created_at)
  VALUES(?, 'elaine@example.com', '学生留言通知', 'sent', NULL, '2026-10-26T10:05:00Z')`).run(obId);

const loginRes = await call("/admin/login", form({ password: "test-pw" }));
const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
ok(cookie.includes("tog_admin"), "后台登录成功");
const page = await (await call("/admin/outbox", {}, cookie)).text();

section("两张表分开呈现");
ok(page.includes("导师通知发件箱") && page.includes("学生留言待转达"), "发件箱段 intact");
ok(page.includes("发信记录"), "发信记录段呈现");
ok(page.indexOf("学生留言待转达") < page.indexOf("发信记录"), "发件箱在上、发信记录在下");
ok(page.indexOf("发信记录") < page.indexOf("TransferOS 导师工作台链接"), "手动发信标题只在发信记录段");

section("收件人匹配与状态/来源");
ok(page.includes("Elaine Sun（EMP-004）"), "匹配导师档案显示姓名+工号");
ok(page.includes("unknown@example.com"), "匹配不上显示邮箱原文");
ok(page.includes("已发出") && page.includes("失败") && page.includes("resend 500"), "已发出/失败状态与错误呈现");
ok(page.includes("手动/旁路") && page.includes("事件通知"), "手动与事件来源区分");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
