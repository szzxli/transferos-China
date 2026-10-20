# TransferOS 业务管理后台

## 架构（一句话）

一个 Cloudflare Worker（单个 `src/index.js`，无依赖、无构建步骤）+ 一个 Cloudflare D1 数据库（绑定名 `DB`）：Worker 对外提供三个公开 JSON 接口（代理访问计数 `/api/ping`、线索上报 `/api/lead`、问答读取 `/api/faq`），对内在 `/admin/*` 下用服务端渲染的中文页面做后台管理（仪表盘、线索、代理、订单结算、内容）。表结构在 Worker 首次收到请求时自动创建；种子代理数据（GD001 / MO001 / CD001 / AH001 / WXQ01 / VDY01）通过 `schema.sql` 一次性导入。

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

- **仪表盘**：线索总数 / 本月新增 / 各状态分布 / 代理访问量 Top10 / 未结算佣金总额
- **线索**：可按状态和来源码筛选，新增、编辑、删除
- **代理**：每个代理的访问量、线索数、订单数、佣金（已结算 / 未结算）
- **订单**：金额按"元"输入，后台自动存为"分"；佣金比例默认首单 30%、续费单 15%，可手动改，佣金自动算。每月在"月度结算"里按代理看未结算佣金，逐笔点"标记已结算"
- **内容**：问答（FAQ）增删改 + 后台首页公告

## 注意事项

- 后台地址不要对外公开（搜索引擎、代理、家长都不需要知道）
- 公开接口 `/api/lead` 是"活"的，但**网站上的咨询漏斗保持关闭**，不要在网站里接上报代码，直到合规（留学中介资质）有结论
- 金额一律按"分"存数据库，页面上显示为 ¥（带千分位和两位小数）
- 换密码：改 `ADMIN_KEY` 的值并重新部署即可，所有已登录设备会被登出
