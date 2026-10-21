"use strict";
/* 一对一专属客户端（学生端，只读）
 * 数据来自管理后台只读接口 GET /api/client/<学生id 或 slug>?key=<访问密钥>。
 * 入口：专属链接 ?s=<学生id 或专属名 slug>&k=<密钥>（可加 &api=<接口域名> 覆盖默认接口）；
 * 无参数时显示门页，输入一次后存 localStorage。页面无任何编辑功能。 */
const DEFAULT_API_BASE = "https://transferos-admin.szzxli711.workers.dev";
const LS_S = "ooo_student_id", LS_K = "ooo_client_key", LS_A = "ooo_api_base";
const KIND_LABELS = { prereq: "必修先修", gened: "通识", elective: "选修" };

const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function pct(done, total) {
  const d = Number(done) || 0, t = Number(total) || 0;
  return t > 0 ? Math.min(100, Math.round((d / t) * 100)) : 0;
}
function bar(done, total) {
  return '<div class="pbar"><i style="width:' + pct(done, total) + '%"></i></div>';
}
function creds() {
  const q = new URLSearchParams(location.search);
  const s = q.get("s") || localStorage.getItem(LS_S) || "";
  const k = q.get("k") || localStorage.getItem(LS_K) || "";
  const api = (q.get("api") || localStorage.getItem(LS_A) || DEFAULT_API_BASE).replace(/\/+$/, "");
  if (q.get("s") && q.get("k")) {
    localStorage.setItem(LS_S, s); localStorage.setItem(LS_K, k); localStorage.setItem(LS_A, api);
  }
  return { s: String(s).trim(), k: String(k).trim(), api };
}

function showState(text, retry) {
  $("gate").hidden = true; $("app").hidden = true;
  $("state").hidden = false;
  $("state-text").textContent = text;
  const btn = $("state-retry");
  btn.hidden = !retry;
  if (retry) { btn.textContent = "重试"; btn.onclick = () => load(); }
}
function showGate(errText) {
  $("state").hidden = true; $("app").hidden = true;
  $("gate").hidden = false;
  const e = $("gate-err");
  if (errText) { e.textContent = errText; e.hidden = false; } else { e.hidden = true; }
}

async function load() {
  const { s, k, api } = creds();
  if (!s || !k) { showGate(); return; }
  showState("正在加载…", false);
  let resp;
  try {
    resp = await fetch(api + "/api/client/" + encodeURIComponent(s) + "?key=" + encodeURIComponent(k),
      { headers: { "Accept": "application/json" } });
  } catch (e) {
    showState("网络不通，没能连上服务器。请检查网络后重试。", true);
    return;
  }
  if (resp.status === 404) {
    showState("没找到这份客户端：专属名 / 编号或访问密钥不正确，或链接已更新。请核对导师发的最新链接。", false);
    $("state-retry").hidden = false;
    $("state-retry").textContent = "重新输入编号与密钥";
    $("state-retry").onclick = () => {
      localStorage.removeItem(LS_S); localStorage.removeItem(LS_K);
      showGate("请输入导师发给你的专属名（或编号）与访问密钥。");
    };
    return;
  }
  if (!resp.ok) { showState("服务器暂时忙（" + resp.status + "），请稍后重试。", true); return; }
  let data;
  try { data = await resp.json(); } catch (e) { showState("数据格式异常，请稍后重试。", true); return; }
  if (!data || data.ok !== true) { showState("数据异常，请稍后重试。", true); return; }
  render(data);
}

function setMeta(name, content) {
  let el = document.head.querySelector('meta[name="' + name + '"]');
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}
/* 数据加载后按学生姓名个性化：页面标题、「添加到主屏幕」默认名、主线卡上方专属语。
 * 姓名一律取接口返回值，模板内不写任何具体人名。 */
