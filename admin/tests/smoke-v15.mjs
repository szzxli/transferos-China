// TransferOS 管理后台 v15 冒烟测试：多导师（主导师唯一 + 专题导师分流，权限最小化）。
// 覆盖：专题指派建表/后台添加移除 → 学生端 mentors 数组与选人留言 → 发件箱按所选导师路由 →
// 专题导师工作台裁剪视图（只见本人线程/本人轨迹，目标/考试/选课/问题/会议/家长线全隔离）→
// inbox/thread/reply 的专题口径与越权 404 → 移除指派后立即失权 → 主导师全量视图不变。
// 运行：node tests/smoke-v15.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
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
const enr = (body) => call("/api/admin/students/enrich", jsonPost(body, "tok-123"));
const getClient = (loc, key) => call("/api/client/" + loc + "?key=" + key).then((r) => r.json());
const postMsg = (obj) => call("/api/client/message", jsonPost(obj));
const postParentMsg = (obj) => call("/api/parent/message", jsonPost(obj));
const postProblem = (obj) => call("/api/client/problem", jsonPost(obj));
const getMentor = (loc, key) => call("/api/mentor/" + loc + "?key=" + key);
const getInbox = (loc, key) => call("/api/mentor/inbox/" + loc + "?key=" + key);
const getThread = (loc, key, sid, ch) =>
  call("/api/mentor/thread/" + loc + "?key=" + key + "&student_id=" + sid + (ch ? "&channel=" + ch : ""));
const reply = (obj) => call("/api/mentor/reply", jsonPost(obj));
const q = (sql, ...args) => DB.raw.prepare(sql).all(...args);
const q1 = (sql, ...args) => DB.raw.prepare(sql).get(...args);

// ============ 夹具：学生 A（主导师 M1 + 专题 M2）/ 学生 B（主导师 M3）============
section("夹具：导入学生与注册导师");
const impA = await (await imp({
  student: { name: "V15学生甲", slug: "v15a" },
  goal: { target_school: "SENTINEL目标大学", target_term: "2027-Fall" },
  status: [{ snapshot_date: "2026-09-01", gpa: 3.5, credits_done: 10, credits_total: 60 }],
  exams: [{ exam_name: "SENTINEL考试", exam_date: "2026-11-01", result: "pending" }],
  courses: [{ term: "2026秋", course_code: "SENTINEL101", course_name: "哨兵课程", credits: 3 }],
  meetings: [{ meeting_date: "2026-10-01", topic: "SENTINEL会议主题", summary: "SENTINEL会议摘要" }],
})).json();
const impB = await (await imp({ student: { name: "V15学生乙", slug: "v15b" } })).json();
ok(impA.ok && impB.ok, "两名学生导入成功");
const sidA = impA.student_id, ckA = impA.client_key, pkA = impA.parent_key;
const sidB = impB.student_id;
const nowS = new Date().toISOString();
const staffIns = (cols) => DB.raw.prepare(
  `INSERT INTO staff(name, kind, emp_no, contact, status, created_at, ${cols}) VALUES(?,?,?,?,?,?,${cols.split(",").map(() => "?").join(",")})`);
staffIns("contact_email, notify_channel, mentor_status, mentor_key")
  .run("多导主导师", "mentor", "EMP-V1501", "", "active", nowS, "lead@example.com", "email", "verified", "mk_151111111111111111111111");
staffIns("contact_wechat, notify_channel, mentor_status, mentor_key")
  .run("创业导师乙", "mentor", "EMP-V1502", "", "active", nowS, "wx-topic", "wechat", "registered", "mk_152222222222222222222222");
staffIns("contact_email, notify_channel, mentor_status, mentor_key")
  .run("无关导师丙", "mentor", "EMP-V1503", "", "active", nowS, "other@example.com", "email", "verified", "mk_153333333333333333333333");
