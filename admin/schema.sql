-- TransferOS-China 业务管理后台 · D1 初始化脚本
-- 用法：在 Cloudflare 后台打开 D1 数据库 transferos-admin 的 Console，
-- 把本文件内容全部粘贴进去执行一次即可（表结构与种子数据）。
-- Worker 在首次收到请求时也会自动建表（CREATE TABLE IF NOT EXISTS），
-- 所以即使不执行本文件，表也会自动创建；本文件主要作用是导入种子代理数据。

CREATE TABLE IF NOT EXISTS agents(
  code TEXT PRIMARY KEY, name TEXT, region TEXT,
  kind TEXT, active INTEGER DEFAULT 1, created_at TEXT);

CREATE TABLE IF NOT EXISTS leads(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, wechat TEXT, phone TEXT,
  source TEXT, ref TEXT, eval_summary TEXT, status TEXT DEFAULT 'new',
  note TEXT, created_at TEXT, updated_at TEXT,
  grade TEXT, score INTEGER, grade_reason TEXT, graded_at TEXT);

CREATE TABLE IF NOT EXISTS visits(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT, page TEXT, day TEXT,
  count INTEGER DEFAULT 0, UNIQUE(ref, page, day));

CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, customer TEXT,
  package TEXT, amount INTEGER DEFAULT 0, stage TEXT, ref TEXT,
  is_renewal INTEGER DEFAULT 0, commission_rate INTEGER DEFAULT 30,
  commission INTEGER DEFAULT 0, paid_status TEXT DEFAULT 'unpaid',
  settle_status TEXT DEFAULT 'unsettled', created_at TEXT);

CREATE TABLE IF NOT EXISTS faqs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, lang TEXT DEFAULT 'zh-CN',
  q TEXT, a TEXT, sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);

-- ===== v2 新增表（无种子数据）=====
CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, order_id INTEGER,
  name TEXT, package TEXT, stage TEXT DEFAULT 'diag',
  stage_since TEXT, note TEXT, created_at TEXT, updated_at TEXT,
  client_key TEXT, slug TEXT, signature TEXT, signature_set_at TEXT,
  vision_text TEXT, mentor_message TEXT, mentor_message_at TEXT,
  parent_key TEXT, program_template TEXT DEFAULT 'transfer');

CREATE TABLE IF NOT EXISTS content_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, platform TEXT,
  pub_date TEXT, ref TEXT, type TEXT, status TEXT DEFAULT 'published', created_at TEXT);

CREATE TABLE IF NOT EXISTS content_metrics(
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, day TEXT,
  views INTEGER DEFAULT 0, consults INTEGER DEFAULT 0, leads INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, owner TEXT,
  due TEXT, status TEXT DEFAULT 'todo', note TEXT, created_at TEXT, updated_at TEXT,
  type TEXT DEFAULT 'task');

CREATE TABLE IF NOT EXISTS staff(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT,
  contact TEXT, start_date TEXT, status TEXT DEFAULT 'active',
  note TEXT, created_at TEXT,
  kind TEXT DEFAULT 'human', emp_no TEXT, platform TEXT, job_function TEXT,
  persona TEXT, accountable TEXT);

-- ===== v3 新增表 =====
-- 人员考核记录（入职测评/日常考核/年检）。
-- 回避规则由 Worker 服务端校验：AI 员工的入职测评主考体系不得与员工所属体系相同。
CREATE TABLE IF NOT EXISTS staff_reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER,
  review_type TEXT DEFAULT 'regular', review_date TEXT,
  examiner TEXT, examiner_platform TEXT, score REAL,
  verdict TEXT DEFAULT 'observe', comment TEXT, created_at TEXT);

