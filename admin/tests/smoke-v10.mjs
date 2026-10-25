// TransferOS 管理后台 v10 冒烟测试：九模块（时间线/关键日期/行动清单/愿景/寄语/知识卡/导师建议/导师沟通）
// + 补录接口 + 留言防刷与未读。以 v9 形态旧库起步，验迁移与全部新口径。
// 运行：node tests/smoke-v10.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
import { DatabaseSync } from "node:sqlite";
import worker, { knowledgeTagsFor, normClientExtras } from "./worker.mjs";

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
// —— 模拟 v9 库：students 有 client_key/slug/signature，无 v10 三列、无 v10 六表 ——
DB.raw.exec(`CREATE TABLE students(
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, order_id INTEGER,
  name TEXT, package TEXT, stage TEXT DEFAULT 'diag',
  stage_since TEXT, note TEXT, created_at TEXT, updated_at TEXT,
  client_key TEXT, slug TEXT, signature TEXT, signature_set_at TEXT)`);
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
const getClient = (loc, key) => call("/api/client/" + loc + "?key=" + key).then((r) => r.json());
const sendMsg = (obj) => call("/api/client/message", jsonPost(obj));

section("纯函数 knowledgeTagsFor：主题集合推导");
{
  const tags = knowledgeTagsFor(
    [{ line_type: "main", name: "素食调料包创业（代工生产 · 北美线上销售）" },
     { line_type: "passive", name: "空军预备役 4N0X1" },
     { line_type: "parallel", name: "学业" }],
    [{ exam_name: "入学考试" }], { target_school: "X" });
  ok(tags.includes("main") && tags.includes("passive") && tags.includes("parallel"), "含三条线类型");
  ok(tags.includes("business"), "线名含「创业」→ business");
  ok(tags.includes("exam") && tags.includes("study"), "有考试/目标 → exam + study");
  const bare = knowledgeTagsFor([], [], null);
  ok(bare.length === 0, "无任何数据 → 空集合（不下发知识卡）");
  const en = knowledgeTagsFor([{ line_type: "main", name: "My Business Plan" }], [], null);
  ok(en.includes("business"), "英文线名含 business → business");
}

section("纯函数 normClientExtras：校验与拒绝");
{
  const good = normClientExtras({
    milestones: [{ title: "入学", date_text: "2025 秋季", sort: 1 }],
    key_dates: [{ date: "2027-01-15", title: "申请截止" }],
    actions: [{ title: "交材料", status: "done" }],
    advice: [{ title: "建议一", body: "正文" }],
  });
  ok(!good.error && good.milestones.length === 1 && good.keyDates.length === 1 &&
    good.actions[0].status === "done" && good.advice.length === 1, "合法四段归一化通过");
  ok(normClientExtras({ milestones: [{ date_text: "x" }] }).error.includes("title"), "里程碑缺标题 → error");
  ok(normClientExtras({ key_dates: [{ date: "2027-13-40", title: "x" }] }).error.includes("YYYY-MM-DD"), "关键日期非法日期 → error");
  ok(normClientExtras({ actions: [{ title: "x", status: "weird" }] }).error.includes("status"), "行动项非法状态 → error");
}

section("迁移幂等：v9 旧库补三列 + 建六表");
{
  await call("/api/ping", jsonPost({ ref: "GD001", page: "/" }));
  const cols = DB.raw.prepare("PRAGMA table_info(students)").all().map((x) => x.name);
  ok(cols.includes("vision_text") && cols.includes("mentor_message") && cols.includes("mentor_message_at"),
    "students 已补 vision_text / mentor_message / mentor_message_at");
  const tables = DB.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
  for (const t of ["student_milestones", "student_key_dates", "student_actions", "knowledge_items", "student_advice", "student_messages"]) {
    ok(tables.includes(t), "表已建：" + t);
  }
  const r = await call("/api/ping", jsonPost({ ref: "GD001", page: "/" }));
  ok(r.status === 200, "重复 ensureSchema 不报错");
}

