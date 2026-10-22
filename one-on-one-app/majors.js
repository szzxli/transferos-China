/* majors.js — 一对一学生端 v13：专业数据集 + 本地课程匹配引擎 + 一键导出。
 * 匹配引擎与后台 worker 的 matchRequirements 逐行同口径移植（确定性规则）：
 * - 同代码多条课程取状态最优一条（done > ongoing/enrolled > planned）；
 * - 学分只统计 credits 非空的要求，未知单列 credits_unknown，绝不估算；
 * - 先修断裂 = 已选/在修课程的先修课既未修完也不在修；
 * - 成绩预警：below_min（低于要求标注的最低成绩）/ watch（先修或核心课低于 B）。
 * 隐私边界：本模块只读方案层数据（专业数据集 + 学生课程台账 + 姓名）；
 * 私密层（IndexedDB 日记等）永不被读取，导出内容天然不含私密层（测试有哨兵断言）。 */
(function () {
  "use strict";
  const GRADE_POINTS = { A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7, "C+": 2.3, C: 2, "C-": 1.7, "D+": 1.3, D: 1, F: 0 };
  const BLOCKS = ["gened", "prereq", "core", "elective"];

  function gradePoints(g) {
    const k = String(g || "").trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(GRADE_POINTS, k) ? GRADE_POINTS[k] : null;
  }
  function normCourseCode(c) {
    return String(c || "").toUpperCase().replace(/\s+/g, " ").trim();
  }
  function parsePrereqCodes(s) {
    if (Array.isArray(s)) return s.map(normCourseCode).filter(Boolean);
    return String(s || "").split(/[,，、;；]/).map((x) => normCourseCode(x)).filter(Boolean);
  }

  /* 与 worker.matchRequirements 同口径；requirements 条目的 prereq_codes 可为数组或字符串。 */
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
    for (const b of BLOCKS) {
      blocks[b] = { total: 0, done: 0, in_progress: 0, planned: 0, missing: 0, credits_total: 0, credits_done: 0, credits_missing: 0, credits_unknown: 0 };
    }
    const items = [], missing = [], gradeWarnings = [], prereqBreaks = [];
    for (const r of requirements || []) {
      const block = BLOCKS.includes(r.block) ? r.block : "prereq";
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
        code: r.course_code || "", name: r.course_name || "", block,
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

  /* —— 一键导出（Markdown）：只含方案层 = 所选专业 + 匹配结果 + 缺口 + 该专业课程清单。
   * 入参全部来自调用方显式传入，本函数不读任何存储（私密层结构性隔离）。—— */
  function buildExportMarkdown(opts) {
    const o = opts || {};
    const major = o.major || {};
    const match = o.match || null;
    const dataset = o.dataset || {};
    const meta = dataset._meta || {};
    const lines = [];
    lines.push("# 专业匹配导出 / Major Match Export");
    lines.push("");
    lines.push("- 学生 / Student: " + (o.studentName || ""));
    lines.push("- 学校 / School: " + (meta.school || ""));
    lines.push("- 专业 / Major: " + (major.name || ""));
    lines.push("- 导出日期 / Exported: " + (o.today || ""));
    lines.push("- 数据来源 / Sources: " + ((major.sources && major.sources.length)
      ? major.sources.join(" ; ")
      : ((meta.sources || []).map((s) => s.url).join(" ; ") || "—")));
    lines.push("- 数据抓取日期 / Retrieved: " + (meta.retrieved || ""));
    lines.push("");
    lines.push("> 以学校官方学位审计为准 / Subject to the official degree audit of the school.");
    lines.push("");
    if (major.note) { lines.push("专业说明：" + major.note); lines.push(""); }
    if (!major.verified || !match) {
      lines.push("该专业要求集待官方核实，暂无可计算的匹配结果。");
      lines.push("");
    } else {
      const tt = match.totals;
      lines.push("## 匹配总览");
      lines.push("");
      lines.push("- 要求总数：" + tt.requirements + "（已修 " + tt.done + " / 在修 " + tt.in_progress + " / 计划 " + tt.planned + " / 缺 " + tt.missing + "）");
      lines.push("- 已知学分：已修 " + tt.credits_done + " / 要求 " + tt.credits_total + "（缺口 " + tt.credits_missing + "；学分未标注 " + tt.credits_unknown + " 条单列，不估算）");
      lines.push("");
      lines.push("## 缺口清单（未修要求）");
      lines.push("");
      if (match.missing.length) {
        for (const m of match.missing) {
          lines.push("- " + m.code + (m.name ? " " + m.name : "") +
            "（" + m.block + (m.credits !== null && m.credits !== undefined ? "，" + m.credits + " 学分" : "，学分未标注") +
            (m.min_grade ? "，最低成绩 " + m.min_grade : "") +
            (m.prereq_codes && m.prereq_codes.length ? "，先修：" + m.prereq_codes.join(", ") : "") + "）");
        }
      } else lines.push("- 无缺口（已建模要求全部覆盖）。");
      lines.push("");
      if (match.grade_warnings.length) {
        lines.push("## 成绩预警");
        lines.push("");
        for (const w of match.grade_warnings) {
          lines.push("- " + w.code + "：" + (w.kind === "below_min"
            ? "已修成绩 " + w.grade + " 低于要求最低成绩 " + w.min_grade
            : "先修/核心课成绩 " + w.grade + " 低于 B，建议关注"));
        }
        lines.push("");
      }
      if (match.prereq_breaks.length) {
        lines.push("## 先修断裂");
        lines.push("");
        for (const b of match.prereq_breaks) lines.push("- " + b.code + " 的先修 " + b.missing_prereq + " 尚未修/未在修");
        lines.push("");
      }
    }
    lines.push("## 该专业课程库清单");
    lines.push("");
    const lib = (dataset.courses || []).filter((c) => (c.majors || []).includes(major.id));
    if (lib.length) {
      for (const c of lib) {
        lines.push("- " + c.course_code + (c.course_name ? " " + c.course_name : "") +
          "（" + (c.credits !== null && c.credits !== undefined ? c.credits + " 学分" : "学分未标注") +
          (c.min_grade ? "，最低成绩 " + c.min_grade : "") +
          (c.prereq_codes && c.prereq_codes.length ? "，先修：" + c.prereq_codes.join(", ") : "") + "）");
      }
    } else lines.push("- （要求集待核实，暂无课程清单）");
    lines.push("");
    return lines.join("\n");
  }

  let datasetCache = null, datasetPromise = null;
  function loadDataset() {
    if (datasetCache) return Promise.resolve(datasetCache);
    if (!datasetPromise) {
      datasetPromise = fetch("data/csi-majors.json", { headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { datasetCache = j; return j; })
        .catch(() => null);
    }
    return datasetPromise;
  }

  window.OOOMajors = { matchRequirements, buildExportMarkdown, loadDataset, gradePoints, normCourseCode, parsePrereqCodes };
})();
