"use strict";
/* 一对一专属客户端（学生端）
 * 数据来自管理后台只读接口 GET /api/client/<学生id 或 slug>?key=<访问密钥>；
 * 写操作只有两个：POST /api/client/signature（签名一次性确认）、POST /api/client/message（导师沟通留言）。
 * 入口：专属链接 ?s=<学生id 或专属名 slug>&k=<密钥>（可加 &api=<接口域名> 覆盖默认接口）；
 * 无参数时显示门页，输入一次后存 localStorage。
 * 展示结构（v10）：底部四页签——首页 / 成长 / 规划 / 导师，纯前端切换；
 * 首屏只渲染首页，其余页签数据在同一份 JSON 内、首次切换时才渲染。
 * 双语（v10）：界面文字走内置 I18N 字典（zh/en），右上角切换、存 localStorage；
 * 数据内容（导师/学生录入的正文、课程名等）不翻译、原文呈现。 */
const DEFAULT_API_BASE = "https://transferos-admin.szzxli711.workers.dev";
const LS_S = "ooo_student_id", LS_K = "ooo_client_key", LS_A = "ooo_api_base", LS_LANG = "ooo_lang";
const KIND_LABELS = { prereq: "必修先修", gened: "通识", elective: "选修" };
const KIND_LABELS_EN = { prereq: "Prerequisites", gened: "General Ed", elective: "Electives" };

