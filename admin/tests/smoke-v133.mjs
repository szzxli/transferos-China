// TransferOS 一对一 v13.3 冒烟测试：课程数据纠错通道（category 类型标记）。
// 口径：纠错复用学生留言通道 POST /api/client/message，仅当 category === "data_correction" 时
// 服务端才读 course_code 并把「课程 <代码>：」前缀拼进正文落库；其它任何 category 值一律按
// 普通留言处理（category 落 NULL、正文不拼前缀）。请求里夹带的任何额外字段（mood / key_dates /
// 考试分数 / 日记等）服务端一律不读、不存、不回传。导师工作台未读列表与学生端留言列表都带
// category，导师可辨识；家长接口顶层键集仍恰为 v13 的 9 个（纠错不进家长面）。
// 运行：node tests/smoke-v133.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
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
const imp = (body) => call("/api/admin/students/import", jsonPost(body, "tok-123"));
const getClient = (loc, key) => call("/api/client/" + loc + "?key=" + key).then((r) => r.json());
const getParent = (loc, key) => call("/api/parent/" + loc + "?key=" + key).then((r) => r.json());
const postMsg = (obj) => call("/api/client/message", jsonPost(obj));
const q = (sql, ...args) => DB.raw.prepare(sql).all(...args);
const q1 = (sql, ...args) => DB.raw.prepare(sql).get(...args);