DB.raw.prepare(`INSERT INTO staff(name, kind, emp_no, contact, status, created_at)
  VALUES(?,?,?,?,?,?)`).run("普通员工丁", "human", "EMP-V1504", "", "active", nowS);
const M1 = q1("SELECT id FROM staff WHERE emp_no='EMP-V1501'").id;
const M2 = q1("SELECT id FROM staff WHERE emp_no='EMP-V1502'").id;
const M3 = q1("SELECT id FROM staff WHERE emp_no='EMP-V1503'").id;
const M4 = q1("SELECT id FROM staff WHERE emp_no='EMP-V1504'").id;
DB.raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(M1, sidA);
DB.raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(M3, sidB);
ok(M1 && M2 && M3 && M4, "导师夹具就位（M1 主导师 / M2 专题候选 / M3 他生导师 / M4 非导师员工）");
{
  const e = await (await enr({
    student: { slug: "v15a" },
    trail_entries: [
      { mentor_name: "创业导师乙", mentor_role: "industry", spirit_line: "创业线精神SENTINEL_T2", key_judgments: "商业模式先行" },
      { mentor_name: "多导主导师", mentor_role: "lead", spirit_line: "主导师精神SENTINEL_T1", key_judgments: "全局节奏" },
    ],
  })).json();
  ok(e.ok === true && e.counts.trail_entries.inserted === 2, "enrich 录入两条轨迹（专题导师本人 + 主导师各一）");
  const pr = await (await postProblem({ s: "v15a", key: ckA, domain: "study", title: "SENTINEL问题标题" })).json();
  ok(pr.ok === true, "学生甲同步一条问题（主导师可见、专题导师不可见的哨兵）");
}

// ============ 后台：专题导师管理区 ============
section("后台 /admin/client：专题导师添加 / 列表 / 去重 / 候选校验");
const loginRes = await call("/admin/login", form({ password: "test-pw" }));
const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
ok(!!cookie, "后台登录成功");
{
  const page = await (await call("/admin/client/" + sidA, {}, cookie)).text();
  ok(page.includes("专题导师（v15"), "客户端页出现专题导师管理区");
  const topicSeg = page.slice(page.indexOf("专题导师（v15"), page.indexOf("专题导师（v15") + 4000);
  ok(topicSeg.includes("创业导师乙") && topicSeg.includes('value="' + M2 + '"'), "候选下拉含已登记且有密钥的专题导师 M2");
  ok(!topicSeg.includes('value="' + M4 + '"'), "专题候选下拉不含非导师员工 M4（主导师全员下拉不在此段内）");
  const addRes = await call("/admin/client/" + sidA, form({ action: "topic_mentor_add", topic_staff_id: String(M2), topic: "创业" }), cookie);
  ok(addRes.status === 303, "添加指派提交成功（303 回客户端页）");
  const row = q1("SELECT * FROM student_topic_mentors WHERE student_id = ? AND staff_id = ?", sidA, M2);
  ok(!!row && row.topic === "创业", "指派落库（专题=创业）");
  await call("/admin/client/" + sidA, form({ action: "topic_mentor_add", topic_staff_id: String(M2), topic: "创业" }), cookie);
  ok(q("SELECT * FROM student_topic_mentors WHERE student_id = ? AND staff_id = ?", sidA, M2).length === 1,
    "重复添加被唯一约束挡住（仍 1 条）");
  await call("/admin/client/" + sidA, form({ action: "topic_mentor_add", topic_staff_id: String(M4), topic: "杂务" }), cookie);
  ok(q("SELECT * FROM student_topic_mentors WHERE student_id = ? AND staff_id = ?", sidA, M4).length === 0,
    "非导师员工指派被拒（候选校验）");
  await call("/admin/client/" + sidA, form({ action: "topic_mentor_add", topic_staff_id: String(M1), topic: "全科" }), cookie);
  ok(q("SELECT * FROM student_topic_mentors WHERE student_id = ? AND staff_id = ?", sidA, M1).length === 0,
    "主导师本人不能再兼专题指派");
  const page2 = await (await call("/admin/client/" + sidA, {}, cookie)).text();
  ok(page2.includes("创业导师乙") && page2.includes("创业") && page2.includes("topic_mentor_remove"),
    "列表展示已指派专题导师（姓名/专题/移除按钮）");
}

