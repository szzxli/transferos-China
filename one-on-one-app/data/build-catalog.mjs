/* CSI 专业数据集构建脚本（v13.1）
 * 数据纪律：只用 CUNY College of Staten Island 官方来源（官方目录 / 学院官网 / CUNY AUR 课程文件 / 学位图）。
 * - 每条要求的出处见各专业 sources（写入产物 _meta.sources，含 URL 与抓取日期）。
 * - 要求行带 source 字段：official = 官方来源可溯；ledger = 仅学生 intake 台账（《工作簿2》/DegreeWorks 审计）可溯、未经官网复核。
 *   两者在数据里逐行可区分，绝不混成全官方。
 * - 官方未确认的课程名称留空字符串，绝不根据常识补名；学分未确认 = null（引擎单列未知）。
 * - 查不到官方要求集的专业只列名，verified=false、requirements 为空，note 标「要求待官方核实」。
 * - permit 字段（可否外校修读）：csi_only = 须在 CSI 项目内修读；same_school_pair = 有同校修读要求；
 *   epermit = 可申请 CUNY ePermit 在其他 CUNY 学院修读（须 CSI 导师批准，资格与流程见 CSI Registrar ePermit 页）。
 *   SUNY 非 CUNY 体系、无 ePermit 通道，按 CSI 转学分个案评估（数据集级说明）。
 * - ap 字段（AP 替代）：CSI 官方口径 = AP ≥3 分可换 Credit for Prior Learning，具体考试与等效课程
 *   以 CUNY Transfer Explorer（T-Rex）官方查询为准（CSI AP 页明示）；逐门分数线在 T-Rex 逐门核实，不编造。
 * 更新方式：改本文件中的 MAJORS 数据后运行 `node build-catalog.mjs` 重新生成 csi-majors.json；
 * 换学校 = 换一份数据集文件（同结构），前端只认 _meta/majors/courses 三段。
 * 护理（Nursing BS，四年制，2026 秋首届）：要求集与既有「情景一」（生产 course_requirement_sets，
 * 导师按 DegreeWorks 台账维护的 42 条）是同一批课程的两种呈现——本数据集按官方来源逐行重建，
 * 条目代码与分块与情景一对齐（对账计数一致），差异逐条记在 major.diff_notes；生产情景一数据不被本数据集覆盖。 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RETRIEVED = "2026-10-21";
const S_BIO_MAP = "https://coursedog-pdfs-public-prod.s3.us-east-2.amazonaws.com/csi01/catalog-pdf/ruWaU1g0EN9UVfQAV7q3/sMJm9FBaDQdn6EfcLHX0Od8Fg/BIO-CSI-2025-09-16-13-47-28.pdf";
const S_BIO_CATALOG = "https://csi-undergraduate.catalog.cuny.edu/programs/BIO-BS";
const S_BIO_DEGREE_MAP = "https://www.csi.cuny.edu/sites/default/files/pdf/academciadvisement/PathwaysAcadPlans/2021/BiologyBS_General_DegreeMap.pdf";
const S_CS_SENATE = "https://www.csi.cuny.edu/media/32231";
const S_CS_DEGREE_MAP = "https://www.cs.csi.cuny.edu/content/Sample_csc_4_yr_degree-career-map.pdf";
const S_CS_CATALOG = "https://csi-undergraduate.catalog.cuny.edu/programs/CSC-BS";
const S_NRS_PAGE = "https://www.csi.cuny.edu/academics-and-research/departments-programs/nursing/four-year-bachelor-science-nursing-program";
const S_NRS_AUR24 = "https://www.cuny.edu/wp-content/uploads/sites/4/page-assets/academics/academic-programs/academic-program-resources/academic-reports/fall-2024-and-spring-2025/College-of-Staten-Island-AUR-Items-October-2024.pdf";
const S_NRS_AUR25 = "https://www.cuny.edu/wp-content/uploads/sites/4/page-assets/academics/academic-programs/academic-program-resources/academic-reports/fall-2024-and-spring-2025/College-of-Staten-Island-AUR-Items-June-2025-UPDATED.pdf";
const S_NRS_NEWS = "https://csitoday.com/2025/12/csi-announces-new-four-year-nursing-bachelor-of-science-degree/";
const S_MLS_CATALOG = "https://csi-undergraduate.catalog.cuny.edu/programs/MDT-BS";
const S_CHM_CATALOG = "https://csi-undergraduate.catalog.cuny.edu/programs/CHM-BS";
const S_EPERMIT = "https://www.csi.cuny.edu/students/registrar/epermit";
const S_AP = "https://www.csi.cuny.edu/admissions/applying-csi/advanced-placement-credit";

/* 要求条目：[block, code, name, credits, min_grade, prereq_codes, extra]
 * extra: { source: "official"|"ledger", term: "Y1S1" 等官方学期编排, permit, note }
 * name 为空 = 官方名称未在所引来源中确认（留空不编）。credits=null = 官方学分未确认。 */
