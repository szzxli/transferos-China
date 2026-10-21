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
  stage_since TEXT, note TEXT, created_at TEXT, updated_at TEXT);

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

-- 种子数据：4 个种子代理 + 2 个自有渠道（重复执行不会插入第二遍）
INSERT OR IGNORE INTO agents(code, name, region, kind, active, created_at) VALUES
  ('GD001', '广东', '广东', 'agent', 1, datetime('now')),
  ('MO001', '澳门', '澳门', 'agent', 1, datetime('now')),
  ('CD001', '成都', '成都', 'agent', 1, datetime('now')),
  ('AH001', '安徽', '安徽', 'agent', 1, datetime('now')),
  ('WXQ01', '社群', '线上', 'channel', 1, datetime('now')),
  ('VDY01', '自营视频', '线上', 'channel', 1, datetime('now'));

INSERT OR IGNORE INTO settings(key, value) VALUES('announcement', '');