-- ===== v6 新增表：一对一专属客户端（按 student_id 关联 students）=====
-- 学生目标（每名学生至多一条，student_id 唯一，页面保存走 upsert；
-- school_system 为学校体系标签，如 UC / CC / CUNY / SUNY / 其他，纯数据字段）
CREATE TABLE IF NOT EXISTS student_goals(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER UNIQUE,
  target_school TEXT, target_term TEXT, goal_note TEXT, gpa_target TEXT,
  school_system TEXT, created_at TEXT, updated_at TEXT);
-- 状态快照（每学期结束记一条：当时 GPA 与学分进度）
CREATE TABLE IF NOT EXISTS student_status(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
  snapshot_date TEXT, gpa REAL, credits_done INTEGER, credits_total INTEGER,
  note TEXT, created_at TEXT);
-- 选课规划（kind: prereq 必修先修 / gened 通识 / elective 选修；
-- status: planned 计划中 / enrolled 已选 / ongoing 进行中 / done 已完成 / dropped 已退）
CREATE TABLE IF NOT EXISTS student_courses(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
  term TEXT, course_code TEXT, course_name TEXT, credits INTEGER,
  kind TEXT DEFAULT 'prereq', status TEXT DEFAULT 'planned', grade TEXT,
  note TEXT, created_at TEXT, updated_at TEXT);
-- 博士毕业检查（仅 phd 模板学生使用）
CREATE TABLE IF NOT EXISTS student_phd_checks(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
  check_key TEXT, status TEXT DEFAULT 'todo', note TEXT,
  created_at TEXT, updated_at TEXT, UNIQUE(student_id, check_key));
-- 专题辅导会议（纪要 + 待办 + 下次会议日期）
CREATE TABLE IF NOT EXISTS student_meetings(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
  meeting_date TEXT, topic TEXT, summary TEXT, action_items TEXT,
  next_date TEXT, created_at TEXT, updated_at TEXT);
-- 考试记录（考试名/分数/达标线均为自由文本，格式由各项目要求决定；
-- result: pass 达标 / fail 未达标 / pending 待考或待出分）
CREATE TABLE IF NOT EXISTS student_exams(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
  exam_name TEXT, exam_date TEXT, score TEXT, pass_line TEXT,
  result TEXT DEFAULT 'pending', note TEXT, created_at TEXT, updated_at TEXT);