const R = (block, code, name, credits, min_grade, prereq_codes, extra) =>
  ({ block, course_code: code, course_name: name, credits, min_grade: min_grade || null,
     prereq_codes: prereq_codes || [], ...((extra) || {}) });
const OFF = { source: "official" };
const LED = { source: "ledger" };
const EP = { permit: "epermit" };
const CSI_ONLY = { permit: "csi_only" };

/* 护理要求集（42 条，与情景一逐条对齐；学期编排由官方 AUR 并修链推导，Y1 为护理系官网明示） */
const NURSING_REQUIREMENTS = [
  /* —— 专业先修 prereq（12）—— */
  R("prereq", "BIO 150", "Human Anatomy and Physiology I", 4, "C+", [], { ...OFF, term: "Y1S2", permit: "same_school_pair", note: "与 BIO 160 必须在同一所学校修读（护理系官网明示）" }),
  R("prereq", "BIO 160", "Human Anatomy & Physiology II", 4, "C", ["BIO 150"], { ...LED, ...EP, term: "Y2S1", permit: "same_school_pair", note: "名称/学分据台账；AUR 确认其为第二年第一学期课程且与 BIO 150 同校修读；后续课程要求 C 以上" }),
  R("prereq", "PSY 100", "Psychology", 3, "C+", [], { ...OFF, ...EP, term: "Y1S1" }),
  R("prereq", "CHM 110", "Principles of Chemistry I", 3, "C+", [], { ...OFF, ...EP, term: "Y1S2" }),
  R("prereq", "CHM 111", "Principles of Chemistry I Laboratory", 1, "C+", [], { ...OFF, ...EP, term: "Y1S2" }),
  R("prereq", "MTH 113", "Introduction to Probability & Statistics", 4, "C+", [], { ...OFF, ...EP, term: "Y1S2" }),
  R("prereq", "PSY 242", "", 4, "C+", [], { ...LED, ...EP, term: "Y3S1", note: "学分据台账（官方学期学分加总与学位总学分 120 吻合，旁证）；AUR 确认其为 NRS 301/310 并修课、NRS 309 先修要求 C+ 以上；课程全名未在所引官方来源中确认，留空" }),
  R("prereq", "CHM 116", "", 3, "C", ["CHM 110"], { ...LED, ...EP, term: "Y2S1", note: "名称/学分据台账；AUR 确认其为第二年第一学期课程（NRS 101/204 并修），后续课程要求 C 以上" }),
  R("prereq", "CHM 117", "", 1, "C", ["CHM 111"], { ...LED, ...EP, term: "Y2S1", note: "名称/学分据台账；AUR 确认其为第二年第一学期课程（NRS 101/204 并修），后续课程要求 C 以上" }),
  R("prereq", "BIO 350", "Microbiology and Cellular Pathology", 3, "C", ["BIO 160"], { ...OFF, ...EP, term: "Y2S2", note: "名称/学分据官方 BIO 目录；先修 BIO 160 据台账与 AUR 学期编排；NRS 301 要求本课 C 以上" }),
  R("prereq", "BIO 351", "", 1, "C", ["BIO 350"], { ...LED, ...EP, term: "Y2S2", note: "学分据台账；AUR 确认其为第二年第二学期课程（NRS 208/303/320 并修），NRS 301 要求 C 以上" }),
  R("prereq", "BIO 146", "", 3, "C", [], { ...LED, ...EP, term: "Y2S1", note: "名称/学分据台账；AUR 确认其为第二年第一学期课程（NRS 101/204 并修），后续课程要求 C 以上" }),
  /* —— 核心 NRS（17，全部官方 AUR 课程文件：名称/学分/先修链/学期）—— */
  R("core", "NRS 101", "Holistic Self-Care of the Nurse and Nursing Student", 1, "C+", [], { ...OFF, ...CSI_ONLY, term: "Y2S1", note: "入学门槛课：须先被四年制护理项目录取，且第一年课程全部 C 以上" }),
  R("core", "NRS 204", "Pharmacology and Medical Dosage Calculations for Nurses", 3, "C+", [], { ...OFF, ...CSI_ONLY, term: "Y2S1", note: "与 NRS 101 同学期并修（官方并修关系）" }),
  R("core", "NRS 208", "Foundations of Nursing", 4, "C+", ["NRS 101", "NRS 204"], { ...OFF, ...CSI_ONLY, term: "Y2S2" }),
  R("core", "NRS 303", "Seminar in Profession", 3, "C+", ["NRS 101", "NRS 204"], { ...OFF, ...CSI_ONLY, term: "Y2S2", note: "课程名按 AUR 原文；全称待目录课程页复核" }),
  R("core", "NRS 320", "Health Assessment and Physical Examination", 3, "C+", ["NRS 101", "NRS 204"], { ...OFF, ...CSI_ONLY, term: "Y2S2" }),
  R("core", "NRS 301", "Adult Health Nursing I", 5, "C+", ["NRS 208", "NRS 303", "NRS 320"], { ...OFF, ...CSI_ONLY, term: "Y3S1" }),
  R("core", "NRS 310", "Interpersonal Dynamics for Professional Nurses", 2, "C+", ["NRS 208", "NRS 303", "NRS 320"], { ...OFF, ...CSI_ONLY, term: "Y3S1" }),
  R("core", "NRS 307", "Adult Health Nursing II", 5, "C+", ["NRS 301", "NRS 310"], { ...OFF, ...CSI_ONLY, term: "Y3S2" }),
  R("core", "NRS 309", "Psychiatric Nursing and Mental Health Wellness", 4, "C+", ["NRS 301", "NRS 310", "PSY 242"], { ...OFF, ...CSI_ONLY, term: "Y3S2" }),
  R("core", "NRS 321", "Introduction to Research in Nursing", 3, "C+", [], { ...OFF, ...CSI_ONLY, term: "Y3S2", note: "与 NRS 307/309 同学期（官方并修）；学分据 AUR 2025-06 文件" }),
  R("core", "NRS 401", "Adult Health Nursing III", 5, "C+", ["NRS 307", "NRS 309", "NRS 321"], { ...OFF, ...CSI_ONLY, term: "Y4S1" }),
  R("core", "NRS 410", "Community Health Nursing", 5, "C+", ["NRS 307", "NRS 309", "NRS 321"], { ...OFF, ...CSI_ONLY, term: "Y4S1" }),
  R("core", "NRS 412", "Nursing Leadership, Management, and Care Coordination", 2, "C+", ["NRS 307", "NRS 309", "NRS 321"], { ...OFF, ...CSI_ONLY, term: "Y4S1" }),
  R("core", "NRS 414", "Family-Centered Maternity and Neonatal Nursing", 4, "C+", ["NRS 401", "NRS 410", "NRS 412"], { ...OFF, ...CSI_ONLY, term: "Y4S2" }),
  R("core", "NRS 415", "Nursing Care of Children", 4, "C+", ["NRS 401", "NRS 410", "NRS 412"], { ...OFF, ...CSI_ONLY, term: "Y4S2" }),
  R("core", "NRS 423", "Issues in Health Care and Professional Nursing", 3, "C+", ["NRS 401", "NRS 410", "NRS 412"], { ...OFF, ...CSI_ONLY, term: "Y4S2" }),
  R("core", "NRS 424", "Transition to Professional Practice", 2, "C+", ["NRS 401", "NRS 410", "NRS 412"], { ...OFF, ...CSI_ONLY, term: "Y4S2" }),
  /* —— 通识 gened（12，与情景一台账对齐；官方第一年清单内的逐行标 official，其余为她的 DegreeWorks 台账选课）—— */
  R("gened", "ENG 111", "Intro to College Writing", 3, "C+", [], { ...OFF, ...EP, term: "Y1S1" }),
  R("gened", "ENG 151", "College Writing", 3, "C+", [], { ...OFF, ...EP, term: "Y1S2" }),
  R("gened", "PHL 130", "Introduction to Ethics", 3, "C+", [], { ...OFF, ...EP, term: "Y1S1" }),
  R("gened", "MUS 108", "Introduction to Jazz History", 3, null, [], { ...LED, ...EP, note: "她的台账选课（创意表达类）；名称/学分据台账与本人成绩记录" }),
  R("gened", "COR 100", "US Issues, Ideas & Institutions", 3, null, [], { ...LED, ...EP, note: "对应官方第一年清单中的「US Experience & Diversity」类别（3 学分）；具体课程据她的台账" }),
  R("gened", "BIO 106", "Principles of Biology I", 3, "C+", [], { ...OFF, ...EP, term: "Y1S1" }),
  R("gened", "BIO 107", "Principles of Biology I Laboratory", 1, "C+", [], { ...OFF, ...EP, term: "Y1S1" }),
  R("gened", "CHN 215", "Continuing Mandarin Chinese II", 4, null, [], { ...LED, ...EP, note: "名称/学分据台账与本人成绩记录" }),
  R("gened", "CSC 119", "Computer Technology Concepts", 3, null, [], { ...LED, ...EP, note: "名称/学分据台账与本人成绩记录" }),
  R("gened", "MTH 231", "Anal Geom–Calc I", 3, null, [], { ...LED, ...EP, note: "名称/学分据台账与本人成绩记录" }),
  R("gened", "FCWG 1000", "FC World Cultures & Global Issues", 3, null, [], { ...LED, ...EP, note: "对应 AUR 并修链中的「World Cultures and Global Issues」类别；具体课程据她的台账" }),
  R("gened", "COLLEGE-OPTION", "College Option 缺口（200 级以上 SSA/TALA，含 CW 与 P&D 主题）", 12, null, [], { ...LED, ...EP, note: "DegreeWorks 审计缺口条目（尚缺 12 学分），不是单门课" }),
  /* —— 选修 elective（1）—— */
  R("elective", "NRS-ELECT", "护理选修（NRS Elective）", 6, "C", [], { ...OFF, ...CSI_ONLY, term: "Y4S1+Y4S2", note: "官方要求两门护理选修（各 3 学分，第四年两学期各一门），可选 NRS 305/319/323/324/325/421/430；台账合并记为一条 6 学分" }),
];

