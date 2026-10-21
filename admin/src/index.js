// TransferOS-China 业务管理后台 (Cloudflare Worker + D1)
// Single file, no dependencies. Public JSON API + server-rendered admin UI.

// ===== 纯函数（可独立单元测试）=====
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}
const REF_RE = /^[A-Za-z0-9_-]{1,24}$/;
function validRef(r) {
  return typeof r === "string" && REF_RE.test(r);
}
function calcCommission(amountCents, rate) {
  const a = Number.isFinite(amountCents) ? amountCents : 0;
  const r = Number.isFinite(rate) ? rate : 0;
  return Math.round((a * r) / 100);
}
function fmtYuan(cents) {
  const n = Math.round(Number(cents) || 0);
  const neg = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const y = Math.floor(abs / 100);
  const f = String(abs % 100).padStart(2, "0");
  const ys = String(y).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "¥" + neg + ys + "." + f;
}
function clampStr(s, max) {
  s = String(s ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}
function toInt(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : (dflt ?? 0);
}
// daysInStage: 从 stage_since（ISO 时间）到 nowMs 的整天数；无效时间返回 null
function daysInStage(stageSinceIso, nowMs) {
  const t = Date.parse(stageSinceIso || "");
  if (!Number.isFinite(t)) return null;
  const d = Math.floor((nowMs - t) / 864e5);
  return d < 0 ? 0 : d;
}
function isOverdueStage(stageSinceIso, nowMs, thresholdDays) {
  const d = daysInStage(stageSinceIso, nowMs);
  return d !== null && d > thresholdDays;
}
// aggregateMetrics: 把 content_metrics 行按 item_id 汇总
function aggregateMetrics(rows) {
  const out = {};
  for (const r of rows || []) {
    const k = r.item_id;
    if (!out[k]) out[k] = { views: 0, consults: 0, leads: 0, entries: 0 };
    out[k].views += Number(r.views) || 0;
    out[k].consults += Number(r.consults) || 0;
    out[k].leads += Number(r.leads) || 0;
    out[k].entries += 1;
  }
  return out;
}
function convRate(leads, views) {
  const v = Number(views) || 0;
  if (v <= 0) return 0;
  return Math.round(((Number(leads) || 0) / v) * 1000) / 10;
}
// taskDueState: done / overdue / today / upcoming / none
function taskDueState(due, status, today) {
  if (status === "done") return "done";
  if (!due) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  return "upcoming";
}
// leadTaskMarker: A 级线索自动跟进任务的去重标记，写进任务 note，形如 [lead:12]。
// 判定「该线索是否已有未完成的跟进任务」时按此标记匹配（方括号在 SQLite LIKE 中是普通字符，不会误伤 [lead:1] 与 [lead:12]）。
function leadTaskMarker(leadId) { return "[lead:" + (parseInt(leadId, 10) || 0) + "]"; }
// followupDueStr: 跟进任务截止日 = 处理日 +2 天（YYYY-MM-DD）
function followupDueStr(nowMs) { return new Date((nowMs || Date.now()) + 2 * 864e5).toISOString().slice(0, 10); }

// ===== 线索自动评分（确定性规则写死在本函数，AI 不参与打分）=====
// 满分 100，五维计分：
//   渠道归因 20：ref 命中启用中的代理/渠道码 +20；有 ref 但未登记 +5；无 ref +0
//   联系方式 25：微信+电话都有 +25；只有一个 +15；都没有 +0
//   评估摘要 15：eval_summary ≥100 字 +15；≥40 字 +10；有内容 +5；空 +0
//   意向明确 15：eval_summary/note 命中学校或专业关键词 +15
//   咨询关键词 25：命中费用类 +8、TAG/保录 +8、签证类 +9（可叠加，正好封顶 25）
// 评级：A ≥ 70；B 45–69；C < 45。reason 为一句可读理由（得分点或主要缺项）。
const LEAD_INTENT_WORDS = ["加州大学", "UCI", "UCD", "UCSB", "UCSC", "UCR", "UCM",
  "De Anza", "Foothill", "社区学院", "专业", "计算机", "商科", "工程", "数据科学"];
const LEAD_KW_GROUPS = [
  { words: ["费用", "价格", "多少钱", "学费"], pts: 8, label: "问费用" },
  { words: ["TAG", "保录"], pts: 8, label: "问TAG" },
  { words: ["签证", "面签", "F-1"], pts: 9, label: "问签证" },
];
function scoreLead(lead, validRefs) {
  const refs = validRefs instanceof Set ? validRefs : new Set(validRefs || []);
  const ref = String(lead.ref || "").trim();
  const wechat = String(lead.wechat || "").trim();
  const phone = String(lead.phone || "").trim();
  const evalText = String(lead.eval_summary || "");
  const text = evalText + "\n" + String(lead.note || "");
  let score = 0;
  const hits = [];
  const refValid = !!ref && refs.has(ref);
  if (refValid) { score += 20; hits.push("渠道码有效"); }
  else if (ref) { score += 5; hits.push("有来源码（未登记）"); }
  const contactN = (wechat ? 1 : 0) + (phone ? 1 : 0);
  if (contactN === 2) { score += 25; hits.push("联系方式齐全"); }
  else if (contactN === 1) { score += 15; hits.push("有单一联系方式"); }
  const evalLen = evalText.trim().length;
  if (evalLen >= 100) { score += 15; hits.push("评估信息充分"); }
  else if (evalLen >= 40) { score += 10; hits.push("评估信息较充分"); }
  else if (evalLen > 0) { score += 5; }
  if (LEAD_INTENT_WORDS.some((w) => text.includes(w))) { score += 15; hits.push("意向学校/专业明确"); }
  for (const g of LEAD_KW_GROUPS) {
    if (g.words.some((w) => text.includes(w))) { score += g.pts; hits.push(g.label); }
  }
  if (score > 100) score = 100;
  const grade = score >= 70 ? "A" : score >= 45 ? "B" : "C";
  let reason;
  if (grade === "C") {
    const gaps = [];
    if (!refValid) gaps.push("无有效渠道码");
    if (contactN === 0) gaps.push("缺联系方式");
    if (evalLen === 0) gaps.push("无评估摘要");
    reason = gaps.length ? "信息不完整：" + gaps.join("、") : (hits.join("、") || "基础信息已填写");
  } else {
    reason = hits.join("、") || "基础信息已填写";
  }
  return { grade, score, reason };
}

// ===== 常量 =====
const LEAD_SOURCES = { assess: "评估页", track: "规划页", apply: "转学页", miniapp: "小程序", manual: "手动录入" };
const LEAD_STATUSES = { new: "新线索", contacted: "已联系", diagnosed: "已诊断", sold: "已成交", lost: "已流失" };
const ORDER_STAGES = { deposit: "签约定金", cc_entry: "CC入学款", transfer_season: "转学季款", full: "全款" };
const PAID_STATUSES = { unpaid: "未付款", partial: "部分付款", paid: "已付清" };
const SETTLE_STATUSES = { unsettled: "未结算", settled: "已结算" };
const AGENT_KINDS = { agent: "代理", channel: "渠道" };
const PACKAGES = [
  "诊断 ¥299", "入门款 ¥15,800", "评估+规划 ¥9,800", "CC申请 ¥9,800",
  "学期陪伴 ¥8,000", "转学申请 ¥25,000", "签证辅导 ¥6,000", "全程无忧 ¥68,000",
];
const CORS_ORIGINS = [
  "https://szzxli.github.io",
  "https://zhuanuc.com",
  "https://transferos-china.szzxli711.workers.dev",
  "https://admin.zhuanuc.com",
];
const COOKIE_NAME = "tog_admin";
const COOKIE_MSG = "transferos-admin-session-v1";
// 交付阶段（固定 9 个，与产品定义一致）；逾期只对进行中阶段判定
const STAGE_OVERDUE_DAYS = 30;
const DELIVERY_STAGES = {
  diag: "评估诊断", enroll: "入学申请", planning: "课程规划",
  coaching: "学期陪伴", transfer: "转学申请", visa: "签证辅导",
  admitted: "录取", renewal: "续费", referral: "转介绍",
};
const ACTIVE_STAGES = ["diag", "enroll", "planning", "coaching", "transfer", "visa"];
function validStage(code) {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(DELIVERY_STAGES, code);
}
const TASK_STATUSES = { todo: "待办", doing: "进行中", done: "已完成" };
const TASK_TYPES = { task: "任务", proposal: "提案" };
// v3：状态扩展为 试用/在职/停用待查/已离职或辞退；left 为 v2 旧值，仅作兼容显示
const STAFF_STATUSES = { probation: "试用", active: "在职", suspended: "停用待查", offboarded: "已离职/辞退", left: "离职（旧）" };
const STAFF_KINDS = { human: "真人", ai: "AI 员工" };
const REVIEW_TYPES = { exam: "入职测评", regular: "日常考核", annual: "年检" };
const REVIEW_VERDICTS = { pass: "通过", fail: "不通过", observe: "观察" };
// 工号职能码（按职能关键词映射，找不到时用英文前两字母，再不行用 GN=通用）
const FUNC_CODE_MAP = [
  ["客服", "CS"], ["内容", "CT"], ["线索", "LD"], ["数据", "DT"], ["巡检", "DT"],
  ["运营", "OP"], ["销售", "SL"], ["财务", "FN"], ["人事", "HR"], ["交付", "DL"],
  ["技术", "TC"], ["法务", "LG"], ["翻译", "TR"], ["视频", "VD"], ["社群", "CM"],
];
function functionCodeFor(jobFunction) {
  const s = String(jobFunction || "");
  for (const [kw, code] of FUNC_CODE_MAP) if (s.includes(kw)) return code;
  const en = s.toUpperCase().replace(/[^A-Z]/g, "");
  if (en.length >= 2) return en.slice(0, 2);
  return "GN";
}
// 回避规则：AI 员工的入职测评（exam）必须有主考体系，且不得与员工所属体系相同
function examConflict(staffKind, staffPlatform, reviewType, examinerPlatform) {
  if (reviewType !== "exam" || staffKind !== "ai") return false;
  const ep = String(examinerPlatform || "").trim();
  if (!ep) return true;
  return ep === String(staffPlatform || "").trim();
}
const CONTENT_TYPES = { video: "短视频", article: "文章", live: "直播", other: "其他" };
// v5：内容状态流转（草稿 → 待审 → 已发布 → 归档）；存量条目与表单默认均为 published
const CONTENT_STATUSES = { draft: "草稿", pending: "待审", published: "已发布", archived: "归档" };

// ===== 数据库结构（与 schema.sql 保持一致）=====
const DDL = [
  `CREATE TABLE IF NOT EXISTS agents(
    code TEXT PRIMARY KEY, name TEXT, region TEXT,
    kind TEXT, active INTEGER DEFAULT 1, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS leads(
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, wechat TEXT, phone TEXT,
    source TEXT, ref TEXT, eval_summary TEXT, status TEXT DEFAULT 'new',
    note TEXT, created_at TEXT, updated_at TEXT,
    grade TEXT, score INTEGER, grade_reason TEXT, graded_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS visits(
    id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT, page TEXT, day TEXT,
    count INTEGER DEFAULT 0, UNIQUE(ref, page, day))`,
  `CREATE TABLE IF NOT EXISTS orders(
    id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, customer TEXT,
    package TEXT, amount INTEGER DEFAULT 0, stage TEXT, ref TEXT,
    is_renewal INTEGER DEFAULT 0, commission_rate INTEGER DEFAULT 30,
    commission INTEGER DEFAULT 0, paid_status TEXT DEFAULT 'unpaid',
    settle_status TEXT DEFAULT 'unsettled', created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS faqs(
    id INTEGER PRIMARY KEY AUTOINCREMENT, lang TEXT DEFAULT 'zh-CN',
    q TEXT, a TEXT, sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS students(
    id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, order_id INTEGER,
    name TEXT, package TEXT, stage TEXT DEFAULT 'diag',
    stage_since TEXT, note TEXT, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS content_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, platform TEXT,
    pub_date TEXT, ref TEXT, type TEXT, status TEXT DEFAULT 'published', created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS content_metrics(
    id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, day TEXT,
    views INTEGER DEFAULT 0, consults INTEGER DEFAULT 0, leads INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS tasks(
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, owner TEXT,
    due TEXT, status TEXT DEFAULT 'todo', note TEXT, created_at TEXT, updated_at TEXT,
    type TEXT DEFAULT 'task')`,
  `CREATE TABLE IF NOT EXISTS staff(
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT,
    contact TEXT, start_date TEXT, status TEXT DEFAULT 'active',
    note TEXT, created_at TEXT,
    kind TEXT DEFAULT 'human', emp_no TEXT, platform TEXT, job_function TEXT,
    persona TEXT, accountable TEXT)`,
  `CREATE TABLE IF NOT EXISTS staff_reviews(
    id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER,
    review_type TEXT DEFAULT 'regular', review_date TEXT,
    examiner TEXT, examiner_platform TEXT, score REAL,
    verdict TEXT DEFAULT 'observe', comment TEXT, created_at TEXT)`,
];
// v3 迁移：给既有 staff 表补列（重复执行时列已存在会抛错，逐条捕获忽略，保证幂等）
const STAFF_MIGRATIONS = [
  "ALTER TABLE staff ADD COLUMN kind TEXT DEFAULT 'human'",
  "ALTER TABLE staff ADD COLUMN emp_no TEXT",
  "ALTER TABLE staff ADD COLUMN platform TEXT",
  "ALTER TABLE staff ADD COLUMN job_function TEXT",
  "ALTER TABLE staff ADD COLUMN persona TEXT",
  "ALTER TABLE staff ADD COLUMN accountable TEXT",
];
const TASK_MIGRATIONS = [
  "ALTER TABLE tasks ADD COLUMN type TEXT DEFAULT 'task'",
];
// v4 迁移：leads 补自动评级列（grade/score/grade_reason/graded_at），同样幂等
const LEAD_MIGRATIONS = [
  "ALTER TABLE leads ADD COLUMN grade TEXT",
  "ALTER TABLE leads ADD COLUMN score INTEGER",
  "ALTER TABLE leads ADD COLUMN grade_reason TEXT",
  "ALTER TABLE leads ADD COLUMN graded_at TEXT",
];
// v5 迁移：content_items 补 status 列（存量行由列默认值 'published' 填充），同样幂等
const CONTENT_MIGRATIONS = [
  "ALTER TABLE content_items ADD COLUMN status TEXT DEFAULT 'published'",
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady || !db) return;
  for (let i = 0; i < DDL.length; i++) {
    try { await db.prepare(DDL[i]).run(); }
    catch (e) { throw new Error("ensureSchema DDL#" + i + ": " + (e && e.message ? e.message : String(e))); }
  }
  for (const sql of STAFF_MIGRATIONS) {
    try { await db.prepare(sql).run(); } catch (e) { /* 列已存在，幂等忽略 */ }
  }
  for (const sql of TASK_MIGRATIONS) {
    try { await db.prepare(sql).run(); } catch (e) { /* 列已存在，幂等忽略 */ }
  }
  for (const sql of LEAD_MIGRATIONS) {
    try { await db.prepare(sql).run(); } catch (e) { /* 列已存在，幂等忽略 */ }
  }
  for (const sql of CONTENT_MIGRATIONS) {
    try { await db.prepare(sql).run(); } catch (e) { /* 列已存在，幂等忽略 */ }
  }
  schemaReady = true;
}
function nowIso() { return new Date().toISOString(); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthStr() { return new Date().toISOString().slice(0, 7); }

// ===== 认证 =====
async function hmacHex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function getCookie(req, name) {
  const h = req.headers.get("Cookie") || "";
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}
async function isAuthed(req, env) {
  if (!env.ADMIN_KEY) return false;
  const expect = await hmacHex(env.ADMIN_KEY, COOKIE_MSG);
  return timingSafeEq(getCookie(req, COOKIE_NAME), expect);
}
function redirect(to) {
  return new Response(null, { status: 303, headers: { Location: to } });
}

// ===== CORS =====
function corsHeaders(req) {
  const origin = req.headers.get("Origin") || "";
  const h = { Vary: "Origin" };
  if (CORS_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}
function jsonResp(req, data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) },
  });
}

