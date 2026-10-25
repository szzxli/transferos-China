// TransferOS 页内二次确认冒烟测试：仅生成/重置访问密钥与删除学生档案两处。
// 覆盖：两处按钮不再含原生 confirm() 文案、含页内二次确认文案（确认生成？/确认删除？）、
// 服务端 key_rotate 仍生成密钥、服务端学生删除仍删档；其余表单的原生确认框未动。
// 运行：node tests/smoke-confirm-buttons.mjs
import { DatabaseSync } from "node:sqlite";
import worker from "/home/hatch/workspace/transferos-global/admin/src/index.js";
import { readFileSync } from "node:fs";
const SRC = readFileSync("/home/hatch/workspace/transferos-global/admin/src/index.js", "utf8");
class Stmt { constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; } bind(...a) { this.args = a; return this; } async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid) } }; } async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args) }; } async first() { const row = this.db.prepare(this.sql).get(...this.args); return row === undefined ? null : row; } }
class D1Shim { constructor() { this.raw = new DatabaseSync(":memory:"); } prepare(sql) { return new Stmt(this.raw, sql); } }
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log("  PASS " + l); } else { fail++; console.log("  FAIL " + l); } };
const DB = new D1Shim(); const env = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123" }; const BASE = "https://admin.test";
const call = (path, opts = {}) => worker.fetch(new Request(BASE + path, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body }), env);
const jsonPost = (o, t) => ({ method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: JSON.stringify(o) });
const imp = (b) => call("/api/admin/students/import", jsonPost(b, "tok-123")).then(r => r.json());
const st = await imp({ student: { name: "确认按钮学生", slug: "confirmbtn" }, courses: [] });
ok(st.ok && st.student_id, "学生导入成功");
const loginRes = await call("/admin/login", { method: "POST", body: (() => { const f = new FormData(); f.append("password", "test-pw"); return f; })() });
const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];
ok(loginRes.status === 303 && cookie, "后台登录拿到 cookie");
const adminGet = (path) => call(path, { headers: { Cookie: cookie } }).then(r => r.text());
const postForm = (path, fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return call(path, { method: "POST", headers: { Cookie: cookie }, body: f }); };
const clientHtml = await adminGet("/admin/client/" + st.student_id);
ok(clientHtml.includes("确认重置？") && clientHtml.includes("重置密钥"), "客户端页：已有密钥学生按钮为重置二次确认（导入即带密钥，故初始不是生成）");
ok(SRC.includes("确认生成？") && SRC.includes("确认重置？"), "源码：密钥按钮生成/重置两种二次确认文案都在");
ok(!clientHtml.includes("确定生成访问密钥？"), "客户端页：密钥按钮不再含原生确认文案");
const deliveryHtml = await adminGet("/admin/delivery");
ok(deliveryHtml.includes("确认删除？"), "交付页：学生删除按钮含页内二次确认文案");
ok(!deliveryHtml.includes("确定删除这条学生档案？"), "交付页：学生删除按钮不再含原生确认文案");
ok(SRC.includes("确定删除这条线索？") && !SRC.includes("确定删除这条学生档案？"), "源码：其余表单原生确认框未动（线索删除仍在），学生删除原生确认已去掉");
// 服务端动作不变：key_rotate 生成密钥
ok((await postForm("/admin/client/" + st.student_id, { action: "key_rotate" })).status === 303, "key_rotate 服务端提交重定向");
const clientHtml2 = await adminGet("/admin/client/" + st.student_id);
ok(clientHtml2.includes("访问密钥：") && clientHtml2.includes("确认重置？"), "key_rotate 后页面显示密钥，按钮变重置二次确认");
// 服务端动作不变：交付页删除学生
ok((await postForm("/admin/delivery", { action: "delete", id: String(st.student_id) })).status === 303, "学生删除服务端提交重定向");
const deliveryHtml2 = await adminGet("/admin/delivery");
ok(!deliveryHtml2.includes("确认按钮学生"), "学生删除后交付页不再列出该生");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
