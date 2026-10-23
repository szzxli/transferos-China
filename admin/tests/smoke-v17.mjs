// TransferOS 管理后台 v17 冒烟测试：导师文件一次性投递。
// 覆盖：正常上传→学生列表可见→下载成功（对象被删 + 状态 downloaded + downloaded_at）
// →二次下载 410；超 5MB 拒（file_too_large）；类型拒（扩展名/MIME 双查，bad_type）；
// 学生额度拒（student_quota）；全局额度拒（global_quota，小额度注入模拟）；过期文件
// 下载 410 + scheduled 清扫置 expired 并删对象；越权（无关系导师 forbidden / 他人
// 学生文件不可见不可下 / 他人文件不可撤回）；导师撤回（withdrawn + 对象删 + 下载 410）；
// 专题导师关系同样可发；家长接口不暴露任何文件字段。
// 运行：node tests/smoke-v17.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
import { DatabaseSync } from "node:sqlite";
import worker, { mentorFileTypeOk, FILE_MAX_BYTES } from "./worker.mjs";

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
// R2 内存 mock：与真实 R2 同口径的 put/get/delete；get 返回 { body 流, size, httpMetadata }
class R2Mock {
  constructor() { this.map = new Map(); }
  async put(key, value, opts) {
    let buf;
    if (value instanceof ArrayBuffer) buf = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) buf = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else if (typeof value === "string") buf = new TextEncoder().encode(value);
    else throw new Error("R2Mock.put: unsupported value");
    this.map.set(key, { body: buf, contentType: (opts && opts.httpMetadata && opts.httpMetadata.contentType) || "" });
    return { key, etag: "mock" };
  }
  async get(key) {
    const o = this.map.get(key);
    if (!o) return null;
    const body = new ReadableStream({ start(c) { c.enqueue(o.body); c.close(); } });
    return { body, size: o.body.byteLength, httpMetadata: { contentType: o.contentType } };
  }
  async delete(key) { this.map.delete(key); }
  has(key) { return this.map.has(key); }
  get size() { return this.map.size; }
}

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function section(t) { console.log("\n== " + t); }

