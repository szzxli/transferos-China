"use strict";
/* 一对一专属客户端（学生端，只读）
 * 数据来自管理后台只读接口 GET /api/client/<学生id>?key=<访问密钥>。
 * 入口：专属链接 ?s=<学生id>&k=<密钥>（可加 &api=<接口域名> 覆盖默认接口）；
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
    showState("没找到这份客户端：学生编号或访问密钥不正确，或链接已更新。请核对导师发的最新链接。", false);
    $("state-retry").hidden = false;
    $("state-retry").textContent = "重新输入编号与密钥";
    $("state-retry").onclick = () => {
      localStorage.removeItem(LS_S); localStorage.removeItem(LS_K);
      showGate("请输入导师发给你的学生编号与访问密钥。");
    };
    return;
  }
  if (!resp.ok) { showState("服务器暂时忙（" + resp.status + "），请稍后重试。", true); return; }
  let data;
  try { data = await resp.json(); } catch (e) { showState("数据格式异常，请稍后重试。", true); return; }
  if (!data || data.ok !== true) { showState("数据异常，请稍后重试。", true); return; }
  render(data);
}

function render(d) {
  $("state").hidden = true; $("gate").hidden = true; $("app").hidden = false;
  // —— 顶部 ——
  $("stu-name").textContent = d.student.name || "我的客户端";
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
