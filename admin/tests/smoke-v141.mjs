// TransferOS 管理后台 v14.1 冒烟测试：个性化 manifest API。
// 覆盖：GET /api/manifest/client|parent/<id 或 slug>?key=
//  - 正确密钥 → 200 + application/manifest+json + start_url 带本人凭据（学生 k= / 家长 p=）
//  - 字段与静态 manifest.json / manifest-parent.json 一致（name/theme/display），scope/icons 为绝对 URL
//  - 错钥 / 无钥 / 不存在学生 / 学生↔家长交叉密钥 → 一律 404；POST → 405
// 运行：node tests/smoke-v141.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
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
const env = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123" };
const BASE = "https://admin.test";
async function call(path, opts = {}) {
  const req = new Request(BASE + path, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
  return worker.fetch(req, env);
}
const jsonPost = (obj, token) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
  body: JSON.stringify(obj),
});

// ============ 夹具：一名学生 ============
section("夹具：导入学生");
const imp = await (await call("/api/admin/students/import", jsonPost({ student: { name: "V141学生", slug: "v141a" } }, "tok-123"))).json();
ok(imp.ok === true, "学生导入成功");
const sid = imp.student_id, ck = imp.client_key, pk = imp.parent_key;
ok(!!ck && !!pk && ck !== pk, "client_key / parent_key 已生成且独立");

const APP = "https://zhuanuc.com/one-on-one-app";

// ============ 学生端 manifest ============
section("学生端 manifest：正确密钥");
{
  const r = await call("/api/manifest/client/v141a?key=" + ck);
  ok(r.status === 200, "slug + 正确学生密钥 → 200");
  ok((r.headers.get("Content-Type") || "").includes("application/manifest+json"), "Content-Type 为 application/manifest+json");
  const m = await r.json();
  ok(m.start_url === APP + "/?s=v141a&k=" + ck, "start_url 带本人 s/k：" + m.start_url);
  ok(m.scope === APP + "/", "scope 为应用根绝对 URL");
  ok(m.name === "一对一专属客户端" && m.short_name === "专属客户端", "name/short_name 与静态 manifest 一致");
  ok(m.display === "standalone" && m.theme_color === "#16453a" && m.background_color === "#f6f6f1", "display/theme/background 与静态一致");
  ok(Array.isArray(m.icons) && m.icons.length === 4 && m.icons.every((i) => i.src.startsWith(APP + "/icon")), "icons 四条且为绝对 URL");
  const r2 = await call("/api/manifest/client/" + sid + "?key=" + ck);
  const m2 = await r2.json();
  ok(r2.status === 200 && m2.start_url === APP + "/?s=" + sid + "&k=" + ck, "数字 id 定位同样可用，start_url 回填 id");
}

// ============ 家长端 manifest ============
section("家长端 manifest：正确密钥");
{
  const r = await call("/api/manifest/parent/v141a?key=" + pk);
  ok(r.status === 200, "slug + 正确家长密钥 → 200");
  const m = await r.json();
  ok(m.start_url === APP + "/parent.html?s=v141a&p=" + pk, "start_url 带本人 s/p：" + m.start_url);
  ok(m.name === "家长更新" && m.short_name === "家长更新", "name/short_name 与静态家长 manifest 一致");
  ok(m.scope === APP + "/" && m.display === "standalone" && m.theme_color === "#16453a", "scope/display/theme 与静态一致");
}

// ============ 密钥纪律 ============
section("密钥纪律：错钥/无钥/交叉/不存在 → 404");
{
  ok((await call("/api/manifest/client/v141a?key=ck_wrong")).status === 404, "学生端错钥 → 404");
  ok((await call("/api/manifest/client/v141a")).status === 404, "学生端无钥 → 404");
  ok((await call("/api/manifest/client/v141a?key=" + pk)).status === 404, "家长密钥打学生端点 → 404");
  ok((await call("/api/manifest/parent/v141a?key=" + ck)).status === 404, "学生密钥打家长端点 → 404");
  ok((await call("/api/manifest/parent/v141a?key=pk_wrong")).status === 404, "家长端错钥 → 404");
  ok((await call("/api/manifest/client/nobody?key=" + ck)).status === 404, "不存在的 slug → 404");
  ok((await call("/api/manifest/client/v141a?key=" + ck, { method: "POST" })).status === 405, "POST → 405");
}

console.log("\n==== smoke-v141: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
