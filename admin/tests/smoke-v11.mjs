// TransferOS 管理后台 v11 冒烟测试：家长更新（parent_key 独立密钥 + 家长三表 + 家长接口数据边界）
// + 后台家长端区 + enrich 家长三段。以 v10 形态旧库起步（students 无 parent_key、无家长三表），验迁移。
// 数据边界是本轮核心：家长接口响应做禁用字段/敏感值全量扫描（哨兵字符串 + 字段名 + 密钥值）。
// 运行：node tests/smoke-v11.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
import { DatabaseSync } from "node:sqlite";
import worker, { normParentExtras, genParentKey } from "./worker.mjs";

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
// —— 模拟 v10 库：students 有 v10 三列，无 parent_key、无家长三表 ——
DB.raw.exec(`CREATE TABLE students(
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, order_id INTEGER,
  name TEXT, package TEXT, stage TEXT DEFAULT 'diag',
  stage_since TEXT, note TEXT, created_at TEXT, updated_at TEXT,
  client_key TEXT, slug TEXT, signature TEXT, signature_set_at TEXT,
  vision_text TEXT, mentor_message TEXT, mentor_message_at TEXT)`);
DB.raw.exec(`CREATE UNIQUE INDEX idx_students_slug ON students(slug)`);

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
const getParentRaw = (loc, key) => call("/api/parent/" + loc + (key !== undefined ? "?key=" + encodeURIComponent(key) : ""));
const getParent = (loc, key) => getParentRaw(loc, key).then((r) => r.json());
const getClient = (loc, key) => call("/api/client/" + loc + "?key=" + key).then((r) => r.json());
const sendParentMsg = (obj) => call("/api/parent/message", jsonPost(obj));

section("纯函数：genParentKey / normParentExtras");
{
  const k1 = genParentKey(), k2 = genParentKey();
  ok(/^pk_[0-9a-f]{24}$/.test(k1), "parent_key 格式 pk_ + 24 位十六进制");
  ok(k1 !== k2, "两次生成不重复");
  const good = normParentExtras({
    parent_updates: [{ title: "进展一", body: "正文" }],
    parent_support_actions: [{ title: "事项一" }],
    parent_messages: [{ body: "家长你好" }],
  });
  ok(!good.error && good.parentUpdates.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(good.parentUpdates[0].update_date),
    "更新缺日期 → 默认今天");
  ok(good.parentSupport[0].status === "active", "托举事项缺状态 → 默认 active");
  ok(good.parentMessages[0].sender === "mentor", "家长留言缺 sender → 默认 mentor");
  ok(normParentExtras({ parent_updates: [{ body: "x" }] }).error.includes("title"), "更新缺标题 → error");
  ok(normParentExtras({ parent_updates: [{ title: "x", update_date: "2026-13-01" }] }).error.includes("YYYY-MM-DD"), "更新日期非法 → error");
  ok(normParentExtras({ parent_support_actions: [{ title: "x", status: "weird" }] }).error.includes("status"), "托举事项非法状态 → error");
  ok(normParentExtras({ parent_messages: [{ sender: "student", body: "x" }] }).error.includes("sender"), "家长留言 sender=student → error（不得混用学生身份）");
  ok(normParentExtras({ parent_messages: [{ body: "" }] }).error.includes("body"), "家长留言空正文 → error");
}

section("迁移幂等：v10 旧库补 parent_key 列 + 建家长三表");
{
  await call("/api/ping", jsonPost({ ref: "GD001", page: "/" }));
  const cols = DB.raw.prepare("PRAGMA table_info(students)").all().map((x) => x.name);
  ok(cols.includes("parent_key"), "students 已补 parent_key");
  const tables = DB.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
  for (const tb of ["parent_updates", "parent_support_actions", "parent_messages"]) {
    ok(tables.includes(tb), "表已建：" + tb);
  }
  const r = await call("/api/ping", jsonPost({ ref: "GD001", page: "/" }));
  ok(r.status === 200, "重复 ensureSchema 不报错");
}

