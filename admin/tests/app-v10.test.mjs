// 一对一学生端 APP v10 前端断言（jsdom）：四页签 + 懒渲染 + 九模块渲染 + 留言发送 + 中英双语 + 空状态 + 手机静态验版。
// 运行：node tests/app-v10.test.mjs（jsdom 取自 ~/workspace/tools/jsdomtest/node_modules）
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/home/hatch/workspace/tools/jsdomtest/node_modules/jsdom");

const HTML = readFileSync(new URL("../../one-on-one-app/index.html", import.meta.url), "utf8");
const JS = readFileSync(new URL("../../one-on-one-app/majors.js", import.meta.url), "utf8") + "\n" +
  readFileSync(new URL("../../one-on-one-app/app.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../one-on-one-app/style.css", import.meta.url), "utf8");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function section(s) { console.log("\n== " + s); }
const tick = () => new Promise((r) => setTimeout(r, 40));
const dstr = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};

function baseData() {
  return {
    ok: true,
    student: { id: 7, slug: "fix", name: "Fixture", package: "", stage: "diag", stage_label: "评估诊断", note: "" },
    signature: "", signature_set_at: "",
    signature_suggestions: ["向着目标走的人", "一个不放弃的自己"],
    school_system: "CUNY",
    goal: { target_school: "目标护理项目", target_term: "", gpa_target: "", goal_note: "目标说明原文" },
    goal_lines: [
      { id: 1, name: "调料包创业", line_type: "main", line_type_label: "主线", priority: 1, status: "active", status_label: "进行中", next_step: "定版配方" },
      { id: 2, name: "预备役", line_type: "passive", line_type_label: "被动等待线", priority: 2, status: "active", status_label: "进行中", next_step: "" },
    ],
    main_line: { id: 1, name: "调料包创业", line_type: "main", line_type_label: "主线", priority: 1, status: "active", status_label: "进行中", next_step: "定版配方" },
    status: {
      latest: { id: 2, snapshot_date: "2026-06-01", gpa: 3.481, credits_done: 55, credits_total: 120, note: "最新备注" },
      history: [
        { id: 2, snapshot_date: "2026-06-01", gpa: 3.481, credits_done: 55, credits_total: 120, note: "最新备注" },
        { id: 1, snapshot_date: "2025-12-20", gpa: 3.2, credits_done: 30, credits_total: 120, note: "" },
      ],
    },
    exams: [{ id: 1, exam_name: "护理入学考试（名称待确认）", exam_date: "", score: "", pass_line: "", result: "fail", result_label: "未达标", note: "口述 3 次未达标" }],
    courses: {
      progress: { creditsDone: 44, creditsTotal: 55, prereqDone: 4, prereqTotal: 6, total: 3, doneCount: 1, byKind: { prereq: { total: 2, done: 1, credits: 8, creditsDone: 4 }, gened: { total: 1, done: 0, credits: 3, creditsDone: 0 }, elective: { total: 0, done: 0, credits: 0, creditsDone: 0 } } },
      groups: [{ term: "2025 秋季", courses: [{ id: 1 }, { id: 2 }] }, { term: "2026 秋季", courses: [{ id: 3 }] }],
      list: [
        { id: 1, term: "2025 秋季", course_code: "BIO 150", course_name: "生物 I", credits: 4, kind: "prereq", kind_label: "必修先修", status: "done", status_label: "已完成", grade: "B", note: "" },
        { id: 2, term: "2025 秋季", course_code: "ENG 111", course_name: "写作", credits: 3, kind: "gened", kind_label: "通识", status: "done", status_label: "已完成", grade: "A", note: "AP 兑换" },
        { id: 3, term: "2026 秋季", course_code: "CHM 110", course_name: "化学", credits: 4, kind: "prereq", kind_label: "必修先修", status: "ongoing", status_label: "进行中", grade: "", note: "" },
      ],
    },
    meetings: [{ id: 1, meeting_date: "2026-10-01", topic: "首谈", summary: "纪要原文", action_items: "交材料", next_date: "" }],
    vision_text: "BSN + NCLEX-RN → 空军护理军官",
    mentor_message: "寄语原文一句", mentor_message_at: "2026-10-21T00:00:00.000Z",
    milestones: [
      { id: 1, date_text: "2025 秋季", title: "入学", detail: "细节一", kind: "school", sort: 1 },
      { id: 2, date_text: "", title: "考试未达标", detail: "", kind: "exam", sort: 2 },
    ],
    key_dates: [
      { id: 1, date: dstr(10), title: "未来的日子" },
      { id: 2, date: dstr(-1), title: "已过去的日子" },
      { id: 3, date: dstr(0), title: "今天的日子" },
    ],
    actions: [
      { id: 1, title: "待办一", detail: "", due_text: "本周内", status: "todo", status_label: "待办", sort: 1 },
      { id: 2, title: "已完成一", detail: "", due_text: "", status: "done", status_label: "已完成", sort: 2 },
    ],
    advice: [{ id: 1, title: "建议标题", body: "建议正文", created_at: "2026-10-20T00:00:00.000Z" }],
    knowledge: [
      { id: 1, title: "知识一", body: "知识正文一", tag: "study" },
      { id: 2, title: "知识二", body: "知识正文二", tag: "business" },
    ],
    messages: [{ id: 1, sender: "mentor", sender_label: "导师", body: "导师留言原文", created_at: "2026-10-20T09:00:00.000Z" }],
    unread_mentor: 1,
  };
}