const MAJORS = [
  {
    id: "nursing-bs", name: "Nursing BS（四年制）", verified: true, partial: false,
    note: "四年制护理学士（2026 秋首届），学位总学分 120（官方）。本要求集与「情景一」是同一批课程的两种呈现：条目与计数一致（对账见本专业 diff 说明），规划与学位审计仍以情景一（DegreeWorks 台账）为准。标「台账」的行只有学生 intake 台账来源、未经官网复核；其余行均为官方来源。条目学分合计含类别重叠（如 BIO 106 同时算通识与项目第一年课程），不等于学位总学分。",
    sources: [S_NRS_PAGE, S_NRS_AUR24, S_NRS_AUR25, S_NRS_NEWS, S_BIO_MAP],
    program_rules: [
      "学位总学分 120；项目 2026 年秋季首届（CSI 官方发布）",
      "录取门槛：总 GPA ≥ 2.7；第一年 11 门指定课程每门 C+ 以上",
      "科学课小组 GPA ≥ 3.0：BIO 106、BIO 107、CHM 110、CHM 111、BIO 150",
      "上述科学课原则上只能尝试一次；超过 5 年须重修（护理系官网）",
      "BIO 150 与 BIO 160 必须在同一所学校修读",
      "第一年内须完成一项标准化入学考试并提交官方成绩（考试名称官网未写明，待向护理系核实）",
      "NRS 核心课实行 C+ 进阶制：后续课程普遍要求前序 NRS 课 C+ 以上",
      "本项目不参加 Freshman Forgiveness 政策",
    ],
    diff_notes: [
      "学分：台账 NRS 17 门学分未拆分（单列未知）；本集按 AUR 官方逐门学分计入，核心合计 58 + 选修 6 = 64；台账称序列总 65，差 1 学分待核实（官方逐学期加总与学位总学分 120 恰好吻合，支持官方口径）",
      "先修链：台账为单线链（如 NRS 208 只挂 NRS 204）；本集按 AUR 官方先修原文（如 NRS 208 须 NRS 101 与 204 均 C+ 以上）",
      "NRS 101 与 NRS 204：台账记先后，官方为同学期并修",
      "最低成绩：台账未标注；本集按官方录取与进阶规则标注（第一年课程 C+、科学支持课 C、NRS 课 C+）",
      "计数对账：42 条要求、已修 13 / 在修 4 / 缺 25，与情景一生产口径完全一致",
    ],
    requirements: NURSING_REQUIREMENTS,
  },
  {
    id: "biology-bs", name: "Biology BS", verified: true, partial: true,
    note: "部分要求集：通识写作、先修与有机化学核心已按官方学位图建模；BIO 选修 OR 组（如 BIO 205/233/235/237/239 任选）与物理序列未逐条建模。官方口径：BIO 先修课须 C 以上、专业 GPA 须 ≥2.5 才能毕业。",
    sources: [S_BIO_MAP, S_BIO_CATALOG, S_BIO_DEGREE_MAP],
    requirements: [
      R("gened", "ENG 111", "", 3),
      R("gened", "ENG 151", "", 3, null, ["ENG 111"]),
      R("prereq", "BIO 170", "General Biology I", 3, "C"),
      R("prereq", "BIO 171", "General Biology I Laboratory", 1, "C"),
      R("prereq", "BIO 180", "General Biology II", 3, "C", ["BIO 170"]),
      R("prereq", "BIO 181", "General Biology II Laboratory", 1, "C"),
      R("prereq", "CHM 141", "General Chemistry I", 3),
      R("prereq", "CHM 121", "General Chemistry I Laboratory", 1),
      R("prereq", "CHM 142", "General Chemistry II", 3, null, ["CHM 141"]),
      R("prereq", "CHM 127", "General Chemistry II Laboratory", 1),
      R("prereq", "MTH 231", "Analytic Geometry and Calculus I", 3),
      R("prereq", "MTH 229", "Calculus Computer Laboratory", 1),
      R("core", "CHM 250", "", 5, null, ["CHM 142"]),
      R("core", "CHM 256", "", 5, null, ["CHM 250"]),
    ],
  },
  {
    id: "computer-science-bs", name: "Computer Science BS", verified: true, partial: true,
    note: "部分要求集：按教师参议院课程文件（2025-11）与系官网清单建模；400 级选修×2、高阶数学×2、一年科学序列（OR 组）未逐条建模。官方口径：CSC 126 须 C 以上才能进入 CS 学士项目。个别课程学分在不同官方文件间未见一致标注，未确认者留空（null）。",
    sources: [S_CS_SENATE, S_CS_DEGREE_MAP, S_CS_CATALOG],
    requirements: [
      R("prereq", "CSC 126", "Introduction to Computer Science", 4, "C"),
      R("prereq", "MTH 231", "Analytic Geometry and Calculus I", 3),
      R("prereq", "MTH 229", "Calculus Computer Laboratory", 1),
      R("core", "CSC 211", "Intermediate Programming", 4),
      R("core", "CSC 220", "Computer Organization", null),
      R("core", "CSC 228", "Discrete Mathematical Structures for Computer Science", 4),
      R("core", "CSC 326", "Data Structures", 4),
      R("core", "CSC 330", "Object-Oriented Software Design", 4),
      R("core", "CSC 332", "Operating Systems I", 3),
      R("core", "CSC 305", "Operating Systems Laboratory", 1),
      R("core", "CSC 346", "Digital Systems Design", null),
      R("core", "CSC 347", "Digital Systems Design Laboratory", null),
      R("core", "CSC 382", "Analysis of Algorithms", null),
      R("core", "CSC 430", "Software Engineering", null),
      R("core", "CSC 446", "Computer Architecture", null),
      R("core", "CSC 490", "Seminar in Computer Science", null),
      R("core", "MTH 232", "Analytic Geometry and Calculus II", null),
    ],
  },
  {
    id: "medical-lab-science-bs", name: "Medical Laboratory Science BS", verified: false, partial: false,
    note: "要求待官方核实（仅列名）。项目实情（官方目录）：四年制学士，NAACLS 认证、纽约州执照资格项目；三年校内课程 + 两学期全职临床培训（多家附属医院）；毕业可考 ASCP 认证与纽约州 CLT 执照。逐条要求集待按官方目录补建。",
    sources: [S_MLS_CATALOG], requirements: [],
  },
  { id: "psychology-bs", name: "Psychology BS", verified: false, partial: false, note: "要求待官方核实（仅列名，未取得官方要求集）。", sources: [], requirements: [] },
  {
    id: "chemistry-bs", name: "Chemistry BS（含 Biochemistry 方向）", verified: false, partial: false,
    note: "要求待官方核实（仅列名）。项目实情（官方目录）：化学系学士，含 Biochemistry 方向（Track One 为 ACS 认证）。逐条要求集待按官方目录补建。",
    sources: [S_CHM_CATALOG], requirements: [],
  },
  { id: "business-bs", name: "Business BS", verified: false, partial: false, note: "要求待官方核实（仅列名，未取得官方要求集）。", sources: [], requirements: [] },
  { id: "accounting-bs", name: "Accounting BS", verified: false, partial: false, note: "要求待官方核实（仅列名，未取得官方要求集）。", sources: [], requirements: [] },
  { id: "engineering-science-bs", name: "Engineering Science BS", verified: false, partial: false, note: "要求待官方核实（仅列名，未取得官方要求集）。", sources: [], requirements: [] },
  { id: "teacher-education", name: "Teacher Education（教育方向）", verified: false, partial: false, note: "要求待官方核实（仅列名；具体项目与执照方向须按官方目录逐项确认）。", sources: [], requirements: [] },
];

