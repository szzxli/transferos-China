// TransferOS 管理后台 v18 学生发文件给导师 + 接收口常驻冒烟测试。
// 覆盖：学生上传（类型/大小/额度口径）、导师列表与一次性下载、学生撤回、错密钥 404、
// 学生端 GET pending_files 计数、导师发文件后学生接收列表可见。
// 运行：node tests/smoke-student-files.mjs（需先把最新 src/index.js 拷为 tests/worker.mjs）
import { DatabaseSync } from "node:sqlite";
import worker from "./worker.mjs";

class Stmt { constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; } bind(...a) { this.args = a; return this; } async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid) } }; } async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args) }; } async first() { const row = this.db.prepare(this.sql).get(...this.args); return row === undefined ? null : row; } }
class D1Shim { constructor() { this.raw = new DatabaseSync(":memory:"); } prepare(sql) { return new Stmt(this.raw, sql); } }

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log("  PASS " + l); } else { fail++; console.log("  FAIL " + l); } };
const DB = new D1Shim();
const r2 = new Map();
const FILES = {
  async put(k, v) { r2.set(k, Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : v)); },
  async get(k) { const b = r2.get(k); return b ? { body: new Uint8Array(b), httpMetadata: { contentType: "text/plain" }, size: b.length } : null; },
  async delete(k) { r2.delete(k); },
};
const env = { DB, FILES, ADMIN_KEY: "test-pw", LEAD_API_TOKEN: "tok-123" };
const BASE = "https://admin.test";
const ctx = { promises: [], waitUntil(p) { this.promises.push(Promise.resolve(p)); } };
const call = (path, opts = {}) => worker.fetch(new Request(BASE + path, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body }), env, ctx);
const jsonPost = (o) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
const imp = (b) => call("/api/admin/students/import", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer tok-123" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));

// 造数：触发 ensureSchema 后补导师与学生
await call("/api/client/files?s=x&key=y");
const db = DB.raw;
db.prepare(`INSERT INTO staff(name, emp_no, kind) VALUES('导师甲','EMP-001','human')`).run();
db.prepare(`UPDATE staff SET mentor_key='mk1', mentor_status='verified' WHERE emp_no='EMP-001'`).run();
const mentor = db.prepare(`SELECT id FROM staff WHERE emp_no='EMP-001'`).get();
const im = await imp({ student: { name: "文件学生", slug: "filestu" } });
ok(im.body.ok && im.body.student_id, "学生导入成功");
const sid = im.body.student_id, ckey = im.body.client_key;
db.prepare(`UPDATE students SET mentor_id=? WHERE id=?`).run(mentor.id, sid);

// 学生上传 txt 成功
const fd1 = new FormData(); fd1.append("s", "filestu"); fd1.append("key", ckey);
fd1.append("file", new File(["hello student file"], "作业.txt", { type: "text/plain" }));
const up1 = await call("/api/client/file", { method: "POST", body: fd1 }).then(r => r.json());
ok(up1.ok && up1.file && up1.file.status === "pending", "学生上传文件成功 pending");

// 错密钥 404
const fdBad = new FormData(); fdBad.append("s", "filestu"); fdBad.append("key", "wrong");
fdBad.append("file", new File(["x"], "a.txt", { type: "text/plain" }));
const upBad = await call("/api/client/file", { method: "POST", body: fdBad });
ok(upBad.status === 404, "学生上传错密钥 404");

// 不支持类型 400
const fdType = new FormData(); fdType.append("s", "filestu"); fdType.append("key", ckey);
fdType.append("file", new File(["x"], "a.exe", { type: "application/octet-stream" }));
const upType = await call("/api/client/file", { method: "POST", body: fdType }).then(r => r.json());
ok(upType.ok === false && upType.error === "bad_type", "不支持类型 bad_type");

// 学生已发列表含该文件
const sent = await call(`/api/client/sent-files?s=filestu&key=${ckey}`).then(r => r.json());
ok(sent.ok && sent.files.some(f => f.id === up1.file.id && f.status === "pending"), "学生已发列表含 pending 文件");

// 导师列表含该文件
const mlist = await call(`/api/mentor/student-files?s=EMP-001&key=mk1&student_id=${sid}`).then(r => r.json());
ok(mlist.ok && mlist.files.some(f => f.id === up1.file.id), "导师接收列表含学生文件");

// 导师一次性下载
const dl = await call(`/api/mentor/student-file/download?s=EMP-001&key=mk1&id=${up1.file.id}`);
ok(dl.status === 200, "导师下载 200");
await Promise.all(ctx.promises);
const rowAfter = db.prepare(`SELECT status FROM student_files WHERE id=?`).get(up1.file.id);
ok(rowAfter.status === "downloaded", "下载后状态 downloaded（一次性）");
const dl2 = await call(`/api/mentor/student-file/download?s=EMP-001&key=mk1&id=${up1.file.id}`);
ok(dl2.status === 410, "二次下载 410");

// 学生撤回第二文件
const fd2 = new FormData(); fd2.append("s", "filestu"); fd2.append("key", ckey);
fd2.append("file", new File(["second"], "二稿.txt", { type: "text/plain" }));
const up2 = await call("/api/client/file", { method: "POST", body: fd2 }).then(r => r.json());
ok(up2.ok, "第二文件上传成功");
const wd = await call("/api/client/file/withdraw", jsonPost({ s: "filestu", key: ckey, id: up2.file.id })).then(r => r.json());
ok(wd.ok && wd.status === "withdrawn", "学生下载前撤回成功");
const wd2 = await call("/api/client/file/withdraw", jsonPost({ s: "filestu", key: ckey, id: up2.file.id })).then(r => r.json());
ok(wd2.ok === false && wd2.error === "not_pending", "已撤回文件再撤回 not_pending");

// 导师发文件 → 学生接收列表 + pending_files 计数
const fdM = new FormData(); fdM.append("s", "EMP-001"); fdM.append("key", "mk1");
fdM.append("student_id", String(sid));
fdM.append("file", new File(["mentor doc"], "资料.pdf", { type: "application/pdf" }));
const mup = await call("/api/mentor/file", { method: "POST", body: fdM }).then(r => r.json());
ok(mup.ok && mup.file.status === "pending", "导师发文件成功");
const recv = await call(`/api/client/files?s=filestu&key=${ckey}`).then(r => r.json());
ok(recv.ok && recv.files.some(f => f.id === mup.file.id && f.status === "pending"), "学生接收列表含导师文件");
const client = await call(`/api/client/filestu?key=${ckey}`).then(r => r.json());
ok(client.ok && Number(client.pending_files) === 1, "学生端 GET pending_files=1（接收口红点依据）");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