function makeWindow(data, postBehavior) {
  const dom = new JSDOM(HTML, {
    url: "https://zhuanuc.com/one-on-one-app/?s=fix&k=key-fix&api=https://api.test",
    runScripts: "outside-only",
  });
  const w = dom.window;
  w.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("/api/client/message")) {
      if (postBehavior) { const b = postBehavior(); return { status: b.status, ok: b.status >= 200 && b.status < 300, json: async () => b.body }; }
      let echo = "";
      try { echo = JSON.parse(opts.body).body || ""; } catch (e) { /* 忽略 */ }
      return { status: 200, ok: true, json: async () => ({ ok: true, message: { id: 99, sender: "student", body: echo, created_at: "2026-10-21T10:00:00.000Z" } }) };
    }
    if (u.includes("/api/client/signature")) {
      return { status: 200, ok: true, json: async () => ({ ok: true, signature: "向着目标走的人" }) };
    }
    return { status: 200, ok: true, json: async () => JSON.parse(JSON.stringify(data)) };
  };
  w.eval(JS);
  return w;
}
const $ = (w, id) => w.document.getElementById(id);
const tabBtn = (w, name) => w.document.querySelector('.tab-btn[data-tab="' + name + '"]');

/* ================= 实例 A：全量数据 ================= */
const w = makeWindow(baseData());
await tick();

section("首屏：只渲染首页 + 页签与红点");
{
  ok(!$(w, "app").hidden && !$(w, "tabbar").hidden, "APP 与页签栏显示");
  ok(!$(w, "page-home").hidden && $(w, "page-growth").hidden && $(w, "page-plan").hidden && $(w, "page-mentor").hidden,
    "首屏只有首页可见");
  const labels = [...w.document.querySelectorAll(".tab-btn")].map((b) => b.textContent.replace(/[⌂↗◎✎]/g, "").trim());
  ok(JSON.stringify(labels) === JSON.stringify(["首页", "成长", "规划", "导师"]), "四页签中文名：" + labels.join("/"));
  ok($(w, "timeline").innerHTML === "" && $(w, "advice-list").innerHTML === "" && $(w, "knowledge-list").innerHTML === "",
    "懒渲染：成长/规划/导师内容首屏未渲染");
  ok($(w, "tab-dot").hidden === false, "未读导师留言=1 → 导师页签红点亮");
  ok($(w, "stu-name").textContent === "Fixture", "姓名渲染");
  ok(w.document.title === "Fixture 的专属APP", "标题个性化");
  ok(!$(w, "sec-mentor").hidden && $(w, "mentor-body").textContent === "寄语原文一句", "导师寄语卡渲染");
  ok($(w, "daily-quote").textContent.length > 0, "每日一句有内容");
  ok($(w, "sign-confirm") !== null, "签名候选区渲染（未设置态）");
}