let sid, skey;
section("导入新学生：vision_text + 四段新数据一次灌入");
{
  const r = await imp({
    student: { name: "V10 Tester", slug: "v10-tester", vision_text: "成为一名护士" },
    goal: { target_school: "目标护理项目", school_system: "CUNY" },
    goal_lines: [
      { name: "小生意创业计划", line_type: "main", priority: 1, status: "active" },
      { name: "预备役申请", line_type: "passive", priority: 2, status: "active" },
    ],
    exams: [{ exam_name: "护理入学考试", result: "fail" }],
    milestones: [
      { date_text: "2025 秋季", title: "入学", detail: "细节", kind: "school", sort: 2 },
      { date_text: "", title: "考试未达标", sort: 1 },
    ],
    key_dates: [{ date: "2027-03-01", title: "申请截止" }],
    actions: [
      { title: "补齐考试信息", status: "todo", sort: 1 },
      { title: "已做的事", status: "done", sort: 2 },
    ],
    advice: [{ title: "先补信息", body: "正文一", sort: 1 }],
  });
  const j = await r.json();
  ok(r.status === 200 && j.ok && !j.existed, "导入成功");
  ok(j.counts.milestones === 2 && j.counts.key_dates === 1 && j.counts.actions === 2 && j.counts.advice === 1,
    "counts 含新四段（" + JSON.stringify(j.counts) + "）");
  sid = j.student_id; skey = j.client_key;
  const bad = await imp({
    student: { name: "Bad Kid" },
    key_dates: [{ date: "not-a-date", title: "x" }],
  });
  ok(bad.status === 400, "导入带非法关键日期 → 整单 400");
  const ghost = await DB.raw.prepare("SELECT id FROM students WHERE name='Bad Kid'").get();
  ok(!ghost, "400 后未留半截学生");
}

section("只读接口：新字段形态与排序");
{
  const d = await getClient("v10-tester", skey);
  ok(d.vision_text === "成为一名护士", "vision_text 下发");
  ok(d.mentor_message === "" && d.mentor_message_at === "", "寄语未写 → 空串");
  ok(Array.isArray(d.milestones) && d.milestones.length === 2 && d.milestones[0].title === "考试未达标",
    "milestones 按 sort 升序");
  ok(d.milestones[1].date_text === "2025 秋季" && d.milestones[0].date_text === "", "date_text 原样（空不编造）");
  ok(d.key_dates.length === 1 && d.key_dates[0].date === "2027-03-01", "key_dates 下发");
  ok(d.actions.length === 2 && d.actions[1].status_label === "已完成", "actions 带状态中文标签");
  ok(d.advice.length === 1 && d.advice[0].title === "先补信息", "advice 下发");
  ok(Array.isArray(d.messages) && d.messages.length === 0 && d.unread_mentor === 0, "messages 空 + 未读 0");
}

section("知识卡：全局维护 + 按主题匹配下发（停用不下发 / 上限）");
{
  const loginRes = await call("/admin/login", form({ password: "test-pw" }));
  const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];
  const add = (title, body, tag, enabled) =>
    call("/admin/knowledge", form({ action: "knowledge_add", title, body, tag, enabled: String(enabled) }), cookie);
  await add("先修课时效", "正文A", "study", 1);
  await add("创业标签常识", "正文B", "business", 1);
  await add("预备役顺序", "正文C", "passive", 1);
  await add("停用的一条", "正文D", "study", 0);
  await add("无关标签", "正文E", "cooking", 1);
  const d = await getClient("v10-tester", skey);
  const titles = d.knowledge.map((k) => k.title);
  ok(titles.includes("先修课时效") && titles.includes("创业标签常识") && titles.includes("预备役顺序"),
    "study/business/passive 三个主题均命中（" + titles.join("、") + "）");
  ok(!titles.includes("停用的一条"), "enabled=0 不下发");
  ok(!titles.includes("无关标签"), "主题不匹配不下发");
  const page = await (await call("/admin/knowledge", {}, cookie)).text();
  ok(page.includes("知识库") && page.includes("先修课时效"), "后台知识库页渲染条目");
}