let sid, ckey, pkey;
section("导入学生（带全套敏感哨兵数据）+ parent_key 生成");
{
  const r = await imp({
    student: { name: "ParentFix", slug: "parent-fix", package: "一对一辅导", note: "SENTINEL_NOTE", vision_text: "SENTINEL_VISION" },
    goal: { target_school: "SENTINEL_SCHOOL", gpa_target: "3.9" },
    goal_lines: [{ name: "主线", line_type: "main", priority: 1, next_step: "SENTINEL_NEXTSTEP" }],
    status: [{ snapshot_date: "2026-06-01", gpa: 3.481, credits_done: 55, credits_total: 120, note: "SENTINEL_SNAPNOTE" }],
    exams: [{ exam_name: "护理入学考试 SENTINEL_EXAM", score: "SENTINEL_SCORE", pass_line: "80", result: "fail" }],
    courses: [{ term: "2026 春季", course_code: "BIO 150", course_name: "SENTINEL_COURSE", status: "done", grade: "B" }],
    meetings: [{ meeting_date: "2026-05-01", topic: "SENTINEL_TOPIC", summary: "SENTINEL_SUMMARY" }],
  });
  const j = await r.json();
  ok(r.status === 200 && j.ok && !j.existed, "导入成功");
  sid = j.student_id; ckey = j.client_key; pkey = j.parent_key;
  ok(/^ck_[0-9a-f]{24}$/.test(ckey), "client_key 正常生成");
  ok(/^pk_[0-9a-f]{24}$/.test(pkey), "parent_key 随导入生成");
  ok(ckey !== pkey, "两把密钥不同");
  DB.raw.prepare("UPDATE students SET signature = 'SENTINEL_SIGNATURE', signature_set_at = '2026-06-01T00:00:00.000Z' WHERE id = ?").run(sid);
  const e = await enr({
    student: { slug: "parent-fix" },
    messages: [
      { sender: "student", body: "SENTINEL_STUDENT_MSG" },
      { sender: "mentor", body: "SENTINEL_MENTOR_MSG" },
    ],
  });
  const ej = await e.json();
  ok(ej.ok && ej.counts.messages.inserted === 2, "学生留言哨兵已灌入（学生端专用）");
}

const PARENT_PAYLOAD = {
  student: { slug: "parent-fix" },
  parent_updates: [{
    update_date: "2026-06-01", title: "评估诊断阶段进展",
    body: "目前处于评估诊断阶段，资料正在统一核对。",
    current_focus: "核对学业记录与考试信息", next_step: "资料完整后形成考试策略",
  }],
  parent_support_actions: [
    { title: "补充考试相关材料", detail: "如家长掌握考试名称或成绩通知，请发给导师。", status: "active", sort: 2 },
    { title: "保留稳定节奏", detail: "保留稳定的学习与休息时间。", status: "active", sort: 1 },
    { title: "已寄出材料清单", detail: "已完成。", status: "done", sort: 3 },
  ],
  parent_messages: [{ sender: "mentor", body: "导师给家长的第一句话 FIX" }],
};
section("enrich 家长三段：灌入 + 幂等 + 非法整单拒绝");
{
  const r1 = await enr(PARENT_PAYLOAD);
  const j1 = await r1.json();
  ok(j1.ok && j1.counts.parent_updates.inserted === 1 && j1.counts.parent_support_actions.inserted === 3 &&
    j1.counts.parent_messages.inserted === 1, "三段插入计数正确（" + JSON.stringify(j1.counts.parent_updates) + "/" +
    JSON.stringify(j1.counts.parent_support_actions) + "/" + JSON.stringify(j1.counts.parent_messages) + "）");
  ok(j1.parent_key === pkey, "enrich 回传同一 parent_key（不重复生成）");
  const r2 = await enr(PARENT_PAYLOAD);
  const j2 = await r2.json();
  ok(j2.counts.parent_updates.inserted === 0 && j2.counts.parent_updates.skipped === 1 &&
    j2.counts.parent_support_actions.inserted === 0 && j2.counts.parent_support_actions.skipped === 3 &&
    j2.counts.parent_messages.inserted === 0 && j2.counts.parent_messages.skipped === 1, "重复 enrich 全部 skipped（幂等）");
  const badUp = await enr({ student: { slug: "parent-fix" }, parent_updates: [{ body: "无标题" }] });
  ok(badUp.status === 400, "家长更新缺标题 → 整单 400");
  const badSt = await enr({ student: { slug: "parent-fix" }, parent_support_actions: [{ title: "x", status: "nope" }] });
  ok(badSt.status === 400, "托举事项非法状态 → 整单 400");
  const n = DB.raw.prepare("SELECT COUNT(*) AS n FROM parent_updates WHERE student_id = ?").get(sid).n;
  ok(n === 1, "400 后无半截写入");
}