section("首页：倒计时三态 + 行动清单完成度");
{
  const cd = $(w, "countdown-list").textContent;
  ok(cd.includes("还有 10 天"), "未来日期 → 还有 10 天");
  ok(cd.includes("已到期"), "过期日期 → 已到期");
  ok(cd.includes("就是今天"), "今日日期 → 就是今天");
  ok($(w, "actions-progress").textContent.includes("已完成 1 / 共 2"), "完成度统计：已完成 1 / 共 2");
  const doneItem = [...w.document.querySelectorAll(".act-item")].find((el) => el.classList.contains("done"));
  ok(!!doneItem && doneItem.textContent.includes("已完成一"), "done 项带 done 样式类");
}

section("成长页：切换后才渲染（时间线/曲线/考试/选课已修在修）");
{
  tabBtn(w, "growth").click();
  ok(!$(w, "page-growth").hidden && $(w, "page-home").hidden, "切换到成长页");
  ok(w.document.querySelectorAll(".tl-item").length === 2, "时间线 2 条");
  ok($(w, "timeline").textContent.includes("2025 秋季") && $(w, "timeline").textContent.includes("入学"), "时间线含学期文本与标题");
  const svg = $(w, "status-curve").querySelector("svg.chart");
  ok(!!svg && !!svg.querySelector("polyline"), "两条快照 → GPA 折线 SVG 已绘");
  ok(!!$(w, "status-curve").querySelector("svg.ring"), "学分进度环已绘");
  ok($(w, "status-curve").textContent.includes("46%"), "进度环比例 55/120 → 46%");
  ok($(w, "exams").textContent.includes("护理入学考试"), "考试记录渲染（数据原文不翻译）");
  ok($(w, "courses-done-list").textContent.includes("CHM 110") && $(w, "courses-done-list").textContent.includes("BIO 150"),
    "已修与在修列表含 done + ongoing");
  ok($(w, "courses-done-summary").textContent.includes("已完成 2 门"), "已修在修汇总口径");
  ok($(w, "meetings").textContent.includes("首谈"), "会议记录在成长页渲染");
  ok($(w, "empty-growth").hidden, "有内容 → 整页占位不显示");
}

section("规划页：人生线/愿景/学业目标/选课规划/导师建议");
{
  tabBtn(w, "plan").click();
  ok($(w, "goal-lines").textContent.includes("调料包创业"), "人生线渲染");
  ok(!$(w, "sec-vision").hidden && $(w, "vision-text").textContent.includes("BSN"), "愿景板渲染愿景文本");
  ok($(w, "vision-goal").textContent.includes("目标护理项目"), "愿景板带目标项目");
  ok(!$(w, "sec-goal-detail").hidden && $(w, "goal-detail").textContent.includes("目标说明原文"), "学业目标详情渲染");
  ok($(w, "course-groups").textContent.includes("2025 秋季") && $(w, "course-groups").textContent.includes("CHM 110"),
    "选课规划按学期分组渲染");
  ok($(w, "advice-list").textContent.includes("建议标题") && $(w, "advice-list").textContent.includes("建议正文"),
    "导师建议渲染");
  ok($(w, "empty-plan").hidden, "有内容 → 占位不显示");
}