/* —— i18n 字典：只收界面文字；数据内容永不进字典 —— */
const I18N = {
  zh: {
    appTitle: "一对一专属客户端",
    "gate.title": "打开我的专属客户端",
    "gate.desc": "输入导师发给你的专属名（或学生编号）与访问密钥。输入一次后，本设备会自动记住。",
    "gate.labelS": "专属名 / 学生编号", "gate.labelK": "访问密钥",
    "gate.phS": "如 stu-01 或 12", "gate.phK": "如 ck_…",
    "gate.enter": "进入",
    "gate.hint": "小提示：进入后用浏览器菜单把本页「添加到主屏幕」，桌面上出现的就是你的专属APP，点图标即可打开。",
    "gate.errBoth": "编号与密钥都要填。",
    "state.loading": "正在加载…", "state.retry": "重试",
    "state.netErr": "网络不通，没能连上服务器。请检查网络后重试。",
    "state.notFound": "没找到这份客户端：专属名 / 编号或访问密钥不正确，或链接已更新。请核对导师发的最新链接。",
    "state.reenter": "重新输入编号与密钥",
    "state.gateAsk": "请输入导师发给你的专属名（或编号）与访问密钥。",
    "state.serverBusy": "服务器暂时忙（{status}），请稍后重试。",
    "state.badData": "数据格式异常，请稍后重试。",
    "tab.home": "首页", "tab.growth": "成长", "tab.plan": "规划", "tab.mentor": "导师",
    "hero.stage": "当前阶段：", "hero.mainLine": "当前主线",
    "hero.next": "下一步：{x}",
    "hero.exclusive": "本应用为 {name} 专属开发 · 一对一规划服务",
    "hero.exclusiveAnon": "本应用为你专属开发 · 一对一规划服务",
    "app.personalTitle": "{name} 的专属APP", "app.defaultTitle": "我的专属APP",
    "card.mentor": "导师寄语", "card.daily": "每日一句", "card.countdown": "关键日期",
    "card.actions": "行动清单", "card.timeline": "成长时间线", "card.status": "当前状态",
    "card.coursesDone": "选课 · 已修与在修", "card.exams": "考试记录", "card.meetings": "辅导会议",
    "card.lines": "人生线", "card.vision": "愿景板", "card.goalDetail": "学业目标",
    "card.courses": "选课规划", "card.advice": "导师建议", "card.knowledge": "知识卡",
    "card.messages": "导师沟通",
    "sign.prompt": "选一句做你的专属签名——签下后将固定在你的 APP 里，每天陪你打开它。",
    "sign.confirm": "就它了，固定下来", "sign.saving": "正在固定…",
    "sign.err": "没签上，网络或服务器有点问题，请再试一次。",
    "cd.left": "还有 {n} 天", "cd.today": "就是今天", "cd.overdue": "已到期",
    "actions.progress": "已完成 {x} / 共 {y}",
    "status.latestGpa": "最新 GPA", "status.credits": "已修学分 / 总要求",
    "status.empty": "暂无状态快照。", "status.history": "历史快照",
    "status.gpaWord": "GPA", "status.creditsWord": "学分",
    "status.curve": "进步曲线", "status.ring": "学分完成度",
    "status.single": "目前只有一条状态快照——等积累到两条以上，这里会画出你的进步曲线。",
    "cdone.summary": "已完成 {a} 门 · 在修/已选 {b} 门",
    "cdone.empty": "暂无已修或在修课程。",
    "exams.score": "分数 {x}", "exams.line": "达标线 {x}", "exams.empty": "暂无考试记录。",
    "meetings.next": "下次会议：{x}", "meetings.empty": "暂无会议记录。",
    "lines.next": "下一步：{x}", "lines.empty": "目标线尚未记录，请联系导师确认。",
    "goal.fSchool": "目标学校 / 项目", "goal.fTerm": "目标入学季", "goal.fGpa": "目标 GPA",
    "courses.summary": "已完成学分 {a} / 规划总学分 {b} · 先修课已完成 {c}/{d} 门",
    "courses.kind": "已完成 {a}/{b} 门 · 学分 {c}/{d}",
    "courses.termMeta": "{a} 门 · {b} 学分", "courses.unit": " 学分",
    "courses.empty": "暂无选课记录。",
    "msg.label": "给导师留言", "msg.ph": "写下你想对导师说的话…", "msg.send": "发送",
    "msg.sending": "发送中…", "msg.emptyThread": "有问题随时在这里留言，导师会回复",
    "msg.you": "我", "msg.mentor": "导师",
    "msg.errEmpty": "先写点内容再发送。", "msg.errTooLong": "留言最多 500 字。",
    "msg.errNet": "没发出去，网络或服务器有点问题，请再试一次。",
    "msg.errGone": "链接已失效，请联系导师获取最新链接。",
    "msg.errFreq": "发送太频繁了，请过一分钟再试。",
    "page.empty": "这一页暂时还没有内容，导师会陆续为你更新。",
    "foot.line1": "把本页「添加到主屏幕」后即为你的专属APP，点桌面图标即可随时打开。",
    "foot.line2": "数据由导师维护更新；有问题可以在「导师」页留言。",
    "foot.forget": "清除本设备记住的编号与密钥",
    /* ===== v12 界面键 ===== */
    "card.dream": "与梦想的距离", "card.today": "今日状态", "card.obstacles": "当前障碍",
    "card.private": "私密空间", "card.feed": "我的动态", "card.trail": "导师轨迹",
    "card.problems": "问题解决中心", "card.match": "课程匹配",
    "sheet.back": "返回",
    "view.private": "私密空间", "view.problems": "问题解决中心", "view.trail": "导师轨迹",
    "view.match": "课程匹配", "view.share": "分享卡",
    "dream.endpoint": "终点", "dream.crossed": "已跨过", "dream.now": "正在走",
    "dream.left": "还差几步", "dream.win": "最近一步小胜利",
    "dream.noVision": "你的终点还没写下来——导师会在规划里和你一起定。",
    "dream.noSteps": "第一步还没定，导师会在规划里和你一起拆。",
    "dream.allDone": "这一程的里程碑都走完了，和导师一起定下一程。",
    "dream.creditsFact": "学分还差 {x}（已修 {a} / 共 {b}）",
    "dream.examFact": "考试还有 {n} 项待处理",
    "dream.probFact": "未解决的问题 {n} 个（见当前障碍）",
    "dream.moreSteps": "等 {n} 项",
    "today.q": "今天感觉怎么样？只存在这台设备上。",
    "today.ph": "今天推进了什么（一句话，可空）",
    "today.save": "记录今天", "today.saved": "已记录", "today.streak": "连续第 {n} 天记录自己",
    "today.m1": "很低落", "today.m2": "有点低", "today.m3": "一般", "today.m4": "不错", "today.m5": "很好",
    "obstacles.none": "目前没有未解决的问题。遇到卡点，去问题解决中心拆一拆。",
    "private.entryDesc": "日记、想法和情绪困惑只存在这台设备上，只有你能看到，平台不留存。",
    "private.enter": "进入私密空间",
    "feed.empty": "还没有动态。完成一个行动、跨过一个里程碑，这里就会留下你的脚印。",
    "feed.tAction": "完成了一步", "feed.tMilestone": "跨过一步", "feed.tProblem": "解决了一个问题",
    "feed.tTrail": "{name} 给了你一句", "feed.tStreak": "连续第 {n} 天记录自己",
    "feed.share": "分享", "feed.hide": "删除",
    "trail.enter": "查看导师轨迹", "trail.empty": "还没有导师轨迹。每次和导师聊完，这里会留下他/她最核心的一句和你的领受。",
    "trail.due": "待回看 {n} 条", "trail.latest": "最新一句",
    "trail.filterAll": "全部导师", "trail.takeaway": "我的领受", "trail.takeawayLocal": "这条领受只存本机",
    "trail.localMark": "已在本机记录（内容只在这台设备上）",
    "trail.revisit": "回看结果", "trail.revisitDue": "待回看", "trail.save": "保存",
    "trail.saved": "已保存", "trail.createTitle": "补记一位导师",
    "trail.fName": "导师姓名", "trail.fRole": "导师身份", "trail.fSpirit": "一句话精神",
    "trail.fJudgments": "关键判断（每行一条）", "trail.fFollow": "会后行动（每行一条）",
    "trail.createBtn": "记入轨迹", "trail.phSpirit": "这次交流最核心的一句（60 字内）",
    "trail.role.lead": "主导师", "trail.role.teacher": "任课老师", "trail.role.industry": "行业前辈",
    "trail.role.coach": "教练", "trail.role.elder": "长辈", "trail.role.other": "其他",
    "problems.desc": "把卡住的事拆成能推进的方案——拆解全在本地完成，同步给导师由你逐项确认。",
    "problems.open": "进入问题解决中心", "problems.openCount": "未关闭的问题 {n} 个",
    "match.open": "查看匹配结果", "match.disclaimer": "以学校官方学位审计为准",
    "match.empty": "还没有课程要求集，导师录入后这里会逐块算匹配。",
    "match.missingFact": "还缺 {n} 门",
    "match.verified": "已按官方核实", "match.unverified": "未核实 · 规划参考",
    "match.source": "来源：", "match.version": "版本：",
    "match.noReq": "这份情景的官方要求还没有核实录入，目前只建框架，不编造课程要求。",
    "match.blockLine": "已满足 {a} / {b} 门 · 在修 {c} · 计划 {d} · 缺 {e} 门",
    "match.creditsLine": "学分：已修 {a} / 已知总 {b} · 还缺 {c}",
    "match.creditsUnknown": "另有 {n} 条要求未列单门学分，未计入",
    "match.missingTitle": "还缺的课", "match.warnTitle": "成绩预警", "match.breakTitle": "先修断裂",
    "match.belowMin": "{code} 成绩 {g}，低于该要求标注的最低成绩 {m}",
    "match.watch": "{code} 成绩 {g}——通用提示：不少护理项目要求先修课 B 或以上，此为通用提示、非官方线，待官方核实",
    "match.break": "{code} 的先修 {p} 还没有已修 / 在修课程承接",
    "match.none": "无",
    "share.warnPrivate": "这条原本只有你能看到，分享后就是公开的。",
    "share.textLabel": "分享文案（可改）", "share.checkTitle": "导出前请逐项确认",
    "share.c1": "不含真实姓名", "share.c2": "不含学校名称", "share.c3": "不含成绩 / 分数", "share.c4": "不含身份信息",
    "share.img": "导出图片", "share.text": "复制文案", "share.copied": "已复制，去粘贴发布吧。",
    "share.imgDone": "图片已生成（长按或右键保存），由你自己发布。",
    "share.need": "先完成四项隐私确认，才能导出。",
    "share.selfPost": "图片和文案都只生成在你的设备上；发布请你自己打开 X 等平台手动发，APP 不代发、不索取社交账号。",
    "voice.btn": "语音输入", "voice.stop": "结束",
    "voice.note": "语音识别由浏览器厂商的云端处理，音频会离开这台设备。识别结果会先填入输入框，你可以改字再保存。",
    "voice.notePrivate": "这里是私密内容。语音识别由浏览器厂商云端处理（音频离开设备），与私密空间「不出设备」的原则冲突，所以默认关闭；确认要用再开启，识别完请检查改字。",
    "voice.enable": "开启并使用语音", "voice.off": "关闭语音",
    "voice.unsupported": "这个浏览器不支持语音识别，请用键盘输入。",
    "voice.listening": "正在聆听…说完点「结束」。",
    "voice.denied": "麦克风权限被拒绝：请在浏览器设置里允许麦克风后重试；也可以直接打字。",
    /* —— 私密空间（private.js 用）—— */
    "priv.title": "只有你能看到的空间",
    "priv.only": "这里的日记、想法和情绪困惑只保存在这台设备的浏览器里，不上传、不进服务器，导师和家长都看不到。",
    "priv.lost": "清浏览器数据、换手机、卸载浏览器都会丢——请定期用下方按钮导出备份到你自己的设备。",
    "priv.noRecover": "平台无法帮你找回，因为我们从未持有这些内容——这句话本身就是承诺。",
    "priv.write": "写一条", "priv.ph": "想到什么就写什么，只有你自己看得到…",
    "priv.ty.diary": "日记", "priv.ty.note": "随记", "priv.ty.mood": "今日状态", "priv.ty.problem_draft": "问题草稿",
    "priv.save": "存到本机", "priv.savedLocal": "已存到本机。", "priv.needBody": "先写点内容再保存。",
    "priv.offline": "全部保存在本机，断网也能写、能看。",
    "priv.list": "我的记录", "priv.all": "全部", "priv.empty": "还没有记录，从上面写第一条开始。",
    "priv.del": "删除", "priv.delConfirm": "确定删除这条？只删本机这一条，删了就没了。",
    "priv.shareLine": "分享这句", "priv.toProblem": "去拆解这个问题",
    "priv.expMd": "导出 Markdown", "priv.expJson": "导出 JSON 备份", "priv.import": "导入备份",
    "priv.exported": "已导出到你的设备。", "priv.imported": "导入完成：", "priv.importBad": "这个文件不是有效的备份文件。",
    "priv.clear": "清空全部私密数据",
    "priv.clearConfirm1": "这会删掉本机全部私密记录（日记 / 随记 / 状态 / 草稿），不可恢复。确定？",
    "priv.clearConfirm2": "再确认一次：真的全部清空？建议先导出备份。",
    "priv.cleared": "已清空本机全部私密记录。",
    "priv.backupTip": "你已经积累了不少未备份的记录，建议现在导出一份到自己的设备保存。",
    "priv.tagSugg": "建议标签：",
    /* —— 情绪关怀页（第七节口径；资源号码上线前须按官方渠道复核当期有效性）—— */
    "care.title": "先停一下",
    "care.lead": "看到你写下这些——这不是你一个人要扛的事。先缓一缓，需要时请用下面的专业资源。",
    "care.us": "美国：拨打或短信 988（Suicide and Crisis Lifeline，24 小时）",
    "care.textline": "美国：短信 HOME 发送到 741741（Crisis Text Line）",
    "care.school": "学校心理咨询中心：在学校官网搜索 Counseling Center，可预约学生咨询",
    "care.cn": "中国：全国心理援助热线 12356（请以当期官方公布为准）",
    "care.note": "以上为公开资源口径，号码时效以官方当期公布为准。本 APP 提供规划支持与陪伴，不是心理治疗或危机干预服务。",
    "care.toMentor": "去导师页留言（由你决定是否发出）",
    /* —— 问题解决中心（problems.js 用）—— */
    "pb.title": "拆一个问题",
    "pb.localNote": "拆解和方案都在这台设备上完成，不上传。自由文本（发生了什么 / 我试过什么 / 卡在哪）只留在本机，永不进入同步内容。",
    "pb.fDomain": "问题领域", "pb.fLine": "影响哪条人生线", "pb.lineNone": "不关联",
    "pb.fBottleneck": "卡在哪", "pb.fWhat": "发生了什么", "pb.fTried": "我试过什么", "pb.fStuck": "一句话说卡点",
    "pb.localOnlyPh": "只存本机，不同步", "pb.syncablePh": "会出现在同步清单里，确认后才发",
    "pb.fImpact": "影响（1–5）", "pb.fUrgency": "紧迫度（1–5）", "pb.fResources": "现有资源",
    "pb.res.time": "时间", "pb.res.money": "钱", "pb.res.school": "校内资源", "pb.res.mentor": "导师",
    "pb.res.family": "家长支持", "pb.res.peers": "同学同行", "pb.res.none": "暂无资源",
    "pb.fDesired": "期望结果（解决成什么样算好）", "pb.fSupport": "需要什么帮助",
    "pb.saveDraft": "存为草稿（本机）", "pb.draftSaved": "草稿已存到本机私密空间。",
    "pb.needSomething": "先写一点内容再存草稿。", "pb.generate": "生成方案",
    "pb.resultTitle": "本地引擎给你的方案", "pb.mine": "我的问题", "pb.mineEmpty": "还没有同步过的问题。拆解过的方案经你确认后会出现在这里。",
    "pb.outBreakdown": "① 问题拆解", "pb.outCauses": "② 可能原因", "pb.outToday": "③ 今日可做的一步（止损）",
    "pb.outPlan": "④ 7 天集中方案", "pb.outKnow": "⑤ 相关知识卡", "pb.outHelp": "⑥ 求助对象（按顺序）",
    "pb.outEscalate": "⑦ 是否同步导师",
    "pb.impactWord": "影响", "pb.urgencyWord": "紧迫度", "pb.criterion": "完成判据",
    "pb.level.high": "优先级高：先处理这件", "pb.level.mid": "优先级中：排进本周", "pb.level.low": "优先级低：先记下，别让它占脑子",
    "pb.knowWhy": "为什么给你这张：与你这次的卡点领域相关",
    "pb.escYes": "建议同步导师，命中了下面的条件：",
    "pb.escNo": "这次可以先自己推进；执行两天没进展，再同步导师。",
    "pb.escHigh": "影响与紧迫度都高（≥4）", "pb.escRules": "涉及官方规则 / 资格不确定",
    "pb.escCompliance": "涉及合规事项（已标待核实）", "pb.escEmotion": "文字里出现了需要关怀的状态（见私密空间关怀页）",
    "pb.todayWord": "今日一步", "pb.planWord": "7 天方案",
    "pb.syncTitle": "同步给导师（逐项确认）",
    "pb.syncNote": "只同步你勾选的项。标题若不勾选，将只用领域与卡点名称占位；自由文本永远不进入同步。",
    "pb.syncF.title": "问题标题", "pb.syncF.desired": "期望结果", "pb.syncF.strategy": "策略摘要（今日一步 + 7 天方案）",
    "pb.syncF.actions": "行动项（7 天方案拆条）", "pb.syncF.support": "需要的帮助",
    "pb.syncBtn": "确认同步", "pb.syncNone": "至少勾选一项再同步。",
    "pb.syncDone": "已同步到方案层，导师能看到了。", "pb.syncFail": "没同步上，网络或服务器有点问题，请再试一次。",
    "pb.escBtn": "把摘要发给导师", "pb.escConfirm": "下面这段会以你的名义发到导师留言，确认发送？",
    "pb.escDone": "已发给导师。", "pb.escMsgHead": "【问题升级】我用问题解决中心拆了一个问题，摘要如下：",
    "pb.reviewBanner": "待核实：这个问题涉及合规事项（经营 / 食品 / 就业 / 税务 / 身份等）。方案只能先标「待核实」，须转有资质律师 / 会计师 / 主管部门确认后才能执行，导师和引擎都不能自行判为可执行。",
    "pb.reviewTag": "待核实", "pb.markResolved": "标为已解决", "pb.resolveNotePh": "解决小结（可空）：怎么解决的？",
    "pb.dom.study": "学业", "pb.dom.exam": "考试", "pb.dom.business": "创业", "pb.dom.career": "职业与并行线",
    "pb.dom.family": "家庭沟通", "pb.dom.emotion": "情绪状态", "pb.dom.other": "其他",
    "pb.bn.study.behind": "进度落后，赶不上计划", "pb.bn.study.hard": "内容太难，学不会",
    "pb.bn.study.prereq": "先修没过 / 缺课", "pb.bn.study.plan": "不知道怎么排课 / 规划",
    "pb.bn.exam.rules": "不知道考试规则 / 要求", "pb.bn.exam.pace": "备考没节奏",
    "pb.bn.exam.gap": "成绩差距大", "pb.bn.exam.retries": "次数 / 资格焦虑", "pb.bn.exam.info": "缺考试信息（名称 / 分数 / 达标线）",
    "pb.bn.business.compliance": "合规 / 许可不懂", "pb.bn.business.funds": "没启动资金",
    "pb.bn.business.time": "时间冲突", "pb.bn.business.product": "产品 / 配方没定", "pb.bn.business.channel": "不知道怎么卖 / 获客",
    "pb.bn.career.wait": "等外部结果（申请 / 审核）", "pb.bn.career.choice": "几条线不知道怎么排优先级", "pb.bn.career.qual": "资格 / 条件不确定",
    "pb.bn.family.talk": "和父母沟通对立", "pb.bn.family.expect": "父母期待和我的计划不一致", "pb.bn.family.support": "需要家里支持但不知怎么开口",
    "pb.bn.emotion.low": "状态低落，做不动事", "pb.bn.emotion.anxious": "焦虑，静不下心", "pb.bn.emotion.alone": "孤独，没人可说",
    "pb.bn.other.stuck": "就是卡住了，说不清", "pb.bn.other.multi": "几件事撞在一起",
    /* —— 策略库（problems.js LIB 引用；方案条目格式：动作｜完成判据）—— */
    "h.self.site": "先自助：查学校 / 项目官网原文", "h.mentor": "导师", "h.school.office": "学校项目办公室 / 招生办",
    "h.self.plan": "先自助：把计划拆到天", "h.self.review": "先自助：复盘错题与失分点", "h.school.advisor": "学校学术顾问（Advisor）",
    "h.school.tutor": "学校辅导中心 / 课程助教", "h.pro.legal": "有资质的专业人士（律师 / 会计师 / 主管部门）",
    "h.self.test": "先自助：小成本试一版", "h.mentor.translate": "导师（可帮你把方案转译给家长）",
    "h.family.calm": "挑一个平静的时间和家里谈", "h.self.small": "先自助：只做一个最小动作", "h.school.counsel": "学校心理咨询中心",
    "c.generic.1": "信息不完整：关键事实还没确认，先猜只会更乱。", "c.generic.2": "几件事挤在一起，没有排出先后。",
    "today.generic": "先把这件事写成一句话问题，放到问题解决中心里，别让它在脑子里转。",
    "p.generic.1": "写清问题一句话版｜纸上有明确一句，不再是模糊的一团",
    "p.generic.2": "列出已知事实与待确认事实两列｜两列都写完",
    "p.generic.3": "约导师或相关人确认最关键的一条｜已发出预约 / 留言",
    "c.exam.rules.1": "规则只听人转述过，没看过官方原文，转述最容易漏掉资格与次数限制。",
    "c.exam.rules.2": "考试信息散在几处（官网、手册、邮件），没有汇成一张清单。",
    "today.exam.rules": "今天先别刷题：打开项目官网，把考试要求页完整读一遍并存下来。",
    "p.exam.rules.1": "读完官网考试要求页并截图存档｜要求页已保存",
    "p.exam.rules.2": "把规则汇成清单：名称 / 达标线 / 次数上限 / 间隔 / 截止日｜清单五项都有出处",
    "p.exam.rules.3": "清单里拿不准的逐条标出，发导师确认｜疑问清单已发出",
    "c.exam.info.1": "考试名称、历次分数、达标线没有集中记录，凭记忆判断容易错。",
    "c.exam.info.2": "缺了这些数字，就没法判断差距有多大、下一步值不值得投入。",
    "today.exam.info": "今天先把已知的考试信息（名称、每次日期与分数）全部写进 APP 的一条记录里，缺的标「待补」。",
    "p.exam.info.1": "汇总历次考试记录成一张表｜表里每次日期 / 分数齐全或标待补",
    "p.exam.info.2": "向学校或导师索取达标线与重考规则原文｜已发出索取并留痕",
    "p.exam.info.3": "把表同步给导师，请导师补齐缺项｜导师已确认收到",
    "c.exam.retries.1": "重考次数上限和间隔是官方硬规则，超限的努力会白费，所以先确认再投入。",
    "c.exam.retries.2": "焦虑来自不确定：不知道还有没有资格，比结果本身更耗人。",
    "today.exam.retries": "今天只做一件事：确认官方重考上限与自己已用次数，写下来。",
    "p.exam.retries.1": "查到官方重考规则原文｜规则出处已存档",
    "p.exam.retries.2": "算清剩余次数与最近可考日期｜两个数字都写明",
    "p.exam.retries.3": "据此和导师定：再考 / 换路线 / 并行备选｜结论写成一句话并同步导师",
    "c.exam.pace.1": "没有按周拆的复习节奏，每天学什么全靠临时决定。",
    "c.exam.pace.2": "只刷题不复盘，同类错误会重复出现。",
    "today.exam.pace": "今天先定出本周的复习表：每天一个主题、一个时段，写进日历。",
    "p.exam.pace.1": "排出 7 天复习表并贴到日历｜表已建，每天有主题",
    "p.exam.pace.2": "做一次限时模拟并记录分数｜模拟分数已记录",
    "p.exam.pace.3": "按模拟失分点调整下周表｜调整点写明至少 2 条",
    "c.exam.gap.1": "差距要先定位：是知识点缺口，还是题型与速度问题，解法完全不同。",
    "c.exam.gap.2": "只看总分会掩盖结构：可能只差在 1–2 个板块。",
    "today.exam.gap": "今天拿最近一次成绩或模拟，按板块拆出失分最多的两块。",
    "p.exam.gap.1": "完成失分板块拆解｜最弱两块已定位",
    "p.exam.gap.2": "针对最弱一块做 3 次专题练习｜练习记录齐全",
    "p.exam.gap.3": "再做一次同板块限时测｜分数与上次可对比",
    "c.study.prereq.1": "先修链断了：后面的课要么选不上，要么选上也跟不上。",
    "c.study.prereq.2": "缺课信息不全：不知道到底缺哪几门、各占多少学分。",
    "today.study.prereq": "今天先在课程匹配里看清缺课清单，挑出最靠前的一门断裂先修。",
    "p.study.prereq.1": "列出全部缺课与学分｜清单与匹配引擎结果一致",
    "p.study.prereq.2": "确认最优先一门的开课学期与选课时间｜时间已写进日历",
    "p.study.prereq.3": "和导师确认补课顺序｜顺序结论已同步",
    "c.study.behind.1": "落后通常是几周小欠账滚成的，先定位欠的是哪几块。",
    "c.study.behind.2": "想一次补完会崩盘：要按考试权重排先后。",
    "today.study.behind": "今天先列出落后清单，按「考试权重 × 难度」排前 3。",
    "p.study.behind.1": "落后清单排序完成｜前 3 项明确",
    "p.study.behind.2": "每天补 1 个小块并打勾｜连续 3 天有记录",
    "p.study.behind.3": "做一次小测验证补的效果｜小测分数已记录",
    "c.study.hard.1": "难点往往集中在少数概念，先定位是哪几个。",
    "c.study.hard.2": "只看书记不住：需要例题和讲解换着来。",
    "today.study.hard": "今天把最难的一个概念写成「我卡在哪一句」，带着它去找资源。",
    "p.study.hard.1": "定位最难的 2 个概念｜写成具体问题句",
    "p.study.hard.2": "各找一份讲解 + 做 5 道例题｜例题对错已记录",
    "p.study.hard.3": "用自己的话复述概念并写下来｜复述稿完成",
    "c.study.plan.1": "排课没对着要求集算过，容易多修或漏修。",
    "c.study.plan.2": "目标没定版时更要并排算几个情景，别把单一路线当定局。",
    "today.study.plan": "今天先打开课程匹配，看每个情景还缺什么，再决定下学期选什么。",
    "p.study.plan.1": "看完各情景缺课清单｜每个情景缺课数清楚",
    "p.study.plan.2": "排出下学期拟选课表｜课表与缺课清单对应",
    "p.study.plan.3": "课表发导师确认先修顺序｜导师已回复",
    "c.biz.comp.1": "经营、食品、就业这类事项有许可与身份边界，不懂规则先动手最危险。",
    "c.biz.comp.2": "规则分散在联邦 / 州 / 平台几层，只看一层会漏。",
    "today.biz.comp": "今天先停掉任何对外销售动作，把不确定的合规问题逐条写下来——在确认前只做不涉外的准备（如配方、成本表）。",
    "p.biz.comp.1": "列出合规问题清单：许可 / 标签 / 身份与工作许可 / 税务｜清单成文",
    "p.biz.comp.2": "逐条查官方来源并标注出处｜每条有官方链接或条文",
    "p.biz.comp.3": "拿不准的条目打包发导师，约一次专题会过合规｜已发出并约好时间",
    "c.biz.time.1": "主线和副线抢同一段时间，没有给副线设上限。",
    "c.biz.time.2": "备考 / 课业的关键期被挤占，后面要用更大代价补。",
    "today.biz.time": "今天给创业定一个每周小时上限，写进日历并同步导师。",
    "p.biz.time.1": "写定每周副线上限小时数｜上限已进日历",
    "p.biz.time.2": "砍掉一个最低价值的副线事项｜砍掉项已明确停掉",
    "p.biz.time.3": "一周后复盘实际用时｜实际 vs 上限已对比",
    "c.biz.funds.1": "还没算清最小启动成本，就容易被大数字吓住或盲目投入。",
    "c.biz.funds.2": "可以先用小批量验证，不必一次备齐全量资金。",
    "today.biz.funds": "今天先做一版最小启动成本表：只列第一批必须花的钱。",
    "p.biz.funds.1": "最小启动成本表完成｜总额是一个确定数字",
    "p.biz.funds.2": "列出可延后 / 可省的支出｜至少砍掉 2 项",
    "p.biz.funds.3": "定一个验证版预算上限并同步导师｜上限数字已确认",
    "c.biz.product.1": "配方 / 产品没定版，后面的包装、成本、定价都定不下来。",
    "c.biz.product.2": "只在脑子里想口味，要落到可复现的配比与成本。",
    "today.biz.product": "今天先定一个目标售价和一份首版配比，写成文档。",
    "p.biz.product.1": "首版配比文档完成｜配比可复现",
    "p.biz.product.2": "按配比算单份成本｜成本数字已算出",
    "p.biz.product.3": "找 3 个人试吃并记录反馈｜反馈已记录",
    "c.biz.channel.1": "渠道没验证前，先解决「谁会买、为什么买」再谈铺开。",
    "c.biz.channel.2": "平台规则（费率、保险、类目）没摸清就上架容易踩坑。",
    "today.biz.channel": "今天先选定一个主渠道，把它的入驻规则读完并列出待办。",
    "p.biz.channel.1": "主渠道规则清单完成｜费率 / 要求都写明",
    "p.biz.channel.2": "准备好上架素材清单｜素材逐项可勾选",
    "p.biz.channel.3": "小批量上架或预售验证｜有第一笔真实反馈 / 订单",
    "c.career.wait.1": "等待期最怕干等：结果没来之前，能推进的是别的线。",
    "c.career.wait.2": "没有确认时间表时，焦虑会把等待无限放大。",
    "today.career.wait": "今天先把等待事项的状态与预计节点写清，再挑一条能动的线推进一小步。",
    "p.career.wait.1": "等待事项节点表完成｜每个节点有预计时间或确认方式",
    "p.career.wait.2": "并行线推进一小步｜有具体产出",
    "p.career.wait.3": "到节点日检查一次状态｜检查已记录",
    "c.career.choice.1": "几条线都重要时，要按「哪条线决定其他线」排，而不是平均用力。",
    "c.career.choice.2": "优先级没写下来，每天的安排就会被临时的事推着走。",
    "today.career.choice": "今天把几条线按当前优先级写成一张表，第一名只放一条。",
    "p.career.choice.1": "优先级表完成｜第一名只有一条线",
    "p.career.choice.2": "按表排下周时间｜时间块与优先级一致",
    "p.career.choice.3": "一周后和导师复盘是否要调整｜复盘结论已记录",
    "c.career.qual.1": "资格条件（身份、学分、证照）有一项不清，整条线的可行性就不成立。",
    "c.career.qual.2": "资格规则多在官方文件里，转述经常过期。",
    "today.career.qual": "今天先列出这条线的资格条件清单，逐条标「已确认 / 待确认」。",
    "p.career.qual.1": "资格条件清单完成｜每条有状态标记",
    "p.career.qual.2": "待确认项逐条找到官方出处｜出处已存档",
    "p.career.qual.3": "结论同步导师并写入规划｜规划已更新",
    "c.family.talk.1": "对立往往不是目标不同，是信息不对称：父母只看到结果，看不到你的方案和进度。",
    "c.family.talk.2": "在情绪最高点谈正事，只会把沟通变成输赢。",
    "today.family.talk": "今天先不争论：把你的方案要点写成三行，准备用事实而不是情绪开场。",
    "p.family.talk.1": "方案三行版写好｜目标 / 进度 / 下一步各一行",
    "p.family.talk.2": "挑一个平静时间，用三行版开一次短谈｜谈完记录结论",
    "p.family.talk.3": "谈不拢的部分打包请导师转译｜已请导师介入",
    "c.family.expect.1": "期待差异常是时间表不同：父母要确定性，你要成长性。",
    "c.family.expect.2": "没有阶段性成果给他们看，期待就只会越来越急。",
    "today.family.expect": "今天先想好一个 30 天内能给家里看的阶段性成果是什么。",
    "p.family.expect.1": "阶段性成果目标定下｜是一个可展示的具体东西",
    "p.family.expect.2": "把目标拆进本周行动｜行动已排期",
    "p.family.expect.3": "成果出来后主动同步家里｜已同步并记录反应",
    "c.family.support.1": "开口要具体：要什么支持、多少、用到哪，比「支持我」有效得多。",
    "c.family.support.2": "父母是投资人视角：给他们看投入与回报的账，沟通会顺很多。",
    "today.family.support": "今天把需要的支持写成一条具体的请求：事项 + 数量 + 用途。",
    "p.family.support.1": "具体请求写好｜三要素齐全",
    "p.family.support.2": "附一页简单的投入 / 回报说明｜说明已备好",
    "p.family.support.3": "发出请求并记录答复｜答复已记录",
    "c.emotion.low.1": "低落时大脑会把所有任务看成一团，先缩小到一个最小动作。",
    "c.emotion.low.2": "作息乱会放大低落，先稳住睡眠和吃饭这两个锚。",
    "today.emotion.low": "今天只做一件最小的事：出门走 10 分钟，或把桌面清出来——做完就在今日状态里记一笔。",
    "p.emotion.low.1": "连续 3 天记录今日状态｜记录不断档",
    "p.emotion.low.2": "每天一个最小推进动作｜动作虽小但有记录",
    "p.emotion.low.3": "状态持续两周没好转，联系学校心理咨询中心｜已预约或已咨询",
    "c.emotion.anxious.1": "焦虑多来自不确定：把不确定的事逐条写下来，一半会变小。",
    "c.emotion.anxious.2": "同时盯太多线会持续焦虑，要先砍到一条主线。",
    "today.emotion.anxious": "今天把让你焦虑的事逐条写进私密空间，只留最急的一件进问题解决中心。",
    "p.emotion.anxious.1": "焦虑清单写完｜每条标了可控 / 不可控",
    "p.emotion.anxious.2": "最急一件已拆解出今日一步｜今日一步完成",
    "p.emotion.anxious.3": "睡前 30 分钟不看消息｜执行满 3 天",
    "c.emotion.alone.1": "一个人扛太久，判断会变形：需要至少一个能说话的出口。",
    "c.emotion.alone.2": "导师留言就是为这种时候留的，用它不丢人。",
    "today.emotion.alone": "今天给导师留言区写一句话：现在的状态，或者只是打个招呼。",
    "p.emotion.alone.1": "给导师发出一句话｜已发出",
    "p.emotion.alone.2": "约一位同学 / 朋友本周见一面｜已约好",
    "p.emotion.alone.3": "把这周的感受记进私密空间｜至少 2 条记录",
    "c.other.stuck.1": "说不清的卡点，先拆成「事实 / 感受 / 缺什么」三栏就会清楚很多。",
    "c.other.stuck.2": "卡住常常是缺一个信息或一个决定，而不是缺能力。",
    "today.other.stuck": "今天把卡点写成三栏：已知事实、我的感受、我缺的东西。",
    "p.other.stuck.1": "三栏写完｜缺的东西明确成 1–2 项",
    "p.other.stuck.2": "缺的信息找到确认渠道｜已发出询问",
    "p.other.stuck.3": "信息到齐后重拆一次问题｜新方案已生成",
    "c.other.multi.1": "几件事撞期时，先按截止日排序，不要按焦虑程度排序。",
    "c.other.multi.2": "总有一件能延后或砍掉，全都保只会全都拖。",
    "today.other.multi": "今天把撞在一起的事按截止日列成表，圈出必须保的一件和可以延后的一件。",
    "p.other.multi.1": "撞期清单按截止日排好｜顺序明确",
    "p.other.multi.2": "延后 / 砍掉至少一件并通知相关人｜已通知",
    "p.other.multi.3": "保住的那件排出每日进度｜进度表已建",
  },
  en: {
    appTitle: "One-on-One Client",
    "gate.title": "Open My Client",
    "gate.desc": "Enter the personal name (or student ID) and access key from your mentor. You only need to enter them once on this device.",
    "gate.labelS": "Personal name / Student ID", "gate.labelK": "Access key",
    "gate.phS": "e.g. stu-01 or 12", "gate.phK": "e.g. ck_…",
    "gate.enter": "Enter",
    "gate.hint": "Tip: after entering, use your browser menu to Add to Home Screen — the icon on your home screen is your personal app.",
    "gate.errBoth": "Both the name / ID and the key are required.",
    "state.loading": "Loading…", "state.retry": "Retry",
    "state.netErr": "Network unavailable — could not reach the server. Please check your connection and retry.",
    "state.notFound": "This client was not found: the name / ID or key is incorrect, or the link has been updated. Please check the latest link from your mentor.",
    "state.reenter": "Re-enter name & key",
    "state.gateAsk": "Please enter the personal name (or ID) and access key from your mentor.",
    "state.serverBusy": "The server is busy right now ({status}). Please try again shortly.",
    "state.badData": "Unexpected data format. Please try again shortly.",
    "tab.home": "Home", "tab.growth": "Growth", "tab.plan": "Plan", "tab.mentor": "Mentor",
    "hero.stage": "Current stage: ", "hero.mainLine": "Current Focus",
    "hero.next": "Next step: {x}",
    "hero.exclusive": "Built exclusively for {name} · One-on-one planning service",
    "hero.exclusiveAnon": "Built exclusively for you · One-on-one planning service",
    "app.personalTitle": "{name}'s Personal App", "app.defaultTitle": "My Personal App",
    "card.mentor": "A Note from Your Mentor", "card.daily": "Daily Quote", "card.countdown": "Key Dates",
    "card.actions": "Action List", "card.timeline": "Milestones", "card.status": "Current Status",
    "card.coursesDone": "Courses · Completed & In Progress", "card.exams": "Exams", "card.meetings": "Mentoring Sessions",
    "card.lines": "Life Lines", "card.vision": "Vision Board", "card.goalDetail": "Academic Goal",
    "card.courses": "Course Plan", "card.advice": "Mentor's Advice", "card.knowledge": "Knowledge Cards",
    "card.messages": "Messages",
    "sign.prompt": "Pick a line as your personal signature — once set, it stays in your app and greets you every day.",
    "sign.confirm": "Set it as my signature", "sign.saving": "Setting…",
    "sign.err": "Could not set it — a network or server hiccup. Please try again.",
    "cd.left": "{n} days left", "cd.today": "Today", "cd.overdue": "Past due",
    "actions.progress": "Done {x} of {y}",
    "status.latestGpa": "Latest GPA", "status.credits": "Credits done / required",
    "status.empty": "No status snapshots yet.", "status.history": "Past snapshots",
    "status.gpaWord": "GPA", "status.creditsWord": "credits",
    "status.curve": "Progress Curve", "status.ring": "Credits completed",
    "status.single": "Only one status snapshot so far — once there are two or more, your progress curve will appear here.",
    "cdone.summary": "{a} completed · {b} in progress / enrolled",
    "cdone.empty": "No completed or in-progress courses yet.",
    "exams.score": "Score {x}", "exams.line": "Pass line {x}", "exams.empty": "No exam records yet.",
    "meetings.next": "Next session: {x}", "meetings.empty": "No session records yet.",
    "lines.next": "Next step: {x}", "lines.empty": "No goal lines recorded yet — please confirm with your mentor.",
    "goal.fSchool": "Target school / program", "goal.fTerm": "Target entry term", "goal.fGpa": "Target GPA",
    "courses.summary": "Credits completed {a} / planned {b} · Prerequisites done {c}/{d}",
    "courses.kind": "Done {a}/{b} courses · credits {c}/{d}",
    "courses.termMeta": "{a} courses · {b} credits", "courses.unit": " cr",
    "courses.empty": "No courses recorded yet.",
    "msg.label": "Message your mentor", "msg.ph": "Write what you'd like to tell your mentor…", "msg.send": "Send",
    "msg.sending": "Sending…", "msg.emptyThread": "Questions? Leave a message here anytime — your mentor will reply.",
    "msg.you": "Me", "msg.mentor": "Mentor",
    "msg.errEmpty": "Write something first.", "msg.errTooLong": "Messages are limited to 500 characters.",
    "msg.errNet": "Could not send — a network or server hiccup. Please try again.",
    "msg.errGone": "This link is no longer valid. Please ask your mentor for the latest link.",
    "msg.errFreq": "You're sending too fast — please wait a minute and try again.",
    "page.empty": "Nothing here yet — your mentor will keep this page updated.",
    "foot.line1": "Add this page to your home screen and it becomes your personal app — tap the icon anytime.",
    "foot.line2": "Your data is maintained by your mentor. Questions? Leave a message on the Mentor tab.",
    "foot.forget": "Forget the ID & key saved on this device",
    /* ===== v12 UI keys (en) ===== */
    "card.dream": "Distance to Your Dream", "card.today": "Today", "card.obstacles": "Current Blockers",
    "card.private": "Private Space", "card.feed": "My Updates", "card.trail": "Mentor Trail",
    "card.problems": "Problem Solving", "card.match": "Course Match",
    "sheet.back": "Back",
    "view.private": "Private Space", "view.problems": "Problem Solving", "view.trail": "Mentor Trail",
    "view.match": "Course Match", "view.share": "Share Card",
    "dream.endpoint": "Destination", "dream.crossed": "Crossed", "dream.now": "Walking now",
    "dream.left": "Steps left", "dream.win": "Latest small win",
    "dream.noVision": "Your destination isn't written down yet — your mentor will set it with you in the plan.",
    "dream.noSteps": "The first step isn't set yet; your mentor will break it down with you in the plan.",
    "dream.allDone": "Every milestone on this leg is crossed — set the next leg with your mentor.",
    "dream.creditsFact": "{x} credits to go ({a} done / {b} total)",
    "dream.examFact": "{n} exam item(s) still open",
    "dream.probFact": "{n} unresolved problem(s) (see Current Blockers)",
    "dream.moreSteps": "and {n} more",
    "today.q": "How do you feel today? Stored only on this device.",
    "today.ph": "What did you move forward today? (one line, optional)",
    "today.save": "Log today", "today.saved": "Logged", "today.streak": "Day {n} of showing up for yourself",
    "today.m1": "Very low", "today.m2": "Low", "today.m3": "Okay", "today.m4": "Good", "today.m5": "Great",
    "obstacles.none": "No unresolved problems right now. When something blocks you, break it down in Problem Solving.",
    "private.entryDesc": "Diaries, thoughts and feelings live only on this device — only you can see them; the platform keeps nothing.",
    "private.enter": "Open Private Space",
    "feed.empty": "No updates yet. Finish an action or cross a milestone and your footprints will appear here.",
    "feed.tAction": "Finished a step", "feed.tMilestone": "Crossed a milestone", "feed.tProblem": "Solved a problem",
    "feed.tTrail": "{name} left you a line", "feed.tStreak": "Day {n} of logging yourself",
    "feed.share": "Share", "feed.hide": "Remove",
    "trail.enter": "View Mentor Trail", "trail.empty": "No mentor trail yet. After each session, the core line and your takeaway will live here.",
    "trail.due": "{n} to revisit", "trail.latest": "Latest line",
    "trail.filterAll": "All mentors", "trail.takeaway": "My takeaway", "trail.takeawayLocal": "Keep this takeaway on this device only",
    "trail.localMark": "Logged on this device (content stays here)",
    "trail.revisit": "Revisit result", "trail.revisitDue": "To revisit", "trail.save": "Save",
    "trail.saved": "Saved", "trail.createTitle": "Log a mentor",
    "trail.fName": "Mentor name", "trail.fRole": "Mentor role", "trail.fSpirit": "The one line",
    "trail.fJudgments": "Key judgments (one per line)", "trail.fFollow": "Follow-up actions (one per line)",
    "trail.createBtn": "Add to trail", "trail.phSpirit": "The core line of this conversation (≤60 chars)",
    "trail.role.lead": "Lead mentor", "trail.role.teacher": "Teacher", "trail.role.industry": "Industry mentor",
    "trail.role.coach": "Coach", "trail.role.elder": "Elder", "trail.role.other": "Other",
    "problems.desc": "Break what's stuck into a plan you can move — the breakdown happens locally; syncing to your mentor is your call, item by item.",
    "problems.open": "Open Problem Solving", "problems.openCount": "{n} open problem(s)",
    "match.open": "View match results", "match.disclaimer": "Your school's official degree audit prevails",
    "match.empty": "No requirement sets yet. Once your mentor enters them, matches are computed block by block.",
    "match.missingFact": "{n} courses still missing",
    "match.verified": "Verified against official sources", "match.unverified": "Unverified · planning reference",
    "match.source": "Source: ", "match.version": "Version: ",
    "match.noReq": "This scenario's official requirements haven't been verified and entered yet — framework only, nothing invented.",
    "match.blockLine": "Met {a} / {b} · in progress {c} · planned {d} · missing {e}",
    "match.creditsLine": "Credits: done {a} / known total {b} · missing {c}",
    "match.creditsUnknown": "Plus {n} requirement(s) with no listed credits, not counted",
    "match.missingTitle": "Still missing", "match.warnTitle": "Grade warnings", "match.breakTitle": "Prerequisite breaks",
    "match.belowMin": "{code} grade {g} is below the requirement's stated minimum {m}",
    "match.watch": "{code} grade {g} — general note: many nursing programs require B or above in prerequisites; this is a general note, not an official line, pending official verification",
    "match.break": "{code}'s prerequisite {p} has no completed / in-progress course behind it",
    "match.none": "None",
    "share.warnPrivate": "This was visible only to you. Once shared, it is public.",
    "share.textLabel": "Share text (editable)", "share.checkTitle": "Before exporting, confirm each item",
    "share.c1": "No real name", "share.c2": "No school name", "share.c3": "No grades / scores", "share.c4": "No identity details",
    "share.img": "Export image", "share.text": "Copy text", "share.copied": "Copied — paste it anywhere to post.",
    "share.imgDone": "Image generated (long-press or right-click to save). You post it yourself.",
    "share.need": "Complete all four privacy checks to export.",
    "share.selfPost": "Image and text are generated only on your device. Post them yourself on X or elsewhere — the app never posts for you and never asks for social accounts.",
    "voice.btn": "Voice input", "voice.stop": "Stop",
    "voice.note": "Speech recognition runs on the browser vendor's cloud — audio leaves this device. The result lands in the text box first; edit it before saving.",
    "voice.notePrivate": "This is private content. Voice recognition uses the browser vendor's cloud (audio leaves the device), which conflicts with this space's on-device principle, so it is off by default. Turn it on only if you accept that, and proofread the result.",
    "voice.enable": "Turn on voice input", "voice.off": "Turn voice off",
    "voice.unsupported": "This browser doesn't support speech recognition — please type.",
    "voice.listening": "Listening… tap Stop when done.",
    "voice.denied": "Microphone permission was denied: allow the microphone in browser settings and retry, or just type.",
    "priv.title": "A space only you can see",
    "priv.only": "Diaries, thoughts and feelings here are stored only in this device's browser — never uploaded, never on a server; neither your mentor nor your parents can see them.",
    "priv.lost": "Clearing browser data, switching phones or uninstalling the browser will erase them — export a backup to your own device regularly.",
    "priv.noRecover": "We cannot recover them for you, because we never held them — that is the promise itself.",
    "priv.write": "Write an entry", "priv.ph": "Write whatever comes to mind — only you will see it…",
    "priv.ty.diary": "Diary", "priv.ty.note": "Note", "priv.ty.mood": "Today", "priv.ty.problem_draft": "Problem draft",
    "priv.save": "Save on this device", "priv.savedLocal": "Saved on this device.", "priv.needBody": "Write something first.",
    "priv.offline": "Everything stays on this device — writing and reading work offline.",
    "priv.list": "My entries", "priv.all": "All", "priv.empty": "No entries yet — write your first one above.",
    "priv.del": "Delete", "priv.delConfirm": "Delete this entry? It only exists here; once gone, it's gone.",
    "priv.shareLine": "Share this line", "priv.toProblem": "Break this problem down",
    "priv.expMd": "Export Markdown", "priv.expJson": "Export JSON backup", "priv.import": "Import backup",
    "priv.exported": "Exported to your device.", "priv.imported": "Import done:", "priv.importBad": "That file isn't a valid backup.",
    "priv.clear": "Erase all private data",
    "priv.clearConfirm1": "This erases ALL private entries on this device (diary / notes / today / drafts). Not recoverable. Sure?",
    "priv.clearConfirm2": "Confirm once more: erase everything? Export a backup first if unsure.",
    "priv.cleared": "All private entries on this device were erased.",
    "priv.backupTip": "You've built up quite a few unbacked-up entries — export one to your own device now.",
    "priv.tagSugg": "Suggested tags:",
    "care.title": "Pause for a moment",
    "care.lead": "Seeing what you wrote — you don't have to carry this alone. Slow down, and when you need it, use the professional resources below.",
    "care.us": "US: call or text 988 (Suicide and Crisis Lifeline, 24/7)",
    "care.textline": "US: text HOME to 741741 (Crisis Text Line)",
    "care.school": "Your school's Counseling Center: search your school's website for Counseling Center to book a session",
    "care.cn": "China: national psychological assistance hotline 12356 (check the current official listing)",
    "care.note": "These are public resources; numbers are subject to current official listings. This app offers planning support and companionship — it is not therapy or crisis intervention.",
    "care.toMentor": "Go to mentor messages (you decide whether to send)",
    "pb.title": "Break down a problem",
    "pb.localNote": "The breakdown and plan are computed on this device — nothing is uploaded. Free text (what happened / what I tried / where I'm stuck) stays on this device and never enters synced content.",
    "pb.fDomain": "Problem domain", "pb.fLine": "Which life line does it affect", "pb.lineNone": "Not linked",
    "pb.fBottleneck": "Where it's stuck", "pb.fWhat": "What happened", "pb.fTried": "What I've tried", "pb.fStuck": "The stuck point in one line",
    "pb.localOnlyPh": "On this device only, never synced", "pb.syncablePh": "Appears in the sync checklist; sent only after you confirm",
    "pb.fImpact": "Impact (1–5)", "pb.fUrgency": "Urgency (1–5)", "pb.fResources": "Resources I have",
    "pb.res.time": "Time", "pb.res.money": "Money", "pb.res.school": "School resources", "pb.res.mentor": "Mentor",
    "pb.res.family": "Family support", "pb.res.peers": "Peers", "pb.res.none": "None yet",
    "pb.fDesired": "Desired outcome (what 'solved' looks like)", "pb.fSupport": "Help I need",
    "pb.saveDraft": "Save draft (on device)", "pb.draftSaved": "Draft saved in your Private Space on this device.",
    "pb.needSomething": "Write something first.", "pb.generate": "Generate plan",
    "pb.resultTitle": "Your plan from the local engine", "pb.mine": "My problems", "pb.mineEmpty": "No synced problems yet. Plans you confirm will appear here.",
    "pb.outBreakdown": "1. Breakdown", "pb.outCauses": "2. Likely causes", "pb.outToday": "3. One step today (stop the bleeding)",
    "pb.outPlan": "4. Seven-day focused plan", "pb.outKnow": "5. Related knowledge cards", "pb.outHelp": "6. Who to ask (in order)",
    "pb.outEscalate": "7. Sync to mentor?",
    "pb.impactWord": "Impact", "pb.urgencyWord": "Urgency", "pb.criterion": "Done when",
    "pb.level.high": "High priority: handle this first", "pb.level.mid": "Medium priority: schedule it this week", "pb.level.low": "Low priority: note it down and clear your head",
    "pb.knowWhy": "Why this card: it matches this problem's domain",
    "pb.escYes": "Syncing to your mentor is recommended — these conditions hit:",
    "pb.escNo": "You can push this yourself first; if two days pass with no progress, sync it to your mentor.",
    "pb.escHigh": "Impact and urgency both high (≥4)", "pb.escRules": "Official rules / eligibility are uncertain",
    "pb.escCompliance": "A compliance matter is involved (flagged pending verification)", "pb.escEmotion": "Your words show a state that needs care (see the Private Space care page)",
    "pb.todayWord": "Today's step", "pb.planWord": "7-day plan",
    "pb.syncTitle": "Sync to mentor (confirm item by item)",
    "pb.syncNote": "Only checked items are synced. If the title is unchecked, only the domain and bottleneck names are used as a placeholder; free text never enters the sync.",
    "pb.syncF.title": "Problem title", "pb.syncF.desired": "Desired outcome", "pb.syncF.strategy": "Strategy summary (today's step + 7-day plan)",
    "pb.syncF.actions": "Action items (7-day plan, itemized)", "pb.syncF.support": "Help needed",
    "pb.syncBtn": "Confirm sync", "pb.syncNone": "Check at least one item to sync.",
    "pb.syncDone": "Synced to the plan layer — your mentor can see it.", "pb.syncFail": "Sync failed — a network or server hiccup. Please retry.",
    "pb.escBtn": "Send summary to mentor", "pb.escConfirm": "The text below will be sent in your name to mentor messages. Send it?",
    "pb.escDone": "Sent to your mentor.", "pb.escMsgHead": "[Problem escalation] I broke down a problem with the Problem Solving center — summary:",
    "pb.reviewBanner": "Pending verification: this involves a compliance matter (business / food / employment / tax / status, etc.). The plan can only be marked 'pending verification' and must go to a qualified lawyer / accountant / authority before execution — neither the mentor nor the engine can clear it.",
    "pb.reviewTag": "Pending verification", "pb.markResolved": "Mark resolved", "pb.resolveNotePh": "Resolution note (optional): how was it solved?",
    "pb.dom.study": "Study", "pb.dom.exam": "Exams", "pb.dom.business": "Business", "pb.dom.career": "Career & parallel lines",
    "pb.dom.family": "Family", "pb.dom.emotion": "Emotions", "pb.dom.other": "Other",
    "pb.bn.study.behind": "Behind schedule", "pb.bn.study.hard": "Material too hard",
    "pb.bn.study.prereq": "Prerequisite failed / missing", "pb.bn.study.plan": "Don't know how to plan courses",
    "pb.bn.exam.rules": "Don't know the exam rules", "pb.bn.exam.pace": "No study rhythm",
    "pb.bn.exam.gap": "Score gap too big", "pb.bn.exam.retries": "Attempts / eligibility anxiety", "pb.bn.exam.info": "Missing exam info (name / scores / pass line)",
    "pb.bn.business.compliance": "Compliance / licenses unclear", "pb.bn.business.funds": "No startup funds",
    "pb.bn.business.time": "Time conflicts", "pb.bn.business.product": "Product / recipe not set", "pb.bn.business.channel": "Don't know how to sell",
    "pb.bn.career.wait": "Waiting on an external result", "pb.bn.career.choice": "Can't rank the lines", "pb.bn.career.qual": "Eligibility unclear",
    "pb.bn.family.talk": "Communication with parents is adversarial", "pb.bn.family.expect": "Parents' expectations differ from my plan", "pb.bn.family.support": "Need family support, don't know how to ask",
    "pb.bn.emotion.low": "Low energy, can't get moving", "pb.bn.emotion.anxious": "Anxious, can't settle", "pb.bn.emotion.alone": "Lonely, no one to talk to",
    "pb.bn.other.stuck": "Just stuck, can't name it", "pb.bn.other.multi": "Several things collided",
    /* —— Strategy library (en; plan item format: action | done-when) —— */
    "h.self.site": "Self first: read the official school / program pages", "h.mentor": "Your mentor", "h.school.office": "The school's program / admissions office",
    "h.self.plan": "Self first: break the plan down by day", "h.self.review": "Self first: review mistakes and lost points", "h.school.advisor": "Your academic advisor",
    "h.school.tutor": "The school's tutoring center / course TAs", "h.pro.legal": "A qualified professional (lawyer / accountant / the authority)",
    "h.self.test": "Self first: test a small version cheaply", "h.mentor.translate": "Your mentor (can translate your plan for your parents)",
    "h.family.calm": "Pick a calm moment to talk with family", "h.self.small": "Self first: one smallest action", "h.school.counsel": "The school's Counseling Center",
    "c.generic.1": "Key facts aren't confirmed yet — guessing only adds chaos.", "c.generic.2": "Several things are piled up with no order.",
    "today.generic": "Write this problem as one sentence in Problem Solving instead of letting it spin in your head.",
    "p.generic.1": "Write the one-sentence version of the problem|It's one clear sentence on paper, not a fog",
    "p.generic.2": "List known facts vs. facts to confirm in two columns|Both columns are filled",
    "p.generic.3": "Ask your mentor or the right person to confirm the single most important fact|The request / message is sent",
    "c.exam.rules.1": "You've only heard the rules second-hand; retellings drop eligibility and attempt limits first.",
    "c.exam.rules.2": "Exam info is scattered (website, handbook, emails) and never gathered into one checklist.",
    "today.exam.rules": "Don't drill questions today: open the program's official site and read the full exam requirements page, then save it.",
    "p.exam.rules.1": "Read the official requirements page and archive a screenshot|The page is saved",
    "p.exam.rules.2": "Build the checklist: name / pass line / attempt cap / interval / deadline|All five items have a source",
    "p.exam.rules.3": "Mark every uncertain item and send the list to your mentor|The question list is sent",
    "c.exam.info.1": "Exam name, past scores and the pass line were never recorded in one place; memory misjudges.",
    "c.exam.info.2": "Without those numbers you can't size the gap or judge whether more attempts are worth it.",
    "today.exam.info": "Write down everything you know (exam name, each date and score) in one record today; mark gaps as 'to fill'.",
    "p.exam.info.1": "Assemble all past attempts into one table|Every date / score is present or marked to-fill",
    "p.exam.info.2": "Request the pass line and retake rules from the school or mentor in writing|Request sent and logged",
    "p.exam.info.3": "Sync the table to your mentor to fill the gaps|Mentor confirmed receipt",
    "c.exam.retries.1": "Attempt caps and intervals are hard official rules; effort past the cap is wasted — confirm before investing.",
    "c.exam.retries.2": "The anxiety comes from uncertainty: not knowing if you're still eligible drains more than the result.",
    "today.exam.retries": "Do exactly one thing today: confirm the official retake cap and how many attempts you've used. Write both down.",
    "p.exam.retries.1": "Find the official retake rule text|The source is archived",
    "p.exam.retries.2": "Compute remaining attempts and the earliest next date|Both numbers are written down",
    "p.exam.retries.3": "Decide with your mentor: retake / switch route / run a parallel backup|The decision is one sentence, synced",
    "c.exam.pace.1": "No weekly rhythm — what to study each day is decided on the spot.",
    "c.exam.pace.2": "Drilling without review repeats the same mistakes.",
    "today.exam.pace": "Set this week's study table today: one theme and one time slot per day, into your calendar.",
    "p.exam.pace.1": "Build the 7-day study table in your calendar|Every day has a theme",
    "p.exam.pace.2": "Take one timed mock and record the score|Score recorded",
    "p.exam.pace.3": "Adjust next week's table by the mock's lost points|At least 2 adjustments written",
    "c.exam.gap.1": "Locate the gap first: missing knowledge, or question types and speed? The fixes differ completely.",
    "c.exam.gap.2": "A single total score hides the structure — the gap may be 1–2 sections only.",
    "today.exam.gap": "Take the latest score or mock and split out the two sections losing the most points.",
    "p.exam.gap.1": "Finish the lost-points split|The two weakest sections are named",
    "p.exam.gap.2": "Do 3 focused practice rounds on the weakest section|Practice logged",
    "p.exam.gap.3": "Retake a timed test on that section|Score comparable to last time",
    "c.study.prereq.1": "A broken prerequisite chain blocks later courses — or lets you in unprepared.",
    "c.study.prereq.2": "The missing list is fuzzy: which courses, how many credits?",
    "today.study.prereq": "Open Course Match, read the missing list, and pick the earliest broken prerequisite.",
    "p.study.prereq.1": "List all missing courses and credits|The list matches the match engine",
    "p.study.prereq.2": "Confirm the top course's term and registration window|Dates are in your calendar",
    "p.study.prereq.3": "Confirm the make-up order with your mentor|The order is synced",
    "c.study.behind.1": "Being behind is usually weeks of small debts rolled together — locate which pieces.",
    "c.study.behind.2": "Trying to catch up all at once collapses; rank by exam weight.",
    "today.study.behind": "List what you're behind on and rank the top 3 by exam weight × difficulty.",
    "p.study.behind.1": "Ranked catch-up list done|Top 3 are explicit",
    "p.study.behind.2": "Clear one small piece daily and check it off|3 days logged in a row",
    "p.study.behind.3": "Take a mini-quiz to verify|Quiz score recorded",
    "c.study.hard.1": "The hard part is usually a few concepts — name them.",
    "c.study.hard.2": "Reading alone won't stick: alternate explanations and worked examples.",
    "today.study.hard": "Write the hardest concept as 'the exact sentence I'm stuck on' and take it to a resource.",
    "p.study.hard.1": "Name the 2 hardest concepts as specific questions|Written as question sentences",
    "p.study.hard.2": "Find one explanation each and do 5 worked problems|Right / wrong logged",
    "p.study.hard.3": "Restate the concept in your own words in writing|Restatement done",
    "c.study.plan.1": "Courses were never checked against a requirement set — easy to over-take or miss.",
    "c.study.plan.2": "With the target undecided, compute scenarios side by side; don't treat one route as final.",
    "today.study.plan": "Open Course Match first and see what each scenario still needs before choosing next term's courses.",
    "p.study.plan.1": "Read every scenario's missing list|Missing counts are clear per scenario",
    "p.study.plan.2": "Draft next term's course list|It maps to the missing list",
    "p.study.plan.3": "Send the draft to your mentor to check prerequisite order|Mentor replied",
    "c.biz.comp.1": "Business, food and employment carry license and status boundaries — acting before knowing the rules is the riskiest move.",
    "c.biz.comp.2": "Rules live at federal / state / platform layers; checking one layer misses the rest.",
    "today.biz.comp": "Pause any outward selling today and write down every compliance question. Until confirmed, only do prep that touches nothing external (recipe, cost sheet).",
    "p.biz.comp.1": "Write the compliance checklist: licenses / labeling / work authorization / tax|The list exists",
    "p.biz.comp.2": "Check each item against official sources and cite them|Every item has an official link or text",
    "p.biz.comp.3": "Package the uncertain items for your mentor and book a dedicated session|Sent, with a time set",
    "c.biz.time.1": "The main line and the side line fight for the same hours, and the side line has no cap.",
    "c.biz.time.2": "Squeezed study / exam time costs much more to repay later.",
    "today.biz.time": "Set a weekly hour cap for the business today; put it in your calendar and sync it to your mentor.",
    "p.biz.time.1": "Write the weekly cap|It's in your calendar",
    "p.biz.time.2": "Cut the lowest-value side task|It's explicitly stopped",
    "p.biz.time.3": "Review actual hours after a week|Actual vs. cap compared",
    "c.biz.funds.1": "Without a minimum startup cost, the big number either scares you off or invites blind spending.",
    "c.biz.funds.2": "You can validate with a small batch first — no need to fund everything at once.",
    "today.biz.funds": "Build a minimum startup cost sheet today: only the first batch of must-spend items.",
    "p.biz.funds.1": "Minimum startup sheet done|The total is one firm number",
    "p.biz.funds.2": "List deferrable / cuttable costs|At least 2 items cut",
    "p.biz.funds.3": "Set a validation budget cap and sync it to your mentor|Cap confirmed",
    "c.biz.product.1": "Until the recipe / product is fixed, packaging, cost and pricing can't be fixed either.",
    "c.biz.product.2": "Taste in your head must become a reproducible ratio and a cost.",
    "today.biz.product": "Fix one target price and a first-version ratio today, in writing.",
    "p.biz.product.1": "First-version ratio document done|Reproducible by someone else",
    "p.biz.product.2": "Compute unit cost from the ratio|Cost number computed",
    "p.biz.product.3": "Have 3 people taste it and log feedback|Feedback logged",
    "c.biz.channel.1": "Before channels: answer who buys and why; then scale.",
    "c.biz.channel.2": "Listing before knowing platform rules (fees, insurance, categories) invites trouble.",
    "today.biz.channel": "Pick one main channel today, read its onboarding rules fully, and list the to-dos.",
    "p.biz.channel.1": "Main-channel rule checklist done|Fees / requirements written",
    "p.biz.channel.2": "Prepare the listing asset checklist|Every asset checkable",
    "p.biz.channel.3": "List a small batch or run a presale test|First real feedback / order exists",
    "c.career.wait.1": "Waiting periods punish pure waiting: while one line waits, others can move.",
    "c.career.wait.2": "Without a confirmed timeline, anxiety inflates the wait.",
    "today.career.wait": "Write the waiting item's status and expected milestones, then move one movable line one small step.",
    "p.career.wait.1": "Waiting-milestone table done|Each node has an expected time or a way to confirm",
    "p.career.wait.2": "Move a parallel line one small step|There is a concrete output",
    "p.career.wait.3": "Check the status on the milestone date|Check logged",
    "c.career.choice.1": "When all lines matter, rank by 'which line decides the others', not by equal effort.",
    "c.career.choice.2": "If priorities aren't written, each day is pushed around by whatever is loudest.",
    "today.career.choice": "Write the lines into one priority table today; only one line gets first place.",
    "p.career.choice.1": "Priority table done|Exactly one first place",
    "p.career.choice.2": "Schedule next week by the table|Time blocks match priorities",
    "p.career.choice.3": "Review with your mentor after a week|Review conclusion logged",
    "c.career.qual.1": "If one eligibility condition (status, credits, license) is unclear, the whole line's feasibility is unproven.",
    "c.career.qual.2": "Eligibility rules live in official documents; retellings go stale.",
    "today.career.qual": "List this line's eligibility conditions and mark each confirmed / to-confirm.",
    "p.career.qual.1": "Eligibility checklist done|Every item has a status mark",
    "p.career.qual.2": "Find the official source for each open item|Sources archived",
    "p.career.qual.3": "Sync the conclusion to your mentor and update the plan|Plan updated",
    "c.family.talk.1": "The clash is usually information asymmetry, not different goals: parents see results, not your plan and progress.",
    "c.family.talk.2": "Talking business at peak emotion turns communication into winning and losing.",
    "today.family.talk": "Don't argue today: write your plan as three lines, ready to open with facts instead of feelings.",
    "p.family.talk.1": "Three-line plan written|Goal / progress / next step, one line each",
    "p.family.talk.2": "Hold one short calm talk using the three lines|Conclusions logged after",
    "p.family.talk.3": "Package what stays stuck for your mentor to translate|Mentor looped in",
    "c.family.expect.1": "The expectation gap is often a timeline gap: parents want certainty, you want growth.",
    "c.family.expect.2": "Without visible stage results, their urgency only grows.",
    "today.family.expect": "Decide one stage result you can show your family within 30 days.",
    "p.family.expect.1": "Stage-result target set|It's one concrete, showable thing",
    "p.family.expect.2": "Break it into this week's actions|Actions scheduled",
    "p.family.expect.3": "Share it proactively once done|Shared, reaction logged",
    "c.family.support.1": "Asks work when specific: what support, how much, for what.",
    "c.family.support.2": "Parents think like investors: show the input / return math and the talk gets easier.",
    "today.family.support": "Write the support you need as one concrete request: item + amount + purpose.",
    "p.family.support.1": "Concrete request written|All three elements present",
    "p.family.support.2": "Attach a one-page input / return note|Note ready",
    "p.family.support.3": "Send the request and log the reply|Reply logged",
    "c.emotion.low.1": "When low, the brain sees every task as one blob — shrink to a single smallest action.",
    "c.emotion.low.2": "Broken routines amplify the low; anchor sleep and meals first.",
    "today.emotion.low": "Do just one smallest thing today: a 10-minute walk, or clear your desk — then log it in Today.",
    "p.emotion.low.1": "Log Today for 3 days straight|No gaps",
    "p.emotion.low.2": "One smallest forward action per day|Small, but logged",
    "p.emotion.low.3": "If it lasts two weeks, contact the school Counseling Center|Booked or visited",
    "c.emotion.anxious.1": "Anxiety feeds on uncertainty: write the uncertainties down one by one and half of them shrink.",
    "c.emotion.anxious.2": "Watching too many lines at once sustains anxiety — cut to one main line first.",
    "today.emotion.anxious": "Write everything making you anxious into Private Space; move only the most urgent one into Problem Solving.",
    "p.emotion.anxious.1": "Anxiety list written|Each item marked controllable / not",
    "p.emotion.anxious.2": "The most urgent one has a today-step|Step done",
    "p.emotion.anxious.3": "No messages 30 minutes before bed|Done 3 days",
    "c.emotion.alone.1": "Carrying everything alone too long distorts judgment — you need at least one outlet.",
    "c.emotion.alone.2": "The mentor message box exists for exactly this; using it is not weakness.",
    "today.emotion.alone": "Write one line in mentor messages today: how you are, or just say hello.",
    "p.emotion.alone.1": "Send one line to your mentor|Sent",
    "p.emotion.alone.2": "Meet one classmate / friend this week|Scheduled",
    "p.emotion.alone.3": "Log feelings in Private Space|At least 2 entries",
    "c.other.stuck.1": "An unnameable block often clears when split into facts / feelings / what's missing.",
    "c.other.stuck.2": "Being stuck is often one missing fact or one unmade decision — not missing ability.",
    "today.other.stuck": "Write the block in three columns today: known facts, my feelings, what I lack.",
    "p.other.stuck.1": "Three columns written|What's missing is 1–2 items",
    "p.other.stuck.2": "Find a channel to confirm the missing fact|Question sent",
    "p.other.stuck.3": "Re-run the breakdown once facts arrive|A new plan is generated",
    "c.other.multi.1": "When things collide, sort by deadline, not by anxiety level.",
    "c.other.multi.2": "One of them can always slip or be cut; protecting all of them stalls all of them.",
    "today.other.multi": "Table the colliding items by deadline; circle the one to protect and the one to slip.",
    "p.other.multi.1": "Collision list sorted by deadline|Order is explicit",
    "p.other.multi.2": "Slip or cut at least one and notify people|Notified",
    "p.other.multi.3": "Give the protected one a daily progress plan|Plan built",
  },
};
let LANG = "zh";
try { LANG = localStorage.getItem(LS_LANG) === "en" ? "en" : "zh"; } catch (e) { /* 存储不可用时默认中文 */ }
function t(key) {
  const dict = I18N[LANG] || I18N.zh;
  return typeof dict[key] === "string" ? dict[key] : (I18N.zh[key] || key);
}
function fmt(key, obj) {
  return t(key).replace(/\{(\w+)\}/g, (_, k) => (obj && obj[k] !== undefined && obj[k] !== null ? obj[k] : ""));
}
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
  document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";
  const z = $("lang-zh"), e = $("lang-en");
  if (z && e) { z.classList.toggle("on", LANG === "zh"); e.classList.toggle("on", LANG === "en"); }
}

