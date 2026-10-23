// TransferOS 管理后台 v16 冒烟测试：系统自动邮件通知（Resend）。
// 覆盖：email 渠道导师生成通知 → 自动发信（参数/from/to/subject 正确）→ outbox 置 sent + auto_sent=1
// + mail_log 记 sent；Resend 500 → outbox 保持 queued + mail_log 记 failed + 主流程不报错；
// 微信渠道导师 → 不发信、行为不变；未配 RESEND_API_KEY → 静默跳过、保持 queued；
// 问题升级路径同样自动发信（pushOutbox 收口）；测试端点 /api/admin/mail/test 的
// 会话鉴权 / mail_not_configured / 成功返回 id / 坏邮箱 400 / 上游失败 502；
// 发件箱页对 auto_sent 行显示「已转达（系统邮件）」。
// v16.1：通知邮件正文的工作台链接为收件导师本人一键链接（?s=&k=其 mentor_key，
// html 版 & 转义）；无密钥回退裸链接；主题与 mail_log 绝不含密钥。
// 运行：node tests/smoke-v16.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
import { DatabaseSync} from "node:sqlite";
import worker, { mentorMailTo, buildOutboxMail, mentorWorkbenchUrl} from "./worker.mjs";

class Stmt {
constructor(db, sql) { this.db = db; this.sql = sql; this.args = [];}
bind(...args) { this.args = args; return this;}
async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid)}};}
async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args)};}
async first() { const row = this.db.prepare(this.sql).get(...this.args); return row === undefined? null: row;}
}
class D1Shim {
constructor() { this.raw = new DatabaseSync(":memory:");}
prepare(sql) { return new Stmt(this.raw, sql);}
}

let pass = 0, fail = 0;
function ok(cond, label) {
if (cond) { pass++; console.log(" PASS " + label);}
else { fail++; console.log(" FAIL " + label);}
}
function section(t) { console.log("\n== " + t);}

// ===== mock fetch：拦截 Resend 调用，其余请求（本测试无）走真实 fetch =====
const realFetch = globalThis.fetch;
let mailCalls = [];
let mailMode = "ok"; // ok | fail500 | throw
globalThis.fetch = async (url, opts) => {
if (String(url).includes("api.resend.com")) {
mailCalls.push({ url: String(url), opts});
if (mailMode === "fail500") {
return new Response(JSON.stringify({ message: "server boom"}), { status: 500, headers: { "Content-Type": "application/json"}});
}
if (mailMode === "throw") throw new Error("network down");
return new Response(JSON.stringify({ id: "resend-test-id-1"}), { status: 200, headers: { "Content-Type": "application/json"}});
}
return realFetch(url, opts);
};
const lastMailBody = () => JSON.parse(mailCalls[mailCalls.length - 1].opts.body);