/* 课程库 = 全部要求集牵引的课程并集（同代码合并，majors 标注所属专业）。
 * permit 随课程走：同课多专业标注不一致时以更严格者为准（csi_only > same_school_pair > epermit）。 */
const PERMIT_RANK = { csi_only: 3, same_school_pair: 2, epermit: 1 };
const AP_NOTE = "AP 替代：CSI 政策为 AP ≥3 分可换学分；具体考试与等效以 CUNY Transfer Explorer 官方查询为准";
function buildCourses(majors) {
  const byCode = new Map();
  for (const m of majors) {
    for (const r of m.requirements) {
      const key = r.course_code.toUpperCase();
      if (!byCode.has(key)) {
        byCode.set(key, {
          course_code: r.course_code, course_name: r.course_name, credits: r.credits,
          min_grade: r.min_grade, prereq_codes: r.prereq_codes, majors: [],
          permit: r.permit || null, source: r.source || null, ap_note: AP_NOTE,
        });
      }
      const c = byCode.get(key);
      if (!c.majors.includes(m.id)) c.majors.push(m.id);
      if (!c.course_name && r.course_name) c.course_name = r.course_name;
      if (c.credits === null && r.credits !== null) c.credits = r.credits;
      if ((PERMIT_RANK[r.permit] || 0) > (PERMIT_RANK[c.permit] || 0)) c.permit = r.permit;
      if (!c.source && r.source) c.source = r.source;
    }
  }
  return [...byCode.values()].sort((a, b) => (a.course_code < b.course_code ? -1 : 1));
}