// ============ 夹具：4 名学生（每人只发 1 条，避开 60 秒 3 条限频）+ 1 名可通知导师 ============
section("夹具：学生 A/B/C/D + 导师 MX");
const impA = await (await imp({ student: { name: "V133甲", slug: "v133a" } })).json();
const impB = await (await imp({ student: { name: "V133乙", slug: "v133b" } })).json();
const impC = await (await imp({ student: { name: "V133丙", slug: "v133c" } })).json();
const impD = await (await imp({ student: { name: "V133丁", slug: "v133d" } })).json();
ok(impA.ok && impB.ok && impC.ok && impD.ok, "4 名学生导入成功");
const nowS = new Date().toISOString();
DB.raw.prepare(`INSERT INTO staff(name, kind, emp_no, contact, status, created_at, specialty, contact_email, notify_channel, mentor_status, mentor_key)
  VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
  .run("导师X", "mentor", "EMP-X01", "", "active", nowS, "护理", "mx@example.com", "email", "verified", "mk_xxxxxxxxxxxxxxxxxxxxxxxx");
const MX = q1("SELECT id FROM staff WHERE emp_no='EMP-X01'").id;
DB.raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(MX, impA.student_id);
DB.raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(MX, impC.student_id);
// B、D 不指派导师（存量口径）

// ============ 纠错主路径 ============
section("纠错提交：类型落库 / 代码规范化 / 导师侧可辨识");
{
  const r = await postMsg({ s: "v133a", key: impA.client_key, body: "这门课学分不对，应为 4 学分", category: "data_correction", course_code: "bio 150" });
  const j = await r.json();
  ok(r.status === 200 && j.ok === true, "纠错提交成功（导师可通知）");
  ok(j.message && j.message.category === "data_correction", "响应回带 category=data_correction");
  ok(j.message.body === "课程 BIO 150：这门课学分不对，应为 4 学分", "响应正文带课程前缀且代码已规范化为大写");
  const row = q1("SELECT body, category FROM student_messages WHERE student_id = ?", impA.student_id);
  ok(row && row.category === "data_correction" && row.body === "课程 BIO 150：这门课学分不对，应为 4 学分",
    "落库 category 正确、正文带前缀（导师按原文核对）");
  const cd = await getClient("v133a", impA.client_key);
  const mine = cd.messages.find((m) => m.sender === "student");
  ok(!!mine && mine.category === "data_correction", "学生端留言列表回带 category（本人可见已标记）");
  ok(Object.keys(mine).sort().join(",") === "body,category,created_at,id,sender,sender_label",
    "学生端留言字段白名单恰为 6 项（v13.3 新增 category）");
  const ev = q1("SELECT summary FROM student_events WHERE student_id = ? AND event_type = 'message_student' ORDER BY id DESC LIMIT 1", impA.student_id);
  ok(!!ev && ev.summary.includes("纠错"), "事件流摘要标注为纠错（后台时间线可辨识）");
  const ob = q("SELECT summary FROM notifications_outbox WHERE student_id = ? AND event_type = 'student_message'", impA.student_id);
  ok(ob.length === 1 && ob[0].summary.includes("纠错"), "导师通知发件箱摘要标注为纠错");
  const wb = await (await call("/api/mentor/EMP-X01?key=mk_xxxxxxxxxxxxxxxxxxxxxxxx")).json();
  const blk = (wb.students || []).find((s) => s.student && s.student.slug === "v133a");
  ok(!!blk && blk.unread_messages.some((m) => m.category === "data_correction" && m.body.startsWith("课程 BIO 150：")),
    "导师工作台未读留言带 category=data_correction（导师侧可辨识）");
}

// ============ 伪造 category 一律降级为普通留言 ============
section("伪造 / 非法 category：降级普通留言，course_code 不被读");
{
  const r = await postMsg({ s: "v133c", key: impC.client_key, body: "普通留言正文", category: "urgent_help", course_code: "BIO 150" });
  const j = await r.json();
  ok(r.status === 200 && j.ok === true, "带伪造 category 的留言仍按普通留言收下");
  ok(!j.message.category, "响应不回带伪造 category");
  ok(j.message.body === "普通留言正文", "正文不拼课程前缀（course_code 未被读）");
  const row = q1("SELECT body, category FROM student_messages WHERE student_id = ?", impC.student_id);
  ok(row && row.category === null && row.body === "普通留言正文", "落库 category 为 NULL、正文原样");
}

// ============ 非法课程代码被丢弃，纠错本身仍成立 ============
section("非法 course_code：代码丢弃、正文不拼前缀、类型仍落库");
{
  const r = await postMsg({ s: "v133d", key: impD.client_key, body: "课程名称拼写有误", category: "data_correction", course_code: "BIO<script>150" });
  const j = await r.json();
  ok(r.status === 200 && j.ok === true && j.message.category === "data_correction", "纠错成立且类型落库");
  ok(j.message.body === "课程名称拼写有误", "非法代码被丢弃，正文不拼前缀");
  const row = q1("SELECT body, category FROM student_messages WHERE student_id = ?", impD.student_id);
  ok(row && row.category === "data_correction" && row.body === "课程名称拼写有误", "落库一致");
}

// ============ 越界字段夹带：一律不读不存不回传；无导师学生仍可提交 ============
section("夹带越界字段 + 无导师（存量口径）提交");
{
  const r = await postMsg({
    s: "v133b", key: impB.client_key, body: "先修关系不对",
    category: "data_correction", course_code: "CHM 110",
    mood: "SMUGGLE-MOOD-001", diary: "SMUGGLE-DIARY-002", exam_score: "SMUGGLE-SCORE-003",
    key_dates: [{ date: "2027-01-01", title: "SMUGGLE-DATE-004" }], gpa: "SMUGGLE-GPA-005",
  });
  const raw = await r.text();
  ok(r.status === 200, "无导师学生纠错照常落库（存量口径不 409）");
  for (const bad of ["SMUGGLE-MOOD-001", "SMUGGLE-DIARY-002", "SMUGGLE-SCORE-003", "SMUGGLE-DATE-004", "SMUGGLE-GPA-005"]) {
    ok(!raw.includes(bad), "响应不含夹带值 " + bad);
  }
  const row = q1("SELECT body, category FROM student_messages WHERE student_id = ?", impB.student_id);
  ok(row && row.category === "data_correction" && row.body === "课程 CHM 110：先修关系不对", "落库只有正文 + 类型");
  const kd = q1("SELECT COUNT(*) AS n FROM student_key_dates WHERE student_id = ?", impB.student_id);
  ok(kd.n === 0, "夹带的 key_dates 未写入任何表");
  const ob = q("SELECT id FROM notifications_outbox WHERE student_id = ?", impB.student_id);
  ok(ob.length === 0, "无导师 → 无发件箱行（不伪造已通知）");
}

// ============ 家长面不受影响 ============
section("家长接口：顶层键集不变、纠错不进家长面");
{
  const pd = await getParent("v133a", impA.parent_key);
  const topKeys = Object.keys(pd).sort().join(",");
  ok(topKeys === "achievements,messages,ok,student,student_notes,support_actions,unread_mentor_parent,upcoming_reminders,updates",
    "家长顶层键集恰为 v13 的 9 个（" + topKeys + "）");
  ok(!JSON.stringify(pd).includes("data_correction") && !JSON.stringify(pd).includes("课程 BIO 150"),
    "家长响应不含纠错标记与纠错正文");
}

console.log("\n==== v13.3 smoke: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