const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function pct(done, total) {
  const d = Number(done) || 0, tt = Number(total) || 0;
  return tt > 0 ? Math.min(100, Math.round((d / tt) * 100)) : 0;
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
  $("gate").hidden = true; $("app").hidden = true; $("tabbar").hidden = true;
  $("state").hidden = false;
  $("state-text").textContent = text;
  const btn = $("state-retry");
  btn.hidden = !retry;
  if (retry) { btn.textContent = t("state.retry"); btn.onclick = () => load(); }
}
function showGate(errText) {
  $("state").hidden = true; $("app").hidden = true; $("tabbar").hidden = true;
  $("gate").hidden = false;
  const e = $("gate-err");
  if (errText) { e.textContent = errText; e.hidden = false; } else { e.hidden = true; }
}

async function load() {
  const { s, k, api } = creds();
  if (!s || !k) { showGate(); return; }
  showState(t("state.loading"), false);
  let resp;
  try {
    resp = await fetch(api + "/api/client/" + encodeURIComponent(s) + "?key=" + encodeURIComponent(k),
      { headers: { "Accept": "application/json" } });
  } catch (e) {
    showState(t("state.netErr"), true);
    return;
  }
  if (resp.status === 404) {
    showState(t("state.notFound"), false);
    const btn = $("state-retry");
    btn.hidden = false;
    btn.textContent = t("state.reenter");
    btn.onclick = () => {
      localStorage.removeItem(LS_S); localStorage.removeItem(LS_K);
      showGate(t("state.gateAsk"));
    };
    return;
  }
  if (!resp.ok) { showState(fmt("state.serverBusy", { status: resp.status }), true); return; }
  let data;
  try { data = await resp.json(); } catch (e) { showState(t("state.badData"), true); return; }
  if (!data || data.ok !== true) { showState(t("state.badData"), true); return; }
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
  const title = name ? fmt("app.personalTitle", { name }) : t("app.defaultTitle");
  document.title = title;
  setMeta("apple-mobile-web-app-title", title);
  setMeta("application-name", title);
  setMeta("theme-color", "#16453a");
  $("stu-exclusive").textContent = name
    ? fmt("hero.exclusive", { name })
    : t("hero.exclusiveAnon");
}

