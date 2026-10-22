// TransferOS 一对一 v13.4 冒烟测试：家长页「需要关注」栏 + 学生端「家长所见预览」+ 密钥轮换机制。
// 口径：
//  - 需要关注（parent_concerns）由导师在后台录入，与进展更新分开计列；家长接口顶层键集
//    由 v13 的 9 个扩为 10 个（+concerns），concern 条目键集固定 6 个。
//  - 预览 GET /api/client/parent-preview 用学生密钥鉴权，返回与家长接口同一构建函数
//    （parentViewSections）组装的展示区块：顶层键恰为家长键集去掉 messages 与
//    unread_mentor_parent 后的 8 个；各区块条目键集与家长接口逐键一致；不含家长留言、
//    考试/课程/GPA 等学生原始数据；纯读无副作用（不标记家长留言已读）。
//  - 密钥轮换机制（后台 key_rotate / parent_key_rotate）：旧密钥立即失效、新密钥可用。
// 运行：node tests/smoke-v134.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
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
async function call(path, opts = {}, cookie) {
  const headers = new Headers(opts.headers || {});
  if (cookie) headers.set("Cookie", cookie);
  const req = new Request(BASE + path, { method: opts.method || "GET", headers, body: opts.body });
  return worker.fetch(req, env);
}
const jsonPost = (obj, token) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
  body: JSON.stringify(obj),
});
const form = (obj) => {
  const b = new URLSearchParams(obj);
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: b.toString() };
};
const imp = (body) => call("/api/admin/students/import", jsonPost(body, "tok-123"));
const getParent = (loc, key) => call("/api/parent/" + loc + "?key=" + key).then((r) => r.json());
const getParentRaw = (loc, key) => call("/api/parent/" + loc + "?key=" + key);
const getPreview = (loc, key) => call("/api/client/parent-preview?s=" + loc + "&key=" + key);
const q1 = (sql, ...args) => DB.raw.prepare(sql).get(...args);

// ============ 夹具：学生 P（有数据）+ 学生 E（全空） ============
section("夹具：学生 P / E 导入");
const impP = await (await imp({ student: { name: "V134学生P", slug: "v134p" } })).json();
const impE = await (await imp({ student: { name: "V134学生E", slug: "v134e" } })).json();
ok(impP.ok && impE.ok, "两名学生导入成功");
const sidP = impP.student_id, ckP = impP.client_key, pkP = impP.parent_key;
ok(/^ck_[0-9a-f]{24}$/.test(ckP) && /^pk_[0-9a-f]{24}$/.test(pkP), "学生/家长密钥格式正常");

