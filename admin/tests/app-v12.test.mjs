// 一对一学生端 APP v12 前端断言（jsdom + 手写 fake IndexedDB）：
// 驾驶舱（梦想距离清单式·禁百分比）/ 今日状态 / 私密空间（本地存取·双导出·删除·关怀页）/
// 问题解决中心（本地引擎全组合五件 + 逐项同步载荷）/ 导师轨迹（筛选·本机领受）/
// 课程匹配渲染 / 动态与分享卡（清单门控·Canvas）/ 语音（私密口默认关 + 云端明示）。
// 隐私红线：全部私密操作期间抓包式检查——私密正文不得出现在任何网络请求中。
// 运行：node tests/app-v12.test.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/home/hatch/workspace/tools/jsdomtest/node_modules/jsdom");

const HTML = readFileSync(new URL("../../one-on-one-app/index.html", import.meta.url), "utf8");
const APP = readFileSync(new URL("../../one-on-one-app/app.js", import.meta.url), "utf8");
const PRIV = readFileSync(new URL("../../one-on-one-app/private.js", import.meta.url), "utf8");
const PROB = readFileSync(new URL("../../one-on-one-app/problems.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function section(s) { console.log("\n== " + s); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 50));
const p2 = (n) => String(n).padStart(2, "0");
const dstr = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
};
const isoAt = (offset, hour) => {
  const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

/* ---------- i18n 字典（从 app.js 源码提取，供引擎段做 tt） ---------- */
const I18N = eval("(" + APP.match(/const I18N = (\{[\s\S]*?\n\});/)[1] + ")");
const tt = (dict) => (k, vars) => {
  let s = dict[k];
  if (s === undefined) return k;
  if (vars) for (const key of Object.keys(vars)) s = s.split("{" + key + "}").join(String(vars[key]));
  return s;
};

/* ================= A. 问题引擎纯函数全组合（进程内直测 problems.js） ================= */
section("A. 本地问题引擎：7 领域 × 全部卡点（中英双语）五件齐全");
{
  const OOOProblems = eval(PROB + "\n;OOOProblems;");
  const knowledge = [
    { id: 1, title: "考试规则卡", body: "正文", tag: "exam" },
    { id: 2, title: "创业卡", body: "正文", tag: "business" },
  ];
  let combos = 0, bad = [];
  for (const lang of ["zh", "en"]) {
    const t = tt(I18N[lang]);
    for (const d of OOOProblems.DOMAINS) {
      for (const b of OOOProblems.BOTTLENECKS[d]) {
        combos++;
        const r = OOOProblems.solveLocally(
          { domain: d, bottleneck: b, what: "卡住了", tried: "试过", stuck: "没头绪", impact: 3, urgency: 3, desired: "解决", support: "", resources: [] },
          knowledge, t, () => false);
        const five = r.breakdown && r.breakdown.domainLabel !== "pb.dom." + d &&
          Array.isArray(r.causes) && r.causes.length >= 2 && r.causes.every((c) => !c.startsWith("c.")) &&
          r.todayAction && !r.todayAction.startsWith("today.") &&
          Array.isArray(r.plan7) && r.plan7.length >= 3 && r.plan7.length <= 5 &&
          r.plan7.every((p) => p.title && !p.title.startsWith("p.")) &&
          Array.isArray(r.knowledge) && Array.isArray(r.helpOrder) && r.helpOrder.length >= 1 &&
          r.helpOrder.every((h) => !h.startsWith("h.")) &&
          r.escalate && Array.isArray(r.escalate.reasons) && r.compliance &&
          // 合规卡点按蓝图总闸强制待核实，其余组合默认 ok
          (d + ":" + b === "business:compliance" ? r.compliance.flag === "pending_review" : r.compliance.flag === "ok");
        if (!five) bad.push(lang + ":" + d + ":" + b);
      }
    }
  }
  ok(bad.length === 0, "引擎组合 " + combos + " 个（25 组合 × 双语）五件齐全且文案全部命中字典" + (bad.length ? "，坏：" + bad.join(",") : ""));
  const t = tt(I18N.zh);
  const kn = OOOProblems.solveLocally(
    { domain: "exam", bottleneck: "rules", what: "", tried: "", stuck: "", impact: 2, urgency: 2, desired: "", support: "", resources: [] },
    knowledge, t, () => false);
  ok(kn.knowledge.length === 1 && kn.knowledge[0].title === "考试规则卡", "知识卡按领域标签匹配（exam → 1 张）");
  const comp = OOOProblems.solveLocally(
    { domain: "business", bottleneck: "funds", what: "涉及签证和报税", tried: "", stuck: "", impact: 2, urgency: 2, desired: "", support: "", resources: [] },
    [], t, () => false);
  ok(comp.compliance.flag === "pending_review" && comp.compliance.words.includes("签证"),
    "合规闸：自由文本命中「签证」→ pending_review（本地标记）");
  const risk = OOOProblems.solveLocally(
    { domain: "emotion", bottleneck: "low", what: "很难受", tried: "", stuck: "", impact: 3, urgency: 3, desired: "", support: "", resources: [] },
    [], t, () => true);
  ok(risk.risk === true && risk.escalate.needed && risk.escalate.reasons.some((x) => x.includes("关怀")),
    "风险词命中 → risk 标记 + 升级理由含关怀项");
  const hi = OOOProblems.solveLocally(
    { domain: "study", bottleneck: "behind", what: "", tried: "", stuck: "", impact: 5, urgency: 5, desired: "", support: "", resources: [] },
    [], t, () => false);
  ok(hi.breakdown.level === "high" && hi.escalate.needed, "影响×紧迫 = 25 → 高优先级 + 建议升级导师");
}

/* ---------- fake IndexedDB（支持 private.js 的 withStore 单事务模式） ---------- */
function makeFakeIDB() {
  const stores = new Map();
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      return { createIndex() {} };
    },
    transaction(names, mode) {
      const tx = { error: null, oncomplete: null, onerror: null, onabort: null };
      tx.objectStore = (name) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const map = stores.get(name);
        const clone = (v) => JSON.parse(JSON.stringify(v));
        const op = (fn) => {
          const req = { result: undefined, error: null, onsuccess: null, onerror: null };
          queueMicrotask(() => {
            try { req.result = fn(); } catch (e) {
              req.error = e; tx.error = e;
              if (req.onerror) req.onerror();
              if (tx.onerror) tx.onerror();
              return;
            }
            if (req.onsuccess) req.onsuccess();
            queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
          });
          return req;
        };
        return {
          createIndex() {},
          add: (v) => op(() => { if (map.has(v.local_id)) throw new Error("ConstraintError"); map.set(v.local_id, clone(v)); return v.local_id; }),
          put: (v) => op(() => { map.set(v.local_id, clone(v)); return v.local_id; }),
          get: (k) => op(() => { const v = map.get(k); return v ? clone(v) : undefined; }),
          getAll: () => op(() => [...map.values()].map(clone)),
          delete: (k) => op(() => { map.delete(k); }),
          clear: () => op(() => { map.clear(); }),
        };
      };
      return tx;
    },
  };
  const indexedDB = {
    open() {
      const req = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        if (req.onupgradeneeded) req.onupgradeneeded();
        queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); });
      });
      return req;
    },
  };
  return { indexedDB, stores };
}

