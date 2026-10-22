// TransferOS 管理后台 v14 冒烟测试：导师简易沟通台 API。
// 覆盖：聚合收件箱（学生线/家长线分开、未读计数、排序、摘要截断、诚实空态）、
// 对话线（正序全量、打开即标导师已读、两线互不串）、回复 channel 路由
// （parent → parent_messages，与后台 parent_message_reply 同语义；缺省 → student_messages，v13 行为不变）、
// 密钥纪律（mk_/ck_/pk_ 交叉一律 404、他人学生 404）。
// 运行：node tests/smoke-v14.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
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
const imp = (body) => call("/api/admin/students/import", jsonPost(body, "tok-123"));
const getClient = (loc, key) => call("/api/client/" + loc + "?key=" + key).then((r) => r.json());
const getParent = (loc, key) => call("/api/parent/" + loc + "?key=" + key).then((r) => r.json());
const postMsg = (obj) => call("/api/client/message", jsonPost(obj));
const postParentMsg = (obj) => call("/api/parent/message", jsonPost(obj));
const getInbox = (loc, key) => call("/api/mentor/inbox/" + loc + "?key=" + key);
const getThread = (loc, key, sid, ch) =>
  call("/api/mentor/thread/" + loc + "?key=" + key + "&student_id=" + sid + (ch ? "&channel=" + ch : ""));
const reply = (obj) => call("/api/mentor/reply", jsonPost(obj));
const q = (sql, ...args) => DB.raw.prepare(sql).all(...args);
const q1 = (sql, ...args) => DB.raw.prepare(sql).get(...args);

// ============ 夹具：学生 A/B/C + 导师 M1/M3/M4 ============
section("夹具：导入学生与注册导师");
const impA = await (await imp({ student: { name: "V14学生甲", slug: "v14a" } })).json();
const impB = await (await imp({ student: { name: "V14学生乙", slug: "v14b" } })).json();
const impC = await (await imp({ student: { name: "V14学生丙", slug: "v14c" } })).json();
ok(impA.ok && impB.ok && impC.ok, "三名学生导入成功");
const sidA = impA.student_id, ckA = impA.client_key, pkA = impA.parent_key;
const sidB = impB.student_id, ckB = impB.client_key, pkB = impB.parent_key;
const sidC = impC.student_id, ckC = impC.client_key;
const nowS = new Date().toISOString();
DB.raw.prepare(`INSERT INTO staff(name, kind, emp_no, contact, status, created_at, contact_email, notify_channel, mentor_status, mentor_key)
  VALUES(?,?,?,?,?,?,?,?,?,?)`)
  .run("导师甲", "mentor", "EMP-M01", "", "active", nowS, "m1@example.com", "email", "verified", "mk_111111111111111111111111");
DB.raw.prepare(`INSERT INTO staff(name, kind, emp_no, contact, status, created_at, contact_wechat, notify_channel, mentor_status, mentor_key)
  VALUES(?,?,?,?,?,?,?,?,?,?)`)
  .run("导师丙", "mentor", "EMP-M03", "", "active", nowS, "wx-m3", "wechat", "verified", "mk_333333333333333333333333");
DB.raw.prepare(`INSERT INTO staff(name, kind, emp_no, contact, status, created_at, contact_email, notify_channel, mentor_status, mentor_key)
  VALUES(?,?,?,?,?,?,?,?,?,?)`)
  .run("导师丁", "mentor", "EMP-M04", "", "active", nowS, "m4@example.com", "email", "verified", "mk_444444444444444444444444");
const M1 = q1("SELECT id FROM staff WHERE emp_no='EMP-M01'").id;
const M3 = q1("SELECT id FROM staff WHERE emp_no='EMP-M03'").id;
DB.raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(M1, sidA);
DB.raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(M3, sidB);
ok(M1 && M3, "导师夹具就位（甲→学生甲 / 丙→学生乙 / 学生丙未指派 / 导师丁无学生）");