// 哨兵数据：考试（远期日期，不进提醒窗口）、课程、状态快照、家长留言（导师未读）
DB.raw.prepare(`INSERT INTO student_exams(student_id, exam_name, exam_date, score, pass_line, result, note, created_at, updated_at)
  VALUES(?,?,?,?,?,?,?,?,?)`).run(sidP, "哨兵考试ZZ", "2027-05-01", "SCORE-SENTINEL-777", "PASSLINE-SENTINEL", "fail", "", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
DB.raw.prepare(`INSERT INTO student_courses(student_id, term, course_code, course_name, credits, kind, status, grade, note, created_at, updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(sidP, "2026 秋", "BIO 999", "哨兵课程ZZ", 3, "prereq", "done", "A", "", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
DB.raw.prepare(`INSERT INTO parent_messages(student_id, sender, body, created_at, read_by_parent, read_by_mentor)
  VALUES(?,?,?,?,?,?)`).run(sidP, "mentor", "家长留言哨兵ZZ", "2026-10-20T00:00:00.000Z", 0, 1);
DB.raw.prepare(`INSERT INTO parent_updates(student_id, update_date, title, body, current_focus, next_step, created_at, updated_at)
  VALUES(?,?,?,?,?,?,?,?)`).run(sidP, "2026-10-15", "进展哨兵标题", "进展正文", "策略", "下一步", "2026-10-15T00:00:00.000Z", "2026-10-15T00:00:00.000Z");

// ============ 后台录入需要关注 ============
section("后台：登录 + 需要关注录入区与 CRUD");
const loginRes = await call("/admin/login", form({ password: "test-pw" }));
const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
ok(cookie.includes("tog_admin"), "后台登录成功");
const clientPage = await (await call("/admin/client/" + sidP, {}, cookie)).text();
ok(clientPage.includes("新增需要关注") && clientPage.includes("如实呈现，困难单列，不只报喜"),
  "后台学生页含需要关注录入区与「如实呈现，困难单列，不只报喜」固定说明");
await call("/admin/client/" + sidP, form({
  action: "parent_concern_add", concern_date: "2026-10-18",
  title: "关注哨兵标题", body: "关注情况说明", action_text: "关注措施",
}), cookie);
const crow = q1("SELECT * FROM parent_concerns WHERE student_id = ?", sidP);
ok(!!crow && crow.title === "关注哨兵标题" && crow.action_text === "关注措施", "需要关注落库");

// ============ 家长接口：concerns 在位、键集 10 ============
section("家长接口：需要关注 + 顶层键集 10");
const pd = await getParent("v134p", pkP);
ok(pd.ok === true, "家长接口可读");
const topKeys = Object.keys(pd).sort().join(",");
ok(topKeys === "achievements,concerns,messages,ok,student,student_notes,support_actions,unread_mentor_parent,upcoming_reminders,updates",
  "家长顶层键集恰为 v13.4 的 10 个（" + topKeys + "）");
ok(Array.isArray(pd.concerns) && pd.concerns.length === 1 && pd.concerns[0].title === "关注哨兵标题",
  "concerns 返回录入的事项");
const cKeys = Object.keys(pd.concerns[0]).sort().join(",");
ok(cKeys === "action_text,body,concern_date,created_at,id,title", "concern 条目键集恰为 6 个（" + cKeys + "）");
const pdE = await getParent("v134e", impE.parent_key);
ok(Array.isArray(pdE.concerns) && pdE.concerns.length === 0, "无数据学生 concerns 为空数组（诚实空态）");

// ============ 学生预览：键集、逐键一致、无留言、无原始数据、无副作用 ============
section("学生预览：鉴权与键集");
const pvRes = await getPreview("v134p", ckP);
ok(pvRes.status === 200, "学生密钥可读预览");
const pv = await pvRes.json();
const pvKeys = Object.keys(pv).sort().join(",");
ok(pvKeys === "achievements,concerns,ok,student,student_notes,support_actions,upcoming_reminders,updates",
  "预览顶层键集恰为家长键集去掉 messages/unread 后的 8 个（" + pvKeys + "）");
ok(!("messages" in pv) && !("unread_mentor_parent" in pv), "预览不含家长留言与未读数");
ok(JSON.stringify(Object.keys(pv.concerns[0]).sort()) === JSON.stringify(Object.keys(pd.concerns[0]).sort()),
  "预览 concern 条目键集与家长接口逐键一致");
ok(JSON.stringify(Object.keys(pv.updates[0]).sort()) === JSON.stringify(Object.keys(pd.updates[0]).sort()),
  "预览 update 条目键集与家长接口逐键一致");
ok(pv.concerns[0].title === pd.concerns[0].title && pv.updates[0].title === pd.updates[0].title,
  "预览内容与家长实际所见一致");

section("学生预览：数据边界与零副作用");
const pvText = JSON.stringify(pv);
ok(!pvText.includes("家长留言哨兵ZZ"), "预览不含家长留言正文");
ok(!pvText.includes("哨兵考试ZZ") && !pvText.includes("SCORE-SENTINEL-777") && !pvText.includes("PASSLINE-SENTINEL"),
  "预览不含考试名称/分数/达标线");
ok(!pvText.includes("哨兵课程ZZ") && !pvText.includes("BIO 999"), "预览不含课程原始数据");
// 注：本节之前已调用过家长接口（其本身会标记已读），故新插一条未读导师留言单独验证预览零副作用
DB.raw.prepare(`INSERT INTO parent_messages(student_id, sender, body, created_at, read_by_parent, read_by_mentor)
  VALUES(?,?,?,?,?,?)`).run(sidP, "mentor", "家长留言哨兵·二", "2026-10-20T01:00:00.000Z", 0, 1);
await getPreview("v134p", ckP);
const msgRow = q1("SELECT read_by_parent FROM parent_messages WHERE student_id = ? AND body = '家长留言哨兵·二'", sidP);
ok(msgRow && msgRow.read_by_parent === 0, "预览调用后导师家长留言仍未读（纯读、无已读标记副作用）");
const pd2 = await getParent("v134p", pkP);
ok(pd2.unread_mentor_parent === 1, "家长接口仍报未读 1 条（预览未抢先标记）");

section("学生预览：鉴权失败一律 404");
ok((await getPreview("v134p", pkP)).status === 404, "家长密钥读预览 → 404");
ok((await getPreview("v134p", "ck_000000000000000000000000")).status === 404, "错误学生密钥 → 404");
ok((await getPreview("no-such-student", ckP)).status === 404, "不存在的学生 → 404");
ok((await getPreview("v134p", "")).status === 404, "无密钥 → 404");
ok((await getParentRaw("v134p", ckP)).status === 404, "学生密钥读家长接口 → 404（交叉隔离不变）");
const pvE = await (await getPreview("v134e", impE.client_key)).json();
ok(pvE.ok === true && Array.isArray(pvE.concerns) && pvE.concerns.length === 0, "空学生预览 concerns 空数组");

// ============ 后台 CRUD：改 / 删 ============
section("后台：需要关注编辑与删除");
await call("/admin/client/" + sidP, form({
  action: "parent_concern_update", id: String(crow.id), concern_date: "2026-10-19",
  title: "关注哨兵标题·改", body: "改后说明", action_text: "改后措施",
}), cookie);
const pd3 = await getParent("v134p", pkP);
ok(pd3.concerns.length === 1 && pd3.concerns[0].title === "关注哨兵标题·改" && pd3.concerns[0].concern_date === "2026-10-19",
  "编辑后家长接口同步更新");
await call("/admin/client/" + sidP, form({ action: "parent_concern_delete", id: String(crow.id) }), cookie);
const pd4 = await getParent("v134p", pkP);
ok(pd4.concerns.length === 0, "删除后家长接口为空");

// ============ 密钥轮换机制（后台动作；旧失效、新可用） ============
section("密钥轮换机制：key_rotate / parent_key_rotate");
await call("/admin/client/" + sidP, form({ action: "key_rotate" }), cookie);
const stuRow = q1("SELECT client_key, parent_key FROM students WHERE id = ?", sidP);
ok(stuRow.client_key !== ckP && /^ck_[0-9a-f]{24}$/.test(stuRow.client_key), "学生密钥已重置为新值");
ok((await getPreview("v134p", ckP)).status === 404, "旧学生密钥立即失效（404）");
ok((await getPreview("v134p", stuRow.client_key)).status === 200, "新学生密钥可用（200）");
await call("/admin/client/" + sidP, form({ action: "parent_key_rotate" }), cookie);
const stuRow2 = q1("SELECT parent_key FROM students WHERE id = ?", sidP);
ok(stuRow2.parent_key !== pkP && /^pk_[0-9a-f]{24}$/.test(stuRow2.parent_key), "家长密钥已重置为新值");
ok((await getParentRaw("v134p", pkP)).status === 404, "旧家长密钥立即失效（404）");
ok((await getParent("v134p", stuRow2.parent_key)).ok === true, "新家长密钥可用");

console.log("\n==== v13.4 smoke: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