/* —— 每日一句（v9）——
 * 语录库：40 条，中文为主 + 英文小字；短句取公有领域经典与原创改写，不整段引用受版权文本。
 * 标签六组：action 行动 / study 学业坚持 / courage 勇气 / discipline 自律 / dream 梦想 / setback 挫折。
 * 选题确定性：种子 = 学生定位符 + 本地日期，同日不变、跨日轮换；主题池由学生数据决定，
 * 权重向第一优先级人生线的主题（action）倾斜。引擎为纯函数，可独立自测。
 * 双语显示：当前语言为主句、另一语种小字附后。 */
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
const WEEKDAYS = {
  zh: ["日", "一", "二", "三", "四", "五", "六"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateLine(now) {
  const d = now || new Date();
  if (LANG === "en") {
    return WEEKDAYS.en[d.getDay()] + ", " + MONTHS_EN[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }
  return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 · 星期" + WEEKDAYS.zh[d.getDay()];
}
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
    if (!q.tags.some((tg) => themes.includes(tg))) continue;
    pool.push(q);
    if (primary && q.tags.includes(primary)) pool.push(q);
  }
  const list = pool.length ? pool : (quotes || []);
  if (!list.length) return null;
  return list[hashSeed(seedStr) % list.length];
}
function renderDaily(d) {
  const now = new Date();
  $("daily-date").textContent = dateLine(now);
  const { s } = creds();
  const q = pickDailyQuote(QUOTES, quoteThemes(d), quotePrimaryTheme(d), String(d.student.id || s) + "|" + localDateStr(now));
  const main = q ? (LANG === "en" ? q.en : q.zh) : "";
  const sub = q ? (LANG === "en" ? q.zh : q.en) : "";
  $("daily-quote").textContent = main;
  $("daily-quote-en").textContent = sub;
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
    '<div class="sign-pick"><p class="mut" style="margin:0">' + esc(t("sign.prompt")) + "</p>" +
    '<div class="sign-opts">' + sugg.map((sug, i) =>
      '<button type="button" class="sign-opt" data-i="' + i + '">' + esc(sug) + "</button>").join("") + "</div>" +
    '<button type="button" class="btn-sign" id="sign-confirm" disabled>' + esc(t("sign.confirm")) + "</button>" +
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
    btn.disabled = true; btn.textContent = t("sign.saving");
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
      if (lastData) lastData.signature = j.signature;
      renderSignature(d);
    } catch (e) {
      btn.disabled = false; btn.textContent = t("sign.confirm");
      const err = $("sign-err");
      err.textContent = t("sign.err");
      err.hidden = false;
    }
  });
}