// ============ 种子留言（走真实写接口）============
section("种子留言：学生线与家长线各一条");
{
  const s1 = await (await postMsg({ s: "v14a", key: ckA, body: "学生甲留言：想确认选课" })).json();
  ok(s1.ok === true, "学生甲经学生端留言成功");
  const p1 = await (await postParentMsg({ s: "v14a", key: pkA, body: "家长甲留言：想了解进度" })).json();
  ok(p1.ok === true, "家长甲经家长端留言成功");
  const s2 = await (await postMsg({ s: "v14b", key: ckB, body: "学生乙留言：需要模考" })).json();
  ok(s2.ok === true, "学生乙留言成功");
  const p2 = await (await postParentMsg({ s: "v14b", key: pkB, body: "家长乙留言：费用问题" })).json();
  ok(p2.ok === true, "家长乙留言成功");
  const s3 = await (await postMsg({ s: "v14c", key: ckC, body: "学生丙留言：无人指派" })).json();
  ok(s3.ok === true, "未指派学生丙留言成功（不应进任何导师收件箱）");
  // 排序夹具：把学生甲的学生线最后活动压到家长线之前
  DB.raw.prepare("UPDATE student_messages SET created_at = '2026-01-01T00:00:00.000Z' WHERE student_id = ?").run(sidA);
  DB.raw.prepare("UPDATE parent_messages SET created_at = '2026-06-01T00:00:00.000Z' WHERE student_id = ?").run(sidA);
}

// ============ 收件箱 ============
section("收件箱：聚合 / 未读 / 排序 / 隔离 / 空态");
{
  const res = await getInbox("EMP-M01", "mk_111111111111111111111111");
  const inbox = await res.json();
  ok(res.status === 200 && inbox.ok === true && inbox.mentor.name === "导师甲", "导师甲收件箱打开成功");
  ok(inbox.total_unread === 2 && inbox.pending_threads === 2, "未读汇总：2 条未读 / 2 条待回复线");
  ok(inbox.threads.length === 2, "学生甲产生两条线（学生线 + 家长线分开）");
  ok(inbox.threads[0].channel === "parent" && inbox.threads[1].channel === "student",
    "线按最后活动倒序（家长线 2026-06 在前）");
  const st = inbox.threads.find((t) => t.channel === "student");
  const pt = inbox.threads.find((t) => t.channel === "parent");
  ok(st.student_name === "V14学生甲" && st.unread === 1 && st.last.body.includes("想确认选课") && st.channel_label === "学生留言",
    "学生线条目：学生名/未读 1/摘要/来源标记齐全");
  ok(pt.unread === 1 && pt.last.body.includes("想了解进度") && pt.channel_label === "家长留言",
    "家长线条目：未读 1/摘要/来源标记齐全");
  ok(!JSON.stringify(inbox).includes(ckA) && !JSON.stringify(inbox).includes(pkA), "收件箱不回传任何学生/家长密钥");

  // 摘要截断：塞一条超长导师留言作为学生线最后活动（sender=mentor 不计未读）
  DB.raw.prepare(`INSERT INTO student_messages(student_id, sender, body, created_at, read_by_student, read_by_mentor, mentor_id)
    VALUES(?, 'mentor', ?, '2026-07-01T00:00:00.000Z', 0, 1, ?)`).run(sidA, "长".repeat(200), M1);
  const inbox2 = await (await getInbox("EMP-M01", "mk_111111111111111111111111")).json();
  const st2 = inbox2.threads.find((t) => t.channel === "student");
  ok(st2.last.body.length === 120 && st2.unread === 1 && inbox2.threads[0].channel === "student",
    "摘要截断 120 字；导师自发留言不计未读；排序随最后活动更新");

  const inboxB = await (await getInbox("EMP-M03", "mk_333333333333333333333333")).json();
  ok(inboxB.threads.length === 2 && inboxB.total_unread === 2 &&
     inboxB.threads.every((t) => t.student_id === sidB) && !JSON.stringify(inboxB).includes("学生甲"),
    "导师丙收件箱只有学生乙的两条线（隔离）");
  const inboxE = await (await getInbox("EMP-M04", "mk_444444444444444444444444")).json();
  ok(inboxE.ok === true && inboxE.threads.length === 0 && inboxE.total_unread === 0 && inboxE.pending_threads === 0,
    "无指派学生的导师 → 诚实空态（threads 空、计数 0）");

  ok((await getInbox("EMP-M01", ckA)).status === 404, "学生密钥开收件箱 → 404");
  ok((await getInbox("EMP-M01", pkA)).status === 404, "家长密钥开收件箱 → 404");
  ok((await getInbox("EMP-M01", "mk_333333333333333333333333")).status === 404, "他人导师密钥 → 404");
  ok((await getInbox("EMP-M99", "mk_111111111111111111111111")).status === 404, "不存在的导师 → 404");
  ok((await getInbox("EMP-M01", "")).status === 404, "无密钥 → 404");
}