section("家长接口：字段形态、排序、未读口径");
{
  const d = await getParent("parent-fix", pkey);
  ok(d.ok === true, "slug + parent_key 可读");
  const topKeys = Object.keys(d).sort().join(",");
  // v13.4 适配：顶层新增 concerns（需要关注），白名单由 9 键扩为 10 键，其余不变
  ok(topKeys === "achievements,concerns,messages,ok,student,student_notes,support_actions,unread_mentor_parent,upcoming_reminders,updates",
    "顶层字段恰为白名单（v13 扩展：+achievements/student_notes/upcoming_reminders；v13.4 扩展：+concerns；其余 v11 不变）（" + topKeys + "）");
  const stuKeys = Object.keys(d.student).sort().join(",");
  ok(stuKeys === "name,package,slug,stage,stage_label", "student 字段恰为白名单（" + stuKeys + "）");
  ok(d.student.name === "ParentFix" && d.student.stage === "diag" && d.student.stage_label === "评估诊断" &&
    d.student.package === "一对一辅导", "姓名/阶段/阶段中文名/套餐正确");
  ok(d.updates.length === 1 && d.updates[0].title === "评估诊断阶段进展" && d.updates[0].update_date === "2026-06-01" &&
    d.updates[0].current_focus === "核对学业记录与考试信息", "家长更新下发");
  ok(d.support_actions.length === 3 && d.support_actions[0].title === "保留稳定节奏" &&
    d.support_actions[1].title === "补充考试相关材料" && d.support_actions[2].status === "done" &&
    d.support_actions[2].status_label === "已完成", "托举事项 active 按 sort 在前、done 在后、带状态标签");
  ok(d.messages.length === 1 && d.messages[0].sender === "mentor" && d.messages[0].sender_label === "导师",
    "家长留言线程下发（仅家长↔导师）");
  ok(d.unread_mentor_parent === 1, "首次读取未读导师留言 = 1");
  const d2 = await getParent(sid, pkey);
  ok(d2.ok && d2.unread_mentor_parent === 0, "id 定位可读；二次读取未读归 0（读取即标记已读）");
}

section("家长接口：禁用字段与敏感值全量扫描");
{
  const raw = await (await getParentRaw("parent-fix", pkey)).text();
  const bannedValues = ["SENTINEL_NOTE", "SENTINEL_VISION", "SENTINEL_SCHOOL", "SENTINEL_NEXTSTEP",
    "SENTINEL_SNAPNOTE", "SENTINEL_EXAM", "SENTINEL_SCORE", "SENTINEL_COURSE", "SENTINEL_TOPIC",
    "SENTINEL_SUMMARY", "SENTINEL_SIGNATURE", "SENTINEL_STUDENT_MSG", "SENTINEL_MENTOR_MSG",
    "3.481", ckey, pkey];
  for (const v of bannedValues) ok(!raw.includes(v), "响应不含敏感值：" + (v === ckey ? "<client_key>" : v === pkey ? "<parent_key>" : v));
  const bannedFields = ['"exams"', '"courses"', '"meetings"', '"history"', '"student_messages"',
    '"client_key"', '"parent_key"', '"signature"', '"gpa"', '"goal"', '"goal_lines"', '"vision_text"',
    '"mentor_message"', '"credits_done"', '"credits_total"', '"key_dates"', '"milestones"', '"actions"', '"advice"',
    '"diary"', '"journal"', '"mood"', '"emotion"', '"feelings"', '"private_notes"'];
  for (const f of bannedFields) ok(!raw.includes(f), "响应不含禁用字段：" + f);
}