section("补录接口：鉴权 / 定位 / 去重 / 改名 / 寄语补丁");
{
  const noTok = await call("/api/admin/students/enrich", jsonPost({ student: { slug: "v10-tester" } }));
  ok(noTok.status === 401, "无 token → 401");
  const ghost = await enr({ student: { slug: "nobody" }, milestones: [{ title: "x" }] });
  ok(ghost.status === 404, "学生不存在 → 404");
  const r1 = await enr({
    student: { slug: "v10-tester" },
    student_patch: { mentor_message: "导师原话一句" },
    goal_line_renames: [{ from: "小生意创业计划", to: "调料包创业（代工生产 · 北美线上销售）" }],
    milestones: [{ title: "入学" }, { title: "新里程碑", sort: 9 }],
    advice: [{ title: "先补信息", body: "重复应跳过" }, { title: "第二条建议", body: "正文二" }],
    knowledge: [{ title: "先修课时效", body: "重复应跳过", tag: "study" }, { title: "新知识", body: "正文F", tag: "exam" }],
  });
  const j1 = await r1.json();
  ok(r1.status === 200 && j1.ok, "补录成功");
  ok(j1.counts.milestones.inserted === 1 && j1.counts.milestones.skipped === 1, "milestones 按标题去重");
  ok(j1.counts.advice.inserted === 1 && j1.counts.advice.skipped === 1, "advice 按标题去重");
  ok(j1.counts.knowledge.inserted === 1 && j1.counts.knowledge.skipped === 1, "knowledge 按标题去重");
  const line = DB.raw.prepare("SELECT name FROM student_goal_lines WHERE student_id=? AND line_type='main'").get(sid);
  ok(line.name === "调料包创业（代工生产 · 北美线上销售）", "人生线改名落库");
  const d = await getClient("v10-tester", skey);
  ok(d.mentor_message === "导师原话一句" && !!d.mentor_message_at, "寄语补丁下发且带时间");
  ok(d.advice.length === 2 && d.advice[0].title === "第二条建议", "advice 按时间倒序（新在前）");
}

section("导师沟通：学生发信 / 未读流转 / 导师后台回复");
{
  // 导师先经补录种一条留言（模拟导师已发）
  await enr({ student: { slug: "v10-tester" }, messages: [{ sender: "mentor", body: "导师的一条留言" }] });
  const d1 = await getClient("v10-tester", skey);
  ok(d1.messages.length === 1 && d1.messages[0].sender_label === "导师", "线程含导师留言");
  ok(d1.unread_mentor === 1, "首次 GET 未读导师留言 = 1");
  const d2 = await getClient("v10-tester", skey);
  ok(d2.unread_mentor === 0, "已读后再次 GET 未读 = 0");
  // 学生发信
  const wrong = await sendMsg({ s: "v10-tester", key: "ck_000000000000000000000000", body: "你好" });
  ok(wrong.status === 404, "错 key 发信 → 404");
  const empty = await sendMsg({ s: "v10-tester", key: skey, body: "   " });
  ok(empty.status === 400, "空正文 → 400");
  const tooLong = await sendMsg({ s: "v10-tester", key: skey, body: "长".repeat(501) });
  ok(tooLong.status === 400, "501 字 → 400");
  const get405 = await call("/api/client/message", { method: "GET" });
  ok(get405.status === 405, "GET 该路径 → 405");
  const good = await sendMsg({ s: "v10-tester", key: skey, body: "老师，我的问题是……" });
  const gj = await good.json();
  ok(good.status === 200 && gj.ok && gj.message.sender === "student", "学生发信成功");
  const row = DB.raw.prepare("SELECT read_by_mentor FROM student_messages WHERE id=?").get(gj.message.id);
  ok(row.read_by_mentor === 0, "学生新留言导师侧未读");
  // 后台：未读计数 + 线程 + 回复
  const loginRes = await call("/admin/login", form({ password: "test-pw" }));
  const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];
  const page = await (await call("/admin/client/" + sid, {}, cookie)).text();
  ok(page.includes("老师，我的问题是……"), "后台客户端页显示学生留言");
  ok(page.includes("1 条待回复"), "后台显示待回复计数");
  ok(page.includes('value="message_reply"'), "后台有回复表单");
  const rowAfterOpen = DB.raw.prepare("SELECT read_by_mentor FROM student_messages WHERE id=?").get(gj.message.id);
  ok(rowAfterOpen.read_by_mentor === 0, "v19：只打开后台页不标已读（回复后才标）");
  await call("/admin/client/" + sid, form({ action: "message_reply", body: "导师的回复" }), cookie);
  const page2 = await (await call("/admin/client/" + sid, {}, cookie)).text();
  ok(!page2.includes("条待回复"), "回复后 → 待回复计数消失");
  const d3 = await getClient("v10-tester", skey);
  ok(d3.messages.length === 3 && d3.messages[2].body === "导师的回复", "导师回复进入线程");
  ok(d3.unread_mentor === 1, "导师新回复 → 学生未读 = 1");
}