const DB = new D1Shim();
const FILES = new R2Mock();
const env = { DB, FILES, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123" };
const BASE = "https://admin.test";
const ctx = { promises: [], waitUntil(p) { this.promises.push(Promise.resolve(p)); } };
async function flushCtx() { const ps = ctx.promises.splice(0); await Promise.all(ps); }

async function call(path, opts = {}, e = env) {
  const req = new Request(BASE + path, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
  return worker.fetch(req, e, ctx);
}
const TOKEN = { Authorization: "Bearer tok-123", "Content-Type": "application/json" };

// ===== 造数：2 名学生 + 3 名导师（A 主导师 / B 专题导师 / C 无关系）=====
const imp = await call("/api/admin/students/import", {
  method: "POST", headers: TOKEN,
  body: JSON.stringify({ student: { name: "文件学生甲", school_system: "cc" } }),
});
const impJ = await imp.json();
const stu1 = impJ.student_id, key1 = impJ.client_key, slug1 = impJ.slug || "";
ok(impJ.ok === true && stu1 && key1, "导入学生甲");
const imp2 = await call("/api/admin/students/import", {
  method: "POST", headers: TOKEN,
  body: JSON.stringify({ student: { name: "文件学生乙", school_system: "cc" } }),
});
const imp2J = await imp2.json();
const stu2 = imp2J.student_id, key2 = imp2J.client_key;
ok(imp2J.ok === true && stu2 && key2, "导入学生乙");

const raw = DB.raw;
function mkStaff(empNo, name, key) {
  const r = raw.prepare(
    "INSERT INTO staff(name, emp_no, kind, status, mentor_key, notify_channel) VALUES(?, ?, 'human', '在职', ?, 'wechat')"
  ).run(name, empNo, key);
  return Number(r.lastInsertRowid);
}
const staffA = mkStaff("EMP-101", "导师甲", "mk_aaaaaaaaaaaaaaaaaaaaaaaa");
const staffB = mkStaff("EMP-102", "导师乙", "mk_bbbbbbbbbbbbbbbbbbbbbbbb");
const staffC = mkStaff("EMP-103", "导师丙", "mk_cccccccccccccccccccccccc");
raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(staffA, stu1);
raw.prepare("UPDATE students SET mentor_id = ? WHERE id = ?").run(staffA, stu2);
raw.prepare("INSERT INTO student_topic_mentors(student_id, staff_id, topic, created_at) VALUES(?, ?, '创业辅导', '2026-10-23T00:00:00.000Z')").run(stu1, staffB);

const A = { s: "EMP-101", key: "mk_aaaaaaaaaaaaaaaaaaaaaaaa" };
const B = { s: "EMP-102", key: "mk_bbbbbbbbbbbbbbbbbbbbbbbb" };
const C = { s: "EMP-103", key: "mk_cccccccccccccccccccccccc" };

async function upload(who, studentId, bytes, name, type, e = env) {
  const fd = new FormData();
  fd.set("s", who.s); fd.set("key", who.key); fd.set("student_id", String(studentId));
  fd.set("file", new File([bytes], name, { type }));
  const resp = await call("/api/mentor/file", { method: "POST", body: fd }, e);
  let j = null; try { j = await resp.json(); } catch { /* 非 JSON 响应 */ }
  return { resp, j };
}
const pdfBytes = new TextEncoder().encode("%PDF-1.4 fake content for testing 0123456789");

// ===== 纯函数：类型双查 =====
section("类型白名单纯函数");
ok(mentorFileTypeOk("a.pdf", "application/pdf") === true, "pdf + pdf MIME 通过");
ok(mentorFileTypeOk("a.PDF", "application/pdf") === true, "扩展名大小写不敏感");
ok(mentorFileTypeOk("a.pdf", "text/plain") === false, "pdf 扩展名 + 错 MIME 拒");
ok(mentorFileTypeOk("a.exe", "application/pdf") === false, "exe 扩展名拒");
ok(mentorFileTypeOk("a.zip", "application/x-zip-compressed") === true, "zip 备用 MIME 通过");
ok(mentorFileTypeOk("noext", "application/pdf") === false, "无扩展名拒");

// ===== 1. 正常全链路 =====
section("正常上传 → 列表 → 下载 → 二次 410");
const up1 = await upload(A, stu1, pdfBytes, "学习计划.pdf", "application/pdf");
ok(up1.resp.status === 200 && up1.j.ok === true, "主导师上传成功");
const f1 = up1.j.file;
ok(f1 && f1.status === "pending" && f1.size === pdfBytes.byteLength && f1.seconds_left > 86000, "返回元数据 pending + 剩余近 24h");
ok(FILES.size === 1, "R2 已写入 1 个对象");
const row1 = raw.prepare("SELECT * FROM mentor_files WHERE id = ?").get(f1.id);
ok(row1 && /^mf\/[0-9a-f]{48}$/.test(row1.r2_key), "r2_key 为 mf/ + 48 位随机 hex，不含学生信息");

const list1 = await (await call(`/api/client/files?s=${stu1}&key=${key1}`)).json();
ok(list1.ok && list1.files.length === 1 && list1.files[0].id === f1.id, "学生列表可见该文件");
ok(list1.files[0].mentor_name === "导师甲" && !("r2_key" in list1.files[0]) && !("url" in list1.files[0]), "列表带导师名、不给直链/r2_key");

const dl1 = await call(`/api/client/file/download?s=${stu1}&key=${key1}&id=${f1.id}`);
ok(dl1.status === 200, "下载 200");
ok((dl1.headers.get("Content-Disposition") || "").includes("filename*=UTF-8''"), "下载头带 UTF-8 文件名");
const dlBody = new Uint8Array(await dl1.arrayBuffer());
ok(dlBody.byteLength === pdfBytes.byteLength && dlBody[0] === pdfBytes[0], "下载内容一致");
await flushCtx();
ok(FILES.size === 0, "下载后 R2 对象已删除");
const row1b = raw.prepare("SELECT * FROM mentor_files WHERE id = ?").get(f1.id);
ok(row1b.status === "downloaded" && !!row1b.downloaded_at, "状态 downloaded + downloaded_at 落时间");
const dl2 = await call(`/api/client/file/download?s=${stu1}&key=${key1}&id=${f1.id}`);
ok(dl2.status === 410, "二次下载 410");
const list1b = await (await call(`/api/client/files?s=${stu1}&key=${key1}`)).json();
ok(list1b.files.length === 0, "已下载文件不再出现在学生列表");

// ===== 2. 超限与类型拒绝 =====
section("超 5MB / 类型拒");
const big = await upload(A, stu1, new Uint8Array(FILE_MAX_BYTES + 1), "big.pdf", "application/pdf");
ok(big.resp.status === 413 && big.j.error === "file_too_large", "超 5MB → 413 file_too_large");
const badExt = await upload(A, stu1, pdfBytes, "evil.exe", "application/pdf");
ok(badExt.resp.status === 400 && badExt.j.error === "bad_type", "exe 扩展名 → bad_type");
const badMime = await upload(A, stu1, pdfBytes, "fake.pdf", "text/plain");
ok(badMime.resp.status === 400 && badMime.j.error === "bad_type", "pdf 扩展名 + 错 MIME → bad_type");
ok(FILES.size === 0, "被拒上传不写 R2");

// ===== 3. 学生额度（注入小额度）=====
section("学生额度拒");
const envStuQuota = { ...env, FILE_STUDENT_QUOTA_BYTES: 1000 };
const q1 = await upload(A, stu2, new Uint8Array(600), "q1.txt", "text/plain", envStuQuota);
ok(q1.resp.status === 200, "600B 首传成功");
const q2 = await upload(A, stu2, new Uint8Array(600), "q2.txt", "text/plain", envStuQuota);
ok(q2.resp.status === 409 && q2.j.error === "student_quota", "再传 600B 超学生额度 → student_quota");
const qRow = raw.prepare("SELECT * FROM mentor_files WHERE id = ?").get(q1.j.file.id);
raw.prepare("UPDATE mentor_files SET status = 'withdrawn' WHERE id = ?").run(q1.j.file.id);
await FILES.delete(qRow.r2_key);

// ===== 4. 全局额度（注入小额度）=====
section("全局额度拒");
const pendTotal = raw.prepare("SELECT COALESCE(SUM(size), 0) AS t FROM mentor_files WHERE status = 'pending'").get().t;
const envGQuota = { ...env, FILE_GLOBAL_QUOTA_BYTES: pendTotal + 50 };
const g1 = await upload(A, stu1, new Uint8Array(60), "g1.txt", "text/plain", envGQuota);
ok(g1.resp.status === 409 && g1.j.error === "global_quota", "60B 超全局剩余额度 → global_quota");
const g2 = await upload(A, stu1, new Uint8Array(40), "g2.txt", "text/plain", envGQuota);
ok(g2.resp.status === 200, "40B 在剩余额度内成功");
const wdG = await call("/api/mentor/file/withdraw", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ s: A.s, key: A.key, id: g2.j.file.id }),
});
ok(wdG.status === 200, "清理：撤回 g2");