// ===== 公开 API（无需登录，严格校验输入）=====
async function handleApi(req, env, url) {
  const p = url.pathname;
  const db = env.DB;

  if (p === "/api/ping") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    const ref = clampStr(body.ref, 24);
    const page = clampStr(body.page || "index", 60);
    if (!validRef(ref)) return jsonResp(req, { ok: false, error: "bad ref" }, 400);
    await ensureSchema(db);
    await db.prepare(
      `INSERT INTO visits(ref, page, day, count) VALUES(?, ?, ?, 1)
       ON CONFLICT(ref, page, day) DO UPDATE SET count = count + 1`
    ).bind(ref, page, todayStr()).run();
    return jsonResp(req, { ok: true });
  }

  if (p === "/api/lead") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    const name = clampStr(body.name, 40);
    const wechat = clampStr(body.wechat, 60);
    const phone = clampStr(body.phone, 30);
    const source = clampStr(body.source, 20);
    const ref = clampStr(body.ref, 24);
    const eval_summary = clampStr(body.eval_summary, 2000);
    const note = clampStr(body.note, 2000);
    if (!name) return jsonResp(req, { ok: false, error: "name required" }, 400);
    if (!LEAD_SOURCES[source]) return jsonResp(req, { ok: false, error: "bad source" }, 400);
    if (ref && !validRef(ref)) return jsonResp(req, { ok: false, error: "bad ref" }, 400);
    await ensureSchema(db);
    const r = await db.prepare(
      `INSERT INTO leads(name, wechat, phone, source, ref, eval_summary, status, note, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`
    ).bind(name, wechat, phone, source, ref || null, eval_summary, note, nowIso(), nowIso()).run();
    return jsonResp(req, { ok: true, id: r.meta.last_row_id });
  }

  if (p === "/api/faq") {
    if (req.method !== "GET") return jsonResp(req, { ok: false, error: "method" }, 405);
    const lang = clampStr(url.searchParams.get("lang") || "zh-CN", 10);
    await ensureSchema(db);
    const rows = await db.prepare(
      `SELECT id, lang, q, a, sort FROM faqs WHERE lang = ? AND active = 1 ORDER BY sort ASC, id ASC`
    ).bind(lang).all();
    return jsonResp(req, (rows.results || []).map((f) => ({ id: f.id, lang: f.lang, q: f.q, a: f.a, sort: f.sort })));
  }

  if (p === "/api/admin/summary") {
    if (req.method !== "GET") return jsonResp(req, { ok: false, error: "method" }, 405);
    const token = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.LEAD_API_TOKEN || token !== env.LEAD_API_TOKEN) return jsonResp(req, { ok: false, error: "unauthorized" }, 401);
    await ensureSchema(db);
    const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
    const byStatus = await db.prepare(`SELECT status, COUNT(*) AS n FROM leads GROUP BY status`).all();
    const newLeads = await db.prepare(
      `SELECT name, source, ref, created_at FROM leads WHERE created_at >= ? ORDER BY created_at DESC LIMIT 50`
    ).bind(since7).all();
    const stale = await db.prepare(
      `SELECT name, status, updated_at FROM leads WHERE status IN ('new','contacted') AND updated_at < ? ORDER BY updated_at ASC LIMIT 50`
    ).bind(since7).all();
    const visitsToday = await db.prepare(`SELECT COALESCE(SUM(count),0) AS n FROM visits WHERE day = ?`).bind(todayStr()).first();
    const unsettled = await db.prepare(
      `SELECT COALESCE(SUM(commission),0) AS cents FROM orders WHERE settle_status = 'unsettled'`
    ).first();
    const byGrade = await db.prepare(`SELECT grade, COUNT(*) AS n FROM leads WHERE grade IS NOT NULL GROUP BY grade`).all();
    const ungraded = await db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE grade IS NULL`).first();
    // weekly（v5）：近 7 天运营复盘口，供周日复盘直接取数成稿。
    // 线索按 created_at >= 7 天前（与 new_leads_7d 同口径）；内容指标按 day 落在含今天在内的 7 个自然日内。
    const since7Day = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    const newLeadsW = await db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?`).bind(since7).first();
    const byGradeW = await db.prepare(
      `SELECT grade, COUNT(*) AS n FROM leads WHERE created_at >= ? AND grade IS NOT NULL GROUP BY grade`).bind(since7).all();
    const contentLeadsW = await db.prepare(
      `SELECT COALESCE(SUM(leads),0) AS n FROM content_metrics WHERE day >= ?`).bind(since7Day).first();
    const topContentW = await db.prepare(
      `SELECT i.id AS id, i.title AS title, COALESCE(SUM(m.leads),0) AS leads, COALESCE(SUM(m.views),0) AS views
       FROM content_metrics m JOIN content_items i ON i.id = m.item_id
       WHERE m.day >= ? GROUP BY m.item_id ORDER BY leads DESC, views DESC LIMIT 1`).bind(since7Day).first();
    const overdueTasksW = await db.prepare(
      `SELECT COUNT(*) AS n FROM tasks WHERE status != 'done' AND due IS NOT NULL AND due != '' AND due < ?`).bind(todayStr()).first();
    const studentRowsW = (await db.prepare(`SELECT stage, stage_since FROM students`).all()).results || [];
    const overdueStudentsW = studentRowsW.filter(
      (s) => ACTIVE_STAGES.includes(s.stage) && isOverdueStage(s.stage_since, Date.now(), STAGE_OVERDUE_DAYS)).length;
    const weekly = {
      new_leads: newLeadsW ? newLeadsW.n : 0,
      leads_by_grade: (byGradeW.results || []).map((r) => ({ grade: r.grade, n: r.n })),
      content_leads: contentLeadsW ? contentLeadsW.n : 0,
      top_content: topContentW ? {
        id: topContentW.id, title: topContentW.title, leads: topContentW.leads,
        views: topContentW.views, conv_rate: convRate(topContentW.leads, topContentW.views),
      } : null,
      overdue_tasks: overdueTasksW ? overdueTasksW.n : 0,
      overdue_students: overdueStudentsW,
    };
    return jsonResp(req, {
      ok: true,
      leads_by_status: (byStatus.results || []).map((r) => ({ status: r.status, n: r.n })),
      leads_by_grade: (byGrade.results || []).map((r) => ({ grade: r.grade, n: r.n })),
      leads_ungraded: ungraded ? ungraded.n : 0,
      new_leads_7d: newLeads.results || [],
      stale_leads: stale.results || [],
      visits_today: visitsToday ? visitsToday.n : 0,
      unsettled_commission_cents: unsettled ? unsettled.cents : 0,
      weekly,
    });
  }

  // 线索自动评级处理入口（线索管家专用，Bearer LEAD_API_TOKEN）：
  // 一次处理全部未评级线索（grade IS NULL），评分规则见 scoreLead，结果写回 leads 表。
  if (p === "/api/admin/leads/process") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    const token = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.LEAD_API_TOKEN || token !== env.LEAD_API_TOKEN) return jsonResp(req, { ok: false, error: "unauthorized" }, 401);
    await ensureSchema(db);
    const agentRows = await db.prepare(`SELECT code FROM agents WHERE active = 1`).all();
    const validRefs = new Set((agentRows.results || []).map((a) => a.code));
    const rows = (await db.prepare(
      `SELECT * FROM leads WHERE grade IS NULL ORDER BY id ASC LIMIT 500`).all()).results || [];
    const by_grade = { A: 0, B: 0, C: 0 };
    const details = [];
    let tasks_created = 0;
    for (const lead of rows) {
      const r = scoreLead(lead, validRefs);
      await db.prepare(
        `UPDATE leads SET grade = ?, score = ?, grade_reason = ?, graded_at = ? WHERE id = ?`
      ).bind(r.grade, r.score, r.reason, nowIso(), lead.id).run();
      by_grade[r.grade]++;
      const detail = { id: lead.id, name: lead.name, grade: r.grade, score: r.score, reason: r.reason };
      // 任务环联动（v5）：grade=A 且线索仍为 new 时，自动给「线索管家」建一条跟进任务（处理日 +2 天到期）。
      // 去重口径：任务 note 中带 [lead:<线索id>] 标记；该线索已有未完成任务带此标记则不重复建。
      // 已评级线索不会再次进入本循环（grade IS NULL 过滤），标记检查是第二道防线。
      if (r.grade === "A" && lead.status === "new") {
        const marker = leadTaskMarker(lead.id);
        const dup = await db.prepare(
          `SELECT id FROM tasks WHERE status != 'done' AND note LIKE ? LIMIT 1`
        ).bind("%" + marker + "%").first();
        if (!dup) {
          const title = clampStr("跟进A级线索：" + (lead.name || "") + "（A级 " + r.score + "分）", 120);
          const note = "A级线索自动跟进；评级理由：" + r.reason + " " + marker;
          const tr = await db.prepare(
            `INSERT INTO tasks(title, owner, due, status, note, created_at, updated_at, type)
             VALUES(?, '线索管家', ?, 'todo', ?, ?, ?, 'task')`
          ).bind(title, followupDueStr(Date.now()), note, nowIso(), nowIso()).run();
          tasks_created++;
          detail.task_id = tr.meta.last_row_id;
        }
      }
      details.push(detail);
    }
    return jsonResp(req, { ok: true, processed: rows.length, by_grade, tasks_created, details });
  }

  // 内容写回入口（内容 bot 专用，Bearer LEAD_API_TOKEN）：批量导入内容条目，产出落 content_items 表。
  // 请求体 { items: [{ title, platform, pub_date, ref, type, status }] }，单次上限 50 条。
  // status 省略时默认 draft（bot 产出先入草稿，等创始人过审再发布）；type 省略默认 video；pub_date 省略为今天。
  // 逐条返回 { index, ok, id|error }，单条校验失败不影响其他条。
  if (p === "/api/admin/content/import") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    const token = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.LEAD_API_TOKEN || token !== env.LEAD_API_TOKEN) return jsonResp(req, { ok: false, error: "unauthorized" }, 401);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    const items = body && Array.isArray(body.items) ? body.items : null;
    if (!items || !items.length) return jsonResp(req, { ok: false, error: "items required" }, 400);
    if (items.length > 50) return jsonResp(req, { ok: false, error: "too many items (max 50)" }, 400);
    await ensureSchema(db);
    const results = [];
    let imported = 0;
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx] || {};
      const title = clampStr(it.title, 120);
      if (!title) { results.push({ index: idx, ok: false, error: "title required" }); continue; }
      let ref = null;
      const refRaw = clampStr(it.ref, 24);
      if (refRaw) {
        if (!validRef(refRaw)) { results.push({ index: idx, ok: false, error: "bad ref" }); continue; }
        ref = refRaw;
      }
      const type = it.type === undefined || it.type === null || it.type === "" ? "video" : String(it.type);
      if (!CONTENT_TYPES[type]) { results.push({ index: idx, ok: false, error: "bad type" }); continue; }
      const status = it.status === undefined || it.status === null || it.status === "" ? "draft" : String(it.status);
      if (!CONTENT_STATUSES[status]) { results.push({ index: idx, ok: false, error: "bad status" }); continue; }
      const pubDate = it.pub_date === undefined || it.pub_date === null || it.pub_date === ""
        ? todayStr() : clampStr(it.pub_date, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pubDate)) { results.push({ index: idx, ok: false, error: "bad pub_date" }); continue; }
      const platform = clampStr(it.platform, 40);
      const r = await db.prepare(
        `INSERT INTO content_items(title, platform, pub_date, ref, type, status, created_at) VALUES(?,?,?,?,?,?,?)`
      ).bind(title, platform, pubDate, ref, type, status, nowIso()).run();
      imported++;
      results.push({ index: idx, ok: true, id: r.meta.last_row_id });
    }
    return jsonResp(req, { ok: true, imported, results });
  }

  // 内容指标写回入口（Bearer LEAD_API_TOKEN）：批量写入 content_metrics。
  // 请求体 { metrics: [{ item_id, day, views, consults, leads }] }，单次上限 100 条。
  // 每条追加一行（与后台手动录入口径一致，多行按条目汇总时求和）；day 省略为今天；数值须为 ≥0 的数。
  if (p === "/api/admin/content/metrics") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    const token = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.LEAD_API_TOKEN || token !== env.LEAD_API_TOKEN) return jsonResp(req, { ok: false, error: "unauthorized" }, 401);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    const list = body && Array.isArray(body.metrics) ? body.metrics : null;
    if (!list || !list.length) return jsonResp(req, { ok: false, error: "metrics required" }, 400);
    if (list.length > 100) return jsonResp(req, { ok: false, error: "too many metrics (max 100)" }, 400);
    await ensureSchema(db);
    const idRows = (await db.prepare(`SELECT id FROM content_items`).all()).results || [];
    const idSet = new Set(idRows.map((x) => x.id));
    const metricNum = (v) => {
      if (v === undefined || v === null || v === "") return 0;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : -1;
    };
    const results = [];
    let inserted = 0;
    for (let idx = 0; idx < list.length; idx++) {
      const m = list[idx] || {};
      const itemId = toInt(m.item_id, 0);
      if (!itemId || !idSet.has(itemId)) { results.push({ index: idx, ok: false, error: "bad item_id" }); continue; }
      const day = m.day === undefined || m.day === null || m.day === "" ? todayStr() : clampStr(m.day, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { results.push({ index: idx, ok: false, error: "bad day" }); continue; }
      const views = metricNum(m.views), consults = metricNum(m.consults), leadsN = metricNum(m.leads);
      if (views < 0 || consults < 0 || leadsN < 0) { results.push({ index: idx, ok: false, error: "bad metric value" }); continue; }
      const r = await db.prepare(
        `INSERT INTO content_metrics(item_id, day, views, consults, leads) VALUES(?,?,?,?,?)`
      ).bind(itemId, day, views, consults, leadsN).run();
      inserted++;
      results.push({ index: idx, ok: true, id: r.meta.last_row_id });
    }
    return jsonResp(req, { ok: true, inserted, results });
  }

  // 任务写回入口（bot 专用，Bearer LEAD_API_TOKEN）：按任务 id 标记完成，供 bot 干完活自己写回。
  // 请求体 { id }；已完成的重复调用返回 already_done: true（幂等）；任务不存在返回 404。
  if (p === "/api/admin/tasks/complete") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    const token = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.LEAD_API_TOKEN || token !== env.LEAD_API_TOKEN) return jsonResp(req, { ok: false, error: "unauthorized" }, 401);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    const id = toInt(body && body.id, 0);
    if (!id) return jsonResp(req, { ok: false, error: "id required" }, 400);
    await ensureSchema(db);
    const task = await db.prepare(`SELECT id, status FROM tasks WHERE id = ?`).bind(id).first();
    if (!task) return jsonResp(req, { ok: false, error: "task not found" }, 404);
    if (task.status === "done") return jsonResp(req, { ok: true, id, status: "done", already_done: true });
    await db.prepare(`UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?`).bind(nowIso(), id).run();
    return jsonResp(req, { ok: true, id, status: "done", already_done: false });
  }

  return jsonResp(req, { ok: false, error: "not found" }, 404);
}