// ============ 对话线 ============
section("对话线：正序 / 打开标已读 / 两线互不串");
{
  const thRes = await getThread("EMP-M01", "mk_111111111111111111111111", sidA, "student");
  const th = await thRes.json();
  ok(thRes.status === 200 && th.ok === true && th.channel === "student" && th.unread_before === 1,
    "学生线打开成功，unread_before = 1");
  ok(th.messages.length === 2 && th.messages[0].sender === "student" && th.messages[1].sender === "mentor" &&
     th.messages[0].id < th.messages[1].id, "学生线正序全量（学生留言 + 导师长留言）");
  ok(!JSON.stringify(th).includes("想了解进度"), "学生线不含家长留言内容（隔离）");
  const inbox3 = await (await getInbox("EMP-M01", "mk_111111111111111111111111")).json();
  ok(inbox3.threads.find((t) => t.channel === "student").unread === 0 &&
     inbox3.threads.find((t) => t.channel === "parent").unread === 1 && inbox3.total_unread === 1,
    "打开学生线只清学生线未读，家长线未读不动");

  const tp = await (await getThread("EMP-M01", "mk_111111111111111111111111", sidA, "parent")).json();
  ok(tp.ok === true && tp.channel === "parent" && tp.unread_before === 1 && tp.messages.length === 1 &&
     tp.messages[0].sender_label === "家长" && tp.messages[0].body.includes("想了解进度"),
    "家长线打开成功：正序、家长标签、unread_before = 1");
  ok(!JSON.stringify(tp).includes("想确认选课"), "家长线不含学生留言内容（隔离）");
  const inbox4 = await (await getInbox("EMP-M01", "mk_111111111111111111111111")).json();
  ok(inbox4.total_unread === 0 && inbox4.pending_threads === 0, "两条线都打开后未读清零");

  ok((await getThread("EMP-M03", "mk_333333333333333333333333", sidA, "student")).status === 404,
    "导师打开他人学生对话线 → 404");
  ok((await getThread("EMP-M01", "mk_111111111111111111111111", sidC, "student")).status === 404,
    "打开未指派给自己的学生 → 404");
  ok((await call("/api/mentor/thread/EMP-M01?key=mk_111111111111111111111111")).status === 404,
    "缺 student_id → 404");
  const thBad = await (await getThread("EMP-M01", "mk_111111111111111111111111", sidA, "whatever")).json();
  ok(thBad.ok === true && thBad.channel === "student", "channel 非法值回落学生线（不崩）");
}