// ===== 5. 过期：下载 410 + scheduled 清扫 =====
section("过期处置");
const upE = await upload(A, stu1, pdfBytes, "expire.pdf", "application/pdf");
const fE = upE.j.file;
const rowE = raw.prepare("SELECT * FROM mentor_files WHERE id = ?").get(fE.id);
const pastIso = new Date(Date.now() - 3600e3).toISOString();
raw.prepare("UPDATE mentor_files SET expires_at = ? WHERE id = ?").run(pastIso, fE.id);
const dlE = await call(`/api/client/file/download?s=${stu1}&key=${key1}&id=${fE.id}`);
ok(dlE.status === 410, "已过期文件下载 → 410");
const rowE2 = raw.prepare("SELECT * FROM mentor_files WHERE id = ?").get(fE.id);
ok(rowE2.status === "expired" && !FILES.has(rowE.r2_key), "下载路径单条清扫：状态 expired + 对象删");

const upE2 = await upload(A, stu1, pdfBytes, "expire2.pdf", "application/pdf");
const fE2 = upE2.j.file;
const rowE2k = raw.prepare("SELECT * FROM mentor_files WHERE id = ?").get(fE2.id);
raw.prepare("UPDATE mentor_files SET expires_at = ? WHERE id = ?").run(pastIso, fE2.id);
await worker.scheduled({}, env, ctx);
const rowE2b = raw.prepare("SELECT * FROM mentor_files WHERE id = ?").get(fE2.id);
ok(rowE2b.status === "expired" && !FILES.has(rowE2k.r2_key), "scheduled 清扫：状态 expired + 对象删");
const listExp = await (await call(`/api/client/files?s=${stu1}&key=${key1}`)).json();
const expInList = listExp.files.find((f) => f.id === fE2.id);
ok(expInList && expInList.status === "expired", "刚过期文件在学生列表标 expired（供前端展示）");