const out = {
  _meta: {
    dataset: "csi-majors",
    school: "CUNY College of Staten Island (CSI)",
    retrieved: RETRIEVED,
    sources: [...new Set(MAJORS.flatMap((m) => m.sources))].map((url) => ({ url, retrieved: RETRIEVED })),
    permit_sources: [S_EPERMIT],
    ap_source: S_AP,
    note: "只收录官方来源可查的要求；verified=false 的专业仅列名、要求待官方核实。要求行 source=ledger 者为学生 intake 台账来源、未经官网复核。课程名称为空表示官方名称未在所引来源中确认。学分 null 表示未确认，匹配引擎单列未知、绝不估算。外修口径：CUNY 体系内可申请 ePermit（CSI Registrar）；SUNY 非 CUNY 体系、无 ePermit，按 CSI 转学分个案评估。AP 口径：CSI 官方 AP 页（≥3 分可换学分，逐门等效查 CUNY Transfer Explorer）。营养学（Nutrition）在 CSI 无独立学士项目（官方目录核实），故未列入。",
  },
  majors: MAJORS,
  courses: buildCourses(MAJORS),
};
const dest = join(dirname(fileURLToPath(import.meta.url)), "csi-majors.json");
writeFileSync(dest, JSON.stringify(out, null, 1) + "\n", "utf8");
console.log("written", dest, "| majors:", out.majors.length,
  "| with requirements:", out.majors.filter((m) => m.requirements.length).length,
  "| courses:", out.courses.length,
  "| nursing reqs:", (MAJORS.find((m) => m.id === "nursing-bs") || {}).requirements.length);