/* —— 四页签（v10）——
 * 首屏只渲染首页；其余页签数据已在同一份 JSON 内，首次切换时才渲染（renderedTabs 标记）。
 * 页签红点：GET 返回的 unread_mentor > 0 时在「导师」页签亮红点；点进该页后本地消点
 * （服务端已在 GET 时标记已读，下次加载即为 0）。 */
const TABS = ["home", "growth", "plan", "mentor"];
let curTab = "home";
let lastData = null;
const renderedTabs = {};
function updateDot() {
  const dot = $("tab-dot");
  if (dot) dot.hidden = !(lastData && Number(lastData.unread_mentor) > 0);
}
function switchTab(name) {
  if (!TABS.includes(name)) name = "home";
  curTab = name;
  for (const tb of TABS) {
    $("page-" + tb).hidden = tb !== name;
    document.querySelectorAll(".tab-btn").forEach((b) =>
      b.classList.toggle("on", b.getAttribute("data-tab") === tb && tb === name));
  }
  if (name === "mentor" && lastData) lastData.unread_mentor = 0;
  if (lastData && renderedTabs[name] !== LANG) renderTab(name);
  updateDot();
  window.scrollTo(0, 0);
}
function renderTab(name) {
  if (!lastData) return;
  renderedTabs[name] = LANG; // 记录渲染时语言：切换语言后再次进入该页会自动按新语言重渲染
  if (name === "home") renderHome(lastData);
  else if (name === "growth") renderGrowth(lastData);
  else if (name === "plan") renderPlan(lastData);
  else if (name === "mentor") renderMentor(lastData);
}
function render(d) {
  lastData = d;
  $("state").hidden = true; $("gate").hidden = true;
  $("app").hidden = false; $("tabbar").hidden = false;
  for (const k of Object.keys(renderedTabs)) delete renderedTabs[k];
  curTab = "home";
  for (const tb of TABS) $("page-" + tb).hidden = tb !== "home";
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("on", b.getAttribute("data-tab") === "home"));
  renderTab("home");
  updateDot();
}

