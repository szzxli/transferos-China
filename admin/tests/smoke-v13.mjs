// TransferOS 管理后台 v13 冒烟测试：家长端增量（成就 / 给爸妈的一句话 / 30 天日期提醒）
// + 导师注册制与通知发件箱 + 后台事件时间线 + 导师工作台 API。
// 日期提醒用「相对今天」的夹具锚定运行时刻（等价固定时钟：窗口边界以运行日为今天计算），
// 生日滚动用与实现相同的月/日算法在测试侧独立复算 days_left 后比对。
// 口径区分（重要）：feeling_tag 是学生自选的枚举展示标签（如 steady=平稳），不是情绪原文；
// diary/journal/mood/emotion 原文字段在新表新接口上仍不落库、不回传（哨兵断言覆盖）。
// 运行：node tests/smoke-v13.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
import { DatabaseSync } from "node:sqlite";
import worker, { mentorNotifiable, mentorContacts, computeUpcomingReminders, buildAchievements, FEELING_TAGS } from "./worker.mjs";

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
const getParent = (loc, key) => call("/api/parent/" + loc + "?key=" + key).then((r) => r.json());
const postMsg = (obj) => call("/api/client/message", jsonPost(obj));
const postNote = (obj) => call("/api/client/parent-note", jsonPost(obj));
const postNoteWithdraw = (obj) => call("/api/client/parent-note/withdraw", jsonPost(obj));
const q = (sql, ...args) => DB.raw.prepare(sql).all(...args);
const q1 = (sql, ...args) => DB.raw.prepare(sql).get(...args);