// ===== 6. 越权 =====
section("越权拦截");
const forb = await upload(C, stu1, pdfBytes, "forb.pdf", "application/pdf");
ok(forb.resp.status === 404 && forb.j.error === "forbidden", "无关系导师上传 → forbidden");
const upT = await upload(B, stu1, pdfBytes, "topic.pdf", "application/pdf");
ok(upT.resp.status === 200, "专题导师可向专题学生发文件");
const fT = upT.j.file;
const crossDl = await call(`/api/client/file/download?s=${stu2}&key=${key2}&id=${fT.id}`);
ok(crossDl.status === 404, "他人学生密钥下载 → 404");
const wrongKey = await call(`/api/client/files?s=${stu1}&key=ck_wrong`);
ok(wrongKey.status === 404, "学生密钥错误 → 404");
const listC = await call(`/api/mentor/files?s=${C.s}&key=${C.key}&student_id=${stu1}`);
ok(listC.status === 404, "无关系导师查文件列表 → 404");
const wdCross = await call("/api/mentor/file/withdraw", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ s: A.s, key: A.key, id: fT.id }),
});
ok(wdCross.status === 404, "撤回他人（专题导师）的文件 → 404");

// ===== 7. 导师撤回 + 导师列表 =====
section("导师撤回");
const mList = await (await call(`/api/mentor/files?s=${B.s}&key=${B.key}&student_id=${stu1}`)).json();
ok(mList.ok && mList.files.some((f) => f.id === fT.id && f.status === "pending"), "导师列表见自己发的 pending 文件");
const rowT = raw.prepare("SELECT * FROM mentor_files WHERE id = ?").get(fT.id);
const wd = await call("/api/mentor/file/withdraw", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ s: B.s, key: B.key, id: fT.id }),
});
const wdJ = await wd.json();
ok(wd.status === 200 && wdJ.status === "withdrawn", "本人撤回成功");
ok(!FILES.has(rowT.r2_key), "撤回删除 R2 对象");
const dlW = await call(`/api/client/file/download?s=${stu1}&key=${key1}&id=${fT.id}`);
ok(dlW.status === 410, "已撤回文件下载 → 410");
const wdAgain = await call("/api/mentor/file/withdraw", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ s: B.s, key: B.key, id: fT.id }),
});
ok(wdAgain.status === 409, "重复撤回 → 409 not_pending");

// ===== 8. 家长端零暴露 =====
section("家长端不暴露文件");
const stuRow = raw.prepare("SELECT parent_key FROM students WHERE id = ?").get(stu1);
if (stuRow && stuRow.parent_key) {
  const parentView = await (await call(`/api/parent/${stu1}?key=${stuRow.parent_key}`)).json();
  const flat = JSON.stringify(parentView);
  ok(!flat.includes("mentor_files") && !flat.includes("expire.pdf") && !flat.includes("files"), "家长载荷无文件字段/文件名");
} else {
  ok(false, "学生应有 parent_key（导入自动生成）");
}

console.log(`\n==== smoke-v17: ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