/* ---------- v12 夹具 ---------- */
function fixtureData() {
  return {
    ok: true,
    student: { id: 7, slug: "fix", name: "Fixture", package: "", stage: "diag", stage_label: "评估诊断", note: "" },
    signature: "", signature_set_at: "",
    signature_suggestions: ["向着目标走的人"],
    school_system: "CUNY",
    goal: { target_school: "目标护理项目", target_term: "", gpa_target: "", goal_note: "" },
    goal_lines: [
      { id: 1, name: "学业", line_type: "main", line_type_label: "主线", priority: 1, status: "active", status_label: "进行中", next_step: "补齐先修课" },
    ],
    main_line: { id: 1, name: "学业", line_type: "main", line_type_label: "主线", priority: 1, status: "active", status_label: "进行中", next_step: "补齐先修课" },
    status: {
      latest: { id: 2, snapshot_date: "2026-06-01", gpa: 3.481, credits_done: 55, credits_total: 120, note: "" },
      history: [{ id: 2, snapshot_date: "2026-06-01", gpa: 3.481, credits_done: 55, credits_total: 120, note: "" }],
    },
    exams: [{ id: 1, exam_name: "护理入学考试（名称待确认）", exam_date: "", score: "", pass_line: "", result: "fail", result_label: "未达标", note: "" }],
    courses: { progress: {}, groups: [], list: [] },
    meetings: [{ id: 1, meeting_date: "2026-10-01", topic: "首谈", summary: "", action_items: "", next_date: "" }],
    vision_text: "拿到护理学位，成为注册护士，再往飞行护士走",
    mentor_message: "", mentor_message_at: "",
    milestones: [
      { id: 1, date_text: "2025 秋季", title: "入学", detail: "", kind: "school", sort: 1, created_at: "2026-10-01T00:00:00.000Z" },
    ],
    key_dates: [{ id: 1, date: dstr(5), title: "提交材料" }],
    actions: [
      { id: 1, title: "待办一", detail: "", due_text: "", status: "todo", status_label: "待办", sort: 1, updated_at: "2026-10-20T00:00:00.000Z" },
      { id: 2, title: "已完成一", detail: "", due_text: "", status: "done", status_label: "已完成", sort: 2, updated_at: "2026-10-21T00:00:00.000Z" },
    ],
    advice: [],
    knowledge: [{ id: 1, title: "考试规则卡", body: "知识正文", tag: "exam" }],
    messages: [],
    unread_mentor: 0,
    problems: [
      { id: 11, domain: "exam", domain_label: "考试", title: "护理考试规则还没确认", desired_outcome: "弄清重考上限", strategy_summary: "", actions: [], support_needed: "", progress: "open", progress_label: "处理中", compliance: "pending_review", resolved_note: "", source_local_id: "", created_at: "2026-10-20T00:00:00.000Z", updated_at: "2026-10-20T00:00:00.000Z" },
      { id: 12, domain: "study", domain_label: "学业", title: "已解决的旧问题", desired_outcome: "", strategy_summary: "", actions: [], support_needed: "", progress: "resolved", progress_label: "已解决", compliance: "ok", resolved_note: "已处理", source_local_id: "", created_at: "2026-10-19T00:00:00.000Z", updated_at: "2026-10-21T00:00:00.000Z" },
    ],
    mentor_trail: [
      { id: 21, meeting_id: 1, meeting_date: "2026-10-01", meeting_topic: "首谈", mentor_name: "李老师", mentor_role: "teacher", mentor_role_label: "任课老师", spirit_line: "先稳住节奏，再谈速度", key_judgments: "判断一\n判断二", student_takeaway: "领受原文", takeaway_local: false, followup_actions: "行动一", revisit_result: "", revisit_due: dstr(-1), visibility: "mentor", source: "mentor", created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z" },
      { id: 22, meeting_id: null, meeting_date: "", meeting_topic: "", mentor_name: "王教练", mentor_role: "coach", mentor_role_label: "教练", spirit_line: "把大目标拆到每天", key_judgments: "", student_takeaway: "", takeaway_local: true, followup_actions: "", revisit_result: "", revisit_due: "2099-01-01", visibility: "mentor", source: "student", created_at: "2026-10-15T00:00:00.000Z", updated_at: "2026-10-15T00:00:00.000Z" },
    ],
    course_match: [
      {
        id: 31, name: "情景一 · CSI 本校", source_note: "来源：intake 台账", version_text: "v1", verified: false, sort: 1,
        match: {
          totals: { total: 3, done: 1, in_progress: 1, planned: 0, missing: 1, credits_total: 11, credits_done: 4, credits_missing: 3, credits_unknown: 4 },
          blocks: {
            prereq: { total: 2, done: 1, in_progress: 0, planned: 0, missing: 1, credits_total: 7, credits_done: 4, credits_missing: 3, credits_unknown: 0 },
            core: { total: 1, done: 0, in_progress: 1, planned: 0, missing: 0, credits_total: 0, credits_done: 0, credits_missing: 0, credits_unknown: 4 },
            gened: { total: 0, done: 0, in_progress: 0, planned: 0, missing: 0, credits_total: 0, credits_done: 0, credits_missing: 0, credits_unknown: 0 },
            elective: { total: 0, done: 0, in_progress: 0, planned: 0, missing: 0, credits_total: 0, credits_done: 0, credits_missing: 0, credits_unknown: 0 },
          },
          items: [],
          missing: [{ code: "BIO 350", name: "微生物学", block: "prereq", credits: 3, min_grade: null, prereq_codes: ["BIO 160"] }],
          grade_warnings: [{ code: "PSY 100", grade: "B-", kind: "watch" }],
          prereq_breaks: [{ code: "BIO 351", missing_prereq: "BIO 350" }],
        },
      },
      { id: 32, name: "情景二 · UTA（待核实）", source_note: "官方要求未核实", version_text: "", verified: false, sort: 2, match: null },
    ],
  };
}

/* ---------- 窗口工装 ---------- */
function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM(HTML, {
    url: "https://zhuanuc.com/one-on-one-app/?s=fix&k=key-fix&api=https://api.test",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const fake = makeFakeIDB();
  if (opts.seed) {
    const map = new Map();
    for (const e of opts.seed) map.set(e.local_id, e);
    fake.stores.set("entries", map);
  }
  w.indexedDB = fake.indexedDB;
  w.confirm = () => true;
  w.prompt = () => "";
  w.HTMLElement.prototype.scrollIntoView = () => {};
  const blobs = [];
  w.URL.createObjectURL = (b) => { blobs.push(b); return "blob:fake-" + blobs.length; };
  w.URL.revokeObjectURL = () => {};
  const canvasCalls = [];
  w.HTMLCanvasElement.prototype.getContext = function () {
    return {
      fillStyle: "", font: "",
      createLinearGradient: () => ({ addColorStop() {} }),
      fillRect() {}, beginPath() {}, arc() {}, fill() {},
      measureText: (s) => ({ width: String(s).length * 20 }),
      fillText: (txt) => { canvasCalls.push(String(txt)); },
    };
  };
  w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
  if (opts.speech) {
    class FakeSR {
      constructor() { FakeSR.instances.push(this); this.lang = ""; }
      start() { this.started = true; }
      stop() { this.stopped = true; if (this.onend) this.onend(); }
    }
    FakeSR.instances = [];
    w.SpeechRecognition = FakeSR;
    w.__FakeSR = FakeSR;
  }
  const requests = [];
  const data = fixtureData();
  w.fetch = async (url, o) => {
    const u = String(url);
    const body = o && o.body ? String(o.body) : "";
    requests.push({ url: u, method: (o && o.method) || "GET", body });
    const j = (status, obj) => ({ status, ok: status >= 200 && status < 300, json: async () => obj });
    if (u.includes("/api/client/problem/status")) {
      const b = JSON.parse(body);
      return j(200, { ok: true, problem: Object.assign({}, data.problems.find((p) => p.id === b.id) || {}, { id: b.id, progress: b.progress, progress_label: "已解决", resolved_note: b.resolved_note || "", updated_at: new Date().toISOString() }) });
    }
    if (u.includes("/api/client/problem")) {
      const b = JSON.parse(body);
      return j(200, { ok: true, problem: { id: 501, domain: b.domain, domain_label: "考试", title: b.title, desired_outcome: b.desired_outcome || "", strategy_summary: b.strategy_summary || "", actions: b.actions || [], support_needed: b.support_needed || "", progress: "open", progress_label: "处理中", compliance: "ok", resolved_note: "", source_local_id: b.source_local_id || "", created_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    }
    if (u.includes("/api/client/trail")) return j(200, { ok: true, id: 777 });
    if (u.includes("/api/client/message")) {
      const b = JSON.parse(body);
      return j(200, { ok: true, message: { id: 900, sender: "student", sender_label: "我", body: b.body || "", created_at: new Date().toISOString() } });
    }
    if (u.includes("/api/client/signature")) return j(200, { ok: true, signature: "向着目标走的人" });
    return j(200, JSON.parse(JSON.stringify(data)));
  };
  // 三个脚本按 index.html 的顺序拼成一次求值：真实浏览器里多个 <script> 共享全局词法作用域，
  // 而 jsdom 的多次 w.eval 之间顶层 const 不互见，拼接求值与浏览器语义一致。
  w.eval(PRIV + "\n" + PROB + "\n" + APP);
  return { w, requests, blobs, canvasCalls, fake };
}
let W = null;
const $ = (id) => W.document.getElementById(id);
const SECRET1 = "私密哨兵-甲-7392";
const SECRET2 = "自由文本哨兵-乙-5511";
const TODAY_LINE = "今日一句话哨兵-丙-8848";

/* ================= B. 窗口 A：驾驶舱 / 今日状态 / 私密空间 / 问题中心 / 轨迹 / 匹配 / 动态分享 ================= */
const seedEntries = [
  { local_id: "seed-mood-today", type: "mood", body: "种子今日状态", mood_tag: 3, problem_tags: [], created_at: isoAt(0, 8), updated_at: isoAt(0, 8) },
  { local_id: "seed-mood-yday", type: "mood", body: "种子昨日状态", mood_tag: 2, problem_tags: [], created_at: isoAt(-1, 8), updated_at: isoAt(-1, 8) },
  { local_id: "seed-tk-22", type: "note", body: "本机领受哨兵-丁-2210", mood_tag: null, problem_tags: ["trail#22"], created_at: isoAt(-2, 8), updated_at: isoAt(-2, 8) },
];
const A = makeWindow({ seed: seedEntries });
const w = A.w;
W = w;
await tick(80);

section("B1. 首页驾驶舱：梦想距离清单式（禁百分比）+ 当前障碍");
{
  const dream = $("dream-body");
  ok(!!dream && dream.textContent.includes("拿到护理学位"), "梦想距离：终点 = 愿景原文");
  ok(dream.textContent.includes("学分还差 65"), "还差几步含事实行：学分还差 65（55/120）");
  ok(dream.textContent.includes("已跨过") || dream.innerHTML.includes("入学"), "已跨过含里程碑");
  ok(!dream.innerHTML.includes("%"), "★ 梦想卡整卡无 % 字符（严禁编造百分比）");
  const ob = $("obstacles-body");
  ok(ob.textContent.includes("护理考试规则还没确认"), "当前障碍来自方案层未关闭问题");
  ok(ob.textContent.includes("待核实"), "待核实问题带合规徽标");
  ok(!ob.textContent.includes("已解决的旧问题"), "已解决的问题不进当前障碍");
}

section("B2. 今日状态：写私密层 + 连续天数（种子 2 天）");
{
  ok($("today-status").textContent.includes("连续第 2 天"), "种子今+昨两天 → 连续第 2 天");
  ok($("today-line").value === "种子今日状态", "今日一句话回填本机已有记录");
  const postsBefore = A.requests.filter((r) => r.method === "POST").length;
  [...$("today-moods").querySelectorAll(".mood-btn")][3].click();
  $("today-line").value = TODAY_LINE;
  $("today-save").click();
  await tick(80);
  const entries = [...A.fake.stores.get("entries").values()];
  const mine = entries.filter((e) => e.type === "mood");
  ok(mine.length === 2, "今日状态更新同一条（不新增重复条目），mood 共 2 条");
  const today = mine.find((e) => e.local_id === "seed-mood-today");
  ok(today && today.mood_tag === 4 && today.body === TODAY_LINE, "心情 4 档 + 一句话已写本机");
  ok(A.requests.filter((r) => r.method === "POST").length === postsBefore, "今日状态保存零网络请求");
}

section("B3. 私密空间：本地存取 / 双导出 / 关怀页 / 删除（全程零网络）");
{
  const reqBefore = A.requests.length;
  w.document.querySelector('[data-open="private"]').click();
  await tick(60);
  ok(!$("view-private").hidden, "私密空间视图打开");
  ok($("private-body").textContent.includes("只保存在这台设备"), "隐私说明含诚实边界（只存本机）");
  $("pv-body").value = SECRET1 + " 今天考试没过很烦";
  $("pv-save").click();
  await tick(80);
  let entries = [...A.fake.stores.get("entries").values()];
  ok(entries.some((e) => (e.body || "").includes(SECRET1)), "日记正文已存 IndexedDB");
  ok(A.requests.length === reqBefore, "★ 私密保存期间网络请求数不变（零请求）");
  ok($("pv-saved").textContent.includes("已存到本机"), "保存反馈文案出现");
  // 导出 Markdown / JSON 到本机（Blob 捕获）
  const blobsBefore = A.blobs.length;
  $("pv-exp-md").click();
  await tick(60);
  ok(A.blobs.length === blobsBefore + 1, "Markdown 导出生成 Blob");
  const mdText = await A.blobs[A.blobs.length - 1].text();
  ok(mdText.includes(SECRET1) && mdText.includes("我的私密记录"), "Markdown 导出含正文与标题");
  $("pv-exp-json").click();
  await tick(60);
  const jsonText = await A.blobs[A.blobs.length - 1].text();
  const parsed = JSON.parse(jsonText);
  ok(parsed.app === "one-on-one-private" && parsed.entries.some((e) => (e.body || "").includes(SECRET1)),
    "JSON 导出结构正确且含正文");
  ok(A.requests.length === reqBefore, "★ 导出期间同样零网络请求");
  // 风险词 → 关怀页只在本机出现
  $("pv-body").value = "最近总是想死，撑不住了";
  $("pv-save").click();
  await tick(80);
  ok(!$("pv-care").hidden, "风险词命中 → 关怀页在本机展开");
  ok($("pv-care").textContent.includes("988"), "关怀页含 988 资源");
  ok(A.requests.length === reqBefore, "★ 关怀触发零上报（请求数仍不变）");
  // 单条删除
  const item = [...$("pv-list").querySelectorAll(".priv-item")].find((el) => el.textContent.includes(SECRET1));
  ok(!!item, "列表里能找到刚存的日记");
  item.querySelector('[data-act="del"]').click();
  await tick(80);
  entries = [...A.fake.stores.get("entries").values()];
  ok(!entries.some((e) => (e.body || "").includes(SECRET1)), "单条删除后本机无此正文");
  // 无语音识别的浏览器：私密语音按钮置灰 + 原因
  const micBtn = $("pv-mic").querySelector(".mic-btn");
  ok(micBtn && micBtn.disabled, "无 SpeechRecognition 时私密语音按钮置灰");
  ok($("pv-mic").textContent.includes("不支持语音识别"), "置灰原因明示");
  w.document.querySelector("#view-private [data-close]").click();
  ok($("view-private").hidden, "返回钮关闭私密视图");
}

section("B4. 问题解决中心：本地生成五件 + 逐项同步载荷（自由文本不出设备）");
{
  w.document.querySelector('[data-open="problems"]').click();
  await tick(60);
  ok(!$("view-problems").hidden, "问题中心视图打开");
  ok($("problems-body").textContent.includes("本地"), "界面如实标注本地引擎");
  const root = $("problems-body");
  root.querySelector("#pb-domain").value = "exam";
  root.querySelector("#pb-domain").dispatchEvent(new w.Event("change", { bubbles: true }));
  root.querySelector("#pb-what").value = SECRET2 + " 护理考试到底考了什么";
  root.querySelector("#pb-desired").value = "弄清重考规则与上限";
  root.querySelector("#pb-support").value = "请导师确认规则出处";
  root.querySelector("#pb-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await tick(60);
  ok(!root.querySelector("#pb-result-card").hidden, "本地引擎已生成方案");
  const rtext = root.querySelector("#pb-result").textContent;
  ok(rtext.includes("问题拆解") && rtext.includes("今日可做的一步") && rtext.includes("7 天集中方案"),
    "五件产出渲染（拆解/今日一步/7 天方案）");
  ok(rtext.includes("考试规则卡"), "知识卡按领域命中并展示");
  // 逐项确认：取消勾选「期望结果」后再同步
  const chkDesired = [...root.querySelectorAll(".pb-sync-f")].find((c) => c.value === "desired");
  chkDesired.checked = false;
  root.querySelector("#pb-sync-btn").click();
  await tick(80);
  const post = A.requests.find((r) => r.url.includes("/api/client/problem") && r.method === "POST");
  ok(!!post, "同步走了新接口 POST /api/client/problem");
  const payload = JSON.parse(post.body);
  ok(payload.desired_outcome === "", "未勾选字段不进载荷（desired_outcome 为空）");
  ok(typeof payload.title === "string" && payload.title.length > 0, "标题字段在载荷内");
  ok(!("what" in payload) && !("tried" in payload) && !("stuck" in payload), "载荷无自由文本字段");
  ok(!post.body.includes(SECRET2), "★ 同步请求体不含自由文本哨兵");
  ok(root.querySelector("#pb-syncmsg").textContent.includes("已同步"), "同步成功反馈");
  // 升级导师：确认后走留言通道，内容是摘要不是原文
  root.querySelector("#pb-esc-btn").click();
  await tick(80);
  const msg = A.requests.find((r) => r.url.includes("/api/client/message"));
  ok(!!msg && !msg.body.includes(SECRET2), "★ 升级导师留言不含自由文本原文");
  w.document.querySelector("#view-problems [data-close]").click();
}

section("B5. 成长动态：事实事件流 + 隐藏 + 分享卡门控与 Canvas");
{
  w.document.querySelector('.tab-btn[data-tab="growth"]').click();
  await tick(80);
  const feed = $("feed-list").textContent;
  ok(feed.includes("已完成一"), "动态含已完成行动");
  ok(feed.includes("入学"), "动态含里程碑");
  ok(feed.includes("已解决的旧问题"), "动态含已解决问题");
  ok(feed.includes("先稳住节奏"), "动态含导师轨迹精神句");
  ok(feed.includes("连续第 2 天"), "动态含连续记录（本地种子 2 天）");
  const item = [...$("feed-list").querySelectorAll(".feed-item")].find((el) => el.textContent.includes("已完成一"));
  item.querySelector("[data-share]").click();
  await tick(40);
  ok(!$("view-share").hidden, "分享视图打开");
  ok($("share-img").disabled && $("share-copy").disabled, "隐私清单未勾完 → 导出按钮禁用");
  ok($("share-warn").hidden, "方案层内容分享不显示私密警告");
  [...w.document.querySelectorAll(".share-chk")].forEach((c) => { c.checked = true; c.dispatchEvent(new w.Event("change", { bubbles: true })); });
  ok(!$("share-img").disabled, "四项全勾 → 导出启用");
  $("share-img").click();
  await tick(40);
  ok(A.canvasCalls.some((x) => x.includes("已完成一")), "Canvas 已绘制分享文案");
  ok(!$("share-preview").hidden, "分享图片预览出现");
  w.document.querySelector("#view-share [data-close]").click();
}

section("B6. 导师轨迹：筛选 / 待回看 / 本机领受回填 / 学生自建");
{
  w.document.querySelector('[data-open="trail"]').click();
  await tick(80);
  ok(!$("view-trail").hidden, "轨迹视图打开");
  const body = $("trail-body");
  ok(body.textContent.includes("待回看"), "到期未回看条目有提示");
  ok(body.textContent.includes("已在本机记录"), "本机领受显示占位标记（不显示服务器正文）");
  ok(body.textContent.includes("本机领受哨兵-丁-2210"), "本机领受从 IndexedDB 回填显示");
  const sel = $("trail-filter");
  ok([...sel.options].some((o) => o.value === "李老师") && [...sel.options].some((o) => o.value === "王教练"),
    "导师筛选含两位导师");
  sel.value = "王教练";
  sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick(40);
  ok($("trail-list").textContent.includes("把大目标拆到每天") && !$("trail-list").textContent.includes("先稳住节奏"),
    "筛选后只剩王教练条目");
  // 筛选重渲会换掉 select 节点，复位筛选要重新取当前节点
  const selBack = $("trail-filter");
  selBack.value = "";
  selBack.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick(40);
  $("tc-name").value = "陈老师";
  $("tc-spirit").value = "自建精神句哨兵";
  $("tc-takeaway").value = "自建领受";
  $("trail-create").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await tick(80);
  const post = A.requests.find((r) => r.url.includes("/api/client/trail") && r.method === "POST");
  ok(!!post && JSON.parse(post.body).action === "create", "学生自建走 POST /api/client/trail create");
  ok($("trail-list").textContent.includes("自建精神句哨兵"), "自建条目即时进入轨迹列表");
  w.document.querySelector("#view-trail [data-close]").click();
}

section("B7. 课程匹配：分块渲染 / 缺课与预警断裂 / 框架情景 / 免责标注");
{
  w.document.querySelector('.tab-btn[data-tab="plan"]').click();
  await tick(60);
  ok($("match-entry-body").textContent.includes("还缺 1 门"), "规划页入口卡显示情景一缺课数");
  w.document.querySelector('[data-open="match"]').click();
  await tick(60);
  const body = $("match-body");
  ok(body.textContent.includes("专业先修"), "分块渲染：专业先修块出现");
  ok(body.textContent.includes("BIO 350") && body.textContent.includes("微生物学"), "缺课清单含 BIO 350");
  ok(body.textContent.includes("PSY 100"), "成绩预警（通用提示口径）含 PSY 100");
  ok(body.textContent.includes("BIO 351"), "先修断裂含 BIO 351 ← BIO 350");
  ok(body.textContent.includes("以学校官方学位审计为准"), "结果带官方审计免责标注");
  const chip2 = [...body.querySelectorAll("[data-set]")][1];
  chip2.click();
  await tick(40);
  ok($("match-body").textContent.includes("只建框架") || $("match-body").textContent.includes("还没有核实"),
    "情景二只有框架文案、无编造要求");
  w.document.querySelector("#view-match [data-close]").click();
}

section("B8. ★ 隐私红线总检：私密正文不出现在任何请求中");
{
  const allBodies = A.requests.map((r) => r.body).join("\n");
  ok(!allBodies.includes(SECRET1), "日记哨兵不在任何请求体");
  ok(!allBodies.includes(SECRET2), "问题自由文本哨兵不在任何请求体");
  ok(!allBodies.includes(TODAY_LINE), "今日一句话不在任何请求体");
  ok(!allBodies.includes("本机领受哨兵-丁-2210"), "本机领受不在任何请求体");
  ok(!allBodies.includes("想死"), "风险原文不在任何请求体");
  const getUrls = A.requests.filter((r) => r.method === "GET").map((r) => r.url).join(" ");
  ok(!/diary|journal|mood|emotion/.test(getUrls), "请求路径不含私密字段名");
}

/* ================= C. 窗口 B：语音（有 SpeechRecognition）默认关 + 云端明示 + 填入可改 ================= */
section("C. 语音输入：私密口默认关闭、明示云端处理、主动开启才识别");
{
  const B = makeWindow({ speech: true });
  const wb = B.w;
  await tick(80);
  wb.document.querySelector('[data-open="private"]').click();
  await tick(60);
  const micBtn = wb.document.querySelector("#pv-mic .mic-btn");
  ok(micBtn && !micBtn.disabled, "有识别能力时私密语音按钮可用（但默认未开启）");
  micBtn.click();
  await tick(40);
  const note = wb.document.querySelector("#pv-mic .voice-note");
  ok(note && !note.hidden && note.textContent.includes("云端"), "首次点击先弹明示：识别由浏览器厂商云端处理");
  ok(wb.__FakeSR.instances.length === 0, "未确认前不启动识别");
  note.querySelector('[data-vact="enable"]').click();
  await tick(40);
  ok(wb.__FakeSR.instances.length === 1 && wb.__FakeSR.instances[0].started, "学生主动开启后才启动识别");
  const rec = wb.__FakeSR.instances[0];
  ok(rec.lang === "zh-CN", "识别语言随界面语言（zh-CN）");
  rec.onresult({ results: [[{ transcript: "语音填入哨兵文本" }]] });
  await tick(30);
  ok(wb.document.querySelector("#pv-body").value.includes("语音填入哨兵文本"),
    "识别结果只填入输入框（可改），不直存");
  const bodies = B.requests.map((r) => r.body).join("\n");
  ok(!bodies.includes("语音填入哨兵文本"), "★ 识别文本未进任何网络请求");
  ok(wb.localStorage.getItem("ooo_voice_priv") === "1", "开启状态只存本机标量");
}

console.log("\n===== app-v12 前端测试：" + pass + " 通过 / " + fail + " 失败 =====");
process.exit(fail ? 1 : 0);