const iso = (d) => d.toISOString().slice(0, 10);
const plus = (n) => iso(new Date(Date.now() + n * 864e5));
// 生日夹具：出生年 2004，月/日 = 今天 +5 天 → 下一次生日在 5 天后（与实现同算法复算）
const bTarget = new Date(Date.now() + 5 * 864e5);
const BDAY = "2004-" + String(bTarget.getMonth() + 1).padStart(2, "0") + "-" + String(bTarget.getDate()).padStart(2, "0");
function expectedBirthdayDaysLeft(birth, todayIsoStr) {
  const [, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = todayIsoStr.split("-").map(Number);
  let y = ty;
  if (bm < tm || (bm === tm && bd < td)) y = ty + 1;
  const diff = Math.round((Date.UTC(y, bm - 1, bd) - Date.UTC(ty, tm - 1, td)) / 864e5);
  return diff;
}

// ============ 纯函数 ============
section("纯函数：导师可通知判定 / 成就合成 / 提醒窗口");
{
  ok(mentorNotifiable({ mentor_status: "verified", contact_email: "a@b.c" }) === true, "已核验 + 邮箱 → 可通知");
  ok(mentorNotifiable({ mentor_status: "registered", contact_wechat: "wx" }) === true, "已登记 + 微信 → 可通知");
  ok(mentorNotifiable({ mentor_status: "verified" }) === false, "已核验但零联系方式 → 不可通知");
  ok(mentorNotifiable({ mentor_status: "", contact_email: "a@b.c" }) === false, "未登记（无导师状态）→ 不可通知");
  ok(mentorNotifiable({ contact: "创始人微信" }) === true, "旧档案只有 contact（创始人转达渠道）→ 可通知（存量兼容）");
  ok(mentorNotifiable(null) === false, "导师不存在 → 不可通知");
  ok(mentorContacts({ contact_email: "a@b.c", notify_channel: "wechat" }).join(",") === "email", "联系方式汇总返回已有渠道名集合");
  ok(Object.keys(FEELING_TAGS).length >= 3 && FEELING_TAGS.steady === "平稳", "心情标签词表克制（枚举）");

  const ach = buildAchievements(
    [{ title: "里程碑甲", date_text: "2026-01-02" }],
    [{ title: "行动甲", updated_at: "2026-02-03T00:00:00.000Z" }],
    [{ title: "问题甲", updated_at: "2026-03-04T00:00:00.000Z" }]);
  ok(ach.length === 3 && ach.map((a) => a.kind).join(",") === "milestone,action,problem" &&
     ach.every((a) => Object.keys(a).sort().join(",") === "date_text,kind,title"),
    "成就三源合成（milestone/action/problem），字段只有 kind/title/date_text");

  const today = iso(new Date());
  const rems = computeUpcomingReminders(
    [{ date: BDAY, title: "她的生日", kind: "birthday" },
     { date: plus(40), title: "远期截止", kind: "deadline" },
     { date: plus(3), title: "近期事项", kind: null }],
    [{ exam_name: "考试甲", exam_date: plus(10) }, { exam_name: "过期考试", exam_date: plus(-2) }],
    [{ title: "里程碑乙", date_text: plus(15) }, { title: "里程碑丙", date_text: "下学期" }],
    today, 30);
  const b = rems.find((r) => r.kind === "birthday");
  ok(b && b.days_left === expectedBirthdayDaysLeft(BDAY, today), "生日按月/日滚动到下一次并算 days_left");
  ok(rems.some((r) => r.kind === "exam" && r.title === "考试甲"), "考试日期进提醒（只名+日期）");
  ok(rems.some((r) => r.kind === "milestone"), "里程碑 ISO 预计日期进提醒");
  ok(!rems.some((r) => r.title === "远期截止") && !rems.some((r) => r.title === "过期考试") && !rems.some((r) => r.title === "里程碑丙"),
    "超 30 天 / 已过期 / 非 ISO 文本日期一律不进提醒");
}

// ============ 夹具：学生 A/B/C + 导师 M1/M2/M3 ============
section("夹具：导入学生与注册导师");
const impA = await (await imp({
  student: { name: "V13学生甲", slug: "v13a" },
  status: [{ term_label: "2026 秋", credits_done: 55, credits_total: 120 }],
  milestones: [
    { title: "完成第一学期复盘", date_text: "2026-01-15", kind: "milestone" },
    { title: "护理先修里程碑", date_text: plus(15), kind: "milestone" },
  ],
  key_dates: [
    { date: BDAY, title: "她的生日", kind: "birthday" },
    { date: plus(40), title: "远期申请截止", kind: "deadline" },
  ],
  exams: [{ exam_name: "护理入学考试", exam_date: plus(10), attempts: 1, passed: 0, status: "preparing" }],
  actions: [
    { title: "行动甲已完成", status: "done" },
    { title: "行动乙待办", status: "todo" },
  ],
})).json();
ok(impA.ok === true, "学生甲导入成功");
const sidA = impA.student_id, ckA = impA.client_key, pkA = impA.parent_key;
const impB = await (await imp({ student: { name: "V13学生乙", slug: "v13b" } })).json();
const sidB = impB.student_id, ckB = impB.client_key, pkB = impB.parent_key;
const impC = await (await imp({ student: { name: "V13学生丙", slug: "v13c" } })).json();
const sidC = impC.student_id, ckC = impC.client_key;

const nowS = new Date().toISOString();
DB.raw.prepare(`INSERT INTO staff(name, kind, emp_no, contact, status, created_at, specialty, contact_email, contact_phone, contact_wechat, notify_channel, mentor_status, mentor_key)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run("导师甲", "mentor", "EMP-M01", "", "active", nowS, "护理", "m1@example.com", "", "", "email", "verified", "mk_111111111111111111111111");
DB.raw.prepare(`INSERT INTO staff(name, kind, emp_no, contact, status, created_at, mentor_status)
  VALUES(?,?,?,?,?,?,?)`).run("导师乙", "mentor", "EMP-M02", "", "active", nowS, "registered");
DB.raw.prepare(`INSERT INTO staff(name, kind, emp_no, contact, status, created_at, contact_wechat, notify_channel, mentor_status, mentor_key)
  VALUES(?,?,?,?,?,?,?,?,?,?)`)
  .run("导师丙", "mentor", "EMP-M03", "", "active", nowS, "wx-m3", "wechat", "verified", "mk_333333333333333333333333");
const M1 = q1("SELECT id FROM staff WHERE emp_no='EMP-M01'").id;
const M2 = q1("SELECT id FROM staff WHERE emp_no='EMP-M02'").id;
const M3 = q1("SELECT id FROM staff WHERE emp_no='EMP-M03'").id;
DB.raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(M1, sidA);
DB.raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(M3, sidB);
ok(M1 && M2 && M3, "三名导师夹具就位（甲可通知 / 乙不可通知 / 丙可通知）");

// ============ 给爸妈的一句话 ============
section("一句话通道：学生写 / 家长只读 / 撤回 / 哨兵");
{
  const n1 = await (await postNote({ s: "v13a", key: ckA, body: "最近挺好的，别担心", feeling_tag: "steady" })).json();
  ok(n1.ok === true && n1.note.feeling_tag_label === "平稳", "学生发一句话 + 自选标签「平稳」");
  const noteId = n1.note.id;
  ok(Object.keys(n1.note).sort().join(",") === "body,created_at,feeling_tag,feeling_tag_label,id",
    "一句话响应字段白名单（无 mood/emotion 原文字段）");
  ok((await postNote({ s: "v13a", key: ckA, body: "x", feeling_tag: "ecstatic" })).status === 400,
    "非法 feeling_tag → 400");
  ok((await postNote({ s: "v13a", key: ckA, body: "长".repeat(81) })).status === 400, "超 80 字 → 400");
  // 哨兵：请求夹带私密字段
  const n2 = await (await postNote({
    s: "v13a", key: ckA, body: "哨兵测试句", feeling_tag: "tired",
    diary: "SENTINEL_DIARY", journal: "SENTINEL_JOURNAL", mood: "SENTINEL_MOOD", emotion: "SENTINEL_EMO",
  })).json();
  ok(n2.ok === true, "夹带私密字段的一句话仍可发送（字段被忽略）");
  const rawNotes = JSON.stringify(q("SELECT * FROM note_to_parents WHERE student_id = ?", sidA));
  ok(!rawNotes.includes("SENTINEL"), "哨兵私密字段不落库（note_to_parents 全表扫描）");
  // 家长只读：家长 key 写一律 404（两种传法）
  ok((await postNote({ s: "v13a", p: pkA, body: "家长冒充" })).status === 404, "家长 key（p 参数）写一句话 → 404");
  ok((await postNote({ s: "v13a", key: pkA, body: "家长冒充" })).status === 404, "家长 key（key 参数）写一句话 → 404");
  ok((await postNoteWithdraw({ s: "v13a", key: pkA, id: noteId })).status === 404, "家长 key 撤回 → 404");
  // 家长可见
  let pd = await getParent("v13a", pkA);
  ok(pd.student_notes.some((n) => n.id === noteId && n.body === "最近挺好的，别担心"), "家长页可见学生一句话");
  ok(!JSON.stringify(pd).includes("SENTINEL"), "家长响应无哨兵私密内容");
  // 别人撤回 → 404；本人撤回 → 家长不可见
  ok((await postNoteWithdraw({ s: "v13b", key: ckB, id: noteId })).status === 404, "他人撤回我的一句话 → 404");
  const w = await (await postNoteWithdraw({ s: "v13a", key: ckA, id: noteId })).json();
  ok(w.ok === true, "学生本人撤回成功");
  pd = await getParent("v13a", pkA);
  ok(!pd.student_notes.some((n) => n.id === noteId), "撤回后家长页不可见");
  const cd = await getClient("v13a", ckA);
  ok(!cd.parent_notes.some((n) => n.id === noteId) && cd.parent_notes.some((n) => n.body === "哨兵测试句"),
    "学生端列表只含自己未撤回的一句话");
  const ev = q("SELECT event_type FROM student_events WHERE student_id = ?", sidA).map((r) => r.event_type);
  ok(ev.includes("parent_note_sent") && ev.includes("parent_note_withdrawn"), "一句话推送/撤回进事件流");
}

// ============ 家长端：成就 + 提醒 + 字段边界 ============
section("家长端：成就 / 30 天提醒 / 禁用字段");
{
  // 先造一个已解决问题（成就三源之一）
  const pr = await (await call("/api/client/problem", jsonPost({
    s: "v13a", key: ckA, domain: "exam", title: "考试卡点问题",
    desired_outcome: "通过考试", strategy_summary: "卡点摘要甲", support_needed: "需要模考资源",
  }))).json();
  ok(pr.ok === true, "学生提出问题成功");
  const prStatus = await (await call("/api/client/problem/status", jsonPost({
    s: "v13a", key: ckA, id: pr.problem.id, progress: "resolved", resolved_note: "已约到模考",
  }))).json();
  ok(prStatus.ok === true, "问题标记解决成功");

  const pd = await getParent("v13a", pkA);
  const kinds = pd.achievements.map((a) => a.kind);
  ok(kinds.includes("milestone") && kinds.includes("action") && kinds.includes("problem"),
    "成就三源齐全（里程碑/已完成行动/已解决的问题）");
  ok(pd.achievements.every((a) => Object.keys(a).sort().join(",") === "date_text,kind,title"),
    "成就字段白名单只有 kind/title/date_text");
  const rems = pd.upcoming_reminders;
  const rb = rems.find((r) => r.kind === "birthday");
  ok(rb && rb.days_left === expectedBirthdayDaysLeft(BDAY, iso(new Date())), "生日提醒 days_left 与独立复算一致");
  ok(rems.some((r) => r.kind === "exam" && r.title === "护理入学考试"), "考试提醒只带事项名与日期");
  ok(rems.some((r) => r.kind === "milestone" && r.title === "护理先修里程碑"), "里程碑预计日期进提醒");
  ok(!rems.some((r) => r.title === "远期申请截止"), "40 天后的日期不进 30 天窗口");
  ok(rems.every((r) => Object.keys(r).sort().join(",") === "date,date_fmt,days_left,kind,title"),
    "提醒字段白名单（无分数/达标线/学分）");
  const raw = JSON.stringify(pd);
  for (const bad of ['"gpa"', '"attempts"', '"best_score"', '"pass_line"', '"total_score"', '"course_code"', '"credits_done"', '"diary"', '"journal"', '"mood"', '"emotion"']) {
    ok(!raw.includes(bad), "家长响应不含禁用字段 " + bad);
  }
  const pdB = await getParent("v13b", pkB);
  ok(Array.isArray(pdB.upcoming_reminders) && pdB.upcoming_reminders.length === 0, "无日期数据的学生 → 提醒空态（不编造）");
  ok(Array.isArray(pdB.achievements) && pdB.student_notes.length === 0, "学生乙家长页成就/一句话为空数组");
}

// ============ 导师目标硬规则 + 发件箱 ============
section("留言/升级的目标导师校验与发件箱");
{
  const m1 = await (await postMsg({ s: "v13a", key: ckA, body: "导师，我想确认下周安排" })).json();
  ok(m1.ok === true, "有可通知导师时留言成功");
  const ob1 = q("SELECT * FROM notifications_outbox WHERE student_id = ? AND event_type = 'student_message'", sidA);
  ok(ob1.length === 1 && ob1[0].status === "queued" && ob1[0].mentor_staff_id === M1 && ob1[0].channel === "email",
    "留言生成 queued 发件箱（收件导师甲、渠道=email）");
  ok(!JSON.stringify(ob1).includes("导师，我想确认下周安排"), "发件箱只记元数据、不含留言正文");

  // 指向不可通知导师 → 409 且不落库
  DB.raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(M2, sidA);
  const before = q1("SELECT COUNT(*) AS n FROM student_messages WHERE student_id = ?", sidA).n;
  const bad = await postMsg({ s: "v13a", key: ckA, body: "这条不该落库" });
  ok(bad.status === 409 && (await bad.json()).error === "mentor_not_notifiable", "导师不可通知 → 留言 409 明确报错");
  ok(q1("SELECT COUNT(*) AS n FROM student_messages WHERE student_id = ?", sidA).n === before, "被拒留言不落库");
  ok(q("SELECT * FROM notifications_outbox WHERE student_id = ?", sidA).length === 1, "被拒留言不生成发件箱");
  // 指向不存在的导师 → 409
  DB.raw.prepare("UPDATE students SET mentor_id = 99999 WHERE id = ?").run(sidA);
  ok((await postMsg({ s: "v13a", key: ckA, body: "无主留言" })).status === 409, "导师记录不存在 → 409");
  // 问题升级同样被拒
  const pr2 = await (await call("/api/client/problem", jsonPost({
    s: "v13a", key: ckA, domain: "study", title: "升级测试问题", desired_outcome: "x", strategy_summary: "y",
  }))).json();
  const escBad = await call("/api/client/problem/status", jsonPost({
    s: "v13a", key: ckA, id: pr2.problem.id, progress: "escalated" }));
  ok(escBad.status === 409, "导师不可通知 → 问题升级 409");
  ok(q1("SELECT progress FROM student_problem_shares WHERE id = ?", pr2.problem.id).progress === "open",
    "被拒升级不改问题状态");
  // 恢复可通知导师 → 升级成功 + 发件箱
  DB.raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(M1, sidA);
  const escOk = await (await call("/api/client/problem/status", jsonPost({
    s: "v13a", key: ckA, id: pr2.problem.id, progress: "escalated" }))).json();
  ok(escOk.ok === true, "导师可通知 → 升级成功");
  ok(q("SELECT * FROM notifications_outbox WHERE student_id = ? AND event_type = 'problem_escalated'", sidA).length === 1,
    "升级生成发件箱记录");
  // 存量学生（无导师）→ 旧口径落库、无发件箱
  const mC = await (await postMsg({ s: "v13c", key: ckC, body: "存量学生留言" })).json();
  ok(mC.ok === true && q("SELECT * FROM notifications_outbox WHERE student_id = ?", sidC).length === 0,
    "未分配导师的存量学生留言照常落库且不生成发件箱");
  // 轨迹新增 → 待回看发件箱
  const tr = await (await call("/api/client/trail", jsonPost({
    s: "v13a", key: ckA, action: "create", mentor_name: "导师甲", mentor_role: "lead", spirit_line: "稳住先修课节奏",
  }))).json();
  ok(tr.ok === true, "学生自建导师轨迹成功");
  ok(q("SELECT * FROM notifications_outbox WHERE student_id = ? AND event_type = 'trail_revisit'", sidA).length === 1,
    "轨迹新增生成待回看发件箱");
}

// ============ 导师工作台 ============
section("导师工作台：三块内容 / 越权 / 快速回复");
{
  // 家长留言哨兵（工作台不得出现）
  await enr({ student: { slug: "v13a" }, parent_messages: [{ sender: "parent", body: "SENTINEL_PARENT_MSG" }] });
  const wbRes = await call("/api/mentor/EMP-M01?key=mk_111111111111111111111111");
  const wb = await wbRes.json();
  ok(wbRes.status === 200 && wb.ok === true && wb.mentor.name === "导师甲", "导师甲工作台打开成功");
  ok(wb.students.length === 1 && wb.students[0].student.id === sidA, "工作台只含名下学生甲");
  const blk = wb.students[0];
  const evTypes = blk.recent_events.map((e) => e.event_type);
  ok(evTypes.includes("message_student") && evTypes.includes("problem_escalated") && evTypes.includes("parent_note_sent"),
    "近期动态含留言/升级/一句话事件");
  ok(blk.open_problems.some((p) => p.title === "升级测试问题" && p.support_needed !== undefined),
    "她的需求：未关闭问题带期望帮助字段");
  ok(blk.pending_actions.some((a) => a.title === "行动乙待办"), "她的需求：最近待办行动");
  ok(blk.trail_revisit_pending >= 1, "她的需求：待回看轨迹计数 ≥1");
  ok(blk.unread_messages.some((m) => m.body === "导师，我想确认下周安排"), "待回复：未读学生留言在列");
  const rawWb = JSON.stringify(wb);
  ok(!rawWb.includes("SENTINEL_PARENT_MSG"), "工作台不含家长留言内容");
  ok(!rawWb.includes("哨兵测试句") && !rawWb.includes("最近挺好的"), "工作台不含给爸妈的一句话正文");
  ok(!rawWb.includes('"diary"') && !rawWb.includes('"mood"'), "工作台响应无私密类字段");
  // 越权与交叉密钥
  ok((await call("/api/mentor/EMP-M01?key=mk_333333333333333333333333")).status === 404, "他人导师密钥 → 404");
  ok((await call("/api/mentor/EMP-M01?key=" + ckA)).status === 404, "学生密钥开工作台 → 404");
  ok((await call("/api/mentor/EMP-M01?key=" + pkA)).status === 404, "家长密钥开工作台 → 404");
  const wb3 = await (await call("/api/mentor/EMP-M03?key=mk_333333333333333333333333")).json();
  ok(wb3.students.length === 1 && wb3.students[0].student.id === sidB, "导师丙工作台只有学生乙");
  // 快速回复
  const rep = await (await call("/api/mentor/reply", jsonPost({
    s: "EMP-M01", key: "mk_111111111111111111111111", student_id: sidA, body: "工作台回复：周三晚细聊",
  }))).json();
  ok(rep.ok === true, "导师在工作台回复成功");
  const cd = await getClient("v13a", ckA);
  ok(cd.messages.some((m) => m.sender === "mentor" && m.body === "工作台回复：周三晚细聊"), "回复经留言通道到达学生端");
  const obAfter = q("SELECT status FROM notifications_outbox WHERE student_id = ? AND event_type = 'student_message'", sidA);
  ok(obAfter.every((r) => r.status === "responded"), "回复后留言类发件箱推进 responded");
  const wb2 = await (await call("/api/mentor/EMP-M01?key=mk_111111111111111111111111")).json();
  ok(wb2.students[0].unread_messages.length === 0, "回复后未读留言清零");
  ok(wb2.students[0].recent_events[0].event_type === "mentor_reply", "回复动作记入事件流且居首");
  const repBad = await call("/api/mentor/reply", jsonPost({
    s: "EMP-M01", key: "mk_111111111111111111111111", student_id: sidB, body: "越权回复" }));
  ok(repBad.status === 404, "回复非名下学生 → 404");
  ok(q("SELECT * FROM student_messages WHERE student_id = ? AND body = '越权回复'", sidB).length === 0,
    "越权回复不落库");
  const repPk = await call("/api/mentor/reply", jsonPost({
    s: "EMP-M01", key: pkA, student_id: sidA, body: "家长密钥回复" }));
  ok(repPk.status === 404, "家长密钥调导师回复 → 404");
}

// ============ 后台呈现 ============
section("后台：发件箱页 / 人员页导师口径 / 客户端页时间线 / summary");
{
  const loginRes = await call("/admin/login", form({ password: "test-pw" }));
  const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
  ok(cookie.includes("tog_admin"), "后台登录成功");
  const obPage = await (await call("/admin/outbox", {}, cookie)).text();
  ok(obPage.includes("导师通知发件箱") && obPage.includes("待转达"), "发件箱页呈现队列与诚实口径文案");
  const queuedRow = q1("SELECT id FROM notifications_outbox WHERE status = 'queued' LIMIT 1");
  ok(!!queuedRow, "仍有 queued 记录可供标记");
  await call("/admin/outbox", form({ action: "outbox_mark_sent", id: String(queuedRow.id) }), cookie);
  ok(q1("SELECT status FROM notifications_outbox WHERE id = ?", queuedRow.id).status === "sent",
    "手动标记已转达 → sent");
  const staffPage = await (await call("/admin/staff?edit=" + M2, {}, cookie)).text();
  ok(staffPage.includes("不可通知"), "缺联系方式导师在人员页标「不可通知」");
  const staffPage1 = await (await call("/admin/staff?edit=" + M1, {}, cookie)).text();
  ok(staffPage1.includes("mk_111111111111111111111111") && staffPage1.includes("mentor.html"),
    "人员页展示导师工作台密钥与链接");
  const clientPage = await (await call("/admin/client/" + sidA, {}, cookie)).text();
  ok(clientPage.includes("事件时间线") && clientPage.includes("默认导师") && clientPage.includes("给爸妈的一句话已推送"),
    "客户端页含导师指派卡与事件时间线");
  // 密钥重置：旧失效、新可用
  await call("/admin/staff", form({ action: "mentor_key_rotate", id: String(M1) }), cookie);
  ok((await call("/api/mentor/EMP-M01?key=mk_111111111111111111111111")).status === 404, "重置后旧密钥失效");
  const newKey = q1("SELECT mentor_key FROM staff WHERE id = ?", M1).mentor_key;
  ok(/^mk_[0-9a-f]{24}$/.test(newKey) && (await call("/api/mentor/EMP-M01?key=" + newKey)).status === 200,
    "重置后新密钥可用");
  // summary 计数与库一致
  const sum = await (await call("/api/admin/summary", { headers: { Authorization: "Bearer tok-123" } })).json();
  const dbCounts = { queued: 0, sent: 0, responded: 0 };
  for (const r of q("SELECT status, COUNT(*) AS n FROM notifications_outbox GROUP BY status")) dbCounts[r.status] = r.n;
  ok(sum.outbox && sum.outbox.queued === dbCounts.queued && sum.outbox.sent === dbCounts.sent &&
     sum.outbox.responded === dbCounts.responded, "summary.outbox 计数与发件箱表一致");
  // 事件流卫生：全部事件类型在白名单内、摘要不含私密哨兵
  const evAll = q("SELECT * FROM student_events");
  const TYPES = new Set(["action_completed", "problem_opened", "problem_resolved", "problem_escalated",
    "message_student", "message_mentor", "mentor_reply", "parent_note_sent", "parent_note_withdrawn",
    "trail_created", "parent_update_published"]);
  ok(evAll.length >= 8 && evAll.every((e) => TYPES.has(e.event_type)), "事件流类型全在方案层白名单内");
  ok(!JSON.stringify(evAll).includes("SENTINEL"), "事件流不含任何私密哨兵内容");
}

console.log("\n==== smoke-v13: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