section("家长接口鉴权：交叉密钥与异常一律 404");
{
  ok((await getParentRaw("parent-fix", ckey)).status === 404, "学生 client_key 查家长接口 → 404");
  ok((await call("/api/client/parent-fix?key=" + encodeURIComponent(pkey))).status === 404, "家长 parent_key 查学生接口 → 404");
  ok((await getParentRaw("parent-fix", undefined)).status === 404, "无 key → 404");
  ok((await getParentRaw("parent-fix", "pk_000000000000000000000000")).status === 404, "错 key → 404");
  ok((await getParentRaw("parent-fix", "")).status === 404, "空 key → 404");
  ok((await getParentRaw("no-such-student", pkey)).status === 404, "学生不存在 → 404");
  ok((await getParentRaw("99999", pkey)).status === 404, "不存在的 id → 404");
  const d = await getClient("parent-fix", ckey);
  ok(d.ok && d.student.name === "ParentFix", "学生端用自己的密钥仍正常（未受家长功能影响）");
  ok(d.messages.length === 2 && d.messages[0].body === "SENTINEL_STUDENT_MSG", "学生留言仍在学生端（与家长线程隔离）");
}

section("无套餐学生：package 字段不出现");
let sid2, pkey2;
{
  const r = await imp({ student: { name: "NoPkg", slug: "no-pkg" } });
  const j = await r.json();
  sid2 = j.student_id; pkey2 = j.parent_key;
  const d = await getParent("no-pkg", pkey2);
  ok(d.ok && !("package" in d.student), "未设套餐 → 不返回 package 字段");
  ok(Array.isArray(d.updates) && d.updates.length === 0 && d.support_actions.length === 0 &&
    d.messages.length === 0 && d.unread_mentor_parent === 0, "空数据四段齐全且为空（前端可优雅占位）");
  ok((await getParentRaw("no-pkg", pkey)).status === 404, "他人 parent_key 查本学生 → 404");
}

section("家长留言 POST：鉴权 / 长度 / 落库标记");
{
  const good = await sendParentMsg({ s: "parent-fix", key: pkey, body: "家长的第一条留言" });
  const gj = await good.json();
  ok(good.status === 200 && gj.ok && gj.message.sender === "parent", "家长留言发送成功");
  const row = DB.raw.prepare("SELECT * FROM parent_messages WHERE id = ?").get(gj.message.id);
  ok(row && row.read_by_parent === 1 && row.read_by_mentor === 0, "落库标记：家长已读、导师未读");
  ok((await sendParentMsg({ s: "parent-fix", key: ckey, body: "x" })).status === 404, "学生密钥发家长留言 → 404");
  ok((await sendParentMsg({ s: "parent-fix", key: "pk_bad", body: "x" })).status === 404, "错密钥 → 404");
  ok((await sendParentMsg({ s: "ghost", key: pkey, body: "x" })).status === 404, "学生不存在 → 404");
  ok((await sendParentMsg({ s: "parent-fix", key: pkey, body: "   " })).status === 400, "空正文 → 400");
  ok((await sendParentMsg({ s: "parent-fix", key: pkey, body: "长".repeat(501) })).status === 400, "501 字 → 400");
  const exact = await sendParentMsg({ s: "parent-fix", key: pkey, body: "长".repeat(500) });
  ok(exact.status === 200, "恰好 500 字 → 通过");
  const d = await getParent("parent-fix", pkey);
  const parentMsgs = d.messages.filter((m) => m.sender === "parent");
  ok(parentMsgs.length === 2 && parentMsgs[0].body === "家长的第一条留言", "家长留言进入家长线程（按时间正序）");
  const dc = await getClient("parent-fix", ckey);
  ok(!dc.messages.some((m) => m.body.includes("家长的第一条留言")), "家长留言不进学生线程（双向隔离）");
}

