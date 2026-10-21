// 一对一家长端 v11 前端断言（jsdom）：四页签 + 双语 + 空状态 + 留言发送 + 未读红点 + 数据边界静态扫描 + 手机静态验版。
// 家长接口禁用字段扫描在 smoke-v11（服务端响应层）；本轮补 DOM 层：渲染结果不得出现密钥值与学生原始数据词汇。
// 运行：node tests/app-parent.test.mjs（jsdom 取自 ~/workspace/tools/jsdomtest/node_modules）
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/home/hatch/workspace/tools/jsdomtest/node_modules/jsdom");

const HTML = readFileSync(new URL("../../one-on-one-app/parent.html", import.meta.url), "utf8");
const JS = readFileSync(new URL("../../one-on-one-app/parent.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../one-on-one-app/style.css", import.meta.url), "utf8");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function section(s) { console.log("\n== " + s); }
const tick = () => new Promise((r) => setTimeout(r, 40));

function baseData() {
  return {
    ok: true,
    student: { name: "娃娃 Fixture", slug: "fixkid", stage: "diag", stage_label: "评估诊断", package: "一对一辅导" },
    updates: [
      { id: 2, update_date: "2026-06-01", title: "评估诊断阶段进展", body: "目前处于评估诊断阶段，资料正在统一核对。", current_focus: "核对学业记录与考试信息", next_step: "资料完整后形成考试策略", created_at: "2026-06-01T00:00:00.000Z" },
      { id: 1, update_date: "2026-05-01", title: "建档完成", body: "已完成建档。", current_focus: "", next_step: "", created_at: "2026-05-01T00:00:00.000Z" },
    ],
    support_actions: [
      { id: 1, title: "保留稳定节奏", detail: "保留稳定的学习与休息时间。", category: "", due_text: "", status: "active", status_label: "进行中", sort: 1 },
      { id: 2, title: "补充考试相关材料", detail: "如有考试名称或成绩通知，请发给导师。", category: "", due_text: "本周内", status: "active", status_label: "进行中", sort: 2 },
      { id: 3, title: "已寄出材料清单", detail: "", category: "", due_text: "", status: "done", status_label: "已完成", sort: 3 },
      { id: 4, title: "过期事项不应出现", detail: "", category: "", due_text: "", status: "archived", status_label: "已归档", sort: 4 },
    ],
    messages: [
      { id: 1, sender: "mentor", sender_label: "导师", body: "导师给家长的话", created_at: "2026-06-02T09:00:00.000Z" },
      { id: 2, sender: "parent", sender_label: "家长", body: "家长的提问", created_at: "2026-06-02T10:00:00.000Z" },
    ],
    unread_mentor_parent: 2,
  };
}
function emptyData() {
  return {
    ok: true,
    student: { name: "空娃", slug: "emptykid", stage: "diag", stage_label: "评估诊断" },
    updates: [], support_actions: [], messages: [], unread_mentor_parent: 0,
  };
}

function makeWindow(data, opts = {}) {
  const dom = new JSDOM(HTML, {
    url: "https://zhuanuc.com/one-on-one-app/parent.html?s=fixkid&p=pk_fixtoken&api=https://api.test",
    runScripts: "outside-only",
  });
  const w = dom.window;
  w.fetch = async (url, o) => {
    const u = String(url);
    if (u.includes("/api/parent/message")) {
      if (opts.postBehavior) { const b = opts.postBehavior(); return { status: b.status, ok: b.status >= 200 && b.status < 300, json: async () => b.body }; }
      let echo = "";
      try { echo = JSON.parse(o.body).body || ""; } catch (e) { /* 忽略 */ }
      return { status: 200, ok: true, json: async () => ({ ok: true, message: { id: 99, sender: "parent", body: echo, created_at: "2026-10-21T10:00:00.000Z" } }) };
    }
    if (opts.getStatus && opts.getStatus !== 200) {
      return { status: opts.getStatus, ok: false, json: async () => ({ ok: false, error: "not found" }) };
    }
    return { status: 200, ok: true, json: async () => JSON.parse(JSON.stringify(data)) };
  };
  w.eval(JS);
  return w;
}
const $ = (w, id) => w.document.getElementById(id);
const tabBtn = (w, name) => w.document.querySelector('.tab-btn[data-tab="' + name + '"]');
const bodyText = (w) => w.document.body.textContent;