// ============ 回复路由 ============
section("回复：channel=parent 进家长线 / 缺省进学生线 / 错误口径");
{
  const stuMsgBefore = q1("SELECT COUNT(*) AS n FROM student_messages WHERE student_id = ?", sidA).n;
  const rp = await (await reply({ s: "EMP-M01", key: "mk_111111111111111111111111", student_id: sidA, channel: "parent", body: "导师回复家长：进度已更新" })).json();
  ok(rp.ok === true && rp.channel === "parent" && rp.message.sender === "mentor", "channel=parent 回复成功并回 channel 标记");
  const pd = await getParent("v14a", pkA);
  ok(pd.messages.some((m) => m.sender === "mentor" && m.body === "导师回复家长：进度已更新"),
    "家长端可见导师回复（家长线落库）");
  ok(pd.unread_mentor_parent >= 1, "家长侧导师未读计数反映新回复");
  const cd = await getClient("v14a", ckA);
  ok(!cd.messages.some((m) => m.body === "导师回复家长：进度已更新"),
    "学生端留言线看不到家长线回复（隔离）");
  ok(q1("SELECT COUNT(*) AS n FROM student_messages WHERE student_id = ?", sidA).n === stuMsgBefore,
    "家长线回复不写 student_messages");

  // 家长再发一条，导师回复家长线应顺带清掉家长未读
  await postParentMsg({ s: "v14a", key: pkA, body: "家长甲追问：谢谢" });
  const rp2 = await (await reply({ s: "EMP-M01", key: "mk_111111111111111111111111", student_id: sidA, channel: "parent", body: "导师回复家长：不客气" })).json();
  ok(rp2.ok === true, "家长线第二次回复成功");
  const inbox5 = await (await getInbox("EMP-M01", "mk_111111111111111111111111")).json();
  ok(inbox5.threads.find((t) => t.channel === "parent").unread === 0, "回复家长线后家长未读清零");

  const rs = await (await reply({ s: "EMP-M01", key: "mk_111111111111111111111111", student_id: sidA, body: "导师回复学生：周三细聊" })).json();
  ok(rs.ok === true && !("channel" in rs) && rs.message.sender === "mentor",
    "缺省 channel 回复走学生线，响应形状与 v13 一致（无 channel 字段）");
  const cd2 = await getClient("v14a", ckA);
  ok(cd2.messages.some((m) => m.sender === "mentor" && m.body === "导师回复学生：周三细聊"),
    "学生端可见导师回复（学生线落库）");
  const rs2 = await (await reply({ s: "EMP-M01", key: "mk_111111111111111111111111", student_id: sidA, channel: "student", body: "导师回复学生：补充一条" })).json();
  ok(rs2.ok === true && q("SELECT * FROM student_messages WHERE student_id = ? AND body = '导师回复学生：补充一条'", sidA).length === 1,
    "channel=student 显式回复同样进学生线");

  ok((await reply({ s: "EMP-M01", key: "mk_111111111111111111111111", student_id: sidA, body: "  " })).status === 400,
    "空正文回复 → 400");
  ok((await reply({ s: "EMP-M01", key: "mk_111111111111111111111111", student_id: sidA, body: "x".repeat(501) })).status === 400,
    "超 500 字回复 → 400");
  ok((await reply({ s: "EMP-M01", key: "mk_111111111111111111111111", student_id: sidB, channel: "parent", body: "越界回复" })).status === 404,
    "回复他人学生（家长线）→ 404");
  ok((await reply({ s: "EMP-M01", key: ckA, student_id: sidA, body: "冒充" })).status === 404,
    "学生密钥冒充导师回复 → 404");
}

// ============ 工作台兼容 ============
section("工作台 v13 接口兼容");
{
  const wb = await (await call("/api/mentor/EMP-M01?key=mk_111111111111111111111111")).json();
  ok(wb.ok === true && wb.students.length === 1 && wb.students[0].student.name === "V14学生甲",
    "工作台接口照常返回（名下学生一块）");
  ok(wb.students[0].recent_events.some((e) => e.event_type === "mentor_reply"),
    "学生线回复仍记入事件流（mentor_reply）");
}

console.log("\n==== smoke-v14: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