-- 目标人生线（一名学生多条线，按 priority 升序展示；
-- line_type: main 主线 / parallel 并行线 / passive 被动等待线；
-- status: active 进行中 / paused 暂停 / done 已完成 / dropped 已放弃）
CREATE TABLE IF NOT EXISTS student_goal_lines(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
  name TEXT, line_type TEXT DEFAULT 'parallel', priority INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active', next_step TEXT, created_at TEXT, updated_at TEXT);
-- 注：既有数据库的 staff 新列（kind/emp_no/platform/job_function/persona/accountable）
-- 与 tasks 新列（type）、leads 评级列（grade/score/grade_reason/graded_at）、
-- content_items 状态列（status）
-- 由 Worker 首次请求时自动 ALTER 补齐，本文件与程序内嵌结构
-- 保持一致，新库直接用本文件即可。
-- 如需在 D1 控制台手动给既有 leads 表补评级列（逐行去掉开头 -- 后一条一条粘贴执行）：
-- ALTER TABLE leads ADD COLUMN grade TEXT;
-- ALTER TABLE leads ADD COLUMN score INTEGER;
-- ALTER TABLE leads ADD COLUMN grade_reason TEXT;
-- ALTER TABLE leads ADD COLUMN graded_at TEXT;
-- 如需手动给既有 content_items 表补状态列（存量行自动填 published）：
-- ALTER TABLE content_items ADD COLUMN status TEXT DEFAULT 'published';
-- v7：既有 students 表补学生端 APP 访问密钥列（Worker 也会自动补，此为手动备选）：
-- ALTER TABLE students ADD COLUMN client_key TEXT;
-- v8：既有 students 表补学生专属名列 + 唯一索引（Worker 也会自动补，此为手动备选）：
-- ALTER TABLE students ADD COLUMN slug TEXT;
-- CREATE UNIQUE INDEX idx_students_slug ON students(slug);
-- v9：既有 students 表补专属签名列（学生在 APP 自选确认一次后固定；改签名走后台）：
-- ALTER TABLE students ADD COLUMN signature TEXT;
-- ALTER TABLE students ADD COLUMN signature_set_at TEXT;
-- v10：既有 students 表补愿景与导师寄语列（Worker 也会自动补，此为手动备选）：
-- ALTER TABLE students ADD COLUMN vision_text TEXT;
-- ALTER TABLE students ADD COLUMN mentor_message TEXT;
-- ALTER TABLE students ADD COLUMN mentor_message_at TEXT;

-- ===== v10 新增表：一对一 APP 九模块（时间线/关键日期/行动清单/知识卡/导师建议/导师沟通）=====
-- 成长时间线（date_text 为自由文本日期，如「2025 秋季」；确切日期未知时不编造）
CREATE TABLE IF NOT EXISTS student_milestones(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  date_text TEXT, title TEXT NOT NULL, detail TEXT, kind TEXT,
  sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
-- 关键日期（date 为 ISO 日期 YYYY-MM-DD，APP 端按本地日期算剩余天数）
CREATE TABLE IF NOT EXISTS student_key_dates(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  date TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT, updated_at TEXT);
-- 行动清单（status: todo 待办 / done 已完成；学生端只读）
CREATE TABLE IF NOT EXISTS student_actions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  title TEXT NOT NULL, detail TEXT, due_text TEXT,
  status TEXT DEFAULT 'todo', sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
-- 全局知识卡（与学生无关；按 tag 匹配学生的人生线类型/主题下发，tag:
-- main / parallel / passive 或主题 exam / business / study；enabled=0 不下发）
CREATE TABLE IF NOT EXISTS knowledge_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT,
  tag TEXT, enabled INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
-- 导师建议（方案正文：诊断结论/考试策略摘要；与行动清单的待办分工不同）
CREATE TABLE IF NOT EXISTS student_advice(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  title TEXT NOT NULL, body TEXT, sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
-- 导师沟通（双向留言；sender: student / mentor；read_by_student/read_by_mentor 为已读标记）
CREATE TABLE IF NOT EXISTS student_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  sender TEXT NOT NULL, body TEXT NOT NULL,
  read_by_student INTEGER DEFAULT 0, read_by_mentor INTEGER DEFAULT 0,
  created_at TEXT);

-- ===== v11 新增表：家长更新（与学生原始数据完全隔离，只存导师为家长整理的内容）=====
-- 设计红线：三表不设 diary / journal / mood / emotion 等学生私密原文列——按机制定版，
-- 学生日记、想法与情绪困惑只保存在学生本机、永不进服务器；家长端只承接经学生确认、
-- 再由导师整理过的解决方案与规划结果。
-- 家长密钥在 students.parent_key（与 client_key 独立，交叉访问一律 404）：
-- ALTER TABLE students ADD COLUMN parent_key TEXT;
-- 家长进展更新（导师录入、家长可见；update_date 为 YYYY-MM-DD 文本）
CREATE TABLE IF NOT EXISTS parent_updates(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  update_date TEXT, title TEXT, body TEXT, current_focus TEXT, next_step TEXT,
  created_at TEXT, updated_at TEXT);
-- 如何托举（需要家庭配合的具体事项；status: active 进行中 / done 已完成 / archived 已归档）
CREATE TABLE IF NOT EXISTS parent_support_actions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  title TEXT, detail TEXT, category TEXT, due_text TEXT,
  status TEXT DEFAULT 'active', sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
-- 家长↔导师留言（与 student_messages 完全独立；sender: parent / mentor）
CREATE TABLE IF NOT EXISTS parent_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  sender TEXT NOT NULL, body TEXT NOT NULL,
  read_by_parent INTEGER DEFAULT 0, read_by_mentor INTEGER DEFAULT 0,
  created_at TEXT);

-- ===== v12 新增：一对一问题方案层 / 导师轨迹 / 课程要求集 =====
-- 问题方案层（学生逐项确认后同步的结构化字段；只存方案摘要，永不存日记/情绪原文）
CREATE TABLE IF NOT EXISTS student_problem_shares(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  domain TEXT, title TEXT, desired_outcome TEXT, strategy_summary TEXT,
  actions_text TEXT, support_needed TEXT, progress TEXT DEFAULT 'open',
  resolved_note TEXT, compliance TEXT DEFAULT 'ok', source_local_id TEXT,
  created_at TEXT, updated_at TEXT);
-- 导师轨迹 / 会议精神（meeting_id 可空；takeaway_local=1 时领受正文只存学生本机，服务器只留占位标记）
CREATE TABLE IF NOT EXISTS mentor_trail_entries(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, meeting_id INTEGER,
  mentor_name TEXT, mentor_role TEXT DEFAULT 'lead', spirit_line TEXT,
  key_judgments TEXT, student_takeaway TEXT, takeaway_local INTEGER DEFAULT 0,
  followup_actions TEXT, revisit_result TEXT, revisit_due TEXT,
  visibility TEXT DEFAULT 'plan', source TEXT DEFAULT 'mentor',
  created_at TEXT, updated_at TEXT);
-- 课程要求集（一名学生可并排多份情景；逐份标来源与版本）
CREATE TABLE IF NOT EXISTS course_requirement_sets(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  name TEXT, source_note TEXT, version_text TEXT, verified INTEGER DEFAULT 0,
  sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
-- 课程要求条目（按块建模；credits 可空=来源未给单门学分；prereq_codes 逗号分隔）
CREATE TABLE IF NOT EXISTS course_requirements(
  id INTEGER PRIMARY KEY AUTOINCREMENT, set_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
  block TEXT DEFAULT 'prereq', course_code TEXT, course_name TEXT,
  credits REAL, min_grade TEXT, prereq_codes TEXT, sort INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT);
-- v15 多导师：学生专题导师指派（主导师走 students.mentor_id 唯一负责；专题导师可多人，
-- (student_id, staff_id) 唯一；运行时由 Worker ensureSchema 幂等建表，本文件仅作结构参考）
CREATE TABLE IF NOT EXISTS student_topic_mentors(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, staff_id INTEGER,
  topic TEXT, created_at TEXT, UNIQUE(student_id, staff_id));
-- v17 导师文件一次性投递（元数据；文件本体在 R2 桶 transferos-files，绑定 FILES；
-- status: pending/downloaded/expired/withdrawn；运行时由 Worker ensureSchema 幂等建表，本文件仅作结构参考）
CREATE TABLE IF NOT EXISTS mentor_files(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER,
  uploader_staff_id INTEGER, r2_key TEXT, filename TEXT, content_type TEXT,
  size INTEGER DEFAULT 0, status TEXT DEFAULT 'pending',
  created_at TEXT, expires_at TEXT, downloaded_at TEXT);

-- 种子数据：4 个种子代理 + 2 个自有渠道（重复执行不会插入第二遍）
INSERT OR IGNORE INTO agents(code, name, region, kind, active, created_at) VALUES
  ('GD001', '广东', '广东', 'agent', 1, datetime('now')),
  ('MO001', '澳门', '澳门', 'agent', 1, datetime('now')),
  ('CD001', '成都', '成都', 'agent', 1, datetime('now')),
  ('AH001', '安徽', '安徽', 'agent', 1, datetime('now')),
  ('WXQ01', '社群', '线上', 'channel', 1, datetime('now')),
  ('VDY01', '自营视频', '线上', 'channel', 1, datetime('now'));

INSERT OR IGNORE INTO settings(key, value) VALUES('announcement', '');