section("家长留言防刷：60 秒内第 4 条 429");
{
  for (let i = 1; i <= 3; i++) {
    const r = await sendParentMsg({ s: "no-pkg", key: pkey2, body: "刷屏测试 " + i });
    ok(r.status === 200, "第 " + i + " 条通过");
  }
  const r4 = await sendParentMsg({ s: "no-pkg", key: pkey2, body: "刷屏测试 4" });
  ok(r4.status === 429, "第 4 条 → 429");
  const n = DB.raw.prepare("SELECT COUNT(*) AS n FROM parent_messages WHERE student_id = ? AND sender = 'parent'").get(sid2).n;
  ok(n === 3, "429 的留言未落库");
}

section("后台客户端页：家长端区（链接/更新/托举/沟通/重置）");
{
  const loginRes = await call("/admin/login", form({ password: "test-pw" }));
  const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];
  const page = await (await call("/admin/client/" + sid, {}, cookie)).text();
  ok(page.includes("家长端（家长更新）"), "页面含家长端区");
  ok(page.includes("parent.html?s=parent-fix&amp;p=" + pkey), "页面展示家长专属链接");
  ok(page.includes("评估诊断阶段进展"), "页面列出家长更新");
  ok(page.includes("补充考试相关材料"), "页面列出托举事项");
  ok(page.includes("家长的第一条留言"), "页面展示家长沟通线程");
  ok(page.includes("只填写可向家长公开的方案与进展，不录入学生日记、情绪原文或私密困惑"),
    "录入区旁固定说明在页（不录入学生日记/情绪原文/私密困惑）");
  ok(page.includes("阶段进展（给家长看的整理版正文）") && page.includes("当前解决策略"),
    "录入字段口径：阶段进展 / 当前解决策略 / 下一步");
  ok(page.includes("1 条未读"), "页面显示家长未读数");
  const after = DB.raw.prepare("SELECT read_by_mentor FROM parent_messages WHERE student_id = ? AND sender = 'parent'").all(sid);
  ok(after.every((m) => m.read_by_mentor === 1), "打开后台页后家长留言已标导师已读");
  // 后台新增/编辑
  await call("/admin/client/" + sid, form({
    action: "parent_update_add", update_date: "2026-07-01", title: "后台新增更新",
    body: "正文", current_focus: "重点", next_step: "下一步",
  }), cookie);
  let d = await getParent("parent-fix", pkey);
  ok(d.updates.length === 2 && d.updates[0].title === "后台新增更新", "后台新增家长更新 → 接口按日期倒序置顶");
  const newId = DB.raw.prepare("SELECT id FROM parent_updates WHERE title = '后台新增更新'").get().id;
  await call("/admin/client/" + sid, form({
    action: "parent_update_update", id: String(newId), update_date: "2026-07-02", title: "后台改过的更新",
    body: "改后正文", current_focus: "", next_step: "",
  }), cookie);
  d = await getParent("parent-fix", pkey);
  ok(d.updates[0].title === "后台改过的更新" && d.updates[0].update_date === "2026-07-02", "后台编辑家长更新生效");
  await call("/admin/client/" + sid, form({ action: "parent_update_delete", id: String(newId) }), cookie);
  d = await getParent("parent-fix", pkey);
  ok(d.updates.length === 1, "后台删除家长更新生效");
  await call("/admin/client/" + sid, form({
    action: "parent_support_add", title: "后台新增事项", detail: "细节", status: "active", sort: "0",
  }), cookie);
  d = await getParent("parent-fix", pkey);
  ok(d.support_actions[0].title === "后台新增事项", "后台新增托举事项 → sort 最小排最前");
  const psId = DB.raw.prepare("SELECT id FROM parent_support_actions WHERE title = '后台新增事项'").get().id;
  await call("/admin/client/" + sid, form({
    action: "parent_support_update", id: String(psId), title: "后台新增事项", detail: "细节",
    status: "done", sort: "0",
  }), cookie);
  d = await getParent("parent-fix", pkey);
  ok(d.support_actions[2].title === "后台新增事项" && d.support_actions[2].status === "done" &&
    d.support_actions.slice(0, 2).every((a) => a.status === "active"),
    "托举事项改 done → 落入 done 组（active 仍在前，组内按 sort）");
  await call("/admin/client/" + sid, form({ action: "parent_support_delete", id: String(psId) }), cookie);
  d = await getParent("parent-fix", pkey);
  ok(!d.support_actions.some((a) => a.title === "后台新增事项"), "后台删除托举事项生效");
  // 导师回复家长
  await call("/admin/client/" + sid, form({ action: "parent_message_reply", body: "导师后台回复 FIX" }), cookie);
  d = await getParent("parent-fix", pkey);
  ok(d.messages.some((m) => m.body === "导师后台回复 FIX" && m.sender === "mentor"), "导师回复进入家长线程");
  ok(d.unread_mentor_parent === 1, "导师回复产生家长未读 = 1");
  // 重置家长密钥：旧失效、新可用、学生密钥不受影响
  await call("/admin/client/" + sid, form({ action: "parent_key_rotate" }), cookie);
  const newKey = DB.raw.prepare("SELECT parent_key FROM students WHERE id = ?").get(sid).parent_key;
  ok(/^pk_[0-9a-f]{24}$/.test(newKey) && newKey !== pkey, "重置生成新 parent_key");
  ok((await getParentRaw("parent-fix", pkey)).status === 404, "旧家长链接立即失效 → 404");
  ok((await getParentRaw("parent-fix", newKey)).status === 200, "新家长链接可用");
  const dc = await getClient("parent-fix", ckey);
  ok(dc.ok === true, "重置家长密钥不影响学生端");
  pkey = newKey;
  // 私密原文不承接：enrich 载荷夹带 diary/journal/mood/emotion → 公开字段照常灌入，私密载荷丢弃不回传
  const rd = await enr({
    student: { slug: "parent-fix" },
    parent_updates: [{ title: "私密字段载荷测试", body: "这是可公开的正文", diary: "SENTINEL_DIARY", journal: "SENTINEL_JOURNAL", mood: "SENTINEL_MOOD", emotion: "SENTINEL_EMOTION" }],
  });
  const rdj = await rd.json();
  ok(rdj.ok && rdj.counts.parent_updates.inserted === 1, "夹带私密字段的更新：公开字段照常灌入");
  const rawD = await (await getParentRaw("parent-fix", pkey)).text();
  ok(rawD.includes("这是可公开的正文"), "公开正文照常下发");
  ok(!rawD.includes("SENTINEL_DIARY") && !rawD.includes("SENTINEL_JOURNAL") &&
    !rawD.includes("SENTINEL_MOOD") && !rawD.includes("SENTINEL_EMOTION"),
    "diary/journal/mood/emotion 载荷不进家长接口（不预留、不回传）");
}

section("删除学生：家长三表一并清理");
{
  const loginRes = await call("/admin/login", form({ password: "test-pw" }));
  const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];
  await enr({
    student: { slug: "no-pkg" },
    parent_updates: [{ title: "待删更新" }],
    parent_support_actions: [{ title: "待删事项" }],
  });
  await call("/admin/delivery", form({ action: "delete", id: String(sid2) }), cookie);
  for (const tb of ["parent_updates", "parent_support_actions", "parent_messages"]) {
    const n = DB.raw.prepare("SELECT COUNT(*) AS n FROM " + tb + " WHERE student_id = ?").get(sid2).n;
    ok(n === 0, "删除后 " + tb + " 无残留");
  }
  ok((await getParentRaw("no-pkg", pkey2)).status === 404, "删除后家长接口 → 404");
  const alive = await getParent("parent-fix", pkey);
  ok(alive.ok === true, "其他学生家长数据不受影响");
}

console.log("\n==== smoke-v11: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