// ============ 学生端：mentors 数组 ============
section("学生端 GET：mentors 数组（主 + 专题，无密钥字段）");
{
  const d = await getClient("v15a", ckA);
  ok(Array.isArray(d.mentors) && d.mentors.length === 2, "mentors 数组 2 人");
  ok(d.mentors[0].role === "primary" && d.mentors[0].id === M1 && d.mentors[0].name === "多导主导师",
    "第一位是主导师");
  ok(d.mentors[1].role === "topic" && d.mentors[1].id === M2 && d.mentors[1].topic === "创业",
    "第二位是专题导师（带专题名）");
  ok(!JSON.stringify(d).includes("mk_"), "学生端载荷不含任何导师密钥");
}

// ============ 学生留言：选人 + 发件箱路由 ============
section("学生留言：默认主导师 / 指定专题导师 / 指定未指派导师");
{
  const m1 = await (await postMsg({ s: "v15a", key: ckA, body: "给主导师的留言" })).json();
  ok(m1.ok === true && m1.message.mentor_id === M1, "未指定 → 默认主导师");
  const m2 = await (await postMsg({ s: "v15a", key: ckA, body: "给创业导师的问题", mentor_id: M2 })).json();
  ok(m2.ok === true && m2.message.mentor_id === M2, "指定专题导师 → 落库 mentor_id = M2");
  const bad = await postMsg({ s: "v15a", key: ckA, body: "给未指派导师", mentor_id: M3 });
  ok(bad.status === 400, "指定未指派导师 → 400");
  ok(q("SELECT * FROM student_messages WHERE student_id = ? AND sender = 'student'", sidA).length === 2,
    "被拒留言不落库（学生留言仍 2 条）");
  const ob1 = q1("SELECT * FROM notifications_outbox WHERE student_id = ? AND mentor_staff_id = ? AND event_type = 'student_message'", sidA, M1);
  const ob2 = q1("SELECT * FROM notifications_outbox WHERE student_id = ? AND mentor_staff_id = ? AND event_type = 'student_message'", sidA, M2);
  ok(!!ob1 && ob1.status === "queued", "默认留言发件箱落主导师");
  ok(!!ob2 && ob2.status === "queued", "指定留言发件箱落专题导师");
  const p1 = await (await postParentMsg({ s: "v15a", key: pkA, body: "家长留言SENTINEL_P" })).json();
  ok(p1.ok === true, "家长留言成功（专题导师隔离哨兵）");
}

// ============ 专题导师工作台：裁剪视图 ============
section("GET /api/mentor/<专题导师>：裁剪视图与数据隔离");
{
  const res = await getMentor("EMP-V1502", "mk_152222222222222222222222");
  const d = await res.json();
  ok(res.status === 200 && d.ok === true && d.students.length === 1, "专题导师只见 1 名专题学生");
  const blk = d.students[0];
  ok(blk.relation === "topic" && blk.topic === "创业" && blk.student.name === "V15学生甲" && blk.student.slug === "v15a",
    "块头：relation=topic / 专题 / 姓名 / slug 齐全");
  ok(Array.isArray(blk.messages) && blk.messages.length === 1 && blk.messages[0].body === "给创业导师的问题",
    "留言线程只含与该导师的往来（1 条）");
  ok(blk.unread_messages.length === 1, "未读 = 发给自己的那条");
  ok(Array.isArray(blk.trail_entries) && blk.trail_entries.length === 1 &&
     blk.trail_entries[0].mentor_name === "创业导师乙" && blk.trail_entries[0].spirit_line.includes("SENTINEL_T2"),
    "轨迹只含本人撰写的 1 条");
  ok(blk.recent_events.length === 0 && blk.open_problems.length === 0 && blk.pending_actions.length === 0,
    "事件/问题/待办恒为空（不下发）");
  const s = JSON.stringify(blk);
  for (const sentinel of ["SENTINEL目标大学", "SENTINEL考试", "SENTINEL101", "哨兵课程", "SENTINEL问题标题",
    "SENTINEL会议", "SENTINEL_T1", "SENTINEL_P", "给主导师的留言", "3.5"]) {
    ok(!s.includes(sentinel), "裁剪视图不含：" + sentinel);
  }
  ok((await getMentor("EMP-V1502", "mk_151111111111111111111111")).status === 404, "拿主导师密钥开专题导师 → 404");
  ok((await getMentor("EMP-V1502", ckA)).status === 404, "拿学生密钥开导师接口 → 404");
}