/* —— 页1 首页 —— */
function renderHome(d) {
  $("stu-name").textContent = d.student.name || "我的客户端";
  personalize(d.student.name || "");
  renderDaily(d);
  const sys = $("stu-system");
  if (d.school_system) { sys.textContent = d.school_system; sys.hidden = false; } else { sys.hidden = true; }
  const meta = [];
  if (d.student.stage_label) meta.push(t("hero.stage") + d.student.stage_label);
  if (d.student.package) meta.push(d.student.package);
  $("stu-meta").textContent = meta.join(" · ");
  const ml = $("main-line");
  if (d.main_line) {
    ml.hidden = false;
    $("main-line-name").textContent =
      d.main_line.name + (d.main_line.status_label ? "（" + d.main_line.status_label + "）" : "");
    $("main-line-next").textContent = d.main_line.next_step ? fmt("hero.next", { x: d.main_line.next_step }) : "";
  } else { ml.hidden = true; }
  // 导师寄语：为空整卡不渲染
  const msec = $("sec-mentor");
  if (d.mentor_message) {
    msec.hidden = false;
    $("mentor-body").textContent = d.mentor_message;
    $("mentor-date").textContent = d.mentor_message_at ? String(d.mentor_message_at).slice(0, 10) : "";
  } else { msec.hidden = true; }
  renderCountdown(d);
  renderActions(d);
  renderDream(d);
  renderObstacles(d);
  renderTodayWidget();
}
function dayDiff(iso) {
  const parts = String(iso || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 864e5);
}
function renderCountdown(d) {
  const list = d.key_dates || [];
  const sec = $("sec-countdown");
  if (!list.length) { sec.hidden = true; return; }
  sec.hidden = false;
  $("countdown-list").innerHTML = list.map((k) => {
    const n = dayDiff(k.date);
    let cls = "", txt;
    if (n === null) { txt = k.date || ""; }
    else if (n < 0) { cls = "over"; txt = t("cd.overdue"); }
    else if (n === 0) { cls = "today"; txt = t("cd.today"); }
    else { txt = fmt("cd.left", { n }); }
    return '<div class="cd-item"><div class="cd-main">' +
      '<div class="cd-title">' + esc(k.title) + '</div>' +
      '<div class="cd-date">' + esc(k.date) + '</div></div>' +
      '<div class="cd-days ' + cls + '">' + esc(txt) + "</div></div>";
  }).join("");
}
function renderActions(d) {
  const acts = d.actions || [];
  const sec = $("sec-actions");
  if (!acts.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const done = acts.filter((a) => a.status === "done").length;
  $("actions-progress").textContent = fmt("actions.progress", { x: done, y: acts.length });
  $("actions-list").innerHTML = acts.map((a) => {
    const isDone = a.status === "done";
    return '<div class="act-item' + (isDone ? " done" : "") + '">' +
      '<span class="act-check" aria-hidden="true">' + (isDone ? "✓" : "○") + "</span>" +
      '<div class="act-body"><div class="act-title">' + esc(a.title) + "</div>" +
      (a.detail ? '<div class="act-detail">' + esc(a.detail) + "</div>" : "") +
      "</div>" +
      (a.due_text ? '<span class="act-due">' + esc(a.due_text) + "</span>" : "") +
      "</div>";
  }).join("");
}

/* —— 页2 成长 —— */
function renderGrowth(d) {
  renderFeed(d);
  renderTrailEntry(d);
  // 成长时间线：无数据整卡不渲染
  const ms = d.milestones || [];
  const msec = $("sec-timeline");
  if (ms.length) {
    msec.hidden = false;
    $("timeline").innerHTML = '<div class="tl">' + ms.map((m) =>
      '<div class="tl-item"><span class="tl-dot" aria-hidden="true"></span><div class="tl-body">' +
      (m.date_text ? '<div class="tl-date">' + esc(m.date_text) + "</div>" : "") +
      '<div class="tl-title">' + esc(m.title) + "</div>" +
      (m.detail ? '<div class="tl-detail">' + esc(m.detail) + "</div>" : "") +
      "</div></div>").join("") + "</div>";
  } else { msec.hidden = true; }
  renderStatus(d);
  renderCoursesDone(d);
  // 考试
  const exams = d.exams || [];
  $("exams").innerHTML = exams.length ? exams.map((e) => {
    const sub = [];
    if (e.exam_date) sub.push(e.exam_date);
    if (e.score) sub.push(fmt("exams.score", { x: e.score }));
    if (e.pass_line) sub.push(fmt("exams.line", { x: e.pass_line }));
    return '<div class="exam"><div class="exam-main">' +
      '<div class="exam-name">' + esc(e.exam_name) + "</div>" +
      (sub.length ? '<div class="exam-sub">' + esc(sub.join(" · ")) + "</div>" : "") +
      (e.note ? '<div class="exam-note">' + esc(e.note) + "</div>" : "") +
      '</div><span class="badge ' + esc(e.result || "pending") + '">' + esc(e.result_label || "") + "</span></div>";
  }).join("") : '<p class="empty">' + esc(t("exams.empty")) + "</p>";
  // 会议（记录类，归成长页）
  const ms2 = d.meetings || [];
  $("meetings").innerHTML = ms2.length ? ms2.map((m) => {
    const todos = String(m.action_items || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    return '<div class="meeting"><div class="meeting-top">' +
      '<span class="meeting-date">' + esc(m.meeting_date || "") + "</span>" +
      '<span class="meeting-topic">' + esc(m.topic || "") + "</span></div>" +
      (m.summary ? '<div class="meeting-summary">' + esc(m.summary) + "</div>" : "") +
      (todos.length ? '<ul class="todo-list">' + todos.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") +
      (m.next_date ? '<div class="meeting-next">' + esc(fmt("meetings.next", { x: m.next_date })) + "</div>" : "") +
      "</div>";
  }).join("") : '<p class="empty">' + esc(t("meetings.empty")) + "</p>";
  // 整页空 → 占位
  const growthCourses = (d.courses && d.courses.list) || [];
  const has = ms.length || (d.status && d.status.latest) || exams.length || ms2.length ||
    buildFeed(d).length || (d.mentor_trail || []).length ||
    growthCourses.some((c) => c.status === "done" || c.status === "ongoing" || c.status === "enrolled");
  const eg = $("empty-growth");
  eg.hidden = !!has;
  if (!has) eg.textContent = t("page.empty");
}
function renderStatus(d) {
  const st = d.status || {};
  const latest = st.latest;
  $("status-latest").innerHTML = latest ? (() => {
    const cd = latest.credits_done, ct = latest.credits_total;
    return '<div class="stat-big">' +
      '<div class="cell"><div class="v">' + (latest.gpa === null || latest.gpa === undefined ? "—" : esc(latest.gpa)) + '</div><div class="l">' + esc(t("status.latestGpa")) + (latest.snapshot_date ? "（" + esc(latest.snapshot_date) + "）" : "") + "</div></div>" +
      '<div class="cell"><div class="v">' + (cd === null || cd === undefined ? "—" : esc(cd)) + (ct ? ' <span style="font-size:16px;color:var(--mut)">/ ' + esc(ct) + "</span>" : "") + '</div><div class="l">' + esc(t("status.credits")) + "</div></div>" +
      "</div>" +
      ((cd !== null && cd !== undefined && ct) ? bar(cd, ct) : "") +
      (latest.note ? '<p style="margin:6px 0 0;white-space:pre-wrap">' + esc(latest.note) + "</p>" : "");
  })() : '<p class="empty">' + esc(t("status.empty")) + "</p>";
  renderCurve(st);
  const hist = (st.history || []).slice(1);
  $("status-history").innerHTML = hist.length ?
    '<h3 class="sub-h">' + esc(t("status.history")) + "</h3>" + hist.map((s) =>
      '<div class="snap"><span class="d">' + esc(s.snapshot_date || "") + "</span>" +
      "<span>" + esc(t("status.gpaWord")) + " " + (s.gpa === null || s.gpa === undefined ? "—" : esc(s.gpa)) + " · " + esc(t("status.creditsWord")) + " " +
      (s.credits_done === null || s.credits_done === undefined ? "—" : esc(s.credits_done)) + " / " +
      (s.credits_total === null || s.credits_total === undefined ? "—" : esc(s.credits_total)) +
      (s.note ? '<span class="note">' + esc(s.note) + "</span>" : "") + "</span></div>").join("")
    : "";
}
/* 进步曲线：由快照序列（时间升序）绘 SVG 折线 + 最新学分进度环。
 * 快照 <2 条时只给单点说明，不画假线；GPA 点 <2 时同样不画线。纯前端计算。 */
function ringSVG(done, total) {
  const C = 2 * Math.PI * 30;
  const p = pct(done, total);
  return '<svg class="ring" viewBox="0 0 80 80" width="76" height="76" role="img" aria-label="' + esc(t("status.ring")) + '">' +
    '<circle cx="40" cy="40" r="30" fill="none" stroke="#eef0ec" stroke-width="9"/>' +
    '<circle cx="40" cy="40" r="30" fill="none" stroke="#16453a" stroke-width="9" stroke-linecap="round" ' +
    'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - p / 100)).toFixed(1) + '" transform="rotate(-90 40 40)"/>' +
    '<text x="40" y="45" text-anchor="middle" font-size="15" font-weight="700" fill="#16453a">' + p + "%</text></svg>";
}
function gpaSVG(pts) {
  const W = 320, H = 118, PL = 10, PR = 10, PT = 18, PB = 20;
  const vals = pts.map((s) => Number(s.gpa));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 0.4) { const mid = (hi + lo) / 2; lo = mid - 0.2; hi = mid + 0.2; }
  lo -= 0.1; hi += 0.1;
  const X = (i) => PL + (W - PL - PR) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
  const Y = (v) => PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo));
  const coords = pts.map((s, i) => X(i).toFixed(1) + "," + Y(Number(s.gpa)).toFixed(1)).join(" ");
  const dots = pts.map((s, i) =>
    '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(Number(s.gpa)).toFixed(1) + '" r="3.5" fill="#16453a"/>' +
    '<text x="' + X(i).toFixed(1) + '" y="' + (Y(Number(s.gpa)) - 7).toFixed(1) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#16453a">' + esc(s.gpa) + "</text>"
  ).join("");
  const first = pts[0], last = pts[pts.length - 1];
  const dates = '<text x="' + X(0) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="9.5" fill="#6b7a72">' + esc(first.snapshot_date || "") + "</text>" +
    (pts.length > 1 ? '<text x="' + X(pts.length - 1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="9.5" fill="#6b7a72">' + esc(last.snapshot_date || "") + "</text>" : "");
  return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(t("status.curve")) + '">' +
    '<polyline points="' + coords + '" fill="none" stroke="#16453a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots + dates + "</svg>";
}
function renderCurve(st) {
  const box = $("status-curve");
  const snaps = st.history || []; // 接口按时间倒序
  if (!snaps.length) { box.innerHTML = ""; return; }
  const latest = snaps[0];
  const asc = snaps.slice().reverse();
  let html = "";
  if (latest.credits_total !== null && latest.credits_total !== undefined && latest.credits_done !== null && latest.credits_done !== undefined) {
    html += '<div class="curve-flex">' + ringSVG(latest.credits_done, latest.credits_total) +
      '<div><div class="curve-ring-label">' + esc(t("status.ring")) + "</div>" +
      '<div class="mut">' + esc(latest.credits_done) + " / " + esc(latest.credits_total) + " " + esc(t("status.creditsWord")) + "</div></div></div>";
  }
  const gpaPts = asc.filter((s) => s.gpa !== null && s.gpa !== undefined);
  if (snaps.length >= 2 && gpaPts.length >= 2) {
    html += '<h3 class="sub-h">' + esc(t("status.curve")) + " · " + esc(t("status.gpaWord")) + "</h3>" + gpaSVG(gpaPts);
  } else if (snaps.length < 2) {
    html += '<p class="mut" style="margin:10px 0 0">' + esc(t("status.single")) + "</p>";
  }
  box.innerHTML = html;
}
function renderCoursesDone(d) {
  const list = (d.courses && d.courses.list) || [];
  const doneL = list.filter((c) => c.status === "done");
  const onL = list.filter((c) => c.status === "ongoing" || c.status === "enrolled");
  $("courses-done-summary").innerHTML = (doneL.length || onL.length)
    ? '<p style="margin:0">' + esc(fmt("cdone.summary", { a: doneL.length, b: onL.length })) + "</p>"
    : '<p class="empty">' + esc(t("cdone.empty")) + "</p>";
  const rows = onL.concat(doneL);
  $("courses-done-list").innerHTML = rows.map((c) =>
    '<div class="course"><span class="code">' + esc(c.course_code || "") + "</span>" +
    '<span class="name">' + esc(c.course_name || "") +
    (c.note ? '<span class="mut">（' + esc(c.note) + "）</span>" : "") + "</span>" +
    '<span class="cr">' + esc(c.term || "") + "</span>" +
    (c.grade ? '<span class="grade">' + esc(c.grade) + "</span>" : "") +
    '<span class="st st-' + esc(c.status || "planned") + '">' + esc(c.status_label || "") + "</span></div>"
  ).join("");
}

/* —— 页3 规划 —— */
function renderPlan(d) {
  // 人生线
  const lines = d.goal_lines || [];
  const g = d.goal;
  const goalsSec = $("sec-goals");
  if (!lines.length && !g) { goalsSec.hidden = true; } else {
    goalsSec.hidden = false;
    $("goal-lines").innerHTML = lines.length ? lines.map((l) =>
      '<div class="line-item"><div class="line-prio">' + esc(l.priority) + "</div>" +
      '<div class="line-body"><div class="line-top">' +
      '<span class="line-name">' + esc(l.name) + "</span>" +
      '<span class="pill type-' + esc(l.line_type) + '">' + esc(l.line_type_label || "") + "</span>" +
      (l.status_label ? '<span class="line-status">' + esc(l.status_label) + "</span>" : "") +
      "</div>" +
      (l.next_step ? '<div class="line-next">' + esc(fmt("lines.next", { x: l.next_step })) + "</div>" : "") +
      "</div></div>").join("")
      : '<p class="empty">' + esc(t("lines.empty")) + "</p>";
  }
  // 愿景板：vision_text 与目标都空 → 不渲染
  const vsec = $("sec-vision");
  const hasVision = !!(d.vision_text || (g && g.target_school));
  if (hasVision) {
    vsec.hidden = false;
    $("vision-text").textContent = d.vision_text || "";
    $("vision-text").hidden = !d.vision_text;
    $("vision-goal").innerHTML = g && g.target_school
      ? '<div class="vision-goal"><span class="mut">' + esc(t("goal.fSchool")) + "</span><b>" + esc(g.target_school) + "</b></div>"
      : "";
  } else { vsec.hidden = true; }
  // 学业目标详情
  const gdSec = $("sec-goal-detail");
  const hasGoal = !!(g && (g.target_school || g.target_term || g.gpa_target || g.goal_note));
  if (hasGoal) {
    gdSec.hidden = false;
    $("goal-detail").innerHTML = (() => {
      const facts = [];
      if (g.target_school) facts.push('<span class="fact">' + esc(t("goal.fSchool")) + "<b>" + esc(g.target_school) + "</b></span>");
      if (g.target_term) facts.push('<span class="fact">' + esc(t("goal.fTerm")) + "<b>" + esc(g.target_term) + "</b></span>");
      if (g.gpa_target) facts.push('<span class="fact">' + esc(t("goal.fGpa")) + "<b>" + esc(g.gpa_target) + "</b></span>");
      return (facts.length ? '<div class="goal-facts">' + facts.join("") + "</div>" : "") +
        (g.goal_note ? '<div class="goal-note">' + esc(g.goal_note) + "</div>" : "");
    })();
  } else { gdSec.hidden = true; }
  renderCoursesPlan(d);
  // 导师建议：无数据不渲染
  const adv = d.advice || [];
  const asec = $("sec-advice");
  if (adv.length) {
    asec.hidden = false;
    $("advice-list").innerHTML = adv.map((a) =>
      '<div class="advice-item"><div class="advice-top">' +
      '<span class="advice-title">' + esc(a.title) + "</span>" +
      (a.created_at ? '<span class="advice-date">' + esc(String(a.created_at).slice(0, 10)) + "</span>" : "") +
      "</div>" +
      (a.body ? '<div class="advice-body">' + esc(a.body) + "</div>" : "") +
      "</div>").join("");
  } else { asec.hidden = true; }
  renderProblemsEntry(d);
  renderMatchEntry(d);
  // 整页空 → 占位
  const has = lines.length || hasVision || hasGoal || adv.length ||
    (d.problems || []).length || (d.course_match || []).length ||
    ((d.courses && d.courses.list) || []).length;
  const ep = $("empty-plan");
  ep.hidden = !!has;
  if (!has) ep.textContent = t("page.empty");
}
function renderCoursesPlan(d) {
  const c = d.courses || { progress: {}, groups: [], list: [] };
  const p = c.progress || {};
  const labels = LANG === "en" ? KIND_LABELS_EN : KIND_LABELS;
  const byId = new Map((c.list || []).map((x) => [x.id, x]));
  const kindRows = Object.keys(KIND_LABELS).map((k) => {
    const kk = (p.byKind || {})[k];
    if (!kk || !kk.total) return "";
    return '<div class="row"><div class="l"><span>' + esc(labels[k]) + "</span><span>" +
      esc(fmt("courses.kind", { a: kk.done, b: kk.total, c: kk.creditsDone, d: kk.credits })) + "</span></div>" +
      bar(kk.done, kk.total) + "</div>";
  }).join("");
  $("course-progress").innerHTML =
    "<p style=\"margin:0\">" + esc(fmt("courses.summary", {
      a: p.creditsDone || 0, b: p.creditsTotal || 0, c: p.prereqDone || 0, d: p.prereqTotal || 0,
    })) + "</p>" +
    (kindRows ? '<div class="kind-bars">' + kindRows + "</div>" : "");
  $("course-groups").innerHTML = (c.groups || []).length ? (c.groups || []).map((gr) => {
    const items = gr.courses.map((raw) => byId.get(raw.id) || raw);
    const sumCr = items.reduce((a, x) => a + (Number(x.credits) || 0), 0);
    return '<div class="term-title">' + esc(gr.term) + '<span class="mut">' +
      esc(fmt("courses.termMeta", { a: items.length, b: sumCr })) + "</span></div>" +
      items.map((x) =>
        '<div class="course"><span class="code">' + esc(x.course_code || "") + "</span>" +
        '<span class="name">' + esc(x.course_name || "") +
        (x.note ? '<span class="mut">（' + esc(x.note) + "）</span>" : "") + "</span>" +
        '<span class="cr">' + (x.credits === null || x.credits === undefined ? "" : esc(x.credits) + esc(t("courses.unit"))) + "</span>" +
        (x.grade ? '<span class="grade">' + esc(x.grade) + "</span>" : "") +
        '<span class="st st-' + esc(x.status || "planned") + '">' + esc(x.status_label || "") + "</span></div>"
      ).join("");
  }).join("") : '<p class="empty">' + esc(t("courses.empty")) + "</p>";
}

/* —— 页4 导师 —— */
function renderMentor(d) {
  const ks = d.knowledge || [];
  const ksec = $("sec-knowledge");
  if (ks.length) {
    ksec.hidden = false;
    $("knowledge-list").innerHTML = ks.map((k) =>
      '<div class="know-item"><div class="know-top">' +
      '<span class="know-title">' + esc(k.title) + "</span>" +
      (k.tag ? '<span class="pill">' + esc(k.tag) + "</span>" : "") +
      "</div>" +
      (k.body ? '<div class="know-body">' + esc(k.body) + "</div>" : "") +
      "</div>").join("");
  } else { ksec.hidden = true; }
  renderThread(d);
}
function renderThread(d) {
  const msgs = (d && d.messages) || [];
  const box = $("msg-thread");
  if (!msgs.length) {
    box.innerHTML = '<p class="empty">' + esc(t("msg.emptyThread")) + "</p>";
    return;
  }
  box.innerHTML = msgs.map((m) => {
    const mine = m.sender === "student";
    const who = mine ? t("msg.you") : t("msg.mentor");
    const when = m.created_at ? String(m.created_at).slice(0, 16).replace("T", " ") : "";
    return '<div class="msg-row ' + (mine ? "mine" : "mentor") + '">' +
      '<div class="msg-meta">' + esc(who) + (when ? " · " + esc(when) : "") + "</div>" +
      '<div class="msg-bubble">' + esc(m.body) + "</div></div>";
  }).join("");
}
function showMsgErr(text) {
  const e = $("msg-err");
  if (text) { e.textContent = text; e.hidden = false; } else { e.hidden = true; }
}
async function sendMessage(ev) {
  ev.preventDefault();
  const input = $("msg-input");
  const text = input.value.trim();
  if (!text) { showMsgErr(t("msg.errEmpty")); return; }
  if ([...text].length > 500) { showMsgErr(t("msg.errTooLong")); return; }
  const btn = $("msg-send");
  btn.disabled = true; btn.textContent = t("msg.sending");
  showMsgErr("");
  const { s, k, api } = creds();
  try {
    const resp = await fetch(api + "/api/client/message", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ s, key: k, body: text }),
    });
    if (resp.status === 404) { showMsgErr(t("msg.errGone")); return; }
    if (resp.status === 429) { showMsgErr(t("msg.errFreq")); return; }
    if (!resp.ok) { showMsgErr(t("msg.errNet")); return; }
    const j = await resp.json();
    if (!j || j.ok !== true) { showMsgErr(t("msg.errNet")); return; }
    if (lastData) {
      lastData.messages = (lastData.messages || []).concat([j.message]);
      renderThread(lastData);
    }
    input.value = "";
    $("msg-count").textContent = "0 / 500";
  } catch (e) {
    showMsgErr(t("msg.errNet"));
  } finally {
    btn.disabled = false; btn.textContent = t("msg.send");
  }
}

/* ================= v12：驾驶舱 / 私密空间 / 问题解决 / 导师轨迹 / 课程匹配 / 动态分享 / 语音 =================
 * 数据边界：私密正文只在本机（private.js / IndexedDB）；本块对服务器的写只有三个既有口径的扩展——
 * 问题方案同步（逐项确认）、导师轨迹学生侧、既有留言。家长端不读本块任何数据。 */
const REQ_BLOCK_LABELS = {
  zh: { gened: "通识", prereq: "专业先修", core: "专业核心", elective: "选修" },
  en: { gened: "General Ed", prereq: "Prerequisites", core: "Core", elective: "Electives" },
};
const TRAIL_ROLE_KEYS = { lead: "trail.role.lead", teacher: "trail.role.teacher", industry: "trail.role.industry", coach: "trail.role.coach", elder: "trail.role.elder", other: "trail.role.other" };

async function apiPost(path, payload) {
  const { s, k, api } = creds();
  try {
    const resp = await fetch(api + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(Object.assign({ s, key: k }, payload || {})),
    });
    let j = null;
    try { j = await resp.json(); } catch (e) { /* 非 JSON 响应按失败处理 */ }
    return Object.assign({}, j || {}, { status: resp.status, ok: resp.ok && !!j && j.ok === true });
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

/* —— 语音输入（第九节）：Web Speech API 是浏览器厂商云端识别，音频离开设备——
 * 因此任何作用域都默认关闭：首次点击先出明示告知，学生点「开启」才可用；私密作用域用更强的告知文案。
 * 不支持的浏览器：按钮置灰并给原因，键盘输入不受影响。识别结果只填入输入框，永不直存直发。 */
function attachVoice(textarea, opts) {
  if (!textarea || textarea.dataset.voiceWired) return;
  textarea.dataset.voiceWired = "1";
  const scope = (opts && opts.scope) || "public";
  const mount = (opts && opts.mount) || textarea.parentElement;
  const LSKey = scope === "private" ? "ooo_voice_priv" : "ooo_voice_pub";
  const box = document.createElement("div");
  box.className = "voice-box";
  box.innerHTML = '<button type="button" class="mic-btn">🎤 ' + esc(t("voice.btn")) + '</button><div class="voice-note" hidden></div>';
  mount.appendChild(box);
  const btn = box.querySelector(".mic-btn");
  const note = box.querySelector(".voice-note");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.disabled = true;
    note.hidden = false;
    note.textContent = t("voice.unsupported");
    return;
  }
  let rec = null, listening = false;
  const enabled = () => { try { return localStorage.getItem(LSKey) === "1"; } catch (e) { return false; } };
  function showNote() {
    note.hidden = false;
    note.innerHTML = "<span>" + esc(scope === "private" ? t("voice.notePrivate") : t("voice.note")) + "</span> " +
      '<button type="button" class="btn-ghost small" data-vact="enable">' + esc(t("voice.enable")) + "</button>" +
      (enabled() ? ' <button type="button" class="btn-ghost small" data-vact="off">' + esc(t("voice.off")) + "</button>" : "");
    note.querySelector('[data-vact="enable"]').addEventListener("click", () => {
      try { localStorage.setItem(LSKey, "1"); } catch (e) { /* 忽略 */ }
      note.hidden = true;
      start();
    });
    const off = note.querySelector('[data-vact="off"]');
    if (off) off.addEventListener("click", () => {
      try { localStorage.setItem(LSKey, "0"); } catch (e) { /* 忽略 */ }
      note.hidden = true;
    });
  }
  function start() {
    if (listening) { if (rec) { try { rec.stop(); } catch (e) { /* 忽略 */ } } return; }
    if (!enabled()) { showNote(); return; }
    rec = new SR();
    rec.lang = LANG === "zh" ? "zh-CN" : "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      const txt = (ev.results && ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript) || "";
      if (!txt) return;
      const s0 = textarea.selectionStart || textarea.value.length;
      const e0 = textarea.selectionEnd || s0;
      textarea.setRangeText(txt, s0, e0, "end");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };
    rec.onerror = (ev) => {
      listening = false;
      btn.classList.remove("on");
      btn.innerHTML = "🎤 " + esc(t("voice.btn"));
      if (ev && (ev.error === "not-allowed" || ev.error === "service-not-allowed")) {
        note.hidden = false;
        note.textContent = t("voice.denied");
      }
    };
    rec.onend = () => {
      listening = false;
      btn.classList.remove("on");
      btn.innerHTML = "🎤 " + esc(t("voice.btn"));
    };
    try {
      rec.start();
      listening = true;
      btn.classList.add("on");
      btn.innerHTML = "⏹ " + esc(t("voice.stop"));
    } catch (e) { /* 启动失败保持键盘可用 */ }
  }
  btn.addEventListener("click", start);
}

/* —— 独立视图（sheet）管理 —— */
const SHEETS = ["view-private", "view-problems", "view-trail", "view-match", "view-share"];
function openSheet(id) {
  for (const s of SHEETS) { const el = $(s); if (el) el.hidden = s !== id; }
  window.scrollTo(0, 0);
}
function closeSheets() {
  for (const s of SHEETS) { const el = $(s); if (el) el.hidden = true; }
}
let privCtl = null, probCtl = null;
function openPrivateSheet() {
  openSheet("view-private");
  if (!privCtl) privCtl = OOOPrivate.mount($("private-body"), OOO);
  else privCtl.refresh();
}
function openProblemsSheet(prefill) {
  openSheet("view-problems");
  if (!probCtl) probCtl = OOOProblems.mount($("problems-body"), OOO);
  else probCtl.refresh();
  if (prefill) probCtl.applyPrefill(prefill);
}