/* ================= 实例 A：全量数据 ================= */
const w = makeWindow(baseData());
await tick();

section("首屏：首页渲染 + 页签 + 红点 + 凭据落存");
{
  ok(!$(w, "app").hidden && !$(w, "tabbar").hidden, "APP 与页签栏显示");
  ok(!$(w, "page-home").hidden && $(w, "page-progress").hidden && $(w, "page-support").hidden && $(w, "page-mentor").hidden,
    "首屏只有首页可见");
  const labels = [...w.document.querySelectorAll(".tab-btn")].map((b) => b.textContent.replace(/[🏠📈🤲💬]/g, "").trim());
  ok(JSON.stringify(labels) === JSON.stringify(["首页", "进展", "托举", "导师"]), "四页签中文名：" + labels.join("/"));
  ok($(w, "p-name").textContent === "娃娃 Fixture", "孩子姓名渲染");
  ok($(w, "p-stage").textContent === "评估诊断", "服务阶段中文名渲染");
  ok(!$(w, "p-package").hidden && $(w, "p-package").textContent === "一对一辅导", "套餐名渲染");
  ok($(w, "tab-dot").hidden === false, "未读导师留言=2 → 导师页签红点亮");
  ok($(w, "home-unread").hidden === false && $(w, "home-unread").textContent.includes("2"), "首页未读入口显示条数");
  ok(w.localStorage.getItem("oop_parent_id") === "fixkid" && w.localStorage.getItem("oop_parent_key") === "pk_fixtoken",
    "凭据存入家长端专属 localStorage 键");
  ok(w.localStorage.getItem("ooo_client_key") === null && w.localStorage.getItem("ooo_student_id") === null,
    "学生端 localStorage 键未被触碰（命名空间隔离）");
  ok(w.document.title === "娃娃 Fixture 家长更新", "页面标题动态为「<姓名> 家长更新」");
  const meta = w.document.querySelector('meta[name="apple-mobile-web-app-title"]');
  ok(meta && meta.getAttribute("content") === "娃娃 Fixture 家长更新", "添加到主屏幕名称同步");
}

section("首页：最新进展卡（标题/阶段进展/当前解决策略/下一步/日期）");
{
  const body = $(w, "latest-body").innerHTML;
  ok(body.includes("评估诊断阶段进展") && body.includes("目前处于评估诊断阶段"), "最新一条更新的标题与正文");
  ok(body.includes("阶段进展"), "正文以「阶段进展」小节呈现");
  ok(body.includes("当前解决策略") && body.includes("核对学业记录与考试信息"), "当前解决策略渲染");
  ok(body.includes("下一步") && body.includes("资料完整后形成考试策略"), "下一步渲染");
  ok($(w, "latest-date").textContent === "2026-06-01", "更新日期在卡头");
  ok(!body.includes("建档完成"), "首页只放最新一条（历史在进展页）");
}

section("进展页：阶段说明 + 时间线");
{
  tabBtn(w, "progress").click();
  ok(!$(w, "page-progress").hidden && $(w, "page-home").hidden, "切到进展页");
  ok($(w, "stage-chip").textContent === "评估诊断", "阶段徽标渲染");
  const items = w.document.querySelectorAll("#updates-list .tl-item");
  ok(items.length === 2, "时间线两条更新");
  ok(items[0].textContent.includes("评估诊断阶段进展") && items[1].textContent.includes("建档完成"), "时间线按接口顺序（新在前）");
}

section("托举页：固定原则 + 事项清单（archived 不展示、done 区分）");
{
  tabBtn(w, "support").click();
  ok(bodyText(w).includes("不在这里追问成绩与考试细节，给孩子保留稳定的空间"), "托举原则固定文案在页（中文）");
  const items = w.document.querySelectorAll("#support-list .act-item");
  ok(items.length === 3, "active 2 + done 1 渲染，archived 不展示");
  ok(items[0].textContent.includes("保留稳定节奏") && items[1].textContent.includes("补充考试相关材料"), "active 在前");
  ok(items[2].classList.contains("done") && items[2].textContent.includes("已寄出材料清单"), "done 事项带 done 样式区分");
  ok(items[1].textContent.includes("本周内"), "期限文本渲染");
  ok(!bodyText(w).includes("过期事项不应出现"), "archived 事项标题不出现");
}

