// TransferOS 管理后台 2026-10-24 手动发信接口测试：POST /api/admin/mail/send。
// 覆盖：Bearer 鉴权成功发送（默认发件人 info@ + mail_log sent）；MAIL_FROM 覆盖
// （support@ 切换路径）；无鉴权 401；坏邮箱 400；空标题/空正文 400；无密钥 503。
// 运行：node tests/mail-send-20261024.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
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
const ctx = { promises: [], waitUntil(p) { this.promises.push(Promise.resolve(p)); } };
const resendCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.resend.com")) {
    resendCalls.push({ body: opts && opts.body ? String(opts.body) : "" });
    return new Response(JSON.stringify({ id: "re_ms1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, opts);
};
async function call(path, opts = {}, e) {
  const req = new Request(BASE + path, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
  return worker.fetch(req, e, ctx);
}
const env = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123", RESEND_API_KEY: "re_test" };
const AUTH = { Authorization: "Bearer tok-123", "Content-Type": "application/json" };

section("成功发送（默认 info@）");
const r1 = await call("/api/admin/mail/send", { method: "POST", headers: AUTH,
  body: JSON.stringify({ to: "mentor@example.com", subject: "手动测试", text: "正文内容" }) }, env);
const j1 = await r1.json().catch(() => null);
ok(r1.status === 200 && j1 && j1.ok === true && j1.to === "mentor@example.com", "发送成功返回 ok + 收件人");
ok(resendCalls.length === 1 && resendCalls[0].body.includes("info@zhuanuc.com")
  && resendCalls[0].body.includes("mentor@example.com") && resendCalls[0].body.includes("手动测试"), "Resend 请求发件人默认 info@、收件人与标题正确");
const ml = DB.raw.prepare(`SELECT * FROM mail_log ORDER BY id DESC LIMIT 1`).get();
ok(ml && ml.status === "sent" && ml.to_addr === "mentor@example.com", "mail_log 记 sent");

section("MAIL_FROM 覆盖（support@ 切换路径）");
const env2 = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123", RESEND_API_KEY: "re_test", MAIL_FROM: "TransferOS <support@zhuanuc.com>" };
const r2 = await call("/api/admin/mail/send", { method: "POST", headers: AUTH,
  body: JSON.stringify({ to: "mentor2@example.com", subject: "切换测试", text: "正文" }) }, env2);
const j2 = await r2.json().catch(() => null);
ok(r2.status === 200 && j2 && j2.ok === true, "覆盖环境下发送成功");
ok(resendCalls.length === 2 && resendCalls[1].body.includes("support@zhuanuc.com"), "MAIL_FROM 覆盖发件人生效");

section("拒绝口径");
const r3 = await call("/api/admin/mail/send", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ to: "a@b.com", subject: "x", text: "y" }) }, env);
ok(r3.status === 401, "无鉴权 401");
const r4 = await call("/api/admin/mail/send", { method: "POST", headers: AUTH,
  body: JSON.stringify({ to: "not-an-email", subject: "x", text: "y" }) }, env);
ok(r4.status === 400, "坏邮箱 400");
const r5 = await call("/api/admin/mail/send", { method: "POST", headers: AUTH,
  body: JSON.stringify({ to: "a@b.com", subject: "", text: "y" }) }, env);
ok(r5.status === 400, "空标题 400");
const r6 = await call("/api/admin/mail/send", { method: "POST", headers: AUTH,
  body: JSON.stringify({ to: "a@b.com", subject: "x", text: "" }) }, env);
ok(r6.status === 400, "空正文 400");
const envNoKey = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123" };
const r7 = await call("/api/admin/mail/send", { method: "POST", headers: AUTH,
  body: JSON.stringify({ to: "a@b.com", subject: "x", text: "y" }) }, envNoKey);
ok(r7.status === 503, "无密钥 503");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
