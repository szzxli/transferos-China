/* CSI 专业数据集构建脚本（v13）
 * 数据纪律：只用 CUNY College of Staten Island 官方来源（官方目录 / 学院官网 / 学位图）。
 * - 每条要求的出处见 DATASET_SOURCES（写入产物 _meta.sources，含 URL 与抓取日期）。
 * - 官方未确认的课程名称留空字符串，绝不根据常识补名；学分未确认 = null（引擎单列未知）。
 * - 查不到官方要求集的专业只列名，verified=false、requirements 为空，note 标「要求待官方核实」。
 * 更新方式：改本文件中的 MAJORS 数据后运行 `node build-catalog.mjs` 重新生成 csi-majors.json；
 * 换学校 = 换一份数据集文件（同结构），前端只认 _meta/majors/courses 三段。
 * 与既有数据的关系：护理（Nursing BS）不在此重复灌要求集——Richa 的情景一（CSI 护理台账
 * 42 条要求，course_requirement_sets）是其权威来源；此处仅列名并在 note 里指明对应关系。 */
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

/* 要求条目：[block, code, name, credits, min_grade, prereq_codes]
 * name 为空 = 官方名称未在所引来源中确认（留空不编）。credits=null = 官方学分未确认。 */
const R = (block, code, name, credits, min_grade, prereq_codes) =>
  ({ block, course_code: code, course_name: name, credits, min_grade: min_grade || null, prereq_codes: prereq_codes || [] });

const MAJORS = [
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
    id: "nursing-bs", name: "Nursing BS", verified: false, partial: false,
    note: "要求待官方核实。本产品内已有该专业的完整台账情景（课程匹配「情景一」：CSI 护理要求 42 条，由导师按官方资料维护），专业匹配请直接看课程匹配区；本数据集不重复灌入，避免两处口径打架。",
    sources: [], requirements: [],
  },
  { id: "psychology-bs", name: "Psychology BS", verified: false, partial: false, note: "要求待官方核实（仅列名，未取得官方要求集）。", sources: [], requirements: [] },
  { id: "business-bs", name: "Business BS", verified: false, partial: false, note: "要求待官方核实（仅列名，未取得官方要求集）。", sources: [], requirements: [] },
  { id: "accounting-bs", name: "Accounting BS", verified: false, partial: false, note: "要求待官方核实（仅列名，未取得官方要求集）。", sources: [], requirements: [] },
  { id: "engineering-science-bs", name: "Engineering Science BS", verified: false, partial: false, note: "要求待官方核实（仅列名，未取得官方要求集）。", sources: [], requirements: [] },
  { id: "teacher-education", name: "Teacher Education（教育方向）", verified: false, partial: false, note: "要求待官方核实（仅列名；具体项目与执照方向须按官方目录逐项确认）。", sources: [], requirements: [] },
];

/* 课程库 = 全部要求集牵引的课程并集（同代码合并，majors 标注所属专业）。 */
function buildCourses(majors) {
  const byCode = new Map();
  for (const m of majors) {
    for (const r of m.requirements) {
      const key = r.course_code.toUpperCase();
      if (!byCode.has(key)) {
        byCode.set(key, {
          course_code: r.course_code, course_name: r.course_name, credits: r.credits,
          min_grade: r.min_grade, prereq_codes: r.prereq_codes, majors: [],
        });
      }
      const c = byCode.get(key);
      if (!c.majors.includes(m.id)) c.majors.push(m.id);
      if (!c.course_name && r.course_name) c.course_name = r.course_name;
      if (c.credits === null && r.credits !== null) c.credits = r.credits;
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
    note: "只收录官方来源可查的要求；verified=false 的专业仅列名、要求待官方核实。课程名称为空表示官方名称未在所引来源中确认。学分 null 表示未确认，匹配引擎单列未知、绝不估算。",
  },
  majors: MAJORS,
  courses: buildCourses(MAJORS),
};
const dest = join(dirname(fileURLToPath(import.meta.url)), "csi-majors.json");
writeFileSync(dest, JSON.stringify(out, null, 1) + "\n", "utf8");
console.log("written", dest, "| majors:", out.majors.length,
  "| with requirements:", out.majors.filter((m) => m.requirements.length).length,
  "| courses:", out.courses.length);