section("留言防刷：60 秒内第 4 条 → 429");
{
  const r = await imp({ student: { name: "Spam Tester", slug: "spam-tester" } });
  const j = await r.json();
  const k = j.client_key;
  const s1 = await sendMsg({ s: "spam-tester", key: k, body: "一" });
  const s2 = await sendMsg({ s: "spam-tester", key: k, body: "二" });
  const s3 = await sendMsg({ s: "spam-tester", key: k, body: "三" });
  const s4 = await sendMsg({ s: "spam-tester", key: k, body: "四" });
  ok(s1.status === 200 && s2.status === 200 && s3.status === 200, "前 3 条放行");
  ok(s4.status === 429, "第 4 条 → 429");
  const cnt = DB.raw.prepare("SELECT COUNT(*) AS n FROM student_messages WHERE student_id=?").get(j.student_id);
  ok(cnt.n === 3, "被限流的第 4 条未落库");
}

section("后台客户端页：v10 表单齐全 + 里程碑/关键日期/行动项 CRUD");
{
  const loginRes = await call("/admin/login", form({ password: "test-pw" }));
  const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];
  const page = await (await call("/admin/client/" + sid, {}, cookie)).text();
  for (const act of ["profile_save", "milestone_add", "keydate_add", "action_add", "advice_add"]) {
    ok(page.includes('value="' + act + '"'), "客户端页含表单：" + act);
  }
  ok(page.includes("导师原话一句"), "客户端页展示当前寄语");
  await call("/admin/client/" + sid, form({ action: "milestone_add", title: "后台加的里程碑", date_text: "2026 春季", sort: "7" }), cookie);
  let row = DB.raw.prepare("SELECT * FROM student_milestones WHERE student_id=? AND title='后台加的里程碑'").get(sid);
  ok(!!row && row.date_text === "2026 春季", "后台新增里程碑落库");
  await call("/admin/client/" + sid, form({ action: "milestone_delete", id: String(row.id) }), cookie);
  row = DB.raw.prepare("SELECT * FROM student_milestones WHERE id=?").get(row.id);
  ok(!row, "后台删除里程碑生效");
  await call("/admin/client/" + sid, form({ action: "keydate_add", title: "后台关键日期", date: "2027-05-01" }), cookie);
  const kd = DB.raw.prepare("SELECT * FROM student_key_dates WHERE student_id=? AND title='后台关键日期'").get(sid);
  ok(!!kd && kd.date === "2027-05-01", "后台新增关键日期落库");
  await call("/admin/client/" + sid, form({ action: "action_add", title: "后台行动项", status: "todo", sort: "5" }), cookie);
  const ac = DB.raw.prepare("SELECT * FROM student_actions WHERE student_id=? AND title='后台行动项'").get(sid);
  ok(!!ac, "后台新增行动项落库");
  await call("/admin/client/" + sid, form({ action: "profile_save", mentor_message: "", vision_text: "新愿景" }), cookie);
  const stu = DB.raw.prepare("SELECT mentor_message, vision_text FROM students WHERE id=?").get(sid);
  ok(stu.mentor_message === null && stu.vision_text === "新愿景", "profile_save：清空寄语 + 更新愿景");
}

console.log("\n==== smoke-v10: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