// ============ 主导师工作台：全量不变 ============
section("GET /api/mentor/<主导师>：全量视图保持 v13/v14 口径");
{
  const d = await (await getMentor("EMP-V1501", "mk_151111111111111111111111")).json();
  ok(d.ok === true && d.students.length === 1, "主导师见学生甲 1 名");
  const blk = d.students[0];
  ok(blk.relation === "primary", "主导师块标注 relation=primary");
  ok(blk.open_problems.some((p) => p.title === "SENTINEL问题标题"), "主导师仍见未关闭问题");
  ok(blk.unread_messages.some((m) => m.body === "给主导师的留言"), "主导师待回复含默认留言");
  ok(Array.isArray(blk.recent_events), "主导师仍有近期动态块");
}

// ============ 收件箱：专题口径 ============
section("收件箱：专题导师只进学生线且按 mentor_id 过滤");
{
  const inbox2 = await (await getInbox("EMP-V1502", "mk_152222222222222222222222")).json();
  ok(inbox2.ok === true && inbox2.threads.length === 1, "专题导师收件箱只有 1 条线");
  const th = inbox2.threads[0];
  ok(th.channel === "student" && th.relation === "topic" && th.topic === "创业" && th.unread === 1 &&
     th.last.body.includes("给创业导师的问题"), "学生线条目：relation/topic/未读/摘要正确");
  ok(!JSON.stringify(inbox2).includes("SENTINEL_P") && !JSON.stringify(inbox2).includes("给主导师的留言"),
    "专题收件箱不含家长线、也不含主导师线程");
  ok(inbox2.total_unread === 1 && inbox2.pending_threads === 1, "未读汇总按专题口径计数");
  const inbox1 = await (await getInbox("EMP-V1501", "mk_151111111111111111111111")).json();
  ok(inbox1.threads.some((t) => t.channel === "parent") && inbox1.threads.some((t) => t.channel === "student"),
    "主导师收件箱仍有学生线 + 家长线");
  const inbox3 = await (await getInbox("EMP-V1503", "mk_153333333333333333333333")).json();
  ok(!JSON.stringify(inbox3).includes("V15学生甲"), "无关导师收件箱不含学生甲");
}

// ============ 对话线：专题口径与越权 ============
section("对话线：专题导师只读自己线程 / 家长线 404 / 无关导师 404");
{
  const th = await (await getThread("EMP-V1502", "mk_152222222222222222222222", sidA, "student")).json();
  ok(th.ok === true && th.messages.length === 1 && th.messages[0].body === "给创业导师的问题" && th.unread_before === 1,
    "专题导师学生线：只含本人线程，unread_before = 1");
  ok((await getThread("EMP-V1502", "mk_152222222222222222222222", sidA, "parent")).status === 404,
    "专题导师开家长线 → 404");
  ok((await getThread("EMP-V1503", "mk_153333333333333333333333", sidA, "student")).status === 404,
    "无关导师开学生甲线程 → 404");
  const thMain = await (await getThread("EMP-V1501", "mk_151111111111111111111111", sidA, "student")).json();
  ok(thMain.ok === true && thMain.messages.length === 2, "主导师学生线仍是全量（两条学生留言都在）");
}

