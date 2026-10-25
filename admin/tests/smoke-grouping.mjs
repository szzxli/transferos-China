// TransferOS 管理后台 v20 客户端页分组折叠冒烟测试。
// 覆盖：今天组置顶且默认展开、记录/对外/设置组默认折叠、家长沟通在今天组、
// 家长更新在对外组、密钥/模板/签名在设置组、页顶四组固定导航存在。
// 运行：node tests/smoke-grouping.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
import { DatabaseSync } from "node:sqlite";
import worker from "./worker.mjs";

class Stmt { constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; } bind(...a) { this.args = a; return this; } async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid) } }; } async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args) }; } async first() { const row = this.db.prepare(this.sql).get(...this.args); return row === undefined ? null : row; } }
class D1Shim { constructor() { this.raw = new DatabaseSync(":memory:"); } prepare(sql) { return new Stmt(this.raw, sql); } }

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log("  PASS " + l); } else { fail++; console.log("  FAIL " + l); } };
const DB = new D1Shim();
const env = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123" };
const BASE = "https://admin.test";
const call = (path, opts = {}) => worker.fetch(new Request(BASE + path, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body }), env);
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return { method: "POST", body: f }; };

await call("/api/client/files?s=x&key=y");
const loginRes = await call("/admin/login", form({ password: "test-pw" }));
const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];
const db = DB.raw;
db.prepare(`INSERT INTO students(name, slug) VALUES('分组学生','grpstu')`).run();
const stu = db.prepare(`SELECT id FROM students WHERE slug='grpstu'`).get();
const page = await (await call("/admin/client/" + stu.id, { headers: { Cookie: cookie } })).text();

const idx = (s) => page.indexOf(s);
ok(idx('id="grp-today"') >= 0 && idx('id="grp-record"') >= 0 && idx('id="grp-out"') >= 0 && idx('id="grp-settings"') >= 0, "四组锚点齐全");
ok(idx('id="grp-today"') < idx('id="grp-record"') && idx('id="grp-record"') < idx('id="grp-out"') && idx('id="grp-out"') < idx('id="grp-settings"'), "组顺序：今天 → 记录 → 对外 → 设置");
ok(page.includes('<details class="card" id="grp-today" open>'), "今天组默认展开");
ok(!page.includes('<details class="card" id="grp-record" open>') && !page.includes('<details class="card" id="grp-out" open>') && !page.includes('<details class="card" id="grp-settings" open>'), "记录/对外/设置组默认折叠");
ok(idx("导师沟通") > idx('id="grp-today"') && idx("导师沟通") < idx('id="grp-record"'), "导师沟通在今天组");
ok(idx("家长沟通") > idx('id="grp-today"') && idx("家长沟通") < idx('id="grp-record"'), "家长沟通在今天组");
ok(idx("家长端（家长更新）") > idx('id="grp-out"') && idx("家长端（家长更新）") < idx('id="grp-settings"'), "家长更新在对外组");
ok(idx("导师寄语与愿景") > idx('id="grp-out"') && idx("导师寄语与愿景") < idx('id="grp-settings"'), "导师寄语在对外组");
ok(idx("专属签名") > idx('id="grp-settings"'), "专属签名在设置组");
ok(idx("切换模板") > idx('id="grp-settings"'), "模板切换在设置组");
ok(page.includes("position:sticky") && page.includes('#grp-today') && page.includes('#grp-settings'), "页顶四组固定导航存在");
ok(page.indexOf("<h2>选课规划") > idx('id="grp-record"') && page.indexOf("<h2>选课规划") < idx('id="grp-out"'), "选课规划在记录组");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
