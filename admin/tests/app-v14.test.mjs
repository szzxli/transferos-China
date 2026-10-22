// 一对一 v14 前端断言（jsdom）：导师简易沟通台。
// A. 收件箱渲染：待回复徽标、学生线/家长线分开条目、摘要与未读数
// B. 对话线：点条目打开、正序消息渲染、回复按 channel 分发、发送后本地追加
// C. 语音转文字：无 SpeechRecognition 时按钮禁用+文字提示、不崩页；
//    有 fake SpeechRecognition 时转写只填输入框（不自动发送）、可再发送
// D. v13 工作台三块与快速回复在新版页面照常工作（兼容）
// 运行：node tests/app-v14.test.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/home/hatch/workspace/tools/jsdomtest/node_modules/jsdom");

const MHTML = readFileSync(new URL("../../one-on-one-app/mentor.html", import.meta.url), "utf8");
const MENTOR = readFileSync(new URL("../../one-on-one-app/mentor.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function section(s) { console.log("\n== " + s); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));

const WB = {
  ok: true,
  mentor: { id: 3, name: "测试导师", emp_no: "EMP-T01", kind: "mentor", mentor_status: "verified", mentor_status_label: "已核验", notifiable: true },
  students: [{
    student: { id: 7, name: "测试学生", slug: "fix", stage: "plan", stage_label: "规划确认" },
    recent_events: [{ id: 9, event_type: "mentor_reply", event_label: "导师回复", summary: "导师回复留言", created_at: "2026-10-21T08:00:00.000Z" }],
    open_problems: [{ id: 11, title: "考试规则未确认", domain: "exam", domain_label: "考试", stuck_summary: "卡点摘要", support_needed: "需要模考资源", progress: "escalated", progress_label: "已升级", created_at: "2026-10-20T00:00:00.000Z" }],
    pending_actions: [{ id: 1, title: "待办一", detail: "", due_text: "本周五" }],
    trail_revisit_pending: 2,
    unread_messages: [{ id: 21, body: "导师，我想确认安排", created_at: "2026-10-21T07:00:00.000Z" }],
  }],
};
const INBOX = {
  ok: true,
  mentor: { id: 3, name: "测试导师", emp_no: "EMP-T01" },
  total_unread: 3, pending_threads: 2,
  threads: [
    { student_id: 7, student_name: "测试学生", slug: "fix", channel: "parent", channel_label: "家长留言",
      last: { id: 31, sender: "parent", body: "家长问：最近进度怎么样", created_at: "2026-10-22T09:00:00.000Z" }, unread: 2 },
    { student_id: 7, student_name: "测试学生", slug: "fix", channel: "student", channel_label: "学生留言",
      last: { id: 21, sender: "student", body: "导师，我想确认安排", created_at: "2026-10-21T07:00:00.000Z", category: "" }, unread: 1 },
  ],
};
const THREADS = {
  parent: {
    ok: true, student: { id: 7, name: "测试学生", slug: "fix" }, channel: "parent", unread_before: 2,
    messages: [
      { id: 30, sender: "parent", sender_label: "家长", body: "家长问：学费什么时候交", created_at: "2026-10-22T08:00:00.000Z" },
      { id: 31, sender: "parent", sender_label: "家长", body: "家长问：最近进度怎么样", created_at: "2026-10-22T09:00:00.000Z" },
    ],
  },
  student: {
    ok: true, student: { id: 7, name: "测试学生", slug: "fix" }, channel: "student", unread_before: 1,
    messages: [
      { id: 21, sender: "student", sender_label: "学生", body: "导师，我想确认安排", created_at: "2026-10-21T07:00:00.000Z", category: "" },
      { id: 22, sender: "mentor", sender_label: "导师", body: "周三晚细聊", created_at: "2026-10-21T08:00:00.000Z", category: "" },
    ],
  },
};

function makeWindow(withSpeech) {
  const dom = new JSDOM(MHTML, {
    url: "https://zhuanuc.com/one-on-one-app/mentor.html?s=EMP-T01&k=mk-fix&api=https://api.test",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const requests = [];
  w.fetch = async (url, o) => {
    const u = String(url);
    const method = (o && o.method) || "GET";
    requests.push({ url: u, method, body: o && o.body ? String(o.body) : "" });
    const j = (status, obj) => ({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(JSON.stringify(obj)) });
    if (u.includes("/api/mentor/reply")) {
      const b = JSON.parse(o.body);
      return j(200, { ok: true, ...(b.channel ? { channel: b.channel } : {}),
        message: { id: 99, sender: "mentor", body: b.body, created_at: "2026-10-22T10:00:00.000Z" } });
    }
    if (u.includes("/api/mentor/inbox/")) return j(200, INBOX);
    if (u.includes("/api/mentor/thread/")) {
      const ch = new URL(u).searchParams.get("channel") === "parent" ? "parent" : "student";
      return j(200, THREADS[ch]);
    }
    return j(200, WB);
  };
  if (withSpeech) {
    const instances = [];
    w.SpeechRecognition = class FakeSR {
      constructor() { this.lang = ""; this.interimResults = false; this.continuous = false; instances.push(this); }
      start() { this.started = true; }
      stop() { this.stopped = true; }
    };
    w.__srInstances = instances;
  }
  w.eval(MENTOR);
  return { w, requests };
}

/* ================= A + D：收件箱渲染 + 工作台兼容 ================= */
section("A. 收件箱：徽标 / 双线条目 / 摘要未读");
const MW = makeWindow(false);
{
  const w = MW.w;
  await tick(120);
  const $m = (id) => w.document.getElementById(id);
  ok($m("m-name").textContent === "测试导师", "导师名渲染（工作台兼容）");
  ok($m("students").textContent.includes("近期动态") && $m("students").textContent.includes("她的需求") &&
     $m("students").textContent.includes("待回复"), "v13 工作台三块照常渲染");
  const badge = $m("inbox-badge");
  ok(badge.hidden === false && badge.textContent === "3", "顶部待回复徽标 = 未读总数 3");
  const rows = w.document.querySelectorAll("#inbox-list [data-th-student]");
  ok(rows.length === 2, "收件箱两条线各一条目");
  ok(rows[0].textContent.includes("测试学生") && rows[0].textContent.includes("家长留言") &&
     rows[0].textContent.includes("家长问：最近进度怎么样") && rows[0].textContent.includes("2"),
    "家长线条目在前：学生名/来源标记/摘要/未读 2");
  ok(rows[1].textContent.includes("学生留言") && rows[1].textContent.includes("导师，我想确认安排"),
    "学生线条目：来源标记与摘要齐全");
  const ta = $m("wb-reply-0");
  ta.value = "工作台快速回复";
  w.document.querySelector("#students [data-reply]").click();
  await tick(80);
  const post = MW.requests.find((r) => r.url.includes("/api/mentor/reply"));
  ok(!!post && JSON.parse(post.body).student_id === 7 && !("channel" in JSON.parse(post.body)),
    "工作台快速回复仍走原口径（无 channel 字段）");
}

/* ================= B：对话线与 channel 分发 ================= */
section("B. 对话线：打开 / 渲染 / 按 channel 回复");
{
  const w = MW.w;
  const $m = (id) => w.document.getElementById(id);
  const parentRow = w.document.querySelectorAll("#inbox-list [data-th-student]")[0];
  parentRow.click();
  await tick(120);
  ok($m("thread-card").hidden === false, "点家长线条目打开对话区");
  ok($m("th-title").textContent.includes("测试学生") && $m("th-title").textContent.includes("家长留言"),
    "对话标题 = 学生名 + 家长留言");
  ok($m("th-msgs").textContent.includes("学费什么时候交") && $m("th-msgs").textContent.includes("最近进度怎么样"),
    "家长线历史消息正序渲染");
  ok(!$m("th-msgs").textContent.includes("我想确认安排"), "家长线不串学生留言");
  const threadReq = MW.requests.find((r) => r.url.includes("/api/mentor/thread/"));
  ok(!!threadReq && threadReq.url.includes("channel=parent") && threadReq.url.includes("student_id=7"),
    "对话线请求带 student_id + channel=parent");
  $m("th-input").value = "回复家长：进度不错";
  $m("th-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
  await tick(100);
  const posts = MW.requests.filter((r) => r.url.includes("/api/mentor/reply"));
  const last = JSON.parse(posts[posts.length - 1].body);
  ok(last.channel === "parent" && last.student_id === 7 && last.body === "回复家长：进度不错",
    "家长线回复载荷带 channel=parent");
  ok($m("th-msgs").textContent.includes("回复家长：进度不错") && $m("th-input").value === "",
    "发送后消息本地追加、输入框清空");
  $m("th-back").click();
  ok($m("thread-card").hidden === true, "返回按钮关闭对话区");

  const studentRow = w.document.querySelectorAll("#inbox-list [data-th-student]")[1];
  studentRow.click();
  await tick(120);
  ok($m("th-msgs").textContent.includes("我想确认安排") && $m("th-msgs").textContent.includes("周三晚细聊"),
    "学生线历史渲染（含导师旧回复）");
  $m("th-input").value = "回复学生：好的";
  $m("th-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
  await tick(100);
  const posts2 = MW.requests.filter((r) => r.url.includes("/api/mentor/reply"));
  ok(JSON.parse(posts2[posts2.length - 1].body).channel === "student", "学生线回复载荷带 channel=student");
}

/* ================= C：语音转文字 ================= */
section("C. 语音：不支持时禁用不崩 / 支持时只填框不直发");
{
  const w = MW.w;
  const $m = (id) => w.document.getElementById(id);
  ok($m("th-voice").disabled === true && $m("th-voice-unsupported").hidden === false,
    "jsdom 无语音识别 → 按钮禁用 + 文字提示（不崩页）");
  ok($m("th-voice-note").textContent.includes("厂商"), "语音厂商处理明示文案在位");

  const SW = makeWindow(true);
  const w2 = SW.w;
  const $s = (id) => w2.document.getElementById(id);
  await tick(120);
  w2.document.querySelectorAll("#inbox-list [data-th-student]")[1].click();
  await tick(120);
  ok($s("th-voice").disabled === false && $s("th-voice-unsupported").hidden === true,
    "有语音识别时按钮可用、无不支持提示");
  $s("th-voice").click();
  const sr = w2.__srInstances[w2.__srInstances.length - 1];
  ok(!!sr && sr.started === true && sr.lang === "zh-CN", "点语音按钮启动识别（zh-CN）");
  const fakeResults = [{ isFinal: true, 0: { transcript: "语音转写的内容" }, length: 1 }];
  fakeResults.resultIndex = 0;
  sr.onresult({ resultIndex: 0, results: fakeResults });
  ok($s("th-input").value.includes("语音转写的内容"), "转写结果填入输入框");
  ok(!SW.requests.some((r) => r.url.includes("/api/mentor/reply")), "转写不自动发送（零回复请求）");
  sr.onend && sr.onend();
  $s("th-form").dispatchEvent(new w2.Event("submit", { cancelable: true }));
  await tick(100);
  const sp = SW.requests.filter((r) => r.url.includes("/api/mentor/reply"));
  ok(sp.length === 1 && JSON.parse(sp[0].body).body === "语音转写的内容",
    "导师确认后手动发送转写内容");
}

console.log("\n==== app-v14: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