// ============ 回复：专题口径 ============
section("回复：专题导师学生线成功 / 家长线 404 / 发件箱推进只动自己的");
{
  const r2 = await reply({ s: "EMP-V1502", key: "mk_152222222222222222222222", student_id: sidA, body: "创业导师回复" });
  const r2j = await r2.json();
  ok(r2.status === 200 && r2j.ok === true, "专题导师回复学生线成功");
  const row = q1("SELECT * FROM student_messages WHERE student_id = ? AND sender = 'mentor' ORDER BY id DESC LIMIT 1", sidA);
  ok(!!row && row.body === "创业导师回复" && row.mentor_id === M2, "回复落库 mentor_id = 专题导师");
  const ob2 = q1("SELECT * FROM notifications_outbox WHERE student_id = ? AND mentor_staff_id = ? AND event_type = 'student_message'", sidA, M2);
  const ob1 = q1("SELECT * FROM notifications_outbox WHERE student_id = ? AND mentor_staff_id = ? AND event_type = 'student_message'", sidA, M1);
  ok(ob2.status === "responded" && ob1.status === "queued", "发件箱：专题导师的已推进 responded，主导师的仍 queued");
  const pBefore = q("SELECT * FROM parent_messages WHERE student_id = ?", sidA).length;
  ok((await reply({ s: "EMP-V1502", key: "mk_152222222222222222222222", student_id: sidA, channel: "parent", body: "越权回复家长" })).status === 404,
    "专题导师回复家长线 → 404");
  ok(q("SELECT * FROM parent_messages WHERE student_id = ?", sidA).length === pBefore, "越权回复不落库");
  ok((await reply({ s: "EMP-V1503", key: "mk_153333333333333333333333", student_id: sidA, body: "无关导师回复" })).status === 404,
    "无关导师回复学生甲 → 404");
  const d = await getClient("v15a", ckA);
  const replyMsg = d.messages.find((m) => m.body === "创业导师回复");
  ok(!!replyMsg && replyMsg.mentor_name === "创业导师乙", "学生端线程里专题导师回复带导师名");
}

// ============ 移除指派：立即失权 ============
section("移除专题指派后：工作台/线程/回复/选人全部失权");
{
  const assign = q1("SELECT * FROM student_topic_mentors WHERE student_id = ? AND staff_id = ?", sidA, M2);
  await call("/admin/client/" + sidA, form({ action: "topic_mentor_remove", id: String(assign.id) }), cookie);
  ok(q("SELECT * FROM student_topic_mentors WHERE student_id = ?", sidA).length === 0, "指派已移除");
  const d = await (await getMentor("EMP-V1502", "mk_152222222222222222222222")).json();
  ok(d.ok === true && d.students.length === 0, "专题导师工作台变空");
  ok((await getThread("EMP-V1502", "mk_152222222222222222222222", sidA, "student")).status === 404,
    "移除后读线程 → 404");
  ok((await reply({ s: "EMP-V1502", key: "mk_152222222222222222222222", student_id: sidA, body: "移除后回复" })).status === 404,
    "移除后回复 → 404");
  ok((await postMsg({ s: "v15a", key: ckA, body: "移除后再发", mentor_id: M2 })).status === 400,
    "移除后学生再指定该导师 → 400");
  const dMain = await (await getMentor("EMP-V1501", "mk_151111111111111111111111")).json();
  ok(dMain.students.length === 1 && dMain.students[0].relation === "primary", "主导师视图不受移除影响");
  const dc = await getClient("v15a", ckA);
  ok(dc.mentors.length === 1 && dc.mentors[0].role === "primary", "学生端 mentors 回落为只有主导师");
}

console.log("\n==== v15 smoke: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
