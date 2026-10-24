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
const APP_BASE_URL = "https://zhuanuc.com/one-on-one-app"; // 一对一专属客户端站点根（个性化 manifest 用）
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
const STAFF_KINDS = { human: "真人", ai: "AI 员工", mentor: "外部导师" };
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
// v6：一对一专属客户端（长期一对一辅导学生）——选课类别与状态流转
const COURSE_KINDS = { prereq: "必修先修", gened: "通识", elective: "选修" };
const COURSE_STATUSES = { planned: "计划中", enrolled: "已选", ongoing: "进行中", done: "已完成", dropped: "已退" };
// v6 通用模板：考试结果枚举（考试名/分数/达标线均为自由文本字段，由各学生数据集决定）
const EXAM_RESULTS = { pass: "达标", fail: "未达标", pending: "待考/待出分" };
// v6 通用模板：目标人生线——类型与状态（多条线 + 优先级排序，字段与逻辑不绑定任何个案）
const LINE_TYPES = { main: "主线", parallel: "并行线", passive: "被动等待线" };
const LINE_STATUSES = { active: "进行中", paused: "暂停", done: "已完成", dropped: "已放弃" };

// ===== v10 新增：成长时间线 / 关键日期 / 行动清单 / 导师建议 / 知识卡 / 导师沟通 =====
const ACTION_STATUSES = { todo: "待办", done: "已完成" };
const MESSAGE_SENDERS = { student: "学生", mentor: "导师" };
const MESSAGE_MAX_LEN = 500;        // 学生留言正文上限（字）
const MESSAGE_RATE_LIMIT = 3;       // 同一学生 60 秒内最多 3 条，超限 429
const MESSAGE_RATE_WINDOW_MS = 60 * 1000;
const KNOWLEDGE_LIMIT = 10;         // 客户端接口单次最多下发 10 条知识卡

// ===== v11 新增：家长更新（家长端独立入口；家长是买单人，但学生原始数据默认不向家长开放）=====
// 数据边界（硬规则）：家长只能看到导师专为家长整理、如实且保留学生尊严的内容——
// 家长更新（parent_updates）、如何托举事项（parent_support_actions）、家长↔导师留言（parent_messages）。
// 严禁下发：考试原始记录、成绩/GPA、课程明细、学生留言、状态快照原文、学生目标/人生线原文、
// 学生 client_key、学生签名。家长密钥与学生密钥分列存储、互不通用（交叉访问一律 404）。
const PARENT_MESSAGE_SENDERS = { parent: "家长", mentor: "导师" };
const SUPPORT_ACTION_STATUSES = { active: "进行中", done: "已完成", archived: "已归档" };

/* 知识卡匹配（纯函数）：知识条目的 tag 命中学生主题集合即下发。
 * 主题集合 = 人生线类型集合（main/parallel/passive）
 *   + 有考试记录 → exam、study；有学业目标 → study；
 *   + 任一人生线名称含「创业/生意/business」→ business。 */
function knowledgeTagsFor(goalLines, exams, goal) {
  const tags = new Set();
  const lines = goalLines || [];
  for (const l of lines) if (l && l.line_type) tags.add(String(l.line_type));
  if ((exams || []).length) { tags.add("exam"); tags.add("study"); }
  if (goal) tags.add("study");
  if (lines.some((l) => /创业|生意|business/i.test(String((l && l.name) || "")))) tags.add("business");
  return [...tags];
}
// groupCoursesByTerm: 按 term 分组（学期字符串降序，最新学期在前；组内保持传入顺序）
function groupCoursesByTerm(courses) {
  const map = new Map();
  for (const c of courses || []) {
    const t = String(c.term || "未定学期");
    if (!map.has(t)) map.set(t, []);
    map.get(t).push(c);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([term, list]) => ({ term, courses: list }));
}
// courseProgress: 选课汇总——已完成学分（status=done 的 credits 合计）、已完成先修课数/先修总数、按 kind 的门数与学分进度
function courseProgress(courses) {
  const list = courses || [];
  const isDone = (c) => c.status === "done";
  const kindOf = (c) => c.kind || "prereq";
  const sumCredits = (arr) => arr.reduce((a, c) => a + (Number(c.credits) || 0), 0);
  const byKind = {};
  for (const k of Object.keys(COURSE_KINDS)) {
    const ks = list.filter((c) => kindOf(c) === k);
    const kd = ks.filter(isDone);
    byKind[k] = { total: ks.length, done: kd.length, credits: sumCredits(ks), creditsDone: sumCredits(kd) };
  }
  const pre = list.filter((c) => kindOf(c) === "prereq");
  return {
    total: list.length, doneCount: list.filter(isDone).length,
    creditsDone: sumCredits(list.filter(isDone)), creditsTotal: sumCredits(list),
    prereqTotal: pre.length, prereqDone: pre.filter(isDone).length,
    byKind,
  };
}
// genClientKey: 学生端 APP 只读访问密钥（ck_ + 24 位十六进制，96 位熵）
function genClientKey() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return "ck_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// ensureClientKey: 学生尚无密钥时生成并落库，返回当前密钥
async function ensureClientKey(db, student) {
  if (!student) return null;
  if (student.client_key) return student.client_key;
  const key = genClientKey();
  await db.prepare("UPDATE students SET client_key = ? WHERE id = ?").bind(key, student.id).run();
  return key;
}
// genParentKey: 家长端访问密钥（pk_ + 24 位十六进制，96 位熵），与学生端 client_key 独立
function genParentKey() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return "pk_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// ensureParentKey: 学生尚无家长密钥时生成并落库，返回当前密钥
async function ensureParentKey(db, student) {
  if (!student) return null;
  if (student.parent_key) return student.parent_key;
  const key = genParentKey();
  await db.prepare("UPDATE students SET parent_key = ? WHERE id = ?").bind(key, student.id).run();
  student.parent_key = key;
  return key;
}
// genMentorKey: 导师工作台访问密钥（mk_ + 24 位十六进制），与学生/家长密钥独立、互不通用（v13）
function genMentorKey() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return "mk_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// ensureMentorKey: 导师尚无工作台密钥时生成并落库（后台人员页查看/重置），返回当前密钥
async function ensureMentorKey(db, staff) {
  if (!staff) return null;
  if (staff.mentor_key) return staff.mentor_key;
  const key = genMentorKey();
  await db.prepare("UPDATE staff SET mentor_key = ? WHERE id = ?").bind(key, staff.id).run();
  staff.mentor_key = key;
  return key;
}
// slugify: 学生专属名（对外定位符）生成规则——取学生英文名 / pinyin，小写，
// 仅保留 a-z 0-9，其余字符（含空格、标点、非拉丁字母）折叠为连字符，首尾去连字符，最长 40；
// 清洗后为空时回退 "student"。重名冲突不在此处理，见 uniqueSlug。
function slugify(name) {
  const s = String(name === null || name === undefined ? "" : name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return s || "student";
}
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// uniqueSlug: 保证 slug 全表唯一——候选已被他人占用时依次追加数字后缀（richa → richa2 → richa3…）
async function uniqueSlug(db, base, excludeId) {
  let candidate = base, n = 2;
  for (;;) {
    const row = await db.prepare("SELECT id FROM students WHERE slug = ?").bind(candidate).first();
    if (!row || (excludeId && row.id === excludeId)) return candidate;
    candidate = base + n; n++;
  }
}
// ensureStudentSlug: 学生尚无 slug 时由姓名生成、去重并落库，返回当前 slug
async function ensureStudentSlug(db, student) {
  if (!student) return null;
  if (student.slug) return student.slug;
  const slug = await uniqueSlug(db, slugify(student.name), student.id);
  await db.prepare("UPDATE students SET slug = ? WHERE id = ?").bind(slug, student.id).run();
  return slug;
}
// signatureSuggestions: 专属签名候选生成（纯函数，可单测）。素材全部取学生自己的数据——
// 第一优先级人生线名、学业目标项目（取第一段短称）、学生姓名；愿景形容词按数据特征
// 确定性选取（有考试未达标 → 「不放弃」；有主线在推进 → 「勇敢」；否则按学生 id 在中性词库轮换）。
// 6 个中性通用模板（不写死任何学生），起点按学生 id 轮换，能填槽的才入选，去重后取前 3，每条 ≤30 字。
const SIGNATURE_ADJECTIVES = ["勇敢", "真实", "坚定", "发光", "自在", "向上"];
function signatureGoalShort(targetSchool) {
  let first = String(targetSchool || "").split(/[／/、,，;；]/)[0].trim();
  // 剥掉目标字段开头常见的状态前缀（如「未定版：」「待定：」），短称只留目标本体
  const pm = first.match(/^(未定版|未定|待定|暂定|候选|计划中)[：:]\s*(.+)$/);
  if (pm) first = pm[2].trim();
  return [...first].length > 12 ? [...first].slice(0, 12).join("") : first;
}
function signatureSuggestions(student, goal, goalLines, exams) {
  const name = String((student && student.name) || "").trim();
  const lines = goalLines || [];
  const main = lines.length ? lines[0] : null;
  const mainName = main ? String(main.name || "").trim() : "";
  const goalShort = signatureGoalShort(goal && goal.target_school);
  const idNum = Number(student && student.id) || 0;
  const hasFail = (exams || []).some((e) => e && e.result === "fail");
  const adj = hasFail ? "不放弃" : (mainName ? "勇敢" : SIGNATURE_ADJECTIVES[idNum % SIGNATURE_ADJECTIVES.length]);
  const templates = [
    () => (mainName && name ? mainName + "路上的" + name : ""),
    () => (goalShort ? "向着" + goalShort + "走的人" : ""),
    () => "一个" + adj + "的自己",
    () => (mainName && name ? name + " · " + mainName + "进行时" : ""),
    () => (name && goalShort ? name + "，向" + goalShort + "出发" : ""),
    () => (name ? adj + "的" + name : ""),
  ];
  const out = [];
  const start = templates.length ? idNum % templates.length : 0;
  for (let i = 0; i < templates.length && out.length < 3; i++) {
    const s = templates[(start + i) % templates.length]();
    if (s && [...s].length <= 30 && !out.includes(s)) out.push(s);
  }
  return out;
}

// ===== 数据库结构（与 schema.sql 保持一致）=====
/* v10 新模块数组校验（导入与补录共用）：入参 body 的 milestones / key_dates / actions / advice 四段，
 * 任一条不合法返回 { error }，整单拒绝不落半截数据；合法返回归一化数组。 */
function normClientExtras(body) {
  const out = { milestones: [], keyDates: [], actions: [], advice: [] };
  const intOr = (v, dflt) => {
    if (v === undefined || v === null || v === "") return dflt;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const msRaw = Array.isArray(body.milestones) ? body.milestones : [];
  if (msRaw.length > 100) return { error: "too many milestones (max 100)" };
  for (let i = 0; i < msRaw.length; i++) {
    const m = msRaw[i] || {};
    const title = clampStr(m.title, 120);
    if (!title) return { error: "milestones[" + i + "].title required" };
    const sort = intOr(m.sort, 0);
    if (sort === undefined) return { error: "milestones[" + i + "] bad sort" };
    out.milestones.push({
      date_text: clampStr(m.date_text, 40) || null, title,
      detail: clampStr(m.detail, 2000), kind: clampStr(m.kind, 20) || null, sort,
    });
  }
  const kdRaw = Array.isArray(body.key_dates) ? body.key_dates : [];
  if (kdRaw.length > 100) return { error: "too many key_dates (max 100)" };
  for (let i = 0; i < kdRaw.length; i++) {
    const k = kdRaw[i] || {};
    const title = clampStr(k.title, 120);
    if (!title) return { error: "key_dates[" + i + "].title required" };
    const date = clampStr(k.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      return { error: "key_dates[" + i + "].date must be YYYY-MM-DD" };
    }
    const kind = k.kind === undefined || k.kind === null || k.kind === "" ? null : String(k.kind);
    if (kind && !KEY_DATE_KINDS[kind]) return { error: "key_dates[" + i + "] bad kind" };
    out.keyDates.push({ date, title, kind });
  }
  const acRaw = Array.isArray(body.actions) ? body.actions : [];
  if (acRaw.length > 100) return { error: "too many actions (max 100)" };
  for (let i = 0; i < acRaw.length; i++) {
    const a = acRaw[i] || {};
    const title = clampStr(a.title, 120);
    if (!title) return { error: "actions[" + i + "].title required" };
    const status = a.status === undefined || a.status === null || a.status === "" ? "todo" : String(a.status);
    if (!ACTION_STATUSES[status]) return { error: "actions[" + i + "] bad status" };
    const sort = intOr(a.sort, 0);
    if (sort === undefined) return { error: "actions[" + i + "] bad sort" };
    out.actions.push({
      title, detail: clampStr(a.detail, 2000), due_text: clampStr(a.due_text, 40) || null,
      status, sort,
    });
  }
  const adRaw = Array.isArray(body.advice) ? body.advice : [];
  if (adRaw.length > 100) return { error: "too many advice (max 100)" };
  for (let i = 0; i < adRaw.length; i++) {
    const a = adRaw[i] || {};
    const title = clampStr(a.title, 120);
    if (!title) return { error: "advice[" + i + "].title required" };
    const sort = intOr(a.sort, 0);
    if (sort === undefined) return { error: "advice[" + i + "] bad sort" };
    out.advice.push({ title, body: clampStr(a.body, 4000), sort });
  }
  return out;
}

/* v11 家长数据校验（导入与补录共用）：body 的 parent_updates / parent_support_actions /
 * parent_messages 三段，任一条不合法返回 { error } 整单拒绝；合法返回归一化数组。
 * 内容口径：这里只搬运导师为家长整理好的文本，服务端不做任何从学生原始数据的自动摘录。 */
function normParentExtras(body) {
  const out = { parentUpdates: [], parentSupport: [], parentMessages: [] };
  const intOr = (v, dflt) => {
    if (v === undefined || v === null || v === "") return dflt;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const puRaw = Array.isArray(body.parent_updates) ? body.parent_updates : [];
  if (puRaw.length > 100) return { error: "too many parent_updates (max 100)" };
  for (let i = 0; i < puRaw.length; i++) {
    const u = puRaw[i] || {};
    const title = clampStr(u.title, 120);
    if (!title) return { error: "parent_updates[" + i + "].title required" };
    let updateDate = clampStr(u.update_date, 10);
    if (updateDate && (!/^\d{4}-\d{2}-\d{2}$/.test(updateDate) || Number.isNaN(Date.parse(updateDate)))) {
      return { error: "parent_updates[" + i + "].update_date must be YYYY-MM-DD" };
    }
    if (!updateDate) updateDate = todayStr();
    out.parentUpdates.push({
      update_date: updateDate, title,
      body: clampStr(u.body, 4000),
      current_focus: clampStr(u.current_focus, 2000),
      next_step: clampStr(u.next_step, 2000),
    });
  }
  const psRaw = Array.isArray(body.parent_support_actions) ? body.parent_support_actions : [];
  if (psRaw.length > 100) return { error: "too many parent_support_actions (max 100)" };
  for (let i = 0; i < psRaw.length; i++) {
    const a = psRaw[i] || {};
    const title = clampStr(a.title, 120);
    if (!title) return { error: "parent_support_actions[" + i + "].title required" };
    const status = a.status === undefined || a.status === null || a.status === "" ? "active" : String(a.status);
    if (!SUPPORT_ACTION_STATUSES[status]) return { error: "parent_support_actions[" + i + "] bad status" };
    const sort = intOr(a.sort, 0);
    if (sort === undefined) return { error: "parent_support_actions[" + i + "] bad sort" };
    out.parentSupport.push({
      title, detail: clampStr(a.detail, 2000),
      category: clampStr(a.category, 40) || null, due_text: clampStr(a.due_text, 40) || null,
      status, sort,
    });
  }
  const pmRaw = Array.isArray(body.parent_messages) ? body.parent_messages : [];
  if (pmRaw.length > 50) return { error: "too many parent_messages (max 50)" };
  for (let i = 0; i < pmRaw.length; i++) {
    const m = pmRaw[i] || {};
    const sender = m.sender === undefined || m.sender === null || m.sender === "" ? "mentor" : String(m.sender);
    if (!PARENT_MESSAGE_SENDERS[sender]) return { error: "parent_messages[" + i + "] bad sender" };
    const text = clampStr(m.body, MESSAGE_MAX_LEN);
    if (!text) return { error: "parent_messages[" + i + "].body required" };
    out.parentMessages.push({ sender, body: text });
  }
  return out;
}

// ===== v12 新增：问题方案层 / 导师轨迹（会议精神）/ 课程要求集与匹配引擎 =====
// 数据分层（蓝图第二节）：私密层正文永不进服务器——下列 norm 函数全部走字段白名单，
// diary / journal / mood / emotion 等任何私密字段即使被调用方夹带，也会被直接丢弃、不落库、不回传。
const PROBLEM_DOMAINS = { study: "学业", exam: "考试", business: "创业", career: "职业与并行线", family: "家庭沟通", emotion: "情绪状态", other: "其他" };
const PROBLEM_PROGRESS = { open: "待解决", in_progress: "推进中", resolved: "已解决", escalated: "已升级导师" };
const PROBLEM_RATE_LIMIT = 3;       // 同一学生 60 秒内最多同步 3 条方案（与留言同窗口）
const TRAIL_ROLES = { lead: "主导师", teacher: "任课老师", industry: "行业前辈", coach: "教练", elder: "长辈", other: "其他" };
const TRAIL_SOURCES = { mentor: "导师录入", student: "学生自建" };
const TRAIL_VISIBILITIES = { private: "仅本机", mentor: "同步导师", plan: "方案层" };
const REQ_BLOCKS = { gened: "通识", prereq: "专业先修", core: "专业核心", elective: "选修" };
// 合规待核实关键词（蓝图第〇节双法总闸）：方案层文本命中任一词 → compliance = 'pending_review'（待核实），
// 系统内任何角色都不能把待核实自行改判为已核实，只能转有资质律师 / 会计师 / 主管部门确认后由导师在方案外处理。
const COMPLIANCE_WORDS = ["签证", "F-1", "工作许可", "打工", "营业执照", "公司注册", "代工厂", "食品", "销售许可", "税务", "报税", "收入申报", "移民", "OPT", "CPT", "雇佣", "创业注册", "经营许可"];
function complianceFlag(text) {
  const s = String(text || "");
  return COMPLIANCE_WORDS.some((w) => s.includes(w)) ? "pending_review" : "ok";
}
// 成绩换算（仅用于课程匹配的成绩预警比较；CR / P / IP 等非字母成绩返回 null，不参与比较）
const GRADE_POINTS = { A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7, "C+": 2.3, C: 2, "C-": 1.7, "D+": 1.3, D: 1, F: 0 };
function gradePoints(g) {
  const k = String(g || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(GRADE_POINTS, k) ? GRADE_POINTS[k] : null;
}
function normCourseCode(c) {
  return String(c || "").toUpperCase().replace(/\s+/g, " ").trim();
}
function parsePrereqCodes(s) {
  return String(s || "").split(/[,，、;；]/).map((x) => normCourseCode(x)).filter(Boolean);
}
/* 课程匹配引擎（纯函数，确定性规则）：学生已修/在修/计划课程 × 一份要求集 →
 * 各块匹配计数、缺课清单、先修断裂、成绩预警。口径写死：
 * - 同代码多条课程取状态最优一条（done > ongoing/enrolled > planned）；
 * - 要求状态：done / in_progress（ongoing|enrolled）/ planned / missing；
 * - 学分只统计 credits 非空的要求；credits 为空的要求单列 credits_unknown 计数，绝不估算；
 * - 成绩预警两类：below_min = 已修成绩低于该要求标注的最低成绩（min_grade 来自要求集数据）；
 *   watch = 先修/核心块已修成绩低于 B（3.0）——通用提示，非任何学校官方线，界面须如实标注；
 * - 先修断裂：要求本身已被修/在修/计划（非 missing），但其先修代码没有任何 done/在修课程承接。 */
function matchRequirements(courses, requirements) {
  const rank = (s) => (s === "done" ? 3 : (s === "ongoing" || s === "enrolled") ? 2 : s === "planned" ? 1 : 0);
  const byCode = new Map();
  for (const c of courses || []) {
    const code = normCourseCode(c && c.course_code);
    if (!code) continue;
    const prev = byCode.get(code);
    if (!prev || rank(c.status) > rank(prev.status)) byCode.set(code, c);
  }
  const blocks = {};
  for (const b of Object.keys(REQ_BLOCKS)) {
    blocks[b] = { total: 0, done: 0, in_progress: 0, planned: 0, missing: 0, credits_total: 0, credits_done: 0, credits_missing: 0, credits_unknown: 0 };
  }
  const items = [], missing = [], gradeWarnings = [], prereqBreaks = [];
  for (const r of requirements || []) {
    const block = REQ_BLOCKS[r.block] ? r.block : "prereq";
    const code = normCourseCode(r.course_code);
    const c = code ? byCode.get(code) : null;
    const st = !c ? "missing" : c.status === "done" ? "done" : (c.status === "ongoing" || c.status === "enrolled") ? "in_progress" : "planned";
    const credits = (r.credits === null || r.credits === undefined || r.credits === "") ? null : Number(r.credits);
    const bk = blocks[block];
    bk.total++;
    bk[st]++;
    if (credits === null || !Number.isFinite(credits)) bk.credits_unknown++;
    else {
      bk.credits_total += credits;
      if (st === "done") bk.credits_done += credits;
      if (st === "missing") bk.credits_missing += credits;
    }
    const item = {
      code: r.course_code || "", name: r.course_name || "", block, block_label: REQ_BLOCKS[block],
      credits, min_grade: r.min_grade || "", prereq_codes: parsePrereqCodes(r.prereq_codes),
      status: st, course_grade: c ? (c.grade || "") : "", course_term: c ? (c.term || "") : "",
    };
    items.push(item);
    if (st === "missing") missing.push(item);
    if (st === "done" && c) {
      const gp = gradePoints(c.grade);
      const mp = gradePoints(r.min_grade);
      if (gp !== null && mp !== null && gp < mp) {
        gradeWarnings.push({ code: item.code, name: item.name, grade: c.grade, min_grade: r.min_grade, kind: "below_min" });
      } else if (gp !== null && (block === "prereq" || block === "core") && gp < 3) {
        gradeWarnings.push({ code: item.code, name: item.name, grade: c.grade, min_grade: "", kind: "watch" });
      }
    }
    if (st !== "missing") {
      for (const p of item.prereq_codes) {
        const pc = byCode.get(p);
        if (!pc || !(pc.status === "done" || pc.status === "ongoing" || pc.status === "enrolled")) {
          prereqBreaks.push({ code: item.code, name: item.name, missing_prereq: p });
        }
      }
    }
  }
  const totals = { requirements: items.length, done: 0, in_progress: 0, planned: 0, missing: 0, credits_total: 0, credits_done: 0, credits_missing: 0, credits_unknown: 0 };
  for (const b of Object.keys(blocks)) {
    totals.done += blocks[b].done; totals.in_progress += blocks[b].in_progress;
    totals.planned += blocks[b].planned; totals.missing += blocks[b].missing;
    totals.credits_total += blocks[b].credits_total; totals.credits_done += blocks[b].credits_done;
    totals.credits_missing += blocks[b].credits_missing; totals.credits_unknown += blocks[b].credits_unknown;
  }
  return { blocks, items, missing, grade_warnings: gradeWarnings, prereq_breaks: prereqBreaks, totals };
}
// ===== v13 新增：家长成就/一句话/日期提醒 + 导师注册/通知发件箱/事件流/导师工作台 =====
// 心情标签（学生自选枚举，不是情绪原文）：学生给爸妈的一句话可附带一个自选标签，
// 词表克制四档。字段名用 feeling_tag —— 它是学生主动选择的展示标签，与被红线禁止的
// mood/emotion（情绪原文记录）有本质区别：前者是学生自愿公开的枚举，后者是私密原文，永不入服务器。
const FEELING_TAGS = { steady: "平稳", tired: "有点累", happy: "很开心", busy: "有点忙" };
const KEY_DATE_KINDS = { birthday: "生日", deadline: "截止日", exam: "考试", other: "其他" };
const MENTOR_STATUSES = { registered: "已登记", verified: "已核验" };
const NOTIFY_CHANNELS = { email: "邮箱", phone: "电话", wechat: "微信", admin: "后台呈现" };
const OUTBOX_STATUSES = { queued: "待转达", sent: "已转达", responded: "已回复" };
const EVENT_TYPES = {
  action_completed: "完成行动", problem_opened: "提出问题", problem_resolved: "问题解决",
  problem_escalated: "问题升级导师", mentor_forwarded: "导师转给创始人", message_student: "学生留言", message_mentor: "导师回复",
  mentor_reply: "导师回复", parent_note_sent: "给爸妈的一句话", parent_note_withdrawn: "撤回一句话",
  trail_created: "导师轨迹新增", parent_update_published: "家长更新发布",
};
const PARENT_NOTE_MAX_LEN = 80;      // 一句话长度上限（码点）
const PARENT_NOTE_RATE_LIMIT = 3;    // 与留言同窗口：60 秒最多 3 条
const REMINDER_HORIZON_DAYS = 30;    // 家长端日期提醒窗口（未来 30 天）
/* 导师可通知判定：已登记/已核验（mentor_status）且至少一项联系方式
 * （contact_email / contact_phone / contact_wechat / 旧 contact 自由文本任一非空）。
 * 缺联系方式或未登记者 = 不可通知，学生留言/问题升级指向它时接口明确报错，不落无主收件箱。 */
function mentorContacts(staff) {
  if (!staff) return [];
  const out = [];
  if (String(staff.contact_email || "").trim()) out.push("email");
  if (String(staff.contact_phone || "").trim()) out.push("phone");
  if (String(staff.contact_wechat || "").trim()) out.push("wechat");
  if (!out.length && String(staff.contact || "").trim()) out.push("admin");
  return out;
}
function mentorNotifiable(staff) {
  if (!staff) return false;
  const contacts = mentorContacts(staff);
  if (!contacts.length) return false;
  if (MENTOR_STATUSES[staff.mentor_status]) return true;
  // 存量兼容：注册制之前已留 contact（创始人转达渠道）的档案视为可通知，
  // 否则创始人的既有员工档案（无 mentor_status）被指为默认导师时学生留言会被误拒。
  return contacts.includes("admin");
}
function mentorChannel(staff) {
  const pref = String((staff && staff.notify_channel) || "");
  const have = mentorContacts(staff);
  if (NOTIFY_CHANNELS[pref] && (pref === "admin" || have.includes(pref))) return pref;
  return have.length ? have[0] : "admin";
}
async function resolveStudentMentor(db, student) {
  if (!student || !student.mentor_id) return null;
  return db.prepare(`SELECT * FROM staff WHERE id = ?`).bind(student.mentor_id).first();
}
/* v15 多导师：导师身份与关系解析。
 * 已登记导师 = 导师状态为已登记/已核验，或 kind / role 标为导师；
 * 专题导师候选还须已有工作台密钥（mentor_key）——没有密钥就发不出工作台链接。 */
function isMentorStaff(staff) {
  if (!staff) return false;
  return !!(MENTOR_STATUSES[staff.mentor_status] || staff.kind === "mentor" || staff.role === "mentor");
}
function isTopicMentorCandidate(staff) {
  return isMentorStaff(staff) && !!(staff && staff.mentor_key);
}
/* 某学生的全部专题导师指派（带导师姓名/编号），按指派顺序。 */
async function topicAssignmentsOf(db, studentId) {
  return (await db.prepare(
    `SELECT tm.id AS assign_id, tm.topic AS topic, tm.staff_id AS staff_id,
            s.name AS staff_name, s.emp_no AS staff_emp_no
     FROM student_topic_mentors tm JOIN staff s ON s.id = tm.staff_id
     WHERE tm.student_id = ? ORDER BY tm.id ASC`).bind(studentId).all()).results || [];
}
/* 学生与导师的关系：{ relation: "primary" }（主导师）/ { relation: "topic", topic }（专题导师）/
 * null（无关系）。导师接口的权限分流以此为准，无关系一律按不存在处理（404）。 */
async function mentorStudentRelation(db, staff, student) {
  if (!staff || !student) return null;
  if (student.mentor_id && Number(student.mentor_id) === Number(staff.id)) return { relation: "primary" };
  const asg = await db.prepare(
    `SELECT * FROM student_topic_mentors WHERE student_id = ? AND staff_id = ?`
  ).bind(student.id, staff.id).first();
  if (asg) return { relation: "topic", topic: asg.topic || "" };
  return null;
}
/* 事件流写入（方案层事件 only；summary 为一句摘要，调用方不得放私密正文/标题）。 */
async function logEvent(db, studentId, eventType, objectId, summary) {
  try {
    await db.prepare(
      `INSERT INTO student_events(student_id, event_type, object_id, summary, created_at) VALUES(?,?,?,?,?)`
    ).bind(studentId, eventType, objectId || null, clampStr(summary, 200), nowIso()).run();
  } catch (e) { /* 事件流是追踪层，写入失败不阻断主流程 */ }
}
/* ===== v16：系统自动邮件通知（Resend）=====
 * 口径：导师 notify_channel = 'email' 且 contact_email 非空时，发件箱通知生成后由系统
 * 自动发邮件（发件人 info@zhuanuc.com，域名 MX 在腾讯企业邮箱，回复自然回到 info@），
 * 成功即把该行置 sent + auto_sent=1；其余渠道（微信/电话/后台呈现）行为完全不变，
 * 仍走 queued → 创始人人工转达。发信是旁路：未配 RESEND_API_KEY 静默跳过、发送失败
 * 只记 mail_log 并保持 queued，任何异常都不得影响留言/问题等主流程。 */
const RESEND_API_URL = "https://api.resend.com/emails";
const MAIL_FROM = "TransferOS <info@zhuanuc.com>";
/* v18 线索提醒：新线索入库后发到内部提醒邮箱（公共邮箱 leads@，只内部收信，不对外）。 */
const LEAD_NOTIFY_TO = "leads@zhuanuc.com";
const MENTOR_WORKBENCH_URL = "https://zhuanuc.com/one-on-one-app/mentor.html";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/* 自动邮件的收件地址：导师通知偏好明确为 email 且邮箱有效才返回地址，否则 null。 */
function mentorMailTo(staff) {
  if (!staff) return null;
  if (String(staff.notify_channel || "") !== "email") return null;
  const to = String(staff.contact_email || "").trim();
  return EMAIL_RE.test(to) ? to : null;
}
/* 导师工作台链接：有本人密钥时给一键链接（?s=工号/编号&k=密钥，与后台人员页展示的
 * 工作台链接同一口径，s 取 emp_no、无则 id）；无导师或密钥缺失/为空时回退裸链接。
 * 带密钥的链接只允许出现在发给该导师本人的邮件里，不得进主题/日志/其他渠道。 */
function mentorWorkbenchUrl(mentor) {
  const key = mentor && mentor.mentor_key ? String(mentor.mentor_key).trim() : "";
  const loc = mentor ? String(mentor.emp_no || mentor.id || "").trim() : "";
  if (!key || !loc) return MENTOR_WORKBENCH_URL;
  return MENTOR_WORKBENCH_URL + "?s=" + encodeURIComponent(loc) + "&k=" + encodeURIComponent(key);
}
/* 通知邮件内容（纯函数）：只含元数据（学生名/事项摘要/时间）+ 工作台链接，
 * 绝不带留言正文等私密内容；签名只写 TransferOS，不出现真人姓名。
 * 传入 mentor 时工作台链接为该导师本人的一键链接（含其密钥，仅发其本人邮箱）；
 * 不传/无密钥则为裸链接。主题行永不含链接与密钥。 */
function buildOutboxMail(eventType, studentName, summary, ts, mentor) {
  const name = String(studentName || "").trim() || "学生";
  const subjects = {
    student_message: "【TransferOS】" + name + " 发来一条留言",
    problem_escalated: "【TransferOS】" + name + " 把一个问题升级给你",
    trail_revisit: "【TransferOS】" + name + " 有新的轨迹动态待回看",
  };
  const subject = subjects[eventType] || ("【TransferOS】" + name + " 有一条新通知");
  const url = mentorWorkbenchUrl(mentor);
  const text = [
    "学生：" + name,
    "事项：" + (summary || ""),
    "时间：" + (ts || ""),
    "",
    "请登录导师工作台查看并回复：",
    url,
    "",
    "— TransferOS",
  ].join("\n");
  const html = "<div style=\"font-family:sans-serif;font-size:14px;line-height:1.7;color:#222\">"
    + "<p>学生：" + esc(name) + "<br>事项：" + esc(summary || "") + "<br>时间：" + esc(ts || "") + "</p>"
    + "<p>请登录导师工作台查看并回复：<br><a href=\"" + esc(url) + "\">" + esc(url) + "</a></p>"
    + "<p>— TransferOS</p></div>";
  return { subject, text, html };
}
/* 发信（Resend）：返回 { ok:true, id } / { ok:false, error } / 未配密钥时
 * { ok:false, skipped:true, error:"mail_not_configured" }。自身不抛异常。 */
async function sendResendMail(env, to, subject, text, html) {
  const key = env && env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: true, error: "mail_not_configured" };
  // 2026-10-24：发件人可在 Cloudflare 设 MAIL_FROM 秘密覆盖（默认 info@）；
  // support@ 就绪后改这一个秘密，全链路（系统 + 手动）一起切换，无需改代码。
  const from = (env && env.MAIL_FROM ? String(env.MAIL_FROM).trim() : "") || MAIL_FROM;
  try {
    const ctrl = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined;
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: ctrl,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: "resend_http_" + res.status + (t ? ": " + t.slice(0, 300) : "") };
    }
    const data = await res.json().catch(() => null);
    return { ok: true, id: data && data.id ? String(data.id) : "" };
  } catch (e) {
    return { ok: false, error: "fetch_error: " + (e && e.message ? e.message : String(e)) };
  }
}
/* 邮件发送日志（排查用；写日志失败同样不得影响主流程）。 */
async function logMailRow(db, outboxId, to, subject, status, error) {
  try {
    await db.prepare(
      `INSERT INTO mail_log(outbox_id, to_addr, subject, status, error, created_at) VALUES(?,?,?,?,?,?)`
    ).bind(outboxId || null, clampStr(to, 200), clampStr(subject, 300), status, error ? clampStr(error, 500) : null, nowIso()).run();
  } catch (e) { /* 旁路日志，忽略 */ }
}
/* 发件箱生成后的自动发送尝试：非 email 渠道直接返回；成功置 sent + auto_sent=1，
 * 失败保持 queued 并记 mail_log。全程 try/catch 兜底，绝不向上抛。 */
async function maybeAutoSendOutboxMail(env, db, mentor, outboxId, studentId, eventType, summary, ts) {
  try {
    const to = mentorMailTo(mentor);
    if (!to) return;
    if (!env || !env.RESEND_API_KEY) {
      console.log("[mail] RESEND_API_KEY 未配置，跳过自动发送 outbox#" + outboxId);
      return;
    }
    let stuName = "";
    try {
      const s = await db.prepare("SELECT name FROM students WHERE id = ?").bind(studentId).first();
      if (s && s.name) stuName = s.name;
    } catch (e) { /* 学生名取不到时模板以「学生」兜底 */ }
    const mail = buildOutboxMail(eventType, stuName, summary, ts, mentor);
    const r = await sendResendMail(env, to, mail.subject, mail.text, mail.html);
    if (r.ok) {
      await db.prepare(
        `UPDATE notifications_outbox SET status = 'sent', auto_sent = 1, updated_at = ? WHERE id = ? AND status = 'queued'`
      ).bind(nowIso(), outboxId).run();
      await logMailRow(db, outboxId, to, mail.subject, "sent", null);
    } else {
      await logMailRow(db, outboxId, to, mail.subject, "failed", r.error);
    }
  } catch (e) {
    console.log("[mail] 自动发送异常 outbox#" + outboxId + ": " + (e && e.message ? e.message : String(e)));
  }
}
/* 发件箱写入（仅元数据）。channel 按导师通知偏好与实际联系方式解析；
 * email 渠道导师（notify_channel=email 且有邮箱）在生成后由系统自动发信（v16，见上），
 * 其余仍只到 queued（待转达），由创始人在后台标 sent、导师回复后自动 responded。 */
async function pushOutbox(env, db, mentor, studentId, eventType, summary, refType, refId) {
  if (!mentor) return null;
  const ts = nowIso();
  const cleanSummary = clampStr(summary, 200);
  const r = await db.prepare(
    `INSERT INTO notifications_outbox(mentor_staff_id, student_id, channel, event_type, summary, status, ref_type, ref_id, created_at, updated_at)
     VALUES(?,?,?, ?, ?, 'queued', ?, ?, ?, ?)`
  ).bind(mentor.id, studentId, mentorChannel(mentor), eventType, cleanSummary, refType || null, refId || null, ts, ts).run();
  const outboxId = r.meta.last_row_id;
  await maybeAutoSendOutboxMail(env, db, mentor, outboxId, studentId, eventType, cleanSummary, ts);
  return outboxId;
}

/* ======================== v17：导师文件一次性投递 ========================
 * 创始人规则（不可改动）：导师仅可向名下学生（主导师/专题导师均可）发文件；
 * 单文件 ≤5MB；每生 pending 总量 ≤25MB；全局 pending 总量 ≤2GB（总闸）；
 * 类型白名单（扩展名 + MIME 双查）；满 24h 未下载自动删除（R2 对象 + 记录置
 * expired）；学生下载完成即删（同文件不可二次下载，非 pending 下载返回 410）；
 * 导师可在下载前撤回（仅限本人发送的）。家长端完全不暴露文件（无字段、无接口）。
 * 存储：R2 绑定 FILES（bucket transferos-files，需创始人在 Cloudflare 手动建桶）；
 * 元数据落 D1 mentor_files 表；r2_key 为随机串，不可猜测、不含身份信息。
 * 额度可经 env 注入覆盖（FILE_MAX_BYTES / FILE_STUDENT_QUOTA_BYTES /
 * FILE_GLOBAL_QUOTA_BYTES）——仅供测试模拟，生产不设即用下列默认值。 */
const FILE_MAX_BYTES = 5 * 1024 * 1024;
const FILE_STUDENT_QUOTA_BYTES = 25 * 1024 * 1024;
const FILE_GLOBAL_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
const FILE_TTL_MS = 24 * 3600 * 1000;
const FILE_TYPE_MAP = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  txt: ["text/plain"],
  zip: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
};
function fileLimits(env) {
  const n = (v, d) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.floor(x) : d;
  };
  return {
    maxBytes: n(env && env.FILE_MAX_BYTES, FILE_MAX_BYTES),
    studentQuota: n(env && env.FILE_STUDENT_QUOTA_BYTES, FILE_STUDENT_QUOTA_BYTES),
    globalQuota: n(env && env.FILE_GLOBAL_QUOTA_BYTES, FILE_GLOBAL_QUOTA_BYTES),
  };
}
// mentorFileTypeOk（纯函数）：扩展名与 MIME 必须同时命中白名单才放行。
function mentorFileTypeOk(filename, contentType) {
  const name = String(filename || "");
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  const mimes = FILE_TYPE_MAP[name.slice(dot + 1).toLowerCase()];
  if (!mimes) return false;
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  return mimes.includes(mime);
}
function sanitizeFilename(name) {
  const bad = new Set([..."\\/:*?\"<>|"]);
  const clean = [...String(name || "")]
    .map((ch) => (bad.has(ch) || ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127 ? "_" : ch))
    .join("").trim();
  return clampStr(clean || "file", 200);
}
function genFileKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "mf/" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// 单行过期处置：删 R2 对象（失败不阻断）+ 记录置 expired。row 已非 pending 时返回 false。
async function expireMentorFile(env, db, row) {
  if (!row || row.status !== "pending") return false;
  if (env && env.FILES) { try { await env.FILES.delete(row.r2_key); } catch (e) { /* 对象删除失败不阻断状态流转，下轮清扫兜底 */ } }
  await db.prepare("UPDATE mentor_files SET status = 'expired' WHERE id = ? AND status = 'pending'").bind(row.id).run();
  return true;
}
// 清扫：全部（或指定学生）到期的 pending 文件置 expired 并删对象。scheduled 与
// 上传/列表/下载路径共用（双保险）。返回处置条数。
async function sweepExpiredMentorFiles(env, db, studentId) {
  const now = nowIso();
  const q = studentId
    ? await db.prepare("SELECT * FROM mentor_files WHERE status = 'pending' AND expires_at < ? AND student_id = ? ORDER BY id ASC LIMIT 500").bind(now, studentId).all()
    : await db.prepare("SELECT * FROM mentor_files WHERE status = 'pending' AND expires_at < ? ORDER BY id ASC LIMIT 500").bind(now).all();
  let n = 0;
  for (const row of q.results || []) { if (await expireMentorFile(env, db, row)) n++; }
  return n;
}
function mentorFileView(row, extra) {
  const left = row.status === "pending"
    ? Math.max(0, Math.floor((Date.parse(row.expires_at || "") - Date.now()) / 1000))
    : 0;
  return {
    id: row.id, filename: row.filename, size: row.size,
    content_type: row.content_type, status: row.status,
    created_at: row.created_at, expires_at: row.expires_at,
    downloaded_at: row.downloaded_at || null, seconds_left: left,
    ...(extra || {}),
  };
}
/* 家长成就（方案层事实事件）：已完成里程碑（成长时间线条目本身即已发生的事实）+
 * 已完成行动 + 已解决问题。只出标题与日期文本，绝不带成绩/GPA/课程/考试明细。 */