// ===== 后台页面框架 =====
const CSS = `
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;background:#f4f4f8;color:#222;font-size:15px}
header{background:#7c3aed;color:#fff;padding:14px 16px}header h1{margin:0;font-size:18px}
nav{background:#fff;border-bottom:1px solid #e5e5ea;display:flex;overflow-x:auto;position:sticky;top:0;z-index:10}
nav a{padding:12px 16px;color:#555;text-decoration:none;white-space:nowrap;font-size:14px}
nav a.on{color:#7c3aed;border-bottom:2px solid #7c3aed;font-weight:600}
nav a.logout{margin-left:auto;color:#999}
main{max-width:1000px;margin:0 auto;padding:12px 14px 40px}
.card{background:#fff;border-radius:10px;padding:16px;margin:12px 0;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.stat{background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.stat .n{font-size:24px;font-weight:700;color:#7c3aed;margin-top:4px}
.stat .l{font-size:13px;color:#666}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:9px 8px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
th{color:#666;font-weight:600;background:#fafafc}
.wrap{overflow-x:auto}
input,select,textarea{width:100%;padding:9px 10px;border:1px solid #ddd;border-radius:8px;font-size:14px;margin:4px 0 10px;background:#fff}
textarea{min-height:80px}
label{font-size:13px;color:#555}
button,.btn{display:inline-block;background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:9px 18px;font-size:14px;cursor:pointer;text-decoration:none}
button.ghost,.btn.ghost{background:#eee;color:#333}
button.danger{background:#dc2626}
button.small{padding:5px 12px;font-size:13px}
.row{display:flex;gap:10px;flex-wrap:wrap}.row>div{flex:1;min-width:140px}
.mut{color:#888;font-size:13px}.ok{color:#15803d}.warn{color:#b45309}
.bad{color:#dc2626;font-weight:600}
.pill{display:inline-block;padding:1px 9px;border-radius:99px;background:#ede9fe;color:#5b21b6;font-size:12px}
.subtabs{margin:2px 0 12px}.subtabs a{display:inline-block;padding:7px 16px;border-radius:99px;background:#ececf1;color:#444;text-decoration:none;font-size:14px;margin-right:8px}
.subtabs a.on{background:#7c3aed;color:#fff;font-weight:600}
.login{max-width:360px;margin:60px auto}
h2{font-size:17px;margin:4px 0 12px}h3{font-size:15px;margin:14px 0 8px}
`;
function layout(title, active, body) {
  const tabs = [
    ["/admin", "首页"], ["/admin/leads", "线索"], ["/admin/delivery", "交付"],
    ["/admin/agents", "代理"], ["/admin/orders", "订单"], ["/admin/content", "内容"],
    ["/admin/tasks", "任务"], ["/admin/staff", "人员"],
  ];
  const nav = tabs.map(([href, label]) =>
    `<a href="${href}" class="${active === href ? "on" : ""}">${label}</a>`).join("");
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} - TransferOS 管理后台</title><style>${CSS}</style></head>
<body><header><h1>TransferOS 业务管理后台</h1></header>
<nav>${nav}<a href="/admin/logout" class="logout">退出</a></nav>
<main>${body}</main></body></html>`;
}
function htmlResp(body) {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function opts(map, sel) {
  return Object.entries(map).map(([k, v]) =>
    `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${esc(v)}</option>`).join("");
}
function monthInput(cur) {
  return `<form method="get" style="display:inline"><input type="month" name="settle" value="${esc(cur)}" style="width:auto;display:inline-block;margin:0">
  <button type="submit" class="small ghost">查看</button></form>`;
}

// ===== 登录 / 退出 =====
async function handleLogin(req, env, err) {
  const token = await hmacHex(env.ADMIN_KEY, COOKIE_MSG);
  if (req.method === "POST") {
    const fd = await req.formData();
    const pwd = String(fd.get("password") || "");
    const input = await hmacHex(pwd, COOKIE_MSG);
    if (timingSafeEq(input, token)) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/admin",
          "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
        },
      });
    }
    return htmlResp(loginPage("密码不正确，请重试"));
  }
  return htmlResp(loginPage(err || ""));
}
function loginPage(msg) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录 - TransferOS 管理后台</title><style>${CSS}</style></head>
<body><div class="card login"><h2>TransferOS 管理后台</h2>
${msg ? `<p class="warn">${esc(msg)}</p>` : ""}
<form method="post"><label>管理密码</label>
<input type="password" name="password" required autocomplete="current-password">
<button type="submit" style="width:100%">登录</button></form></div></body></html>`;
}
function handleLogout() {
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/admin/login",
      "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}

// ===== 仪表盘 =====
async function pageDashboard(env) {
  const db = env.DB;
  const one = async (sql, ...binds) => {
    const r = await db.prepare(sql).bind(...binds).first();
    return r ? r.n : 0;
  };
  const totalLeads = await one("SELECT COUNT(*) n FROM leads");
  const monthLeads = await one("SELECT COUNT(*) n FROM leads WHERE created_at LIKE ?", monthStr() + "%");
  const statusRows = (await db.prepare("SELECT status, COUNT(*) c FROM leads GROUP BY status").all()).results || [];
  const totalVisits = await one("SELECT COALESCE(SUM(count),0) n FROM visits");
  const topRefs = (await db.prepare("SELECT ref, SUM(count) c FROM visits GROUP BY ref ORDER BY c DESC LIMIT 10").all()).results || [];
  const unsettled = await one("SELECT COALESCE(SUM(commission),0) n FROM orders WHERE settle_status='unsettled'");
  const pendingProposals = await one("SELECT COUNT(*) n FROM tasks WHERE type='proposal' AND status != 'done'");
  // 人员概览（v3：真人 + AI 员工）
  const staffRows = (await db.prepare("SELECT kind, status, COUNT(*) c FROM staff GROUP BY kind, status").all()).results || [];
  const staffCount = (kind, status) => staffRows.filter((r) => r.kind === kind && r.status === status).reduce((a, r) => a + r.c, 0);
  const staffProbation = staffRows.filter((r) => r.status === "probation").reduce((a, r) => a + r.c, 0);
  const staffSuspended = staffRows.filter((r) => r.status === "suspended").reduce((a, r) => a + r.c, 0);
  // 交付概览
  const students = (await db.prepare("SELECT stage, stage_since FROM students").all()).results || [];
  const nowMs = Date.now();
  const inDelivery = students.filter((s) => ACTIVE_STAGES.includes(s.stage)).length;
  const overdueStudents = students.filter(
    (s) => ACTIVE_STAGES.includes(s.stage) && isOverdueStage(s.stage_since, nowMs, STAGE_OVERDUE_DAYS)
  ).length;
  // 本月内容带来的线索（手动录入的指标）
  const monthContentLeads = await one(
    "SELECT COALESCE(SUM(leads),0) n FROM content_metrics WHERE day LIKE ?", monthStr() + "%");
  // 任务提醒
  const tasks = (await db.prepare("SELECT * FROM tasks WHERE status != 'done' ORDER BY due IS NULL, due ASC, id DESC").all()).results || [];
  const tState = tasks.map((t) => taskDueState(t.due, t.status, todayStr()));
  const overdueTasks = tState.filter((s) => s === "overdue").length;
  const dueTodayTasks = tState.filter((s) => s === "today").length;
  const taskListHtml = tasks.slice(0, 5).map((t, i) => {
    const st = tState[i];
    const badge = st === "overdue" ? '<span class="bad">已逾期</span>'
      : st === "today" ? '<span class="warn">今天到期</span>' : '<span class="mut">待处理</span>';
    return `<tr><td>${esc(t.title)}</td><td>${esc(t.owner || "")}</td><td>${esc(t.due || "—")}</td><td>${badge}</td></tr>`;
  }).join("");
  // 访问统计（近 30 天）
  const since30 = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const dailyVisits = (await db.prepare(
    "SELECT day, SUM(count) c FROM visits WHERE day >= ? GROUP BY day ORDER BY day DESC").bind(since30).all()).results || [];
  const topPages = (await db.prepare(
    "SELECT page, SUM(count) c FROM visits GROUP BY page ORDER BY c DESC LIMIT 10").all()).results || [];
  const dailyHtml = dailyVisits.length
    ? dailyVisits.map((r) => `<tr><td>${esc(r.day)}</td><td>${r.c}</td></tr>`).join("")
    : `<tr><td colspan="2" class="mut">暂无访问数据（网站接通上报后自动汇总）</td></tr>`;
  const pagesHtml = topPages.length
    ? topPages.map((r) => `<tr><td>${esc(r.page)}</td><td>${r.c}</td></tr>`).join("")
    : `<tr><td colspan="2" class="mut">暂无访问数据（网站接通上报后自动汇总）</td></tr>`;

  const statusHtml = statusRows.length
    ? statusRows.map((r) => `<div class="stat"><div class="l">${esc(LEAD_STATUSES[r.status] || r.status)}</div><div class="n">${r.c}</div></div>`).join("")
    : `<div class="stat"><div class="l">暂无线索</div><div class="n">0</div></div>`;
  const topHtml = topRefs.length
    ? topRefs.map((r) => `<tr><td>${esc(r.ref)}</td><td>${r.c}</td></tr>`).join("")
    : `<tr><td colspan="2" class="mut">暂无访问记录</td></tr>`;
  const announcement = (await db.prepare("SELECT value FROM settings WHERE key='announcement'").first())?.value || "";
  const body = `
  ${announcement ? `<div class="card"><strong>公告：</strong>${esc(announcement)}</div>` : ""}
  <div class="grid">
    <div class="stat"><div class="l">线索总数</div><div class="n">${totalLeads}</div></div>
    <div class="stat"><div class="l">本月新增线索</div><div class="n">${monthLeads}</div></div>
    <div class="stat"><div class="l">学生总数</div><div class="n">${students.length}</div></div>
    <div class="stat"><div class="l">交付中</div><div class="n">${inDelivery}</div></div>
    <div class="stat"><div class="l">交付逾期（阶段超 ${STAGE_OVERDUE_DAYS} 天）</div><div class="n">${overdueStudents}</div></div>
    <div class="stat"><div class="l">本月内容线索</div><div class="n">${monthContentLeads}</div></div>
    <div class="stat"><div class="l">逾期任务</div><div class="n">${overdueTasks}</div></div>
    <div class="stat"><div class="l">待处理提案</div><div class="n">${pendingProposals}</div></div>
    <div class="stat"><div class="l">未结算佣金</div><div class="n">${fmtYuan(unsettled)}</div></div>
  </div>
  <div class="card"><h2>人员概览</h2>
  <p>真人在职 ${staffCount("human", "active")} · AI 在职 ${staffCount("ai", "active")} · 试用 ${staffProbation} · 停用待查 ${staffSuspended}</p>
  <p><a href="/admin/staff">查看人员 →</a></p></div>
  <h3>线索按状态</h3><div class="grid">${statusHtml}</div>
  <div class="card"><h2>任务提醒${dueTodayTasks ? `（今天到期 ${dueTodayTasks} 件）` : ""}</h2>
  ${tasks.length ? `<div class="wrap"><table><tr><th>任务</th><th>负责人</th><th>截止</th><th>状态</th></tr>${taskListHtml}</table></div>
  <p><a href="/admin/tasks">查看全部任务 →</a></p>` : `<p class="mut">暂无未完成任务</p>`}</div>
  <div class="card"><h2>访问统计（近 30 天，总访问量 ${totalVisits}）</h2>
  <div class="row">
    <div><h3>按日</h3><div class="wrap"><table><tr><th>日期</th><th>访问量</th></tr>${dailyHtml}</table></div></div>
    <div><h3>按页面 Top</h3><div class="wrap"><table><tr><th>页面</th><th>访问量</th></tr>${pagesHtml}</table></div></div>
    <div><h3>按来源 Top 10</h3><div class="wrap"><table><tr><th>来源码</th><th>访问量</th></tr>${topHtml}</table></div></div>
  </div></div>
  <div class="card"><h2>内部邮件管理</h2>
  <p class="mut">内部邮箱账号在腾讯企业邮箱管理后台统一管理（开通账号、分组、权限都在腾讯侧）。</p>
  <p><a class="btn" href="https://exmail.qq.com/" target="_blank" rel="noopener">打开腾讯企业邮箱管理后台 ↗</a></p></div>`;
  return htmlResp(layout("首页", "/admin", body));
}

// ===== 线索 =====
async function pageLeads(req, env, url) {
  const db = env.DB;
  const fStatus = url.searchParams.get("status") || "";
  const fRef = (url.searchParams.get("ref") || "").trim();
  let sql = "SELECT * FROM leads WHERE 1=1";
  const binds = [];
  if (LEAD_STATUSES[fStatus]) { sql += " AND status = ?"; binds.push(fStatus); }
  if (fRef) { sql += " AND ref = ?"; binds.push(fRef); }
  sql += " ORDER BY id DESC LIMIT 200";
  const rows = (await db.prepare(sql).bind(...binds).all()).results || [];

  const editId = toInt(url.searchParams.get("edit"), 0);
  const edit = editId ? await db.prepare("SELECT * FROM leads WHERE id=?").bind(editId).first() : null;
  const f = edit || { name: "", wechat: "", phone: "", source: "manual", ref: "", eval_summary: "", status: "new", note: "" };

  const rowHtml = rows.map((l) => `<tr>
    <td>${l.id}</td><td>${esc(l.name)}</td><td>${esc(l.wechat)}</td><td>${esc(l.phone)}</td>
    <td>${esc(LEAD_SOURCES[l.source] || l.source || "")}</td><td>${esc(l.ref || "")}</td>
    <td>${esc(LEAD_STATUSES[l.status] || l.status)}</td>
    <td>${l.grade ? `<span class="pill">${esc(l.grade)} 级 · ${l.score} 分</span>${l.grade_reason ? `<div class="mut">${esc(l.grade_reason)}</div>` : ""}` : '<span class="mut">未评级</span>'}</td>
    <td class="mut">${esc((l.created_at || "").slice(0, 10))}</td>
    <td><a href="/admin/user?id=${l.id}">档案</a> · <a href="/admin/leads?edit=${l.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条线索？')">
      <input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${l.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");

  const body = `
  <div class="card"><h2>线索筛选</h2>
  <form method="get"><div class="row">
    <div><label>状态</label><select name="status">
      <option value="">全部</option>${opts(LEAD_STATUSES, fStatus)}</select></div>
    <div><label>来源码（ref）</label><input name="ref" value="${esc(fRef)}" placeholder="如 GD001"></div>
    <div style="align-self:end"><button type="submit">筛选</button></div>
  </div></form></div>
  <div class="card"><h2>${edit ? "编辑线索 #" + edit.id : "新增线索"}</h2>
  <form method="post">
    <input type="hidden" name="action" value="${edit ? "update" : "add"}">
    ${edit ? `<input type="hidden" name="id" value="${edit.id}">` : ""}
    <div class="row">
      <div><label>姓名 *</label><input name="name" required maxlength="40" value="${esc(f.name)}"></div>
      <div><label>微信号</label><input name="wechat" maxlength="60" value="${esc(f.wechat)}"></div>
      <div><label>电话</label><input name="phone" maxlength="30" value="${esc(f.phone)}"></div>
    </div>
    <div class="row">
      <div><label>来源</label><select name="source">${opts(LEAD_SOURCES, f.source)}</select></div>
      <div><label>来源码（ref）</label><input name="ref" maxlength="24" value="${esc(f.ref || "")}"></div>
      <div><label>状态</label><select name="status">${opts(LEAD_STATUSES, f.status)}</select></div>
    </div>
    <label>评估摘要</label><textarea name="eval_summary" maxlength="2000">${esc(f.eval_summary)}</textarea>
    <label>备注</label><textarea name="note" maxlength="2000">${esc(f.note)}</textarea>
    <button type="submit">${edit ? "保存修改" : "添加线索"}</button>
    ${edit ? `<a class="btn ghost" href="/admin/leads">取消编辑</a>` : ""}
  </form></div>
  <div class="card"><h2>线索列表（${rows.length}）</h2><div class="wrap">
  <table><tr><th>ID</th><th>姓名</th><th>微信</th><th>电话</th><th>来源</th><th>ref</th><th>状态</th><th>评级</th><th>日期</th><th></th><th></th></tr>
  ${rowHtml || `<tr><td colspan="11" class="mut">暂无线索</td></tr>`}</table></div></div>`;
  return htmlResp(layout("线索", "/admin/leads", body));
}
async function postLeads(req, env) {
  const db = env.DB;
  const fd = await req.formData();
  const action = String(fd.get("action") || "");
  if (action === "delete") {
    await db.prepare("DELETE FROM leads WHERE id=?").bind(toInt(fd.get("id"), 0)).run();
    return redirect("/admin/leads");
  }
  const name = clampStr(fd.get("name"), 40);
  if (!name) return redirect("/admin/leads");
  const wechat = clampStr(fd.get("wechat"), 60);
  const phone = clampStr(fd.get("phone"), 30);
  const source = LEAD_SOURCES[fd.get("source")] ? String(fd.get("source")) : "manual";
  const refRaw = clampStr(fd.get("ref"), 24);
  const ref = validRef(refRaw) ? refRaw : null;
  const status = LEAD_STATUSES[fd.get("status")] ? String(fd.get("status")) : "new";
  const eval_summary = clampStr(fd.get("eval_summary"), 2000);
  const note = clampStr(fd.get("note"), 2000);
  if (action === "update") {
    await db.prepare(
      `UPDATE leads SET name=?, wechat=?, phone=?, source=?, ref=?, status=?, eval_summary=?, note=?, updated_at=? WHERE id=?`
    ).bind(name, wechat, phone, source, ref, status, eval_summary, note, nowIso(), toInt(fd.get("id"), 0)).run();
  } else {
    await db.prepare(
      `INSERT INTO leads(name, wechat, phone, source, ref, status, eval_summary, note, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).bind(name, wechat, phone, source, ref, status, eval_summary, note, nowIso(), nowIso()).run();
  }
  return redirect("/admin/leads");
}

// ===== 交付进度 =====
async function pageDelivery(env, url) {
  const db = env.DB;
  const nowMs = Date.now();
  const students = (await db.prepare("SELECT * FROM students ORDER BY id DESC LIMIT 300").all()).results || [];
  // 阶段看板
  const boardHtml = Object.entries(DELIVERY_STAGES).map(([code, name]) => {
    const inStage = students.filter((s) => s.stage === code);
    const od = ACTIVE_STAGES.includes(code)
      ? inStage.filter((s) => isOverdueStage(s.stage_since, nowMs, STAGE_OVERDUE_DAYS)).length : 0;
    return `<div class="stat"><div class="l">${esc(name)}</div><div class="n">${inStage.length}</div>
      ${od ? `<div class="bad">逾期 ${od}</div>` : ""}</div>`;
  }).join("");
  // 待生成学生的订单
  const pending = (await db.prepare(
    `SELECT o.* FROM orders o LEFT JOIN students s ON s.order_id = o.id
     WHERE s.id IS NULL ORDER BY o.id DESC LIMIT 50`).all()).results || [];
  const pendingHtml = pending.length ? `
  <div class="card"><h2>待生成学生的订单（${pending.length}）</h2><div class="wrap">
  <table><tr><th>订单</th><th>客户</th><th>套餐</th><th>金额</th><th>日期</th><th></th></tr>
  ${pending.map((o) => `<tr><td>${o.id}</td><td>${esc(o.customer)}</td><td>${esc(o.package)}</td>
    <td>${fmtYuan(o.amount)}</td><td class="mut">${esc((o.created_at || "").slice(0, 10))}</td>
    <td><form method="post" style="margin:0"><input type="hidden" name="action" value="from_order">
    <input type="hidden" name="order_id" value="${o.id}">
    <button class="small" type="submit">生成学生档案</button></form></td></tr>`).join("")}
  </table></div></div>` : "";

  const editId = toInt(url.searchParams.get("edit"), 0);
  const edit = editId ? students.find((s) => s.id === editId) : null;
  const f = edit || { name: "", package: "", lead_id: "", order_id: "", stage: "diag", note: "" };

  const rowHtml = students.map((s) => {
    const days = daysInStage(s.stage_since, nowMs);
    const overdue = ACTIVE_STAGES.includes(s.stage) && isOverdueStage(s.stage_since, nowMs, STAGE_OVERDUE_DAYS);
    const daysTxt = days === null ? "—" : `已停留 ${days} 天`;
    return `<tr>
    <td>${s.id}</td>
    <td>${s.lead_id ? `<a href="/admin/user?id=${s.lead_id}">${esc(s.name)}</a>` : esc(s.name)}</td>
    <td>${esc(s.package)}</td>
    <td><span class="pill">${esc(DELIVERY_STAGES[s.stage] || s.stage)}</span></td>
    <td class="${overdue ? "bad" : "mut"}">${overdue ? "⚠ " : ""}${daysTxt}</td>
    <td><form method="post" style="margin:0;display:flex;gap:6px">
      <input type="hidden" name="action" value="stage"><input type="hidden" name="id" value="${s.id}">
      <select name="stage" style="margin:0;width:auto">${opts(DELIVERY_STAGES, s.stage)}</select>
      <button class="small" type="submit">推进</button></form></td>
    <td>${esc((s.note || "").slice(0, 40))}</td>
    <td><a href="/admin/delivery?edit=${s.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条学生档案？')">
      <input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${s.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`;
  }).join("");

  const body = `
  <h3>阶段看板（逾期 = 进行中阶段停留超过 ${STAGE_OVERDUE_DAYS} 天）</h3>
  <div class="grid">${boardHtml}</div>
  ${pendingHtml}
  <div class="card"><h2>${edit ? "编辑学生 #" + edit.id : "新增学生"}</h2>
  <form method="post">
    <input type="hidden" name="action" value="${edit ? "update" : "add"}">
    ${edit ? `<input type="hidden" name="id" value="${edit.id}">` : ""}
    <div class="row">
      <div><label>姓名 *</label><input name="name" required maxlength="40" value="${esc(f.name)}"></div>
      <div><label>所购套餐</label><input name="package" list="pkgs2" maxlength="60" value="${esc(f.package)}" placeholder="选择或输入">
        <datalist id="pkgs2">${PACKAGES.map((p) => `<option value="${esc(p)}">`).join("")}</datalist></div>
    </div>
    <div class="row">
      <div><label>关联线索ID（可空）</label><input name="lead_id" type="number" value="${esc(f.lead_id ?? "")}"></div>
      <div><label>关联订单ID（可空）</label><input name="order_id" type="number" value="${esc(f.order_id ?? "")}"></div>
      ${edit ? "" : `<div><label>初始阶段</label><select name="stage">${opts(DELIVERY_STAGES, f.stage)}</select></div>`}
    </div>
    <label>备注</label><textarea name="note" maxlength="2000">${esc(f.note)}</textarea>
    <button type="submit">${edit ? "保存修改" : "添加学生"}</button>
    ${edit ? `<a class="btn ghost" href="/admin/delivery">取消编辑</a>` : ""}
    ${edit ? `<p class="mut">阶段变更请用列表里的"推进"（会自动记录阶段开始时间）。</p>` : ""}
  </form></div>
  <div class="card"><h2>学生列表（${students.length}）</h2><div class="wrap">
  <table><tr><th>ID</th><th>姓名</th><th>套餐</th><th>当前阶段</th><th>停留</th><th>推进阶段</th><th>备注</th><th></th><th></th></tr>
  ${rowHtml || `<tr><td colspan="9" class="mut">暂无学生档案（成交后从订单一键生成，或在上方手动新增）</td></tr>`}</table></div></div>`;
  return htmlResp(layout("交付", "/admin/delivery", body));
}
async function postDelivery(req, env) {
  const db = env.DB;
  const fd = await req.formData();
  const action = String(fd.get("action") || "");
  const numOrNull = (v) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : toInt(s, 0);
  };
  if (action === "delete") {
    await db.prepare("DELETE FROM students WHERE id=?").bind(toInt(fd.get("id"), 0)).run();
    return redirect("/admin/delivery");
  }
  if (action === "stage") {
    const id = toInt(fd.get("id"), 0);
    const stage = String(fd.get("stage") || "");
    if (!validStage(stage)) return redirect("/admin/delivery");
    const cur = await db.prepare("SELECT stage FROM students WHERE id=?").bind(id).first();
    if (cur && cur.stage !== stage) {
      await db.prepare("UPDATE students SET stage=?, stage_since=?, updated_at=? WHERE id=?")
        .bind(stage, nowIso(), nowIso(), id).run();
    }
    return redirect("/admin/delivery");
  }
  if (action === "from_order") {
    const oid = toInt(fd.get("order_id"), 0);
    const order = await db.prepare("SELECT * FROM orders WHERE id=?").bind(oid).first();
    if (order) {
      const exists = await db.prepare("SELECT id FROM students WHERE order_id=?").bind(oid).first();
      if (!exists) {
        await db.prepare(
          `INSERT INTO students(lead_id, order_id, name, package, stage, stage_since, note, created_at, updated_at)
           VALUES(?,?,?,?, 'diag', ?, '', ?, ?)`
        ).bind(order.lead_id ?? null, order.id, order.customer || "", order.package || "", nowIso(), nowIso(), nowIso()).run();
      }
    }
    return redirect("/admin/delivery");
  }
  const name = clampStr(fd.get("name"), 40);
  if (!name) return redirect("/admin/delivery");
  const pkg = clampStr(fd.get("package"), 60);
  const note = clampStr(fd.get("note"), 2000);
  const lead_id = numOrNull(fd.get("lead_id"));
  const order_id = numOrNull(fd.get("order_id"));
  if (action === "update") {
    await db.prepare("UPDATE students SET name=?, package=?, lead_id=?, order_id=?, note=?, updated_at=? WHERE id=?")
      .bind(name, pkg, lead_id, order_id, note, nowIso(), toInt(fd.get("id"), 0)).run();
  } else {
    const stage = validStage(fd.get("stage")) ? String(fd.get("stage")) : "diag";
    await db.prepare(
      `INSERT INTO students(lead_id, order_id, name, package, stage, stage_since, note, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
    ).bind(lead_id, order_id, name, pkg, stage, nowIso(), note, nowIso(), nowIso()).run();
  }
  return redirect("/admin/delivery");
}

// ===== 用户档案（同一人的线索 + 订单 + 交付汇总）=====
async function pageUser(env, url) {
  const db = env.DB;
  const leadId = toInt(url.searchParams.get("id"), 0);
  const lead = leadId ? await db.prepare("SELECT * FROM leads WHERE id=?").bind(leadId).first() : null;
  if (!lead) {
    return htmlResp(layout("用户档案", "/admin/leads",
      `<div class="card"><h2>用户档案</h2><p class="mut">未找到该用户（线索 #${leadId} 不存在）。<a href="/admin/leads">返回线索列表</a></p></div>`));
  }
  const nowMs = Date.now();
  const agent = lead.ref ? await db.prepare("SELECT * FROM agents WHERE code=?").bind(lead.ref).first() : null;
  const orders = (await db.prepare("SELECT * FROM orders WHERE lead_id=? ORDER BY id DESC").bind(leadId).all()).results || [];
  const students = (await db.prepare("SELECT * FROM students WHERE lead_id=? ORDER BY id DESC").bind(leadId).all()).results || [];
  const totalAmount = orders.reduce((a, o) => a + (o.amount || 0), 0);
  const ordersHtml = orders.length ? orders.map((o) => `<tr>
    <td>${o.id}</td><td>${esc(o.package)}</td><td>${fmtYuan(o.amount)}</td>
    <td>${esc(ORDER_STAGES[o.stage] || o.stage || "")}</td>
    <td>${esc(PAID_STATUSES[o.paid_status] || o.paid_status)}</td>
    <td class="mut">${esc((o.created_at || "").slice(0, 10))}</td></tr>`).join("")
    : `<tr><td colspan="6" class="mut">暂无订单</td></tr>`;
  const studentsHtml = students.length ? students.map((s) => {
    const days = daysInStage(s.stage_since, nowMs);
    const overdue = ACTIVE_STAGES.includes(s.stage) && isOverdueStage(s.stage_since, nowMs, STAGE_OVERDUE_DAYS);
    return `<tr><td>${esc(s.name)}</td><td>${esc(s.package)}</td>
    <td><span class="pill">${esc(DELIVERY_STAGES[s.stage] || s.stage)}</span></td>
    <td class="${overdue ? "bad" : "mut"}">${overdue ? "⚠ " : ""}${days === null ? "—" : `已停留 ${days} 天`}</td>
    <td><a href="/admin/delivery?edit=${s.id}">去交付页</a></td></tr>`;
  }).join("") : `<tr><td colspan="5" class="mut">暂无学生档案</td></tr>`;
  const body = `
  <div class="card"><h2>用户档案：${esc(lead.name)}（线索 #${lead.id}）</h2>
  <div class="wrap"><table>
    <tr><th style="width:110px">微信</th><td>${esc(lead.wechat || "—")}</td><th style="width:110px">电话</th><td>${esc(lead.phone || "—")}</td></tr>
    <tr><th>线索状态</th><td>${esc(LEAD_STATUSES[lead.status] || lead.status)}</td><th>来源</th><td>${esc(LEAD_SOURCES[lead.source] || lead.source || "—")}</td></tr>
    <tr><th>来源代理</th><td colspan="3">${lead.ref ? `${esc(lead.ref)}${agent ? "（" + esc(agent.name) + " · " + esc(agent.region || "") + "）" : ""}` : "—（直营/无归因）"}</td></tr>
    <tr><th>创建时间</th><td>${esc((lead.created_at || "").slice(0, 10))}</td><th>最近更新</th><td>${esc((lead.updated_at || "").slice(0, 10))}</td></tr>
  </table></div>
  ${lead.eval_summary ? `<h3>评估摘要</h3><p>${esc(lead.eval_summary)}</p>` : ""}
  ${lead.note ? `<h3>备注</h3><p>${esc(lead.note)}</p>` : ""}
  <p><a class="btn ghost" href="/admin/leads?edit=${lead.id}">编辑线索</a></p></div>
  <div class="card"><h2>订单（${orders.length}，合计 ${fmtYuan(totalAmount)}）</h2><div class="wrap">
  <table><tr><th>ID</th><th>套餐</th><th>金额</th><th>付款阶段</th><th>付款状态</th><th>日期</th></tr>${ordersHtml}</table></div></div>
  <div class="card"><h2>交付进度</h2><div class="wrap">
  <table><tr><th>姓名</th><th>套餐</th><th>当前阶段</th><th>停留</th><th></th></tr>${studentsHtml}</table></div></div>`;
  return htmlResp(layout("用户档案", "/admin/leads", body));
}

// ===== 代理 =====
async function pageAgents(env, url) {
  const db = env.DB;
  const agents = (await db.prepare("SELECT * FROM agents ORDER BY code").all()).results || [];
  const rows = [];
  for (const a of agents) {
    const v = (await db.prepare("SELECT COALESCE(SUM(count),0) n FROM visits WHERE ref=?").bind(a.code).first())?.n || 0;
    const l = (await db.prepare("SELECT COUNT(*) n FROM leads WHERE ref=?").bind(a.code).first())?.n || 0;
    const o = (await db.prepare("SELECT COUNT(*) n FROM orders WHERE ref=?").bind(a.code).first())?.n || 0;
    const earned = (await db.prepare("SELECT COALESCE(SUM(commission),0) n FROM orders WHERE ref=?").bind(a.code).first())?.n || 0;
    const settled = (await db.prepare("SELECT COALESCE(SUM(commission),0) n FROM orders WHERE ref=? AND settle_status='settled'").bind(a.code).first())?.n || 0;
    const unsettled = earned - settled;
    rows.push(`<tr><td>${esc(a.code)}</td><td>${esc(a.name)}</td><td>${esc(a.region)}</td>
      <td>${esc(AGENT_KINDS[a.kind] || a.kind)}</td>
      <td>${a.active ? '<span class="ok">启用</span>' : '<span class="mut">停用</span>'}</td>
      <td>${v}</td><td>${l}</td><td>${o}</td>
      <td>${fmtYuan(earned)}</td><td>${fmtYuan(settled)}</td><td>${fmtYuan(unsettled)}</td>
      <td><a href="/admin/agents?edit=${esc(a.code)}">编辑</a></td></tr>`);
  }
  const editCode = url.searchParams.get("edit") || "";
  const edit = editCode ? agents.find((a) => a.code === editCode) : null;
  const f = edit || { code: "", name: "", region: "", kind: "agent", active: 1 };
  const body = `
  <div class="card"><h2>${edit ? "编辑代理 " + esc(edit.code) : "新增代理"}</h2>
  <form method="post">
    <input type="hidden" name="action" value="upsert">
    <div class="row">
      <div><label>代理码 *</label><input name="code" required maxlength="24" value="${esc(f.code)}" ${edit ? "readonly" : ""} placeholder="如 GD001"></div>
      <div><label>名称 *</label><input name="name" required maxlength="40" value="${esc(f.name)}"></div>
      <div><label>区域</label><input name="region" maxlength="40" value="${esc(f.region)}"></div>
    </div>
    <div class="row">
      <div><label>类型</label><select name="kind">${opts(AGENT_KINDS, f.kind)}</select></div>
      <div><label>状态</label><select name="active">
        <option value="1"${f.active ? " selected" : ""}>启用</option>
        <option value="0"${!f.active ? " selected" : ""}>停用</option></select></div>
    </div>
    <button type="submit">${edit ? "保存修改" : "添加代理"}</button>
    ${edit ? `<a class="btn ghost" href="/admin/agents">取消编辑</a>` : ""}
  </form></div>
  <div class="card"><h2>代理列表（含业绩）</h2><div class="wrap">
  <table><tr><th>代理码</th><th>名称</th><th>区域</th><th>类型</th><th>状态</th><th>访问</th><th>线索</th><th>订单</th><th>佣金总计</th><th>已结算</th><th>未结算</th><th></th></tr>
  ${rows.join("") || `<tr><td colspan="12" class="mut">暂无代理（可在 D1 控制台执行 schema.sql 导入种子数据）</td></tr>`}</table></div></div>`;
  return htmlResp(layout("代理", "/admin/agents", body));
}
async function postAgents(req, env) {
  const db = env.DB;
  const fd = await req.formData();
  if (String(fd.get("action") || "") !== "upsert") return redirect("/admin/agents");
  const code = clampStr(fd.get("code"), 24);
  const name = clampStr(fd.get("name"), 40);
  if (!validRef(code) || !name) return redirect("/admin/agents");
  const region = clampStr(fd.get("region"), 40);
  const kind = AGENT_KINDS[fd.get("kind")] ? String(fd.get("kind")) : "agent";
  const active = String(fd.get("active")) === "0" ? 0 : 1;
  await db.prepare(
    `INSERT INTO agents(code, name, region, kind, active, created_at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(code) DO UPDATE SET name=excluded.name, region=excluded.region, kind=excluded.kind, active=excluded.active`
  ).bind(code, name, region, kind, active, nowIso()).run();
  return redirect("/admin/agents");
}

// ===== 订单与结算 =====
async function pageOrders(env, url) {
  const db = env.DB;
  const settleMonth = (url.searchParams.get("settle") || monthStr()).trim();
  const orders = (await db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 300").all()).results || [];

  const rowHtml = orders.map((o) => `<tr>
    <td>${o.id}</td><td>${esc(o.customer)}</td><td>${esc(o.package)}</td><td>${fmtYuan(o.amount)}</td>
    <td>${esc(ORDER_STAGES[o.stage] || o.stage || "")}</td><td>${esc(o.ref || "")}</td>
    <td>${o.is_renewal ? "续费 " : "首单 "}${o.commission_rate}%</td><td>${fmtYuan(o.commission)}</td>
    <td>${esc(PAID_STATUSES[o.paid_status] || o.paid_status)}</td>
    <td>${esc(SETTLE_STATUSES[o.settle_status] || o.settle_status)}</td>
    <td class="mut">${esc((o.created_at || "").slice(0, 10))}</td>
    <td><a href="/admin/orders?edit=${o.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这笔订单？')">
      <input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${o.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");

  const editId = toInt(url.searchParams.get("edit"), 0);
  const edit = editId ? orders.find((o) => o.id === editId) : null;
  const f = edit || { lead_id: "", customer: "", package: "", amount: 0, stage: "full", ref: "", is_renewal: 0, commission_rate: "", paid_status: "unpaid", settle_status: "unsettled" };
  const amountYuan = edit ? (edit.amount / 100).toFixed(2) : "";

  // 月度结算视图：该月未结算佣金按代理分组
  const unset = (await db.prepare(
    `SELECT * FROM orders WHERE settle_status='unsettled' AND created_at LIKE ? ORDER BY ref, id`
  ).bind(settleMonth + "%").all()).results || [];
  const groups = new Map();
  for (const o of unset) {
    const k = o.ref || "（无来源码）";
    if (!groups.has(k)) groups.set(k, { total: 0, rows: [] });
    groups.get(k).total += o.commission || 0;
    groups.get(k).rows.push(o);
  }
  let grandTotal = 0;
  let settleHtml = "";
  for (const [ref, g] of groups) {
    grandTotal += g.total;
    const agentName = ref !== "（无来源码）"
      ? (await db.prepare("SELECT name FROM agents WHERE code=?").bind(ref).first())?.name || "" : "";
    settleHtml += `<h3>${esc(ref)} ${esc(agentName)} — 未结算合计 ${fmtYuan(g.total)}</h3>
    <div class="wrap"><table><tr><th>订单</th><th>客户</th><th>套餐</th><th>金额</th><th>佣金</th><th>日期</th><th></th></tr>
    ${g.rows.map((o) => `<tr><td>${o.id}</td><td>${esc(o.customer)}</td><td>${esc(o.package)}</td>
      <td>${fmtYuan(o.amount)}</td><td>${fmtYuan(o.commission)}</td><td class="mut">${esc((o.created_at || "").slice(0, 10))}</td>
      <td><form method="post" style="margin:0"><input type="hidden" name="action" value="settle">
      <input type="hidden" name="id" value="${o.id}"><input type="hidden" name="month" value="${esc(settleMonth)}">
      <button class="small" type="submit">标记已结算</button></form></td></tr>`).join("")}</table></div>`;
  }

  const body = `
  <div class="card"><h2>${edit ? "编辑订单 #" + edit.id : "新增订单"}</h2>
  <form method="post">
    <input type="hidden" name="action" value="${edit ? "update" : "add"}">
    ${edit ? `<input type="hidden" name="id" value="${edit.id}">` : ""}
    <div class="row">
      <div><label>客户姓名 *</label><input name="customer" required maxlength="40" value="${esc(f.customer)}"></div>
      <div><label>关联线索ID（可空）</label><input name="lead_id" type="number" value="${esc(f.lead_id ?? "")}"></div>
      <div><label>来源码（ref）</label><input name="ref" maxlength="24" value="${esc(f.ref || "")}" placeholder="如 GD001"></div>
    </div>
    <div class="row">
      <div><label>套餐</label><input name="package" list="pkgs" maxlength="60" value="${esc(f.package)}" placeholder="选择或输入">
        <datalist id="pkgs">${PACKAGES.map((p) => `<option value="${esc(p)}">`).join("")}</datalist></div>
      <div><label>金额（元）*</label><input name="amount_yuan" type="number" step="0.01" min="0" required value="${amountYuan}"></div>
      <div><label>付款阶段</label><select name="stage">${opts(ORDER_STAGES, f.stage)}</select></div>
    </div>
    <div class="row">
      <div><label>是否续费单</label><select name="is_renewal">
        <option value="0"${!f.is_renewal ? " selected" : ""}>首单（默认佣金 30%）</option>
        <option value="1"${f.is_renewal ? " selected" : ""}>续费（默认佣金 15%）</option></select></div>
      <div><label>佣金比例 %（留空用默认）</label><input name="commission_rate" type="number" min="0" max="100" value="${esc(f.commission_rate ?? "")}"></div>
      <div><label>付款状态</label><select name="paid_status">${opts(PAID_STATUSES, f.paid_status)}</select></div>
      <div><label>结算状态</label><select name="settle_status">${opts(SETTLE_STATUSES, f.settle_status)}</select></div>
    </div>
    <button type="submit">${edit ? "保存修改" : "添加订单"}</button>
    ${edit ? `<a class="btn ghost" href="/admin/orders">取消编辑</a>` : ""}
  </form></div>
  <div class="card"><h2>订单列表（${orders.length}）</h2><div class="wrap">
  <table><tr><th>ID</th><th>客户</th><th>套餐</th><th>金额</th><th>阶段</th><th>ref</th><th>佣金比例</th><th>佣金</th><th>付款</th><th>结算</th><th>日期</th><th></th><th></th></tr>
  ${rowHtml || `<tr><td colspan="13" class="mut">暂无订单</td></tr>`}</table></div></div>
  <div class="card"><h2>月度结算（${esc(settleMonth)}）</h2>
  <p>${monthInput(settleMonth)}</p>
  ${settleHtml || `<p class="mut">该月没有未结算的佣金。</p>`}
  ${grandTotal ? `<p><strong>该月未结算佣金合计：${fmtYuan(grandTotal)}</strong></p>` : ""}
  </div>`;
  return htmlResp(layout("订单", "/admin/orders", body));
}
async function postOrders(req, env) {
  const db = env.DB;
  const fd = await req.formData();
  const action = String(fd.get("action") || "");
  if (action === "delete") {
    await db.prepare("DELETE FROM orders WHERE id=?").bind(toInt(fd.get("id"), 0)).run();
    return redirect("/admin/orders");
  }
  if (action === "settle") {
    await db.prepare("UPDATE orders SET settle_status='settled' WHERE id=?").bind(toInt(fd.get("id"), 0)).run();
    const m = clampStr(fd.get("month"), 7);
    return redirect("/admin/orders?settle=" + encodeURIComponent(m || monthStr()));
  }
  const customer = clampStr(fd.get("customer"), 40);
  if (!customer) return redirect("/admin/orders");
  const pkg = clampStr(fd.get("package"), 60);
  const amount = Math.round((parseFloat(fd.get("amount_yuan")) || 0) * 100);
  const stage = ORDER_STAGES[fd.get("stage")] ? String(fd.get("stage")) : "full";
  const refRaw = clampStr(fd.get("ref"), 24);
  const ref = validRef(refRaw) ? refRaw : null;
  const is_renewal = String(fd.get("is_renewal")) === "1" ? 1 : 0;
  const rateRaw = String(fd.get("commission_rate") ?? "").trim();
  let rate = rateRaw === "" ? (is_renewal ? 15 : 30) : toInt(rateRaw, is_renewal ? 15 : 30);
  rate = Math.min(100, Math.max(0, rate));
  const commission = calcCommission(amount, rate);
  const paid_status = PAID_STATUSES[fd.get("paid_status")] ? String(fd.get("paid_status")) : "unpaid";
  const settle_status = SETTLE_STATUSES[fd.get("settle_status")] ? String(fd.get("settle_status")) : "unsettled";
  const leadIdRaw = String(fd.get("lead_id") ?? "").trim();
  const lead_id = leadIdRaw === "" ? null : toInt(leadIdRaw, 0);
  if (action === "update") {
    await db.prepare(
      `UPDATE orders SET lead_id=?, customer=?, package=?, amount=?, stage=?, ref=?, is_renewal=?, commission_rate=?, commission=?, paid_status=?, settle_status=? WHERE id=?`
    ).bind(lead_id, customer, pkg, amount, stage, ref, is_renewal, rate, commission, paid_status, settle_status, toInt(fd.get("id"), 0)).run();
  } else {
    await db.prepare(
      `INSERT INTO orders(lead_id, customer, package, amount, stage, ref, is_renewal, commission_rate, commission, paid_status, settle_status, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(lead_id, customer, pkg, amount, stage, ref, is_renewal, rate, commission, paid_status, settle_status, nowIso()).run();
  }
  return redirect("/admin/orders");
}

// ===== 内容管理（FAQ + 公告）=====
async function contentFaqBody(env, url) {
  const db = env.DB;
  const faqs = (await db.prepare("SELECT * FROM faqs ORDER BY lang, sort, id").all()).results || [];
  const announcement = (await db.prepare("SELECT value FROM settings WHERE key='announcement'").first())?.value || "";
  const editId = toInt(url.searchParams.get("edit"), 0);
  const edit = editId ? faqs.find((f) => f.id === editId) : null;
  const f = edit || { lang: "zh-CN", q: "", a: "", sort: 0, active: 1 };
  const rowHtml = faqs.map((x) => `<tr>
    <td>${x.id}</td><td>${esc(x.lang)}</td><td>${esc(x.q)}</td>
    <td>${esc((x.a || "").slice(0, 60))}${(x.a || "").length > 60 ? "…" : ""}</td>
    <td>${x.sort}</td><td>${x.active ? '<span class="ok">显示</span>' : '<span class="mut">隐藏</span>'}</td>
    <td><a href="/admin/content?edit=${x.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条问答？')">
      <input type="hidden" name="action" value="faq_delete"><input type="hidden" name="id" value="${x.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const body = `
  <div class="card"><h2>公告（显示在后台首页）</h2>
  <form method="post"><input type="hidden" name="action" value="announce">
  <textarea name="announcement" maxlength="1000" placeholder="留空则不显示">${esc(announcement)}</textarea>
  <button type="submit">保存公告</button></form></div>
  <div class="card"><h2>${edit ? "编辑问答 #" + edit.id : "新增问答"}</h2>
  <form method="post">
    <input type="hidden" name="action" value="${edit ? "faq_update" : "faq_add"}">
    ${edit ? `<input type="hidden" name="id" value="${edit.id}">` : ""}
    <div class="row">
      <div><label>语言</label><select name="lang">
        <option value="zh-CN"${f.lang === "zh-CN" ? " selected" : ""}>简体中文</option>
        <option value="zh-TW"${f.lang === "zh-TW" ? " selected" : ""}>繁体中文</option>
        <option value="en"${f.lang === "en" ? " selected" : ""}>English</option></select></div>
      <div><label>排序（小的在前）</label><input name="sort" type="number" value="${f.sort}"></div>
      <div><label>是否显示</label><select name="active">
        <option value="1"${f.active ? " selected" : ""}>显示</option>
        <option value="0"${!f.active ? " selected" : ""}>隐藏</option></select></div>
    </div>
    <label>问题 *</label><input name="q" required maxlength="200" value="${esc(f.q)}">
    <label>回答 *</label><textarea name="a" required maxlength="4000">${esc(f.a)}</textarea>
    <button type="submit">${edit ? "保存修改" : "添加问答"}</button>
    ${edit ? `<a class="btn ghost" href="/admin/content">取消编辑</a>` : ""}
  </form></div>
  <div class="card"><h2>问答列表（${faqs.length}）</h2><div class="wrap">
  <table><tr><th>ID</th><th>语言</th><th>问题</th><th>回答（节选）</th><th>排序</th><th>状态</th><th></th><th></th></tr>
  ${rowHtml || `<tr><td colspan="8" class="mut">暂无问答</td></tr>`}</table></div></div>`;
  return body;
}
function contentSubtabs(tab) {
  return `<div class="subtabs">
    <a href="/admin/content" class="${tab === "faq" ? "on" : ""}">问答库</a>
    <a href="/admin/content?tab=content" class="${tab === "content" ? "on" : ""}">内容评估</a>
  </div>`;
}
async function contentEvalBody(env, url) {
  const db = env.DB;
  const items = (await db.prepare("SELECT * FROM content_items ORDER BY pub_date DESC, id DESC").all()).results || [];
  const metrics = (await db.prepare("SELECT * FROM content_metrics").all()).results || [];
  const agg = aggregateMetrics(metrics);
  const totals = { views: 0, consults: 0, leads: 0 };
  for (const k of Object.keys(agg)) {
    totals.views += agg[k].views; totals.consults += agg[k].consults; totals.leads += agg[k].leads;
  }
  // 归因线索数：按内容 ref 关联 leads.ref 计数（与 visits 的 ref 归因口径一致）
  const leadRefRows = (await db.prepare(
    "SELECT ref, COUNT(*) c FROM leads WHERE ref IS NOT NULL AND ref != '' GROUP BY ref").all()).results || [];
  const leadsByRef = {};
  for (const r of leadRefRows) leadsByRef[r.ref] = r.c;
  const totalRefLeads = items.reduce((a, i) => a + (i.ref ? (leadsByRef[i.ref] || 0) : 0), 0);
  // 状态筛选（仅影响列表展示，编辑/指标录入仍用全量 items）
  const fStatus = CONTENT_STATUSES[url.searchParams.get("status")] ? String(url.searchParams.get("status")) : "";
  const displayItems = fStatus ? items.filter((i) => (i.status || "published") === fStatus) : items;
  const editId = toInt(url.searchParams.get("edit_item"), 0);
  const edit = editId ? items.find((i) => i.id === editId) : null;
  const f = edit || { title: "", platform: "", pub_date: todayStr(), ref: "", type: "video", status: "published" };
  const itemRows = displayItems.map((i) => {
    const a = agg[i.id] || { views: 0, consults: 0, leads: 0 };
    const refLeads = i.ref ? (leadsByRef[i.ref] || 0) : 0;
    return `<tr><td>${esc(i.title)}</td><td>${esc(i.platform)}</td><td>${esc(i.pub_date || "")}</td>
    <td>${esc(i.ref || "")}</td><td>${esc(CONTENT_TYPES[i.type] || i.type || "")}</td>
    <td><span class="pill">${esc(CONTENT_STATUSES[i.status] || "已发布")}</span></td>
    <td>${a.views}</td><td>${a.consults}</td><td>${a.leads}</td><td>${refLeads}</td><td>${convRate(a.leads, a.views)}%</td>
    <td><a href="/admin/content?tab=content&edit_item=${i.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('删除该内容条目及其全部指标？')">
      <input type="hidden" name="action" value="item_delete"><input type="hidden" name="id" value="${i.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`;
  }).join("");
  const recent = (await db.prepare(
    `SELECT m.*, i.title FROM content_metrics m LEFT JOIN content_items i ON i.id = m.item_id
     ORDER BY m.id DESC LIMIT 50`).all()).results || [];
  const recentHtml = recent.map((m) => `<tr>
    <td>${esc(m.title || ("#" + m.item_id))}</td><td>${esc(m.day || "")}</td>
    <td>${m.views}</td><td>${m.consults}</td><td>${m.leads}</td>
    <td><form method="post" style="margin:0"><input type="hidden" name="action" value="metric_delete">
    <input type="hidden" name="id" value="${m.id}">
    <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const itemOpts = items.map((i) =>
    `<option value="${i.id}">${esc(i.title)}</option>`).join("");
  return `
  <div class="card"><h2>${edit ? "编辑内容条目 #" + edit.id : "新增内容条目"}</h2>
  <form method="post">
    <input type="hidden" name="action" value="${edit ? "item_update" : "item_add"}">
    ${edit ? `<input type="hidden" name="id" value="${edit.id}">` : ""}
    <div class="row">
      <div><label>标题 *</label><input name="title" required maxlength="120" value="${esc(f.title)}"></div>
      <div><label>平台</label><input name="platform" maxlength="40" value="${esc(f.platform)}" placeholder="如 视频号 / 小红书 / 抖音"></div>
    </div>
    <div class="row">
      <div><label>发布日期</label><input name="pub_date" type="date" value="${esc(f.pub_date || "")}"></div>
      <div><label>归因码（ref）</label><input name="ref" maxlength="24" value="${esc(f.ref || "")}" placeholder="如 VDY01"></div>
      <div><label>类型</label><select name="type">${opts(CONTENT_TYPES, f.type)}</select></div>
      <div><label>状态</label><select name="status">${opts(CONTENT_STATUSES, f.status || "published")}</select></div>
    </div>
    <button type="submit">${edit ? "保存修改" : "添加条目"}</button>
    ${edit ? `<a class="btn ghost" href="/admin/content?tab=content">取消编辑</a>` : ""}
  </form></div>
  <div class="card"><h2>内容条目（${displayItems.length}${fStatus ? " / 全部 " + items.length : ""}）与累计指标</h2>
  <form method="get"><input type="hidden" name="tab" value="content"><div class="row">
    <div><label>按状态筛选</label><select name="status">
      <option value="">全部状态</option>${opts(CONTENT_STATUSES, fStatus)}</select></div>
    <div style="align-self:end"><button type="submit">筛选</button></div>
  </div></form>
  <div class="wrap">
  <table><tr><th>标题</th><th>平台</th><th>发布日期</th><th>ref</th><th>类型</th><th>状态</th><th>播放/阅读</th><th>咨询</th><th>线索</th><th>归因线索</th><th>线索转化率</th><th></th><th></th></tr>
  ${itemRows || `<tr><td colspan="13" class="mut">暂无内容条目</td></tr>`}
  ${items.length ? `<tr><th colspan="6">合计（全部条目）</th><th>${totals.views}</th><th>${totals.consults}</th><th>${totals.leads}</th><th>${totalRefLeads}</th><th>${convRate(totals.leads, totals.views)}%</th><th></th><th></th></tr>` : ""}
  </table></div>
  <p class="mut">线索转化率 = 累计线索 ÷ 累计播放/阅读；「归因线索」按条目 ref 关联实际线索数，与指标里的线索（手动/接口录入）口径不同。指标可手动录入（下方表单），也可由内容 bot 经接口批量写回，按天记一条。</p></div>
  <div class="card"><h2>录入指标</h2>
  ${items.length ? `<form method="post">
    <input type="hidden" name="action" value="metric_add">
    <div class="row">
      <div><label>内容条目</label><select name="item_id">${itemOpts}</select></div>
      <div><label>日期</label><input name="day" type="date" value="${todayStr()}"></div>
      <div><label>播放/阅读量</label><input name="views" type="number" min="0" value="0"></div>
      <div><label>咨询数</label><input name="consults" type="number" min="0" value="0"></div>
      <div><label>线索数</label><input name="leads" type="number" min="0" value="0"></div>
    </div>
    <button type="submit">录入</button></form>` : `<p class="mut">先新增内容条目，再录入指标。</p>`}
  </div>
  <div class="card"><h2>最近指标记录</h2><div class="wrap">
  <table><tr><th>条目</th><th>日期</th><th>播放/阅读</th><th>咨询</th><th>线索</th><th></th></tr>
  ${recentHtml || `<tr><td colspan="6" class="mut">暂无指标记录</td></tr>`}</table></div></div>`;
}
async function pageContent(env, url) {
  const tab = url.searchParams.get("tab") === "content" ? "content" : "faq";
  const inner = tab === "content" ? await contentEvalBody(env, url) : await contentFaqBody(env, url);
  return htmlResp(layout("内容", "/admin/content", contentSubtabs(tab) + inner));
}
async function postContent(req, env) {
  const db = env.DB;
  const fd = await req.formData();
  const action = String(fd.get("action") || "");
  const backContent = "/admin/content?tab=content";
  if (action === "item_delete") {
    const id = toInt(fd.get("id"), 0);
    await db.prepare("DELETE FROM content_metrics WHERE item_id=?").bind(id).run();
    await db.prepare("DELETE FROM content_items WHERE id=?").bind(id).run();
    return redirect(backContent);
  }
  if (action === "metric_delete") {
    await db.prepare("DELETE FROM content_metrics WHERE id=?").bind(toInt(fd.get("id"), 0)).run();
    return redirect(backContent);
  }
  if (action === "metric_add") {
    const itemId = toInt(fd.get("item_id"), 0);
    if (!itemId) return redirect(backContent);
    const day = clampStr(fd.get("day"), 10) || todayStr();
    await db.prepare("INSERT INTO content_metrics(item_id, day, views, consults, leads) VALUES(?,?,?,?,?)")
      .bind(itemId, day, toInt(fd.get("views"), 0), toInt(fd.get("consults"), 0), toInt(fd.get("leads"), 0)).run();
    return redirect(backContent);
  }
  if (action === "item_add" || action === "item_update") {
    const title = clampStr(fd.get("title"), 120);
    if (!title) return redirect(backContent);
    const platform = clampStr(fd.get("platform"), 40);
    const pubDate = clampStr(fd.get("pub_date"), 10);
    const refRaw = clampStr(fd.get("ref"), 24);
    const ref = validRef(refRaw) ? refRaw : null;
    const type = CONTENT_TYPES[fd.get("type")] ? String(fd.get("type")) : "video";
    const status = CONTENT_STATUSES[fd.get("status")] ? String(fd.get("status")) : "published";
    if (action === "item_update") {
      await db.prepare("UPDATE content_items SET title=?, platform=?, pub_date=?, ref=?, type=?, status=? WHERE id=?")
        .bind(title, platform, pubDate, ref, type, status, toInt(fd.get("id"), 0)).run();
    } else {
      await db.prepare("INSERT INTO content_items(title, platform, pub_date, ref, type, status, created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(title, platform, pubDate, ref, type, status, nowIso()).run();
    }
    return redirect(backContent);
  }
  if (action === "announce") {
    const v = clampStr(fd.get("announcement"), 1000);
    await db.prepare(
      `INSERT INTO settings(key, value) VALUES('announcement', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(v).run();
    return redirect("/admin/content");
  }
  if (action === "faq_delete") {
    await db.prepare("DELETE FROM faqs WHERE id=?").bind(toInt(fd.get("id"), 0)).run();
    return redirect("/admin/content");
  }
  const q = clampStr(fd.get("q"), 200);
  const a = clampStr(fd.get("a"), 4000);
  if (!q || !a) return redirect("/admin/content");
  const lang = ["zh-CN", "zh-TW", "en"].includes(String(fd.get("lang"))) ? String(fd.get("lang")) : "zh-CN";
  const sort = toInt(fd.get("sort"), 0);
  const active = String(fd.get("active")) === "0" ? 0 : 1;
  if (action === "faq_update") {
    await db.prepare("UPDATE faqs SET lang=?, q=?, a=?, sort=?, active=? WHERE id=?")
      .bind(lang, q, a, sort, active, toInt(fd.get("id"), 0)).run();
  } else {
    await db.prepare("INSERT INTO faqs(lang, q, a, sort, active) VALUES(?,?,?,?,?)")
      .bind(lang, q, a, sort, active).run();
  }
  return redirect("/admin/content");
}

// ===== 内部任务 =====
async function pageTasks(env, url) {
  const db = env.DB;
  const today = todayStr();
  const fType = TASK_TYPES[url.searchParams.get("type")] ? String(url.searchParams.get("type")) : "";
  const ownerStaff = (await db.prepare(
    "SELECT name, emp_no, kind, platform FROM staff WHERE status IN ('active','probation') ORDER BY kind DESC, id ASC LIMIT 300").all()).results || [];
  const ownerListHtml = ownerStaff.map((s) =>
    `<option value="${esc(s.name)}">${esc(s.emp_no || "")} ${esc(STAFF_KINDS[s.kind] || "真人")}${s.platform ? " · " + esc(s.platform) : ""}</option>`).join("");
  const rows = (await db.prepare(
    `SELECT * FROM tasks${fType ? " WHERE type = ?" : ""} ORDER BY (status='done') ASC,
     CASE WHEN due IS NULL OR due='' THEN 1 ELSE 0 END, due ASC, id DESC LIMIT 300`)
    .bind(...(fType ? [fType] : [])).all()).results || [];
  const editId = toInt(url.searchParams.get("edit"), 0);
  const edit = editId ? await db.prepare("SELECT * FROM tasks WHERE id=?").bind(editId).first() : null;
  const f = edit || { title: "", type: "task", owner: "", due: "", status: "todo", note: "" };
  const rowHtml = rows.map((t) => {
    const st = taskDueState(t.due, t.status, today);
    const badge = t.status === "done" ? '<span class="mut">已完成</span>'
      : st === "overdue" ? '<span class="bad">已逾期</span>'
      : st === "today" ? '<span class="warn">今天到期</span>'
      : esc(TASK_STATUSES[t.status] || t.status);
    return `<tr>
    <td>${t.id}</td><td>${esc(t.title)}${t.type === "proposal" ? ' <span class="pill">提案</span>' : ""}</td><td>${esc(t.owner || "")}</td>
    <td>${esc(t.due || "—")}</td><td>${badge}</td><td>${esc((t.note || "").slice(0, 40))}</td>
    <td><a href="/admin/tasks?edit=${t.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条任务？')">
      <input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${t.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`;
  }).join("");
  const body = `
  <div class="card"><h2>类型筛选</h2>
  <form method="get"><div class="row">
    <div><label>类型</label><select name="type">
      <option value=""${!fType ? " selected" : ""}>全部</option>${opts(TASK_TYPES, fType)}</select></div>
    <div style="align-self:end"><button type="submit">筛选</button></div>
  </div></form></div>
  <div class="card"><h2>${edit ? "编辑任务 #" + edit.id : "新增任务"}</h2>
  <form method="post">
    <input type="hidden" name="action" value="${edit ? "update" : "add"}">
    ${edit ? `<input type="hidden" name="id" value="${edit.id}">` : ""}
    <label>任务标题 *</label><input name="title" required maxlength="120" value="${esc(f.title)}">
    <div class="row">
      <div><label>类型</label><select name="type">${opts(TASK_TYPES, f.type || "task")}</select></div>
      <div><label>负责人</label><input name="owner" maxlength="40" list="staff-owners" value="${esc(f.owner || "")}" placeholder="可从在职员工中选，也可手填">
      <datalist id="staff-owners">${ownerListHtml}</datalist></div>
      <div><label>截止日期</label><input name="due" type="date" value="${esc(f.due || "")}"></div>
      <div><label>状态</label><select name="status">${opts(TASK_STATUSES, f.status)}</select></div>
    </div>
    <label>备注</label><textarea name="note" maxlength="2000">${esc(f.note)}</textarea>
    <button type="submit">${edit ? "保存修改" : "添加任务"}</button>
    ${edit ? `<a class="btn ghost" href="/admin/tasks">取消编辑</a>` : ""}
  </form></div>
  <div class="card"><h2>${fType ? TASK_TYPES[fType] + "列表" : "任务列表"}（${rows.length}）</h2><div class="wrap">
  <table><tr><th>ID</th><th>任务</th><th>负责人</th><th>截止</th><th>状态</th><th>备注</th><th></th><th></th></tr>
  ${rowHtml || `<tr><td colspan="8" class="mut">暂无${fType ? TASK_TYPES[fType] : "任务"}</td></tr>`}</table></div></div>`;
  return htmlResp(layout("任务", "/admin/tasks", body));
}
async function postTasks(req, env) {
  const db = env.DB;
  const fd = await req.formData();
  const action = String(fd.get("action") || "");
  if (action === "delete") {
    await db.prepare("DELETE FROM tasks WHERE id=?").bind(toInt(fd.get("id"), 0)).run();
    return redirect("/admin/tasks");
  }
  const title = clampStr(fd.get("title"), 120);
  if (!title) return redirect("/admin/tasks");
  const type = TASK_TYPES[fd.get("type")] ? String(fd.get("type")) : "task";
  const owner = clampStr(fd.get("owner"), 40);
  const due = clampStr(fd.get("due"), 10);
  const status = TASK_STATUSES[fd.get("status")] ? String(fd.get("status")) : "todo";
  const note = clampStr(fd.get("note"), 2000);
  if (action === "update") {
    await db.prepare("UPDATE tasks SET title=?, type=?, owner=?, due=?, status=?, note=?, updated_at=? WHERE id=?")
      .bind(title, type, owner, due, status, note, nowIso(), toInt(fd.get("id"), 0)).run();
  } else {
    await db.prepare("INSERT INTO tasks(title, type, owner, due, status, note, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(title, type, owner, due, status, note, nowIso(), nowIso()).run();
  }
  return redirect("/admin/tasks");
}

// ===== 人员（v3：真人 + AI 员工统一管理）=====
async function nextEmpNo(db, kind, jobFunction) {
  const prefix = kind === "ai" ? "BOT-" + functionCodeFor(jobFunction) + "-" : "EMP-";
  const rows = (await db.prepare("SELECT emp_no FROM staff WHERE emp_no LIKE ?").bind(prefix + "%").all()).results || [];
  let max = 0;
  for (const r of rows) {
    const m = String((r && r.emp_no) || "").slice(prefix.length).match(/^(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return prefix + String(max + 1).padStart(3, "0");
}
function staffStatusHtml(s) {
  if (s === "active") return '<span class="ok">在职</span>';
  if (s === "probation") return '<span class="warn">试用</span>';
  if (s === "suspended") return '<span class="bad">停用待查</span>';
  return '<span class="mut">' + esc(STAFF_STATUSES[s] || s || "—") + "</span>";
}
async function pageStaff(env, url) {
  const db = env.DB;
  const sp = url.searchParams;
  const fKind = STAFF_KINDS[sp.get("kind")] ? sp.get("kind") : "";
  const fStatus = STAFF_STATUSES[sp.get("status")] ? sp.get("status") : "";
  const fPlatform = clampStr(sp.get("platform") || "", 40);
  const fq = clampStr(sp.get("q") || "", 40);
  const where = [], binds = [];
  if (fKind) { where.push("kind = ?"); binds.push(fKind); }
  if (fStatus) { where.push("status = ?"); binds.push(fStatus); }
  if (fPlatform) { where.push("platform = ?"); binds.push(fPlatform); }
  if (fq) { where.push("(name LIKE ? OR emp_no LIKE ?)"); binds.push("%" + fq + "%", "%" + fq + "%"); }
  const rows = (await db.prepare(
    "SELECT * FROM staff" + (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY (status IN ('offboarded','left')) ASC, id DESC LIMIT 300").bind(...binds).all()).results || [];
  const platforms = ((await db.prepare(
    "SELECT DISTINCT platform FROM staff WHERE platform IS NOT NULL AND platform != '' ORDER BY platform").all()).results || [])
    .map((r) => r.platform);
  const editId = toInt(sp.get("edit"), 0);
  const edit = editId ? await db.prepare("SELECT * FROM staff WHERE id=?").bind(editId).first() : null;
  const f = edit || { name: "", kind: "human", emp_no: "", platform: "", job_function: "", persona: "", accountable: "", role: "", contact: "", start_date: "", status: "active", note: "" };
  // 考核区（选中某员工时展开）
  const reviewsId = toInt(sp.get("reviews"), 0);
  const rStaff = reviewsId ? await db.prepare("SELECT * FROM staff WHERE id=?").bind(reviewsId).first() : null;
  const rerr = clampStr(sp.get("rerr") || "", 200);
  let reviewsHtml = "";
  if (rStaff) {
    const revs = (await db.prepare(
      "SELECT * FROM staff_reviews WHERE staff_id=? ORDER BY review_date DESC, id DESC LIMIT 200").bind(rStaff.id).all()).results || [];
    const revRows = revs.map((r) => `<tr>
      <td>${esc(r.review_date || "—")}</td><td>${esc(REVIEW_TYPES[r.review_type] || r.review_type)}</td>
      <td>${esc(r.examiner || "")}${r.examiner_platform ? "（" + esc(r.examiner_platform) + "）" : ""}</td>
      <td>${r.score === null || r.score === undefined ? "—" : r.score}</td>
      <td>${r.verdict === "pass" ? '<span class="ok">通过</span>' : r.verdict === "fail" ? '<span class="bad">不通过</span>' : '<span class="warn">观察</span>'}</td>
      <td>${esc((r.comment || "").slice(0, 60))}</td>
      <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条考核记录？')">
        <input type="hidden" name="action" value="delete_review"><input type="hidden" name="id" value="${r.id}">
        <input type="hidden" name="staff_id" value="${rStaff.id}">
        <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
    reviewsHtml = `
  <div class="card"><h2>考核记录 · ${esc(rStaff.name)}（${esc(rStaff.emp_no || "无工号")} · ${esc(STAFF_KINDS[rStaff.kind] || "真人")}${rStaff.platform ? " · " + esc(rStaff.platform) : ""}）</h2>
  ${rerr ? `<p class="bad">${esc(rerr)}</p>` : ""}
  <form method="post">
    <input type="hidden" name="action" value="add_review">
    <input type="hidden" name="staff_id" value="${rStaff.id}">
    <div class="row">
      <div><label>类型</label><select name="review_type">${opts(REVIEW_TYPES, "regular")}</select></div>
      <div><label>日期</label><input name="review_date" type="date" value="${todayStr()}"></div>
      <div><label>评分人</label><input name="examiner" maxlength="40" placeholder="姓名或 bot 名"></div>
      <div><label>主考体系${rStaff.kind === "ai" ? "（入职测评必填，不得与员工所属体系相同）" : ""}</label><input name="examiner_platform" maxlength="40" placeholder="如 Claude / Manus / Grok"></div>
    </div>
    <div class="row">
      <div><label>分数（可空）</label><input name="score" type="number" step="0.1" min="0" max="100"></div>
      <div><label>结论</label><select name="verdict">${opts(REVIEW_VERDICTS, "observe")}</select></div>
    </div>
    <label>评语</label><textarea name="comment" maxlength="2000"></textarea>
    <button type="submit">添加考核记录</button>
    <a class="btn ghost" href="/admin/staff">收起</a>
  </form>
  <div class="wrap"><table><tr><th>日期</th><th>类型</th><th>评分人（主考体系）</th><th>分数</th><th>结论</th><th>评语</th><th></th></tr>
  ${revRows || `<tr><td colspan="7" class="mut">暂无考核记录</td></tr>`}</table></div></div>`;
  }
  const rowHtml = rows.map((s) => `<tr>
    <td>${esc(s.emp_no || "—")}</td>
    <td>${esc(s.name)} ${s.kind === "ai" ? '<span class="warn">AI</span>' : '<span class="mut">真人</span>'}</td>
    <td>${esc(s.platform || "—")}</td>
    <td>${esc(s.job_function || s.role || "")}</td>
    <td>${s.kind === "ai" && s.accountable ? esc(s.accountable) : "—"}</td>
    <td>${esc(s.contact || "")}</td>
    <td>${esc(s.start_date || "—")}</td>
    <td>${staffStatusHtml(s.status)}</td>
    <td>${esc((s.note || "").slice(0, 40))}</td>
    <td><a href="/admin/staff?reviews=${s.id}">考核</a></td>
    <td><a href="/admin/staff?edit=${s.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条人员档案？（考核记录不会自动删除）')">
      <input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${s.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const body = `
  ${reviewsHtml}
  <div class="card"><h2>${edit ? "编辑人员 #" + edit.id : "新增人员"}</h2>
  <form method="post">
    <input type="hidden" name="action" value="${edit ? "update" : "add"}">
    ${edit ? `<input type="hidden" name="id" value="${edit.id}">` : ""}
    <div class="row">
      <div><label>姓名 *</label><input name="name" required maxlength="40" value="${esc(f.name)}"></div>
      <div><label>类型</label><select name="kind" onchange="document.getElementById('ai-staff-fields').style.display=this.value==='ai'?'flex':'none'">${opts(STAFF_KINDS, f.kind || "human")}</select></div>
      <div><label>工号（留空自动生成）</label><input name="emp_no" maxlength="24" value="${esc(f.emp_no || "")}" placeholder="AI: BOT-CS-001 · 真人: EMP-001"></div>
    </div>
    <div class="row">
      <div><label>所属体系（AI 员工填，如 Claude / Manus / Grok / 自研；真人可空）</label><input name="platform" maxlength="40" value="${esc(f.platform || "")}"></div>
      <div><label>职能</label><input name="job_function" maxlength="40" value="${esc(f.job_function || "")}" placeholder="如 客服 / 内容 / 线索管家"></div>
      <div><label>角色</label><input name="role" maxlength="40" value="${esc(f.role || "")}" placeholder="如 运营 / 客服 / 交付"></div>
    </div>
    <div class="row" id="ai-staff-fields" style="display:${f.kind === "ai" ? "flex" : "none"}">
      <div><label>责任人（AI 员工）</label><input name="accountable" maxlength="40" value="${esc(f.accountable || "")}" placeholder="对外出错时出面担责的真人姓名"></div>
      <div style="flex:2"><label>对外人设（名字 / 口吻）</label><textarea name="persona" maxlength="1000" style="min-height:48px" placeholder="如 小转；亲切耐心，先给结论，不承诺录取">${esc(f.persona || "")}</textarea></div>
    </div>
    <div class="row">
      <div><label>联系方式</label><input name="contact" maxlength="80" value="${esc(f.contact || "")}"></div>
      <div><label>入职日期</label><input name="start_date" type="date" value="${esc(f.start_date || "")}"></div>
      <div><label>状态</label><select name="status">${opts(STAFF_STATUSES, f.status)}</select></div>
    </div>
    <label>备注</label><textarea name="note" maxlength="2000">${esc(f.note)}</textarea>
    <button type="submit">${edit ? "保存修改" : "添加人员"}</button>
    ${edit ? `<a class="btn ghost" href="/admin/staff">取消编辑</a>` : ""}
  </form></div>
  <div class="card"><h2>人员档案（${rows.length}）</h2>
  <form method="get" class="row">
    <div><label>类型</label><select name="kind"><option value="">全部</option>${opts(STAFF_KINDS, fKind)}</select></div>
    <div><label>状态</label><select name="status"><option value="">全部</option>${opts(STAFF_STATUSES, fStatus)}</select></div>
    <div><label>体系</label><select name="platform"><option value="">全部</option>${platforms.map((p) => `<option value="${esc(p)}"${p === fPlatform ? " selected" : ""}>${esc(p)}</option>`).join("")}</select></div>
    <div><label>搜索姓名 / 工号</label><input name="q" value="${esc(fq)}" maxlength="40"></div>
    <div><label>&nbsp;</label><button type="submit">筛选</button></div>
  </form>
  <div class="wrap">
  <table><tr><th>工号</th><th>姓名</th><th>体系</th><th>职能</th><th>责任人</th><th>联系方式</th><th>入职日期</th><th>状态</th><th>备注</th><th></th><th></th><th></th></tr>
  ${rowHtml || `<tr><td colspan="12" class="mut">暂无人员档案</td></tr>`}</table></div></div>`;
  return htmlResp(layout("人员", "/admin/staff", body));
}
async function postStaff(req, env) {
  const db = env.DB;
  const fd = await req.formData();
  const action = String(fd.get("action") || "");
  if (action === "delete") {
    await db.prepare("DELETE FROM staff WHERE id=?").bind(toInt(fd.get("id"), 0)).run();
    return redirect("/admin/staff");
  }
  if (action === "delete_review") {
    await db.prepare("DELETE FROM staff_reviews WHERE id=?").bind(toInt(fd.get("id"), 0)).run();
    return redirect("/admin/staff?reviews=" + toInt(fd.get("staff_id"), 0));
  }
  if (action === "add_review") {
    const staffId = toInt(fd.get("staff_id"), 0);
    const staff = staffId ? await db.prepare("SELECT * FROM staff WHERE id=?").bind(staffId).first() : null;
    if (!staff) return redirect("/admin/staff");
    const reviewType = REVIEW_TYPES[fd.get("review_type")] ? String(fd.get("review_type")) : "regular";
    const examiner = clampStr(fd.get("examiner"), 40);
    const examinerPlatform = clampStr(fd.get("examiner_platform"), 40);
    if (reviewType === "exam" && staff.kind === "ai") {
      if (!examinerPlatform) {
        return redirect("/admin/staff?reviews=" + staffId + "&rerr=" +
          encodeURIComponent("AI 员工入职测评必须填写主考体系"));
      }
      if (examinerPlatform === String(staff.platform || "").trim()) {
        return redirect("/admin/staff?reviews=" + staffId + "&rerr=" +
          encodeURIComponent("主考体系与员工所属体系相同，违反回避规则"));
      }
    }
    const scoreRaw = String(fd.get("score") || "").trim();
    const scoreNum = scoreRaw === "" ? null : Number(scoreRaw);
    const verdict = REVIEW_VERDICTS[fd.get("verdict")] ? String(fd.get("verdict")) : "observe";
    const reviewDate = clampStr(fd.get("review_date"), 10) || todayStr();
    const comment = clampStr(fd.get("comment"), 2000);
    await db.prepare(
      "INSERT INTO staff_reviews(staff_id, review_type, review_date, examiner, examiner_platform, score, verdict, comment, created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(staffId, reviewType, reviewDate, examiner, examinerPlatform || null,
        scoreNum === null || Number.isNaN(scoreNum) ? null : scoreNum, verdict, comment, nowIso()).run();
    return redirect("/admin/staff?reviews=" + staffId);
  }
  const name = clampStr(fd.get("name"), 40);
  if (!name) return redirect("/admin/staff");
  const kind = STAFF_KINDS[fd.get("kind")] ? String(fd.get("kind")) : "human";
  let empNo = clampStr(fd.get("emp_no"), 24);
  const platform = clampStr(fd.get("platform"), 40) || null;
  const jobFunction = clampStr(fd.get("job_function"), 40);
  const role = clampStr(fd.get("role"), 40);
  const contact = clampStr(fd.get("contact"), 80);
  const startDate = clampStr(fd.get("start_date"), 10);
  const status = STAFF_STATUSES[fd.get("status")] ? String(fd.get("status")) : "active";
  const note = clampStr(fd.get("note"), 2000);
  const persona = kind === "ai" ? clampStr(fd.get("persona"), 1000) || null : null;
  const accountable = kind === "ai" ? clampStr(fd.get("accountable"), 40) || null : null;
  if (action === "update") {
    const id = toInt(fd.get("id"), 0);
    const existing = id ? await db.prepare("SELECT emp_no FROM staff WHERE id=?").bind(id).first() : null;
    if (!empNo) empNo = (existing && existing.emp_no) || (await nextEmpNo(db, kind, jobFunction));
    await db.prepare("UPDATE staff SET name=?, kind=?, emp_no=?, platform=?, job_function=?, role=?, contact=?, start_date=?, status=?, note=?, persona=?, accountable=? WHERE id=?")
      .bind(name, kind, empNo, platform, jobFunction, role, contact, startDate, status, note, persona, accountable, id).run();
  } else {
    if (!empNo) empNo = await nextEmpNo(db, kind, jobFunction);
    await db.prepare("INSERT INTO staff(name, kind, emp_no, platform, job_function, role, contact, start_date, status, note, persona, accountable, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(name, kind, empNo, platform, jobFunction, role, contact, startDate, status, note, persona, accountable, nowIso()).run();
  }
  return redirect("/admin/staff");
}

// ===== 路由 =====
async function handleAdmin(req, env, url) {
  const p = url.pathname;
  if (p === "/admin/login") return handleLogin(req, env);
  if (p === "/admin/logout") return handleLogout();
  if (!(await isAuthed(req, env))) return redirect("/admin/login");
  if (req.method === "POST") {
    if (p === "/admin/leads") return postLeads(req, env);
    if (p === "/admin/delivery") return postDelivery(req, env);
    if (p === "/admin/agents") return postAgents(req, env);
    if (p === "/admin/orders") return postOrders(req, env);
    if (p === "/admin/content") return postContent(req, env);
    if (p === "/admin/tasks") return postTasks(req, env);
    if (p === "/admin/staff") return postStaff(req, env);
    return redirect("/admin");
  }
  if (p === "/admin" || p === "/admin/") return pageDashboard(env);
  if (p === "/admin/leads") return pageLeads(req, env, url);
  if (p === "/admin/user") return pageUser(env, url);
  if (p === "/admin/delivery") return pageDelivery(env, url);
  if (p === "/admin/agents") return pageAgents(env, url);
  if (p === "/admin/orders") return pageOrders(env, url);
  if (p === "/admin/content") return pageContent(env, url);
  if (p === "/admin/tasks") return pageTasks(env, url);
  if (p === "/admin/staff") return pageStaff(env, url);
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith("/api/")) {
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
        if (!env.DB) return jsonResp(req, { ok: false, error: "db not configured" }, 500);
        return await handleApi(req, env, url);
      }
      if (p === "/admin" || p.startsWith("/admin/")) {
        if (!env.ADMIN_KEY) {
          return new Response("后台尚未配置：请在 Cloudflare 后台为本 Worker 添加密钥 ADMIN_KEY（部署说明见 admin/README.md）", {
            status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        if (!env.DB) {
          return new Response("数据库尚未配置：请在 Cloudflare 后台为本 Worker 绑定 D1 数据库（绑定名 DB）", {
            status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        await ensureSchema(env.DB);
        return await handleAdmin(req, env, url);
      }
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    } catch (e) {
      return new Response("Internal error: " + (e && e.message ? e.message : String(e)), {
        status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};

// Named exports for local unit testing only (Workers runtime ignores them)
export { esc, validRef, calcCommission, fmtYuan, clampStr, toInt, daysInStage, isOverdueStage, aggregateMetrics, convRate, taskDueState, validStage, functionCodeFor, examConflict, scoreLead, leadTaskMarker, followupDueStr, DELIVERY_STAGES, ACTIVE_STAGES, STAGE_OVERDUE_DAYS, CONTENT_STATUSES };