section("导师页：固定说明 + 线程 + 红点消除");
{
  tabBtn(w, "mentor").click();
  ok(bodyText(w).includes("不会转成对学生的监视或追问"), "导师页固定说明在页（中文）");
  const rows = w.document.querySelectorAll("#msg-thread .msg-row");
  ok(rows.length === 2 && rows[0].classList.contains("mentor") && rows[1].classList.contains("mine"), "线程两条（导师左、家长右）");
  ok(rows[0].textContent.includes("导师给家长的话") && rows[1].textContent.includes("家长的提问"), "留言正文渲染");
  ok($(w, "tab-dot").hidden === true, "进入导师页后红点消除");
  tabBtn(w, "home").click();
  ok($(w, "home-unread").hidden === true, "回到首页未读入口已隐藏（进入导师页即清零未读）");
  tabBtn(w, "mentor").click();
}

section("留言发送：成功追加 / 429 / 404 文案");
{
  const input = $(w, "msg-input");
  input.value = "想问一下近况";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  ok($(w, "msg-count").textContent === "6 / 500", "字数计数");
  $(w, "msg-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  const rows = w.document.querySelectorAll("#msg-thread .msg-row");
  ok(rows.length === 3 && rows[2].textContent.includes("想问一下近况") && rows[2].classList.contains("mine"),
    "发送成功 → 新留言追加到线程末尾（家长侧）");
  ok(input.value === "" && $(w, "msg-count").textContent === "0 / 500", "发送后输入框清空、计数归零");
}
const w429 = makeWindow(baseData(), { postBehavior: () => ({ status: 429, body: { ok: false } }) });
await tick();
{
  tabBtn(w429, "mentor").click();
  const input = $(w429, "msg-input");
  input.value = "测试频繁";
  $(w429, "msg-form").dispatchEvent(new w429.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  ok(!$(w429, "msg-err").hidden && $(w429, "msg-err").textContent.includes("太频繁"), "429 → 频繁提示");
}
const w404 = makeWindow(baseData(), { postBehavior: () => ({ status: 404, body: { ok: false } }) });
await tick();
{
  tabBtn(w404, "mentor").click();
  const input = $(w404, "msg-input");
  input.value = "测试失效";
  $(w404, "msg-form").dispatchEvent(new w404.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  ok($(w404, "msg-err").textContent.includes("已失效"), "404 → 链接失效提示");
}

section("双语切换：界面文案全量英文化，数据正文不译");
{
  $(w, "lang-toggle").click();
  const labels = [...w.document.querySelectorAll(".tab-btn")].map((b) => b.textContent.replace(/[🏠📈🤲💬]/g, "").trim());
  ok(JSON.stringify(labels) === JSON.stringify(["Home", "Progress", "Support", "Mentor"]), "页签英文：" + labels.join("/"));
  tabBtn(w, "home").click(); // 首页按懒渲染契约在进入时以新语言重渲染
  ok($(w, "p-stage").textContent === "Assessment & Diagnosis", "阶段名按代码映射英文化");
  ok(w.document.title === "娃娃 Fixture Parent Updates", "英文标题");
  tabBtn(w, "support").click();
  ok(bodyText(w).includes("We don't go into grades or exam details here"), "托举原则英文版");
  ok(bodyText(w).includes("保留稳定的学习与休息时间"), "数据正文（托举事项）保持原文不译");
  tabBtn(w, "home").click();
  ok($(w, "latest-body").innerHTML.includes("Stage progress") && $(w, "latest-body").innerHTML.includes("Current solution strategy"), "首页小节标签英文化（Stage progress / Current solution strategy）");
  ok($(w, "latest-body").innerHTML.includes("核对学业记录与考试信息"), "数据正文（当前解决策略）保持原文");
  ok(w.localStorage.getItem("oop_parent_lang") === "en", "语言存家长端专属键");
  $(w, "lang-toggle").click();
  ok($(w, "p-stage").textContent === "评估诊断", "切回中文");
}

/* ================= 实例 B：全空数据 ================= */
const we = makeWindow(emptyData());
await tick();
section("空状态：四页优雅占位");
{
  ok($(we, "p-name").textContent === "空娃", "空数据时姓名仍渲染");
  ok($(we, "p-package").hidden === true, "无套餐 → 套餐徽标隐藏");
  ok($(we, "latest-body").textContent.includes("导师还没有发布进展更新"), "首页最新进展占位");
  ok($(we, "tab-dot").hidden === true && $(we, "home-unread").hidden === true, "无未读 → 无红点无入口");
  tabBtn(we, "progress").click();
  ok($(we, "updates-list").textContent.includes("还没有进展更新"), "进展时间线占位");
  tabBtn(we, "support").click();
  ok($(we, "support-list").textContent.includes("暂时没有需要家庭配合的事项"), "托举清单占位");
  ok(bodyText(we).includes("不在这里追问成绩与考试细节"), "空状态下原则文案仍在");
  tabBtn(we, "mentor").click();
  ok($(we, "msg-thread").textContent.includes("有问题可以在这里直接问导师"), "留言线程占位");
}

/* ================= 实例 C：404 链接失效 ================= */
const wg = makeWindow(baseData(), { getStatus: 404 });
await tick();
section("链接失效态");
{
  ok(!$(wg, "state").hidden && $(wg, "app").hidden, "404 → 状态区显示、APP 隐藏");
  ok($(wg, "state-text").textContent.includes("链接不对或已失效"), "失效文案");
}

/* ================= 静态扫描：代码边界与手机硬指标 ================= */
section("静态扫描：家长端代码边界");
{
  ok(!JS.includes("/api/client"), "parent.js 不引用学生端接口");
  ok(JS.includes("/api/parent/") && JS.includes("/api/parent/message"), "parent.js 只用家长接口");
  ok(!JS.includes("ooo_"), "parent.js 不使用学生端 localStorage 前缀");
  ok(JS.includes("oop_parent_lang") && JS.includes("oop_parent_key"), "家长端专属 localStorage 键齐全");
  ok(!HTML.includes("app.js"), "parent.html 不加载学生端脚本");
  ok(!HTML.includes("ck_"), "parent.html 不出现学生密钥形态（ck_）");
  ok(HTML.includes('placeholder="如 pk_…"') || HTML.includes("pk_"), "家长密钥输入提示为 pk_ 形态");
  ok((HTML.match(/data-tab=/g) || []).length === 4, "四页签按钮齐全");
}
section("静态扫描：390px / 触控 / 微信兼容沿用学生端基线");
{
  ok(CSS.includes(".pu-banner") && CSS.includes(".unread-banner"), "家长页新样式已追加");
  ok(/\.unread-banner\{[^}]*min-height:48px/.test(CSS.replace(/\s+/g, " ")), "未读入口触控高度 48px ≥ 44px");
  ok(CSS.includes("@media (max-width:480px)"), "窄屏断点存在（390px 走纵向堆叠）");
  ok(CSS.includes("overflow-x:clip"), "横向溢出钳制存在（无横滚）");
  ok(/\.tab-btn\{[^}]*min-height:58px/.test(CSS.replace(/\s+/g, " ")) || CSS.includes("min-height:58px"), "页签按钮高度 58px ≥ 44px");
  ok(CSS.includes("env(safe-area-inset-bottom)"), "iPhone 安全区适配存在");
}
section("DOM 渲染层数据边界：密钥与学生原始数据词汇不出现");
{
  for (const tab of ["home", "progress", "support", "mentor"]) tabBtn(w, tab).click();
  const text = bodyText(w);
  ok(!text.includes("pk_fixtoken"), "家长密钥值不渲染进页面");
  ok(!/GPA|client_key|signature|diary|journal|mood|emotion|考试原始|成绩明细|课程明细/i.test(text), "页面无学生原始数据与私密原文词汇");
}

console.log("\n==== app-parent: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
