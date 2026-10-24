// TransferOS 管理后台 2026-10-24 快捷添加页测试：GET /admin/quick-add 与三路写入。
// 覆盖：未登录重定向登录页；页面含三表单；导师添加（工号自动生成 + back 指回快捷页）；
// 学生添加（back 指回快捷页）；家长开通（生成 parent_key + 结果页含专属链接）；
// back 外链被拒绝回落默认页。
// 运行：node tests/quick-add-20261024.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
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
const env = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123" };
const BASE = "https://admin.test";
const ctx = { promises: [], waitUntil(p) { this.promises.push(Promise.resolve(p)); } };
const COOKIE = "tog_admin=" + createHmac("sha256", "test-pw").update("transferos-admin-session-v1").digest("hex");
async function call(path, opts = {}) {
  const req = new Request(BASE + path, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
  return worker.fetch(req, env, ctx);
}
async function authed(path, form) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  return call(path, { method: "POST", headers: { Cookie: COOKIE }, body: fd });
}

// 先触发一次 ensureSchema（建表），再开始测后台页。
await call("/api/mentor/forward", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

section("页面与登录门禁");
const noAuth = await call("/admin/quick-add");
ok(noAuth.status === 303 && (noAuth.headers.get("Location") || "").includes("/admin/login"), "未登录重定向登录页");
const page = await call("/admin/quick-add", { headers: { Cookie: COOKIE } });
const pageText = await page.text();
ok(page.status === 200 && pageText.includes("添加导师") && pageText.includes("添加学生") && pageText.includes("开通家长端"), "页面含三表单");
ok(pageText.includes('href="/admin/quick-add"'), "导航含快捷添加");

section("添加导师（复用 postStaff）");
const m1 = await authed("/admin/staff", { action: "add", kind: "mentor", name: "快捷导师", specialty: "创业辅导", contact_email: "m@example.com", notify_channel: "email", mentor_status: "registered", back: "/admin/quick-add?ok=mentor" });
ok(m1.status === 303 && m1.headers.get("Location") === "/admin/quick-add?ok=mentor", "导师添加后指回快捷页");
const mentor = DB.raw.prepare(`SELECT * FROM staff WHERE name='快捷导师'`).get();
ok(mentor && mentor.emp_no === "EMP-001" && mentor.kind === "mentor" && mentor.mentor_status === "registered", "导师行工号自动生成、类型与状态正确");
const okPage = await call("/admin/quick-add?ok=mentor", { headers: { Cookie: COOKIE } });
const okText = await okPage.text();
ok(okText.includes("已添加导师") && okText.includes("快捷导师") && okText.includes("mentor.html?s=EMP-001") && okText.includes("k=mk_"), "结果横幅含导师工作台链接");

section("添加学生（复用 postDelivery）");
const s1 = await authed("/admin/delivery", { action: "add", name: "快捷学生", package: "全程打包", stage: "planning", back: "/admin/quick-add?ok=student" });
ok(s1.status === 303 && s1.headers.get("Location") === "/admin/quick-add?ok=student", "学生添加后指回快捷页");
const stu = DB.raw.prepare(`SELECT * FROM students WHERE name='快捷学生'`).get();
ok(stu && stu.stage === "planning", "学生行阶段正确");
const okStu = await call("/admin/quick-add?ok=student", { headers: { Cookie: COOKIE } });
const okStuText = await okStu.text();
ok(okStuText.includes("已添加学生") && okStuText.includes("快捷学生"), "结果横幅含新学生");

section("开通家长端");
const p1 = await authed("/admin/quick-add", { action: "parent_enable", student_id: String(stu.id) });
ok(p1.status === 303 && p1.headers.get("Location") === "/admin/quick-add?parent=" + stu.id, "家长开通后指回结果页");
const stu2 = DB.raw.prepare(`SELECT parent_key FROM students WHERE id=?`).get(stu.id);
ok(stu2 && stu2.parent_key && String(stu2.parent_key).startsWith("pk_"), "家长密钥已生成");
const pPage = await call("/admin/quick-add?parent=" + stu.id, { headers: { Cookie: COOKIE } });
const pText = await pPage.text();
ok(pText.includes("家长端已开通") && pText.includes("parent.html?s=") && pText.includes(stu2.parent_key), "结果页含家长专属链接");

section("back 防开放重定向");
const evil = await authed("/admin/staff", { action: "add", kind: "mentor", name: "外链导师", back: "https://evil.example/x" });
ok(evil.status === 303 && evil.headers.get("Location") === "/admin/staff", "外链 back 回落默认页");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