section("导师页：知识卡 + 留言线程 + 发送全流程");
{
  tabBtn(w, "mentor").click();
  ok($(w, "tab-dot").hidden === true, "进入导师页 → 红点消");
  ok(w.document.querySelectorAll(".know-item").length === 2, "知识卡 2 条");
  ok($(w, "msg-thread").textContent.includes("导师留言原文"), "线程渲染导师留言");
  // 发送成功
  $(w, "msg-input").value = "老师您好，这是我的问题";
  $(w, "msg-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  ok($(w, "msg-thread").textContent.includes("老师您好，这是我的问题"), "发送成功 → 线程新增学生留言");
  ok($(w, "msg-input").value === "", "发送后输入框清空");
  ok($(w, "msg-err").hidden, "发送成功无错误提示");
}

section("留言失败口径：错 key 404 / 限流 429");
{
  const w404 = makeWindow(baseData(), () => ({ status: 404, body: { ok: false } }));
  await tick();
  tabBtn(w404, "mentor").click();
  $(w404, "msg-input").value = "测试";
  $(w404, "msg-form").dispatchEvent(new w404.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  ok(!$(w404, "msg-err").hidden && $(w404, "msg-err").textContent.includes("链接已失效"), "404 → 链接失效文案");
  const w429 = makeWindow(baseData(), () => ({ status: 429, body: { ok: false } }));
  await tick();
  tabBtn(w429, "mentor").click();
  $(w429, "msg-input").value = "测试";
  $(w429, "msg-form").dispatchEvent(new w429.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  ok($(w429, "msg-err").textContent.includes("发送太频繁"), "429 → 限流文案");
}

section("双语：切 EN 后界面英文、数据原文；切回 zh 恢复");
{
  const zhQuote = $(w, "daily-quote").textContent;
  const zhQuoteSub = $(w, "daily-quote-en").textContent;
  $(w, "lang-toggle").click();
  const labels = [...w.document.querySelectorAll(".tab-btn")].map((b) => b.textContent.replace(/[⌂↗◎✎]/g, "").trim());
  ok(JSON.stringify(labels) === JSON.stringify(["Home", "Growth", "Plan", "Mentor"]), "页签变英文：" + labels.join("/"));
  tabBtn(w, "home").click(); // 切语言时停在导师页 → 回首页应按语言标记自动重渲染
  ok($(w, "daily-quote").textContent === zhQuoteSub && $(w, "daily-quote-en").textContent === zhQuote,
    "每日一句双语互换主/副");
  ok(w.document.title === "Fixture's Personal App", "标题变英文个性化");
  tabBtn(w, "growth").click();
  ok(w.document.querySelector("#sec-timeline h2").textContent === "Milestones", "时间线卡标题英文");
  ok(w.document.querySelector("#sec-status h2").textContent === "Current Status", "状态卡标题英文");
  ok($(w, "timeline").textContent.includes("入学"), "数据内容（里程碑标题）仍中文原文");
  tabBtn(w, "plan").click();
  ok(w.document.querySelector("#sec-advice h2").textContent === "Mentor's Advice", "建议卡标题英文");
  ok($(w, "goal-lines").textContent.includes("调料包创业"), "人生线数据原文不翻译");
  tabBtn(w, "home").click();
  ok(w.document.querySelector("#sec-countdown h2").textContent === "Key Dates", "倒计时卡标题英文");
  ok($(w, "countdown-list").textContent.includes("10 days left"), "相对天数变英文表述");
  $(w, "lang-toggle").click();
  const labels2 = [...w.document.querySelectorAll(".tab-btn")].map((b) => b.textContent.replace(/[⌂↗◎✎]/g, "").trim());
  ok(JSON.stringify(labels2) === JSON.stringify(["首页", "成长", "规划", "导师"]), "切回中文恢复");
  ok(w.localStorage.getItem("ooo_lang") === "zh", "语言选择已存 localStorage(ooo_lang)");
  ok($(w, "countdown-list").textContent.includes("还有 10 天"), "切回后倒计时中文表述恢复");
}

/* ================= 实例 B：空状态（Richa 形态：无关键日期/寄语/愿景增量/留言/知识） ================= */
section("空状态：无数据整卡不渲染 + 留言空文案 + 单点不画线");
{
  const d = baseData();
  d.key_dates = []; d.actions = []; d.milestones = []; d.advice = []; d.knowledge = [];
  d.messages = []; d.unread_mentor = 0; d.mentor_message = ""; d.mentor_message_at = ""; d.vision_text = "";
  d.status = { latest: { id: 1, snapshot_date: "2026-06-01", gpa: 3.481, credits_done: 55, credits_total: 120, note: "" }, history: [{ id: 1, snapshot_date: "2026-06-01", gpa: 3.481, credits_done: 55, credits_total: 120, note: "" }] };
  const w2 = makeWindow(d);
  await tick();
  ok($(w2, "sec-countdown").hidden && $(w2, "sec-actions").hidden && $(w2, "sec-mentor").hidden,
    "首页：倒计时/行动清单/寄语三卡不渲染");
  ok($(w2, "tab-dot").hidden === true, "无未读 → 无红点");
  tabBtn(w2, "growth").click();
  ok($(w2, "sec-timeline").hidden, "成长：时间线卡不渲染");
  ok(!$(w2, "status-curve").querySelector("svg.chart"), "单条快照 → 不画折线");
  ok($(w2, "status-curve").textContent.includes("只有一条状态快照"), "单点说明文案出现");
  tabBtn(w2, "plan").click();
  ok($(w2, "sec-advice").hidden, "规划：建议卡不渲染");
  ok(!$(w2, "sec-vision").hidden && $(w2, "vision-text").hidden,
    "愿景文本为空时愿景板仅剩目标拼装（文本不渲染）");
  tabBtn(w2, "mentor").click();
  ok($(w2, "sec-knowledge").hidden, "导师：知识卡不渲染");
  ok($(w2, "msg-thread").textContent.includes("有问题随时在这里留言，导师会回复"), "留言空状态文案");
}

/* ================= 实例 C：整页皆空 → 占位文案 ================= */
section("整页空占位");
{
  const d = baseData();
  d.goal_lines = []; d.main_line = null; d.goal = null; d.vision_text = "";
  d.status = { latest: null, history: [] }; d.exams = []; d.meetings = [];
  d.courses = { progress: {}, groups: [], list: [] };
  d.milestones = []; d.advice = []; d.knowledge = []; d.messages = []; d.unread_mentor = 0;
  d.actions = []; // v12：成长页新增「我的动态」（已完成行动会生成动态），真全空须连行动一并清空
  const w3 = makeWindow(d);
  await tick();
  tabBtn(w3, "growth").click();
  ok(!$(w3, "empty-growth").hidden && $(w3, "empty-growth").textContent.includes("这一页暂时还没有内容"),
    "成长页全空 → 占位文案");
  tabBtn(w3, "plan").click();
  ok(!$(w3, "empty-plan").hidden, "规划页全空 → 占位文案");
}

/* ================= 手机硬指标（静态验版，jsdom 无布局引擎） ================= */
section("手机硬指标：触控区 / safe-area / 390px 不横滚（CSS 静态断言）");
{
  const minH = (sel) => {
    const m = CSS.match(new RegExp(sel.replace(/[.#]/g, "\\$&") + "\\{[^}]*min-height:\\s*(\\d+)px"));
    return m ? Number(m[1]) : 0;
  };
  ok(minH(".tab-btn") >= 44, "底部页签触控高度 ≥44px（实际 " + minH(".tab-btn") + "）");
  ok(minH(".lang-toggle") >= 44, "语言切换触控高度 ≥44px");
  ok(minH(".btn-send") >= 44, "发送按钮触控高度 ≥44px");
  ok(minH(".btn-ghost") >= 44 && minH(".sign-opt") >= 44, "重试/签名候选触控高度 ≥44px");
  ok(CSS.includes("env(safe-area-inset-bottom)"), "safe-area-inset-bottom 已用（页签栏 + 内容留白）");
  ok(CSS.includes("@media (max-width:480px)"), "有窄屏媒体查询（纵向堆叠）");
  ok(CSS.includes("overflow-x:clip"), "主区禁横向滚动");
  const wide = [...CSS.matchAll(/(^|[^-\w])width:\s*(\d{3,})px/g)].filter((m) => Number(m[2]) > 390);
  ok(wide.length === 0, "CSS 无 >390px 固定宽度（max-width 除外）");
  const dom = new JSDOM(HTML, { url: "https://x.test/" });
  const btns = dom.window.document.querySelectorAll(".tab-btn");
  ok(btns.length === 4, "DOM 中 4 个页签按钮（390 视口下 flex 等分）");
}

console.log("\n==== app-v10 jsdom: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