function buildAchievements(milestones, doneActions, resolvedProblems) {
  const out = [];
  for (const m of milestones || []) {
    out.push({ kind: "milestone", title: m.title || "", date_text: m.date_text || "" });
  }
  for (const a of doneActions || []) {
    out.push({ kind: "action", title: a.title || "", date_text: String(a.updated_at || a.created_at || "").slice(0, 10) });
  }
  for (const p of resolvedProblems || []) {
    out.push({ kind: "problem", title: p.title || "", date_text: String(p.updated_at || p.created_at || "").slice(0, 10) });
  }
  return out.slice(0, 30);
}
/* 日期提醒（纯函数，可固定时钟测试）：未来 horizon 天内的关键日期。
 * 来源仅限日期型字段：key_dates（kind=birthday 按月日周年滚动到下一次）、exams 的考试日期
 * （只出事项名与日期）、milestones 中 date_text 为 ISO 日期（YYYY-MM-DD 开头）的条目。
 * 入参 today 为 YYYY-MM-DD（UTC 口径，与 todayStr 一致）。 */
function computeUpcomingReminders(keyDates, exams, milestones, today, horizonDays) {
  const horizon = Number.isFinite(horizonDays) ? horizonDays : REMINDER_HORIZON_DAYS;
  const t0 = Date.parse(today + "T00:00:00Z");
  if (!Number.isFinite(t0)) return [];
  const inWindow = (dstr) => {
    const t = Date.parse(dstr + "T00:00:00Z");
    return Number.isFinite(t) && t >= t0 && t <= t0 + horizon * 864e5;
  };
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  const out = [];
  for (const k of keyDates || []) {
    const d = String(k.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (k.kind === "birthday") {
      const md = d.slice(5);
      let occ = String(today).slice(0, 4) + "-" + md;
      if (occ < today) occ = String(Number(String(today).slice(0, 4)) + 1) + "-" + md;
      if (inWindow(occ)) out.push({ date: occ, title: k.title || "", kind: "birthday" });
    } else if (inWindow(d)) {
      out.push({ date: d, title: k.title || "", kind: KEY_DATE_KINDS[k.kind] ? k.kind : "key_date" });
    }
  }
  for (const e of exams || []) {
    const d = String(e.exam_date || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && inWindow(d)) {
      out.push({ date: d, title: e.exam_name || "", kind: "exam" });
    }
  }
  for (const m of milestones || []) {
    const d = String(m.date_text || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && inWindow(d)) {
      out.push({ date: d, title: m.title || "", kind: "milestone" });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out.map((r) => ({ ...r, days_left: Math.round((Date.parse(r.date + "T00:00:00Z") - t0) / 864e5), date_fmt: fmt(Date.parse(r.date + "T00:00:00Z")) }));
}
/* —— v13.4：家长视图展示区块（家长接口 GET /api/parent 与学生端预览
 * GET /api/client/parent-preview 共用同一构建函数，保证两边字段形状逐键一致）——
 * 只组装家长层展示内容：学生基本信息（姓名/slug/阶段/套餐）、导师整理的进展更新、
 * 如何托举事项、需要关注事项、方案层事实成就、学生主动发的一句话、未来 30 天日期提醒。
 * 不查 parent_messages（家长↔导师留言不在本区块；家长接口的留言与未读标记由其处理函数
 * 在本函数之外单独处理），不查考试/课程明细、GPA、学生留言等学生原始数据
 * （成就与提醒的数据源只取里程碑/行动/问题的标题与日期文本）。纯读、无副作用。 */
async function parentViewSections(db, student) {
  const psid = student.id;
  // 性能优化（2026-10-22）：8 条查询彼此独立（都只按 student_id 取数），由串行改并行；
  // SQL 与排序、组装逻辑一字未动，响应形状不变。
  const rowsOf = (r) => r.results || [];
  const [updateRows, supportRows, concernRows, achMilestones, achActions, achProblems,
    studentNoteRows, kdRows, examRows] = await Promise.all([
    db.prepare(
      `SELECT * FROM parent_updates WHERE student_id = ? ORDER BY update_date DESC, id DESC LIMIT 200`).bind(psid).all().then(rowsOf),
    db.prepare(
      `SELECT * FROM parent_support_actions WHERE student_id = ?
       ORDER BY CASE WHEN status = 'active' THEN 0 WHEN status = 'done' THEN 1 ELSE 2 END, sort ASC, id ASC LIMIT 200`).bind(psid).all().then(rowsOf),
    db.prepare(
      `SELECT * FROM parent_concerns WHERE student_id = ? ORDER BY concern_date DESC, id DESC LIMIT 100`).bind(psid).all().then(rowsOf),
    db.prepare(
      `SELECT title, date_text FROM student_milestones WHERE student_id = ? ORDER BY sort ASC, id ASC LIMIT 30`).bind(psid).all().then(rowsOf),
    db.prepare(
      `SELECT title, created_at, updated_at FROM student_actions WHERE student_id = ? AND status = 'done' ORDER BY updated_at DESC, id DESC LIMIT 30`).bind(psid).all().then(rowsOf),
    db.prepare(
      `SELECT title, created_at, updated_at FROM student_problem_shares WHERE student_id = ? AND progress = 'resolved' ORDER BY updated_at DESC, id DESC LIMIT 30`).bind(psid).all().then(rowsOf),
    db.prepare(
      `SELECT * FROM note_to_parents WHERE student_id = ? AND withdrawn_at IS NULL ORDER BY id DESC LIMIT 10`).bind(psid).all().then(rowsOf),
    db.prepare(
      `SELECT * FROM student_key_dates WHERE student_id = ? ORDER BY date ASC, id ASC LIMIT 100`).bind(psid).all().then(rowsOf),
    db.prepare(
      `SELECT exam_name, exam_date FROM student_exams WHERE student_id = ? LIMIT 200`).bind(psid).all().then(rowsOf),
  ]);
  const achievements = buildAchievements(achMilestones, achActions, achProblems);
  const upcomingReminders = computeUpcomingReminders(kdRows, examRows, achMilestones, todayStr(), REMINDER_HORIZON_DAYS);
  const studentOut = {
    name: student.name || "", slug: student.slug || "",
    stage: student.stage || "", stage_label: DELIVERY_STAGES[student.stage] || student.stage || "",
  };
  if (student.package) studentOut.package = student.package;
  return {
    student: studentOut,
    updates: updateRows.map((u) => ({
      id: u.id, update_date: u.update_date || "", title: u.title || "",
      body: u.body || "", current_focus: u.current_focus || "", next_step: u.next_step || "",
      created_at: u.created_at || "",
    })),
    support_actions: supportRows.map((a) => ({
      id: a.id, title: a.title || "", detail: a.detail || "", category: a.category || "",
      due_text: a.due_text || "", status: a.status || "",
      status_label: SUPPORT_ACTION_STATUSES[a.status] || a.status || "", sort: a.sort,
    })),
    achievements,
    student_notes: studentNoteRows.map((n) => ({
      id: n.id, body: n.body || "", feeling_tag: n.feeling_tag || "",
      feeling_tag_label: n.feeling_tag ? (FEELING_TAGS[n.feeling_tag] || n.feeling_tag) : "",
      created_at: n.created_at || "",
    })),
    upcoming_reminders: upcomingReminders,
    concerns: concernRows.map((c) => ({
      id: c.id, concern_date: c.concern_date || "", title: c.title || "",
      body: c.body || "", action_text: c.action_text || "",
      created_at: c.created_at || "",
    })),
  };
}
/* v12 问题方案同步校验（学生端 POST /api/client/problem 用）：字段白名单归一，
 * 任一不合法返回 { error }；私密字段（diary/journal/mood/emotion 等）不在白名单内，天然丢弃。 */
function normProblemInput(body) {
  const b = body || {};
  const domain = b.domain === undefined || b.domain === null || b.domain === "" ? "other" : String(b.domain);
  if (!PROBLEM_DOMAINS[domain]) return { error: "bad domain" };
  const title = clampStr(b.title, 120);
  if (!title) return { error: "title required" };
  const actsRaw = Array.isArray(b.actions) ? b.actions : [];
  if (actsRaw.length > 10) return { error: "too many actions (max 10)" };
  const actions = [];
  for (let i = 0; i < actsRaw.length; i++) {
    const a = actsRaw[i] || {};
    const at = clampStr(typeof a === "string" ? a : a.title, 120);
    if (!at) return { error: "actions[" + i + "].title required" };
    actions.push({ title: at, due_text: clampStr(a.due_text, 40) || null });
  }
  return {
    domain, title,
    desired_outcome: clampStr(b.desired_outcome, 500),
    strategy_summary: clampStr(b.strategy_summary, 2000),
    actions,
    support_needed: clampStr(b.support_needed, 500),
    source_local_id: clampStr(b.source_local_id, 80) || null,
  };
}
/* v12 导师轨迹补录校验（enrich 用）：字段白名单归一；takeaway_local=1 时领受正文不落库（只存本机标记）。 */
function normTrailExtras(body) {
  const out = { trail: [] };
  const raw = Array.isArray(body && body.trail_entries) ? body.trail_entries : [];
  if (raw.length > 50) return { error: "too many trail_entries (max 50)" };
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i] || {};
    const mentorName = clampStr(e.mentor_name, 40);
    if (!mentorName) return { error: "trail_entries[" + i + "].mentor_name required" };
    const role = e.mentor_role === undefined || e.mentor_role === null || e.mentor_role === "" ? "lead" : String(e.mentor_role);
    if (!TRAIL_ROLES[role]) return { error: "trail_entries[" + i + "] bad mentor_role" };
    const spirit = clampStr(e.spirit_line, 120);
    if ([...spirit].length > 60) return { error: "trail_entries[" + i + "].spirit_line too long (max 60)" };
    const vis = e.visibility === undefined || e.visibility === null || e.visibility === "" ? "plan" : String(e.visibility);
    if (!TRAIL_VISIBILITIES[vis]) return { error: "trail_entries[" + i + "] bad visibility" };
    const takeLocal = e.takeaway_local ? 1 : 0;
    let due = clampStr(e.revisit_due, 10);
    if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due)))) {
      return { error: "trail_entries[" + i + "].revisit_due must be YYYY-MM-DD" };
    }
    out.trail.push({
      meeting_id: e.meeting_id ? (parseInt(e.meeting_id, 10) || null) : null,
      mentor_name: mentorName, mentor_role: role, spirit_line: spirit,
      key_judgments: clampStr(e.key_judgments, 2000),
      student_takeaway: takeLocal ? "" : clampStr(e.student_takeaway, 2000),
      takeaway_local: takeLocal,
      followup_actions: clampStr(e.followup_actions, 2000),
      revisit_result: clampStr(e.revisit_result, 2000),
      revisit_due: due || null, visibility: vis,
      source: e.source === "student" ? "student" : "mentor",
    });
  }
  return out;
}
/* v12 课程要求集校验（enrich 用）：字段白名单归一；要求集逐份标来源与版本，verified 只能由录入方按官方核实结果给。 */
function normRequirementSets(body) {
  const out = { sets: [] };
  const raw = Array.isArray(body && body.requirement_sets) ? body.requirement_sets : [];
  if (raw.length > 10) return { error: "too many requirement_sets (max 10)" };
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] || {};
    const name = clampStr(s.name, 120);
    if (!name) return { error: "requirement_sets[" + i + "].name required" };
    const reqRaw = Array.isArray(s.requirements) ? s.requirements : [];
    if (reqRaw.length > 300) return { error: "requirement_sets[" + i + "] too many requirements (max 300)" };
    const reqs = [];
    for (let j = 0; j < reqRaw.length; j++) {
      const r = reqRaw[j] || {};
      const code = clampStr(r.course_code, 30);
      if (!code) return { error: "requirement_sets[" + i + "].requirements[" + j + "].course_code required" };
      const block = r.block === undefined || r.block === null || r.block === "" ? "prereq" : String(r.block);
      if (!REQ_BLOCKS[block]) return { error: "requirement_sets[" + i + "].requirements[" + j + "] bad block" };
      let credits = null;
      if (r.credits !== undefined && r.credits !== null && r.credits !== "") {
        credits = Number(r.credits);
        if (!Number.isFinite(credits) || credits < 0 || credits > 60) {
          return { error: "requirement_sets[" + i + "].requirements[" + j + "] bad credits" };
        }
      }
      reqs.push({
        block, course_code: code, course_name: clampStr(r.course_name, 120),
        credits, min_grade: clampStr(r.min_grade, 4) || null,
        prereq_codes: clampStr(r.prereq_codes, 200) || null,
        sort: Number.isFinite(parseInt(r.sort, 10)) ? parseInt(r.sort, 10) : j,
      });
    }
    out.sets.push({
      name, source_note: clampStr(s.source_note, 500), version_text: clampStr(s.version_text, 120),
      verified: s.verified ? 1 : 0,
      sort: Number.isFinite(parseInt(s.sort, 10)) ? parseInt(s.sort, 10) : i,
      requirements: reqs,
    });
  }
  return out;
}
// 会议精神的会后行动并入行动清单（一行一条，按标题对该学生去重）——导师录入 / enrich / 学生自建三处共用
async function insertTrailFollowups(db, sid, followupText, now) {
  const lines = String(followupText || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
  let n = 0;
  for (const title of lines) {
    const t = clampStr(title, 120);
    if (!t) continue;
    const dup = await db.prepare(`SELECT id FROM student_actions WHERE student_id = ? AND title = ?`).bind(sid, t).first();
    if (dup) continue;
    await db.prepare(
      `INSERT INTO student_actions(student_id, title, detail, due_text, status, sort, created_at, updated_at)
       VALUES(?,?,?,NULL,'todo',0,?,?)`
    ).bind(sid, t, "", now, now).run();
    n++;
  }
  return n;
}

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
    stage_since TEXT, note TEXT, created_at TEXT, updated_at TEXT,
    client_key TEXT, slug TEXT, signature TEXT, signature_set_at TEXT,
    vision_text TEXT, mentor_message TEXT, mentor_message_at TEXT,
    parent_key TEXT)`,
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
  `CREATE TABLE IF NOT EXISTS student_goals(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER UNIQUE,
    target_school TEXT, target_term TEXT, goal_note TEXT, gpa_target TEXT,
    school_system TEXT, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS student_status(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    snapshot_date TEXT, gpa REAL, credits_done INTEGER, credits_total INTEGER,
    note TEXT, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS student_courses(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    term TEXT, course_code TEXT, course_name TEXT, credits INTEGER,
    kind TEXT DEFAULT 'prereq', status TEXT DEFAULT 'planned', grade TEXT,
    note TEXT, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS student_meetings(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    meeting_date TEXT, topic TEXT, summary TEXT, action_items TEXT,
    next_date TEXT, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS student_exams(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    exam_name TEXT, exam_date TEXT, score TEXT, pass_line TEXT,
    result TEXT DEFAULT 'pending', note TEXT, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS student_goal_lines(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    name TEXT, line_type TEXT DEFAULT 'parallel', priority INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active', next_step TEXT, created_at TEXT, updated_at TEXT)`,
  // ===== v10 新增表 =====
  // 成长时间线（date_text 为自由文本，可写「2025 秋季」式学期文本，日期未知留空；sort 升序）
  `CREATE TABLE IF NOT EXISTS student_milestones(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    date_text TEXT, title TEXT, detail TEXT, kind TEXT,
    sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)`,
  // 关键日期（date 为 ISO 日期 YYYY-MM-DD，供 APP 算倒计时）
  `CREATE TABLE IF NOT EXISTS student_key_dates(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    date TEXT, title TEXT, created_at TEXT, updated_at TEXT)`,
  // 行动清单（只读下发学生端；status: todo 待办 / done 已完成；sort 升序）
  `CREATE TABLE IF NOT EXISTS student_actions(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    title TEXT, detail TEXT, due_text TEXT,
    status TEXT DEFAULT 'todo', sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)`,
  // 知识卡（全局库，tag 与学生主题匹配后下发；enabled=0 不下发）
  `CREATE TABLE IF NOT EXISTS knowledge_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT,
    tag TEXT, enabled INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT)`,
  // 导师建议（方案正文：诊断结论 / 策略摘要，与行动清单的待办分工不同；sort 升序维护，接口按时间倒序）
  `CREATE TABLE IF NOT EXISTS student_advice(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    title TEXT, body TEXT, sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)`,
  // 导师沟通留言（双向；sender: student / mentor；read_by_* 供两端未读计数）
  `CREATE TABLE IF NOT EXISTS student_messages(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    sender TEXT DEFAULT 'student', body TEXT, created_at TEXT,
    read_by_student INTEGER DEFAULT 0, read_by_mentor INTEGER DEFAULT 0)`,
  // ===== v11 新增表：家长更新（仅导师整理给家长看的内容，与学生原始数据完全隔离）=====
  // 家长进展更新（导师录入、家长可见；update_date 为更新日期文本 YYYY-MM-DD）
  `CREATE TABLE IF NOT EXISTS parent_updates(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    update_date TEXT, title TEXT, body TEXT, current_focus TEXT, next_step TEXT,
    created_at TEXT, updated_at TEXT)`,
  // 如何托举（需要家庭配合的具体事项；status: active 进行中 / done 已完成 / archived 已归档）
  `CREATE TABLE IF NOT EXISTS parent_support_actions(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    title TEXT, detail TEXT, category TEXT, due_text TEXT,
    status TEXT DEFAULT 'active', sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)`,
  // 需要关注（v13.4 新增；导师整理的需关注事项，与进展更新分开计列、并列呈现；
  // 呈现规则见《一对一交付标准》附则九：如实呈现、困难单列，不允许只展示积极信息）
  `CREATE TABLE IF NOT EXISTS parent_concerns(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    concern_date TEXT, title TEXT, body TEXT, action_text TEXT,
    created_at TEXT, updated_at TEXT)`,
  // 家长↔导师留言（与 student_messages 完全独立；sender: parent / mentor）
  `CREATE TABLE IF NOT EXISTS parent_messages(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    sender TEXT DEFAULT 'parent', body TEXT, created_at TEXT,
    read_by_parent INTEGER DEFAULT 0, read_by_mentor INTEGER DEFAULT 0)`,
  // ===== v12 新增表 =====
  // 问题方案层（学生逐项确认后同步的结构化字段；只存方案摘要，永不存日记/情绪原文）
  `CREATE TABLE IF NOT EXISTS student_problem_shares(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    domain TEXT, title TEXT, desired_outcome TEXT, strategy_summary TEXT,
    actions_text TEXT, support_needed TEXT, progress TEXT DEFAULT 'open',
    resolved_note TEXT, compliance TEXT DEFAULT 'ok', source_local_id TEXT,
    created_at TEXT, updated_at TEXT)`,
  // 导师轨迹 / 会议精神（与 student_meetings 1:1 关联，meeting_id 可空=学生自建或未关联会议；
  // takeaway_local=1 表示学生领受只存学生本机，服务器只留占位标记，正文永不入库）
  `CREATE TABLE IF NOT EXISTS mentor_trail_entries(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, meeting_id INTEGER,
    mentor_name TEXT, mentor_role TEXT DEFAULT 'lead', spirit_line TEXT,
    key_judgments TEXT, student_takeaway TEXT, takeaway_local INTEGER DEFAULT 0,
    followup_actions TEXT, revisit_result TEXT, revisit_due TEXT,
    visibility TEXT DEFAULT 'plan', source TEXT DEFAULT 'mentor',
    created_at TEXT, updated_at TEXT)`,
  // 课程要求集（一名学生可并排多份：本校 / 外部 / 备选情景；逐份标来源与版本，verified=已按官方核实）
  `CREATE TABLE IF NOT EXISTS course_requirement_sets(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    name TEXT, source_note TEXT, version_text TEXT, verified INTEGER DEFAULT 0,
    sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)`,
  // 课程要求条目（按块建模：gened 通识 / prereq 专业先修 / core 专业核心 / elective 选修；
  // credits 可空=来源未给单门学分，匹配时单列未知、绝不估算；prereq_codes 为逗号分隔的先修课程代码）
  `CREATE TABLE IF NOT EXISTS course_requirements(
    id INTEGER PRIMARY KEY AUTOINCREMENT, set_id INTEGER, student_id INTEGER,
    block TEXT DEFAULT 'prereq', course_code TEXT, course_name TEXT,
    credits REAL, min_grade TEXT, prereq_codes TEXT, sort INTEGER DEFAULT 0,
    created_at TEXT, updated_at TEXT)`,
  // ===== v13 新增表 =====
  // 给爸妈的一句话（学生主动分享通道）：只存学生经此通道主动发送的一句话 + 自选心情标签枚举。
  // 红线：本表不是日记/情绪原文通道——正文是学生写给家长看的一句话（自愿公开），feeling_tag 是学生
  // 自选的枚举标签（feeling_tag ≠ mood/emotion 原文）；私密层内容永不经此通道。withdrawn_at 非空 = 已撤回。
  `CREATE TABLE IF NOT EXISTS note_to_parents(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    body TEXT, feeling_tag TEXT, created_at TEXT, withdrawn_at TEXT)`,
  // 通知发件箱（只记元数据：收件导师/渠道/事件摘要/状态，不含任何私密正文）。
  // status: queued 待转达 / sent 已转达 / responded 导师已回复。queued 即「已生成待转达」，
  // 不等于已触达导师本人（口径见交付标准附则）；v16 起 email 渠道导师由系统自动发信，
  // 成功置 sent 且 auto_sent=1（迁移补列）。
  `CREATE TABLE IF NOT EXISTS notifications_outbox(
    id INTEGER PRIMARY KEY AUTOINCREMENT, mentor_staff_id INTEGER, student_id INTEGER,
    channel TEXT, event_type TEXT, summary TEXT, status TEXT DEFAULT 'queued',
    ref_type TEXT, ref_id INTEGER, created_at TEXT, updated_at TEXT)`,
  // 学生事件时间线（后台追踪 + 导师工作台同源）：只记方案层事件的 类型/时间/对象 id/一句摘要，
  // 私密层零服务器数据、永不进事件流（连标题都不记）。
  `CREATE TABLE IF NOT EXISTS student_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    event_type TEXT, object_id INTEGER, summary TEXT, created_at TEXT)`,
  // ===== v15 新增表：多导师——学生专题导师指派 =====
  // 主导师仍走 students.mentor_id（唯一、规划整合负责人、视图全量）；专题导师可多人，
  // 按 (student_id, staff_id) 唯一，一条指派一个专题（topic 自由文本，如「创业」）。
  // 专题导师视图按最小权限裁剪（只见本人线程与本人轨迹），口径见导师接口注释。
  `CREATE TABLE IF NOT EXISTS student_topic_mentors(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, staff_id INTEGER,
    topic TEXT, created_at TEXT, UNIQUE(student_id, staff_id))`,
  // ===== v16 新增表：邮件发送日志 =====
  // 系统自动邮件（Resend）的发送尝试记录，供失败排查。outbox_id 关联发件箱行
  // （通道测试邮件为 NULL）；status: sent / failed；只记收件地址与主题等元数据。
  `CREATE TABLE IF NOT EXISTS mail_log(
    id INTEGER PRIMARY KEY AUTOINCREMENT, outbox_id INTEGER,
    to_addr TEXT, subject TEXT, status TEXT, error TEXT, created_at TEXT)`,
  // ===== v17 新增表：导师文件一次性投递 =====
  // 导师给名下学生发文件（R2 存对象、本表存元数据）：status pending 待下载 /
  // downloaded 学生已下载（R2 对象已删）/ expired 满 24h 未下载自动清扫 /
  // withdrawn 导师下载前撤回。r2_key 为不可猜测随机串，不含学生/导师信息。
  `CREATE TABLE IF NOT EXISTS mentor_files(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
    uploader_staff_id INTEGER, r2_key TEXT, filename TEXT, content_type TEXT,
    size INTEGER DEFAULT 0, status TEXT DEFAULT 'pending',
    created_at TEXT, expires_at TEXT, downloaded_at TEXT)`,
];
// v10 迁移：students 补愿景（vision_text）与导师寄语（mentor_message / mentor_message_at）列，幂等

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
// v6 迁移：student_goals 补 school_system 列（学校体系标签，数据集字段），同样幂等
const GOAL_MIGRATIONS = [
  "ALTER TABLE student_goals ADD COLUMN school_system TEXT",
];
// v7 迁移：students 补 client_key 列（学生端 APP 只读访问密钥），同样幂等
// v8 迁移：students 补 slug 列（学生专属名，对外定位符）+ 唯一索引（NULL 不互斥，存量行安全），同样幂等
// v9 迁移：students 补 signature / signature_set_at 列（专属签名，学生本人在 APP 确认一次后固定），同样幂等
const STUDENT_MIGRATIONS = [
  "ALTER TABLE students ADD COLUMN client_key TEXT",
  "ALTER TABLE students ADD COLUMN slug TEXT",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_students_slug ON students(slug)",
  "ALTER TABLE students ADD COLUMN signature TEXT",
  "ALTER TABLE students ADD COLUMN signature_set_at TEXT",
  "ALTER TABLE students ADD COLUMN vision_text TEXT",
  "ALTER TABLE students ADD COLUMN mentor_message TEXT",
  "ALTER TABLE students ADD COLUMN mentor_message_at TEXT",
  // v11 迁移：students 补 parent_key 列（家长端独立密钥，与 client_key 分列），同样幂等
  "ALTER TABLE students ADD COLUMN parent_key TEXT",
  // v13 迁移：students 补 mentor_id（默认导师 = staff.id；未分配为 NULL），同样幂等
  "ALTER TABLE students ADD COLUMN mentor_id INTEGER",
];
// v13 迁移：staff 补导师注册字段（专长/三渠道联系方式/通知偏好/导师状态/工作台密钥），幂等
const STAFF_V13_MIGRATIONS = [
  "ALTER TABLE staff ADD COLUMN specialty TEXT",
  "ALTER TABLE staff ADD COLUMN contact_email TEXT",
  "ALTER TABLE staff ADD COLUMN contact_phone TEXT",
  "ALTER TABLE staff ADD COLUMN contact_wechat TEXT",
  "ALTER TABLE staff ADD COLUMN notify_channel TEXT",
  "ALTER TABLE staff ADD COLUMN mentor_status TEXT",
  "ALTER TABLE staff ADD COLUMN mentor_key TEXT",
];
// v13 迁移：关键日期补 kind（birthday 生日 / deadline 截止 / exam 考试 / other 其他），幂等
const KEYDATE_MIGRATIONS = [
  "ALTER TABLE student_key_dates ADD COLUMN kind TEXT",
];
// v13 迁移：学生留言补 mentor_id（目标导师 staff.id；存量/未分配导师为 NULL），幂等
// v13.3 迁移：学生留言补 category（类型标记；当前只用 data_correction=课程数据纠错，其余为 NULL），幂等
const MESSAGE_MIGRATIONS = [
  "ALTER TABLE student_messages ADD COLUMN mentor_id INTEGER",
  "ALTER TABLE student_messages ADD COLUMN category TEXT",
];
// v16 迁移：发件箱补 auto_sent（1 = 系统邮件自动发送置 sent，区别于创始人手动标记），同样幂等
const OUTBOX_MIGRATIONS = [
  "ALTER TABLE notifications_outbox ADD COLUMN auto_sent INTEGER DEFAULT 0",
];
let schemaReady = false;
/* —— 性能优化（2026-10-22）：ensureSchema 快速通道 ——
 * 原实现每个冷 isolate 串行执行全部 69 条建表/迁移语句（35 DDL + 34 迁移），
 * 每条一次 D1 往返，是公开接口冷启动慢的主因。快速通道先用 1 条查询读取
 * sqlite_master（表名 + 建表 SQL + 索引名），本地判断哪些语句已经生效、只补跑
 * 缺失的；稳态下（生产库已全量建好）冷启动只剩 1 条探测查询。
 * 语义与原实现严格等价：DDL 失败仍抛 ensureSchema DDL#i、迁移失败仍逐条吞掉；
 * 解析不出或探测失败的语句一律按「未生效」处理、照原样执行；探测整体异常时
 * 回退到原始全量串行路径（runSchemaFull），保证任何异常环境下行为不变。 */
const MIGRATION_GROUPS = () => [
  STAFF_MIGRATIONS, TASK_MIGRATIONS, LEAD_MIGRATIONS, CONTENT_MIGRATIONS,
  GOAL_MIGRATIONS, STUDENT_MIGRATIONS, STAFF_V13_MIGRATIONS, KEYDATE_MIGRATIONS,
  MESSAGE_MIGRATIONS, OUTBOX_MIGRATIONS,
];
function schemaStmtDone(sql, tables, indexes) {
  const alt = sql.match(/ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+ADD\s+COLUMN\s+([A-Za-z0-9_]+)/i);
  if (alt) {
    const tableSql = tables.get(alt[1]);
    if (tableSql === undefined) return false;
    return new RegExp("\\b" + alt[2] + "\\b", "i").test(tableSql);
  }
  const idx = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)/i);
  if (idx) return indexes.has(idx[1]);
  return false;
}
async function runSchemaFull(db) {
  for (let i = 0; i < DDL.length; i++) {
    try { await db.prepare(DDL[i]).run(); }
    catch (e) { throw new Error("ensureSchema DDL#" + i + ": " + (e && e.message ? e.message : String(e))); }
  }
  for (const group of MIGRATION_GROUPS()) {
    for (const sql of group) {
      try { await db.prepare(sql).run(); } catch (e) { /* 列已存在，幂等忽略 */ }
    }
  }
}
async function ensureSchema(db) {
  if (schemaReady || !db) return;
  try {
    const probe = (await db.prepare(
      `SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index')`).all()).results || [];
    const tables = new Map();
    const indexes = new Set();
    for (const r of probe) {
      if (r.type === "table") tables.set(String(r.name), String(r.sql || ""));
      else if (r.type === "index") indexes.add(String(r.name));
    }
    if (!tables.size) throw new Error("schema probe empty");
    for (let i = 0; i < DDL.length; i++) {
      const m = DDL[i].match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)/i);
      if (m && tables.has(m[1])) continue;
      try { await db.prepare(DDL[i]).run(); }
      catch (e) { throw new Error("ensureSchema DDL#" + i + ": " + (e && e.message ? e.message : String(e))); }
    }
    for (const group of MIGRATION_GROUPS()) {
      for (const sql of group) {
        if (schemaStmtDone(sql, tables, indexes)) continue;
        try { await db.prepare(sql).run(); } catch (e) { /* 列已存在，幂等忽略 */ }
      }
    }
  } catch (e) {
    if (e && /^ensureSchema DDL#/.test(e.message || "")) throw e;
    await runSchemaFull(db);
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
async function handleApi(req, env, url, ctx) {
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
    /* v18 线索提醒（旁路）：入库成功后给 leads@ 发一封通知；发信成败只记 mail_log，
     * 绝不影响线索入库与前端返回。 */
    try {
      const subj = "新线索：" + name + (source ? "（" + source + "）" : "");
      const txt = "新线索 #" + r.meta.last_row_id + "\n姓名：" + name + "\n微信：" + (wechat || "—") + "\n电话：" + (phone || "—") + "\n来源：" + source + (ref ? "\n推荐码：" + ref : "") + (eval_summary ? "\n测评摘要：" + eval_summary : "") + (note ? "\n备注：" + note : "") + "\n时间：" + nowIso();
      const mr = await sendResendMail(env, LEAD_NOTIFY_TO, subj, txt, null);
      if (!mr.skipped) await logMailRow(db, null, LEAD_NOTIFY_TO, subj, mr.ok ? "sent" : "failed", mr.ok ? null : mr.error);
    } catch (e) { /* 提醒旁路，忽略 */ }
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
    // v13：导师通知发件箱计数（供创始人每日简报引用；queued = 待创始人按登记联系方式转达，不等于已触达）
    const outboxRows = (await db.prepare(
      `SELECT status, COUNT(*) AS n FROM notifications_outbox GROUP BY status`).all()).results || [];
    const outboxCounts = { queued: 0, sent: 0, responded: 0 };
    for (const r of outboxRows) if (r.status in outboxCounts) outboxCounts[r.status] = r.n;
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
      outbox: outboxCounts,
    });
  }

  // v16：系统邮件通道实测入口（后台登录会话鉴权，非 Bearer；与自动通知共用同一发信模块）。
  // body { to } → 发一封通道测试邮件，返回 Resend 的 id 或错误；未配 RESEND_API_KEY 时
  // 明确返回 mail_not_configured，不静默成功。发送结果同步记 mail_log（outbox_id 为 NULL）。
  if (p === "/api/admin/mail/test") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    if (!(await isAuthed(req, env))) return jsonResp(req, { ok: false, error: "unauthorized" }, 401);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    const to = clampStr(body && body.to, 120);
    if (!EMAIL_RE.test(to)) return jsonResp(req, { ok: false, error: "bad email" }, 400);
    if (!env.RESEND_API_KEY) return jsonResp(req, { ok: false, error: "mail_not_configured" }, 503);
    await ensureSchema(db);
    const ts = nowIso();
    const subject = "【TransferOS】系统邮件通道测试";
    const text = [
      "这是一封系统邮件通道测试邮件，由 TransferOS 后台发出，用于验证自动通知邮件能否送达。",
      "时间：" + ts,
      "",
      "收到本邮件即表示邮件通道已打通，无需回复。",
      "",
      "— TransferOS",
    ].join("\n");
    const html = "<div style=\"font-family:sans-serif;font-size:14px;line-height:1.7;color:#222\">"
      + "<p>这是一封系统邮件通道测试邮件，由 TransferOS 后台发出，用于验证自动通知邮件能否送达。</p>"
      + "<p>时间：" + esc(ts) + "</p>"
      + "<p>收到本邮件即表示邮件通道已打通，无需回复。</p>"
      + "<p>— TransferOS</p></div>";
    const r = await sendResendMail(env, to, subject, text, html);
    await logMailRow(db, null, to, subject, r.ok ? "sent" : "failed", r.ok ? null : r.error);
    if (!r.ok) return jsonResp(req, { ok: false, error: r.error || "send failed" }, 502);
    return jsonResp(req, { ok: true, id: r.id, to });
  }

  // 2026-10-24 后台手动发信接口（导师通知统一走 info@ 的手动通道）。
  // POST /api/admin/mail/send { to, subject, text }：经 Resend 从 MAIL_FROM
  // （默认 info@）发出一封纯文本邮件并记 mail_log。鉴权：管理员登录态或
  // Bearer 令牌二选一；单收件人、正文上限 5000 字，防批量滥用。
  if (p === "/api/admin/mail/send") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    const bearer = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const authed = (await isAuthed(req, env)) || (env.LEAD_API_TOKEN && bearer && timingSafeEq(bearer, env.LEAD_API_TOKEN));
    if (!authed) return jsonResp(req, { ok: false, error: "unauthorized" }, 401);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    const to = clampStr(body && body.to, 120);
    if (!EMAIL_RE.test(to)) return jsonResp(req, { ok: false, error: "bad email" }, 400);
    const subject = clampStr(body && body.subject, 200);
    if (!subject) return jsonResp(req, { ok: false, error: "subject required" }, 400);
    const text = clampStr(body && body.text, 5000);
    if (!text) return jsonResp(req, { ok: false, error: "text required" }, 400);
    if (!env.RESEND_API_KEY) return jsonResp(req, { ok: false, error: "mail_not_configured" }, 503);
    await ensureSchema(db);
    const r = await sendResendMail(env, to, subject, text, null);
    await logMailRow(db, null, to, subject, r.ok ? "sent" : "failed", r.ok ? null : r.error);
    if (!r.ok) return jsonResp(req, { ok: false, error: r.error || "send failed" }, 502);
    return jsonResp(req, { ok: true, id: r.id, to });
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

  // 学生端专属签名设置（v9，一对一 APP 唯一写接口）：POST /api/client/signature
  // 请求体 { s: <学生id 或 slug>, key: <访问密钥>, signature: <签名> }。校验口径与只读接口一致：
  // 学生不存在 / 无 key / key 不对一律 404，不暴露学生存在性。仅当 signature 为空时可设置，
  // 已设置再调用返回 409（改签名只能由导师在后台改）；签名 trim 后须非空且 ≤30 字，非法整单 400。
  if (p === "/api/client/signature") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const locator = String((body && body.s) || "").trim();
    const student = /^\d+$/.test(locator)
      ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(parseInt(locator, 10)).first()
      : (locator ? await db.prepare(`SELECT * FROM students WHERE slug = ?`).bind(locator).first() : null);
    const key = String((body && body.key) || "");
    if (!student || !student.client_key || !timingSafeEq(key, String(student.client_key))) {
      return jsonResp(req, { ok: false, error: "not found" }, 404);
    }
    const sig = String((body && body.signature) || "").trim();
    if (!sig) return jsonResp(req, { ok: false, error: "signature required" }, 400);
    if ([...sig].length > 30) return jsonResp(req, { ok: false, error: "signature too long (max 30)" }, 400);
    if (student.signature && String(student.signature).trim() !== "") {
      return jsonResp(req, { ok: false, error: "signature already set", signature: student.signature }, 409);
    }
    const ts = nowIso();
    await db.prepare(
      `UPDATE students SET signature = ?, signature_set_at = ?, updated_at = ? WHERE id = ? AND (signature IS NULL OR signature = '')`
    ).bind(sig, ts, ts, student.id).run();
    return jsonResp(req, { ok: true, signature: sig, signature_set_at: ts });
  }

  // 学生端导师沟通留言（v10，一对一 APP 第二个写接口）：POST /api/client/message
  // 请求体 { s: <学生id 或 slug>, key: <访问密钥>, body: <留言正文> }。校验口径与只读/签名接口一致：
  // 学生不存在 / 无 key / key 不对一律 404；正文 trim 后须非空且 ≤500 字，非法 400；
  // 防刷：同一学生 60 秒内最多 3 条，超限 429。落库 sender='student'，导师侧未读。
  if (p === "/api/client/message") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const locator = String((body && body.s) || "").trim();
    const student = /^\d+$/.test(locator)
      ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(parseInt(locator, 10)).first()
      : (locator ? await db.prepare(`SELECT * FROM students WHERE slug = ?`).bind(locator).first() : null);
    const key = String((body && body.key) || "");
    if (!student || !student.client_key || !timingSafeEq(key, String(student.client_key))) {
      return jsonResp(req, { ok: false, error: "not found" }, 404);
    }
    const text = String((body && body.body) || "").trim();
    if (!text) return jsonResp(req, { ok: false, error: "message required" }, 400);
    if ([...text].length > MESSAGE_MAX_LEN) {
      return jsonResp(req, { ok: false, error: "message too long (max " + MESSAGE_MAX_LEN + ")" }, 400);
    }
    // v13.3：类型标记走白名单——只认 data_correction（课程数据纠错），其余取值一律不落（当普通留言）；
    // course_code 仅纠错时读取，清洗为大写字母/数字/空格/点/连字符、≤24 字，不合规直接丢弃（不报错）；
    // 请求体里其他字段（成绩、考试、关键日期、私密类字段等）一概不读、不存、不回传。
    const category = String((body && body.category) || "") === "data_correction" ? "data_correction" : null;
    let courseCode = "";
    if (category) {
      const rawCode = String((body && body.course_code) || "").trim().toUpperCase().slice(0, 24);
      if (/^[A-Z0-9][A-Z0-9 .\-]*$/.test(rawCode)) courseCode = rawCode;
    }
    const storedBody = courseCode ? "课程 " + courseCode + "：" + text : text;
    // v13：留言必须有主——学生已分配默认导师时，目标导师必须已注册且可通知；
    // 指向未注册/不可通知导师 → 明确 409，不落库、不进无主收件箱。
    // 未分配导师（存量学生）沿用旧口径落库（mentor_id 为 NULL、无发件箱），后台补分配后即纳入通知链。
    // v15：学生可指定收件导师（body.mentor_id = staff.id）——主导师或已指派的专题导师；
    // 指定未指派/不存在的导师 → 400，不落库；未指定时沿用 v13 口径（默认主导师）。
    // 发件箱随所选导师走（下方 pushOutbox 用解析出的 mentor），专题导师只收到发给自己的留言通知。
    let mentor = null;
    const wantMentorId = toInt(body && body.mentor_id, 0);
    if (wantMentorId) {
      if (student.mentor_id && wantMentorId === Number(student.mentor_id)) {
        mentor = await resolveStudentMentor(db, student);
      } else {
        const asg = await db.prepare(
          `SELECT * FROM student_topic_mentors WHERE student_id = ? AND staff_id = ?`
        ).bind(student.id, wantMentorId).first();
        if (!asg) return jsonResp(req, { ok: false, error: "bad mentor_id" }, 400);
        mentor = await db.prepare(`SELECT * FROM staff WHERE id = ?`).bind(wantMentorId).first();
      }
      if (!mentorNotifiable(mentor)) {
        return jsonResp(req, { ok: false, error: "mentor_not_notifiable" }, 409);
      }
    } else if (student.mentor_id) {
      mentor = await resolveStudentMentor(db, student);
      if (!mentorNotifiable(mentor)) {
        return jsonResp(req, { ok: false, error: "mentor_not_notifiable" }, 409);
      }
    }
    const since = new Date(Date.now() - MESSAGE_RATE_WINDOW_MS).toISOString();
    const recent = await db.prepare(
      `SELECT COUNT(*) AS n FROM student_messages WHERE student_id = ? AND sender = 'student' AND created_at >= ?`
    ).bind(student.id, since).first();
    if (recent && recent.n >= MESSAGE_RATE_LIMIT) {
      return jsonResp(req, { ok: false, error: "too frequent, retry in a minute" }, 429);
    }
    const ts = nowIso();
    const r = await db.prepare(
      `INSERT INTO student_messages(student_id, sender, body, created_at, read_by_student, read_by_mentor, mentor_id, category)
       VALUES(?, 'student', ?, ?, 1, 0, ?, ?)`
    ).bind(student.id, storedBody, ts, mentor ? mentor.id : null, category).run();
    await logEvent(db, student.id, "message_student", r.meta.last_row_id,
      category ? "学生提交课程数据纠错" : "学生给导师留言");
    if (mentor) {
      await pushOutbox(env, db, mentor, student.id, "student_message",
        (student.name || "学生") + (category ? " 提交了一条课程数据纠错" : " 发来一条留言"), "message", r.meta.last_row_id);
    }
    return jsonResp(req, {
      ok: true,
      message: { id: r.meta.last_row_id, sender: "student", body: storedBody, created_at: ts, category: category || "", mentor_id: mentor ? mentor.id : null },
    });
  }

  // ===== v12 新增写接口（方案层同步 / 导师轨迹学生侧）=====
  // 共同口径：与留言接口同一鉴权（定位符 + client_key 常量时间比对，失败一律 404）；
  // 字段全部走白名单归一——请求体里夹带的 diary / journal / mood / emotion 等私密字段不读、不存、不回传。
  const findClientStudent = async (body) => {
    const locator = String((body && body.s) || "").trim();
    const student = /^\d+$/.test(locator)
      ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(parseInt(locator, 10)).first()
      : (locator ? await db.prepare(`SELECT * FROM students WHERE slug = ?`).bind(locator).first() : null);
    const key = String((body && body.key) || "");
    if (!student || !student.client_key || !timingSafeEq(key, String(student.client_key))) return null;
    return student;
  };
  const problemOut = (r) => ({
    id: r.id, domain: r.domain || "", domain_label: PROBLEM_DOMAINS[r.domain] || r.domain || "",
    title: r.title || "", desired_outcome: r.desired_outcome || "",
    strategy_summary: r.strategy_summary || "",
    actions: String(r.actions_text || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
    support_needed: r.support_needed || "", progress: r.progress || "open",
    progress_label: PROBLEM_PROGRESS[r.progress] || r.progress || "",
    resolved_note: r.resolved_note || "", compliance: r.compliance || "ok",
    created_at: r.created_at || "", updated_at: r.updated_at || "",
  });
  // 问题方案同步（阶段 C）：学生逐项确认后才调用；同步的是方案摘要结构化字段，不是日记原文。
  // 合规标记由服务端按关键词表复算（complianceFlag），客户端传什么都不采信。
  if (p === "/api/client/problem") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const student = await findClientStudent(body);
    if (!student) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const norm = normProblemInput(body);
    if (norm.error) return jsonResp(req, { ok: false, error: norm.error }, 400);
    const since = new Date(Date.now() - MESSAGE_RATE_WINDOW_MS).toISOString();
    const recent = await db.prepare(
      `SELECT COUNT(*) AS n FROM student_problem_shares WHERE student_id = ? AND created_at >= ?`
    ).bind(student.id, since).first();
    if (recent && recent.n >= PROBLEM_RATE_LIMIT) {
      return jsonResp(req, { ok: false, error: "too frequent, retry in a minute" }, 429);
    }
    // 同步留痕去重：同一本地条目重复提交（source_local_id 相同）直接回既有记录，不重复落库
    if (norm.source_local_id) {
      const dup = await db.prepare(
        `SELECT * FROM student_problem_shares WHERE student_id = ? AND source_local_id = ?`
      ).bind(student.id, norm.source_local_id).first();
      if (dup) return jsonResp(req, { ok: true, problem: problemOut(dup), existed: true });
    }
    const ts = nowIso();
    const actionsText = norm.actions.map((a) => a.title + (a.due_text ? "（" + a.due_text + "）" : "")).join("\n");
    const flag = complianceFlag(norm.title + "\n" + norm.desired_outcome + "\n" + norm.strategy_summary + "\n" + norm.support_needed);
    const r = await db.prepare(
      `INSERT INTO student_problem_shares(student_id, domain, title, desired_outcome, strategy_summary,
        actions_text, support_needed, progress, resolved_note, compliance, source_local_id, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,'open','',?,?,?,?)`
    ).bind(student.id, norm.domain, norm.title, norm.desired_outcome, norm.strategy_summary,
      actionsText, norm.support_needed, flag, norm.source_local_id, ts, ts).run();
    const row = await db.prepare(`SELECT * FROM student_problem_shares WHERE id = ?`).bind(r.meta.last_row_id).first();
    await logEvent(db, student.id, "problem_opened", r.meta.last_row_id, "提出问题：" + norm.title);
    return jsonResp(req, { ok: true, problem: problemOut(row) });
  }
  // 问题进度回写（阶段 C）：学生把某个已同步问题标为推进中 / 已解决 / 已升级导师；resolved 时可附解决小结。
  if (p === "/api/client/problem/status") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const student = await findClientStudent(body);
    if (!student) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const pid = toInt(body && body.id, 0);
    const progress = String((body && body.progress) || "");
    if (!pid || !PROBLEM_PROGRESS[progress]) return jsonResp(req, { ok: false, error: "bad progress" }, 400);
    const row = await db.prepare(
      `SELECT * FROM student_problem_shares WHERE id = ? AND student_id = ?`).bind(pid, student.id).first();
    if (!row) return jsonResp(req, { ok: false, error: "not found" }, 404);
    // v13：升级导师必须有主——已分配导师但未注册/不可通知 → 明确 409，不改状态、不落无主收件箱。
    let mentor = null;
    if (progress === "escalated" && student.mentor_id) {
      mentor = await resolveStudentMentor(db, student);
      if (!mentorNotifiable(mentor)) {
        return jsonResp(req, { ok: false, error: "mentor_not_notifiable" }, 409);
      }
    }
    const note = progress === "resolved" ? clampStr(body.resolved_note, 500) : (row.resolved_note || "");
    await db.prepare(
      `UPDATE student_problem_shares SET progress = ?, resolved_note = ?, updated_at = ? WHERE id = ?`
    ).bind(progress, note, nowIso(), pid).run();
    if (progress === "resolved" && row.progress !== "resolved") {
      await logEvent(db, student.id, "problem_resolved", pid, "问题解决：" + (row.title || ""));
    }
    if (progress === "escalated" && row.progress !== "escalated") {
      await logEvent(db, student.id, "problem_escalated", pid, "问题升级导师：" + (row.title || ""));
      if (mentor) {
        await pushOutbox(env, db, mentor, student.id, "problem_escalated",
          (student.name || "学生") + " 把问题升级给你：" + (row.title || ""), "problem", pid);
      }
    }
    const upd = await db.prepare(`SELECT * FROM student_problem_shares WHERE id = ?`).bind(pid).first();
    return jsonResp(req, { ok: true, problem: problemOut(upd) });
  }
  // 导师轨迹学生侧（阶段 C）：三种动作——
  //   action=create：学生为校外导师自建一条（source='student'，visibility='mentor'）；
  //   action=takeaway：给既有条目补学生领受；takeaway_local=1 时正文只存学生本机，服务器只留占位标记、正文清空；
  //   action=revisit：补下次回看结果。
  // 私密口径：takeaway_local 的正文永远不会出现在请求里——前端勾选本机保存时根本不发送正文。
  if (p === "/api/client/trail") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const student = await findClientStudent(body);
    if (!student) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const act = String((body && body.action) || "");
    const ts = nowIso();
    if (act === "create") {
      const norm = normTrailExtras({ trail_entries: [{
        meeting_id: body.meeting_id, mentor_name: body.mentor_name, mentor_role: body.mentor_role,
        spirit_line: body.spirit_line, key_judgments: body.key_judgments,
        student_takeaway: body.student_takeaway, takeaway_local: body.takeaway_local,
        followup_actions: body.followup_actions, revisit_due: body.revisit_due,
        visibility: "mentor", source: "student",
      }] });
      if (norm.error) return jsonResp(req, { ok: false, error: norm.error }, 400);
      const e = norm.trail[0];
      const since = new Date(Date.now() - MESSAGE_RATE_WINDOW_MS).toISOString();
      const recent = await db.prepare(
        `SELECT COUNT(*) AS n FROM mentor_trail_entries WHERE student_id = ? AND created_at >= ?`
      ).bind(student.id, since).first();
      if (recent && recent.n >= PROBLEM_RATE_LIMIT) {
        return jsonResp(req, { ok: false, error: "too frequent, retry in a minute" }, 429);
      }
      const due = e.revisit_due || new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      const r = await db.prepare(
        `INSERT INTO mentor_trail_entries(student_id, meeting_id, mentor_name, mentor_role, spirit_line,
          key_judgments, student_takeaway, takeaway_local, followup_actions, revisit_result, revisit_due,
          visibility, source, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,'',?, 'mentor', 'student', ?, ?)`
      ).bind(student.id, e.meeting_id, e.mentor_name, e.mentor_role, e.spirit_line, e.key_judgments,
        e.takeaway_local ? null : (e.student_takeaway || null), e.takeaway_local, e.followup_actions,
        due, ts, ts).run();
      await insertTrailFollowups(db, student.id, e.followup_actions, ts);
      // v13：轨迹新增记事件流；待回看生成导师通知（已分配且可通知时）
      await logEvent(db, student.id, "trail_created", r.meta.last_row_id,
        "导师轨迹新增：" + (e.spirit_line || e.mentor_name || ""));
      if (student.mentor_id) {
        const mentor = await resolveStudentMentor(db, student);
        if (mentorNotifiable(mentor)) {
          await pushOutbox(env, db, mentor, student.id, "trail_revisit",
            (student.name || "学生") + " 新增导师轨迹待回看：" + (e.spirit_line || e.mentor_name || ""), "trail", r.meta.last_row_id);
        }
      }
      return jsonResp(req, { ok: true, id: r.meta.last_row_id });
    }
    if (act === "takeaway" || act === "revisit") {
      const eid = toInt(body && body.id, 0);
      const row = eid ? await db.prepare(
        `SELECT * FROM mentor_trail_entries WHERE id = ? AND student_id = ?`).bind(eid, student.id).first() : null;
      if (!row) return jsonResp(req, { ok: false, error: "not found" }, 404);
      if (act === "takeaway") {
        if (body.takeaway_local) {
          await db.prepare(
            `UPDATE mentor_trail_entries SET student_takeaway = NULL, takeaway_local = 1, updated_at = ? WHERE id = ?`
          ).bind(ts, eid).run();
        } else {
          const text = clampStr(body.takeaway, 2000);
          await db.prepare(
            `UPDATE mentor_trail_entries SET student_takeaway = ?, takeaway_local = 0, updated_at = ? WHERE id = ?`
          ).bind(text || null, ts, eid).run();
        }
      } else {
        const text = clampStr(body.revisit_result, 2000);
        if (!text) return jsonResp(req, { ok: false, error: "revisit_result required" }, 400);
        await db.prepare(
          `UPDATE mentor_trail_entries SET revisit_result = ?, updated_at = ? WHERE id = ?`
        ).bind(text, ts, eid).run();
      }
      return jsonResp(req, { ok: true, id: eid });
    }
    return jsonResp(req, { ok: false, error: "bad action" }, 400);
  }

  // ===== v13 新增：给爸妈的一句话（学生主动分享通道）=====
  // POST /api/client/parent-note { s, key, body, feeling_tag? }：学生主动写一句话给家长，
  // 可附一个自选心情标签（FEELING_TAGS 枚举）。只存经此通道主动发送的内容；
  // 私密层/日记/原始留言永不经此通道——请求体夹带的 diary/journal/mood/emotion 字段不读不存不回传
  // （feeling_tag 是学生自选的枚举展示标签，不是情绪原文，见 FEELING_TAGS 上方口径注释）。
  // 家长 key 对此通道只读：本接口只认 client_key，拿 parent_key 来写一律 404。
  if (p === "/api/client/parent-note") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const student = await findClientStudent(body);
    if (!student) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const text = String((body && body.body) || "").trim();
    if (!text) return jsonResp(req, { ok: false, error: "note required" }, 400);
    if ([...text].length > PARENT_NOTE_MAX_LEN) {
      return jsonResp(req, { ok: false, error: "note too long (max " + PARENT_NOTE_MAX_LEN + ")" }, 400);
    }
    let tag = String((body && body.feeling_tag) || "");
    if (tag && !FEELING_TAGS[tag]) return jsonResp(req, { ok: false, error: "bad feeling_tag" }, 400);
    if (!tag) tag = null;
    const since = new Date(Date.now() - MESSAGE_RATE_WINDOW_MS).toISOString();
    const recent = await db.prepare(
      `SELECT COUNT(*) AS n FROM note_to_parents WHERE student_id = ? AND created_at >= ?`
    ).bind(student.id, since).first();
    if (recent && recent.n >= PARENT_NOTE_RATE_LIMIT) {
      return jsonResp(req, { ok: false, error: "too frequent, retry in a minute" }, 429);
    }
    const ts = nowIso();
    const r = await db.prepare(
      `INSERT INTO note_to_parents(student_id, body, feeling_tag, created_at, withdrawn_at) VALUES(?,?,?, ?, NULL)`
    ).bind(student.id, text, tag, ts).run();
    await logEvent(db, student.id, "parent_note_sent", r.meta.last_row_id, "给爸妈的一句话已推送");
    return jsonResp(req, {
      ok: true,
      note: { id: r.meta.last_row_id, body: text, feeling_tag: tag || "", feeling_tag_label: tag ? FEELING_TAGS[tag] : "", created_at: ts },
    });
  }
  // POST /api/client/parent-note/withdraw { s, key, id }：学生撤回自己发的一句话（软删除，
  // withdrawn_at 置时；家长端与学生端列表都不再展示）。只能撤自己的、未撤回的条目。
  if (p === "/api/client/parent-note/withdraw") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const student = await findClientStudent(body);
    if (!student) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const nid = toInt(body && body.id, 0);
    const row = nid ? await db.prepare(
      `SELECT * FROM note_to_parents WHERE id = ? AND student_id = ?`).bind(nid, student.id).first() : null;
    if (!row || row.withdrawn_at) return jsonResp(req, { ok: false, error: "not found" }, 404);
    await db.prepare(
      `UPDATE note_to_parents SET withdrawn_at = ? WHERE id = ?`).bind(nowIso(), nid).run();
    await logEvent(db, student.id, "parent_note_withdrawn", nid, "撤回给爸妈的一句话");
    return jsonResp(req, { ok: true, id: nid });
  }

  // 学生端只读接口（v7，一对一专属客户端 APP 专用；v8 起定位符同时支持 slug）：
  // GET /api/client/<学生id 或 slug>?key=<访问密钥>。密钥为 students.client_key（每名学生一个随机密钥），
  // 无 key / key 不对 / 学生不存在一律 404，不暴露学生存在性。写入仅限上方 v9 签名接口，其余只读。
  // 返回六块数据，选课分组与汇总复用 groupCoursesByTerm / courseProgress，与后台客户端页同口径。
  // 个性化 manifest（v14.1）：GET /api/manifest/client/<id 或 slug>?key=<学生密钥> /
  // GET /api/manifest/parent/<id 或 slug>?key=<家长密钥>。
  // 解决「添加到主屏幕后点图标落到门页」：静态 manifest 的 start_url 不带凭据，图标按
  // start_url 打开、独立应用存储又与浏览器不互通，本机记住的密钥读不到。前端带凭据
  // 打开时把 <link rel="manifest"> 换成本端点，本端点校验通过才发 manifest，其
  // start_url = 该生带完整凭据的页面 URL，装到桌面后点图标直达本人页面。
  // 鉴权口径与 /api/client、/api/parent 完全一致（locator 按 id 或 slug 定位、
  // client_key / parent_key 分列、timingSafeEq 常量时间比对、交叉与错钥一律 404，
  // 不暴露学生存在性）；字段与静态 manifest.json / manifest-parent.json 逐项一致，
  // 仅 start_url / scope / icons 改为绝对 URL（manifest 位于 Worker 域名下，必须绝对化）。
  // 密钥只回填请求所带且已校验通过的那把，密钥轮换后打开新链接即生成新 manifest。
  const manifestApiMatch = p.match(/^\/api\/manifest\/(client|parent)\/([A-Za-z0-9][A-Za-z0-9-]*)$/);
  if (manifestApiMatch) {
    if (req.method !== "GET") return jsonResp(req, { ok: false, error: "method" }, 405);
    await ensureSchema(db);
    const kind = manifestApiMatch[1];
    const locator = manifestApiMatch[2];
    const student = /^\d+$/.test(locator)
      ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(parseInt(locator, 10)).first()
      : await db.prepare(`SELECT * FROM students WHERE slug = ?`).bind(locator).first();
    const key = url.searchParams.get("key") || "";
    const storedKey = student ? (kind === "parent" ? student.parent_key : student.client_key) : null;
    if (!student || !storedKey || !timingSafeEq(key, String(storedKey))) {
      return jsonResp(req, { ok: false, error: "not found" }, 404);
    }
    const isParent = kind === "parent";
    const startUrl = isParent
      ? APP_BASE_URL + "/parent.html?s=" + encodeURIComponent(locator) + "&p=" + encodeURIComponent(key)
      : APP_BASE_URL + "/?s=" + encodeURIComponent(locator) + "&k=" + encodeURIComponent(key);
    const manifest = {
      name: isParent ? "家长更新" : "一对一专属客户端",
      short_name: isParent ? "家长更新" : "专属客户端",
      description: isParent
        ? "一对一辅导家长端：导师整理的阶段进展、成就与重要日期。"
        : "一对一辅导专属客户端：目标、状态、考试、选课与辅导会议。",
      lang: "zh-CN",
      display: "standalone",
      background_color: "#f6f6f1",
      theme_color: "#16453a",
      scope: APP_BASE_URL + "/",
      start_url: startUrl,
      icons: [
        { purpose: "any", sizes: "any", src: APP_BASE_URL + "/icon.svg", type: "image/svg+xml" },
        { purpose: "any", sizes: "192x192", src: APP_BASE_URL + "/icon-192.png", type: "image/png" },
        { purpose: "any", sizes: "512x512", src: APP_BASE_URL + "/icon-512.png", type: "image/png" },
        { purpose: "maskable", sizes: "512x512", src: APP_BASE_URL + "/icon-512.png", type: "image/png" },
      ],
    };
    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "no-store",
        ...corsHeaders(req),
      },
    });
  }

  // 学生端「家长看到的是什么」只读预览（v13.4）：GET /api/client/parent-preview?s=<slug 或 id>&key=<学生密钥>。
  // 用学生密钥鉴权（与学生端其它接口同一口径：无 key / key 不对 / 学生不存在一律 404）；
  // 返回内容 = 家长页实际载荷的展示区块，与 GET /api/parent 共用 parentViewSections 构建、
  // 字段逐键一致；不含家长↔导师留言与未读数（家长写给导师的沟通不在家长页展示给学生的
  // 预览范围），且纯读、无任何已读标记等副作用。严重问题另走单独沟通流程（交付标准附则九）。
  // 注意：本精确路径必须排在下面 /api/client/<locator> 正则之前，否则会被当作 slug 吞掉。
  if (p === "/api/client/parent-preview") {
    if (req.method !== "GET") return jsonResp(req, { ok: false, error: "method" }, 405);
    await ensureSchema(db);
    const locator = url.searchParams.get("s") || "";
    const student = /^\d+$/.test(locator)
      ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(parseInt(locator, 10)).first()
      : await db.prepare(`SELECT * FROM students WHERE slug = ?`).bind(locator).first();
    const key = url.searchParams.get("key") || "";
    if (!student || !student.client_key || !timingSafeEq(key, String(student.client_key))) {
      return jsonResp(req, { ok: false, error: "not found" }, 404);
    }
    const view = await parentViewSections(db, student);
    return jsonResp(req, { ok: true, ...view });
  }

  /* ===== v17 学生端文件：GET /api/client/files（本人待下载列表，不给直链）与
   * GET /api/client/file/download?id=（一次性下载）=====
   * 精确路径同样必须排在下面 /api/client/<locator> 正则之前。鉴权与学生端其它
   * 接口同一口径（locator + client_key 常量时间比对，未授权一律 404，不暴露
   * 学生是否存在）。列表主体为 pending 文件；另附近 48h 内刚置 expired 的文件
   * （仅供前端显示「已过期」，其 R2 对象已删除、不可下载）。downloaded/withdrawn
   * 不下发。下载：归属校验后非 pending 一律 410；pending 但已过期 → 当场清扫
   * 并 410（与 scheduled 清扫双保险）；成功则流式返回，响应交出后经 ctx.waitUntil
   * 删除 R2 对象并置 downloaded + downloaded_at（同一文件不可二次下载）。 */
  if (p === "/api/client/files" || p === "/api/client/file/download") {
    if (req.method !== "GET") return jsonResp(req, { ok: false, error: "method" }, 405);
    await ensureSchema(db);
    const locator = url.searchParams.get("s") || "";
    const student = /^\d+$/.test(locator)
      ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(parseInt(locator, 10)).first()
      : await db.prepare(`SELECT * FROM students WHERE slug = ?`).bind(locator).first();
    const key = url.searchParams.get("key") || "";
    if (!student || !student.client_key || !timingSafeEq(key, String(student.client_key))) {
      return jsonResp(req, { ok: false, error: "not found" }, 404);
    }
    if (p === "/api/client/files") {
      await sweepExpiredMentorFiles(env, db, student.id);
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const rows = (await db.prepare(
        `SELECT f.*, s.name AS mentor_name FROM mentor_files f
         LEFT JOIN staff s ON s.id = f.uploader_staff_id
         WHERE f.student_id = ? AND (f.status = 'pending' OR (f.status = 'expired' AND f.expires_at >= ?))
         ORDER BY f.id DESC LIMIT 50`).bind(student.id, since).all()).results || [];
      return jsonResp(req, { ok: true, files: rows.map((r) => mentorFileView(r, { mentor_name: r.mentor_name || "" })) });
    }
    const fid = toInt(url.searchParams.get("id"), 0);
    const row = fid ? await db.prepare(
      `SELECT * FROM mentor_files WHERE id = ? AND student_id = ?`).bind(fid, student.id).first() : null;
    if (!row) return jsonResp(req, { ok: false, error: "not found" }, 404);
    if (row.status !== "pending") return jsonResp(req, { ok: false, error: "gone" }, 410);
    if (Date.parse(row.expires_at || "") <= Date.now()) {
      await expireMentorFile(env, db, row);
      return jsonResp(req, { ok: false, error: "gone" }, 410);
    }
    if (!env.FILES) return jsonResp(req, { ok: false, error: "files_not_configured" }, 503);
    const obj = await env.FILES.get(row.r2_key);
    if (!obj) {
      await expireMentorFile(env, db, row);
      return jsonResp(req, { ok: false, error: "gone" }, 410);
    }
    const asciiName = row.filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_");
    const dlHeaders = {
      "Content-Type": row.content_type || (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream",
      "Content-Disposition": "attachment; filename=\"" + asciiName + "\"; filename*=UTF-8''" + encodeURIComponent(row.filename),
      "Cache-Control": "no-store",
    };
    if (obj.size) dlHeaders["Content-Length"] = String(obj.size);
    const resp = new Response(obj.body, { status: 200, headers: dlHeaders });
    const cleanup = (async () => {
      try { await env.FILES.delete(row.r2_key); } catch (e) { /* 对象删除失败不清状态亦不可再下（下方仍置 downloaded） */ }
      try {
        await db.prepare(
          `UPDATE mentor_files SET status = 'downloaded', downloaded_at = ? WHERE id = ? AND status = 'pending'`
        ).bind(nowIso(), row.id).run();
      } catch (e) { /* 状态落库失败仅影响展示 */ }
    })();
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cleanup);
    return resp;
  }

  const clientApiMatch = p.match(/^\/api\/client\/([A-Za-z0-9][A-Za-z0-9-]*)$/);
  if (clientApiMatch) {
    if (req.method !== "GET") return jsonResp(req, { ok: false, error: "method" }, 405);
    await ensureSchema(db);
    const locator = clientApiMatch[1];
    const student = /^\d+$/.test(locator)
      ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(parseInt(locator, 10)).first()
      : await db.prepare(`SELECT * FROM students WHERE slug = ?`).bind(locator).first();
    const sid = student ? student.id : 0;
    const key = url.searchParams.get("key") || "";
    if (!student || !student.client_key || !timingSafeEq(key, String(student.client_key))) {
      return jsonResp(req, { ok: false, error: "not found" }, 404);
    }
    // 性能优化（2026-10-22）：鉴权后的内容查询彼此独立（都只按 sid 取数），由串行改一波并行；
    // SQL、排序、组装逻辑一字未动，响应形状不变。未读标记 UPDATE 依赖 messageRows，仍在其后串行。
    const rowsOf = (r) => r.results || [];
    const [goal, goalLines, snaps, exams, courses, meetings, milestones, keyDates,
      actionRows, adviceRows, messageRows, problemRows, parentNoteRows, trailRows,
      reqSets, reqRowsAll, primaryMentorRow, topicAssignRows] = await Promise.all([
      db.prepare(`SELECT * FROM student_goals WHERE student_id = ?`).bind(sid).first(),
      db.prepare(
        `SELECT * FROM student_goal_lines WHERE student_id = ? ORDER BY priority ASC, id ASC LIMIT 100`).bind(sid).all().then(rowsOf),
      db.prepare(
        `SELECT * FROM student_status WHERE student_id = ? ORDER BY snapshot_date DESC, id DESC LIMIT 100`).bind(sid).all().then(rowsOf),
      db.prepare(
        `SELECT * FROM student_exams WHERE student_id = ? ORDER BY exam_date DESC, id DESC LIMIT 200`).bind(sid).all().then(rowsOf),
      db.prepare(
        `SELECT * FROM student_courses WHERE student_id = ? ORDER BY id ASC LIMIT 500`).bind(sid).all().then(rowsOf),
      db.prepare(
        `SELECT * FROM student_meetings WHERE student_id = ? ORDER BY meeting_date DESC, id DESC LIMIT 200`).bind(sid).all().then(rowsOf),
      // —— v10 新模块 ——
      db.prepare(
        `SELECT * FROM student_milestones WHERE student_id = ? ORDER BY sort ASC, id ASC LIMIT 200`).bind(sid).all().then(rowsOf),
      db.prepare(
        `SELECT * FROM student_key_dates WHERE student_id = ? ORDER BY date ASC, id ASC LIMIT 100`).bind(sid).all().then(rowsOf),
      db.prepare(
        `SELECT * FROM student_actions WHERE student_id = ? ORDER BY sort ASC, id ASC LIMIT 200`).bind(sid).all().then(rowsOf),
      db.prepare(
        `SELECT * FROM student_advice WHERE student_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`).bind(sid).all().then(rowsOf),
      db.prepare(
        `SELECT * FROM student_messages WHERE student_id = ? ORDER BY id ASC LIMIT 500`).bind(sid).all().then(rowsOf),
      // —— v12 新模块：问题方案层 / 导师轨迹 / 课程要求集（全部为方案层数据，私密层永不经此接口）——
      db.prepare(
        `SELECT * FROM student_problem_shares WHERE student_id = ? ORDER BY id DESC LIMIT 100`).bind(sid).all().then(rowsOf),
      // —— v13：学生自己发出的一句话（未撤回）——
      db.prepare(
        `SELECT * FROM note_to_parents WHERE student_id = ? AND withdrawn_at IS NULL ORDER BY id DESC LIMIT 20`).bind(sid).all().then(rowsOf),
      db.prepare(
        `SELECT t.*, m.meeting_date AS m_date, m.topic AS m_topic FROM mentor_trail_entries t
         LEFT JOIN student_meetings m ON m.id = t.meeting_id
         WHERE t.student_id = ? ORDER BY COALESCE(m.meeting_date, substr(t.created_at, 1, 10)) DESC, t.id DESC LIMIT 200`).bind(sid).all().then(rowsOf),
      db.prepare(
        `SELECT * FROM course_requirement_sets WHERE student_id = ? ORDER BY sort ASC, id ASC LIMIT 20`).bind(sid).all().then(rowsOf),
      // 原实现按 reqSets 非空才查要求条目；条目只在组装 course_match 时按 set 消费，
      // reqSets 为空时本查询结果不被使用，提前并行取数不改变响应。
      db.prepare(
        `SELECT * FROM course_requirements WHERE student_id = ? ORDER BY sort ASC, id ASC LIMIT 1000`).bind(sid).all().then(rowsOf),
      // —— v15 多导师：主导师档案（只取姓名/编号）与专题导师指派（带导师姓名/编号/专题）——
      // 只下发学生留言选人所需的公开定位信息，绝不下发 mentor_key 等密钥类字段。
      student.mentor_id
        ? db.prepare(`SELECT id, name, emp_no FROM staff WHERE id = ?`).bind(student.mentor_id).first()
        : Promise.resolve(null),
      db.prepare(
        `SELECT tm.topic AS topic, s.id AS staff_id, s.name AS staff_name, s.emp_no AS staff_emp_no
         FROM student_topic_mentors tm JOIN staff s ON s.id = tm.staff_id
         WHERE tm.student_id = ? ORDER BY tm.id ASC`).bind(sid).all().then(rowsOf),
    ]);
    // 未读计数在标记已读之前计算：本次下发的 unread_mentor 反映「打开 APP 时有几条导师留言未读」，
    // 标记后下次 GET 归零；前端据此在「导师」页签亮红点。
    const unreadMentor = messageRows.filter((m) => m.sender === "mentor" && !m.read_by_student).length;
    if (unreadMentor) {
      await db.prepare(
        `UPDATE student_messages SET read_by_student = 1 WHERE student_id = ? AND sender = 'mentor' AND read_by_student = 0`
      ).bind(sid).run();
    }
    const kTags = knowledgeTagsFor(goalLines, exams, goal);
    let knowledge = [];
    if (kTags.length) {
      const allK = (await db.prepare(
        `SELECT * FROM knowledge_items WHERE enabled = 1 ORDER BY id ASC LIMIT 200`).all()).results || [];
      knowledge = allK.filter((k) => kTags.includes(String(k.tag || ""))).slice(0, KNOWLEDGE_LIMIT);
    }
    // —— v12/v13 数据已在上方并行波取齐（problemRows / parentNoteRows / trailRows / reqSets / reqRowsAll）——
    const courseMatch = reqSets.map((s) => {
      const reqs = reqRowsAll.filter((r) => r.set_id === s.id);
      return {
        id: s.id, name: s.name || "", source_note: s.source_note || "",
        version_text: s.version_text || "", verified: !!s.verified,
        match: reqs.length ? matchRequirements(courses, reqs) : null,
      };
    });
    // —— v15：留言导师名解析（线程里区分主导师/专题导师的回复；只查留言出现过的导师姓名）——
    const msgMentorIds = [...new Set(messageRows.map((m) => m.mentor_id).filter(Boolean))];
    const msgMentorNames = {};
    if (msgMentorIds.length) {
      const nameRows = (await db.prepare(
        `SELECT id, name FROM staff WHERE id IN (${msgMentorIds.map(() => "?").join(",")})`
      ).bind(...msgMentorIds).all()).results || [];
      for (const r of nameRows) msgMentorNames[r.id] = r.name || "";
    }
    const lineOut = (l) => ({
      id: l.id, name: l.name || "", line_type: l.line_type || "",
      line_type_label: LINE_TYPES[l.line_type] || l.line_type || "",
      priority: l.priority, status: l.status || "",
      status_label: LINE_STATUSES[l.status] || l.status || "",
      next_step: l.next_step || "",
    });
    const snapOut = (s) => ({
      id: s.id, snapshot_date: s.snapshot_date || "", gpa: s.gpa,
      credits_done: s.credits_done, credits_total: s.credits_total, note: s.note || "",
    });
    return jsonResp(req, {
      ok: true,
      student: {
        id: student.id, slug: student.slug || "", name: student.name || "", package: student.package || "",
        stage: student.stage || "", stage_label: DELIVERY_STAGES[student.stage] || student.stage || "",
        note: student.note || "",
      },
      signature: student.signature || "",
      signature_set_at: student.signature_set_at || "",
      signature_suggestions: student.signature ? [] : signatureSuggestions(student, goal, goalLines, exams),
      school_system: goal ? (goal.school_system || "") : "",
      goal: goal ? {
        target_school: goal.target_school || "", target_term: goal.target_term || "",
        gpa_target: goal.gpa_target || "", goal_note: goal.goal_note || "",
      } : null,
      goal_lines: goalLines.map(lineOut),
      main_line: goalLines.length ? lineOut(goalLines[0]) : null,
      status: { latest: snaps.length ? snapOut(snaps[0]) : null, history: snaps.map(snapOut) },
      exams: exams.map((e) => ({
        id: e.id, exam_name: e.exam_name || "", exam_date: e.exam_date || "",
        score: e.score || "", pass_line: e.pass_line || "", result: e.result || "",
        result_label: EXAM_RESULTS[e.result] || e.result || "", note: e.note || "",
      })),
      courses: {
        progress: courseProgress(courses),
        groups: groupCoursesByTerm(courses),
        list: courses.map((c) => ({
          id: c.id, term: c.term || "", course_code: c.course_code || "",
          course_name: c.course_name || "", credits: c.credits,
          kind: c.kind || "", kind_label: COURSE_KINDS[c.kind] || c.kind || "",
          status: c.status || "", status_label: COURSE_STATUSES[c.status] || c.status || "",
          grade: c.grade || "", note: c.note || "",
        })),
      },
      meetings: meetings.map((m) => ({
        id: m.id, meeting_date: m.meeting_date || "", topic: m.topic || "",
        summary: m.summary || "", action_items: m.action_items || "", next_date: m.next_date || "",
      })),
      // —— v10 ——
      vision_text: student.vision_text || "",
      mentor_message: student.mentor_message || "",
      mentor_message_at: student.mentor_message_at || "",
      milestones: milestones.map((m) => ({
        id: m.id, date_text: m.date_text || "", title: m.title || "",
        detail: m.detail || "", kind: m.kind || "", sort: m.sort,
        created_at: m.created_at || "",
      })),
      key_dates: keyDates.map((k) => ({ id: k.id, date: k.date || "", title: k.title || "" })),
      actions: actionRows.map((a) => ({
        id: a.id, title: a.title || "", detail: a.detail || "", due_text: a.due_text || "",
        status: a.status || "", status_label: ACTION_STATUSES[a.status] || a.status || "", sort: a.sort,
        updated_at: a.updated_at || "",
      })),
      advice: adviceRows.map((a) => ({
        id: a.id, title: a.title || "", body: a.body || "", created_at: a.created_at || "",
      })),
      knowledge: knowledge.map((k) => ({
        id: k.id, title: k.title || "", body: k.body || "", tag: k.tag || "",
      })),
      messages: messageRows.map((m) => ({
        id: m.id, sender: m.sender || "", sender_label: MESSAGE_SENDERS[m.sender] || m.sender || "",
        body: m.body || "", created_at: m.created_at || "", category: m.category || "",
        mentor_id: m.mentor_id || null,
        mentor_name: m.mentor_id ? (msgMentorNames[m.mentor_id] || "") : "",
      })),
      unread_mentor: unreadMentor,
      // —— v15 多导师：可选收件导师（主导师在前、专题导师随后；只有定位符/姓名/专题，无密钥）——
      mentors: [
        ...(primaryMentorRow ? [{
          id: primaryMentorRow.id, emp_no: primaryMentorRow.emp_no || "",
          name: primaryMentorRow.name || "", role: "primary", topic: "",
        }] : []),
        ...topicAssignRows.map((r) => ({
          id: r.staff_id, emp_no: r.staff_emp_no || "",
          name: r.staff_name || "", role: "topic", topic: r.topic || "",
        })),
      ],
      // —— v12 ——
      problems: problemRows.map(problemOut),
      mentor_trail: trailRows.map((r) => ({
        id: r.id, meeting_id: r.meeting_id || null,
        meeting_date: r.m_date || "", meeting_topic: r.m_topic || "",
        mentor_name: r.mentor_name || "", mentor_role: r.mentor_role || "",
        mentor_role_label: TRAIL_ROLES[r.mentor_role] || r.mentor_role || "",
        spirit_line: r.spirit_line || "", key_judgments: r.key_judgments || "",
        // takeaway_local=1：领受正文只在学生本机，接口只回占位标记，绝不回正文
        student_takeaway: r.takeaway_local ? "" : (r.student_takeaway || ""),
        takeaway_local: !!r.takeaway_local,
        followup_actions: r.followup_actions || "",
        revisit_result: r.revisit_result || "", revisit_due: r.revisit_due || "",
        visibility: r.visibility || "", source: r.source || "",
        created_at: r.created_at || "", updated_at: r.updated_at || "",
      })),
      course_match: courseMatch,
      // —— v13 ——
      parent_notes: parentNoteRows.map((n) => ({
        id: n.id, body: n.body || "", feeling_tag: n.feeling_tag || "",
        feeling_tag_label: n.feeling_tag ? (FEELING_TAGS[n.feeling_tag] || n.feeling_tag) : "",
        created_at: n.created_at || "",
      })),
    });
  }

  // 家长端留言（v11，家长端唯一写接口）：POST /api/parent/message
  // 请求体 { s: <学生id 或 slug>, key: <家长密钥>, body: <留言正文> }。鉴权口径与学生端留言一致，
  // 但校验的是 students.parent_key：家长密钥与学生 client_key 互不通用，交叉使用一律 404。
  // 正文 trim 后须非空且 ≤500 字，非法 400；防刷：同一学生 60 秒内家长留言 ≥3 条返回 429。
  // 落库 sender='parent'，家长侧已读、导师侧未读。与 student_messages 完全独立，互不可见。
  if (p === "/api/parent/message") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const locator = String((body && body.s) || "").trim();
    const student = /^\d+$/.test(locator)
      ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(parseInt(locator, 10)).first()
      : (locator ? await db.prepare(`SELECT * FROM students WHERE slug = ?`).bind(locator).first() : null);
    const key = String((body && body.key) || "");
    if (!student || !student.parent_key || !timingSafeEq(key, String(student.parent_key))) {
      return jsonResp(req, { ok: false, error: "not found" }, 404);
    }
    const text = String((body && body.body) || "").trim();
    if (!text) return jsonResp(req, { ok: false, error: "message required" }, 400);
    if ([...text].length > MESSAGE_MAX_LEN) {
      return jsonResp(req, { ok: false, error: "message too long (max " + MESSAGE_MAX_LEN + ")" }, 400);
    }
    const since = new Date(Date.now() - MESSAGE_RATE_WINDOW_MS).toISOString();
    const recent = await db.prepare(
      `SELECT COUNT(*) AS n FROM parent_messages WHERE student_id = ? AND sender = 'parent' AND created_at >= ?`
    ).bind(student.id, since).first();
    if (recent && recent.n >= MESSAGE_RATE_LIMIT) {
      return jsonResp(req, { ok: false, error: "too frequent, retry in a minute" }, 429);
    }
    const ts = nowIso();
    const r = await db.prepare(
      `INSERT INTO parent_messages(student_id, sender, body, created_at, read_by_parent, read_by_mentor)
       VALUES(?, 'parent', ?, ?, 1, 0)`
    ).bind(student.id, text, ts).run();
    return jsonResp(req, {
      ok: true,
      message: { id: r.meta.last_row_id, sender: "parent", body: text, created_at: ts },
    });
  }

  // 家长端只读接口（v11）：GET /api/parent/<学生id 或 slug>?key=<家长密钥>。
  // 密钥为 students.parent_key（每名学生一个随机家长密钥），与学生端 client_key 独立：
  // 无 key / key 不对 / 学生不存在 / 拿学生密钥来查——一律 404，不暴露学生存在性。
  // 【数据边界·硬规则】只返回家长安全字段：学生姓名/slug、服务阶段与其中文名、套餐名（有才返回）、
  // 导师整理的家长更新、如何托举事项、家长↔导师留言、本次读取前的导师未读数。
  // 严禁返回 GPA、考试、课程、会议、学生目标原文、人生线与下一步、状态快照、学生留言、
  // client_key、学生签名等任何学生端原始数据——本接口根本不查询那些表。
  // 也不预留 diary / journal / mood / emotion 等学生私密原文字段：按机制定版，学生日记、
  // 想法与情绪困惑只保存在学生本机、永不进服务器；家长端打通的只能是经学生确认、再由
  // 导师整理过的「解决方案与规划结果」（parent_updates 按 阶段进展 / 当前解决策略 / 下一步 呈现）。
  const parentApiMatch = p.match(/^\/api\/parent\/([A-Za-z0-9][A-Za-z0-9-]*)$/);
  if (parentApiMatch) {
    if (req.method !== "GET") return jsonResp(req, { ok: false, error: "method" }, 405);
    await ensureSchema(db);
    const locator = parentApiMatch[1];
    const student = /^\d+$/.test(locator)
      ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(parseInt(locator, 10)).first()
      : await db.prepare(`SELECT * FROM students WHERE slug = ?`).bind(locator).first();
    const key = url.searchParams.get("key") || "";
    if (!student || !student.parent_key || !timingSafeEq(key, String(student.parent_key))) {
      return jsonResp(req, { ok: false, error: "not found" }, 404);
    }
    const psid = student.id;
    // 性能优化（2026-10-22）：家长留言查询与展示区块构建彼此独立，并行执行；
    // 展示区块不读 parent_messages，未读计数与标记 UPDATE 仍在留言取回后按原顺序执行，响应不变。
    const [pMsgRows, view] = await Promise.all([
      db.prepare(
        `SELECT * FROM parent_messages WHERE student_id = ? ORDER BY id ASC LIMIT 500`).bind(psid).all()
        .then((r) => r.results || []),
      // 展示区块（进展/托举/成就/一句话/日期提醒/需要关注）与学生端预览共用 parentViewSections，
      // 保证学生预览所见与家长实际所见逐键一致（v13.4）。
      parentViewSections(db, student),
    ]);
    // 未读计数在标记已读之前计算：unread_mentor_parent 反映「打开家长页时有几条导师留言未读」，前端据此亮红点
    const unreadMentorParent = pMsgRows.filter((m) => m.sender === "mentor" && !m.read_by_parent).length;
    if (unreadMentorParent) {
      await db.prepare(
        `UPDATE parent_messages SET read_by_parent = 1 WHERE student_id = ? AND sender = 'mentor' AND read_by_parent = 0`
      ).bind(psid).run();
    }
    return jsonResp(req, {
      ok: true,
      student: view.student,
      updates: view.updates,
      support_actions: view.support_actions,
      messages: pMsgRows.map((m) => ({
        id: m.id, sender: m.sender || "", sender_label: PARENT_MESSAGE_SENDERS[m.sender] || m.sender || "",
        body: m.body || "", created_at: m.created_at || "",
      })),
      unread_mentor_parent: unreadMentorParent,
      // —— v13 ——
      achievements: view.achievements,
      student_notes: view.student_notes,
      upcoming_reminders: view.upcoming_reminders,
      // —— v13.4：需要关注（导师整理、如实呈现，与进展并列）——
      concerns: view.concerns,
    });
  }

  // ===== v13 导师工作台 API =====
  // 本期口径：每位导师一个专属密钥链接（staff.mentor_key，后台人员页查看/重置），不做账号体系。
  // GET /api/mentor/<staff id 或 emp_no>?key=<mentor_key>：返回其名下学生的方案层内容
  // （一屏三块：近期动态 / 她的需求 / 待回复）。交叉密钥（client_key/parent_key）一律 404；
  // 响应不含私密层（本就零服务器数据）、不含家长一句话与家长留言。
  // v15：名下学生 = 主导师学生（students.mentor_id = staff.id，全量）+ 专题指派学生
  // （student_topic_mentors，裁剪视图，见下方专题块注释）。
  const findMentor = async (locator, key) => {
    const staff = /^\d+$/.test(locator)
      ? await db.prepare(`SELECT * FROM staff WHERE id = ?`).bind(parseInt(locator, 10)).first()
      : (locator ? await db.prepare(`SELECT * FROM staff WHERE emp_no = ?`).bind(locator).first() : null);
    if (!staff || !staff.mentor_key || !timingSafeEq(String(key || ""), String(staff.mentor_key))) return null;
    return staff;
  };
  /* ===== v17 导师文件一次性投递（导师端三接口）=====
   * 路由必须排在下方 mentorApiMatch 之前：其正则会吞 /api/mentor/files 等单段
   * 路径，且非 GET 在此会先被 405 挡下。鉴权沿用工作台口径（s=工号 +
   * key=mentor_key，findMentor 定位）；关系判定沿用 mentorStudentRelation
   * （主导师/专题导师均可）。无关系返回 404 + error "forbidden"：状态码沿用
   * 本组接口「不暴露学生存在性」口径，error code 按创始人清单明确给出。 */
  if (p === "/api/mentor/file") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let fd;
    try { fd = await req.formData(); } catch (e) { return jsonResp(req, { ok: false, error: "bad_form" }, 400); }
    await ensureSchema(db);
    const staff = await findMentor(String(fd.get("s") || ""), String(fd.get("key") || ""));
    if (!staff) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const studentId = toInt(fd.get("student_id"), 0);
    const stu = studentId ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(studentId).first() : null;
    const rel = stu ? await mentorStudentRelation(db, staff, stu) : null;
    if (!stu || !rel) return jsonResp(req, { ok: false, error: "forbidden" }, 404);
    const file = fd.get("file");
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return jsonResp(req, { ok: false, error: "file_required" }, 400);
    }
    const filename = sanitizeFilename(file.name || "");
    const contentType = String(file.type || "").split(";")[0].trim().toLowerCase();
    const size = Number(file.size) || 0;
    const limits = fileLimits(env);
    // 校验顺序（创始人定版）：关系（上方）→ 类型 → 单文件 5MB → 学生额度 → 全局额度
    if (!mentorFileTypeOk(filename, contentType)) return jsonResp(req, { ok: false, error: "bad_type" }, 400);
    if (size > limits.maxBytes) return jsonResp(req, { ok: false, error: "file_too_large" }, 413);
    if (!env.FILES) return jsonResp(req, { ok: false, error: "files_not_configured" }, 503);
    // 额度统计前先清扫到期文件，避免已过期 pending 占额误拒新传
    await sweepExpiredMentorFiles(env, db);
    const stuSum = await db.prepare(
      `SELECT COALESCE(SUM(size), 0) AS total FROM mentor_files WHERE student_id = ? AND status = 'pending'`
    ).bind(stu.id).first();
    if ((stuSum ? Number(stuSum.total) || 0 : 0) + size > limits.studentQuota) {
      return jsonResp(req, { ok: false, error: "student_quota" }, 409);
    }
    const allSum = await db.prepare(
      `SELECT COALESCE(SUM(size), 0) AS total FROM mentor_files WHERE status = 'pending'`).first();
    if ((allSum ? Number(allSum.total) || 0 : 0) + size > limits.globalQuota) {
      return jsonResp(req, { ok: false, error: "global_quota" }, 409);
    }
    const buf = await file.arrayBuffer();
    const r2Key = genFileKey();
    await env.FILES.put(r2Key, buf, { httpMetadata: { contentType } });
    const created = nowIso();
    const expires = new Date(Date.now() + FILE_TTL_MS).toISOString();
    const ins = await db.prepare(
      `INSERT INTO mentor_files(student_id, uploader_staff_id, r2_key, filename, content_type, size, status, created_at, expires_at, downloaded_at)
       VALUES(?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`
    ).bind(stu.id, staff.id, r2Key, filename, contentType, size, created, expires).run();
    const row = await db.prepare(`SELECT * FROM mentor_files WHERE id = ?`).bind(ins.meta.last_row_id).first();
    return jsonResp(req, { ok: true, file: mentorFileView(row) });
  }
  if (p === "/api/mentor/files") {
    if (req.method !== "GET") return jsonResp(req, { ok: false, error: "method" }, 405);
    await ensureSchema(db);
    const staff = await findMentor(url.searchParams.get("s") || "", url.searchParams.get("key") || "");
    if (!staff) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const studentId = toInt(url.searchParams.get("student_id"), 0);
    const stu = studentId ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(studentId).first() : null;
    const rel = stu ? await mentorStudentRelation(db, staff, stu) : null;
    if (!stu || !rel) return jsonResp(req, { ok: false, error: "forbidden" }, 404);
    await sweepExpiredMentorFiles(env, db, stu.id);
    const rows = (await db.prepare(
      `SELECT * FROM mentor_files WHERE student_id = ? AND uploader_staff_id = ? ORDER BY id DESC LIMIT 100`
    ).bind(stu.id, staff.id).all()).results || [];
    return jsonResp(req, { ok: true, files: rows.map((r) => mentorFileView(r)) });
  }
  if (p === "/api/mentor/file/withdraw") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const staff = await findMentor(String(body.s || ""), String(body.key || ""));
    if (!staff) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const fid = toInt(body.id, 0);
    const row = fid ? await db.prepare(`SELECT * FROM mentor_files WHERE id = ?`).bind(fid).first() : null;
    // 仅可撤回本人发送的；他人文件与不存在同口径 404
    if (!row || row.uploader_staff_id !== staff.id) return jsonResp(req, { ok: false, error: "not found" }, 404);
    if (row.status !== "pending") return jsonResp(req, { ok: false, error: "not_pending" }, 409);
    if (env.FILES) { try { await env.FILES.delete(row.r2_key); } catch (e) { /* 删除失败仍置 withdrawn，清扫兜底 */ } }
    await db.prepare(`UPDATE mentor_files SET status = 'withdrawn' WHERE id = ? AND status = 'pending'`).bind(row.id).run();
    return jsonResp(req, { ok: true, id: row.id, status: "withdrawn" });
  }

  // 2026-10-24 导师轻量改进：转给创始人（一次转发，非引擎）。
  // POST /api/mentor/forward { s, key, student_id, channel }：把当前线程最新一条
  // 对方留言 + 学生阶段转给创始人（EMP-001）的发件箱；创始人邮箱渠道时自动发信。
  // 创始人本人调用返回 is_founder；专题导师 parent 通道沿用回复口径一律 404。
  if (p === "/api/mentor/forward") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const staff = await findMentor(String((body && body.s) || "").trim(), String((body && body.key) || ""));
    if (!staff) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const founder = await db.prepare(`SELECT * FROM staff WHERE emp_no = ?`).bind("EMP-001").first();
    if (!founder) return jsonResp(req, { ok: false, error: "founder not found" }, 500);
    if (staff.id === founder.id) return jsonResp(req, { ok: false, error: "is_founder" }, 400);
    const sid = toInt(body && body.student_id, 0);
    const stu = sid ? await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(sid).first() : null;
    const rel = stu ? await mentorStudentRelation(db, staff, stu) : null;
    if (!stu || !rel) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const isTopic = rel.relation === "topic";
    const channel = String((body && body.channel) || "") === "parent" ? "parent" : "student";
    if (channel === "parent" && isTopic) return jsonResp(req, { ok: false, error: "not found" }, 404);
    let last = null;
    if (channel === "parent") {
      last = await db.prepare(
        `SELECT * FROM parent_messages WHERE student_id = ? AND sender = 'parent' ORDER BY id DESC LIMIT 1`).bind(stu.id).first();
    } else if (isTopic) {
      last = await db.prepare(
        `SELECT * FROM student_messages WHERE student_id = ? AND mentor_id = ? AND sender = 'student' ORDER BY id DESC LIMIT 1`).bind(stu.id, staff.id).first();
    } else {
      last = await db.prepare(
        `SELECT * FROM student_messages WHERE student_id = ? AND sender = 'student' ORDER BY id DESC LIMIT 1`).bind(stu.id).first();
    }
    const stageLabel = DELIVERY_STAGES[stu.stage] || stu.stage || "";
    const summary = "【转给创始人】" + (stu.name || "学生") + "（" + (channel === "parent" ? "家长留言" : "学生留言")
      + "，导师：" + (staff.name || "") + (stageLabel ? "，阶段：" + stageLabel : "") + "）："
      + (last && last.body ? String(last.body).slice(0, 120) : "（暂无对方留言）");
    const outboxId = await pushOutbox(env, db, founder, stu.id, "mentor_forwarded", summary, "message", last ? last.id : null);
    return jsonResp(req, { ok: true, outbox_id: outboxId });
  }

  const mentorApiMatch = p.match(/^\/api\/mentor\/([A-Za-z0-9][A-Za-z0-9-]*)$/);
  if (mentorApiMatch && mentorApiMatch[1] !== "reply") {
    if (req.method !== "GET") return jsonResp(req, { ok: false, error: "method" }, 405);
    await ensureSchema(db);
    const staff = await findMentor(mentorApiMatch[1], url.searchParams.get("key") || "");
    if (!staff) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const myStudents = (await db.prepare(
      `SELECT * FROM students WHERE mentor_id = ? ORDER BY id ASC LIMIT 50`).bind(staff.id).all()).results || [];
    const studentBlocks = [];
    for (const stu of myStudents) {
      const evRows = (await db.prepare(
        `SELECT * FROM student_events WHERE student_id = ? ORDER BY id DESC LIMIT 15`).bind(stu.id).all()).results || [];
      const openProblems = (await db.prepare(
        `SELECT * FROM student_problem_shares WHERE student_id = ? AND progress != 'resolved' ORDER BY id DESC LIMIT 20`).bind(stu.id).all()).results || [];
      const pendingActions = (await db.prepare(
        `SELECT * FROM student_actions WHERE student_id = ? AND status = 'todo' ORDER BY sort ASC, id ASC LIMIT 10`).bind(stu.id).all()).results || [];
      const revisitRows = (await db.prepare(
        `SELECT COUNT(*) AS n FROM mentor_trail_entries WHERE student_id = ? AND (revisit_result IS NULL OR revisit_result = '')`).bind(stu.id).first());
      const unreadMsgs = (await db.prepare(
        `SELECT * FROM student_messages WHERE student_id = ? AND sender = 'student' AND read_by_mentor = 0 ORDER BY id ASC LIMIT 50`).bind(stu.id).all()).results || [];
      studentBlocks.push({
        student: { id: stu.id, name: stu.name || "", slug: stu.slug || "", stage: stu.stage || "", stage_label: DELIVERY_STAGES[stu.stage] || stu.stage || "" },
        relation: "primary",
        recent_events: evRows.map((e) => ({
          id: e.id, event_type: e.event_type || "", event_label: EVENT_TYPES[e.event_type] || e.event_type || "",
          summary: e.summary || "", created_at: e.created_at || "",
        })),
        open_problems: openProblems.map((pr) => ({
          id: pr.id, title: pr.title || "", domain: pr.domain || "",
          domain_label: PROBLEM_DOMAINS[pr.domain] || pr.domain || "",
          stuck_summary: String(pr.strategy_summary || "").slice(0, 200),
          support_needed: pr.support_needed || "", progress: pr.progress || "open",
          progress_label: PROBLEM_PROGRESS[pr.progress] || pr.progress || "",
          created_at: pr.created_at || "",
        })),
        pending_actions: pendingActions.map((a) => ({
          id: a.id, title: a.title || "", detail: a.detail || "", due_text: a.due_text || "",
        })),
        trail_revisit_pending: revisitRows ? revisitRows.n : 0,
        unread_messages: unreadMsgs.map((m) => ({
          id: m.id, body: m.body || "", created_at: m.created_at || "", category: m.category || "",
        })),
      });
    }
    // —— v15：专题学生（裁剪视图，最小权限）——
    // 只给：学生姓名/slug、专题、与该导师往来的留言线程（student_messages.mentor_id = 本人）、
    // 本人撰写的导师轨迹条目。不查事件流/问题/待办/目标/考试/选课/状态快照/家长线——
    // 那些一律不进响应。会议记录不给：student_meetings 只有自由文本主题、没有专题归属字段，
    // 按专题过滤不可靠，宁缺勿漏。轨迹归属按 mentor_name 文本与本人姓名匹配（轨迹表无
    // staff_id 列，存量口径如此；导师改名/同名时可能漏配，后台改名须同步轨迹署名）。
    const topicAssigns = (await db.prepare(
      `SELECT tm.topic AS topic, s.id AS stu_id, s.name AS stu_name, s.slug AS stu_slug
       FROM student_topic_mentors tm JOIN students s ON s.id = tm.student_id
       WHERE tm.staff_id = ? ORDER BY tm.id ASC LIMIT 50`).bind(staff.id).all()).results || [];
    for (const asg of topicAssigns) {
      if (myStudents.some((s) => s.id === asg.stu_id)) continue; // 同时是主导师学生时以主视图为准
      const [threadRows, trailRows] = await Promise.all([
        db.prepare(
          `SELECT * FROM student_messages WHERE student_id = ? AND mentor_id = ? ORDER BY id ASC LIMIT 500`
        ).bind(asg.stu_id, staff.id).all().then((r) => r.results || []),
        db.prepare(
          `SELECT * FROM mentor_trail_entries WHERE student_id = ? AND mentor_name = ? ORDER BY id DESC LIMIT 100`
        ).bind(asg.stu_id, staff.name || "").all().then((r) => r.results || []),
      ]);
      const msgOut = (m) => ({
        id: m.id, sender: m.sender || "", sender_label: MESSAGE_SENDERS[m.sender] || m.sender || "",
        body: m.body || "", created_at: m.created_at || "", category: m.category || "",
      });
      studentBlocks.push({
        student: { id: asg.stu_id, name: asg.stu_name || "", slug: asg.stu_slug || "" },
        relation: "topic",
        topic: asg.topic || "",
        // 以下四键仅为与主导师块的形状兼容（工作台前端按块渲染），专题视图恒为空
        recent_events: [], open_problems: [], pending_actions: [], trail_revisit_pending: 0,
        unread_messages: threadRows
          .filter((m) => m.sender === "student" && !m.read_by_mentor).map(msgOut),
        messages: threadRows.map(msgOut),
        trail_entries: trailRows.map((r) => ({
          id: r.id, meeting_id: r.meeting_id || null,
          mentor_name: r.mentor_name || "", mentor_role: r.mentor_role || "",
          spirit_line: r.spirit_line || "", key_judgments: r.key_judgments || "",
          student_takeaway: r.takeaway_local ? "" : (r.student_takeaway || ""),
          takeaway_local: !!r.takeaway_local,
          followup_actions: r.followup_actions || "",
          revisit_result: r.revisit_result || "", revisit_due: r.revisit_due || "",
          created_at: r.created_at || "", updated_at: r.updated_at || "",
        })),
      });
    }
    return jsonResp(req, {
      ok: true,
      mentor: {
        id: staff.id, name: staff.name || "", emp_no: staff.emp_no || "",
        kind: staff.kind || "", mentor_status: staff.mentor_status || "",
        mentor_status_label: MENTOR_STATUSES[staff.mentor_status] || "",
        notifiable: mentorNotifiable(staff),
      },
      students: studentBlocks,
    });
  }
  // POST /api/mentor/reply { s: <staff id 或 emp_no>, key, student_id, body }：导师在工作台直接回复。
  // 回复只进既有留言通道（student_messages, sender='mentor'）；同时把该学生名下 queued 的
  // student_message 发件箱记录推进到 responded，并把该学生未读留言标已读；回复记入事件流。
  // student_id 必须是该导师名下学生，否则 404（不暴露存在性）。
  // v15：名下学生 = 主导师学生 + 专题指派学生。专题导师只能回复学生线（channel=parent → 404）、
  // 标已读只动与自己的线程（mentor_id = 本人），不碰主导师线程的未读状态。
  if (p === "/api/mentor/reply") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const staff = await findMentor(String((body && body.s) || "").trim(), String((body && body.key) || ""));
    if (!staff) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const sid = toInt(body && body.student_id, 0);
    const stu = sid ? await db.prepare(
      `SELECT * FROM students WHERE id = ?`).bind(sid).first() : null;
    const rel = stu ? await mentorStudentRelation(db, staff, stu) : null;
    if (!stu || !rel) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const isTopic = rel.relation === "topic";
    const text = String((body && body.body) || "").trim();
    if (!text) return jsonResp(req, { ok: false, error: "message required" }, 400);
    if ([...text].length > MESSAGE_MAX_LEN) {
      return jsonResp(req, { ok: false, error: "message too long (max " + MESSAGE_MAX_LEN + ")" }, 400);
    }
    // v14 沟通台：channel='parent' 时回复进家长对话线（parent_messages），语义与后台
    // parent_message_reply 完全一致（普通插入，不记学生事件流、不进发件箱）；
    // 同时把该学生家长未读留言标导师已读。缺省/其它值沿用学生通道（v13 行为不变）。
    // v15：专题导师无家长线权限——channel='parent' 对专题关系一律 404（不暴露家长线存在性）。
    if (String((body && body.channel) || "") === "parent") {
      if (isTopic) return jsonResp(req, { ok: false, error: "not found" }, 404);
      const pts = nowIso();
      const pr = await db.prepare(
        `INSERT INTO parent_messages(student_id, sender, body, created_at, read_by_parent, read_by_mentor)
         VALUES(?, 'mentor', ?, ?, 0, 1)`
      ).bind(stu.id, text, pts).run();
      await db.prepare(
        `UPDATE parent_messages SET read_by_mentor = 1 WHERE student_id = ? AND sender = 'parent' AND read_by_mentor = 0`
      ).bind(stu.id).run();
      return jsonResp(req, {
        ok: true, channel: "parent",
        message: { id: pr.meta.last_row_id, sender: "mentor", body: text, created_at: pts },
      });
    }
    const ts = nowIso();
    const r = await db.prepare(
      `INSERT INTO student_messages(student_id, sender, body, created_at, read_by_student, read_by_mentor, mentor_id)
       VALUES(?, 'mentor', ?, ?, 0, 1, ?)`
    ).bind(stu.id, text, ts, staff.id).run();
    if (isTopic) {
      // v15：专题导师回复只把与自己的线程标已读，不动主导师线程的未读状态
      await db.prepare(
        `UPDATE student_messages SET read_by_mentor = 1 WHERE student_id = ? AND sender = 'student' AND read_by_mentor = 0 AND mentor_id = ?`
      ).bind(stu.id, staff.id).run();
    } else {
      await db.prepare(
        `UPDATE student_messages SET read_by_mentor = 1 WHERE student_id = ? AND sender = 'student' AND read_by_mentor = 0`
      ).bind(stu.id).run();
    }
    await db.prepare(
      `UPDATE notifications_outbox SET status = 'responded', updated_at = ?
       WHERE mentor_staff_id = ? AND student_id = ? AND event_type = 'student_message' AND status IN ('queued','sent')`
    ).bind(ts, staff.id, stu.id).run();
    await logEvent(db, stu.id, "mentor_reply", r.meta.last_row_id, "导师回复留言");
    return jsonResp(req, {
      ok: true,
      message: { id: r.meta.last_row_id, sender: "mentor", body: text, created_at: ts },
    });
  }

  // ===== v14 导师简易沟通台 API =====
  // GET /api/mentor/inbox/<staff id 或 emp_no>?key=<mentor_key>：聚合收件箱。
  // 只含该导师名下学生（students.mentor_id = staff.id）的两条留言线——学生线（student_messages）
  // 与家长线（parent_messages）分开成条目：每条给出最后一条留言摘要与导师未读数；
  // 顶部汇总 total_unread（未读总条数）与 pending_threads（有未读的线数）。
  // 无任何留言的学生不产生条目；导师无指派学生 → threads 为空数组（诚实空态）。
  // 查询纪律：学生列表 1 条 + 每学生 4 条小查询全部 Promise.all 并行（与 2026-10-22 性能修复同口径）。
  // v15：专题指派学生也进收件箱，但只有学生线、且只统计/展示与该导师往来的留言
  // （mentor_id = 本人）；家长线对专题导师完全不可见（不查 parent_messages）。
  const mentorInboxMatch = p.match(/^\/api\/mentor\/inbox\/([A-Za-z0-9][A-Za-z0-9-]*)$/);
  if (mentorInboxMatch) {
    if (req.method !== "GET") return jsonResp(req, { ok: false, error: "method" }, 405);
    await ensureSchema(db);
    const staff = await findMentor(mentorInboxMatch[1], url.searchParams.get("key") || "");
    if (!staff) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const primaryStudents = (await db.prepare(
      `SELECT id, name, slug FROM students WHERE mentor_id = ? ORDER BY id ASC LIMIT 50`).bind(staff.id).all()).results || [];
    const topicAssigns = (await db.prepare(
      `SELECT tm.topic AS topic, s.id AS stu_id, s.name AS stu_name, s.slug AS stu_slug
       FROM student_topic_mentors tm JOIN students s ON s.id = tm.student_id
       WHERE tm.staff_id = ? ORDER BY tm.id ASC LIMIT 50`).bind(staff.id).all()).results || [];
    const rels = primaryStudents.map((stu) => ({ stu, relation: "primary", topic: "" }));
    for (const a of topicAssigns) {
      if (primaryStudents.some((s) => s.id === a.stu_id)) continue; // 主导师关系优先
      rels.push({ stu: { id: a.stu_id, name: a.stu_name, slug: a.stu_slug }, relation: "topic", topic: a.topic || "" });
    }
    const perStudent = await Promise.all(rels.map(async ({ stu, relation, topic }) => {
      const isTopic = relation === "topic";
      const [sLast, sUnread, pLast, pUnread] = await Promise.all([
        isTopic
          ? db.prepare(`SELECT id, sender, body, created_at, category FROM student_messages WHERE student_id = ? AND mentor_id = ? ORDER BY id DESC LIMIT 1`).bind(stu.id, staff.id).first()
          : db.prepare(`SELECT id, sender, body, created_at, category FROM student_messages WHERE student_id = ? ORDER BY id DESC LIMIT 1`).bind(stu.id).first(),
        isTopic
          ? db.prepare(`SELECT COUNT(*) AS n FROM student_messages WHERE student_id = ? AND mentor_id = ? AND sender = 'student' AND read_by_mentor = 0`).bind(stu.id, staff.id).first()
          : db.prepare(`SELECT COUNT(*) AS n FROM student_messages WHERE student_id = ? AND sender = 'student' AND read_by_mentor = 0`).bind(stu.id).first(),
        isTopic
          ? Promise.resolve(null)
          : db.prepare(`SELECT id, sender, body, created_at FROM parent_messages WHERE student_id = ? ORDER BY id DESC LIMIT 1`).bind(stu.id).first(),
        isTopic
          ? Promise.resolve(null)
          : db.prepare(`SELECT COUNT(*) AS n FROM parent_messages WHERE student_id = ? AND sender = 'parent' AND read_by_mentor = 0`).bind(stu.id).first(),
      ]);
      return { stu, relation, topic, sLast, sUnread: sUnread ? sUnread.n : 0, pLast, pUnread: pUnread ? pUnread.n : 0 };
    }));
    const threads = [];
    for (const { stu, relation, topic, sLast, sUnread, pLast, pUnread } of perStudent) {
      if (sLast) threads.push({
        student_id: stu.id, student_name: stu.name || "", slug: stu.slug || "",
        channel: "student", channel_label: "学生留言",
        relation, topic,
        last: { id: sLast.id, sender: sLast.sender || "", body: String(sLast.body || "").slice(0, 120), created_at: sLast.created_at || "", category: sLast.category || "" },
        unread: sUnread,
      });
      if (pLast) threads.push({
        student_id: stu.id, student_name: stu.name || "", slug: stu.slug || "",
        channel: "parent", channel_label: "家长留言",
        relation, topic,
        last: { id: pLast.id, sender: pLast.sender || "", body: String(pLast.body || "").slice(0, 120), created_at: pLast.created_at || "" },
        unread: pUnread,
      });
    }
    threads.sort((a, b) => (b.last.created_at || "").localeCompare(a.last.created_at || "") || b.last.id - a.last.id);
    return jsonResp(req, {
      ok: true,
      mentor: { id: staff.id, name: staff.name || "", emp_no: staff.emp_no || "" },
      total_unread: threads.reduce((sum, t) => sum + t.unread, 0),
      pending_threads: threads.filter((t) => t.unread > 0).length,
      threads,
    });
  }
  // GET /api/mentor/thread/<staff id 或 emp_no>?key=&student_id=&channel=student|parent：
  // 单条对话线全量（id 正序，上限 500，与学生/家长端同口径）。打开即把该线对方未读标导师已读
  // （沿用既有 read_by_mentor 机制），unread_before 返回打开前的对方未读数。
  // 学生不属于该导师 → 404（不暴露存在性）；家长线只查 parent_messages，学生线只查
  // student_messages，两条线数据互不串。
  // v15：专题导师同样可开学生线，但只见与自己的往来（mentor_id = 本人），标已读也只动
  // 自己线程；家长线对专题导师一律 404（不暴露家长线存在性）。
  const mentorThreadMatch = p.match(/^\/api\/mentor\/thread\/([A-Za-z0-9][A-Za-z0-9-]*)$/);
  if (mentorThreadMatch) {
    if (req.method !== "GET") return jsonResp(req, { ok: false, error: "method" }, 405);
    await ensureSchema(db);
    const staff = await findMentor(mentorThreadMatch[1], url.searchParams.get("key") || "");
    if (!staff) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const sid = toInt(url.searchParams.get("student_id"), 0);
    const stu = sid ? await db.prepare(
      `SELECT id, name, slug, mentor_id FROM students WHERE id = ?`).bind(sid).first() : null;
    const rel = stu ? await mentorStudentRelation(db, staff, stu) : null;
    if (!stu || !rel) return jsonResp(req, { ok: false, error: "not found" }, 404);
    const isTopic = rel.relation === "topic";
    const channel = url.searchParams.get("channel") === "parent" ? "parent" : "student";
    if (channel === "parent" && isTopic) return jsonResp(req, { ok: false, error: "not found" }, 404);
    if (channel === "parent") {
      const rows = (await db.prepare(
        `SELECT * FROM parent_messages WHERE student_id = ? ORDER BY id ASC LIMIT 500`).bind(stu.id).all()).results || [];
      const unreadBefore = rows.filter((m) => m.sender === "parent" && !m.read_by_mentor).length;
      if (unreadBefore) {
        await db.prepare(
          `UPDATE parent_messages SET read_by_mentor = 1 WHERE student_id = ? AND sender = 'parent' AND read_by_mentor = 0`
        ).bind(stu.id).run();
      }
      return jsonResp(req, {
        ok: true,
        student: { id: stu.id, name: stu.name || "", slug: stu.slug || "" },
        channel, unread_before: unreadBefore,
        messages: rows.map((m) => ({
          id: m.id, sender: m.sender || "", sender_label: PARENT_MESSAGE_SENDERS[m.sender] || m.sender || "",
          body: m.body || "", created_at: m.created_at || "",
        })),
      });
    }
    const rows = (await (isTopic
      ? db.prepare(
        `SELECT * FROM student_messages WHERE student_id = ? AND mentor_id = ? ORDER BY id ASC LIMIT 500`).bind(stu.id, staff.id).all()
      : db.prepare(
        `SELECT * FROM student_messages WHERE student_id = ? ORDER BY id ASC LIMIT 500`).bind(stu.id).all())).results || [];
    const unreadBefore = rows.filter((m) => m.sender === "student" && !m.read_by_mentor).length;
    if (unreadBefore) {
      if (isTopic) {
        await db.prepare(
          `UPDATE student_messages SET read_by_mentor = 1 WHERE student_id = ? AND mentor_id = ? AND sender = 'student' AND read_by_mentor = 0`
        ).bind(stu.id, staff.id).run();
      } else {
        await db.prepare(
          `UPDATE student_messages SET read_by_mentor = 1 WHERE student_id = ? AND sender = 'student' AND read_by_mentor = 0`
        ).bind(stu.id).run();
      }
    }
    return jsonResp(req, {
      ok: true,
      student: { id: stu.id, name: stu.name || "", slug: stu.slug || "" },
      channel, unread_before: unreadBefore,
      messages: rows.map((m) => ({
        id: m.id, sender: m.sender || "", sender_label: MESSAGE_SENDERS[m.sender] || m.sender || "",
        body: m.body || "", created_at: m.created_at || "", category: m.category || "",
      })),
    });
  }

  // 学生一次性导入入口（v7，Bearer LEAD_API_TOKEN）：创建学生并批量写入专属客户端六块数据。
  // 请求体 { student:{name, package?, stage?, note?}, goal?, goal_lines?, status?, exams?, courses?, meetings? }。
  // 幂等口径：同名学生（trim 后精确匹配）已存在时不写任何数据，直接返回 { existed:true, student_id, client_key }。
  // 全部字段先校验后落库，任一条不合法整单 400，不留半截数据。
  if (p === "/api/admin/students/import") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    const token = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.LEAD_API_TOKEN || token !== env.LEAD_API_TOKEN) return jsonResp(req, { ok: false, error: "unauthorized" }, 401);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    const stu = (body && body.student) || {};
    const name = clampStr(stu.name, 60);
    if (!name) return jsonResp(req, { ok: false, error: "student.name required" }, 400);
    await ensureSchema(db);
    const existing = await db.prepare(
      `SELECT id, client_key, slug, name FROM students WHERE name = ? ORDER BY id ASC LIMIT 1`).bind(name).first();
    if (existing) {
      const key = await ensureClientKey(db, existing);
      const slug = await ensureStudentSlug(db, existing);
      const pkey = await ensureParentKey(db, existing);
      return jsonResp(req, { ok: true, existed: true, student_id: existing.id, client_key: key, parent_key: pkey, slug });
    }
    // —— 校验并归一化（先全量校验，任一不合法整单拒绝）——
    const bad = (msg) => jsonResp(req, { ok: false, error: msg }, 400);
    // slug（v8）：可显式指定（须符合小写字母/数字/连字符规则），不给则由姓名 slugify 生成；冲突自动加数字后缀
    let slugBase = null;
    if (stu.slug !== undefined && stu.slug !== null && String(stu.slug).trim() !== "") {
      slugBase = String(stu.slug).trim().toLowerCase();
      if (!SLUG_RE.test(slugBase)) return bad("student.slug invalid (a-z 0-9 -, max 40)");
    }
    const numOrNull = (v) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined; // undefined = 不合法
    };
    const intOrNull = (v) => {
      if (v === undefined || v === null || v === "") return null;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const goalIn = body.goal && typeof body.goal === "object" ? {
      target_school: clampStr(body.goal.target_school, 120),
      target_term: clampStr(body.goal.target_term, 40),
      goal_note: clampStr(body.goal.goal_note, 2000),
      gpa_target: clampStr(body.goal.gpa_target, 10) || null,
      school_system: clampStr(body.goal.school_system, 40) || null,
    } : null;
    const linesIn = [];
    const linesRaw = Array.isArray(body.goal_lines) ? body.goal_lines : [];
    if (linesRaw.length > 20) return bad("too many goal_lines (max 20)");
    for (let i = 0; i < linesRaw.length; i++) {
      const l = linesRaw[i] || {};
      const lname = clampStr(l.name, 80);
      if (!lname) return bad("goal_lines[" + i + "].name required");
      const ltype = l.line_type === undefined || l.line_type === null || l.line_type === "" ? "parallel" : String(l.line_type);
      if (!LINE_TYPES[ltype]) return bad("goal_lines[" + i + "] bad line_type");
      const lstatus = l.status === undefined || l.status === null || l.status === "" ? "active" : String(l.status);
      if (!LINE_STATUSES[lstatus]) return bad("goal_lines[" + i + "] bad status");
      let prio = parseInt(l.priority, 10);
      if (!Number.isFinite(prio) || prio < 1) prio = 1;
      if (prio > 99) prio = 99;
      linesIn.push({ name: lname, line_type: ltype, priority: prio, status: lstatus, next_step: clampStr(l.next_step, 200) || null });
    }
    const statusIn = [];
    const statusRaw = Array.isArray(body.status) ? body.status : [];
    if (statusRaw.length > 50) return bad("too many status (max 50)");
    for (let i = 0; i < statusRaw.length; i++) {
      const s = statusRaw[i] || {};
      const gpa = numOrNull(s.gpa);
      if (gpa === undefined) return bad("status[" + i + "] bad gpa");
      const cd = intOrNull(s.credits_done), ct = intOrNull(s.credits_total);
      if (cd === undefined || ct === undefined) return bad("status[" + i + "] bad credits");
      statusIn.push({
        snapshot_date: clampStr(s.snapshot_date, 10) || todayStr(), gpa,
        credits_done: cd, credits_total: ct, note: clampStr(s.note, 2000),
      });
    }
    const examsIn = [];
    const examsRaw = Array.isArray(body.exams) ? body.exams : [];
    if (examsRaw.length > 100) return bad("too many exams (max 100)");
    for (let i = 0; i < examsRaw.length; i++) {
      const e = examsRaw[i] || {};
      const ename = clampStr(e.exam_name, 80);
      if (!ename) return bad("exams[" + i + "].exam_name required");
      const result = e.result === undefined || e.result === null || e.result === "" ? "pending" : String(e.result);
      if (!EXAM_RESULTS[result]) return bad("exams[" + i + "] bad result");
      examsIn.push({
        exam_name: ename, exam_date: clampStr(e.exam_date, 10) || null,
        score: clampStr(e.score, 20) || null, pass_line: clampStr(e.pass_line, 20) || null,
        result, note: clampStr(e.note, 2000),
      });
    }
    const coursesIn = [];
    const coursesRaw = Array.isArray(body.courses) ? body.courses : [];
    if (coursesRaw.length > 500) return bad("too many courses (max 500)");
    for (let i = 0; i < coursesRaw.length; i++) {
      const c = coursesRaw[i] || {};
      const term = clampStr(c.term, 20);
      const code = clampStr(c.course_code, 20);
      const cname = clampStr(c.course_name, 80);
      if (!term || (!code && !cname)) return bad("courses[" + i + "] term + (course_code|course_name) required");
      const kind = c.kind === undefined || c.kind === null || c.kind === "" ? "prereq" : String(c.kind);
      if (!COURSE_KINDS[kind]) return bad("courses[" + i + "] bad kind");
      const cstatus = c.status === undefined || c.status === null || c.status === "" ? "planned" : String(c.status);
      if (!COURSE_STATUSES[cstatus]) return bad("courses[" + i + "] bad status");
      const credits = intOrNull(c.credits);
      if (credits === undefined) return bad("courses[" + i + "] bad credits");
      coursesIn.push({
        term, course_code: code, course_name: cname, credits,
        kind, status: cstatus, grade: clampStr(c.grade, 10) || null, note: clampStr(c.note, 2000),
      });
    }
    const meetingsIn = [];
    const meetingsRaw = Array.isArray(body.meetings) ? body.meetings : [];
    if (meetingsRaw.length > 200) return bad("too many meetings (max 200)");
    for (let i = 0; i < meetingsRaw.length; i++) {
      const m = meetingsRaw[i] || {};
      const topic = clampStr(m.topic, 120);
      if (!topic) return bad("meetings[" + i + "].topic required");
      meetingsIn.push({
        meeting_date: clampStr(m.meeting_date, 10) || todayStr(), topic,
        summary: clampStr(m.summary, 4000), action_items: clampStr(m.action_items, 4000),
        next_date: clampStr(m.next_date, 10) || null,
      });
    }
    const extras = normClientExtras(body || {});
    if (extras.error) return bad(extras.error);
    // —— 落库 ——
    const now = nowIso();
    const clientKey = genClientKey();
    const parentKey = genParentKey();
    const slug = await uniqueSlug(db, slugBase || slugify(name), 0);
    const stage = stu.stage && validStage(String(stu.stage)) ? String(stu.stage) : "diag";
    const sr = await db.prepare(
      `INSERT INTO students(lead_id, order_id, name, package, stage, stage_since, note, created_at, updated_at, client_key, slug, vision_text, parent_key)
       VALUES(NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(name, clampStr(stu.package, 60) || null, stage, now,
      clampStr(stu.note, 2000), now, now, clientKey, slug,
      clampStr(stu.vision_text, 2000) || null, parentKey).run();
    const sid = sr.meta.last_row_id;
    if (goalIn) {
      await db.prepare(
        `INSERT INTO student_goals(student_id, target_school, target_term, goal_note, gpa_target, school_system, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, goalIn.target_school, goalIn.target_term, goalIn.goal_note, goalIn.gpa_target, goalIn.school_system, now, now).run();
    }
    for (const l of linesIn) {
      await db.prepare(
        `INSERT INTO student_goal_lines(student_id, name, line_type, priority, status, next_step, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, l.name, l.line_type, l.priority, l.status, l.next_step, now, now).run();
    }
    for (const s of statusIn) {
      await db.prepare(
        `INSERT INTO student_status(student_id, snapshot_date, gpa, credits_done, credits_total, note, created_at)
         VALUES(?,?,?,?,?,?,?)`
      ).bind(sid, s.snapshot_date, s.gpa, s.credits_done, s.credits_total, s.note, now).run();
    }
    for (const e of examsIn) {
      await db.prepare(
        `INSERT INTO student_exams(student_id, exam_name, exam_date, score, pass_line, result, note, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`
      ).bind(sid, e.exam_name, e.exam_date, e.score, e.pass_line, e.result, e.note, now, now).run();
    }
    for (const c of coursesIn) {
      await db.prepare(
        `INSERT INTO student_courses(student_id, term, course_code, course_name, credits, kind, status, grade, note, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(sid, c.term, c.course_code, c.course_name, c.credits, c.kind, c.status, c.grade, c.note, now, now).run();
    }
    for (const m of meetingsIn) {
      await db.prepare(
        `INSERT INTO student_meetings(student_id, meeting_date, topic, summary, action_items, next_date, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, m.meeting_date, m.topic, m.summary, m.action_items, m.next_date, now, now).run();
    }
    for (const m of extras.milestones) {
      await db.prepare(
        `INSERT INTO student_milestones(student_id, date_text, title, detail, kind, sort, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, m.date_text, m.title, m.detail, m.kind, m.sort, now, now).run();
    }
    for (const k of extras.keyDates) {
      await db.prepare(
        `INSERT INTO student_key_dates(student_id, date, title, kind, created_at, updated_at)
         VALUES(?,?,?,?,?,?)`
      ).bind(sid, k.date, k.title, k.kind, now, now).run();
    }
    for (const a of extras.actions) {
      await db.prepare(
        `INSERT INTO student_actions(student_id, title, detail, due_text, status, sort, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, a.title, a.detail, a.due_text, a.status, a.sort, now, now).run();
    }
    for (const a of extras.advice) {
      await db.prepare(
        `INSERT INTO student_advice(student_id, title, body, sort, created_at, updated_at)
         VALUES(?,?,?,?,?,?)`
      ).bind(sid, a.title, a.body, a.sort, now, now).run();
    }
    return jsonResp(req, {
      ok: true, existed: false, student_id: sid, client_key: clientKey, parent_key: parentKey, slug,
      counts: {
        goal: goalIn ? 1 : 0, goal_lines: linesIn.length, status: statusIn.length,
        exams: examsIn.length, courses: coursesIn.length, meetings: meetingsIn.length,
        milestones: extras.milestones.length, key_dates: extras.keyDates.length,
        actions: extras.actions.length, advice: extras.advice.length,
      },
    });
  }

  // 学生数据补录入口（v10，Bearer LEAD_API_TOKEN）：给「已存在」的学生增量灌入新模块数据。
  // 导入接口对同名学生幂等跳过，补不了新数据，故另设本口。请求体：
  // { student:{id?|slug?|name?}（三选一定位）, student_patch:{vision_text?, mentor_message?},
  //   goal_line_renames:[{from,to}], milestones?/key_dates?/actions?/advice?（同导入校验，按标题去重）,
  //   messages?:[{sender?,body}]（按 sender+body 去重）, knowledge?:[{title,body,tag,enabled?}]（全局库，按标题去重） }
  // v11 起另支持家长三段：parent_updates? / parent_support_actions?（按标题去重）、
  // parent_messages?:[{sender?,body}]（按 sender+body 去重）；响应顺带回传 parent_key（缺失时自动生成）。
  // 已存在的条目跳过并计数，不覆盖、不重复写。
  if (p === "/api/admin/students/enrich") {
    if (req.method !== "POST") return jsonResp(req, { ok: false, error: "method" }, 405);
    const token = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.LEAD_API_TOKEN || token !== env.LEAD_API_TOKEN) return jsonResp(req, { ok: false, error: "unauthorized" }, 401);
    let body;
    try { body = await req.json(); } catch { return jsonResp(req, { ok: false, error: "bad json" }, 400); }
    await ensureSchema(db);
    const stuRef = (body && body.student) || {};
    let student = null;
    if (stuRef.id) student = await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(parseInt(stuRef.id, 10)).first();
    if (!student && stuRef.slug) student = await db.prepare(`SELECT * FROM students WHERE slug = ?`).bind(String(stuRef.slug)).first();
    if (!student && stuRef.name) student = await db.prepare(`SELECT * FROM students WHERE name = ? ORDER BY id ASC LIMIT 1`).bind(clampStr(stuRef.name, 60)).first();
    if (!student) return jsonResp(req, { ok: false, error: "student not found" }, 404);
    const sid = student.id;
    const bad = (msg) => jsonResp(req, { ok: false, error: msg }, 400);
    const extras = normClientExtras(body || {});
    if (extras.error) return bad(extras.error);
    const pExtras = normParentExtras(body || {});
    if (pExtras.error) return bad(pExtras.error);
    // v12 两段同样先校验后落库：任一不合法整单 400，不留半截数据
    const tExtras = normTrailExtras(body || {});
    if (tExtras.error) return bad(tExtras.error);
    const rExtras = normRequirementSets(body || {});
    if (rExtras.error) return bad(rExtras.error);
    const now = nowIso();
    const counts = {
      patched: 0, renamed: 0,
      milestones: { inserted: 0, skipped: 0 }, key_dates: { inserted: 0, skipped: 0 },
      actions: { inserted: 0, skipped: 0 }, advice: { inserted: 0, skipped: 0 },
      messages: { inserted: 0, skipped: 0 }, knowledge: { inserted: 0, skipped: 0 },
      parent_updates: { inserted: 0, skipped: 0 },
      parent_support_actions: { inserted: 0, skipped: 0 },
      parent_messages: { inserted: 0, skipped: 0 },
      trail_entries: { inserted: 0, skipped: 0 },
      requirement_sets: { inserted: 0, skipped: 0, requirements_inserted: 0, requirements_skipped: 0 },
    };
    // —— 学生字段补丁（愿景 / 导师寄语；寄语不许在此替导师编话，只搬运调用方给的文本）——
    const patch = (body && body.student_patch) || {};
    if (Object.prototype.hasOwnProperty.call(patch, "vision_text")) {
      await db.prepare(`UPDATE students SET vision_text = ?, updated_at = ? WHERE id = ?`)
        .bind(clampStr(patch.vision_text, 2000) || null, now, sid).run();
      counts.patched++;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "mentor_message")) {
      const mm = clampStr(patch.mentor_message, 2000);
      if (mm) {
        await db.prepare(`UPDATE students SET mentor_message = ?, mentor_message_at = ?, updated_at = ? WHERE id = ?`)
          .bind(mm, now, now, sid).run();
      } else {
        await db.prepare(`UPDATE students SET mentor_message = NULL, mentor_message_at = NULL, updated_at = ? WHERE id = ?`)
          .bind(now, sid).run();
      }
      counts.patched++;
    }
    // —— v13：默认导师分配（按 emp_no / 姓名 / id 解析 staff；解析不到整单 400，不静默）——
    if (patch.mentor_emp_no || patch.mentor_name || patch.mentor_id) {
      let staff = null;
      if (patch.mentor_id) {
        staff = await db.prepare(`SELECT * FROM staff WHERE id = ?`).bind(toInt(patch.mentor_id, 0)).first();
      } else if (patch.mentor_emp_no) {
        staff = await db.prepare(`SELECT * FROM staff WHERE emp_no = ?`).bind(clampStr(patch.mentor_emp_no, 24)).first();
      } else {
        staff = await db.prepare(`SELECT * FROM staff WHERE name = ? ORDER BY id ASC`).bind(clampStr(patch.mentor_name, 60)).first();
      }
      if (!staff) return bad("mentor not found (mentor_emp_no / mentor_name / mentor_id)");
      await db.prepare(`UPDATE students SET mentor_id = ?, updated_at = ? WHERE id = ?`)
        .bind(staff.id, now, sid).run();
      counts.mentor = { staff_id: staff.id, name: staff.name || "", notifiable: mentorNotifiable(staff) };
      counts.patched++;
    }
    // —— 人生线改名（按旧名精确匹配，可附带替换 next_step 说明，改完计数）——
    const renames = Array.isArray(body.goal_line_renames) ? body.goal_line_renames : [];
    if (renames.length > 20) return bad("too many goal_line_renames (max 20)");
    for (const rn of renames) {
      const from = clampStr(rn && rn.from, 80);
      const to = clampStr(rn && rn.to, 80);
      if (!from || !to) return bad("goal_line_renames need from+to");
      if (rn && rn.next_step !== undefined) {
        await db.prepare(
          `UPDATE student_goal_lines SET name = ?, next_step = ?, updated_at = ? WHERE student_id = ? AND name = ?`
        ).bind(to, clampStr(rn.next_step, 200) || null, now, sid, from).run();
      } else {
        await db.prepare(
          `UPDATE student_goal_lines SET name = ?, updated_at = ? WHERE student_id = ? AND name = ?`
        ).bind(to, now, sid, from).run();
      }
      // 注：D1 run() 的 meta.changes 在本地 shim 下不可得，renamed 计数以生产 D1 为准，本地以落库状态验
      const chk = await db.prepare(
        `SELECT id FROM student_goal_lines WHERE student_id = ? AND name = ?`).bind(sid, to).first();
      if (chk) counts.renamed++;
    }
    // —— 新模块四段（按标题去重）——
    for (const m of extras.milestones) {
      const dup = await db.prepare(`SELECT id FROM student_milestones WHERE student_id = ? AND title = ?`).bind(sid, m.title).first();
      if (dup) { counts.milestones.skipped++; continue; }
      await db.prepare(
        `INSERT INTO student_milestones(student_id, date_text, title, detail, kind, sort, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, m.date_text, m.title, m.detail, m.kind, m.sort, now, now).run();
      counts.milestones.inserted++;
    }
    for (const k of extras.keyDates) {
      const dup = await db.prepare(`SELECT id FROM student_key_dates WHERE student_id = ? AND date = ? AND title = ?`).bind(sid, k.date, k.title).first();
      if (dup) { counts.key_dates.skipped++; continue; }
      await db.prepare(
        `INSERT INTO student_key_dates(student_id, date, title, kind, created_at, updated_at) VALUES(?,?,?,?,?,?)`
      ).bind(sid, k.date, k.title, k.kind, now, now).run();
      counts.key_dates.inserted++;
    }
    for (const a of extras.actions) {
      const dup = await db.prepare(`SELECT id FROM student_actions WHERE student_id = ? AND title = ?`).bind(sid, a.title).first();
      if (dup) { counts.actions.skipped++; continue; }
      await db.prepare(
        `INSERT INTO student_actions(student_id, title, detail, due_text, status, sort, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, a.title, a.detail, a.due_text, a.status, a.sort, now, now).run();
      counts.actions.inserted++;
    }
    for (const a of extras.advice) {
      const dup = await db.prepare(`SELECT id FROM student_advice WHERE student_id = ? AND title = ?`).bind(sid, a.title).first();
      if (dup) { counts.advice.skipped++; continue; }
      await db.prepare(
        `INSERT INTO student_advice(student_id, title, body, sort, created_at, updated_at) VALUES(?,?,?,?,?,?)`
      ).bind(sid, a.title, a.body, a.sort, now, now).run();
      counts.advice.inserted++;
    }
    // —— 留言补录（按 sender+body 去重；导师留言 read_by_student=0 待学生读，学生留言视为导师已读场景外慎用）——
    const msgsRaw = Array.isArray(body.messages) ? body.messages : [];
    if (msgsRaw.length > 50) return bad("too many messages (max 50)");
    for (let i = 0; i < msgsRaw.length; i++) {
      const m = msgsRaw[i] || {};
      const sender = m.sender === undefined || m.sender === null || m.sender === "" ? "mentor" : String(m.sender);
      if (!MESSAGE_SENDERS[sender]) return bad("messages[" + i + "] bad sender");
      const text = clampStr(m.body, MESSAGE_MAX_LEN);
      if (!text) return bad("messages[" + i + "].body required");
      const dup = await db.prepare(
        `SELECT id FROM student_messages WHERE student_id = ? AND sender = ? AND body = ?`).bind(sid, sender, text).first();
      if (dup) { counts.messages.skipped++; continue; }
      await db.prepare(
        `INSERT INTO student_messages(student_id, sender, body, created_at, read_by_student, read_by_mentor)
         VALUES(?,?,?,?,?,?)`
      ).bind(sid, sender, text, now, sender === "mentor" ? 0 : 1, sender === "mentor" ? 1 : 0).run();
      counts.messages.inserted++;
    }
    // —— 知识卡（全局库，按标题去重）——
    const knowRaw = Array.isArray(body.knowledge) ? body.knowledge : [];
    if (knowRaw.length > 50) return bad("too many knowledge (max 50)");
    for (let i = 0; i < knowRaw.length; i++) {
      const k = knowRaw[i] || {};
      const title = clampStr(k.title, 120);
      if (!title) return bad("knowledge[" + i + "].title required");
      const itemBody = clampStr(k.body, 4000);
      if (!itemBody) return bad("knowledge[" + i + "].body required");
      const tag = clampStr(k.tag, 40);
      if (!tag) return bad("knowledge[" + i + "].tag required");
      const enabled = k.enabled === undefined || k.enabled === null ? 1 : (k.enabled ? 1 : 0);
      const dup = await db.prepare(`SELECT id FROM knowledge_items WHERE title = ?`).bind(title).first();
      if (dup) { counts.knowledge.skipped++; continue; }
      await db.prepare(
        `INSERT INTO knowledge_items(title, body, tag, enabled, created_at, updated_at) VALUES(?,?,?,?,?,?)`
      ).bind(title, itemBody, tag, enabled, now, now).run();
      counts.knowledge.inserted++;
    }
    // —— 家长三段（v11，按标题去重；留言按 sender+body 去重）——
    // 内容口径：只搬运调用方给的、导师为家长整理好的文本，绝不从学生原始数据自动摘录。
    for (const u of pExtras.parentUpdates) {
      const dup = await db.prepare(`SELECT id FROM parent_updates WHERE student_id = ? AND title = ?`).bind(sid, u.title).first();
      if (dup) { counts.parent_updates.skipped++; continue; }
      await db.prepare(
        `INSERT INTO parent_updates(student_id, update_date, title, body, current_focus, next_step, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, u.update_date, u.title, u.body, u.current_focus, u.next_step, now, now).run();
      counts.parent_updates.inserted++;
      await logEvent(db, sid, "parent_update_published", null, "家长更新发布：" + u.title);
    }
    for (const a of pExtras.parentSupport) {
      const dup = await db.prepare(`SELECT id FROM parent_support_actions WHERE student_id = ? AND title = ?`).bind(sid, a.title).first();
      if (dup) { counts.parent_support_actions.skipped++; continue; }
      await db.prepare(
        `INSERT INTO parent_support_actions(student_id, title, detail, category, due_text, status, sort, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`
      ).bind(sid, a.title, a.detail, a.category, a.due_text, a.status, a.sort, now, now).run();
      counts.parent_support_actions.inserted++;
    }
    for (const m of pExtras.parentMessages) {
      const dup = await db.prepare(
        `SELECT id FROM parent_messages WHERE student_id = ? AND sender = ? AND body = ?`).bind(sid, m.sender, m.body).first();
      if (dup) { counts.parent_messages.skipped++; continue; }
      await db.prepare(
        `INSERT INTO parent_messages(student_id, sender, body, created_at, read_by_parent, read_by_mentor)
         VALUES(?,?,?,?,?,?)`
      ).bind(sid, m.sender, m.body, now, m.sender === "mentor" ? 0 : 1, m.sender === "mentor" ? 1 : 0).run();
      counts.parent_messages.inserted++;
    }
    // —— v12 导师轨迹 + 课程要求集（校验已在上方完成；私密字段夹带已在 norm* 白名单处丢弃）——
    for (const e of tExtras.trail) {
      // 去重口径：同学生 + 同导师 + 同一句话精神视为同一条
      const dup = await db.prepare(
        `SELECT id FROM mentor_trail_entries WHERE student_id = ? AND mentor_name = ? AND spirit_line = ?`
      ).bind(sid, e.mentor_name, e.spirit_line).first();
      if (dup) { counts.trail_entries.skipped++; continue; }
      const due = e.revisit_due || new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      await db.prepare(
        `INSERT INTO mentor_trail_entries(student_id, meeting_id, mentor_name, mentor_role, spirit_line,
          key_judgments, student_takeaway, takeaway_local, followup_actions, revisit_result, revisit_due,
          visibility, source, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(sid, e.meeting_id, e.mentor_name, e.mentor_role, e.spirit_line, e.key_judgments,
        e.takeaway_local ? null : (e.student_takeaway || null), e.takeaway_local, e.followup_actions,
        e.revisit_result, due, e.visibility, e.source, now, now).run();
      counts.trail_entries.inserted++;
      await insertTrailFollowups(db, sid, e.followup_actions, now);
      await logEvent(db, sid, "trail_created", null, "导师轨迹新增：" + (e.spirit_line || e.mentor_name || ""));
    }
    for (const s of rExtras.sets) {
      let setRow = await db.prepare(
        `SELECT id FROM course_requirement_sets WHERE student_id = ? AND name = ?`).bind(sid, s.name).first();
      let setId;
      if (setRow) { setId = setRow.id; counts.requirement_sets.skipped++; }
      else {
        const rr = await db.prepare(
          `INSERT INTO course_requirement_sets(student_id, name, source_note, version_text, verified, sort, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?)`
        ).bind(sid, s.name, s.source_note, s.version_text, s.verified, s.sort, now, now).run();
        setId = rr.meta.last_row_id;
        counts.requirement_sets.inserted++;
      }
      for (const r of s.requirements) {
        const dup = await db.prepare(
          `SELECT id FROM course_requirements WHERE set_id = ? AND course_code = ?`).bind(setId, r.course_code).first();
        if (dup) { counts.requirement_sets.requirements_skipped++; continue; }
        await db.prepare(
          `INSERT INTO course_requirements(set_id, student_id, block, course_code, course_name, credits, min_grade, prereq_codes, sort, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(setId, sid, r.block, r.course_code, r.course_name, r.credits, r.min_grade, r.prereq_codes, r.sort, now, now).run();
        counts.requirement_sets.requirements_inserted++;
      }
    }
    // 家长密钥：存量学生首次补录时顺带生成并回传（后台重置走客户端页 parent_key_rotate）
    const parentKey = await ensureParentKey(db, student);
    return jsonResp(req, { ok: true, student_id: sid, parent_key: parentKey, counts });
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
.pbar{background:#ececf1;border-radius:99px;height:10px;overflow:hidden;margin:4px 0 10px}
.pbar>i{display:block;height:100%;background:#7c3aed;border-radius:99px}
`;
function layout(title, active, body) {
  const tabs = [
    ["/admin", "首页"], ["/admin/leads", "线索"], ["/admin/delivery", "交付"],
    ["/admin/agents", "代理"], ["/admin/orders", "订单"], ["/admin/content", "内容"],
    ["/admin/tasks", "任务"], ["/admin/staff", "人员"], ["/admin/outbox", "导师通知"], ["/admin/knowledge", "知识库"],
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
    <td><a href="/admin/delivery?edit=${s.id}">编辑</a> · <a href="/admin/client/${s.id}">专属客户端</a></td>
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
    const delId = toInt(fd.get("id"), 0);
    // 级联清理该学生在专属客户端模块的四张表，避免留下孤儿数据
    await db.prepare("DELETE FROM student_goals WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM student_status WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM student_courses WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM student_meetings WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM student_exams WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM student_goal_lines WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM student_milestones WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM student_key_dates WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM student_actions WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM student_advice WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM student_messages WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM parent_updates WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM parent_support_actions WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM parent_messages WHERE student_id=?").bind(delId).run();
    // v12：问题方案 / 导师轨迹 / 课程要求集与要求条目一并清理
    await db.prepare("DELETE FROM student_problem_shares WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM mentor_trail_entries WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM course_requirements WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM course_requirement_sets WHERE student_id=?").bind(delId).run();
    // v13：一句话 / 发件箱 / 事件流一并清理
    await db.prepare("DELETE FROM note_to_parents WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM notifications_outbox WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM student_events WHERE student_id=?").bind(delId).run();
    await db.prepare("DELETE FROM students WHERE id=?").bind(delId).run();
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
    <td><a href="/admin/delivery?edit=${s.id}">去交付页</a> · <a href="/admin/client/${s.id}">专属客户端</a></td></tr>`;
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
  // v13：编辑导师档案时补齐工作台密钥，页面展示工作台链接（可重置）
  if (edit) await ensureMentorKey(db, edit);
  const f = edit || { name: "", kind: "human", emp_no: "", platform: "", job_function: "", persona: "", accountable: "", role: "", contact: "", start_date: "", status: "active", note: "", specialty: "", contact_email: "", contact_phone: "", contact_wechat: "", notify_channel: "", mentor_status: "" };
  const mentorKeyBlock = edit ? `
  <div class="card"><h2>导师工作台（v13）</h2>
  <p class="mut">本期口径：每位导师一个专属密钥链接（与学生/家长密钥互不通用，交叉访问 404），不做账号体系。
  工作台链接：<code>/one-on-one-app/mentor.html?s=${esc(edit.emp_no || String(edit.id))}&amp;k=${esc(edit.mentor_key || "")}</code>
  ｜ 导师通知状态：${mentorNotifiable(edit) ? '<span class="ok">可通知</span>' : '<span class="bad">不可通知</span>（未登记/未核验或缺联系方式）'}</p>
  <form method="post" onsubmit="return confirm('重置后旧工作台链接立即失效，确定？')">
    <input type="hidden" name="action" value="mentor_key_rotate"><input type="hidden" name="id" value="${edit.id}">
    <button class="small danger" type="submit">重置工作台密钥</button></form></div>` : "";
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
    <td>${(s.mentor_status || s.kind === "mentor") ? (mentorNotifiable(s) ? '<span class="ok">导师·可通知</span>' : '<span class="bad">不可通知</span>') : '<span class="mut">—</span>'}</td>
    <td>${esc((s.note || "").slice(0, 40))}</td>
    <td><a href="/admin/staff?reviews=${s.id}">考核</a></td>
    <td><a href="/admin/staff?edit=${s.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条人员档案？（考核记录不会自动删除）')">
      <input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${s.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const body = `
  ${reviewsHtml}
  ${mentorKeyBlock}
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
    <h3>导师注册（v13：仅导师填写；姓名必填、联系方式至少一项，否则标「不可通知」）</h3>
    <div class="row">
      <div style="flex:2"><label>专长标签</label><input name="specialty" maxlength="120" value="${esc(f.specialty || "")}" placeholder="如 护理 / 考试策略 / 创业"></div>
      <div><label>导师状态</label><select name="mentor_status"><option value="">未登记</option>${opts(MENTOR_STATUSES, f.mentor_status || "")}</select></div>
      <div><label>通知偏好渠道</label><select name="notify_channel"><option value="">未定</option>${opts(NOTIFY_CHANNELS, f.notify_channel || "")}</select></div>
    </div>
    <div class="row">
      <div><label>导师邮箱</label><input name="contact_email" maxlength="80" value="${esc(f.contact_email || "")}"></div>
      <div><label>导师电话</label><input name="contact_phone" maxlength="40" value="${esc(f.contact_phone || "")}"></div>
      <div><label>导师微信</label><input name="contact_wechat" maxlength="60" value="${esc(f.contact_wechat || "")}"></div>
    </div>
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
  <table><tr><th>工号</th><th>姓名</th><th>体系</th><th>职能</th><th>责任人</th><th>联系方式</th><th>入职日期</th><th>状态</th><th>导师</th><th>备注</th><th></th><th></th><th></th></tr>
  ${rowHtml || `<tr><td colspan="13" class="mut">暂无人员档案</td></tr>`}</table></div></div>`;
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
  // v13：导师工作台密钥重置（旧链接立即失效）；查看/生成走人员页渲染时 ensureMentorKey
  if (action === "mentor_key_rotate") {
    const id = toInt(fd.get("id"), 0);
    if (id) {
      await db.prepare("UPDATE staff SET mentor_key = ? WHERE id = ?").bind(genMentorKey(), id).run();
    }
    return redirect("/admin/staff?edit=" + id);
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
  // v13 导师注册字段（仅 kind=mentor 或显式填报导师状态时写入；其余归集到 staff 表新列，空 = 未登记）
  const specialty = clampStr(fd.get("specialty"), 120) || null;
  const contactEmail = clampStr(fd.get("contact_email"), 80) || null;
  const contactPhone = clampStr(fd.get("contact_phone"), 40) || null;
  const contactWechat = clampStr(fd.get("contact_wechat"), 60) || null;
  const notifyChannel = NOTIFY_CHANNELS[fd.get("notify_channel")] ? String(fd.get("notify_channel")) : null;
  const mentorStatus = MENTOR_STATUSES[fd.get("mentor_status")] ? String(fd.get("mentor_status")) : null;
  if (action === "update") {
    const id = toInt(fd.get("id"), 0);
    const existing = id ? await db.prepare("SELECT emp_no FROM staff WHERE id=?").bind(id).first() : null;
    if (!empNo) empNo = (existing && existing.emp_no) || (await nextEmpNo(db, kind, jobFunction));
    await db.prepare("UPDATE staff SET name=?, kind=?, emp_no=?, platform=?, job_function=?, role=?, contact=?, start_date=?, status=?, note=?, persona=?, accountable=?, specialty=?, contact_email=?, contact_phone=?, contact_wechat=?, notify_channel=?, mentor_status=? WHERE id=?")
      .bind(name, kind, empNo, platform, jobFunction, role, contact, startDate, status, note, persona, accountable,
        specialty, contactEmail, contactPhone, contactWechat, notifyChannel, mentorStatus, id).run();
  } else {
    if (!empNo) empNo = await nextEmpNo(db, kind, jobFunction);
    await db.prepare("INSERT INTO staff(name, kind, emp_no, platform, job_function, role, contact, start_date, status, note, persona, accountable, created_at, specialty, contact_email, contact_phone, contact_wechat, notify_channel, mentor_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(name, kind, empNo, platform, jobFunction, role, contact, startDate, status, note, persona, accountable, nowIso(),
        specialty, contactEmail, contactPhone, contactWechat, notifyChannel, mentorStatus).run();
  }
  return redirect("/admin/staff");
}

// ===== 导师通知发件箱（v13）=====
/* 触达口径：email 渠道导师（notify_channel=email 且有邮箱）在配置 RESEND_API_KEY 后由
 * 系统自动发邮件（v16，状态显示「已转达（系统邮件）」）；其余渠道的通知实际触达 =
 * 本发件箱队列 + 后台醒目呈现 + 创始人每日简报（含 summary.outbox 计数），由创始人用
 * 登记的联系方式转达。
 * 状态：queued 待转达 / sent 已转达 / responded 导师已回复（系统自动推进）。
 * 本页与 summaries 只记元数据（收件导师、渠道、事件摘要、时间），不含私密正文。 */
async function pageOutbox(env, url) {
  const db = env.DB;
  const counts = { queued: 0, sent: 0, responded: 0 };
  const cRows = (await db.prepare(
    `SELECT status, COUNT(*) AS n FROM notifications_outbox GROUP BY status`).all()).results || [];
  for (const r of cRows) if (r.status in counts) counts[r.status] = r.n;
  const rows = (await db.prepare(
    `SELECT o.*, s.name AS mentor_name, s.emp_no AS mentor_emp_no, st.name AS student_name
     FROM notifications_outbox o
     LEFT JOIN staff s ON s.id = o.mentor_staff_id
     LEFT JOIN students st ON st.id = o.student_id
     ORDER BY o.id DESC LIMIT 200`).all()).results || [];
  const rowHtml = rows.map((o) => `<tr>
    <td>${o.id}</td><td>${esc(o.created_at || "")}</td>
    <td>${esc(o.mentor_name || "—")}（${esc(o.mentor_emp_no || "")}）</td>
    <td>${esc(o.student_name || ("#" + o.student_id))}</td>
    <td>${esc(NOTIFY_CHANNELS[o.channel] || o.channel || "—")}</td>
    <td>${esc(EVENT_TYPES[o.event_type] || o.event_type || "")}</td>
    <td>${esc(o.summary || "")}</td>
    <td>${o.status === "queued" ? '<span class="warn">待转达</span>' : o.status === "sent" ? (o.auto_sent ? '<span class="ok">已转达（系统邮件）</span>' : '<span class="ok">已转达</span>') : '<span class="ok">已回复</span>'}</td>
    <td>${o.status === "queued" ? `<form method="post" style="margin:0">
      <input type="hidden" name="action" value="outbox_mark_sent"><input type="hidden" name="id" value="${o.id}">
      <button class="small" type="submit">标记已转达</button></form>` : ""}</td></tr>`).join("");
  // —— 导师维度汇总：名下学生 / 未回复留言数 / 待回看数 ——
  const mentors = (await db.prepare(
    `SELECT * FROM staff WHERE mentor_status IS NOT NULL AND mentor_status != '' OR kind = 'mentor' ORDER BY id ASC LIMIT 100`).all()).results || [];
  const mentorRows = [];
  for (const m of mentors) {
    const stuRows = (await db.prepare(
      `SELECT id, name FROM students WHERE mentor_id = ? ORDER BY id ASC`).bind(m.id).all()).results || [];
    let unread = 0, revisit = 0, queued = 0;
    for (const s of stuRows) {
      const u = await db.prepare(
        `SELECT COUNT(*) AS n FROM student_messages WHERE student_id = ? AND sender='student' AND read_by_mentor = 0`).bind(s.id).first();
      unread += u ? u.n : 0;
      const rv = await db.prepare(
        `SELECT COUNT(*) AS n FROM mentor_trail_entries WHERE student_id = ? AND (revisit_result IS NULL OR revisit_result = '')`).bind(s.id).first();
      revisit += rv ? rv.n : 0;
    }
    const q = await db.prepare(
      `SELECT COUNT(*) AS n FROM notifications_outbox WHERE mentor_staff_id = ? AND status = 'queued'`).bind(m.id).first();
    queued = q ? q.n : 0;
    mentorRows.push(`<tr><td>${esc(m.name || "")}（${esc(m.emp_no || "")}）</td>
      <td>${mentorNotifiable(m) ? '<span class="ok">可通知</span>' : '<span class="bad">不可通知</span>'}</td>
      <td>${stuRows.map((s) => esc(s.name || ("#" + s.id))).join("、") || "—"}</td>
      <td>${unread}</td><td>${revisit}</td><td>${queued}</td></tr>`);
  }
  const body = `
  <div class="card"><h2>导师通知发件箱（v13）</h2>
  <p class="mut">现状触达：通知偏好为邮箱且留有邮箱的导师，在系统配好发信密钥后由系统自动发邮件（状态「已转达（系统邮件）」）；其余渠道仍为发件箱队列 + 本页呈现 + 创始人每日简报计数，创始人按登记联系方式转达后手动标记「已转达」。
  queued 表示待转达，不等于已通知到人。导师在工作台或后台回复后自动推进为「已回复」。</p>
  <p>待转达 <b>${counts.queued}</b> ｜ 已转达 <b>${counts.sent}</b> ｜ 已回复 <b>${counts.responded}</b></p>
  <div class="wrap"><table><tr><th>#</th><th>时间</th><th>收件导师</th><th>学生</th><th>渠道</th><th>事件</th><th>摘要</th><th>状态</th><th></th></tr>
  ${rowHtml || `<tr><td colspan="9" class="mut">暂无通知记录</td></tr>`}</table></div></div>
  <div class="card"><h2>导师汇总</h2>
  <div class="wrap"><table><tr><th>导师</th><th>通知状态</th><th>名下学生</th><th>未回复留言</th><th>待回看轨迹</th><th>待转达通知</th></tr>
  ${mentorRows.join("") || `<tr><td colspan="6" class="mut">暂无已登记导师</td></tr>`}</table></div></div>`;
  return htmlResp(layout("导师通知", "/admin/outbox", body));
}
async function postOutbox(req, env) {
  const db = env.DB;
  const fd = await req.formData();
  if (String(fd.get("action") || "") === "outbox_mark_sent") {
    await db.prepare(
      `UPDATE notifications_outbox SET status = 'sent', updated_at = ? WHERE id = ? AND status = 'queued'`
    ).bind(nowIso(), toInt(fd.get("id"), 0)).run();
  }
  return redirect("/admin/outbox");
}

// ===== 知识库（v10：全局知识卡，导师维护，学生端按主题匹配下发）=====
async function pageKnowledge(env, url) {
  const db = env.DB;
  const items = (await db.prepare("SELECT * FROM knowledge_items ORDER BY id ASC LIMIT 500").all()).results || [];
  const editId = toInt(url.searchParams.get("edit"), 0);
  const editItem = editId ? items.find((k) => k.id === editId) : null;
  const kf = editItem || { title: "", body: "", tag: "", enabled: 1 };
  const rows = items.map((k) => `<tr>
    <td>${esc(k.title || "")}</td><td><span class="pill">${esc(k.tag || "")}</span></td>
    <td>${k.enabled ? '<span class="ok">启用</span>' : '<span class="mut">停用</span>'}</td>
    <td>${esc((k.body || "").slice(0, 60))}${(k.body || "").length > 60 ? "…" : ""}</td>
    <td><a href="/admin/knowledge?edit=${k.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条知识卡？')">
      <input type="hidden" name="action" value="knowledge_delete"><input type="hidden" name="id" value="${k.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const body = `
  <div class="card"><h2>知识库（全局知识卡）</h2>
  <p class="mut">标签 tag 与学生主题匹配后下发到学生端 APP「导师 · 知识卡」：可用人生线类型 main / parallel / passive，
  或主题 exam（考试）/ study（学业）/ business（创业）。停用的条目不下发；每名学生最多下发 ${KNOWLEDGE_LIMIT} 条。</p>
  <h3>${editItem ? "编辑知识卡 #" + editItem.id : "新增知识卡"}</h3>
  <form method="post">
    <input type="hidden" name="action" value="${editItem ? "knowledge_update" : "knowledge_add"}">
    ${editItem ? `<input type="hidden" name="id" value="${editItem.id}">` : ""}
    <div class="row">
      <div style="flex:2"><label>标题 *</label><input name="title" required maxlength="120" value="${esc(kf.title || "")}"></div>
      <div><label>标签 tag *</label><input name="tag" required maxlength="40" value="${esc(kf.tag || "")}" placeholder="如 study / exam / business"></div>
      <div><label>状态</label><select name="enabled">
        <option value="1"${kf.enabled ? " selected" : ""}>启用</option>
        <option value="0"${kf.enabled ? "" : " selected"}>停用</option></select></div>
    </div>
    <label>正文 *</label><textarea name="body" required maxlength="4000">${esc(kf.body || "")}</textarea>
    <button type="submit">${editItem ? "保存修改" : "添加知识卡"}</button>
    ${editItem ? `<a class="btn ghost" href="/admin/knowledge">取消编辑</a>` : ""}
  </form>
  ${items.length ? `<div class="wrap"><table><tr><th>标题</th><th>标签</th><th>状态</th><th>正文</th><th></th><th></th></tr>${rows}</table></div>` : `<p class="mut">暂无知识卡。</p>`}
  </div>`;
  return htmlResp(layout("知识库", "/admin/knowledge", body));
}
async function postKnowledge(req, env) {
  const db = env.DB;
  const fd = await req.formData();
  const action = String(fd.get("action") || "");
  if (action === "knowledge_add" || action === "knowledge_update") {
    const title = clampStr(fd.get("title"), 120);
    const body = clampStr(fd.get("body"), 4000);
    const tag = clampStr(fd.get("tag"), 40);
    if (!title || !body || !tag) return redirect("/admin/knowledge");
    const enabled = String(fd.get("enabled") || "1") === "0" ? 0 : 1;
    if (action === "knowledge_update") {
      await db.prepare("UPDATE knowledge_items SET title=?, body=?, tag=?, enabled=?, updated_at=? WHERE id=?")
        .bind(title, body, tag, enabled, nowIso(), toInt(fd.get("id"), 0)).run();
    } else {
      await db.prepare("INSERT INTO knowledge_items(title, body, tag, enabled, created_at, updated_at) VALUES(?,?,?,?,?,?)")
        .bind(title, body, tag, enabled, nowIso(), nowIso()).run();
    }
    return redirect("/admin/knowledge");
  }
  if (action === "knowledge_delete") {
    await db.prepare("DELETE FROM knowledge_items WHERE id=?").bind(toInt(fd.get("id"), 0)).run();
    return redirect("/admin/knowledge");
  }
  return redirect("/admin/knowledge");
}

// ===== 学生专属客户端（一对一工作台 v6：目标 / 状态快照 / 选课规划 / 辅导会议）=====
// 直达页 /admin/client/<学生id>，仍走后台登录鉴权；数据只落本模块四张表，与交付阶段不联动。
async function pageClient(env, url, sid) {
  const db = env.DB;
  const student = sid ? await db.prepare("SELECT * FROM students WHERE id=?").bind(sid).first() : null;
  if (!student) {
    return htmlResp(layout("专属客户端", "/admin/delivery",
      `<div class="card"><h2>学生专属客户端</h2><p class="mut">未找到该学生（学生 #${sid} 不存在）。<a href="/admin/delivery">返回交付页</a></p></div>`));
  }
  if (!student.slug) student.slug = await ensureStudentSlug(db, student); // v8：打开页面时补齐专属名
  // v13：默认导师 + 事件时间线数据（时间线只含方案层事件的 类型/时间/摘要，私密层零服务器数据不进流）
  const curMentor = student.mentor_id
    ? await db.prepare("SELECT * FROM staff WHERE id=?").bind(student.mentor_id).first() : null;
  const mentorOptions = (await db.prepare(
    "SELECT * FROM staff WHERE status NOT IN ('offboarded','left') ORDER BY id ASC LIMIT 200").all()).results || [];
  const mentorCardHtml = `
  <div class="card"><h2>默认导师（v13）</h2>
  <p class="mut">学生端留言与问题升级的目标导师。当前：${curMentor
    ? esc(curMentor.name || "") + "（" + esc(curMentor.emp_no || "") + "）" +
      (mentorNotifiable(curMentor) ? ' <span class="ok">可通知</span>' : ' <span class="bad">不可通知</span>（未登记/未核验或缺联系方式，学生留言会被拒绝）')
    : '<span class="warn">未分配</span>（存量口径：留言落库但无导师通知）'}</p>
  <form method="post"><input type="hidden" name="action" value="student_mentor_set">
    <div class="row"><div style="flex:2"><label>选择导师</label><select name="mentor_staff_id">
      <option value="0">（不分配）</option>
      ${mentorOptions.map((m) => `<option value="${m.id}"${student.mentor_id === m.id ? " selected" : ""}>${esc(m.name || "")}（${esc(m.emp_no || "")}）${mentorNotifiable(m) ? "" : " · 不可通知"}</option>`).join("")}
    </select></div><div><label>&nbsp;</label><button type="submit">保存导师</button></div></div>
  </form></div>`;
  // v15：专题导师指派管理——候选 = 已登记导师且有工作台密钥，排除主导师本人（主视图已全量）
  // 与已指派者。外部导师（学生自带）走同一流程：先在人员页建档登记、生成工作台密钥，
  // 再回到本页指派，无特殊通道。
  const topicAssignRows = await topicAssignmentsOf(db, sid);
  const topicCandidates = mentorOptions.filter((m) =>
    isTopicMentorCandidate(m) && m.id !== student.mentor_id &&
    !topicAssignRows.some((r) => r.staff_id === m.id));
  const topicMentorCardHtml = `
  <div class="card"><h2>专题导师（v15 · 多导师）</h2>
  <p class="mut">主导师唯一负责全量；专题导师只看与自己往来的留言线程和本人轨迹，看不到目标、考试、选课、状态与家长线。外部导师（学生自带）同样先在<a href="/admin/staff">人员页</a>建档登记并生成工作台密钥，再回到这里指派。</p>
  ${topicAssignRows.length ? `<div class="wrap"><table><tr><th>导师</th><th>编号</th><th>专题</th><th></th></tr>${topicAssignRows.map((r) => `<tr><td>${esc(r.staff_name || "")}</td><td>${esc(r.staff_emp_no || "")}</td><td>${esc(r.topic || "")}</td><td><form method="post" style="margin:0" onsubmit="return confirm('确定移除该专题导师指派？移除后该导师立即无法再看这名学生。')"><input type="hidden" name="action" value="topic_mentor_remove"><input type="hidden" name="id" value="${r.assign_id}"><button class="small danger" type="submit">移除</button></form></td></tr>`).join("")}</table></div>` : `<p class="mut">暂未指派专题导师。</p>`}
  <form method="post"><input type="hidden" name="action" value="topic_mentor_add">
    <div class="row"><div style="flex:2"><label>选择专题导师（已登记且有工作台密钥）</label><select name="topic_staff_id">
      ${topicCandidates.length ? topicCandidates.map((m) => `<option value="${m.id}">${esc(m.name || "")}（${esc(m.emp_no || "")}）</option>`).join("") : `<option value="0">（暂无候选：请先在人员页登记导师并生成工作台密钥）</option>`}
    </select></div><div style="flex:2"><label>专题名 *</label><input name="topic" required maxlength="40" placeholder="如 创业 / 护理考试 / 文书"></div><div><label>&nbsp;</label><button type="submit">添加指派</button></div></div>
  </form></div>`;
  const evRows13 = (await db.prepare(
    `SELECT * FROM student_events WHERE student_id = ? ORDER BY id DESC LIMIT 100`).bind(sid).all()).results || [];
  const timelineHtml = `
  <div class="card"><h2>事件时间线（v13 · 方案层）</h2>
  <p class="mut">只记事件类型、时间与一句摘要；私密层内容（本地私密空间）零服务器数据，永不进入本流。</p>
  <div class="wrap"><table><tr><th>时间</th><th>事件</th><th>摘要</th><th>对象</th></tr>
  ${evRows13.map((e) => `<tr><td>${esc(e.created_at || "")}</td><td>${esc(EVENT_TYPES[e.event_type] || e.event_type || "")}</td><td>${esc(e.summary || "")}</td><td>#${e.object_id === null || e.object_id === undefined ? "—" : e.object_id}</td></tr>`).join("") || `<tr><td colspan="4" class="mut">暂无事件</td></tr>`}
  </table></div></div>`;
  const nowMs = Date.now();
  const stageDays = daysInStage(student.stage_since, nowMs);
  const goal = await db.prepare("SELECT * FROM student_goals WHERE student_id=?").bind(sid).first();
  const g = goal || { target_school: "", target_term: "", gpa_target: "", goal_note: "", school_system: "" };
  const allStudents = (await db.prepare("SELECT id, name FROM students ORDER BY id DESC LIMIT 300").all()).results || [];
  const snaps = (await db.prepare(
    "SELECT * FROM student_status WHERE student_id=? ORDER BY snapshot_date DESC, id DESC LIMIT 100").bind(sid).all()).results || [];
  const latest = snaps[0] || null;
  const courses = (await db.prepare(
    "SELECT * FROM student_courses WHERE student_id=? ORDER BY id ASC LIMIT 500").bind(sid).all()).results || [];
  const prog = courseProgress(courses);
  const groups = groupCoursesByTerm(courses);
  const meetings = (await db.prepare(
    "SELECT * FROM student_meetings WHERE student_id=? ORDER BY meeting_date DESC, id DESC LIMIT 200").bind(sid).all()).results || [];
  const exams = (await db.prepare(
    "SELECT * FROM student_exams WHERE student_id=? ORDER BY exam_date DESC, id DESC LIMIT 200").bind(sid).all()).results || [];
  const goalLines = (await db.prepare(
    "SELECT * FROM student_goal_lines WHERE student_id=? ORDER BY priority ASC, id ASC LIMIT 100").bind(sid).all()).results || [];
  // —— v10 查询 ——
  const milestones = (await db.prepare(
    "SELECT * FROM student_milestones WHERE student_id=? ORDER BY sort ASC, id ASC LIMIT 200").bind(sid).all()).results || [];
  const keyDates = (await db.prepare(
    "SELECT * FROM student_key_dates WHERE student_id=? ORDER BY date ASC, id ASC LIMIT 100").bind(sid).all()).results || [];
  const actionRows = (await db.prepare(
    "SELECT * FROM student_actions WHERE student_id=? ORDER BY sort ASC, id ASC LIMIT 200").bind(sid).all()).results || [];
  const adviceRows = (await db.prepare(
    "SELECT * FROM student_advice WHERE student_id=? ORDER BY created_at DESC, id DESC LIMIT 100").bind(sid).all()).results || [];
  const messageRows = (await db.prepare(
    "SELECT * FROM student_messages WHERE student_id=? ORDER BY id ASC LIMIT 500").bind(sid).all()).results || [];
  const unreadStudentMsgs = messageRows.filter((m) => m.sender === "student" && !m.read_by_mentor).length;
  if (unreadStudentMsgs) {
    await db.prepare(
      "UPDATE student_messages SET read_by_mentor = 1 WHERE student_id = ? AND sender = 'student' AND read_by_mentor = 0"
    ).bind(sid).run();
  }
  // —— v11 家长端查询 ——
  const parentUpdates = (await db.prepare(
    "SELECT * FROM parent_updates WHERE student_id=? ORDER BY update_date DESC, id DESC LIMIT 200").bind(sid).all()).results || [];
  const parentConcerns = (await db.prepare(
    "SELECT * FROM parent_concerns WHERE student_id=? ORDER BY concern_date DESC, id DESC LIMIT 100").bind(sid).all()).results || [];
  const parentSupport = (await db.prepare(
    "SELECT * FROM parent_support_actions WHERE student_id=? ORDER BY sort ASC, id ASC LIMIT 200").bind(sid).all()).results || [];
  const parentMsgs = (await db.prepare(
    "SELECT * FROM parent_messages WHERE student_id=? ORDER BY id ASC LIMIT 500").bind(sid).all()).results || [];
  const unreadParentMsgs = parentMsgs.filter((m) => m.sender === "parent" && !m.read_by_mentor).length;
  if (unreadParentMsgs) {
    await db.prepare(
      "UPDATE parent_messages SET read_by_mentor = 1 WHERE student_id = ? AND sender = 'parent' AND read_by_mentor = 0"
    ).bind(sid).run();
  }
  // —— v12 查询：问题方案层 / 导师轨迹 / 课程要求集 ——
  const problemShares = (await db.prepare(
    "SELECT * FROM student_problem_shares WHERE student_id=? ORDER BY id DESC LIMIT 100").bind(sid).all()).results || [];
  const trailEntries = (await db.prepare(
    `SELECT t.*, m.meeting_date AS m_date, m.topic AS m_topic FROM mentor_trail_entries t
     LEFT JOIN student_meetings m ON m.id = t.meeting_id
     WHERE t.student_id=? ORDER BY t.id DESC LIMIT 200`).bind(sid).all()).results || [];
  const reqSets = (await db.prepare(
    "SELECT * FROM course_requirement_sets WHERE student_id=? ORDER BY sort ASC, id ASC LIMIT 20").bind(sid).all()).results || [];
  const reqRowsBySet = {};
  if (reqSets.length) {
    const allReqs = (await db.prepare(
      "SELECT * FROM course_requirements WHERE student_id=? ORDER BY sort ASC, id ASC LIMIT 1000").bind(sid).all()).results || [];
    for (const r of allReqs) { (reqRowsBySet[r.set_id] = reqRowsBySet[r.set_id] || []).push(r); }
  }

  const bar = (done, total) => {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return `<div class="pbar"><i style="width:${pct}%"></i></div>`;
  };
  // —— 顶部总览（数据集标识：学生姓名 + 学校体系标签 + 学生切换）——
  const switcherOpts = allStudents.map((s) =>
    `<option value="${s.id}"${s.id === sid ? " selected" : ""}>${esc(s.name)}</option>`).join("");
  const hero = `
  <div class="card"><h2>${esc(student.name)} · 专属客户端 ${g.school_system ? `<span class="pill">${esc(g.school_system)}</span>` : ""}</h2>
  <div class="row" style="align-items:end">
    <div><label>切换学生（数据集）</label>
    <select onchange="if(this.value)location.href='/admin/client/'+this.value">${switcherOpts}</select></div>
    <div><label>当前数据集</label><p style="margin:6px 0 10px">学生 #${sid}${g.school_system ? " · 体系：" + esc(g.school_system) : " · 体系未标注（在下方目标区填写）"}</p></div>
  </div>
  <div class="grid">
    <div class="stat"><div class="l">目标学校 / 项目</div><div class="n" style="font-size:17px">${esc(g.target_school || "待定")}</div></div>
    <div class="stat"><div class="l">目标入学季</div><div class="n" style="font-size:17px">${esc(g.target_term || "待定")}</div></div>
    <div class="stat"><div class="l">目标 GPA</div><div class="n" style="font-size:17px">${esc(g.gpa_target || "—")}</div></div>
    <div class="stat"><div class="l">最新 GPA（${latest ? esc(latest.snapshot_date || "") : "暂无快照"}）</div><div class="n" style="font-size:17px">${latest && latest.gpa !== null && latest.gpa !== undefined ? latest.gpa : "—"}</div></div>
    <div class="stat"><div class="l">学分进度（最新快照）</div><div class="n" style="font-size:17px">${latest ? `${latest.credits_done ?? "—"} / ${latest.credits_total ?? "—"}` : "—"}</div></div>
    <div class="stat"><div class="l">交付阶段</div><div class="n" style="font-size:17px">${esc(DELIVERY_STAGES[student.stage] || student.stage || "—")}</div><div class="l">${stageDays === null ? "" : "已停留 " + stageDays + " 天"}${student.package ? " · " + esc(student.package) : ""}</div></div>
  </div>
  ${g.goal_note ? `<p style="white-space:pre-wrap">${esc(g.goal_note)}</p>` : ""}
  ${goalLines.length ? `<p>当前主线（优先级 ${goalLines[0].priority}）：<strong>${esc(goalLines[0].name || "")}</strong>（${esc(LINE_TYPES[goalLines[0].line_type] || goalLines[0].line_type || "")} · ${esc(LINE_STATUSES[goalLines[0].status] || goalLines[0].status || "")}）${goalLines[0].next_step ? " · 下一步：" + esc(goalLines[0].next_step) : ""} <span class="mut">共 ${goalLines.length} 条线，详见下方目标区</span></p>` : ""}
  <p class="mut"><a href="/admin/delivery">← 返回交付页</a>${student.lead_id ? ` · <a href="/admin/user?id=${student.lead_id}">查看用户档案</a>` : ""}</p>
  <div style="border-top:1px solid #eee;margin-top:10px;padding-top:10px">
    <p style="margin:4px 0"><strong>学生端 APP（只读）</strong> <span class="mut">学生用专属链接打开自己的客户端，只能看不能改；编辑仍在本页。</span></p>
    ${student.client_key
      ? `<p class="mut" style="margin:4px 0">访问密钥：<code>${esc(student.client_key)}</code><br>专属链接（推荐，用专属名）：<code>https://zhuanuc.com/one-on-one-app/?s=${esc(student.slug || "")}&amp;k=${esc(student.client_key)}</code><br>备用链接（用编号）：<code>https://zhuanuc.com/one-on-one-app/?s=${sid}&amp;k=${esc(student.client_key)}</code></p>`
      : `<p class="mut" style="margin:4px 0">尚未生成访问密钥，生成后把专属链接发给学生即可。专属名：<code>${esc(student.slug || "")}</code></p>`}
    <form method="post" style="margin:6px 0 0" onsubmit="return confirm('${student.client_key ? "重置后旧链接立即失效，确定重置访问密钥？" : "确定生成访问密钥？"}')">
      <input type="hidden" name="action" value="key_rotate">
      <button class="small ghost" type="submit">${student.client_key ? "重置密钥" : "生成访问密钥"}</button>
    </form>
    <div style="border-top:1px dashed #eee;margin-top:10px;padding-top:8px">
      <p style="margin:4px 0"><strong>专属签名</strong> <span class="mut">学生在 APP 的「每日一句」里自选确认一次后固定；导师可在此改或清空（清空后学生可重新选）。</span></p>
      ${student.signature
        ? `<p class="mut" style="margin:4px 0">当前签名：<strong>${esc(student.signature)}</strong>${student.signature_set_at ? `（确认于 ${esc(String(student.signature_set_at).slice(0, 10))}）` : ""}</p>`
        : `<p class="mut" style="margin:4px 0">尚未设置——学生在 APP 打开「每日一句」时会看到按其目标生成的 3 个候选，自选其一确认。</p>`}
      <form method="post" style="margin:6px 0 0">
        <input type="hidden" name="action" value="signature_save">
        <input name="signature" maxlength="30" value="${esc(student.signature || "")}" placeholder="输入签名（≤30 字），留空保存 = 清空" style="min-width:260px">
        <button class="small" type="submit">保存签名</button>
      </form>
    </div>
    <div style="border-top:1px dashed #eee;margin-top:10px;padding-top:8px">
      <p style="margin:4px 0"><strong>导师寄语与愿景</strong> <span class="mut">寄语显示在学生端 APP 首页顶部（带日期），愿景显示在「规划」页愿景板；都为空则不显示。请只写导师本人要说的话，不要代拟。</span></p>
      ${student.mentor_message
        ? `<p class="mut" style="margin:4px 0">当前寄语：<strong>${esc(student.mentor_message)}</strong>${student.mentor_message_at ? `（${esc(String(student.mentor_message_at).slice(0, 10))}）` : ""}</p>`
        : `<p class="mut" style="margin:4px 0">尚未写寄语。</p>`}
      <form method="post" style="margin:6px 0 0">
        <input type="hidden" name="action" value="profile_save">
        <label>导师寄语（留空保存 = 清空）</label>
        <textarea name="mentor_message" maxlength="2000" placeholder="写给这个学生的话，会原样出现在 TA 的 APP 首页">${esc(student.mentor_message || "")}</textarea>
        <label>愿景（vision，终点画面一句话，留空 = 不显示愿景板文字）</label>
        <textarea name="vision_text" maxlength="2000" placeholder="如 BSN + NCLEX-RN → 空军护理军官">${esc(student.vision_text || "")}</textarea>
        <button class="small" type="submit">保存寄语与愿景</button>
      </form>
    </div>
  </div></div>`;
  // —— 目标 ——
  // —— 目标（多条人生线 + 学业目标详情）——
  const editLineId = toInt(url.searchParams.get("edit_line"), 0);
  const editLine = editLineId ? goalLines.find((l) => l.id === editLineId) : null;
  const lf = editLine || { name: "", line_type: "parallel", priority: goalLines.length + 1, status: "active", next_step: "" };
  const lineRows = goalLines.map((l) => `<tr>
    <td>${l.priority ?? ""}</td><td>${esc(l.name || "")}</td>
    <td><span class="pill">${esc(LINE_TYPES[l.line_type] || l.line_type || "")}</span></td>
    <td>${esc(LINE_STATUSES[l.status] || l.status || "")}</td>
    <td>${esc(l.next_step || "—")}</td>
    <td><a href="/admin/client/${sid}?edit_line=${l.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条目标线？')">
      <input type="hidden" name="action" value="line_delete"><input type="hidden" name="id" value="${l.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const goalCard = `
  <div class="card"><h2>目标（人生线）</h2>
  ${goalLines.length ? `<div class="wrap"><table><tr><th>优先级</th><th>名称</th><th>类型</th><th>状态</th><th>下一步</th><th></th><th></th></tr>${lineRows}</table></div>` : `<p class="mut">暂无目标线，用下方表单添加第一条。</p>`}
  <h3>${editLine ? "编辑目标线 #" + editLine.id : "新增目标线"}</h3>
  <form method="post">
    <input type="hidden" name="action" value="${editLine ? "line_update" : "line_add"}">
    ${editLine ? `<input type="hidden" name="id" value="${editLine.id}">` : ""}
    <div class="row">
      <div style="flex:2"><label>名称 *</label><input name="name" required maxlength="80" value="${esc(lf.name || "")}" placeholder="这条线的名称"></div>
      <div><label>类型</label><select name="line_type">${opts(LINE_TYPES, lf.line_type || "parallel")}</select></div>
      <div><label>优先级（小的在前）</label><input name="priority" type="number" min="1" max="99" value="${esc(lf.priority ?? 1)}"></div>
      <div><label>状态</label><select name="status">${opts(LINE_STATUSES, lf.status || "active")}</select></div>
    </div>
    <label>下一步</label><input name="next_step" maxlength="200" value="${esc(lf.next_step || "")}" placeholder="这条线眼下要推进的一步">
    <button type="submit">${editLine ? "保存修改" : "添加目标线"}</button>
    ${editLine ? `<a class="btn ghost" href="/admin/client/${sid}">取消编辑</a>` : ""}
  </form>
  <h3>学业目标详情（学校 / 项目 / 入学季）</h3>
  <form method="post">
    <input type="hidden" name="action" value="goal_save">
    <div class="row">
      <div><label>目标学校 / 项目</label><input name="target_school" maxlength="120" value="${esc(g.target_school || "")}" placeholder="目标学校 + 目标项目名称"></div>
      <div><label>目标入学季</label><input name="target_term" maxlength="40" value="${esc(g.target_term || "")}" placeholder="如 2027-Fall"></div>
      <div><label>目标 GPA</label><input name="gpa_target" maxlength="10" value="${esc(g.gpa_target || "")}" placeholder="如 3.5"></div>
      <div><label>学校体系</label><input name="school_system" maxlength="40" list="school-systems" value="${esc(g.school_system || "")}" placeholder="如 UC / CC / CUNY / SUNY">
        <datalist id="school-systems"><option value="UC"><option value="CC"><option value="CUNY"><option value="SUNY"><option value="其他"></datalist></div>
    </div>
    <label>目标说明</label><textarea name="goal_note" maxlength="2000" placeholder="申请要求、关键门槛、长期规划要点">${esc(g.goal_note || "")}</textarea>
    <button type="submit">保存目标</button>
  </form></div>`;
  // —— 状态快照 ——
  const snapRows = snaps.map((s) => `<tr>
    <td>${esc(s.snapshot_date || "")}</td>
    <td>${s.gpa === null || s.gpa === undefined ? "—" : s.gpa}</td>
    <td>${s.credits_done ?? "—"} / ${s.credits_total ?? "—"}</td>
    <td>${esc(s.note || "")}</td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条状态快照？')">
      <input type="hidden" name="action" value="status_delete"><input type="hidden" name="id" value="${s.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const statusCard = `
  <div class="card"><h2>状态快照</h2>
  ${latest ? `<p>最新（${esc(latest.snapshot_date || "")}）：GPA <strong>${latest.gpa === null || latest.gpa === undefined ? "—" : latest.gpa}</strong> · 已修学分 <strong>${latest.credits_done ?? "—"} / ${latest.credits_total ?? "—"}</strong>${latest.note ? " · " + esc(latest.note) : ""}</p>` : `<p class="mut">暂无快照，每学期结束记一条。</p>`}
  <form method="post">
    <input type="hidden" name="action" value="status_add">
    <div class="row">
      <div><label>快照日期</label><input name="snapshot_date" type="date" value="${todayStr()}"></div>
      <div><label>GPA</label><input name="gpa" type="number" step="0.01" min="0" max="4.5" placeholder="如 3.42"></div>
      <div><label>已修学分</label><input name="credits_done" type="number" min="0"></div>
      <div><label>总学分要求</label><input name="credits_total" type="number" min="0"></div>
    </div>
    <label>备注</label><input name="note" maxlength="2000" placeholder="如 本学期先修课全部 A，科学 GPA 3.6">
    <button type="submit">新增快照</button>
  </form>
  ${snaps.length ? `<h3>历史快照</h3><div class="wrap"><table><tr><th>日期</th><th>GPA</th><th>学分（已修/总）</th><th>备注</th><th></th></tr>${snapRows}</table></div>` : ""}
  </div>`;
  // —— 选课规划 ——
  const editCourseId = toInt(url.searchParams.get("edit_course"), 0);
  const editCourse = editCourseId ? courses.find((c) => c.id === editCourseId) : null;
  const cf = editCourse || { term: "", course_code: "", course_name: "", credits: "", kind: "prereq", status: "planned", grade: "", note: "" };
  const kindHtml = Object.entries(COURSE_KINDS).map(([k, label]) => {
    const p = prog.byKind[k];
    return `<div><label>${esc(label)}：已完成 ${p.done}/${p.total} 门 · 学分 ${p.creditsDone}/${p.credits}</label>${bar(p.done, p.total)}</div>`;
  }).join("");
  const courseGroupsHtml = groups.length ? groups.map((gr) => `
  <h3>${esc(gr.term)}（${gr.courses.length} 门）</h3>
  <div class="wrap"><table><tr><th>课程代码</th><th>课程名</th><th>学分</th><th>类别</th><th>状态</th><th>成绩</th><th>备注</th><th></th><th></th></tr>
  ${gr.courses.map((c) => `<tr>
    <td>${esc(c.course_code || "")}</td><td>${esc(c.course_name || "")}</td><td>${c.credits ?? ""}</td>
    <td>${esc(COURSE_KINDS[c.kind] || c.kind || "")}</td>
    <td><span class="pill">${esc(COURSE_STATUSES[c.status] || c.status || "")}</span></td>
    <td>${esc(c.grade || "—")}</td><td>${esc((c.note || "").slice(0, 40))}</td>
    <td><a href="/admin/client/${sid}?edit_course=${c.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这门课？')">
      <input type="hidden" name="action" value="course_delete"><input type="hidden" name="id" value="${c.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("")}
  </table></div>`).join("") : `<p class="mut">暂无选课记录，用下方表单按学期排课。</p>`;
  const courseCard = `
  <div class="card"><h2>选课规划</h2>
  <p>已完成学分 <strong>${prog.creditsDone}</strong> / 规划总学分 ${prog.creditsTotal} · 已完成先修课 <strong>${prog.prereqDone}/${prog.prereqTotal}</strong> 门 · 课程共 ${prog.total} 门（已完成 ${prog.doneCount}）</p>
  ${kindHtml}
  <h3>${editCourse ? "编辑课程 #" + editCourse.id : "新增课程"}</h3>
  <form method="post">
    <input type="hidden" name="action" value="${editCourse ? "course_update" : "course_add"}">
    ${editCourse ? `<input type="hidden" name="id" value="${editCourse.id}">` : ""}
    <div class="row">
      <div><label>学期 *</label><input name="term" required maxlength="20" value="${esc(cf.term || "")}" placeholder="如 2026-Spring"></div>
      <div><label>课程代码</label><input name="course_code" maxlength="20" value="${esc(cf.course_code || "")}" placeholder="如 BIO 181"></div>
      <div><label>课程名</label><input name="course_name" maxlength="80" value="${esc(cf.course_name || "")}" placeholder="如 普通生物学 I"></div>
      <div><label>学分</label><input name="credits" type="number" min="0" max="30" value="${esc(cf.credits ?? "")}"></div>
    </div>
    <div class="row">
      <div><label>类别</label><select name="kind">${opts(COURSE_KINDS, cf.kind || "prereq")}</select></div>
      <div><label>状态</label><select name="status">${opts(COURSE_STATUSES, cf.status || "planned")}</select></div>
      <div><label>成绩（可空）</label><input name="grade" maxlength="10" value="${esc(cf.grade || "")}" placeholder="如 A / B+"></div>
    </div>
    <label>备注</label><input name="note" maxlength="2000" value="${esc(cf.note || "")}">
    <button type="submit">${editCourse ? "保存修改" : "添加课程"}</button>
    ${editCourse ? `<a class="btn ghost" href="/admin/client/${sid}">取消编辑</a>` : ""}
  </form>
  ${courseGroupsHtml}
  </div>`;
  // —— 考试记录 ——
  const editExamId = toInt(url.searchParams.get("edit_exam"), 0);
  const editExam = editExamId ? exams.find((e) => e.id === editExamId) : null;
  const ef = editExam || { exam_name: "", exam_date: todayStr(), score: "", pass_line: "", result: "pending", note: "" };
  const examRows = exams.map((e) => `<tr>
    <td>${esc(e.exam_name || "")}</td><td>${esc(e.exam_date || "")}</td>
    <td>${esc(e.score || "—")}</td><td>${esc(e.pass_line || "—")}</td>
    <td>${e.result === "pass" ? '<span class="ok">达标</span>' : e.result === "fail" ? '<span class="bad">未达标</span>' : '<span class="mut">待考/待出分</span>'}</td>
    <td>${esc((e.note || "").slice(0, 40))}</td>
    <td><a href="/admin/client/${sid}?edit_exam=${e.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条考试记录？')">
      <input type="hidden" name="action" value="exam_delete"><input type="hidden" name="id" value="${e.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const examCard = `
  <div class="card"><h2>考试记录</h2>
  <h3>${editExam ? "编辑考试 #" + editExam.id : "新增考试记录"}</h3>
  <form method="post">
    <input type="hidden" name="action" value="${editExam ? "exam_update" : "exam_add"}">
    ${editExam ? `<input type="hidden" name="id" value="${editExam.id}">` : ""}
    <div class="row">
      <div><label>考试名称 *</label><input name="exam_name" required maxlength="80" value="${esc(ef.exam_name || "")}" placeholder="考试名称（由项目要求决定）"></div>
      <div><label>考试日期</label><input name="exam_date" type="date" value="${esc(ef.exam_date || "")}"></div>
      <div><label>结果</label><select name="result">${opts(EXAM_RESULTS, ef.result || "pending")}</select></div>
    </div>
    <div class="row">
      <div><label>分数（可空）</label><input name="score" maxlength="20" value="${esc(ef.score || "")}" placeholder="如 82.5% / 900"></div>
      <div><label>达标线（可空）</label><input name="pass_line" maxlength="20" value="${esc(ef.pass_line || "")}" placeholder="如 78% / 最低录取线"></div>
      <div><label>备注</label><input name="note" maxlength="2000" value="${esc(ef.note || "")}"></div>
    </div>
    <button type="submit">${editExam ? "保存修改" : "添加考试记录"}</button>
    ${editExam ? `<a class="btn ghost" href="/admin/client/${sid}">取消编辑</a>` : ""}
  </form>
  ${exams.length ? `<div class="wrap"><table><tr><th>考试</th><th>日期</th><th>分数</th><th>达标线</th><th>结果</th><th>备注</th><th></th><th></th></tr>${examRows}</table></div>` : `<p class="mut">暂无考试记录。</p>`}
  </div>`;
  // —— 辅导会议 ——
  const editMeetingId = toInt(url.searchParams.get("edit_meeting"), 0);
  const editMeeting = editMeetingId ? meetings.find((m) => m.id === editMeetingId) : null;
  const mf = editMeeting || { meeting_date: todayStr(), topic: "", summary: "", action_items: "", next_date: "" };
  const meetingRows = meetings.map((m) => `<tr>
    <td>${esc(m.meeting_date || "")}</td><td>${esc(m.topic || "")}</td>
    <td>${esc((m.summary || "").slice(0, 80))}${(m.summary || "").length > 80 ? "…" : ""}</td>
    <td>${esc((m.action_items || "").slice(0, 60))}${(m.action_items || "").length > 60 ? "…" : ""}</td>
    <td>${esc(m.next_date || "—")}</td>
    <td><a href="/admin/client/${sid}?edit_meeting=${m.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条会议记录？')">
      <input type="hidden" name="action" value="meeting_delete"><input type="hidden" name="id" value="${m.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const meetingCard = `
  <div class="card"><h2>专题辅导会议</h2>
  <h3>${editMeeting ? "编辑会议 #" + editMeeting.id : "新增会议记录"}</h3>
  <form method="post">
    <input type="hidden" name="action" value="${editMeeting ? "meeting_update" : "meeting_add"}">
    ${editMeeting ? `<input type="hidden" name="id" value="${editMeeting.id}">` : ""}
    <div class="row">
      <div><label>会议日期</label><input name="meeting_date" type="date" value="${esc(mf.meeting_date || "")}"></div>
      <div style="flex:2"><label>专题 *</label><input name="topic" required maxlength="120" value="${esc(mf.topic || "")}" placeholder="如 先修课 GPA 冲刺计划"></div>
      <div><label>下次会议（可空）</label><input name="next_date" type="date" value="${esc(mf.next_date || "")}"></div>
    </div>
    <label>纪要</label><textarea name="summary" maxlength="4000">${esc(mf.summary || "")}</textarea>
    <label>待办（每行一条）</label><textarea name="action_items" maxlength="4000">${esc(mf.action_items || "")}</textarea>
    <button type="submit">${editMeeting ? "保存修改" : "添加会议"}</button>
    ${editMeeting ? `<a class="btn ghost" href="/admin/client/${sid}">取消编辑</a>` : ""}
  </form>
  ${meetings.length ? `<div class="wrap"><table><tr><th>日期</th><th>专题</th><th>纪要</th><th>待办</th><th>下次会议</th><th></th><th></th></tr>${meetingRows}</table></div>` : `<p class="mut">暂无会议记录。</p>`}
  </div>`;
  // —— 导师轨迹 / 会议精神（v12）——
  // 一录三出本期不做：导师在此手工录入会议精神五项，保存即进入学生 APP 导师轨迹（方案层）。
  // 学生领受与回看结果由学生在 APP 补录；领受勾「只存本机」时这里只显示占位标记，永不显示正文（服务器根本没有）。
  const trailRowsHtml = trailEntries.map((e) => `<tr>
    <td>${esc(e.m_date || String(e.created_at || "").slice(0, 10))}</td>
    <td>${esc(e.mentor_name || "")}<br><span class="pill">${esc(TRAIL_ROLES[e.mentor_role] || e.mentor_role || "")}</span></td>
    <td>${esc(e.spirit_line || "")}</td>
    <td>${esc((e.key_judgments || "").slice(0, 60))}${(e.key_judgments || "").length > 60 ? "…" : ""}</td>
    <td>${e.takeaway_local ? '<span class="mut">已在本机记录（正文不入库）</span>' : esc((e.student_takeaway || "").slice(0, 40))}</td>
    <td>${e.revisit_result ? esc(e.revisit_result.slice(0, 40)) : '<span class="mut">待回看' + (e.revisit_due ? "（" + esc(e.revisit_due) + "）" : "") + "</span>"}</td>
    <td>${esc(TRAIL_SOURCES[e.source] || e.source || "")}</td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条会议精神？')">
      <input type="hidden" name="action" value="trail_delete"><input type="hidden" name="id" value="${e.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const meetingOpts = `<option value="">（不关联会议）</option>` + meetings.map((m) =>
    `<option value="${m.id}">${esc(m.meeting_date || "")} · ${esc(m.topic || "")}</option>`).join("");
  const trailCard = `
  <div class="card"><h2>导师轨迹 · 会议精神（v12）</h2>
  <p class="mut">每次会议后在此录入「会议精神」：一句话精神、关键判断、会后行动（每行一条，会自动并入学生行动清单）。学生领受与回看结果由学生在 APP 补录；学生自建的校外导师条目也会出现在这里（来源=学生自建）。家长端永不展示本区原文。</p>
  <form method="post">
    <input type="hidden" name="action" value="trail_add">
    <div class="row">
      <div><label>关联会议（可空）</label><select name="meeting_id">${meetingOpts}</select></div>
      <div><label>导师姓名 *</label><input name="mentor_name" required maxlength="40" placeholder="如 主导师 / 某老师"></div>
      <div><label>导师身份</label><select name="mentor_role">${opts(TRAIL_ROLES, "lead")}</select></div>
      <div><label>回看日期（可空，默认 30 天后）</label><input name="revisit_due" type="date"></div>
    </div>
    <label>一句话精神（≤60 字）*</label><input name="spirit_line" required maxlength="60" placeholder="这次会议最核心的一句">
    <label>关键判断（1–3 条，每行一条）</label><textarea name="key_judgments" maxlength="2000"></textarea>
    <label>会后行动（每行一条，自动并入行动清单）</label><textarea name="followup_actions" maxlength="2000"></textarea>
    <button type="submit">录入会议精神</button>
  </form>
  ${trailEntries.length ? `<div class="wrap"><table><tr><th>日期</th><th>导师</th><th>一句话精神</th><th>关键判断</th><th>学生领受</th><th>回看</th><th>来源</th><th></th></tr>${trailRowsHtml}</table></div>` : `<p class="mut">暂无会议精神记录。</p>`}
  </div>`;
  // —— 成长时间线（v10）——
  const editMsId = toInt(url.searchParams.get("edit_milestone"), 0);
  const editMs = editMsId ? milestones.find((m) => m.id === editMsId) : null;
  const msf = editMs || { date_text: "", title: "", detail: "", kind: "", sort: milestones.length + 1 };
  const msRows = milestones.map((m) => `<tr>
    <td>${m.sort ?? ""}</td><td>${esc(m.date_text || "—")}</td><td>${esc(m.title || "")}</td>
    <td>${esc(m.kind || "")}</td><td>${esc((m.detail || "").slice(0, 60))}${(m.detail || "").length > 60 ? "…" : ""}</td>
    <td><a href="/admin/client/${sid}?edit_milestone=${m.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条里程碑？')">
      <input type="hidden" name="action" value="milestone_delete"><input type="hidden" name="id" value="${m.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const milestoneCard = `
  <div class="card"><h2>成长时间线</h2>
  <p class="mut">显示在学生端 APP「成长」页顶部。日期文本可写「2025 秋季」式学期文本，未知留空，切勿编造日期。</p>
  <h3>${editMs ? "编辑里程碑 #" + editMs.id : "新增里程碑"}</h3>
  <form method="post">
    <input type="hidden" name="action" value="${editMs ? "milestone_update" : "milestone_add"}">
    ${editMs ? `<input type="hidden" name="id" value="${editMs.id}">` : ""}
    <div class="row">
      <div><label>日期文本（可空）</label><input name="date_text" maxlength="40" value="${esc(msf.date_text || "")}" placeholder="如 2025 秋季"></div>
      <div style="flex:2"><label>标题 *</label><input name="title" required maxlength="120" value="${esc(msf.title || "")}"></div>
      <div><label>类别 kind（可空）</label><input name="kind" maxlength="20" value="${esc(msf.kind || "")}" placeholder="如 exam / school"></div>
      <div><label>排序（小的在前）</label><input name="sort" type="number" value="${esc(msf.sort ?? 0)}"></div>
    </div>
    <label>详情</label><textarea name="detail" maxlength="2000">${esc(msf.detail || "")}</textarea>
    <button type="submit">${editMs ? "保存修改" : "添加里程碑"}</button>
    ${editMs ? `<a class="btn ghost" href="/admin/client/${sid}">取消编辑</a>` : ""}
  </form>
  ${milestones.length ? `<div class="wrap"><table><tr><th>排序</th><th>日期</th><th>标题</th><th>类别</th><th>详情</th><th></th><th></th></tr>${msRows}</table></div>` : `<p class="mut">暂无里程碑。</p>`}
  </div>`;
  // —— 关键日期（v10）——
  const editKdId = toInt(url.searchParams.get("edit_keydate"), 0);
  const editKd = editKdId ? keyDates.find((k) => k.id === editKdId) : null;
  const kdf = editKd || { date: "", title: "" };
  const kdRows = keyDates.map((k) => `<tr>
    <td>${esc(k.date || "")}</td><td>${esc(k.title || "")}</td>
    <td><a href="/admin/client/${sid}?edit_keydate=${k.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这个关键日期？')">
      <input type="hidden" name="action" value="keydate_delete"><input type="hidden" name="id" value="${k.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const keyDateCard = `
  <div class="card"><h2>关键日期（倒计时）</h2>
  <p class="mut">显示在学生端 APP 首页倒计时卡；日期必须是真实确定的日子，不确定的不要填。</p>
  <h3>${editKd ? "编辑关键日期 #" + editKd.id : "新增关键日期"}</h3>
  <form method="post">
    <input type="hidden" name="action" value="${editKd ? "keydate_update" : "keydate_add"}">
    ${editKd ? `<input type="hidden" name="id" value="${editKd.id}">` : ""}
    <div class="row">
      <div><label>日期 *</label><input name="date" type="date" required value="${esc(kdf.date || "")}"></div>
      <div style="flex:2"><label>标题 *</label><input name="title" required maxlength="120" value="${esc(kdf.title || "")}" placeholder="如 护理项目申请截止"></div>
      <div><label>类型（v13）</label><select name="kind"><option value="">普通日期</option>${opts(KEY_DATE_KINDS, kdf.kind || "")}</select></div>
    </div>
    <button type="submit">${editKd ? "保存修改" : "添加关键日期"}</button>
    ${editKd ? `<a class="btn ghost" href="/admin/client/${sid}">取消编辑</a>` : ""}
  </form>
  ${keyDates.length ? `<div class="wrap"><table><tr><th>日期</th><th>标题</th><th></th><th></th></tr>${kdRows}</table></div>` : `<p class="mut">暂无关键日期。</p>`}
  </div>`;
  // —— 行动清单（v10，只读下发）——
  const editActId = toInt(url.searchParams.get("edit_action"), 0);
  const editAct = editActId ? actionRows.find((a) => a.id === editActId) : null;
  const af = editAct || { title: "", detail: "", due_text: "", status: "todo", sort: actionRows.length + 1 };
  const actRows = actionRows.map((a) => `<tr>
    <td>${a.sort ?? ""}</td><td>${esc(a.title || "")}</td>
    <td>${a.status === "done" ? '<span class="ok">已完成</span>' : '<span class="mut">待办</span>'}</td>
    <td>${esc(a.due_text || "—")}</td><td>${esc((a.detail || "").slice(0, 50))}${(a.detail || "").length > 50 ? "…" : ""}</td>
    <td><a href="/admin/client/${sid}?edit_action=${a.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条行动项？')">
      <input type="hidden" name="action" value="action_delete"><input type="hidden" name="id" value="${a.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const actionCard = `
  <div class="card"><h2>行动清单（学生端只读）</h2>
  <p class="mut">完成状态由导师在此维护；学生端本批只展示，不回写。</p>
  <h3>${editAct ? "编辑行动项 #" + editAct.id : "新增行动项"}</h3>
  <form method="post">
    <input type="hidden" name="action" value="${editAct ? "action_update" : "action_add"}">
    ${editAct ? `<input type="hidden" name="id" value="${editAct.id}">` : ""}
    <div class="row">
      <div style="flex:2"><label>标题 *</label><input name="title" required maxlength="120" value="${esc(af.title || "")}"></div>
      <div><label>状态</label><select name="status">${opts(ACTION_STATUSES, af.status || "todo")}</select></div>
      <div><label>期限文本（可空）</label><input name="due_text" maxlength="40" value="${esc(af.due_text || "")}" placeholder="如 本周内 / 2026-11 前"></div>
      <div><label>排序</label><input name="sort" type="number" value="${esc(af.sort ?? 0)}"></div>
    </div>
    <label>详情</label><textarea name="detail" maxlength="2000">${esc(af.detail || "")}</textarea>
    <button type="submit">${editAct ? "保存修改" : "添加行动项"}</button>
    ${editAct ? `<a class="btn ghost" href="/admin/client/${sid}">取消编辑</a>` : ""}
  </form>
  ${actionRows.length ? `<div class="wrap"><table><tr><th>排序</th><th>标题</th><th>状态</th><th>期限</th><th>详情</th><th></th><th></th></tr>${actRows}</table></div>` : `<p class="mut">暂无行动项。</p>`}
  </div>`;
  // —— 导师建议（v10）——
  const editAdvId = toInt(url.searchParams.get("edit_advice"), 0);
  const editAdv = editAdvId ? adviceRows.find((a) => a.id === editAdvId) : null;
  const vf = editAdv || { title: "", body: "", sort: adviceRows.length + 1 };
  const advRows = adviceRows.map((a) => `<tr>
    <td>${esc(String(a.created_at || "").slice(0, 10))}</td><td>${esc(a.title || "")}</td>
    <td>${esc((a.body || "").slice(0, 70))}${(a.body || "").length > 70 ? "…" : ""}</td>
    <td><a href="/admin/client/${sid}?edit_advice=${a.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条建议？')">
      <input type="hidden" name="action" value="advice_delete"><input type="hidden" name="id" value="${a.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const adviceCard = `
  <div class="card"><h2>导师建议（方案正文）</h2>
  <p class="mut">诊断结论 / 策略摘要写在这里（学生端「规划」页按时间倒序）；待办事项请写到行动清单，不要混。</p>
  <h3>${editAdv ? "编辑建议 #" + editAdv.id : "新增建议"}</h3>
  <form method="post">
    <input type="hidden" name="action" value="${editAdv ? "advice_update" : "advice_add"}">
    ${editAdv ? `<input type="hidden" name="id" value="${editAdv.id}">` : ""}
    <label>标题 *</label><input name="title" required maxlength="120" value="${esc(vf.title || "")}">
    <label>正文</label><textarea name="body" maxlength="4000" style="min-height:120px">${esc(vf.body || "")}</textarea>
    <div class="row"><div><label>排序（接口按时间倒序，排序仅后台维护用）</label><input name="sort" type="number" value="${esc(vf.sort ?? 0)}"></div></div>
    <button type="submit">${editAdv ? "保存修改" : "添加建议"}</button>
    ${editAdv ? `<a class="btn ghost" href="/admin/client/${sid}">取消编辑</a>` : ""}
  </form>
  ${adviceRows.length ? `<div class="wrap"><table><tr><th>日期</th><th>标题</th><th>正文</th><th></th><th></th></tr>${advRows}</table></div>` : `<p class="mut">暂无建议。</p>`}
  </div>`;
  // —— 问题方案层（v12）——
  // 这里只显示学生逐项确认后同步的方案摘要结构化字段；学生日记 / 情绪原文只存学生本机，永不进服务器，本页也不存在任何查看入口。
  // 合规标记 compliance='pending_review'（待核实）由服务端关键词规则生成，命中经营/食品/就业/税务/身份等事项时出现——待核实只能转律师/会计师/主管部门确认，系统内不得自行改判。
  const problemRowsHtml = problemShares.map((pr) => `<tr>
    <td>${esc(String(pr.created_at || "").slice(0, 10))}</td>
    <td>${esc(PROBLEM_DOMAINS[pr.domain] || pr.domain || "")}</td>
    <td>${esc(pr.title || "")}${pr.compliance === "pending_review" ? ' <span class="pill" style="background:#fdf6e0;color:#8a6d1a">待核实</span>' : ""}<br><span class="mut">${esc((pr.strategy_summary || "").slice(0, 60))}</span></td>
    <td><form method="post" style="margin:0;display:flex;gap:6px">
      <input type="hidden" name="action" value="problem_progress"><input type="hidden" name="id" value="${pr.id}">
      <select name="progress" style="margin:0">${opts(PROBLEM_PROGRESS, pr.progress || "open")}</select>
      <button class="small" type="submit">更新</button></form></td>
    <td>${esc(pr.resolved_note || "—")}</td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条问题方案？')">
      <input type="hidden" name="action" value="problem_delete"><input type="hidden" name="id" value="${pr.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const problemCard = `
  <div class="card"><h2>问题方案（学生确认同步，v12）</h2>
  <p class="mut">学生用问题解决中心在本地拆解问题、逐项确认后，方案摘要才同步到这里。带「待核实」标记的条目涉及合规事项，须转有资质律师 / 会计师 / 主管部门确认，不得按可执行处理。</p>
  ${problemShares.length ? `<div class="wrap"><table><tr><th>日期</th><th>领域</th><th>问题与方案摘要</th><th>进度</th><th>解决小结</th><th></th></tr>${problemRowsHtml}</table></div>` : `<p class="mut">暂无学生同步的问题方案。</p>`}
  </div>`;
  // —— 课程要求集（v12 课程匹配引擎）——
  const reqSetCards = reqSets.map((s) => {
    const rows = (reqRowsBySet[s.id] || []).map((r) => `<tr>
      <td>${esc(REQ_BLOCKS[r.block] || r.block || "")}</td><td>${esc(r.course_code || "")}</td>
      <td>${esc(r.course_name || "")}</td><td>${r.credits === null || r.credits === undefined ? "—" : r.credits}</td>
      <td>${esc(r.min_grade || "—")}</td><td>${esc(r.prereq_codes || "—")}</td>
      <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条要求？')">
        <input type="hidden" name="action" value="req_delete"><input type="hidden" name="id" value="${r.id}">
        <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
    return `<h3>${esc(s.name)} ${s.verified ? '<span class="pill">已按官方核实</span>' : '<span class="pill" style="background:#fdf6e0;color:#8a6d1a">未核实</span>'}</h3>
    <p class="mut">来源：${esc(s.source_note || "—")}${s.version_text ? " · 版本：" + esc(s.version_text) : ""} · 共 ${(reqRowsBySet[s.id] || []).length} 条要求
    <form method="post" style="display:inline;margin:0" onsubmit="return confirm('确定删除这份要求集及其全部要求？')">
      <input type="hidden" name="action" value="reqset_delete"><input type="hidden" name="id" value="${s.id}">
      <button class="small danger" type="submit">删除要求集</button></form></p>
    ${rows ? `<div class="wrap"><table><tr><th>块</th><th>代码</th><th>名称</th><th>学分</th><th>最低成绩</th><th>先修</th><th></th></tr>${rows}</table></div>` : `<p class="mut">暂无要求条目（框架情景：官方要求核实后在此录入）。</p>`}`;
  }).join("");
  const reqSetOpts = reqSets.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  const reqsetCard = `
  <div class="card"><h2>课程要求集（匹配引擎，v12）</h2>
  <p class="mut">要求按块建模（通识 / 专业先修 / 专业核心 / 选修），学生端 APP 用已修课程逐块算匹配度、缺课清单与预警。要求集必须逐份标来源与版本；未按学校官方核实的要求集请勿勾「已核实」。匹配结果只是规划参考，页面会标注「以学校官方学位审计为准」。</p>
  ${reqSetCards || `<p class="mut">暂无要求集。</p>`}
  <h3>新增要求集</h3>
  <form method="post">
    <input type="hidden" name="action" value="reqset_add">
    <div class="row">
      <div style="flex:2"><label>名称 *</label><input name="name" required maxlength="120" placeholder="如 CSI 本校护理 BSN（情景一）"></div>
      <div><label>版本 / 日期</label><input name="version_text" maxlength="120" placeholder="如 2026-10-21 intake 版"></div>
      <div><label>排序</label><input name="sort" type="number" value="${reqSets.length + 1}"></div>
    </div>
    <label>来源说明</label><input name="source_note" maxlength="500" placeholder="如 来源：学生 intake《工作簿2》台账，未经学校官网复核">
    <label style="display:block;margin:4px 0 10px"><input type="checkbox" name="verified" value="1" style="width:auto;margin:0 6px 0 0">已按学校官方来源核实</label>
    <button type="submit">添加要求集</button>
  </form>
  ${reqSets.length ? `<h3>新增要求条目</h3>
  <form method="post">
    <input type="hidden" name="action" value="req_add">
    <div class="row">
      <div><label>要求集</label><select name="set_id">${reqSetOpts}</select></div>
      <div><label>块</label><select name="block">${opts(REQ_BLOCKS, "prereq")}</select></div>
      <div><label>课程代码 *</label><input name="course_code" required maxlength="30" placeholder="如 BIO 350"></div>
      <div><label>课程名</label><input name="course_name" maxlength="120"></div>
    </div>
    <div class="row">
      <div><label>学分（可空）</label><input name="credits" type="number" step="0.5" min="0" max="60"></div>
      <div><label>最低成绩（可空）</label><input name="min_grade" maxlength="4" placeholder="如 B（仅官方有明文时填）"></div>
      <div><label>先修代码（逗号分隔，可空）</label><input name="prereq_codes" maxlength="200" placeholder="如 BIO 150"></div>
      <div><label>排序</label><input name="sort" type="number" value="0"></div>
    </div>
    <button type="submit">添加要求条目</button>
  </form>` : ""}
  </div>`;
  // —— 导师沟通（v10）——
  const threadHtml = messageRows.length ? messageRows.map((m) => `
    <div style="margin:8px 0;padding:9px 12px;border-radius:10px;${m.sender === "mentor" ? "background:#eef4f1" : "background:#f6f2ea"}">
      <span class="mut">${m.sender === "mentor" ? "导师" : "学生"} · ${esc(String(m.created_at || "").slice(0, 16).replace("T", " "))}${m.category === "data_correction" ? ` <span class="pill">课程数据纠错</span>` : ""}</span>
      <div style="white-space:pre-wrap">${esc(m.body || "")}</div>
    </div>`).join("") : `<p class="mut">暂无留言。</p>`;
  const messageCard = `
  <div class="card"><h2>导师沟通 ${unreadStudentMsgs ? `<span class="pill">${unreadStudentMsgs} 条未读</span>` : ""}</h2>
  <p class="mut">学生端 APP「导师」页的留言线程；打开本页即把学生留言标为已读。在下方回复（以导师身份发送）。</p>
  ${threadHtml}
  <form method="post">
    <input type="hidden" name="action" value="message_reply">
    <label>回复学生</label><textarea name="body" required maxlength="2000" placeholder="回复会原样出现在学生的 APP 里"></textarea>
    <button type="submit">发送回复</button>
  </form>
  </div>`;
  // —— 家长端（v11）——
  // 边界提示写在卡头：家长看到的只能是导师在此整理的内容，学生原始记录（考试/成绩/课程/留言）不进家长端。
  const editPuId = toInt(url.searchParams.get("edit_pupdate"), 0);
  const editPu = editPuId ? parentUpdates.find((u) => u.id === editPuId) : null;
  const puf = editPu || { update_date: todayStr(), title: "", body: "", current_focus: "", next_step: "" };
  const puRows = parentUpdates.map((u) => `<tr>
    <td>${esc(u.update_date || "")}</td><td>${esc(u.title || "")}</td>
    <td>${esc((u.current_focus || "").slice(0, 40))}${(u.current_focus || "").length > 40 ? "…" : ""}</td>
    <td>${esc((u.next_step || "").slice(0, 40))}${(u.next_step || "").length > 40 ? "…" : ""}</td>
    <td><a href="/admin/client/${sid}?edit_pupdate=${u.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条家长更新？')">
      <input type="hidden" name="action" value="parent_update_delete"><input type="hidden" name="id" value="${u.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const editPsId = toInt(url.searchParams.get("edit_psupport"), 0);
  const editPs = editPsId ? parentSupport.find((a) => a.id === editPsId) : null;
  const psf = editPs || { title: "", detail: "", category: "", due_text: "", status: "active", sort: parentSupport.length + 1 };
  const psRows = parentSupport.map((a) => `<tr>
    <td>${a.sort ?? ""}</td><td>${esc(a.title || "")}</td>
    <td>${a.status === "done" ? '<span class="ok">已完成</span>' : a.status === "archived" ? '<span class="mut">已归档</span>' : '<span class="warn">进行中</span>'}</td>
    <td>${esc(a.category || "—")}</td><td>${esc(a.due_text || "—")}</td>
    <td>${esc((a.detail || "").slice(0, 40))}${(a.detail || "").length > 40 ? "…" : ""}</td>
    <td><a href="/admin/client/${sid}?edit_psupport=${a.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条托举事项？')">
      <input type="hidden" name="action" value="parent_support_delete"><input type="hidden" name="id" value="${a.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const editPcId = toInt(url.searchParams.get("edit_pconcern"), 0);
  const editPc = editPcId ? parentConcerns.find((c) => c.id === editPcId) : null;
  const pcf = editPc || { concern_date: todayStr(), title: "", body: "", action_text: "" };
  const pcRows = parentConcerns.map((c) => `<tr>
    <td>${esc(c.concern_date || "")}</td><td>${esc(c.title || "")}</td>
    <td>${esc((c.body || "").slice(0, 40))}${(c.body || "").length > 40 ? "…" : ""}</td>
    <td>${esc((c.action_text || "").slice(0, 40))}${(c.action_text || "").length > 40 ? "…" : ""}</td>
    <td><a href="/admin/client/${sid}?edit_pconcern=${c.id}">编辑</a></td>
    <td><form method="post" style="margin:0" onsubmit="return confirm('确定删除这条需要关注事项？')">
      <input type="hidden" name="action" value="parent_concern_delete"><input type="hidden" name="id" value="${c.id}">
      <button class="small danger" type="submit">删除</button></form></td></tr>`).join("");
  const parentThreadHtml = parentMsgs.length ? parentMsgs.map((m) => `
    <div style="margin:8px 0;padding:9px 12px;border-radius:10px;${m.sender === "mentor" ? "background:#eef4f1" : "background:#f6f2ea"}">
      <span class="mut">${m.sender === "mentor" ? "导师" : "家长"} · ${esc(String(m.created_at || "").slice(0, 16).replace("T", " "))}</span>
      <div style="white-space:pre-wrap">${esc(m.body || "")}</div>
    </div>`).join("") : `<p class="mut">暂无留言。</p>`;
  const parentCard = `
  <div class="card"><h2>家长端（家长更新）</h2>
  <p class="mut">家长是实际买单人，但只能看到导师在这里专门整理、如实且保留学生尊严的更新。<strong>学生原始记录（考试、成绩、课程、状态快照、学生留言、签名）不会进入家长端</strong>，请勿把原始明细粘贴到家长更新里。</p>
  <div style="border-top:1px solid #eee;margin-top:10px;padding-top:10px">
    <p style="margin:4px 0"><strong>家长专属链接</strong> <span class="mut">家长用这个链接看进展更新、如何托举事项，并与导师单独沟通；与学生端链接完全独立。</span></p>
    ${student.parent_key
      ? `<p class="mut" style="margin:4px 0">家长密钥：<code>${esc(student.parent_key)}</code><br>专属链接（推荐，用专属名）：<code>https://zhuanuc.com/one-on-one-app/parent.html?s=${esc(student.slug || "")}&amp;p=${esc(student.parent_key)}</code><br>备用链接（用编号）：<code>https://zhuanuc.com/one-on-one-app/parent.html?s=${sid}&amp;p=${esc(student.parent_key)}</code></p>`
      : `<p class="mut" style="margin:4px 0">尚未生成家长密钥，生成后把专属链接发给家长即可。专属名：<code>${esc(student.slug || "")}</code></p>`}
    <form method="post" style="margin:6px 0 0" onsubmit="return confirm('${student.parent_key ? "重置后旧家长链接立即失效，确定重置家长密钥？" : "确定生成家长密钥？"}')">
      <input type="hidden" name="action" value="parent_key_rotate">
      <button class="small ghost" type="submit">${student.parent_key ? "重置家长密钥" : "生成家长密钥"}</button>
    </form>
  </div>
  <h3>${editPu ? "编辑家长更新 #" + editPu.id : "新增家长更新"}</h3>
  <p class="mut">固定说明：只填写可向家长公开的方案与进展，不录入学生日记、情绪原文或私密困惑。家长更新按「阶段进展 / 当前解决策略 / 下一步」呈现，只能来自经学生确认、再由导师整理过的解决方案与规划结果；学生的日记、想法与情绪原文只保存在学生本机，永不进入服务器与家长端。</p>
  <form method="post">
    <input type="hidden" name="action" value="${editPu ? "parent_update_update" : "parent_update_add"}">
    ${editPu ? `<input type="hidden" name="id" value="${editPu.id}">` : ""}
    <div class="row">
      <div><label>更新日期</label><input name="update_date" type="date" value="${esc(puf.update_date || "")}"></div>
      <div style="flex:2"><label>标题 *</label><input name="title" required maxlength="120" value="${esc(puf.title || "")}" placeholder="如 评估诊断阶段进展"></div>
    </div>
    <label>阶段进展（给家长看的整理版正文）</label><textarea name="body" maxlength="4000" style="min-height:110px">${esc(puf.body || "")}</textarea>
    <label>当前解决策略</label><textarea name="current_focus" maxlength="2000">${esc(puf.current_focus || "")}</textarea>
    <label>下一步</label><textarea name="next_step" maxlength="2000">${esc(puf.next_step || "")}</textarea>
    <button type="submit">${editPu ? "保存修改" : "添加家长更新"}</button>
    ${editPu ? `<a class="btn ghost" href="/admin/client/${sid}">取消编辑</a>` : ""}
  </form>
  ${parentUpdates.length ? `<div class="wrap"><table><tr><th>日期</th><th>标题</th><th>当前解决策略</th><th>下一步</th><th></th><th></th></tr>${puRows}</table></div>` : `<p class="mut">暂无家长更新。</p>`}
  <h3>${editPc ? "编辑需要关注 #" + editPc.id : "新增需要关注"}</h3>
  <p class="mut">固定说明（呈现规则，见交付标准附则九）：<strong>如实呈现，困难单列，不只报喜。</strong>进展不顺利、存在风险或未达预期的事项写到这里，与进展更新并列给家长看，不要藏进进展正文、不要淡化、不要省略。严重问题（安全、学籍、重大考试失利等）除写到这里外，必须另走单独沟通流程直接与家长沟通，不以页面发布代替沟通。没有需要关注的事项就留空，页面会如实显示空态，不要凑数编造。</p>
  <form method="post">
    <input type="hidden" name="action" value="${editPc ? "parent_concern_update" : "parent_concern_add"}">
    ${editPc ? `<input type="hidden" name="id" value="${editPc.id}">` : ""}
    <div class="row">
      <div><label>日期</label><input name="concern_date" type="date" value="${esc(pcf.concern_date || "")}"></div>
      <div style="flex:2"><label>标题 *</label><input name="title" required maxlength="120" value="${esc(pcf.title || "")}" placeholder="如 近期状态需要关注"></div>
    </div>
    <label>情况说明（给家长看的整理版：事实 + 影响，不写学生私密原文）</label><textarea name="body" maxlength="4000" style="min-height:90px">${esc(pcf.body || "")}</textarea>
    <label>正在采取的措施 / 需要家长配合什么</label><textarea name="action_text" maxlength="2000">${esc(pcf.action_text || "")}</textarea>
    <button type="submit">${editPc ? "保存修改" : "添加需要关注"}</button>
    ${editPc ? `<a class="btn ghost" href="/admin/client/${sid}">取消编辑</a>` : ""}
  </form>
  ${parentConcerns.length ? `<div class="wrap"><table><tr><th>日期</th><th>标题</th><th>情况说明</th><th>措施</th><th></th><th></th></tr>${pcRows}</table></div>` : `<p class="mut">暂无需要关注事项（家长端显示空态）。</p>`}
  <h3>${editPs ? "编辑托举事项 #" + editPs.id : "新增如何托举事项"}</h3>
  <p class="mut">只写家长可以实际执行的托举事项（如补充材料、保留稳定节奏）；不要在这里写向家长追问成绩或考试细节的内容。</p>
  <form method="post">
    <input type="hidden" name="action" value="${editPs ? "parent_support_update" : "parent_support_add"}">
    ${editPs ? `<input type="hidden" name="id" value="${editPs.id}">` : ""}
    <div class="row">
      <div style="flex:2"><label>标题 *</label><input name="title" required maxlength="120" value="${esc(psf.title || "")}"></div>
      <div><label>状态</label><select name="status">${opts(SUPPORT_ACTION_STATUSES, psf.status || "active")}</select></div>
      <div><label>分类（可空）</label><input name="category" maxlength="40" value="${esc(psf.category || "")}" placeholder="如 材料 / 节奏"></div>
      <div><label>期限文本（可空）</label><input name="due_text" maxlength="40" value="${esc(psf.due_text || "")}" placeholder="如 本周内"></div>
      <div><label>排序</label><input name="sort" type="number" value="${esc(psf.sort ?? 0)}"></div>
    </div>
    <label>说明</label><textarea name="detail" maxlength="2000">${esc(psf.detail || "")}</textarea>
    <button type="submit">${editPs ? "保存修改" : "添加托举事项"}</button>
    ${editPs ? `<a class="btn ghost" href="/admin/client/${sid}">取消编辑</a>` : ""}
  </form>
  ${parentSupport.length ? `<div class="wrap"><table><tr><th>排序</th><th>标题</th><th>状态</th><th>分类</th><th>期限</th><th>说明</th><th></th><th></th></tr>${psRows}</table></div>` : `<p class="mut">暂无托举事项。</p>`}
  <h3>家长沟通 ${unreadParentMsgs ? `<span class="pill">${unreadParentMsgs} 条未读</span>` : ""}</h3>
  <p class="mut">家长与导师的独立线程，学生看不到；打开本页即把家长留言标为已读。在下方以导师身份回复。</p>
  ${parentThreadHtml}
  <form method="post">
    <input type="hidden" name="action" value="parent_message_reply">
    <label>回复家长</label><textarea name="body" required maxlength="2000" placeholder="回复会原样出现在家长端"></textarea>
    <button type="submit">发送回复</button>
  </form>
  </div>`;
  return htmlResp(layout("专属客户端 · " + student.name, "/admin/delivery",
    hero + mentorCardHtml + topicMentorCardHtml + goalCard + statusCard + examCard + courseCard + meetingCard + trailCard +
    milestoneCard + keyDateCard + actionCard + adviceCard + problemCard + reqsetCard + messageCard + parentCard + timelineHtml));
}
async function postClient(req, env, sidFromPath) {
  const db = env.DB;
  const fd = await req.formData();
  const action = String(fd.get("action") || "");
  const sid = sidFromPath || toInt(fd.get("student_id"), 0);
  const student = sid ? await db.prepare("SELECT id FROM students WHERE id=?").bind(sid).first() : null;
  if (!student) return redirect("/admin/delivery");
  const back = "/admin/client/" + sid;
  // v13：默认导师指派（0 = 取消分配；指向不可通知导师也允许保存，但客户端页会标红提示）
  if (action === "student_mentor_set") {
    const mid = toInt(fd.get("mentor_staff_id"), 0);
    if (mid === 0 || await db.prepare("SELECT id FROM staff WHERE id=?").bind(mid).first()) {
      await db.prepare("UPDATE students SET mentor_id = ?, updated_at = ? WHERE id = ?")
        .bind(mid || null, nowIso(), sid).run();
    }
    return redirect(back);
  }
  // v15：专题导师指派添加——候选校验与客户端页同口径（已登记导师 + 工作台密钥 + 专题名必填）；
  // 重复指派由 (student_id, staff_id) 唯一约束兜底，冲突静默忽略。
  if (action === "topic_mentor_add") {
    const mid = toInt(fd.get("topic_staff_id"), 0);
    const topic = clampStr(fd.get("topic"), 40);
    const cand = mid ? await db.prepare("SELECT * FROM staff WHERE id=?").bind(mid).first() : null;
    const stuRow = await db.prepare("SELECT mentor_id FROM students WHERE id=?").bind(sid).first();
    if (cand && isTopicMentorCandidate(cand) && topic && mid !== (stuRow ? stuRow.mentor_id || 0 : 0)) {
      try {
        await db.prepare("INSERT INTO student_topic_mentors(student_id, staff_id, topic, created_at) VALUES(?,?,?,?)")
          .bind(sid, mid, topic, nowIso()).run();
      } catch (e) { /* 唯一约束：已指派则忽略 */ }
    }
    return redirect(back);
  }
  // v15：专题导师指派移除（立即生效：导师侧全部接口按关系解析，当场失去访问）
  if (action === "topic_mentor_remove") {
    await db.prepare("DELETE FROM student_topic_mentors WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "key_rotate") {
    // v7：生成/重置学生端 APP 访问密钥（旧密钥立即失效）
    await db.prepare("UPDATE students SET client_key = ?, updated_at = ? WHERE id = ?")
      .bind(genClientKey(), nowIso(), sid).run();
    return redirect(back);
  }
  if (action === "signature_save") {
    // v9：导师维护专属签名——非空 = 设置/修改（同步记录时间），留空 = 清空（学生可在 APP 重新自选确认）
    const sig = clampStr(fd.get("signature"), 30);
    if (sig) {
      await db.prepare("UPDATE students SET signature = ?, signature_set_at = ?, updated_at = ? WHERE id = ?")
        .bind(sig, nowIso(), nowIso(), sid).run();
    } else {
      await db.prepare("UPDATE students SET signature = NULL, signature_set_at = NULL, updated_at = ? WHERE id = ?")
        .bind(nowIso(), sid).run();
    }
    return redirect(back);
  }
  if (action === "goal_save") {
    await db.prepare(
      `INSERT INTO student_goals(student_id, target_school, target_term, goal_note, gpa_target, school_system, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(student_id) DO UPDATE SET target_school=excluded.target_school, target_term=excluded.target_term,
         goal_note=excluded.goal_note, gpa_target=excluded.gpa_target, school_system=excluded.school_system, updated_at=excluded.updated_at`
    ).bind(sid, clampStr(fd.get("target_school"), 120), clampStr(fd.get("target_term"), 40),
      clampStr(fd.get("goal_note"), 2000), clampStr(fd.get("gpa_target"), 10),
      clampStr(fd.get("school_system"), 40) || null, nowIso(), nowIso()).run();
    return redirect(back);
  }
  if (action === "status_add") {
    const gpaRaw = String(fd.get("gpa") ?? "").trim();
    const gpaNum = gpaRaw === "" ? null : Number(gpaRaw);
    const numOrNull = (v) => { const s = String(v ?? "").trim(); return s === "" ? null : toInt(s, 0); };
    await db.prepare(
      `INSERT INTO student_status(student_id, snapshot_date, gpa, credits_done, credits_total, note, created_at)
       VALUES(?,?,?,?,?,?,?)`
    ).bind(sid, clampStr(fd.get("snapshot_date"), 10) || todayStr(),
      gpaNum === null || Number.isNaN(gpaNum) ? null : gpaNum,
      numOrNull(fd.get("credits_done")), numOrNull(fd.get("credits_total")),
      clampStr(fd.get("note"), 2000), nowIso()).run();
    return redirect(back);
  }
  if (action === "status_delete") {
    await db.prepare("DELETE FROM student_status WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "course_add" || action === "course_update") {
    const term = clampStr(fd.get("term"), 20);
    const code = clampStr(fd.get("course_code"), 20);
    const name = clampStr(fd.get("course_name"), 80);
    if (!term || (!code && !name)) return redirect(back);
    const credits = toInt(fd.get("credits"), 0);
    const kind = COURSE_KINDS[fd.get("kind")] ? String(fd.get("kind")) : "prereq";
    const status = COURSE_STATUSES[fd.get("status")] ? String(fd.get("status")) : "planned";
    const grade = clampStr(fd.get("grade"), 10) || null;
    const note = clampStr(fd.get("note"), 2000);
    if (action === "course_update") {
      await db.prepare(
        `UPDATE student_courses SET term=?, course_code=?, course_name=?, credits=?, kind=?, status=?, grade=?, note=?, updated_at=? WHERE id=? AND student_id=?`
      ).bind(term, code, name, credits, kind, status, grade, note, nowIso(), toInt(fd.get("id"), 0), sid).run();
    } else {
      await db.prepare(
        `INSERT INTO student_courses(student_id, term, course_code, course_name, credits, kind, status, grade, note, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(sid, term, code, name, credits, kind, status, grade, note, nowIso(), nowIso()).run();
    }
    return redirect(back);
  }
  if (action === "course_delete") {
    await db.prepare("DELETE FROM student_courses WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "meeting_add" || action === "meeting_update") {
    const topic = clampStr(fd.get("topic"), 120);
    if (!topic) return redirect(back);
    const mdate = clampStr(fd.get("meeting_date"), 10) || todayStr();
    const summary = clampStr(fd.get("summary"), 4000);
    const items = clampStr(fd.get("action_items"), 4000);
    const nextDate = clampStr(fd.get("next_date"), 10) || null;
    if (action === "meeting_update") {
      await db.prepare(
        `UPDATE student_meetings SET meeting_date=?, topic=?, summary=?, action_items=?, next_date=?, updated_at=? WHERE id=? AND student_id=?`
      ).bind(mdate, topic, summary, items, nextDate, nowIso(), toInt(fd.get("id"), 0), sid).run();
    } else {
      await db.prepare(
        `INSERT INTO student_meetings(student_id, meeting_date, topic, summary, action_items, next_date, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, mdate, topic, summary, items, nextDate, nowIso(), nowIso()).run();
    }
    return redirect(back);
  }
  if (action === "meeting_delete") {
    await db.prepare("DELETE FROM student_meetings WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "exam_add" || action === "exam_update") {
    const examName = clampStr(fd.get("exam_name"), 80);
    if (!examName) return redirect(back);
    const examDate = clampStr(fd.get("exam_date"), 10) || todayStr();
    const score = clampStr(fd.get("score"), 20) || null;
    const passLine = clampStr(fd.get("pass_line"), 20) || null;
    const result = EXAM_RESULTS[fd.get("result")] ? String(fd.get("result")) : "pending";
    const note = clampStr(fd.get("note"), 2000);
    if (action === "exam_update") {
      await db.prepare(
        `UPDATE student_exams SET exam_name=?, exam_date=?, score=?, pass_line=?, result=?, note=?, updated_at=? WHERE id=? AND student_id=?`
      ).bind(examName, examDate, score, passLine, result, note, nowIso(), toInt(fd.get("id"), 0), sid).run();
    } else {
      await db.prepare(
        `INSERT INTO student_exams(student_id, exam_name, exam_date, score, pass_line, result, note, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`
      ).bind(sid, examName, examDate, score, passLine, result, note, nowIso(), nowIso()).run();
    }
    return redirect(back);
  }
  if (action === "exam_delete") {
    await db.prepare("DELETE FROM student_exams WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "line_add" || action === "line_update") {
    const lineName = clampStr(fd.get("name"), 80);
    if (!lineName) return redirect(back);
    const lineType = LINE_TYPES[fd.get("line_type")] ? String(fd.get("line_type")) : "parallel";
    const prioRaw = toInt(fd.get("priority"), 0);
    const priority = prioRaw >= 1 ? Math.min(99, prioRaw) : 1;
    const lineStatus = LINE_STATUSES[fd.get("status")] ? String(fd.get("status")) : "active";
    const nextStep = clampStr(fd.get("next_step"), 200) || null;
    if (action === "line_update") {
      await db.prepare(
        `UPDATE student_goal_lines SET name=?, line_type=?, priority=?, status=?, next_step=?, updated_at=? WHERE id=? AND student_id=?`
      ).bind(lineName, lineType, priority, lineStatus, nextStep, nowIso(), toInt(fd.get("id"), 0), sid).run();
    } else {
      await db.prepare(
        `INSERT INTO student_goal_lines(student_id, name, line_type, priority, status, next_step, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, lineName, lineType, priority, lineStatus, nextStep, nowIso(), nowIso()).run();
    }
    return redirect(back);
  }
  if (action === "line_delete") {
    await db.prepare("DELETE FROM student_goal_lines WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  // —— v10 ——
  if (action === "profile_save") {
    // 导师寄语 + 愿景：寄语非空写入并刷新时间；留空 = 清空（学生端不渲染）
    const mm = clampStr(fd.get("mentor_message"), 2000);
    const vision = clampStr(fd.get("vision_text"), 2000) || null;
    if (mm) {
      await db.prepare("UPDATE students SET mentor_message = ?, mentor_message_at = ?, vision_text = ?, updated_at = ? WHERE id = ?")
        .bind(mm, nowIso(), vision, nowIso(), sid).run();
    } else {
      await db.prepare("UPDATE students SET mentor_message = NULL, mentor_message_at = NULL, vision_text = ?, updated_at = ? WHERE id = ?")
        .bind(vision, nowIso(), sid).run();
    }
    return redirect(back);
  }
  if (action === "milestone_add" || action === "milestone_update") {
    const title = clampStr(fd.get("title"), 120);
    if (!title) return redirect(back);
    const dateText = clampStr(fd.get("date_text"), 40) || null;
    const detail = clampStr(fd.get("detail"), 2000);
    const kind = clampStr(fd.get("kind"), 20) || null;
    const sort = toInt(fd.get("sort"), 0);
    if (action === "milestone_update") {
      await db.prepare(
        `UPDATE student_milestones SET date_text=?, title=?, detail=?, kind=?, sort=?, updated_at=? WHERE id=? AND student_id=?`
      ).bind(dateText, title, detail, kind, sort, nowIso(), toInt(fd.get("id"), 0), sid).run();
    } else {
      await db.prepare(
        `INSERT INTO student_milestones(student_id, date_text, title, detail, kind, sort, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, dateText, title, detail, kind, sort, nowIso(), nowIso()).run();
    }
    return redirect(back);
  }
  if (action === "milestone_delete") {
    await db.prepare("DELETE FROM student_milestones WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "keydate_add" || action === "keydate_update") {
    const title = clampStr(fd.get("title"), 120);
    const date = clampStr(fd.get("date"), 10);
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return redirect(back);
    const kdKind = KEY_DATE_KINDS[fd.get("kind")] ? String(fd.get("kind")) : null;
    if (action === "keydate_update") {
      await db.prepare("UPDATE student_key_dates SET date=?, title=?, kind=?, updated_at=? WHERE id=? AND student_id=?")
        .bind(date, title, kdKind, nowIso(), toInt(fd.get("id"), 0), sid).run();
    } else {
      await db.prepare("INSERT INTO student_key_dates(student_id, date, title, kind, created_at, updated_at) VALUES(?,?,?,?,?,?)")
        .bind(sid, date, title, kdKind, nowIso(), nowIso()).run();
    }
    return redirect(back);
  }
  if (action === "keydate_delete") {
    await db.prepare("DELETE FROM student_key_dates WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "action_add" || action === "action_update") {
    const title = clampStr(fd.get("title"), 120);
    if (!title) return redirect(back);
    const detail = clampStr(fd.get("detail"), 2000);
    const dueText = clampStr(fd.get("due_text"), 40) || null;
    const status = ACTION_STATUSES[fd.get("status")] ? String(fd.get("status")) : "todo";
    const sort = toInt(fd.get("sort"), 0);
    if (action === "action_update") {
      const prev = await db.prepare("SELECT status FROM student_actions WHERE id=? AND student_id=?")
        .bind(toInt(fd.get("id"), 0), sid).first();
      await db.prepare(
        `UPDATE student_actions SET title=?, detail=?, due_text=?, status=?, sort=?, updated_at=? WHERE id=? AND student_id=?`
      ).bind(title, detail, dueText, status, sort, nowIso(), toInt(fd.get("id"), 0), sid).run();
      // v13：行动由未完成 → 已完成时记事件（成就与时间线同源）
      if (status === "done" && prev && prev.status !== "done") {
        await logEvent(db, sid, "action_completed", toInt(fd.get("id"), 0), "完成行动：" + title);
      }
    } else {
      const ins = await db.prepare(
        `INSERT INTO student_actions(student_id, title, detail, due_text, status, sort, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, title, detail, dueText, status, sort, nowIso(), nowIso()).run();
      if (status === "done") {
        await logEvent(db, sid, "action_completed", ins.meta.last_row_id, "完成行动：" + title);
      }
    }
    return redirect(back);
  }
  if (action === "action_delete") {
    await db.prepare("DELETE FROM student_actions WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "advice_add" || action === "advice_update") {
    const title = clampStr(fd.get("title"), 120);
    if (!title) return redirect(back);
    const advBody = clampStr(fd.get("body"), 4000);
    const sort = toInt(fd.get("sort"), 0);
    if (action === "advice_update") {
      await db.prepare("UPDATE student_advice SET title=?, body=?, sort=?, updated_at=? WHERE id=? AND student_id=?")
        .bind(title, advBody, sort, nowIso(), toInt(fd.get("id"), 0), sid).run();
    } else {
      await db.prepare("INSERT INTO student_advice(student_id, title, body, sort, created_at, updated_at) VALUES(?,?,?,?,?,?)")
        .bind(sid, title, advBody, sort, nowIso(), nowIso()).run();
    }
    return redirect(back);
  }
  if (action === "advice_delete") {
    await db.prepare("DELETE FROM student_advice WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "message_reply") {
    const text = clampStr(fd.get("body"), 2000);
    if (!text) return redirect(back);
    const stuRow = await db.prepare("SELECT mentor_id FROM students WHERE id=?").bind(sid).first();
    const ins = await db.prepare(
      `INSERT INTO student_messages(student_id, sender, body, created_at, read_by_student, read_by_mentor, mentor_id)
       VALUES(?, 'mentor', ?, ?, 0, 1, ?)`
    ).bind(sid, text, nowIso(), stuRow && stuRow.mentor_id ? stuRow.mentor_id : null).run();
    // v13：导师回复记事件，并把该学生 queued 的留言通知推进到 responded
    await logEvent(db, sid, "message_mentor", ins.meta.last_row_id, "导师回复留言");
    if (stuRow && stuRow.mentor_id) {
      await db.prepare(
        `UPDATE notifications_outbox SET status = 'responded', updated_at = ?
         WHERE mentor_staff_id = ? AND student_id = ? AND event_type = 'student_message' AND status IN ('queued','sent')`
      ).bind(nowIso(), stuRow.mentor_id, sid).run();
    }
    return redirect(back);
  }
  // —— v11 家长端 ——
  if (action === "parent_key_rotate") {
    // 生成/重置家长密钥（旧家长链接立即失效；学生端 client_key 不受影响）
    await db.prepare("UPDATE students SET parent_key = ?, updated_at = ? WHERE id = ?")
      .bind(genParentKey(), nowIso(), sid).run();
    return redirect(back);
  }
  if (action === "parent_update_add" || action === "parent_update_update") {
    const title = clampStr(fd.get("title"), 120);
    if (!title) return redirect(back);
    const uDate = clampStr(fd.get("update_date"), 10);
    const updDate = /^\d{4}-\d{2}-\d{2}$/.test(uDate) ? uDate : todayStr();
    const uBody = clampStr(fd.get("body"), 4000);
    const focus = clampStr(fd.get("current_focus"), 2000);
    const nextStep = clampStr(fd.get("next_step"), 2000);
    if (action === "parent_update_update") {
      await db.prepare(
        `UPDATE parent_updates SET update_date=?, title=?, body=?, current_focus=?, next_step=?, updated_at=? WHERE id=? AND student_id=?`
      ).bind(updDate, title, uBody, focus, nextStep, nowIso(), toInt(fd.get("id"), 0), sid).run();
    } else {
      const ins = await db.prepare(
        `INSERT INTO parent_updates(student_id, update_date, title, body, current_focus, next_step, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(sid, updDate, title, uBody, focus, nextStep, nowIso(), nowIso()).run();
      // v13：家长更新发布记事件
      await logEvent(db, sid, "parent_update_published", ins.meta.last_row_id, "家长更新发布：" + title);
    }
    return redirect(back);
  }
  if (action === "parent_update_delete") {
    await db.prepare("DELETE FROM parent_updates WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  // —— v13.4 需要关注（与进展更新分开计列；呈现规则见交付标准附则九）——
  if (action === "parent_concern_add" || action === "parent_concern_update") {
    const title = clampStr(fd.get("title"), 120);
    if (!title) return redirect(back);
    const cDate = clampStr(fd.get("concern_date"), 10);
    const concernDate = /^\d{4}-\d{2}-\d{2}$/.test(cDate) ? cDate : todayStr();
    const cBody = clampStr(fd.get("body"), 4000);
    const cAction = clampStr(fd.get("action_text"), 2000);
    if (action === "parent_concern_update") {
      await db.prepare(
        `UPDATE parent_concerns SET concern_date=?, title=?, body=?, action_text=?, updated_at=? WHERE id=? AND student_id=?`
      ).bind(concernDate, title, cBody, cAction, nowIso(), toInt(fd.get("id"), 0), sid).run();
    } else {
      await db.prepare(
        `INSERT INTO parent_concerns(student_id, concern_date, title, body, action_text, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?)`
      ).bind(sid, concernDate, title, cBody, cAction, nowIso(), nowIso()).run();
    }
    return redirect(back);
  }
  if (action === "parent_concern_delete") {
    await db.prepare("DELETE FROM parent_concerns WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "parent_support_add" || action === "parent_support_update") {
    const title = clampStr(fd.get("title"), 120);
    if (!title) return redirect(back);
    const detail = clampStr(fd.get("detail"), 2000);
    const category = clampStr(fd.get("category"), 40) || null;
    const dueText = clampStr(fd.get("due_text"), 40) || null;
    const status = SUPPORT_ACTION_STATUSES[fd.get("status")] ? String(fd.get("status")) : "active";
    const sort = toInt(fd.get("sort"), 0);
    if (action === "parent_support_update") {
      await db.prepare(
        `UPDATE parent_support_actions SET title=?, detail=?, category=?, due_text=?, status=?, sort=?, updated_at=? WHERE id=? AND student_id=?`
      ).bind(title, detail, category, dueText, status, sort, nowIso(), toInt(fd.get("id"), 0), sid).run();
    } else {
      await db.prepare(
        `INSERT INTO parent_support_actions(student_id, title, detail, category, due_text, status, sort, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`
      ).bind(sid, title, detail, category, dueText, status, sort, nowIso(), nowIso()).run();
    }
    return redirect(back);
  }
  if (action === "parent_support_delete") {
    await db.prepare("DELETE FROM parent_support_actions WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "parent_message_reply") {
    const text = clampStr(fd.get("body"), 2000);
    if (!text) return redirect(back);
    await db.prepare(
      `INSERT INTO parent_messages(student_id, sender, body, created_at, read_by_parent, read_by_mentor)
       VALUES(?, 'mentor', ?, ?, 0, 1)`
    ).bind(sid, text, nowIso()).run();
    return redirect(back);
  }
  // —— v12 导师轨迹 / 问题方案 / 课程要求集 ——
  if (action === "trail_add") {
    const mentorName = clampStr(fd.get("mentor_name"), 40);
    const spirit = clampStr(fd.get("spirit_line"), 120);
    if (!mentorName || !spirit || [...spirit].length > 60) return redirect(back);
    const role = TRAIL_ROLES[fd.get("mentor_role")] ? String(fd.get("mentor_role")) : "lead";
    const meetingId = toInt(fd.get("meeting_id"), 0) || null;
    const dueRaw = clampStr(fd.get("revisit_due"), 10);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw
      : new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const followups = clampStr(fd.get("followup_actions"), 2000);
    const tr = await db.prepare(
      `INSERT INTO mentor_trail_entries(student_id, meeting_id, mentor_name, mentor_role, spirit_line,
        key_judgments, student_takeaway, takeaway_local, followup_actions, revisit_result, revisit_due,
        visibility, source, created_at, updated_at)
       VALUES(?,?,?,?,?, ?, NULL, 0, ?, '', ?, 'plan', 'mentor', ?, ?)`
    ).bind(sid, meetingId, mentorName, role, spirit, clampStr(fd.get("key_judgments"), 2000),
      followups, due, nowIso(), nowIso()).run();
    await insertTrailFollowups(db, sid, followups, nowIso());
    // v13：轨迹新增记事件 + 待回看通知（学生已分配且导师可通知时）
    await logEvent(db, sid, "trail_created", tr.meta.last_row_id, "导师轨迹新增：" + spirit);
    const stuM = await db.prepare("SELECT mentor_id FROM students WHERE id=?").bind(sid).first();
    if (stuM && stuM.mentor_id) {
      const mentor = await db.prepare("SELECT * FROM staff WHERE id=?").bind(stuM.mentor_id).first();
      if (mentorNotifiable(mentor)) {
        const stuName = await db.prepare("SELECT name FROM students WHERE id=?").bind(sid).first();
        await pushOutbox(env, db, mentor, sid, "trail_revisit",
          ((stuName && stuName.name) || "学生") + " 新增导师轨迹待回看：" + spirit, "trail", tr.meta.last_row_id);
      }
    }
    return redirect(back);
  }
  if (action === "trail_delete") {
    await db.prepare("DELETE FROM mentor_trail_entries WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "problem_progress") {
    const progress = PROBLEM_PROGRESS[fd.get("progress")] ? String(fd.get("progress")) : "open";
    const prevP = await db.prepare("SELECT progress, title FROM student_problem_shares WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).first();
    await db.prepare("UPDATE student_problem_shares SET progress=?, updated_at=? WHERE id=? AND student_id=?")
      .bind(progress, nowIso(), toInt(fd.get("id"), 0), sid).run();
    // v13：导师侧改问题状态也记事件（解决/升级）
    if (prevP && progress !== prevP.progress) {
      if (progress === "resolved") {
        await logEvent(db, sid, "problem_resolved", toInt(fd.get("id"), 0), "问题解决：" + (prevP.title || ""));
      } else if (progress === "escalated") {
        await logEvent(db, sid, "problem_escalated", toInt(fd.get("id"), 0), "问题升级导师：" + (prevP.title || ""));
      }
    }
    return redirect(back);
  }
  if (action === "problem_delete") {
    await db.prepare("DELETE FROM student_problem_shares WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  if (action === "reqset_add") {
    const name = clampStr(fd.get("name"), 120);
    if (!name) return redirect(back);
    await db.prepare(
      `INSERT INTO course_requirement_sets(student_id, name, source_note, version_text, verified, sort, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?)`
    ).bind(sid, name, clampStr(fd.get("source_note"), 500), clampStr(fd.get("version_text"), 120),
      fd.get("verified") ? 1 : 0, toInt(fd.get("sort"), 0), nowIso(), nowIso()).run();
    return redirect(back);
  }
  if (action === "reqset_delete") {
    const setId = toInt(fd.get("id"), 0);
    await db.prepare("DELETE FROM course_requirements WHERE set_id=? AND student_id=?").bind(setId, sid).run();
    await db.prepare("DELETE FROM course_requirement_sets WHERE id=? AND student_id=?").bind(setId, sid).run();
    return redirect(back);
  }
  if (action === "req_add") {
    const setId = toInt(fd.get("set_id"), 0);
    const code = clampStr(fd.get("course_code"), 30);
    if (!setId || !code) return redirect(back);
    const setRow = await db.prepare(
      "SELECT id FROM course_requirement_sets WHERE id=? AND student_id=?").bind(setId, sid).first();
    if (!setRow) return redirect(back);
    const crRaw = String(fd.get("credits") ?? "").trim();
    const credits = crRaw === "" ? null : Number(crRaw);
    await db.prepare(
      `INSERT INTO course_requirements(set_id, student_id, block, course_code, course_name, credits, min_grade, prereq_codes, sort, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(setId, sid, REQ_BLOCKS[fd.get("block")] ? String(fd.get("block")) : "prereq", code,
      clampStr(fd.get("course_name"), 120),
      credits === null || Number.isNaN(credits) ? null : credits,
      clampStr(fd.get("min_grade"), 4) || null, clampStr(fd.get("prereq_codes"), 200) || null,
      toInt(fd.get("sort"), 0), nowIso(), nowIso()).run();
    return redirect(back);
  }
  if (action === "req_delete") {
    await db.prepare("DELETE FROM course_requirements WHERE id=? AND student_id=?")
      .bind(toInt(fd.get("id"), 0), sid).run();
    return redirect(back);
  }
  return redirect(back);
}

// ===== 路由 =====
async function handleAdmin(req, env, url) {
  const p = url.pathname;
  if (p === "/admin/login") return handleLogin(req, env);
  if (p === "/admin/logout") return handleLogout();
  if (!(await isAuthed(req, env))) return redirect("/admin/login");
  const clientMatch = p.match(/^\/admin\/client\/(\d+)$/);
  if (req.method === "POST") {
    if (clientMatch) return postClient(req, env, parseInt(clientMatch[1], 10));
    if (p === "/admin/leads") return postLeads(req, env);
    if (p === "/admin/delivery") return postDelivery(req, env);
    if (p === "/admin/agents") return postAgents(req, env);
    if (p === "/admin/orders") return postOrders(req, env);
    if (p === "/admin/content") return postContent(req, env);
    if (p === "/admin/tasks") return postTasks(req, env);
    if (p === "/admin/staff") return postStaff(req, env);
    if (p === "/admin/outbox") return postOutbox(req, env);
    if (p === "/admin/knowledge") return postKnowledge(req, env);
    return redirect("/admin");
  }
  if (p === "/admin" || p === "/admin/") return pageDashboard(env);
  if (clientMatch) return pageClient(env, url, parseInt(clientMatch[1], 10));
  if (p === "/admin/leads") return pageLeads(req, env, url);
  if (p === "/admin/user") return pageUser(env, url);
  if (p === "/admin/delivery") return pageDelivery(env, url);
  if (p === "/admin/agents") return pageAgents(env, url);
  if (p === "/admin/orders") return pageOrders(env, url);
  if (p === "/admin/content") return pageContent(env, url);
  if (p === "/admin/tasks") return pageTasks(env, url);
  if (p === "/admin/staff") return pageStaff(env, url);
  if (p === "/admin/outbox") return pageOutbox(env, url);
  if (p === "/admin/knowledge") return pageKnowledge(env, url);
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith("/api/")) {
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
        if (!env.DB) return jsonResp(req, { ok: false, error: "db not configured" }, 500);
        return await handleApi(req, env, url, ctx);
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
  /* v17 定时清扫（wrangler.toml [triggers] crons 每 15 分钟）：导师文件满 24h
   * 未下载 → 删 R2 对象 + 记录置 expired。与 fetch 路由完全独立，异常只记日志
   * 不外抛；下载/列表/上传路径另有单条过期判定与懒清扫双保险。 */
  async scheduled(event, env, ctx) {
    try {
      if (!env.DB) return;
      await ensureSchema(env.DB);
      const n = await sweepExpiredMentorFiles(env, env.DB);
      if (n > 0) console.log("mentor files expired sweep:", n);
    } catch (e) {
      console.log("mentor files sweep failed:", e && e.message ? e.message : String(e));
    }
  },
};

// Named exports for local unit testing only (Workers runtime ignores them)
export { esc, validRef, calcCommission, fmtYuan, clampStr, toInt, daysInStage, isOverdueStage, aggregateMetrics, convRate, taskDueState, validStage, functionCodeFor, examConflict, scoreLead, leadTaskMarker, followupDueStr, groupCoursesByTerm, courseProgress, genClientKey, genParentKey, slugify, signatureSuggestions, knowledgeTagsFor, normClientExtras, normParentExtras, complianceFlag, gradePoints, normCourseCode, parsePrereqCodes, matchRequirements, normProblemInput, normTrailExtras, normRequirementSets, DELIVERY_STAGES, ACTIVE_STAGES, STAGE_OVERDUE_DAYS, CONTENT_STATUSES, COURSE_KINDS, COURSE_STATUSES, EXAM_RESULTS, LINE_TYPES, LINE_STATUSES, ACTION_STATUSES, MESSAGE_SENDERS, PARENT_MESSAGE_SENDERS, SUPPORT_ACTION_STATUSES, MESSAGE_MAX_LEN, MESSAGE_RATE_LIMIT, KNOWLEDGE_LIMIT, PROBLEM_DOMAINS, PROBLEM_PROGRESS, PROBLEM_RATE_LIMIT, TRAIL_ROLES, TRAIL_SOURCES, REQ_BLOCKS, FEELING_TAGS, KEY_DATE_KINDS, MENTOR_STATUSES, NOTIFY_CHANNELS, OUTBOX_STATUSES, EVENT_TYPES, PARENT_NOTE_MAX_LEN, genMentorKey, mentorNotifiable, mentorContacts, mentorMailTo, buildOutboxMail, mentorWorkbenchUrl, computeUpcomingReminders, buildAchievements, mentorFileTypeOk, fileLimits, sanitizeFilename, FILE_MAX_BYTES, FILE_STUDENT_QUOTA_BYTES, FILE_GLOBAL_QUOTA_BYTES, FILE_TTL_MS };