/* —— 模块 hooks（private.js / problems.js 只通过这里碰网络与全局状态）—— */
const OOO = {
  t, fmt, esc,
  lang: () => LANG,
  getData: () => lastData,
  attachVoice,
  gotoTab: (name) => { closeSheets(); switchTab(name); },
  openShareText: (text, opts) => openShareText(text, opts),
  openProblems: (prefill) => openProblemsSheet(prefill),
  riskCheck: (text) => OOOPrivate.checkRisk(text),
  onRiskHit: () => { openPrivateSheet(); if (privCtl && privCtl.showCare) privCtl.showCare(); },
  privateAddDraft: async ({ body, tags }) => {
    const now = OOOPrivate.nowIso();
    const e = await OOOPrivate.add({
      local_id: OOOPrivate.newId(), type: "problem_draft", body: body || "",
      mood_tag: null, problem_tags: tags || [], created_at: now, updated_at: now,
    });
    return e.local_id;
  },
  syncProblem: async (payload) => {
    const out = await apiPost("/api/client/problem", payload);
    if (out.ok && out.problem && lastData) {
      lastData.problems = [out.problem].concat((lastData.problems || []).filter((p) => p.id !== out.problem.id));
      renderObstacles(lastData);
      renderProblemsEntry(lastData);
      renderDream(lastData);
    }
    return out;
  },
  problemStatus: async (id, progress, note) => {
    const out = await apiPost("/api/client/problem/status", { id, progress, resolved_note: note || "" });
    if (out.ok && out.problem && lastData) {
      lastData.problems = (lastData.problems || []).map((p) => (p.id === out.problem.id ? out.problem : p));
      renderObstacles(lastData);
      renderProblemsEntry(lastData);
      if (renderedTabs.growth === LANG) renderFeed(lastData);
    }
    return out;
  },
  escalateProblem: async (text, problemId) => {
    const out = await apiPost("/api/client/message", { body: text });
    if (out.ok && lastData && out.message) {
      lastData.messages = (lastData.messages || []).concat([out.message]);
      if (renderedTabs.mentor === LANG) renderThread(lastData);
      if (problemId) await OOO.problemStatus(problemId, "escalated", "");
    }
    return out;
  },
  onPrivateChange: () => { renderTodayWidget(); },
};

/* —— 首页驾驶舱：梦想距离（蓝图第五节：只用可核实数据，清单式，严禁百分比）—— */
function renderDream(d) {
  const box = $("dream-body");
  if (!box) return;
  const vision = d.vision_text || (d.goal && d.goal.target_school) || "";
  const ms = d.milestones || [];
  const acts = d.actions || [];
  const doneActs = acts.filter((a) => a.status === "done");
  const todoActs = acts.filter((a) => a.status !== "done");
  const latest = d.status && d.status.latest;
  let html = "";
  html += '<div class="dream-row"><span class="dream-k">' + esc(t("dream.endpoint")) + '</span><span class="dream-v">' +
    (vision ? esc(vision) : esc(t("dream.noVision"))) + "</span></div>";
  if (ms.length) {
    html += '<div class="dream-row"><span class="dream-k">' + esc(t("dream.crossed")) + '</span><span class="dream-v">✓ ' +
      ms.map((m) => esc(m.title)).join(" · ✓ ") + "</span></div>";
  }
  const upcoming = (d.key_dates || []).filter((k) => { const n = dayDiff(k.date); return n !== null && n >= 0; })[0];
  const nowText = upcoming ? upcoming.title + "（" + upcoming.date + "）"
    : (d.main_line && d.main_line.next_step ? d.main_line.next_step : "");
  if (nowText) {
    html += '<div class="dream-row"><span class="dream-k">' + esc(t("dream.now")) + '</span><span class="dream-v">→ ' + esc(nowText) + "</span></div>";
  }
  const left = [];
  for (const a of todoActs.slice(0, 5)) left.push("· " + esc(a.title));
  if (todoActs.length > 5) left.push("· " + esc(fmt("dream.moreSteps", { n: todoActs.length - 5 })));
  const openExams = (d.exams || []).filter((e) => e.result !== "pass");
  if (openExams.length) left.push("· " + esc(fmt("dream.examFact", { n: openExams.length })));
  if (latest && latest.credits_total && latest.credits_done !== null && latest.credits_done !== undefined &&
      latest.credits_total > latest.credits_done) {
    left.push("· " + esc(fmt("dream.creditsFact", {
      x: latest.credits_total - latest.credits_done, a: latest.credits_done, b: latest.credits_total,
    })));
  }
  const openProbs = (d.problems || []).filter((p) => p.progress !== "resolved");
  if (openProbs.length) left.push("· " + esc(fmt("dream.probFact", { n: openProbs.length })));
  if (left.length) {
    html += '<div class="dream-row"><span class="dream-k">' + esc(t("dream.left")) + '</span><span class="dream-v">' + left.join("<br>") + "</span></div>";
  } else if (!ms.length) {
    html += '<p class="mut" style="margin:8px 0 0">' + esc(t("dream.noSteps")) + "</p>";
  } else {
    html += '<p class="mut" style="margin:8px 0 0">' + esc(t("dream.allDone")) + "</p>";
  }
  const win = doneActs.length ? doneActs[doneActs.length - 1].title : (ms.length ? ms[ms.length - 1].title : "");
  if (win) {
    html += '<div class="dream-row"><span class="dream-k">' + esc(t("dream.win")) + '</span><span class="dream-v">✓ ' + esc(win) + "</span></div>";
  }
  box.innerHTML = html;
}

/* —— 首页：当前障碍（问题解决中心未关闭的问题，方案层）—— */
function renderObstacles(d) {
  const box = $("obstacles-body");
  if (!box) return;
  const open = (d.problems || []).filter((p) => p.progress !== "resolved").slice(0, 3);
  box.innerHTML = open.length ? open.map((p) =>
    '<div class="pb-item"><div class="priv-meta"><span class="pill">' + esc(p.domain_label || "") + '</span>' +
    '<span class="badge ' + (p.progress === "escalated" ? "fail" : "pending") + '">' + esc(p.progress_label || "") + "</span>" +
    (p.compliance === "pending_review" ? '<span class="pill review">' + esc(t("pb.reviewTag")) + "</span>" : "") +
    '</div><div class="pb-item-title">' + esc(p.title || "") + "</div></div>").join("")
    : '<p class="mut" style="margin:0 0 10px">' + esc(t("obstacles.none")) + "</p>";
}

/* —— 首页：今日状态（私密层，心情 5 档 + 一句话；连续天数本地算）—— */
let todayMood = 0, todayEntryId = null, todayWired = false, todaySaveWired = false;
async function renderTodayWidget() {
  const box = $("today-moods");
  if (!box) return;
  if (!todayWired) {
    todayWired = true;
    box.innerHTML = [1, 2, 3, 4, 5].map((n) =>
      '<button type="button" class="mood-btn" data-mood="' + n + '">' + esc(t("today.m" + n)) + "</button>").join("");
    box.querySelectorAll(".mood-btn").forEach((b) => b.addEventListener("click", () => {
      todayMood = Number(b.getAttribute("data-mood"));
      box.querySelectorAll(".mood-btn").forEach((x) => x.classList.toggle("on", x === b));
    }));
    attachVoice($("today-line"), { scope: "private", mount: $("today-mic") });
  }
  if (!todaySaveWired) {
    todaySaveWired = true;
    $("today-save").addEventListener("click", async () => {
      const line = $("today-line").value.trim();
      if (!todayMood && !line) return;
      const now = OOOPrivate.nowIso();
      try {
        if (todayEntryId) {
          const prev = await OOOPrivate.get(todayEntryId);
          await OOOPrivate.put(Object.assign({}, prev || {}, {
            mood_tag: todayMood || (prev && prev.mood_tag) || null, body: line, updated_at: now,
          }));
        } else {
          const e = await OOOPrivate.add({
            local_id: OOOPrivate.newId(), type: "mood", body: line,
            mood_tag: todayMood || null, problem_tags: [], created_at: now, updated_at: now,
          });
          todayEntryId = e.local_id;
        }
      } catch (e) { /* 本机存储不可用时静默失败，不假装已存 */ return; }
      if (OOOPrivate.checkRisk(line)) { openPrivateSheet(); if (privCtl && privCtl.showCare) privCtl.showCare(); }
      renderTodayWidget();
    });
  }
  try {
    const entries = await OOOPrivate.all();
    const today = localDateStr();
    const mine = entries.filter((e) => e.type === "mood" && OOOPrivate.localDay(e.created_at) === today);
    const latestE = mine[0] || null;
    todayEntryId = latestE ? latestE.local_id : null;
    if (latestE) {
      todayMood = latestE.mood_tag ? Number(latestE.mood_tag) : 0;
      if (!$("today-line").value) $("today-line").value = latestE.body || "";
    }
    box.querySelectorAll(".mood-btn").forEach((x) =>
      x.classList.toggle("on", Number(x.getAttribute("data-mood")) === todayMood));
    const days = OOOPrivate.streakDays(entries);
    $("today-status").textContent =
      (latestE ? t("today.saved") : "") + (days > 0 ? (latestE ? " · " : "") + fmt("today.streak", { n: days }) : "");
  } catch (e) { /* IndexedDB 不可用：控件保留，状态区留空 */ }
}

/* —— 成长：我的动态（蓝图第六节：只由事实事件生成）—— */
function buildFeed(d) {
  const evs = [];
  for (const a of d.actions || []) {
    if (a.status === "done") evs.push({ id: "act-" + a.id, type: "action", date: String(a.updated_at || "").slice(0, 10), title: a.title || "" });
  }
  for (const m of d.milestones || []) {
    evs.push({ id: "ms-" + m.id, type: "milestone", date: String(m.created_at || "").slice(0, 10), title: m.title || "", dateText: m.date_text || "" });
  }
  for (const p of d.problems || []) {
    if (p.progress === "resolved") evs.push({ id: "pr-" + p.id, type: "problem", date: String(p.updated_at || "").slice(0, 10), title: p.title || "" });
  }
  for (const tr of d.mentor_trail || []) {
    if (tr.visibility !== "private" && tr.spirit_line) {
      evs.push({ id: "tr-" + tr.id, type: "trail", date: tr.meeting_date || String(tr.created_at || "").slice(0, 10), title: tr.spirit_line, name: tr.mentor_name || "" });
    }
  }
  return evs;
}
function feedText(ev) {
  if (ev.type === "action") return t("feed.tAction") + "：" + ev.title;
  if (ev.type === "milestone") return t("feed.tMilestone") + "：" + ev.title;
  if (ev.type === "problem") return t("feed.tProblem") + "：" + ev.title;
  if (ev.type === "trail") return fmt("feed.tTrail", { name: ev.name || "" }) + "：" + ev.title;
  if (ev.type === "streak") return fmt("feed.tStreak", { n: ev.days });
  return ev.title || "";
}
const LS_FEED = "ooo_feed_prefs";
function feedPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_FEED) || "{}") || {}; } catch (e) { return {}; }
}
function saveFeedPrefs(p) {
  try { localStorage.setItem(LS_FEED, JSON.stringify(p)); } catch (e) { /* 忽略 */ }
}
async function renderFeed(d) {
  const listBox = $("feed-list");
  if (!listBox) return;
  const prefs = feedPrefs();
  prefs.hidden = prefs.hidden || [];
  prefs.typesOff = prefs.typesOff || [];
  let evs = buildFeed(d);
  try {
    const entries = await OOOPrivate.all();
    const days = OOOPrivate.streakDays(entries);
    if (days >= 2) evs.push({ id: "streak-" + localDateStr(), type: "streak", date: localDateStr(), days });
  } catch (e) { /* 本机不可用则无连续记录动态 */ }
  evs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const types = ["action", "milestone", "problem", "trail", "streak"];
  const typeName = { action: t("feed.tAction"), milestone: t("feed.tMilestone"), problem: t("feed.tProblem"), trail: t("card.trail"), streak: t("card.today") };
  $("feed-settings").innerHTML = '<div class="feed-types">' + types.map((ty) =>
    '<label class="chk"><input type="checkbox" class="feed-ty" value="' + ty + '"' +
    (prefs.typesOff.includes(ty) ? "" : " checked") + "> " + esc(typeName[ty]) + "</label>").join("") + "</div>";
  $("feed-settings").querySelectorAll(".feed-ty").forEach((c) => c.addEventListener("change", () => {
    const off = [...$("feed-settings").querySelectorAll(".feed-ty")].filter((x) => !x.checked).map((x) => x.value);
    const p2 = feedPrefs(); p2.typesOff = off; saveFeedPrefs(p2);
    if (lastData) renderFeed(lastData);
  }));
  const visible = evs.filter((e) => !prefs.hidden.includes(e.id) && !prefs.typesOff.includes(e.type));
  listBox.innerHTML = visible.length ? visible.map((ev) =>
    '<div class="feed-item"><div class="feed-main"><div class="feed-text">' + esc(feedText(ev)) + "</div>" +
    '<div class="mut">' + esc(ev.dateText || ev.date || "") + "</div></div>" +
    '<div class="feed-actions">' +
    '<button type="button" class="btn-ghost small" data-share="' + esc(ev.id) + '">' + esc(t("feed.share")) + "</button>" +
    '<button type="button" class="btn-ghost small" data-hide="' + esc(ev.id) + '">' + esc(t("feed.hide")) + "</button>" +
    "</div></div>").join("")
    : '<p class="empty">' + esc(t("feed.empty")) + "</p>";
  listBox.querySelectorAll("[data-share]").forEach((b) => b.addEventListener("click", () => {
    const ev = visible.find((x) => x.id === b.getAttribute("data-share"));
    if (ev) openShareText(feedText(ev), {});
  }));
  listBox.querySelectorAll("[data-hide]").forEach((b) => b.addEventListener("click", () => {
    const p2 = feedPrefs();
    p2.hidden = (p2.hidden || []).concat([b.getAttribute("data-hide")]);
    saveFeedPrefs(p2);
    if (lastData) renderFeed(lastData);
  }));
}

