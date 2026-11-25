/* 规划页 TAG 成绩线。数字只来自：
 * - UC 2027-28 TAG 矩阵（Accurate as of June 9, 2026）
 *   https://admission.universityofcalifornia.edu/_assets/files/transfer-requirements/updated_202728-tag-matrix_ada.pdf
 * - UCI Guaranteed Admissions
 *   https://admissions.uci.edu/apply/transfer-students/guaranteed-admissions.php
 * - UC TAG by campus（6 所）
 *   https://admission.universityofcalifornia.edu/admission-requirements/transfer-requirements/uc-transfer-programs/transfer-admission-guarantee-tag.html
 * “Donald Bren 学院全部专业”对照到具体专业名时，用的是 UCI 2026-27 课程目录里的学院路径，
 * 目录不提供 GPA。专业课 GPA 只提示，不计算。
 */
"use strict";
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.formatTag = api.formatTag;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function normMajor(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\//g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function coreMajor(s) {
    return normMajor(s)
      .replace(/\b(b s|b a|a b|b mus|b m|b f a|minor)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function hasPhrase(n, phrase) {
    return (" " + n + " ").indexOf(" " + phrase + " ") >= 0;
  }
  function isEngineering(core) {
    return core.indexOf("engineering") >= 0;
  }
  function campusKey(uc) {
    var s = String(uc || "").toLowerCase().replace(/\./g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return "";
    if (s.indexOf("berkeley") >= 0 || s === "ucb") return "berkeley";
    if (s.indexOf("los angeles") >= 0 || s === "ucla") return "ucla";
    if (s.indexOf("san diego") >= 0 || s === "ucsd") return "ucsd";
    if (s.indexOf("davis") >= 0) return "davis";
    if (s.indexOf("irvine") >= 0 || s === "uci") return "uci";
    if (s.indexOf("santa cruz") >= 0 || s === "ucsc") return "ucsc";
    if (s.indexOf("merced") >= 0) return "merced";
    if (s.indexOf("riverside") >= 0 || s === "ucr") return "riverside";
    if (s.indexOf("santa barbara") >= 0 || s === "ucsb") return "ucsb";
    return "other";
  }
  function cents(n) { return Math.round(Number(n) * 100); }
  function cycleWhen(pace, when) {
    if (pace === "1yr") return "按 1 年规划，对照 2027 秋周期（" + when + "）。";
    if (pace === "2yr") return "按 2 年规划。截止时间写的是 2027 秋周期（" + when + "）；2028 秋的截止时间不在这份矩阵里，以届时官网为准。";
    return "还没分 1 年 / 2 年。截止时间写的是 2027 秋周期（" + when + "）。";
  }
  function lineRule(gpa, value, detail, summary) {
    return { mode: "line", gpa: gpa, label: "TAG（保录计划）成绩线", value: value, detail: detail, summary: summary };
  }
  function closedRule(value, detail, summary) {
    return { mode: "closed", gpa: null, label: "TAG（保录计划）", value: value, detail: detail, summary: summary };
  }

  var ICS = {
    "computer science": 1,
    "data science": 1,
    "informatics": 1,
    "software engineering": 1,
    "game design and interactive media": 1,
    "information and computer science": 1,
    "business information management": 1
  };

  function uciKind(major) {
    var core = coreMajor(major);
    if (!core) return { kind: "unknown" };
    if (hasPhrase(core, "computer") && hasPhrase(core, "science") && hasPhrase(core, "engineering")) {
      return { kind: "cse", name: "Computer Science and Engineering" };
    }
    if (ICS[core] || (hasPhrase(core, "computer science") && !hasPhrase(core, "engineering")) || hasPhrase(core, "data science") || hasPhrase(core, "software engineering") || hasPhrase(core, "game design")) {
      return { kind: "ics" };
    }
    if (hasPhrase(core, "music")) {
      var raw = normMajor(major);
      if (hasPhrase(raw, "b mus") || hasPhrase(raw, "b m")) return { kind: "y2027" };
      return { kind: "music-unclear", name: "Music" };
    }
    if (core === "art" || (hasPhrase(core, "business") && hasPhrase(core, "administration")) || hasPhrase(core, "dance") || hasPhrase(core, "nursing")) {
      return { kind: "y2027" };
    }
    if (core === "biological sciences" || (hasPhrase(core, "biology") && hasPhrase(core, "education")) || (hasPhrase(core, "ecology") && hasPhrase(core, "evolutionary"))) {
      return { kind: "y2028", name: core };
    }
    if (core === "aerospace engineering" || core === "computer engineering" || core === "electrical engineering" || core === "mechanical engineering" ||
        hasPhrase(core, "aerospace engineering") || (hasPhrase(core, "computer engineering") && !hasPhrase(core, "science")) ||
        hasPhrase(core, "electrical engineering") || hasPhrase(core, "mechanical engineering")) {
      return { kind: "y2028", name: core };
    }
    if (hasPhrase(core, "psychology") || hasPhrase(core, "cognitive") ||
        (hasPhrase(core, "business") && hasPhrase(core, "economics")) ||
        (hasPhrase(core, "quantitative") && hasPhrase(core, "economics")) ||
        hasPhrase(core, "economics")) {
      return { kind: "y2028", name: core };
    }
    return { kind: "open", name: core };
  }

  function uciYears(pace) {
    if (pace === "1yr") return ["2027"];
    if (pace === "2yr") return ["2028"];
    return ["2027", "2028"];
  }
  function uciBlocked(kind, year) {
    if (kind.kind === "ics" || kind.kind === "y2027") return true;
    if (kind.kind === "y2028" && year === "2028") return true;
    return false;
  }

  function davis(major, pace) {
    var core = coreMajor(major);
    var when = cycleWhen(pace, "须在 2026 年夏季结束前达到");
    if (!core) {
      return closedRule(
        "工学院 3.5 / 其他学院 3.2",
        when + "矩阵：农业与环境科学、生物科学、文理学院 3.2，工学院 3.5。还没选定专业，这里不单算一条差距。Undeclared、Business、Computer Science、Data Science 不在范围内；Landscape Architecture 只写到 pre-major。",
        "UC Davis 的 TAG（保录计划）分学院：工学院 3.5，其他学院 3.2。还没选定专业，这里不单算差距。"
      );
    }
    if (hasPhrase(core, "landscape architecture")) {
      return closedRule(
        "只写到 pre-major",
        "矩阵写 Landscape Architecture 的申请人进入 pre-major，没有写进该专业。这里不显示差距，也不标记是否达到成绩线。",
        "Landscape Architecture 在 UC Davis 的矩阵里只写到 pre-major，这里不对照成绩线。"
      );
    }
    if (hasPhrase(core, "undeclared") || hasPhrase(core, "data science") ||
        (hasPhrase(core, "computer science") && !isEngineering(core)) ||
        (hasPhrase(core, "business") && !hasPhrase(core, "economics"))) {
      return closedRule(
        "这个专业不在范围内",
        "矩阵排除 Undeclared、Business、Computer Science、Data Science。这里不显示差距，也不标记是否达到成绩线。",
        "这个专业不在 UC Davis 的 TAG（保录计划）范围内（矩阵排除 Undeclared、Business、Computer Science、Data Science）。这里不对照成绩线。"
      );
    }
    if (isEngineering(core)) {
      return lineRule(3.5, "3.5（工学院）",
        when + "当前专业按工学院 3.5 对照。农业与环境科学、生物科学、文理学院是 3.2。部分选择性专业另有专业课 GPA，这里不计算。",
        "对照的是 UC Davis 工学院 TAG（保录计划）成绩线 3.5。");
    }
    return lineRule(3.2, "3.2（其他学院）",
      when + "当前专业不在工学院名单上，按农业与环境科学、生物科学、文理学院的 3.2 对照。工学院是 3.5。部分选择性专业另有专业课 GPA，这里不计算。",
      "对照的是 UC Davis 工学院以外的 TAG（保录计划）成绩线 3.2。");
  }

  function uci(major, pace) {
    var kind = uciKind(major);
    var years = uciYears(pace);
    var paceTxt = pace === "1yr" ? "按 1 年规划" : pace === "2yr" ? "按 2 年规划" : "还没分 1 年 / 2 年";
    if (kind.kind === "unknown") {
      return closedRule(
        "3.4，但要先看专业",
        paceTxt + "。UCI 已公布的最低可转 GPA 是 3.4（2027 秋周期：2026 年秋季结束前）。排除专业未选定前，这里不显示差距，也不标记是否达到成绩线。2027 秋排除 Art、Business Administration、Dance、Music, B.Mus.、Nursing Science，以及 Donald Bren 信息与计算机科学学院全部专业。2028 秋在此之上再增加生物、经济、心理和部分工科专业。",
        "UCI 的 TAG（保录计划）最低可转 GPA 是 3.4，但要先看专业在不在排除名单里。还没选定专业，这里不对照成绩线。"
      );
    }
    if (kind.kind === "cse") {
      return closedRule(
        "名单没有单独写出这个专业",
        "Computer Science and Engineering 由 Donald Bren 信息与计算机科学学院和 Henry Samueli 工学院合办。2027 秋排除的是 Bren 学院全部专业；2028 秋工学院点名的是 Aerospace、Computer、Electrical、Mechanical Engineering，没有单独写 Computer Science and Engineering。这里不显示差距，也不标记是否达到成绩线。",
        "这个专业名对不上 UCI 公布的排除条目，这里不对照 TAG（保录计划）成绩线。"
      );
    }
    if (kind.kind === "music-unclear") {
      return closedRule(
        "要先确认是不是 Music, B.Mus.",
        "UCI 官网排除的是 Music, B.Mus.；矩阵正文写的是 Music。学位对不上时，这里不显示差距，也不标记是否达到成绩线。",
        "Music 是否不能走 UCI TAG（保录计划），要看是不是 B.Mus.。这里不对照成绩线。"
      );
    }
    var hit = [];
    if (uciBlocked(kind, "2027")) hit.push("2027");
    if (uciBlocked(kind, "2028")) hit.push("2028");
    var blockedNow = false;
    for (var i = 0; i < years.length; i++) if (hit.indexOf(years[i]) >= 0) blockedNow = true;
    var why = kind.kind === "ics"
      ? "它属于 Donald Bren 信息与计算机科学学院，该学院全部专业都在排除名单里"
      : kind.kind === "y2027"
        ? "它在 2027 秋排除名单里（Art、Business Administration、Dance、Music, B.Mus.、Nursing Science，以及 Bren 学院全部专业）"
        : "它在 2028 秋新增的排除名单里（生物、心理、经济、认知科学，以及 Aerospace / Computer / Electrical / Mechanical Engineering 等）";
    if (blockedNow) {
      var both = hit.length === 2;
      var which = both ? "2027 秋和 2028 秋" : (hit[0] === "2027" ? "2027 秋" : "2028 秋");
      var other = "";
      if (!both && hit[0] === "2028") other = "2027 秋这个专业不在排除名单里。";
      if (!both && hit[0] === "2027") other = "2028 秋它仍然在排除名单里。";
      return closedRule(
        which + "不能走 UCI TAG（保录计划）",
        paceTxt + "。" + why + "。" + other + "已公布的最低可转 GPA 是 3.4，但不适用于被排除的入学季。这里不显示差距，也不标记是否达到成绩线。",
        paceTxt + "，" + which + "不能走 UCI TAG（保录计划）。这里不对照成绩线。"
      );
    }
    var later = hit.indexOf("2028") >= 0
      ? "2028 秋这个专业不能走 UCI TAG（保录计划）。"
      : "2028 秋已公布的排除名单里没有这个专业名。";
    return lineRule(3.4, "3.4",
      paceTxt + "，当前对照的入学季不在排除名单里。UCI 最低可转 GPA 3.4（2027 秋周期：须在 2026 年秋季结束前达到）。" + later + "专业先修另有成绩要求，这里不计算。",
      paceTxt + "，对照的是 UCI 的 TAG（保录计划）成绩线 3.4。" + later);
  }

  function merced(major, pace) {
    var core = coreMajor(major);
    var when = cycleWhen(pace, "须在 2026 年夏季结束前达到");
    var base = "矩阵：工学院 3.0；自然科学 2.9；社会科学、人文与艺术 2.8（例外 Psychology 3.0、Public Health 3.0）。目前写所有专业都开放，但可能变化。";
    if (hasPhrase(core, "psychology")) {
      return lineRule(3.0, "3.0（Psychology）", when + base + "当前专业按例外 Psychology 3.0 对照。",
        "对照的是 UC Merced Psychology 的 TAG（保录计划）成绩线 3.0。");
    }
    if (hasPhrase(core, "public health")) {
      return lineRule(3.0, "3.0（Public Health）", when + base + "当前专业按例外 Public Health 3.0 对照。",
        "对照的是 UC Merced Public Health 的 TAG（保录计划）成绩线 3.0。");
    }
    if (isEngineering(core)) {
      return lineRule(3.0, "3.0（工学院）", when + base + "当前专业按工学院 3.0 对照。",
        "对照的是 UC Merced 工学院 TAG（保录计划）成绩线 3.0。");
    }
    return closedRule(
      "按学院分线，见下方",
      when + base + "当前专业对不上单独一条例外，这里不单算差距，也不标记是否达到成绩线。",
      "UC Merced 的 TAG（保录计划）按学院分线：工学院 3.0，自然科学 2.9，社会科学、人文与艺术 2.8（Psychology、Public Health 为 3.0）。当前专业对不上单独一条，这里不单算差距。"
    );
  }

  function riverside(major, pace) {
    var core = coreMajor(major);
    var when = cycleWhen(pace, "须在 2026 年夏季结束前达到");
    var base = "矩阵：CHASS 2.8（Psychology，以及 Theater, Film and Digital Production 为 3.3）；BCOE 工学院 3.0（Computer Science 3.6，Computer Science with Business Applications 3.3，Computer Engineering 3.3，Mechanical Engineering 3.1）；CNAS 2.8（Data Science 3.0）；商学院 2.8；教育学院 2.7；公共政策学院 2.7。Art Studio 不在范围内。";
    if (hasPhrase(core, "art studio")) {
      return closedRule(
        "Art Studio 不在范围内",
        "矩阵排除 Art Studio。这里不显示差距，也不标记是否达到成绩线。",
        "Art Studio 不在 UC Riverside 的 TAG（保录计划）范围内。这里不对照成绩线。"
      );
    }
    if (core === "art") {
      return closedRule(
        "要先确认是不是 Art Studio",
        "矩阵排除的是 Art Studio，没有写全部 Art 专业。专业名对不上时，这里不显示差距，也不标记是否达到成绩线。",
        "Art 是否在 UC Riverside 的 TAG（保录计划）范围内，要看是不是 Art Studio。这里不对照成绩线。"
      );
    }
    if (hasPhrase(core, "computer science") && hasPhrase(core, "business")) {
      return lineRule(3.3, "3.3", when + "当前专业按 BCOE 例外 Computer Science with Business Applications 3.3 对照。" + base,
        "对照的是 UC Riverside Computer Science with Business Applications 的 TAG（保录计划）成绩线 3.3。");
    }
    if (hasPhrase(core, "computer science") && isEngineering(core)) {
      return closedRule(
        "名单没有单独写出这个专业",
        "矩阵分开写了 Computer Science 3.6 和 Computer Engineering 3.3，没有单独写 Computer Science and Engineering。这里不显示差距，也不标记是否达到成绩线。",
        "这个专业名对不上 UC Riverside 矩阵里的单条成绩线，这里不对照。"
      );
    }
    if (hasPhrase(core, "computer science") && !hasPhrase(core, "engineering")) {
      return lineRule(3.6, "3.6", when + "当前专业按 BCOE 例外 Computer Science 3.6 对照。" + base,
        "对照的是 UC Riverside Computer Science 的 TAG（保录计划）成绩线 3.6。");
    }
    if (hasPhrase(core, "computer engineering")) {
      return lineRule(3.3, "3.3", when + "当前专业按 Computer Engineering 3.3 对照。" + base,
        "对照的是 UC Riverside Computer Engineering 的 TAG（保录计划）成绩线 3.3。");
    }
    if (hasPhrase(core, "mechanical engineering")) {
      return lineRule(3.1, "3.1", when + "当前专业按 Mechanical Engineering 3.1 对照。" + base,
        "对照的是 UC Riverside Mechanical Engineering 的 TAG（保录计划）成绩线 3.1。");
    }
    if (isEngineering(core)) {
      return lineRule(3.0, "3.0（工学院）", when + "当前专业按 BCOE 工学院 3.0 对照。" + base,
        "对照的是 UC Riverside 工学院 TAG（保录计划）成绩线 3.0。");
    }
    if (hasPhrase(core, "data science")) {
      return lineRule(3.0, "3.0（Data Science）", when + "当前专业按 CNAS 例外 Data Science 3.0 对照。" + base,
        "对照的是 UC Riverside Data Science 的 TAG（保录计划）成绩线 3.0。");
    }
    if (hasPhrase(core, "psychology") || (hasPhrase(core, "theater") && (hasPhrase(core, "film") || hasPhrase(core, "digital")))) {
      return lineRule(3.3, "3.3", when + "当前专业按 CHASS 例外 3.3 对照。" + base,
        "对照的是 UC Riverside 该专业的 TAG（保录计划）成绩线 3.3。");
    }
    if (hasPhrase(core, "public policy")) {
      return lineRule(2.7, "2.7（公共政策）", when + "当前专业按公共政策学院 2.7 对照。" + base,
        "对照的是 UC Riverside 公共政策学院 TAG（保录计划）成绩线 2.7。");
    }
    if (core === "education") {
      return lineRule(2.7, "2.7（教育学院）", when + "当前专业按教育学院 2.7 对照。" + base,
        "对照的是 UC Riverside 教育学院 TAG（保录计划）成绩线 2.7。");
    }
    return closedRule(
      "按学院分线，见下方",
      when + base + "当前专业对不上单独一条例外，这里不单算差距，也不标记是否达到成绩线。部分专业另有先修课，专业课 GPA 这里不计算。",
      "UC Riverside 的 TAG（保录计划）按学院和专业分线（CHASS 2.8，部分专业 3.3；工学院 3.0，Computer Science 3.6 等）。当前专业对不上单独一条，这里不单算差距。"
    );
  }

  function ucsb(major, pace) {
    var raw = normMajor(major);
    var core = coreMajor(major);
    var when = cycleWhen(pace, "须在 2026 年秋季结束前达到");
    if (!core) {
      return closedRule(
        "所有开放专业 3.4",
        when + "还没选定专业。Creative Studies 全部专业、工学院全部专业，以及 Dance、Music B.M.、部分 Theater 不能走。有 pre-major 的文理学院专业，矩阵写的是 pre-major。这里不单算差距。",
        "UC Santa Barbara 已公布的 TAG（保录计划）成绩线是所有开放专业 3.4。还没选定专业，这里不对照成绩线。"
      );
    }
    if (isEngineering(core) || hasPhrase(core, "creative studies") || hasPhrase(core, "dance")) {
      return closedRule(
        "这个专业不在范围内",
        "矩阵：Creative Studies 全部专业、工学院全部专业，以及文理学院的 Dance B.A. / B.F.A.、Music B.M.、Theater B.A.（Theater Design Emphasis）、Theater B.F.A.（Acting Emphasis）不能走 TAG（保录计划）。这里不显示差距，也不标记是否达到成绩线。",
        "这个专业不在 UC Santa Barbara 的 TAG（保录计划）范围内。这里不对照成绩线。"
      );
    }
    if (hasPhrase(core, "music") && (hasPhrase(raw, "b m") || hasPhrase(raw, "b mus"))) {
      return closedRule(
        "Music B.M. 不在范围内",
        "矩阵排除 Music B.M.。这里不显示差距，也不标记是否达到成绩线。",
        "Music B.M. 不在 UC Santa Barbara 的 TAG（保录计划）范围内。这里不对照成绩线。"
      );
    }
    if (hasPhrase(core, "music") && !hasPhrase(raw, "b a") && !hasPhrase(raw, "b s")) {
      return closedRule(
        "要先确认是不是 Music B.M.",
        "矩阵排除的是 Music B.M.，没有写全部 Music 专业。学位对不上时，这里不显示差距，也不标记是否达到成绩线。",
        "Music 是否在 UC Santa Barbara 的 TAG（保录计划）范围内，要看是不是 B.M.。这里不对照成绩线。"
      );
    }
    if (hasPhrase(core, "theater") && (hasPhrase(core, "design") || hasPhrase(core, "acting") || hasPhrase(raw, "b f a"))) {
      return closedRule(
        "这个 Theater 方向不在范围内",
        "矩阵排除 Theater B.A.（Theater Design Emphasis）和 Theater B.F.A.（Acting Emphasis）。这里不显示差距，也不标记是否达到成绩线。",
        "这个 Theater 方向不在 UC Santa Barbara 的 TAG（保录计划）范围内。这里不对照成绩线。"
      );
    }
    if (hasPhrase(core, "theater")) {
      return closedRule(
        "要先确认 Theater 方向",
        "矩阵排除的是 Theater Design Emphasis 和 Acting Emphasis 的 B.F.A.，不是全部 Theater。方向对不上时，这里不显示差距，也不标记是否达到成绩线。",
        "这个 Theater 专业对不上矩阵里的排除方向，这里不对照成绩线。"
      );
    }
    var prep = hasPhrase(core, "biological") || hasPhrase(core, "biology") || hasPhrase(core, "chemistry") || hasPhrase(core, "biochemistry") || hasPhrase(core, "economics") || hasPhrase(core, "mathematics") || hasPhrase(core, "math") || hasPhrase(core, "physics") || hasPhrase(core, "statistics");
    var prepTxt = prep
      ? "矩阵写 Biological Sciences、Chemistry and Biochemistry、Economics、Mathematics、Physics、Statistics and Applied Probability 另有专业课 GPA，这里不计算。"
      : "部分专业另有专业课 GPA，这里不计算。";
    return lineRule(3.4, "3.4",
      when + "开放专业的最低可转 GPA 是 3.4。有 pre-major 的文理学院专业，矩阵写的是 pre-major，进校后还要再满足要求。" + prepTxt,
      "对照的是 UC Santa Barbara 开放专业的 TAG（保录计划）成绩线 3.4。有 pre-major 的专业，矩阵写的是 pre-major。");
  }

  function resolve(uc, major, pace) {
    var key = campusKey(uc);
    if (!key) {
      return closedRule(
        "未选定目标校",
        "选定目标 UC 和专业后，这里按 2027-28 矩阵显示成绩线。",
        "还没选定目标校，这里不对照 TAG（保录计划）成绩线。"
      );
    }
    if (key === "berkeley" || key === "ucla" || key === "ucsd") {
      return closedRule(
        "该校不参与 TAG（保录计划）",
        "UC 官网「TAG by campus」列出的是 Davis、Irvine、Merced、Riverside、Santa Barbara、Santa Cruz。伯克利、UCLA、UC San Diego 不在这份名单里。这里不显示差距，也不标记是否达到成绩线。",
        "该校不参与 TAG（保录计划），这里不对照成绩线。"
      );
    }
    if (key === "davis") return davis(major, pace);
    if (key === "uci") return uci(major, pace);
    if (key === "ucsc") {
      return lineRule(3.0, "3.0",
        cycleWhen(pace, "须在 2026 年夏季结束前达到") + "Santa Cruz：所有专业 3.0。矩阵写目前所有专业都开放。部分专业另有专业课 GPA，这里不计算。",
        "对照的是 UC Santa Cruz 的 TAG（保录计划）成绩线 3.0（所有专业）。");
    }
    if (key === "merced") return merced(major, pace);
    if (key === "riverside") return riverside(major, pace);
    if (key === "ucsb") return ucsb(major, pace);
    return closedRule(
      "请以官网名单为准",
      "这所学校不在已核对的 9 所本科招生校区里。TAG（保录计划）只在官网列出的 6 所校区提供。",
      "这所学校不在已核对的名单里，这里不对照 TAG（保录计划）成绩线。"
    );
  }

  function formatTag(uc, major, pace, avg) {
    var rule = resolve(uc, major, pace);
    var value = rule.value;
    var color = "";
    var gap = "";
    var hasAvg = avg != null && avg !== "" && !isNaN(Number(avg));
    if (rule.mode === "line" && hasAvg) {
      var diffCents = cents(avg) - cents(rule.gpa);
      var diff = (Math.abs(diffCents) / 100).toFixed(2);
      if (diffCents >= 0) {
        value = rule.value + (diffCents === 0 ? " · 达到这条线 ✅" : " · 高出 " + diff + " ✅");
        color = "#16a34a";
        gap = diffCents === 0 ? "已达到这条成绩线。" : "高出 " + diff + "。";
      } else {
        value = rule.value + " · 还差 " + diff + " ⚠️";
        color = "#dc2626";
        gap = "还差 " + diff + "。";
      }
    }
    var head = hasAvg
      ? "成绩：平均 GPA " + Number(avg).toFixed(2) + "。"
      : "成绩：已完成学季还没有填 GPA，暂时算不出平均成绩。";
    return {
      mode: rule.mode,
      gpa: rule.gpa,
      label: rule.label,
      value: value,
      color: color,
      detail: rule.detail,
      summary: head + rule.summary + gap + "以官网为准。"
    };
  }

  return { formatTag: formatTag, normMajor: normMajor, coreMajor: coreMajor };
});