function personalize(name) {
  const title = name ? name + " 的专属APP" : "我的专属APP";
  document.title = title;
  setMeta("apple-mobile-web-app-title", title);
  setMeta("application-name", title);
  setMeta("theme-color", "#16453a");
  $("stu-exclusive").textContent = name
    ? "本应用为 " + name + " 专属开发 · 一对一规划服务"
    : "本应用为你专属开发 · 一对一规划服务";
}

/* —— 每日一句（v9）——
 * 语录库：40 条，中文为主 + 英文小字；短句取公有领域经典与原创改写，不整段引用受版权文本。
 * 标签六组：action 行动 / study 学业坚持 / courage 勇气 / discipline 自律 / dream 梦想 / setback 挫折。
 * 选题确定性：种子 = 学生定位符 + 本地日期，同日不变、跨日轮换；主题池由学生数据决定，
 * 权重向第一优先级人生线的主题（action）倾斜。引擎为纯函数，可独立自测。 */
const QUOTES = [
  // action 行动（7）
  { tags: ["action"], zh: "千里之行，始于足下。", en: "A journey of a thousand miles begins with a single step." },
  { tags: ["action"], zh: "想到和得到之间，还有一个词：做到。", en: "Between thinking and getting lies one more word: doing." },
  { tags: ["action", "discipline"], zh: "先完成，再完美。", en: "Done first, perfect later." },
  { tags: ["action", "dream"], zh: "种一棵树最好的时间是十年前，其次是现在。", en: "The best time to plant a tree was ten years ago; the second best time is now." },
  { tags: ["action"], zh: "不怕慢，只怕站。", en: "Fear not slowness; fear standing still." },
  { tags: ["action", "courage"], zh: "机会，留给已经在路上的人。", en: "Opportunity favors those already on the road." },
  { tags: ["action", "discipline"], zh: "把大事拆小，把今天过完。", en: "Break the big thing into small pieces, and finish today." },
  // study 学业坚持（7）
  { tags: ["study"], zh: "学而不思则罔，思而不学则殆。", en: "Learning without thought is labor lost; thought without learning is perilous." },
  { tags: ["study", "discipline"], zh: "日拱一卒，功不唐捐。", en: "A pawn advances a little each day; no effort is ever wasted." },
  { tags: ["study"], zh: "书山有路勤为径。", en: "Diligence is the path up the mountain of books." },
  { tags: ["study"], zh: "今天多读一页，明天少求一人。", en: "One more page today, one less favor to ask tomorrow." },
  { tags: ["study", "discipline"], zh: "重复，是学会的捷径。", en: "Repetition is the shortcut to mastery." },
  { tags: ["study"], zh: "不积跬步，无以至千里。", en: "Without accumulating small steps, one cannot reach a thousand miles." },
  { tags: ["study", "setback"], zh: "把不会的变成会的，就是学习。", en: "Turning what you can't do into what you can — that is learning." },
  // courage 勇气（6）
  { tags: ["courage"], zh: "勇气不是不害怕，是害怕也往前走。", en: "Courage is not the absence of fear; it is moving forward while afraid." },
  { tags: ["courage", "setback"], zh: "狭路相逢勇者胜。", en: "On a narrow road, the brave prevail." },
  { tags: ["courage", "action"], zh: "先迈出第一步，路会自己出现。", en: "Take the first step, and the road will appear." },
  { tags: ["courage"], zh: "怕输的人，已经输了一半。", en: "Whoever fears losing has already half lost." },
  { tags: ["courage", "setback"], zh: "迎难而上，难就会让路。", en: "Face the difficulty, and it will make way." },
  { tags: ["courage"], zh: "不需要等状态好了再开始。", en: "You don't have to feel ready to begin." },
  // discipline 自律（6）
  { tags: ["discipline"], zh: "自律即自由。", en: "Discipline is freedom." },
  { tags: ["discipline"], zh: "每天进步一点点，一年就是一大步。", en: "A little progress each day adds up to a leap in a year." },
  { tags: ["discipline"], zh: "管理好今天，时间就站在你这边。", en: "Manage today well, and time is on your side." },
  { tags: ["discipline"], zh: "说到做到，是最小单位的信用。", en: "Keeping your word is the smallest unit of trust." },
  { tags: ["discipline"], zh: "好习惯是复利，坏习惯也是。", en: "Habits compound — the good ones and the bad ones alike." },
  { tags: ["discipline", "study"], zh: "把手机放远，把目标放近。", en: "Keep the phone far away and the goal close." },
  // dream 梦想（6）
  { tags: ["dream"], zh: "有梦就去追，醒来就去做。", en: "Chase the dream, and when you wake, go do it." },
  { tags: ["dream"], zh: "星光不问赶路人。", en: "The starlight asks nothing of those traveling the road." },
  { tags: ["dream"], zh: "你想成为的样子，就是努力的方向。", en: "Who you want to become points to where you should strive." },
  { tags: ["dream", "discipline"], zh: "愿你走得慢，但从不停。", en: "May you walk slowly, but never stop." },
  { tags: ["dream", "courage"], zh: "心里有光，脚下就有路。", en: "With light in your heart, a road appears beneath your feet." },
  { tags: ["dream"], zh: "梦想不会逃走，逃走的总是自己。", en: "Dreams don't run away; people do." },
  // setback 挫折（8）
  { tags: ["setback"], zh: "吃一堑，长一智。", en: "Fall into a pit, and gain in wit." },
  { tags: ["setback"], zh: "失败不是终点，放弃才是。", en: "Failure is not the end; giving up is." },
  { tags: ["setback", "study"], zh: "这次没过，下次更近。", en: "Not this time — closer next time." },
  { tags: ["setback", "dream"], zh: "山重水复疑无路，柳暗花明又一村。", en: "Where hills double and streams wind, a village of willows and blossoms appears." },
  { tags: ["setback"], zh: "把挫折当学费，把经验当文凭。", en: "Treat setbacks as tuition, and experience as the diploma." },
  { tags: ["setback", "courage"], zh: "摔倒了，就顺势看看地上的地图。", en: "When you fall, take a good look at the map on the ground." },
  { tags: ["setback"], zh: "暂时没赢，不等于会输。", en: "Not winning yet is not the same as losing." },
  { tags: ["setback", "study"], zh: "错题本越厚，底气越足。", en: "The thicker the mistake notebook, the stronger the foundation." },
];
const QUOTE_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
function localDateStr(dt) {
  const d = dt || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function hashSeed(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/* 主题池：通用三组打底；有主线在推进 → action；有学业目标 → study；
 * 有考试未达标记录 → setback + study。第一优先级人生线在场时主主题为 action。 */
function quoteThemes(d) {
  const themes = ["dream", "courage", "discipline"];
  if (d && d.main_line) themes.push("action");
  if (d && d.goal) themes.push("study");
  if (d && (d.exams || []).some((e) => e && e.result === "fail")) themes.push("setback", "study");
  return [...new Set(themes)];
}
function quotePrimaryTheme(d) { return d && d.main_line ? "action" : ""; }
/* 纯函数选题：pool 为与主题池相交的条目，主主题条目双倍权重（入池两次）；
 * 下标 = hash(种子) % pool 长度。全程无随机源，给定 (quotes, themes, primary, seed) 结果恒定。 */
function pickDailyQuote(quotes, themes, primary, seedStr) {
  const pool = [];
  for (const q of quotes || []) {
    if (!q.tags.some((t) => themes.includes(t))) continue;
    pool.push(q);
    if (primary && q.tags.includes(primary)) pool.push(q);
  }
  const list = pool.length ? pool : (quotes || []);
  if (!list.length) return null;
  return list[hashSeed(seedStr) % list.length];
}
function renderDaily(d) {
  const now = new Date();
  $("daily-date").textContent = now.getFullYear() + "年" + (now.getMonth() + 1) + "月" + now.getDate() +
    "日 · 星期" + QUOTE_WEEKDAYS[now.getDay()];
  const { s } = creds();
  const q = pickDailyQuote(QUOTES, quoteThemes(d), quotePrimaryTheme(d), String(d.student.id || s) + "|" + localDateStr(now));
  $("daily-quote").textContent = q ? q.zh : "";
  $("daily-quote-en").textContent = q ? q.en : "";
  renderSignature(d);
}
function renderSignature(d) {
  const box = $("daily-sign");
  if (d.signature) {
    box.innerHTML = '<div class="sign-line">—— ' + esc(d.signature) + "</div>";
    return;
  }
  const sugg = Array.isArray(d.signature_suggestions) ? d.signature_suggestions : [];
  if (!sugg.length) { box.innerHTML = ""; return; }
  box.innerHTML =
    '<div class="sign-pick"><p class="mut" style="margin:0">选一句做你的专属签名——签下后将固定在你的 APP 里，每天陪你打开它。</p>' +
    '<div class="sign-opts">' + sugg.map((sug, i) =>
      '<button type="button" class="sign-opt" data-i="' + i + '">' + esc(sug) + "</button>").join("") + "</div>" +
    '<button type="button" class="btn-sign" id="sign-confirm" disabled>就它了，固定下来</button>' +
    '<p id="sign-err" class="err" hidden></p></div>';
  let picked = -1;
  box.querySelectorAll(".sign-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      picked = Number(btn.getAttribute("data-i"));
      box.querySelectorAll(".sign-opt").forEach((b) => b.classList.toggle("sel", b === btn));
      $("sign-confirm").disabled = false;
    });
  });
  $("sign-confirm").addEventListener("click", async () => {
    if (picked < 0) return;
    const btn = $("sign-confirm");
    btn.disabled = true; btn.textContent = "正在固定…";
    const { s, k, api } = creds();
    try {
      const resp = await fetch(api + "/api/client/signature", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ s, key: k, signature: sugg[picked] }),
      });
      if (resp.status === 409) { load(); return; } // 已被设置（可能导师刚改）→ 刷新为固定态
      if (!resp.ok) throw new Error("bad status");
      const j = await resp.json();
      if (!j || j.ok !== true) throw new Error("bad body");
      d.signature = j.signature;
      renderSignature(d);
    } catch (e) {
      btn.disabled = false; btn.textContent = "就它了，固定下来";
      const err = $("sign-err");
      err.textContent = "没签上，网络或服务器有点问题，请再试一次。";
      err.hidden = false;
    }
  });
}