const DB = new D1Shim();
const envMail = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123", RESEND_API_KEY: "re_test_123"};
const envNoKey = { DB, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123"};
const BASE = "https://admin.test";
async function call(path, opts = {}, cookie, env = envMail) {
const headers = new Headers(opts.headers || {});
if (cookie) headers.set("Cookie", cookie);
const req = new Request(BASE + path, { method: opts.method || "GET", headers, body: opts.body});
return worker.fetch(req, env);
}
const jsonPost = (obj, token) => ({
method: "POST",
headers: { "Content-Type": "application/json",...(token? { Authorization: "Bearer " + token}: {})},
body: JSON.stringify(obj),
});
const form = (obj) => {
const b = new URLSearchParams(obj);
return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded"}, body: b.toString()};
};
const imp = (body) => call("/api/admin/students/import", jsonPost(body, "tok-123"));
const postMsg = (obj, env) => call("/api/client/message", jsonPost(obj), undefined, env);
const q = (sql,...args) => DB.raw.prepare(sql).all(...args);
const q1 = (sql,...args) => DB.raw.prepare(sql).get(...args);

// ============ 纯函数口径 ============
section("纯函数：mentorMailTo / buildOutboxMail");
ok(mentorMailTo({ notify_channel: "email", contact_email: "a@b.com"}) === "a@b.com", "email 偏好 + 有邮箱 → 返回地址");
ok(mentorMailTo({ notify_channel: "wechat", contact_email: "a@b.com"}) === null, "微信偏好 → 不发邮件（即使有邮箱）");
ok(mentorMailTo({ notify_channel: "email", contact_email: ""}) === null, "email 偏好但无邮箱 → null");
ok(mentorMailTo({ notify_channel: "email", contact_email: "not-an-email"}) === null, "邮箱格式非法 → null");
ok(mentorMailTo(null) === null, "无导师 → null");
{
const m = buildOutboxMail("student_message", "小明", "小明 发来一条留言", "2026-10-23T00:00:00.000Z");
ok(m.subject === "【TransferOS】小明 发来一条留言", "留言主题模板正确");
ok(m.text.includes("https://zhuanuc.com/one-on-one-app/mentor.html"), "正文含工作台链接");
ok(m.text.includes("事项：小明 发来一条留言") && m.text.includes("时间：2026-10-23"), "正文含摘要与时间元数据");
ok(!/李军|创始人/.test(m.text + m.subject), "签名/主题不出现真人姓名");
const e = buildOutboxMail("problem_escalated", "小明", "x", "t");
ok(e.subject === "【TransferOS】小明 把一个问题升级给你", "升级主题模板正确");
}

// ============ 纯函数：一键链接（导师本人密钥仅进其本人邮件正文）============
section("纯函数：mentorWorkbenchUrl / 一键链接");
const KEY_A = "mk_aaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "mk_bbbbbbbbbbbbbbbbbbbbbbbb";
const mentorA = { id: 101, emp_no: "EMP-T101", mentor_key: KEY_A };
const mentorB = { id: 102, emp_no: "EMP-T102", mentor_key: KEY_B };
ok(mentorWorkbenchUrl(mentorA) === "https://zhuanuc.com/one-on-one-app/mentor.html?s=EMP-T101&k=" + KEY_A, "有密钥 → 一键链接（s=工号）");
ok(mentorWorkbenchUrl({ id: 7, mentor_key: KEY_A }) === "https://zhuanuc.com/one-on-one-app/mentor.html?s=7&k=" + KEY_A, "无工号 → s 回退 staff id");
ok(mentorWorkbenchUrl({ id: 7, emp_no: "EMP-T7", mentor_key: "" }) === "https://zhuanuc.com/one-on-one-app/mentor.html", "密钥为空 → 回退裸链接");
ok(mentorWorkbenchUrl({ id: 7, emp_no: "EMP-T7" }) === "https://zhuanuc.com/one-on-one-app/mentor.html", "密钥字段缺失 → 回退裸链接");
ok(mentorWorkbenchUrl(null) === "https://zhuanuc.com/one-on-one-app/mentor.html", "无导师对象 → 回退裸链接");
{
const mk = buildOutboxMail("student_message", "小明", "小明 发来一条留言", "2026-10-23T00:00:00.000Z", mentorA);
ok(mk.text.includes("mentor.html?s=EMP-T101&k=" + KEY_A), "text 正文含本人一键链接");
ok(mk.html.includes("mentor.html?s=EMP-T101&amp;k=" + KEY_A), "html 正文 & 转义为 &amp;");
ok(!mk.text.includes(KEY_B) && !mk.html.includes(KEY_B), "正文不含其他导师的密钥");
ok(!mk.subject.includes(KEY_A) && !mk.subject.includes("mentor.html"), "主题行不含密钥与链接");
const bare = buildOutboxMail("student_message", "小明", "x", "t", { id: 9, emp_no: "EMP-T9", mentor_key: "" });
ok(bare.text.includes("https://zhuanuc.com/one-on-one-app/mentor.html") && !bare.text.includes("?s="), "导师无密钥 → 正文回退裸链接");
const bare2 = buildOutboxMail("student_message", "小明", "x", "t");
ok(!bare2.text.includes("?s=") && !bare2.html.includes("?s="), "不传导师 → 裸链接（旧行为不变）");
}

// ============ 夹具：三名学生 + 两位导师（email / wechat）============
section("夹具：导入学生与注册导师");
const impA = await (await imp({ student: { name: "V16学生甲", slug: "v16a"}})).json();
const impB = await (await imp({ student: { name: "V16学生乙", slug: "v16b"}})).json();
const impC = await (await imp({ student: { name: "V16学生丙", slug: "v16c"}})).json();
ok(impA.ok && impB.ok && impC.ok, "三名学生导入成功");
const sidA = impA.student_id, ckA = impA.client_key;
const sidB = impB.student_id, ckB = impB.client_key;
const sidC = impC.student_id, ckC = impC.client_key;
const nowS = new Date().toISOString();
const staffIns = (cols) => DB.raw.prepare(
`INSERT INTO staff(name, kind, emp_no, contact, status, created_at, ${cols}) VALUES(?,?,?,?,?,?,${cols.split(",").map(() => "?").join(",")})`);
staffIns("contact_email, notify_channel, mentor_status, mentor_key")
.run("邮件导师", "mentor", "EMP-V1601", "", "active", nowS, "mentor-mail@example.com", "email", "verified", "mk_161111111111111111111111");
staffIns("contact_wechat, notify_channel, mentor_status, mentor_key")
.run("微信导师", "mentor", "EMP-V1602", "", "active", nowS, "wx-m16", "wechat", "verified", "mk_162222222222222222222222");
const ME = q1("SELECT id FROM staff WHERE emp_no = 'EMP-V1601'").id;
const MW = q1("SELECT id FROM staff WHERE emp_no = 'EMP-V1602'").id;
DB.raw.prepare("UPDATE students SET mentor_id =? WHERE id =?").run(ME, sidA);
DB.raw.prepare("UPDATE students SET mentor_id =? WHERE id =?").run(MW, sidB);
DB.raw.prepare("UPDATE students SET mentor_id =? WHERE id =?").run(ME, sidC);
ok(ME && MW, "两位导师建档完成（email / wechat）");

// ============ A：email 导师 + 发信成功 → 自动 sent ============
section("A：学生留言 → 自动发信成功");
mailMode = "ok";
const mA = await (await postMsg({ s: "v16a", key: ckA, body: "老师好，这是第一条留言"})).json();
ok(mA.ok === true, "留言主流程成功");
ok(mailCalls.length === 1, "Resend 被调用 1 次");
{
const c = mailCalls[0];
const b = JSON.parse(c.opts.body);
ok(c.url === "https://api.resend.com/emails", "调用 Resend 正式端点");
ok(c.opts.headers.Authorization === "Bearer re_test_123", "Authorization 用 env.RESEND_API_KEY");
ok(b.from === "TransferOS <info@zhuanuc.com>", "From 为 TransferOS <info@zhuanuc.com>");
ok(Array.isArray(b.to) && b.to.length === 1 && b.to[0] === "mentor-mail@example.com", "To 为导师邮箱");
ok(b.subject === "【TransferOS】V16学生甲 发来一条留言", "主题含学生名与事件");
ok(!("reply_to" in b) &&!("replyTo" in b), "未设 Reply-To");
ok(typeof b.text === "string" && typeof b.html === "string" && b.text.length > 0 && b.html.length > 0, "纯文本 + HTML 双版本齐全");
ok(!b.text.includes("老师好，这是第一条留言"), "邮件正文不含留言私密正文");
}
const obA = q1("SELECT * FROM notifications_outbox WHERE student_id =? AND event_type = 'student_message'", sidA);
ok(obA && obA.status === "sent" && obA.auto_sent === 1 && obA.channel === "email", "outbox 行变 sent 且 auto_sent=1");
const mlA = q1("SELECT * FROM mail_log WHERE outbox_id =?", obA.id);
ok(mlA && mlA.status === "sent" && mlA.to_addr === "mentor-mail@example.com" &&!mlA.error, "mail_log 记 sent");
{
const bA = JSON.parse(mailCalls[0].opts.body);
ok(bA.text.includes("mentor.html?s=EMP-V1601&k=mk_161111111111111111111111"), "实发邮件 text 含收件导师本人一键链接");
ok(bA.html.includes("mentor.html?s=EMP-V1601&amp;k=mk_161111111111111111111111"), "实发邮件 html 一键链接 & 已转义");
ok(!bA.text.includes("mk_162222222222222222222222") && !bA.html.includes("mk_162222222222222222222222"), "实发邮件不含其他导师（微信导师）的密钥");
ok(!bA.subject.includes("mk_"), "实发邮件主题不含任何密钥");
ok(!String(mlA.subject || "").includes("mk_") && !String(mlA.to_addr || "").includes("mk_") && !String(mlA.error || "").includes("mk_"), "mail_log 各字段不含密钥");
}

// ============ B：Resend 500 → 保持 queued + 记 failed + 主流程不报错 ============
section("B：Resend 返回 500");
mailMode = "fail500";
const mB = await (await postMsg({ s: "v16a", key: ckA, body: "第二条留言"})).json();
ok(mB.ok === true, "发信失败时留言主流程仍成功");
ok(mailCalls.length === 2, "Resend 被再次调用");
const obB = q("SELECT * FROM notifications_outbox WHERE student_id =? AND event_type = 'student_message' ORDER BY id DESC", sidA)[0];
ok(obB && obB.status === "queued" && (obB.auto_sent === 0 || obB.auto_sent === null), "失败 → outbox 保持 queued、auto_sent=0");
const mlB = q1("SELECT * FROM mail_log WHERE outbox_id =?", obB.id);
ok(mlB && mlB.status === "failed" && /resend_http_500/.test(mlB.error || ""), "mail_log 记 failed + 错误信息");

// ============ F：问题升级路径同样收口自动发信 ============
section("F：问题升级 → 自动发信");
mailMode = "ok";
const pr = await (await call("/api/client/problem", jsonPost({ s: "v16a", key: ckA, domain: "study", title: "升级测试问题V16", desired_outcome: "x", strategy_summary: "y"}))).json();
ok(pr.ok === true && pr.problem && pr.problem.id, "问题创建成功");
const esc = await (await call("/api/client/problem/status", jsonPost({ s: "v16a", key: ckA, id: pr.problem.id, progress: "escalated"}))).json();
ok(esc.ok === true, "问题升级成功");
ok(mailCalls.length === 3, "升级路径也触发 Resend 调用（pushOutbox 收口）");
ok(lastMailBody().subject === "【TransferOS】V16学生甲 把一个问题升级给你", "升级邮件主题正确");
const obF = q1("SELECT * FROM notifications_outbox WHERE student_id =? AND event_type = 'problem_escalated'", sidA);
ok(obF && obF.status === "sent" && obF.auto_sent === 1, "升级 outbox 行同样 sent + auto_sent=1");

// ============ C：微信导师 → 不发信、行为不变 ============
section("C：微信渠道导师");
const beforeC = mailCalls.length;
const mC = await (await postMsg({ s: "v16b", key: ckB, body: "给微信导师的留言"})).json();
ok(mC.ok === true, "微信导师学生留言成功");
ok(mailCalls.length === beforeC, "微信导师 → 不调用 Resend");
const obC = q1("SELECT * FROM notifications_outbox WHERE student_id =? AND event_type = 'student_message'", sidB);
ok(obC && obC.channel === "wechat" && obC.status === "queued", "微信渠道 outbox 保持 queued 待人工转达");

// ============ D：未配 RESEND_API_KEY → 静默跳过 ============
section("D：未配置发信密钥");
const beforeD = mailCalls.length;
const mD = await (await postMsg({ s: "v16c", key: ckC, body: "丙的留言"}, envNoKey)).json();
ok(mD.ok === true, "未配密钥时留言主流程成功");
ok(mailCalls.length === beforeD, "未配密钥 → 不调用 Resend");
const obD = q1("SELECT * FROM notifications_outbox WHERE student_id =? AND event_type = 'student_message'", sidC);
ok(obD && obD.status === "queued", "未配密钥 → outbox 保持 queued");

// ============ E：测试端点 /api/admin/mail/test ============
section("E：邮件通道测试端点");
const noAuth = await call("/api/admin/mail/test", jsonPost({ to: "founder@example.com"}));
ok(noAuth.status === 401, "无登录会话 → 401");
const loginRes = await call("/admin/login", form({ password: "test-pw"}));
const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
ok(!!cookie, "后台登录成功");
const notCfg = await call("/api/admin/mail/test", jsonPost({ to: "founder@example.com"}), cookie, envNoKey);
const notCfgJ = await notCfg.json();
ok(notCfg.status === 503 && notCfgJ.error === "mail_not_configured", "未配密钥 → 503 mail_not_configured");
const badTo = await call("/api/admin/mail/test", jsonPost({ to: "not-an-email"}), cookie);
ok(badTo.status === 400, "坏邮箱 → 400");
const beforeE = mailCalls.length;
const tOk = await call("/api/admin/mail/test", jsonPost({ to: "founder@example.com"}), cookie);
const tOkJ = await tOk.json();
ok(tOk.status === 200 && tOkJ.ok === true && tOkJ.id === "resend-test-id-1", "测试端点成功 → 返回 Resend id");
ok(mailCalls.length === beforeE + 1, "测试端点实际发出一封");
ok(lastMailBody().subject.includes("系统邮件通道测试"), "测试邮件标题含「系统邮件通道测试」");
ok(lastMailBody().from === "TransferOS <info@zhuanuc.com>", "测试邮件 From 同为 info@zhuanuc.com");
const mlT = q1("SELECT * FROM mail_log WHERE outbox_id IS NULL AND status = 'sent' ORDER BY id DESC");
ok(mlT && mlT.to_addr === "founder@example.com", "测试邮件记 mail_log（outbox_id 为 NULL）");
mailMode = "fail500";
const tFail = await call("/api/admin/mail/test", jsonPost({ to: "founder@example.com"}), cookie);
ok(tFail.status === 502 && (await tFail.json()).ok === false, "上游 500 → 测试端点 502 明确报错");
mailMode = "ok";

// ============ G：发件箱页 auto 标注 ============
section("G：后台发件箱页");
const outboxPage = await (await call("/admin/outbox", {}, cookie)).text();
ok(outboxPage.includes("已转达（系统邮件）"), "发件箱页对 auto_sent 行显示「已转达（系统邮件）」");

globalThis.fetch = realFetch;
console.log("\n==== smoke-v16: " + pass + " passed, " + fail + " failed ====");
process.exit(fail? 1: 0);