/* —— 成长：导师轨迹入口卡 + 轨迹视图（蓝图第八节）—— */
function trailDueCount(entries) {
  const today = localDateStr();
  return (entries || []).filter((e) => !e.revisit_result && e.revisit_due && e.revisit_due <= today).length;
}
function renderTrailEntry(d) {
  const box = $("trail-entry-body");
  if (!box) return;
  const entries = d.mentor_trail || [];
  if (!entries.length) {
    box.innerHTML = '<p class="mut" style="margin:0 0 10px">' + esc(t("trail.empty")) + "</p>";
    return;
  }
  const latestE = entries[0];
  const due = trailDueCount(entries);
  box.innerHTML =
    '<div class="trail-latest"><span class="mut">' + esc(t("trail.latest")) + '</span>' +
    '<div class="trail-spirit">「' + esc(latestE.spirit_line || "") + '」</div>' +
    '<div class="mut">' + esc(latestE.mentor_name || "") +
    (latestE.meeting_date ? " · " + esc(latestE.meeting_date) : "") + "</div></div>" +
    (due ? '<p class="trail-due">' + esc(fmt("trail.due", { n: due })) + "</p>" : "");
}
let trailFilter = "";
function renderTrailSheet() {
  const body = $("trail-body");
  const d = lastData || {};
  const entries = d.mentor_trail || [];
  const names = [...new Set(entries.map((e) => e.mentor_name).filter(Boolean))];
  const due = trailDueCount(entries);
  const list = trailFilter ? entries.filter((e) => e.mentor_name === trailFilter) : entries;
  const roleOpts = Object.keys(TRAIL_ROLE_KEYS).map((r) =>
    '<option value="' + r + '">' + esc(t(TRAIL_ROLE_KEYS[r])) + "</option>").join("");
  body.innerHTML =
    '<section class="card">' +
      (due ? '<p class="trail-due" style="margin-top:0">' + esc(fmt("trail.due", { n: due })) + "</p>" : "") +
      '<label class="fld"><span>' + esc(t("trail.filterAll")) + '</span><select id="trail-filter">' +
        '<option value="">' + esc(t("trail.filterAll")) + "</option>" +
        names.map((n) => '<option value="' + esc(n) + '"' + (n === trailFilter ? " selected" : "") + ">" + esc(n) + "</option>").join("") +
      "</select></label>" +
      '<div id="trail-list">' +
      (list.length ? list.map((e) => trailItemHtml(e)).join("") : '<p class="empty">' + esc(t("trail.empty")) + "</p>") +
      "</div>" +
    "</section>" +
    '<section class="card"><h2>' + esc(t("trail.createTitle")) + "</h2>" +
      '<form id="trail-create">' +
        '<div class="pb-sliders">' +
          '<label class="fld"><span>' + esc(t("trail.fName")) + '</span><input id="tc-name" maxlength="40" required></label>' +
          '<label class="fld"><span>' + esc(t("trail.fRole")) + '</span><select id="tc-role">' + roleOpts + "</select></label>" +
        "</div>" +
        '<label class="fld"><span>' + esc(t("trail.fSpirit")) + '</span><input id="tc-spirit" maxlength="60" required placeholder="' + esc(t("trail.phSpirit")) + '"></label>' +
        '<label class="fld"><span>' + esc(t("trail.fJudgments")) + '</span><textarea id="tc-judgments" rows="2" maxlength="2000"></textarea></label>' +
        '<label class="fld"><span>' + esc(t("trail.fFollow")) + '</span><textarea id="tc-follow" rows="2" maxlength="2000"></textarea></label>' +
        '<label class="fld"><span>' + esc(t("trail.takeaway")) + '</span><textarea id="tc-takeaway" rows="2" maxlength="2000"></textarea></label>' +
        '<div id="tc-mic"></div>' +
        '<label class="chk"><input type="checkbox" id="tc-local"> ' + esc(t("trail.takeawayLocal")) + "</label>" +
        '<div class="priv-actions"><button type="submit" class="btn-primary">' + esc(t("trail.createBtn")) + '</button><span class="mut" id="tc-msg"></span></div>' +
      "</form>" +
    "</section>";
  $("trail-filter").addEventListener("change", () => { trailFilter = $("trail-filter").value; renderTrailSheet(); });
  attachVoice($("tc-takeaway"), { scope: "public", mount: $("tc-mic") });
  wireTrailItems(body);
  // 本机领受回填：takeaway_local 的条目，正文只在本机私密条目里（标签 trail#<id>）
  OOOPrivate.all().then((rows) => {
    const byTag = {};
    for (const r of rows) {
      for (const tg of r.problem_tags || []) {
        if (String(tg).startsWith("trail#")) byTag[String(tg).slice(6)] = r.body || "";
      }
    }
    body.querySelectorAll("[data-local-tk]").forEach((el) => {
      const id = el.getAttribute("data-local-tk");
      if (byTag[id]) el.textContent = byTag[id];
    });
  }).catch(() => { /* 本机不可用则只显示占位标记 */ });
  $("trail-create").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const localOnly = $("tc-local").checked;
    const payload = {
      action: "create",
      mentor_name: $("tc-name").value.trim(),
      mentor_role: $("tc-role").value,
      spirit_line: $("tc-spirit").value.trim(),
      key_judgments: $("tc-judgments").value.trim(),
      followup_actions: $("tc-follow").value.trim(),
      takeaway_local: localOnly ? 1 : 0,
    };
    if (!localOnly) payload.student_takeaway = $("tc-takeaway").value.trim();
    const out = await apiPost("/api/client/trail", payload);
    if (!out.ok) { $("tc-msg").textContent = t("pb.syncFail"); return; }
    if (localOnly && $("tc-takeaway").value.trim()) {
      const now = OOOPrivate.nowIso();
      await OOOPrivate.add({
        local_id: OOOPrivate.newId(), type: "note", body: $("tc-takeaway").value.trim(),
        mood_tag: null, problem_tags: ["trail#" + out.id], created_at: now, updated_at: now,
      }).catch(() => { /* 本机失败不阻塞主流程 */ });
    }
    if (lastData) {
      lastData.mentor_trail = [{
        id: out.id, meeting_id: null, meeting_date: "", meeting_topic: "",
        mentor_name: payload.mentor_name, mentor_role: payload.mentor_role,
        mentor_role_label: t(TRAIL_ROLE_KEYS[payload.mentor_role] || "trail.role.other"),
        spirit_line: payload.spirit_line, key_judgments: payload.key_judgments,
        student_takeaway: localOnly ? "" : (payload.student_takeaway || ""),
        takeaway_local: localOnly,
        followup_actions: payload.followup_actions, revisit_result: "",
        revisit_due: "", visibility: "mentor", source: "student",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }].concat(lastData.mentor_trail || []);
      renderTrailEntry(lastData);
    }
    renderTrailSheet();
  });
}
function trailItemHtml(e) {
  const due = !e.revisit_result && e.revisit_due && e.revisit_due <= localDateStr();
  const judgments = String(e.key_judgments || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const follows = String(e.followup_actions || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return '<div class="trail-item" data-trail="' + e.id + '">' +
    '<div class="priv-meta"><span class="pill">' + esc(e.mentor_name || "") + '</span>' +
    '<span class="pill">' + esc(e.mentor_role_label || "") + '</span>' +
    (e.meeting_date ? '<span class="mut">' + esc(e.meeting_date) + "</span>" : "") +
    (due ? '<span class="badge pending">' + esc(t("trail.revisitDue")) + "</span>" : "") +
    "</div>" +
    '<div class="trail-spirit">「' + esc(e.spirit_line || "") + '」</div>' +
    (judgments.length ? '<ul class="trail-judge">' + judgments.map((j) => "<li>" + esc(j) + "</li>").join("") + "</ul>" : "") +
    (follows.length ? '<div class="trail-follow">' + follows.map((f) => '<span class="act-check" aria-hidden="true">○</span> ' + esc(f)).join("<br>") + "</div>" : "") +
    '<div class="trail-tk"><div class="pu-sec-label">' + esc(t("trail.takeaway")) + "</div>" +
      (e.takeaway_local
        ? '<div class="mut">' + esc(t("trail.localMark")) + '</div><div class="trail-local-body" data-local-tk="' + e.id + '"></div>'
        : '<div class="trail-tk-body">' + esc(e.student_takeaway || "") + "</div>") +
      '<details class="trail-edit"><summary>' + esc(t("trail.takeaway")) + " · " + esc(t("trail.save")) + "</summary>" +
        '<textarea rows="2" maxlength="2000" data-tk-text="' + e.id + '">' + esc(e.takeaway_local ? "" : (e.student_takeaway || "")) + "</textarea>" +
        '<label class="chk"><input type="checkbox" data-tk-local="' + e.id + '"' + (e.takeaway_local ? " checked" : "") + "> " + esc(t("trail.takeawayLocal")) + "</label>" +
        '<button type="button" class="btn-ghost small" data-tk-save="' + e.id + '">' + esc(t("trail.save")) + "</button>" +
      "</details></div>" +
    '<div class="trail-rv"><div class="pu-sec-label">' + esc(t("trail.revisit")) + "</div>" +
      (e.revisit_result
        ? '<div class="trail-tk-body">' + esc(e.revisit_result) + "</div>"
        : '<div class="trail-rv-form"><input maxlength="500" data-rv-text="' + e.id + '" placeholder="' + esc(e.revisit_due || "") + '">' +
          '<button type="button" class="btn-ghost small" data-rv-save="' + e.id + '">' + esc(t("trail.save")) + "</button></div>") +
    "</div></div>";
}
function wireTrailItems(body) {
  body.querySelectorAll("[data-tk-save]").forEach((b) => b.addEventListener("click", async () => {
    const id = Number(b.getAttribute("data-tk-save"));
    const textEl = body.querySelector('[data-tk-text="' + id + '"]');
    const localEl = body.querySelector('[data-tk-local="' + id + '"]');
    const text = textEl ? textEl.value.trim() : "";
    const localOnly = !!(localEl && localEl.checked);
    if (localOnly) {
      if (text) {
        const rows = await OOOPrivate.all().catch(() => []);
        const prev = rows.find((r) => (r.problem_tags || []).includes("trail#" + id));
        const now = OOOPrivate.nowIso();
        if (prev) await OOOPrivate.put(Object.assign({}, prev, { body: text, updated_at: now })).catch(() => {});
        else await OOOPrivate.add({
          local_id: OOOPrivate.newId(), type: "note", body: text, mood_tag: null,
          problem_tags: ["trail#" + id], created_at: now, updated_at: now,
        }).catch(() => {});
      }
      await apiPost("/api/client/trail", { action: "takeaway", id, takeaway_local: true });
      if (lastData) {
        const e = (lastData.mentor_trail || []).find((x) => x.id === id);
        if (e) { e.takeaway_local = true; e.student_takeaway = ""; }
      }
    } else {
      const out = await apiPost("/api/client/trail", { action: "takeaway", id, takeaway: text });
      if (!out.ok) return;
      if (lastData) {
        const e = (lastData.mentor_trail || []).find((x) => x.id === id);
        if (e) { e.takeaway_local = false; e.student_takeaway = text; }
      }
    }
    renderTrailSheet();
  }));
  body.querySelectorAll("[data-rv-save]").forEach((b) => b.addEventListener("click", async () => {
    const id = Number(b.getAttribute("data-rv-save"));
    const textEl = body.querySelector('[data-rv-text="' + id + '"]');
    const text = textEl ? textEl.value.trim() : "";
    if (!text) return;
    const out = await apiPost("/api/client/trail", { action: "revisit", id, revisit_result: text });
    if (!out.ok) return;
    if (lastData) {
      const e = (lastData.mentor_trail || []).find((x) => x.id === id);
      if (e) e.revisit_result = text;
      renderTrailEntry(lastData);
    }
    renderTrailSheet();
  }));
}

/* —— 规划：问题入口卡 / 课程匹配入口卡 + 匹配视图（蓝图第十三节）—— */
function renderProblemsEntry(d) {
  const box = $("problems-entry-body");
  if (!box) return;
  const open = (d.problems || []).filter((p) => p.progress !== "resolved").length;
  box.innerHTML = open ? '<p style="margin:0 0 10px">' + esc(fmt("problems.openCount", { n: open })) + "</p>" : "";
}
let matchIdx = 0;
function renderMatchEntry(d) {
  const box = $("match-entry-body");
  if (!box) return;
  const sets = d.course_match || [];
  box.innerHTML = sets.length ? sets.map((s) =>
    '<div class="match-line"><span class="match-name">' + esc(s.name) + "</span>" +
    '<span class="mut">' + (s.match
      ? esc(fmt("match.missingFact", { n: s.match.totals.missing }))
      : esc(t("match.unverified"))) + "</span></div>").join("")
    : '<p class="mut" style="margin:0 0 10px">' + esc(t("match.empty")) + "</p>";
}
function renderMatchSheet(idx) {
  if (typeof idx === "number") matchIdx = idx;
  const body = $("match-body");
  const sets = (lastData && lastData.course_match) || [];
  if (!sets.length) {
    body.innerHTML = '<section class="card"><p class="empty">' + esc(t("match.empty")) + "</p></section>";
    return;
  }
  if (matchIdx >= sets.length) matchIdx = 0;
  const s = sets[matchIdx];
  const labels = REQ_BLOCK_LABELS[LANG] || REQ_BLOCK_LABELS.zh;
  let html = '<div class="match-chips">' + sets.map((x, i) =>
    '<button type="button" class="chip' + (i === matchIdx ? " on" : "") + '" data-set="' + i + '">' + esc(x.name) + "</button>").join("") + "</div>";
  html += '<section class="card"><h2>' + esc(s.name) + "</h2>" +
    '<p style="margin:0 0 6px"><span class="badge ' + (s.verified ? "pass" : "pending") + '">' +
    esc(s.verified ? t("match.verified") : t("match.unverified")) + "</span></p>" +
    (s.source_note ? '<p class="mut" style="margin:0">' + esc(t("match.source")) + esc(s.source_note) + "</p>" : "") +
    (s.version_text ? '<p class="mut" style="margin:0">' + esc(t("match.version")) + esc(s.version_text) + "</p>" : "");
  if (!s.match) {
    html += '<p style="margin:12px 0 0">' + esc(t("match.noReq")) + "</p>";
  } else {
    const m = s.match;
    for (const bk of ["prereq", "core", "gened", "elective"]) {
      const b = m.blocks[bk];
      if (!b || !b.total) continue;
      html += '<div class="match-block"><div class="match-block-head"><b>' + esc(labels[bk]) + "</b><span>" +
        esc(fmt("match.blockLine", { a: b.done, b: b.total, c: b.in_progress, d: b.planned, e: b.missing })) + "</span></div>" +
        (b.credits_total > 0 ? '<div class="mut">' + esc(fmt("match.creditsLine", { a: b.credits_done, b: b.credits_total, c: b.credits_missing })) + "</div>" : "") +
        (b.credits_unknown > 0 ? '<div class="mut">' + esc(fmt("match.creditsUnknown", { n: b.credits_unknown })) + "</div>" : "") +
        "</div>";
    }
    if (m.missing.length) {
      html += '<h3 class="sub-h">' + esc(t("match.missingTitle")) + "</h3>" + m.missing.map((x) =>
        '<div class="course"><span class="code">' + esc(x.code) + '</span><span class="name">' + esc(x.name) +
        '</span><span class="cr">' + esc(labels[x.block] || "") + (x.credits !== null && x.credits !== undefined ? " · " + esc(x.credits) + esc(t("courses.unit")) : "") + "</span></div>").join("");
    }
    if (m.grade_warnings.length) {
      html += '<h3 class="sub-h">' + esc(t("match.warnTitle")) + "</h3>" + m.grade_warnings.map((w) =>
        '<p class="match-warn">' + esc(w.kind === "below_min"
          ? fmt("match.belowMin", { code: w.code, g: w.grade, m: w.min_grade })
          : fmt("match.watch", { code: w.code, g: w.grade })) + "</p>").join("");
    }
    if (m.prereq_breaks.length) {
      html += '<h3 class="sub-h">' + esc(t("match.breakTitle")) + "</h3>" + m.prereq_breaks.map((b2) =>
        '<p class="match-warn">' + esc(fmt("match.break", { code: b2.code, p: b2.missing_prereq })) + "</p>").join("");
    }
  }
  html += '<p class="mut" style="margin:14px 0 0">' + esc(t("match.disclaimer")) + "</p></section>";
  body.innerHTML = html;
  body.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => renderMatchSheet(Number(b.getAttribute("data-set")))));
}

/* —— 分享卡（蓝图第六节：本地 Canvas + 文案；学生自行发布，平台不代发）—— */
let shareWired = false;
function updateShareBtns() {
  const all = [...document.querySelectorAll(".share-chk")].every((c) => c.checked);
  $("share-img").disabled = !all;
  $("share-copy").disabled = !all;
  $("share-msg").textContent = all ? "" : t("share.need");
}
function openShareText(text, opts) {
  $("share-text").value = text || "";
  $("share-warn").hidden = !(opts && opts.fromPrivate);
  $("share-preview").hidden = true;
  document.querySelectorAll(".share-chk").forEach((c) => { c.checked = false; });
  openSheet("view-share");
  updateShareBtns();
  if (!shareWired) {
    shareWired = true;
    document.querySelectorAll(".share-chk").forEach((c) => c.addEventListener("change", updateShareBtns));
    $("share-copy").addEventListener("click", async () => {
      const text = $("share-text").value;
      try { await navigator.clipboard.writeText(text); }
      catch (e) {
        $("share-text").select();
        try { document.execCommand("copy"); } catch (e2) { /* 剪贴板不可用时学生可手动复制 */ }
      }
      $("share-msg").textContent = t("share.copied");
    });
    $("share-img").addEventListener("click", () => {
      drawShareCard();
      $("share-msg").textContent = t("share.imgDone");
    });
  }
}
function drawShareCard() {
  const cv = $("share-canvas");
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const W = 1080, H = 1350;
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#16453a");
  grad.addColorStop(1, "#0f332b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#c9f06b";
  ctx.beginPath();
  ctx.arc(120, 150, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#16453a";
  ctx.beginPath();
  ctx.arc(120, 150, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 44px sans-serif";
  ctx.fillText(document.title || t("appTitle"), 200, 168);
  const text = $("share-text").value.trim();
  ctx.font = "600 52px sans-serif";
  const maxW = W - 160;
  const words = [...text];
  const lines = [];
  let cur = "";
  for (const ch of words) {
    if (ch === "\n") { lines.push(cur); cur = ""; continue; }
    if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) lines.push(cur);
  ctx.fillStyle = "#ffffff";
  lines.slice(0, 12).forEach((ln, i) => ctx.fillText(ln, 80, 380 + i * 78));
  ctx.fillStyle = "#bcd2c8";
  ctx.font = "34px sans-serif";
  ctx.fillText(localDateStr(), 80, H - 120);
  ctx.fillStyle = "#c9f06b";
  ctx.font = "700 34px sans-serif";
  ctx.fillText(t("appTitle"), 80, H - 60);
  try {
    const url = cv.toDataURL("image/png");
    const img = $("share-preview");
    img.src = url;
    img.hidden = false;
    const a = document.createElement("a");
    a.href = url;
    a.download = "share-card.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) { /* 画布导出不可用时保留预览逻辑外不假装成功 */ }
}

/* —— 初始化 —— */
document.querySelectorAll(".tab-btn").forEach((b) => {
  b.addEventListener("click", () => switchTab(b.getAttribute("data-tab")));
});
$("lang-toggle").addEventListener("click", () => {
  LANG = LANG === "zh" ? "en" : "zh";
  try { localStorage.setItem(LS_LANG, LANG); } catch (e) { /* 忽略 */ }
  applyI18n();
  // v12 独立视图按挂载时语言渲染：切换语言后卸载，下次打开按新语言重挂
  privCtl = null; probCtl = null;
  $("private-body").innerHTML = "";
  $("problems-body").innerHTML = "";
  todayWired = false;
  trailFilter = "";
  if (lastData) {
    personalize(lastData.student.name || "");
    renderTab(curTab); // 当前页立即按新语言重渲染；其余页签下次进入时按语言标记自动重渲染
    updateDot();
  }
});
/* v12：独立视图打开/关闭（事件委托，按钮在 index.html 静态骨架里） */
document.addEventListener("click", (ev) => {
  const opener = ev.target.closest("[data-open]");
  if (opener) {
    const which = opener.getAttribute("data-open");
    if (which === "private") openPrivateSheet();
    else if (which === "problems") { openProblemsSheet(); }
    else if (which === "trail") { openSheet("view-trail"); renderTrailSheet(); }
    else if (which === "match") { openSheet("view-match"); renderMatchSheet(); }
    return;
  }
  if (ev.target.closest("[data-close]")) closeSheets();
});
/* v12：导师留言框语音输入（非私密内容，仍默认关闭 + 明示告知） */
(() => {
  const micDiv = document.createElement("div");
  micDiv.id = "msg-mic";
  const form = $("msg-form");
  const bar = form.querySelector(".msg-bar");
  if (bar) form.insertBefore(micDiv, bar); else form.appendChild(micDiv);
  attachVoice($("msg-input"), { scope: "public", mount: micDiv });
})();
$("msg-form").addEventListener("submit", sendMessage);
$("msg-input").addEventListener("input", () => {
  $("msg-count").textContent = [...$("msg-input").value].length + " / 500";
});
$("gate-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const s = $("gate-s").value.trim(), k = $("gate-k").value.trim();
  if (!s || !k) { showGate(t("gate.errBoth")); return; }
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
applyI18n();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
else load();