function render(d) {
  $("state").hidden = true; $("gate").hidden = true; $("app").hidden = false;
  // —— 顶部 ——
  $("stu-name").textContent = d.student.name || "我的客户端";
  personalize(d.student.name || "");
  renderDaily(d);
  const sys = $("stu-system");
  if (d.school_system) { sys.textContent = d.school_system; sys.hidden = false; } else { sys.hidden = true; }
  const meta = [];
  if (d.student.stage_label) meta.push("当前阶段：" + d.student.stage_label);
  if (d.student.package) meta.push(d.student.package);
  $("stu-meta").textContent = meta.join(" · ");
  const ml = $("main-line");
  if (d.main_line) {
    ml.hidden = false;
    $("main-line-name").textContent =
      d.main_line.name + (d.main_line.status_label ? "（" + d.main_line.status_label + "）" : "");
    $("main-line-next").textContent = d.main_line.next_step ? "下一步：" + d.main_line.next_step : "";
  } else { ml.hidden = true; }

  // —— 目标 ——
  const lines = d.goal_lines || [];
  $("goal-lines").innerHTML = lines.length ? lines.map((l) =>
    '<div class="line-item"><div class="line-prio">' + esc(l.priority) + '</div>' +
    '<div class="line-body"><div class="line-top">' +
    '<span class="line-name">' + esc(l.name) + '</span>' +
    '<span class="pill type-' + esc(l.line_type) + '">' + esc(l.line_type_label || "") + '</span>' +
    (l.status_label ? '<span class="line-status">' + esc(l.status_label) + '</span>' : "") +
    '</div>' +
    (l.next_step ? '<div class="line-next">下一步：' + esc(l.next_step) + '</div>' : "") +
    '</div></div>').join("")
    : '<p class="empty">目标线尚未记录，请联系导师确认。</p>';
  const g = d.goal;
  $("goal-detail").innerHTML = g ? (() => {
    const facts = [];
    if (g.target_school) facts.push('<span class="fact">目标学校 / 项目<b>' + esc(g.target_school) + '</b></span>');
    if (g.target_term) facts.push('<span class="fact">目标入学季<b>' + esc(g.target_term) + '</b></span>');
    if (g.gpa_target) facts.push('<span class="fact">目标 GPA<b>' + esc(g.gpa_target) + '</b></span>');
    return (facts.length ? '<div class="goal-facts">' + facts.join("") + '</div>' : "") +
      (g.goal_note ? '<div class="goal-note">' + esc(g.goal_note) + '</div>' : "");
  })() : "";

  // —— 状态 ——
  const st = d.status || {};
  const latest = st.latest;
  $("status-latest").innerHTML = latest ? (() => {
    const cd = latest.credits_done, ct = latest.credits_total;
    return '<div class="stat-big">' +
      '<div class="cell"><div class="v">' + (latest.gpa === null || latest.gpa === undefined ? "—" : esc(latest.gpa)) + '</div><div class="l">最新 GPA' + (latest.snapshot_date ? "（" + esc(latest.snapshot_date) + "）" : "") + '</div></div>' +
      '<div class="cell"><div class="v">' + (cd === null || cd === undefined ? "—" : esc(cd)) + (ct ? ' <span style="font-size:16px;color:var(--mut)">/ ' + esc(ct) + '</span>' : "") + '</div><div class="l">已修学分 / 总要求</div></div>' +
      '</div>' +
      ((cd !== null && cd !== undefined && ct) ? bar(cd, ct) : "") +
      (latest.note ? '<p style="margin:6px 0 0;white-space:pre-wrap">' + esc(latest.note) + '</p>' : "");
  })() : '<p class="empty">暂无状态快照。</p>';
  const hist = (st.history || []).slice(1);
  $("status-history").innerHTML = hist.length ?
    '<h3 style="font-size:14px;margin:14px 0 2px;color:var(--mut)">历史快照</h3>' + hist.map((s) =>
      '<div class="snap"><span class="d">' + esc(s.snapshot_date || "") + '</span>' +
      '<span>GPA ' + (s.gpa === null || s.gpa === undefined ? "—" : esc(s.gpa)) + ' · 学分 ' +
      (s.credits_done === null || s.credits_done === undefined ? "—" : esc(s.credits_done)) + ' / ' +
      (s.credits_total === null || s.credits_total === undefined ? "—" : esc(s.credits_total)) +
      (s.note ? '<span class="note">' + esc(s.note) + '</span>' : "") + '</span></div>').join("")
    : "";

  // —— 考试 ——
  const exams = d.exams || [];
  $("exams").innerHTML = exams.length ? exams.map((e) => {
    const sub = [];
    if (e.exam_date) sub.push(e.exam_date);
    if (e.score) sub.push("分数 " + e.score);
    if (e.pass_line) sub.push("达标线 " + e.pass_line);
    return '<div class="exam"><div class="exam-main">' +
      '<div class="exam-name">' + esc(e.exam_name) + '</div>' +
      (sub.length ? '<div class="exam-sub">' + esc(sub.join(" · ")) + '</div>' : "") +
      (e.note ? '<div class="exam-note">' + esc(e.note) + '</div>' : "") +
      '</div><span class="badge ' + esc(e.result || "pending") + '">' + esc(e.result_label || "") + '</span></div>';
  }).join("") : '<p class="empty">暂无考试记录。</p>';

  // —— 选课 ——
  const c = d.courses || { progress: {}, groups: [], list: [] };
  const p = c.progress || {};
  const byId = new Map((c.list || []).map((x) => [x.id, x]));
  const kindRows = Object.keys(KIND_LABELS).map((k) => {
    const kk = (p.byKind || {})[k];
    if (!kk || !kk.total) return "";
    return '<div class="row"><div class="l"><span>' + KIND_LABELS[k] + '</span><span>已完成 ' +
      kk.done + '/' + kk.total + ' 门 · 学分 ' + kk.creditsDone + '/' + kk.credits + '</span></div>' +
      bar(kk.done, kk.total) + '</div>';
  }).join("");
  $("course-progress").innerHTML =
    '<p style="margin:0">已完成学分 <b>' + esc(p.creditsDone || 0) + '</b> / 规划总学分 ' + esc(p.creditsTotal || 0) +
    ' · 先修课已完成 <b>' + esc(p.prereqDone || 0) + '/' + esc(p.prereqTotal || 0) + '</b> 门</p>' +
    (kindRows ? '<div class="kind-bars">' + kindRows + '</div>' : "");
  $("course-groups").innerHTML = (c.groups || []).length ? (c.groups || []).map((gr) => {
    const items = gr.courses.map((raw) => byId.get(raw.id) || raw);
    const sumCr = items.reduce((a, x) => a + (Number(x.credits) || 0), 0);
    return '<div class="term-title">' + esc(gr.term) + '<span class="mut">' + items.length + ' 门 · ' + sumCr + ' 学分</span></div>' +
      items.map((x) =>
        '<div class="course"><span class="code">' + esc(x.course_code || "") + '</span>' +
        '<span class="name">' + esc(x.course_name || "") +
        (x.note ? '<span class="mut">（' + esc(x.note) + '）</span>' : "") + '</span>' +
        '<span class="cr">' + (x.credits === null || x.credits === undefined ? "" : esc(x.credits) + ' 学分') + '</span>' +
        (x.grade ? '<span class="grade">' + esc(x.grade) + '</span>' : "") +
        '<span class="st st-' + esc(x.status || "planned") + '">' + esc(x.status_label || "") + '</span></div>'
      ).join("");
  }).join("") : '<p class="empty">暂无选课记录。</p>';

  // —— 会议 ——
  const ms = d.meetings || [];
  $("meetings").innerHTML = ms.length ? ms.map((m) => {
    const todos = String(m.action_items || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    return '<div class="meeting"><div class="meeting-top">' +
      '<span class="meeting-date">' + esc(m.meeting_date || "") + '</span>' +
      '<span class="meeting-topic">' + esc(m.topic || "") + '</span></div>' +
      (m.summary ? '<div class="meeting-summary">' + esc(m.summary) + '</div>' : "") +
      (todos.length ? '<ul class="todo-list">' + todos.map((t) => '<li>' + esc(t) + '</li>').join("") + '</ul>' : "") +
      (m.next_date ? '<div class="meeting-next">下次会议：' + esc(m.next_date) + '</div>' : "") +
      '</div>';
  }).join("") : '<p class="empty">暂无会议记录。</p>';
}

$("gate-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const s = $("gate-s").value.trim(), k = $("gate-k").value.trim();
  if (!s || !k) { showGate("编号与密钥都要填。"); return; }
  localStorage.setItem(LS_S, s); localStorage.setItem(LS_K, k);
  if (!localStorage.getItem(LS_A)) localStorage.setItem(LS_A, DEFAULT_API_BASE);
  load();
});
$("forget").addEventListener("click", (ev) => {
  ev.preventDefault();
  localStorage.removeItem(LS_S); localStorage.removeItem(LS_K);
  history.replaceState(null, "", location.pathname);
  showGate();
});
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
else load();
