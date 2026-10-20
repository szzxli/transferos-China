# TransferOS 业务管理后台

## 架构（一句话）

一个 Cloudflare Worker（单个 `src/index.js`，无依赖、无构建步骤）+ 一个 Cloudflare D1 数据库（绑定名 `DB`）：Worker 对外提供三个公开 JSON 接口（代理访问计数 `/api/ping`、线索上报 `/api/lead`、问答读取 `/api/faq`），对内在 `/admin/*` 下用服务端渲染的中文页面做公司管理中枢（仪表盘、线索、交付进度、用户档案、代理、订单结算、内容评估、内部任务、人员档案）。表结构在 Worker 首次收到请求时自动创建；种子代理数据（GD001 / MO001 / CD001 / AH001 / WXQ01 / VDY01）通过 `schema.sql` 一次性导入。

## 部署步骤（按顺序做）

### 1. 创建 Worker 项目并连接 GitHub

1. 登录 Cloudflare 后台 → 左侧 **Compute** → **Workers & Pages** → **Create**
2. 选 **Connect GitHub**（按提示授权，勾上 `szzxli` 账号的仓库）
3. 选仓库 **`szzxli/transferos-China`**
4. **关键**：在设置里把 **Root directory（根目录）** 设为 **`admin`**（只部署这个子目录，不是整个仓库）
5. 项目名填 `transferos-admin`，构建命令留空，部署命令默认即可 → **Deploy**

### 2. 准备 D1 数据库

1. Cloudflare 后台 → 左侧 **Storage & Databases** → **D1**
2. **Create** 一个数据库，名字填 **`transferos-admin`**
3. 进数据库的 **Console**，把本目录下 `schema.sql` 的全部内容粘贴进去执行一次（建表 + 导入 6 个种子代理/渠道）
4. 回到 `transferos-admin` Worker → **Settings** → **Bindings** → **Add binding** → 选 **D1 database** → 变量名填 **`DB`** → 选 `transferos-admin` 数据库 → 保存

> 备选：如果第 1 步部署时 wrangler 自动建了 D1，可以跳过第 2 步的新建，直接在 Bindings 里绑定已有的库。`wrangler.toml` 里已写好绑定名 `DB` 和库名；只有当部署报错找不到库时，才需要把数据库 ID 粘进 `wrangler.toml`（文件里有注释说明位置）。

### 3. 设置登录密码

1. `transferos-admin` Worker → **Settings** → **Variables and Secrets**
2. **Add** 一条 Secret：变量名 **`ADMIN_KEY`**，值就是你自己定的后台登录密码（比如一串字母数字，越长越好）
3. 再 **Add** 一条 Secret：变量名 **`LEAD_API_TOKEN`**，值是另一串随机字符（线索管家 bot 专用，只读接口凭证，跟登录密码不要用同一串；设好后把这串发给 Noor 配置提醒）
3. 保存后去 **Deployments** 点 **Redeploy**（或等下一次自动部署）让密码生效

### 4. 打开后台

访问 `https://transferos-admin.<你的账号>.workers.dev/admin/login`，输入第 3 步设的密码登录。

登录后 cookie 有效期 7 天。**如果忘记设 ADMIN_KEY，打开 /admin 会直接提示"尚未配置"，不会放行任何人。**

## 绑定 admin.zhuanuc.com（等 zhuanuc.com 域名解析生效后再做）

1. **前置**：把 `zhuanuc.com` 的 DNS 托管从阿里云万网转到 Cloudflare：
   - 在 Cloudflare 后台 **DNS** 里先把现有记录照搬建好：`@` 的 CNAME → `szzxli.github.io`、两条 MX（`mxbiz1.qq.com` 优先级 5、`mxbiz2.qq.com` 优先级 10）、SPF 的 TXT（`v=spf1 include:spf.mail.qq.com ~all`）、`mail` 的 CNAME → `mail.qq.com`
   - 建好后再去万网把域名的 NS 改成 Cloudflare 分配的地址（改 NS 前确认 Cloudflare 里的记录已齐全，否则网站和邮箱会中断）
2. 进 `transferos-admin` Worker → **Settings** → **Domains & Routes** → **Add Custom Domain**
3. 输入 **`admin.zhuanuc.com`** → 添加
4. 等 Cloudflare 自动签发证书（一般几分钟），之后用 **https://admin.zhuanuc.com/admin/login** 登录

> 说明：公开接口 `/api/*` 的跨域白名单里已经包含 `https://admin.zhuanuc.com`，以后网站从这个子域名调用接口也直接可用。

## 日常使用

- **仪表盘**：线索总数 / 本月新增 / 学生总数 / 交付中 / 交付逾期 / 本月内容线索 / 逾期任务 / 未结算佣金；线索按状态分布；任务提醒；访问统计（近 30 天按日、按页面 Top、按来源 Top，无数据时显示空状态，网站接通上报后自动汇总）；内部邮件管理入口（跳转腾讯企业邮箱管理后台，账号在腾讯侧管理）
- **线索**：可按状态和来源码筛选，新增、编辑、删除；每条线索有"档案"入口
- **用户档案**（从线索或交付页进入）：同一人的线索信息、来源代理、全部订单、交付阶段汇总在一页
- **交付**：学生档案 + 9 个固定交付阶段（评估诊断 → 入学申请 → 课程规划 → 学期陪伴 → 转学申请 → 签证辅导 → 录取 → 续费 → 转介绍）；阶段看板按阶段计数；用列表里的"推进"改阶段（自动记录阶段开始时间）；进行中阶段停留超过 30 天标红逾期；已成交订单可在"待生成学生的订单"里一键生成学生档案
- **代理**：每个代理的访问量、线索数、订单数、佣金（已结算 / 未结算）
- **订单**：金额按"元"输入，后台自动存为"分"；佣金比例默认首单 30%、续费单 15%，可手动改，佣金自动算。每月在"月度结算"里按代理看未结算佣金，逐笔点"标记已结算"
- **内容**：两个标签——「问答库」问答（FAQ）增删改 + 后台首页公告；「内容评估」内容条目（标题/平台/发布日期/归因码/类型）+ 按天手动录入指标（播放阅读 / 咨询 / 线索），自动按条目汇总并算线索转化率
- **任务**：内部任务清单（标题、负责人、截止日期、状态），逾期自动标红，仪表盘显示逾期/今日到期提醒；负责人可从在职员工（含 AI 员工）下拉选择，也可手填
- **人员**（v3 升级）：真人 + AI 员工统一档案（类型、工号自动生成 BOT-<职能码>-序号 / EMP-序号、所属体系、职能、状态：试用/在职/停用待查/已离职或辞退），支持按类型/状态/体系筛选与姓名/工号搜索；每名员工有考核记录（入职测评/日常考核/年检）；**回避规则**：AI 员工的入职测评必须填写主考体系且不得与员工所属体系相同，系统会拦截。不含考勤薪酬

## 注意事项

- 后台地址不要对外公开（搜索引擎、代理、家长都不需要知道）
- 公开接口 `/api/lead` 是"活"的，但**网站上的咨询漏斗保持关闭**，不要在网站里接上报代码，直到合规（留学中介资质）有结论
- 金额一律按"分"存数据库，页面上显示为 ¥（带千分位和两位小数）
- 换密码：改 `ADMIN_KEY` 的值并重新部署即可，所有已登录设备会被登出

---
2026-10-20：已部署上线（Cloudflare Workers 项目 transferos-admin，D1 已建表，密钥已设置）。
