/* 传统企业 AI 数字员工评估器 · 确定性计算引擎 v2（纯函数，无 DOM 依赖，可单测）
 * 纪律：所有效益数字由本文件公式计算，禁止写死效益结论。
 * 系数来源标注：source ∈ {survey=商业调查报告, benchmark=公开基准, assumption=假设值}
 * v2 变更：企业分级（创始人锚点）+ 组织就绪度（毛节约→可实现节约）+ 磨合成本（含 J 曲线）
 *          + 会议磨合专项提示 + 个人版评估引擎 evaluatePersonal。
 */
(function (global) {
  "use strict";

  // ---------- 系数表（每一项标注来源类型与可信度） ----------
  // 行业重复脑力劳动强度：由商业调查 v1 第五节「重复性脑力劳动占比」评分（1–5）换算：分值/5*0.9 后取整到 0.05
  var INDUSTRY_REPEAT = {
    tax:      { label: "财税服务",     score: 5, repeat: 0.80, source: "survey",    confidence: "中" },
    edu:      { label: "教培/留学",    score: 5, repeat: 0.80, source: "survey",    confidence: "中" },
    ecom:     { label: "电商零售",     score: 5, repeat: 0.80, source: "survey",    confidence: "中" },
    mfg:      { label: "制造/外贸",    score: 4, repeat: 0.70, source: "survey",    confidence: "中" },
    estate:   { label: "地产中介",     score: 4, repeat: 0.70, source: "survey",    confidence: "中" },
    health:   { label: "医疗健康服务", score: 3, repeat: 0.55, source: "survey",    confidence: "中" },
    other:    { label: "其他服务业",   score: null, repeat: 0.65, source: "assumption", confidence: "低" }
  };

  // 部门重复劳动相对系数（部门重复占比 = 行业重复占比 × 本系数，钳制 ≤0.9）
  var DEPT_FACTOR = {
    service:  { label: "客户服务", factor: 1.00, source: "assumption", confidence: "低" },
    sales:    { label: "销售",     factor: 0.80, source: "assumption", confidence: "低" },
    content:  { label: "市场内容", factor: 0.90, source: "assumption", confidence: "低" },
    finance:  { label: "财务行政", factor: 0.95, source: "assumption", confidence: "低" },
    ops:      { label: "运营交付", factor: 0.85, source: "assumption", confidence: "低" },
    misc:     { label: "其他",     factor: 0.60, source: "assumption", confidence: "低" }
  };

  // 数字化基础 → 重复工作中可被 AI/自动化承接的比例上限基数
  var DIGITAL_AUTO = {
    paper: { label: "纸质与微信办公", auto: 0.35, source: "assumption", confidence: "低" },
    basic: { label: "基础办公软件",   auto: 0.50, source: "assumption", confidence: "低" },
    system:{ label: "有业务系统",     auto: 0.65, source: "assumption", confidence: "低" }
  };

  // 痛点对相关部门可自动化比例的加成（每命中一项 +0.03，上限钳制）
  var PAIN_BOOST = {
    night:  { dept: "service", boost: 0.03, source: "assumption", confidence: "低" },
    slow:   { dept: "service", boost: 0.03, source: "assumption", confidence: "低" },
    cac:    { dept: "content", boost: 0.03, source: "assumption", confidence: "低" },
    unstable:{ dept: "ops",    boost: 0.03, source: "assumption", confidence: "低" },
    scattered:{ dept: "finance", boost: 0.03, source: "assumption", confidence: "低" },
    labor:  { dept: null, boost: 0.0, source: "assumption", confidence: "低" } // 人力成本高：影响优先级，不改系数
  };

  var PAIN_LABELS = {
    labor: "人力成本高", slow: "响应慢", cac: "获客贵",
    unstable: "交付不稳定", scattered: "数据散乱", night: "夜间无人值守"
  };

  // 定价锚（商业调查 v1 第四节，全部标注「定价假设」）
  var PRICING = {
    diagnosis: { low: 20000, high: 50000, source: "survey", note: "转型诊断 2–5 万元/次（定价假设）" },
    pilot:     { low: 9800,  high: 19800, source: "survey", note: "单岗位托管试点包 45 天 9,800–19,800 元（定价假设）" },
    hostedPerPostMonthly: { low: 9800, high: 19800, source: "survey", note: "单岗位托管 0.98–1.98 万元/月（定价假设）" }
  };

  // ---------- v2 企业分级（创始人锚点：1–50 / 51–100 / 101–1000（内分两组）/ 1000+） ----------
  var TIERS = {
    micro: { label: "微型", detail: "微型（1–50 人）",      postCap: 3,  trainHours: 4,  processCost: [5000, 15000],   commRate: 0.003 },
    small: { label: "小型", detail: "小型（51–100 人）",    postCap: 6,  trainHours: 6,  processCost: [15000, 40000],  commRate: 0.005 },
    midA:  { label: "中型", detail: "中型（101–300 人）",   postCap: 8,  trainHours: 10, processCost: [40000, 100000], commRate: 0.010 },
    midB:  { label: "中型", detail: "中型（301–1000 人）",  postCap: 10, trainHours: 12, processCost: [80000, 200000], commRate: 0.015 },
    large: { label: "大型", detail: "大型（1000 人以上）",  postCap: 10, trainHours: 16, processCost: [80000, 200000], commRate: 0.020 } // 大型按单部门试点口径：流程改造成本沿用中型上档区间
  };
  function tierOf(staff) {
    if (staff <= 50) return "micro";
    if (staff <= 100) return "small";
    if (staff <= 300) return "midA";
    if (staff <= 1000) return "midB";
    return "large";
  }
  function isMidOrAbove(key) { return key === "midA" || key === "midB" || key === "large"; }

  // ---------- v2 组织就绪度（全部假设值，UI 假设清单可见） ----------
  // 实现率系数 = 流程文档化 × 员工数字素养 × 管理层推动力 × 数字化基础，钳制 [0.40, 1.00]
  var READINESS = {
    doc:   { none: { label: "几乎没有", f: 0.80 }, partial: { label: "部分有", f: 0.92 }, good: { label: "较完善", f: 1.00 } },
    lit:   { low:  { label: "偏低", f: 0.80 }, mid: { label: "中等", f: 0.92 }, high: { label: "偏高", f: 1.00 } },
    drive: { watch:{ label: "观望", f: 0.75 }, support: { label: "支持", f: 0.90 }, strong: { label: "强力推动", f: 1.00 } },
    digi:  { paper:{ f: 0.85 }, basic: { f: 0.95 }, system: { f: 1.00 } }
  };
  // 会议密度 → 首年沟通成本增量率倍增（假设值）
  var MEETING_MULT = { low: { label: "低", mult: 0.5 }, mid: { label: "中", mult: 1.0 }, high: { label: "高", mult: 1.8 } };
  // J 曲线：上线后前 3 个月实现率爬坡（假设值），其后 9 个月按稳态 100%
  var J_RAMP = [0.30, 0.60, 0.85];
  var J_YEAR_FACTOR = (J_RAMP[0] + J_RAMP[1] + J_RAMP[2] + 9) / 12; // ≈0.896
  var HOURS_PER_MONTH = 174; // 月均工时（21.75 天 × 8 小时，假设值）

  var DEFAULT_PARAMS = {
    realizeConservative: 0.60, // 保守档情景实现率（假设值，可调）
    realizeNeutral: 0.85,      // 中性档情景实现率（假设值，可调）
    repeatScale: 1.00,         // 重复劳动占比全局缩放（假设值，可调）
    hostedLow: PRICING.hostedPerPostMonthly.low,
    hostedHigh: PRICING.hostedPerPostMonthly.high
  };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }

  function readinessOf(input) {
    var doc = READINESS.doc[input.processDoc] || READINESS.doc.partial;
    var lit = READINESS.lit[input.digitalLiteracy] || READINESS.lit.mid;
    var drive = READINESS.drive[input.mgmtDrive] || READINESS.drive.support;
    var digi = READINESS.digi[input.digital] || READINESS.digi.basic;
    var raw = doc.f * lit.f * drive.f * digi.f;
    return {
      factor: clamp(raw, 0.40, 1.00),
      parts: { doc: doc.f, lit: lit.f, drive: drive.f, digi: digi.f },
      labels: { doc: doc.label, lit: lit.label, drive: drive.label }
    };
  }

  // ---------- AI 岗位模板（组织方案生成用） ----------
  var POST_TEMPLATES = {
    service: { name: "AI 客服答疑员", duty: "常见问题自动答复、工单分流与夜间值守", reviewer: "客服主管（真人）", minHead: 2, perHeads: 8 },
    sales:   { name: "AI 线索跟进员", duty: "线索清洗、跟进提醒与沟通话术辅助", reviewer: "销售负责人（真人）", minHead: 2, perHeads: 10 },
    content: { name: "AI 内容运营员", duty: "内容生产、多平台分发与数据汇总", reviewer: "市场负责人（真人）", minHead: 1, perHeads: 8 },
    finance: { name: "AI 财务行政助理", duty: "票据整理、对账提醒与报表汇总", reviewer: "财务负责人（真人）", minHead: 1, perHeads: 8 },
    ops:     { name: "AI 交付运营员", duty: "订单/交付进度跟踪与异常提醒", reviewer: "运营负责人（真人）", minHead: 2, perHeads: 10 },
    misc:    { name: "AI 行政协同员", duty: "会议纪要、文档归档与内部答疑", reviewer: "行政负责人（真人）", minHead: 5, perHeads: 15 }
  };
  // 行业岗位名覆写（仅名称，职责不变）
  var POST_NAME_OVERRIDE = {
    tax: { finance: "AI 票据与申报助理", service: "AI 客户答疑员" },
    edu: { ops: "AI 学员服务运营员" },
    ecom:{ ops: "AI 店铺运营员" }
  };

  /**
   * 企业版主评估函数（纯函数）
   * input: { industry, revenueWan, totalStaff, depts:{...}, monthlyCost, digital,
   *          processDoc, digitalLiteracy, mgmtDrive, meetingDensity, monthlyVolume, pains:[keys] }
   * 输出 saveMonth/saveYear 为打折后「可实现节约」；毛口径见 saveGrossMonth/saveGrossYear。
   */
  function evaluate(input, params) {
    var p = Object.assign({}, DEFAULT_PARAMS, params || {});
    var ind = INDUSTRY_REPEAT[input.industry] || INDUSTRY_REPEAT.other;
    var totalStaff = Math.max(0, Math.round(num(input.totalStaff, 0)));
    var monthlyCost = Math.max(0, num(input.monthlyCost, 0));
    var digi = DIGITAL_AUTO[input.digital] || DIGITAL_AUTO.basic;
    var tierKey = tierOf(totalStaff), tier = TIERS[tierKey];
    var ready = readinessOf(input);
    var meeting = MEETING_MULT[input.meetingDensity] || MEETING_MULT.mid;

    // 部门人数清洗（负数归零）
    var depts = {}, deptSum = 0;
    Object.keys(DEPT_FACTOR).forEach(function (k) {
      depts[k] = Math.max(0, Math.round(num(input.depts && input.depts[k], 0)));
      deptSum += depts[k];
    });

    // 每部门计算：毛工时（情景实现率）→ ×就绪度 = 可实现工时
    var deptResults = [], gC = 0, gN = 0, aC = 0, aN = 0;
    Object.keys(DEPT_FACTOR).forEach(function (k) {
      var head = depts[k];
      var repeatShare = clamp(ind.repeat * DEPT_FACTOR[k].factor * p.repeatScale, 0, 0.9);
      var boost = 0;
      (input.pains || []).forEach(function (pk) {
        if (PAIN_BOOST[pk] && PAIN_BOOST[pk].dept === k) boost += PAIN_BOOST[pk].boost;
      });
      var autoBase = clamp(digi.auto + boost, 0, 0.9);
      var fteGrossC = clamp(head * repeatShare * autoBase * p.realizeConservative, 0, head * 0.9);
      var fteGrossN = clamp(head * repeatShare * autoBase * p.realizeNeutral, 0, head * 0.9);
      var fteC = fteGrossC * ready.factor, fteN = fteGrossN * ready.factor;
      gC += fteGrossC; gN += fteGrossN; aC += fteC; aN += fteN;
      deptResults.push({
        key: k, label: DEPT_FACTOR[k].label, headcount: head,
        repeatShare: repeatShare, autoBase: autoBase,
        fteGrossConservative: fteGrossC, fteGrossNeutral: fteGrossN,
        fteConservative: fteC, fteNeutral: fteN,
        saveMonthConservative: fteC * monthlyCost,
        saveMonthNeutral: fteN * monthlyCost
      });
    });

    var saveGrossMonth = { low: gC * monthlyCost, high: gN * monthlyCost };
    var saveGrossYear = { low: saveGrossMonth.low * 12, high: saveGrossMonth.high * 12 };
    var saveMonth = { low: aC * monthlyCost, high: aN * monthlyCost };
    var saveYear = { low: saveMonth.low * 12, high: saveMonth.high * 12 };

    // 产能提升率 = 可实现释放工时占总工时比例（以部门人数合计为分母）
    var baseStaff = deptSum > 0 ? deptSum : totalStaff;
    var capacity = {
      low: baseStaff > 0 ? aC / baseStaff : 0,
      high: baseStaff > 0 ? aN / baseStaff : 0
    };
    var volumeGain = null;
    var vol = num(input.monthlyVolume, 0);
    if (vol > 0) volumeGain = { low: vol * capacity.low, high: vol * capacity.high };

    // ---------- 组织方案 ----------
    var org = buildOrg(input, depts, totalStaff, deptResults, tierKey);
    var postCount = org.posts.reduce(function (s, x) { return s + x.count; }, 0);

    // ---------- 托管成本 ----------
    var hostedMonth = {
      low: postCount * Math.max(0, num(p.hostedLow, PRICING.hostedPerPostMonthly.low)),
      high: postCount * Math.max(0, num(p.hostedHigh, PRICING.hostedPerPostMonthly.high))
    };
    var PILOT_MONTHS = 1.5, RUN_MONTHS_Y1 = 12 - PILOT_MONTHS; // 首年：45 天试点 + 10.5 个月正式托管
    var firstYearCost = {
      low: PRICING.diagnosis.low + PRICING.pilot.low + hostedMonth.low * RUN_MONTHS_Y1,
      high: PRICING.diagnosis.high + PRICING.pilot.high + hostedMonth.high * RUN_MONTHS_Y1
    };

    // ---------- v2 磨合成本（独立成块） ----------
    var hourlyCost = monthlyCost / HOURS_PER_MONTH;
    // 培训覆盖人数：大型只做单部门试点 → 仅首批岗位对应部门的人数；其余分级为全员
    var frictionHeads = totalStaff;
    if (tierKey === "large") {
      var covered = 0, coveredLabels = {};
      org.posts.forEach(function (x) { coveredLabels[x.dept] = true; });
      deptResults.forEach(function (d) { if (coveredLabels[d.label]) covered += d.headcount; });
      frictionHeads = covered > 0 ? covered : (deptSum || totalStaff);
    }
    var trainingCost = frictionHeads * tier.trainHours * hourlyCost;
    var processCost = { low: tier.processCost[0], high: tier.processCost[1] };
    var annualLaborCost = monthlyCost * (totalStaff || deptSum) * 12;
    var commRateEff = tier.commRate * meeting.mult;
    var commCostYear1 = annualLaborCost * commRateEff;
    var friction = {
      heads: frictionHeads, trainHours: tier.trainHours, hourlyCost: hourlyCost,
      training: trainingCost, process: processCost,
      commRate: commRateEff, commYear1: commCostYear1,
      total: { low: trainingCost + processCost.low + commCostYear1, high: trainingCost + processCost.high + commCostYear1 }
    };

    // 首年实际效益：可实现节约按 J 曲线爬坡折算
    var firstYearSave = { low: saveMonth.low * 12 * J_YEAR_FACTOR, high: saveMonth.high * 12 * J_YEAR_FACTOR };
    var firstYearNet = {
      low: firstYearSave.low - firstYearCost.high - friction.total.high,
      high: firstYearSave.high - firstYearCost.low - friction.total.low
    };

    // 月净节约（稳态，托管期）= 可实现月节约 − 托管月费
    var netMonth = { low: saveMonth.low - hostedMonth.high, high: saveMonth.high - hostedMonth.low };
    // 回本：一次性投入（诊断+试点+培训+流程改造）由稳态月净节约回收；≤0 标记不可回本
    var oneOff = {
      low: PRICING.diagnosis.low + PRICING.pilot.low + trainingCost + processCost.low,
      high: PRICING.diagnosis.high + PRICING.pilot.high + trainingCost + processCost.high
    };
    function payback(one, net) { return net > 0 ? one / net : Infinity; }
    var pbFast = payback(oneOff.low, netMonth.high);
    var pbSlow = payback(oneOff.high, netMonth.low);
    var paybackMonths = null;
    if (isFinite(pbSlow)) paybackMonths = { low: pbFast, high: pbSlow };
    else if (isFinite(pbFast)) paybackMonths = { low: pbFast, high: Infinity };

    // 3 年净效益 = 首年净效益（含磨合与爬坡） + 第 2、3 年稳态年净效益
    var net3RawLow = firstYearNet.low + 2 * (saveYear.low - hostedMonth.high * 12);
    var net3RawHigh = firstYearNet.high + 2 * (saveYear.high - hostedMonth.low * 12);
    var net3Clamped = net3RawLow < 0;
    var net3Year = { low: Math.max(0, net3RawLow), high: Math.max(0, net3RawHigh) };

    // ---------- 会议磨合专项提示（规则生成，不含数字结论） ----------
    var advisory = null;
    if ((isMidOrAbove(tierKey) && input.meetingDensity !== "low") || input.meetingDensity === "high") {
      advisory = {
        title: "会议磨合专项提示",
        points: [
          "AI 数字员工进入真人线上/线下会议时，身份透明、发言可信度与责任归属都会推高会议沟通成本，会议密度越高、组织层级越多，磨合越痛。",
          "默认以异步书面简报代替 AI 入会：AI 会前提交书面材料、会后出纪要，真人会议只讨论与决策。",
          "AI 只进「定标准 / 终裁」类会议，且以提交材料与答疑为限，不参与闲聊与表决。",
          "执行会议分级：常规级会议 AI 与真人均只收纪要；创始人/负责人级会议由真人参加并终裁。"
        ]
      };
    }

    return {
      meta: { industryLabel: ind.label, deptSum: deptSum, totalStaff: totalStaff, deptMismatch: deptSum !== totalStaff },
      tier: { key: tierKey, label: tier.label, detail: tier.detail, largePilotOnly: tierKey === "large" },
      readiness: ready,
      meeting: { key: input.meetingDensity || "mid", label: meeting.label || MEETING_MULT.mid.label },
      depts: deptResults,
      releasedFte: { low: aC, high: aN },
      releasedFteGross: { low: gC, high: gN },
      saveGrossMonth: saveGrossMonth, saveGrossYear: saveGrossYear,
      saveMonth: saveMonth, saveYear: saveYear,
      capacity: capacity, volumeGain: volumeGain,
      org: org, postCount: postCount,
      hostedMonth: hostedMonth, firstYearCost: firstYearCost,
      friction: friction, firstYearSave: firstYearSave, firstYearNet: firstYearNet,
      jFactor: J_YEAR_FACTOR,
      netMonth: netMonth, oneOff: oneOff, paybackMonths: paybackMonths,
      net3Year: net3Year, net3Clamped: net3Clamped,
      meetingAdvisory: advisory,
      params: p
    };
  }

  function buildOrg(input, depts, totalStaff, deptResults, tierKey) {
    var tier = TIERS[tierKey], postCap = tier.postCap;
    var fteByDept = {};
    deptResults.forEach(function (d) { fteByDept[d.label] = d.fteNeutral; });
    var candidates = [];
    Object.keys(POST_TEMPLATES).forEach(function (k) {
      var t = POST_TEMPLATES[k], head = depts[k];
      if (head >= t.minHead) {
        var override = (POST_NAME_OVERRIDE[input.industry] || {})[k];
        candidates.push({
          dept: DEPT_FACTOR[k].label,
          name: override || t.name,
          count: clamp(Math.round(head / t.perHeads), 1, 5),
          duty: t.duty, reviewer: t.reviewer
        });
      }
    });
    candidates.sort(function (a, b) { return (fteByDept[b.dept] || 0) - (fteByDept[a.dept] || 0); });
    var posts = [], deferred = [], used = 0;
    candidates.forEach(function (c) {
      if (used + c.count <= postCap) { posts.push(c); used += c.count; }
      else deferred.push(c.name);
    });
    if (posts.length === 0) {
      posts.push({ dept: "通用", name: "AI 行政协同员", count: 1, duty: POST_TEMPLATES.misc.duty, reviewer: "业务负责人（真人）" });
    }
    var best = null;
    deptResults.forEach(function (d) { if (!best || d.fteNeutral > best.fteNeutral) best = d; });
    var pilotPost = null;
    posts.forEach(function (x) { if (best && x.dept === best.label) pilotPost = x.name; });
    if (!pilotPost) pilotPost = posts[0].name;

    var tierNote, route;
    if (tierKey === "micro") {
      tierNote = "真人审核由企业负责人兼任，不新增岗位；以轻量工具起步。";
      route = [
        "<strong>1–30 天 · 轻工具单岗试点</strong>：先用轻量工具在「" + pilotPost + "」单岗位验证，负责人兼任审核，基线先行。",
        "<strong>31–90 天 · 小步扩展</strong>：试点达标后扩 1–2 岗，岗位卡与错误档案同步建立。",
        "<strong>90 天+ · 固化</strong>：按效果账本决定扩岗或退出，不为数字化而数字化。"
      ];
    } else if (tierKey === "small") {
      tierNote = "各部门负责人兼任审核岗，指定 1 名业务骨干兼任转型负责人。";
      route = [
        "<strong>1–30 天 · 单岗试点</strong>：选定「" + pilotPost + "」上线，兼职转型负责人统筹，测基线、写岗位卡。",
        "<strong>31–90 天 · 扩至 2–3 岗</strong>：试点达标后按编制分批扩展，审核台与错误档案运转，周维度出效果账本。",
        "<strong>90 天+ · 治理定型</strong>：考核、权限与版本管理定型，按账本决定扩岗、换岗或退出。"
      ];
    } else if (tierKey === "midA" || tierKey === "midB") {
      tierNote = "须设专职转型负责人 1 名（真人），变革管理单列预算，按部门分批推进。";
      route = [
        "<strong>1–30 天 · 单部门试点</strong>：在「" + pilotPost + "」所在部门先行试点，专职转型负责人到位，变革沟通与培训同步启动（磨合成本见效益段）。",
        "<strong>31–90 天 · 按部门分批扩展</strong>：逐部门复制试点经验，每批上线前完成岗位卡、培训与会议规则适配（默认异步简报代替入会）。",
        "<strong>90 天+ · 治理定型</strong>：考核、奖惩、权限与版本管理定型，错误档案跨部门共享，按效果账本滚动复盘。"
      ];
    } else {
      tierNote = "设专职 AI 运营管家 1 名 + 数据合规负责人 1 名（真人）；仅做单部门试点口径，不做全公司推广承诺。";
      route = [
        "<strong>1–30 天 · 单部门试点</strong>：只选「" + pilotPost + "」所在一个部门做试点，验证组织磨合与治理可行性，不铺开。",
        "<strong>31–90 天 · 试点复盘</strong>：以试点部门实测数据（实现率、沟通成本、会议磨合）决定是否扩展，禁止按本评估直接推全公司。",
        "<strong>90 天+ · 分批决策</strong>：逐部门立项、逐部门测算，每批独立核算磨合成本与回本。"
      ];
    }

    var humanRoles = [
      { role: "定标准者", who: "业务负责人（真人）", duty: "定岗位卡、话术与服务标准，AI 只按标准执行" },
      { role: "终裁者", who: "各部门负责人（真人）", duty: "审核台只看异常与抽样，高风险事项真人终裁" },
      { role: "对外担责者", who: "具名责任人（真人）", duty: "对外口径为「智能助理服务，专人负责」，出错由责任人出面补救" }
    ];
    if (tierKey !== "micro") humanRoles.push({ role: "转型负责人 / AI 运营管家", who: tierKey === "small" ? "业务骨干兼任（真人）" : "新增专职真人岗位 1 名", duty: "统筹执行队列派单、审核台运转、错误档案与变革沟通" });
    if (tierKey === "midB" || tierKey === "large") humanRoles.push({ role: "数据合规负责人", who: "新增/指定真人 1 名", duty: "数据处理协议、最小化采集与出境合规把关" });

    return { posts: posts, deferred: deferred, pilotPost: pilotPost, tier: tier.label, tierDetail: tier.detail, tierNote: tierNote, route: route, humanRoles: humanRoles };
  }

  function coefficientTable() {
    var rows = [];
    Object.keys(INDUSTRY_REPEAT).forEach(function (k) {
      var v = INDUSTRY_REPEAT[k];
      rows.push({ item: "行业重复劳动占比 · " + v.label, value: Math.round(v.repeat * 100) + "%", source: v.source, confidence: v.confidence });
    });
    Object.keys(DEPT_FACTOR).forEach(function (k) {
      var v = DEPT_FACTOR[k];
      rows.push({ item: "部门相对系数 · " + v.label, value: "×" + v.factor.toFixed(2), source: v.source, confidence: v.confidence });
    });
    Object.keys(DIGITAL_AUTO).forEach(function (k) {
      var v = DIGITAL_AUTO[k];
      rows.push({ item: "可自动化比例 · " + v.label, value: Math.round(v.auto * 100) + "%", source: v.source, confidence: v.confidence });
    });
    rows.push({ item: "定价 · 诊断", value: "2–5 万元/次", source: "survey", confidence: "定价假设" });
    rows.push({ item: "定价 · 试点包（45 天）", value: "9,800–19,800 元", source: "survey", confidence: "定价假设" });
    rows.push({ item: "定价 · 单岗位托管", value: "0.98–1.98 万元/月", source: "survey", confidence: "定价假设" });
    rows.push({ item: "落地情景实现率 · 保守/中性", value: "60% / 85%（默认，可调）", source: "assumption", confidence: "低" });
    rows.push({ item: "就绪度因子 · 流程文档化", value: "几乎没有 ×0.80 / 部分有 ×0.92 / 较完善 ×1.00", source: "assumption", confidence: "低" });
    rows.push({ item: "就绪度因子 · 员工数字素养", value: "偏低 ×0.80 / 中等 ×0.92 / 偏高 ×1.00", source: "assumption", confidence: "低" });
    rows.push({ item: "就绪度因子 · 管理层推动力", value: "观望 ×0.75 / 支持 ×0.90 / 强力推动 ×1.00", source: "assumption", confidence: "低" });
    rows.push({ item: "就绪度因子 · 数字化基础", value: "纸质 ×0.85 / 基础 ×0.95 / 有系统 ×1.00", source: "assumption", confidence: "低" });
    rows.push({ item: "磨合 · 人均培训工时", value: "微型 4h / 小型 6h / 中型 10–12h / 大型 16h", source: "assumption", confidence: "低" });
    rows.push({ item: "磨合 · 流程改造与岗位卡建设", value: "微型 0.5–1.5 万 / 小型 1.5–4 万 / 中型 4–20 万 / 大型按单部门试点 8–20 万", source: "survey", confidence: "定价假设" });
    rows.push({ item: "磨合 · 首年沟通成本增量率", value: "微型 0.3% / 小型 0.5% / 中型 1.0–1.5% / 大型 2.0%（×会议密度 0.5/1/1.8）", source: "assumption", confidence: "低" });
    rows.push({ item: "J 曲线 · 前 3 个月实现率爬坡", value: "30% / 60% / 85%，首年折算系数 ≈0.90", source: "assumption", confidence: "低" });
    rows.push({ item: "个人版 · 任务可辅助比例", value: "客服 55% / 数据 50% / 写作·研究 45% / 沟通 35% / 学习 30% / 其他 20%", source: "assumption", confidence: "低" });
    rows.push({ item: "个人版 · 智能体订阅单价", value: "40–120 元/个/月", source: "survey", confidence: "定价假设" });
    return rows;
  }

  /* ================= 个人版 ================= */
  var PERSON_OCCUPATIONS = {
    staff: "公司职员", freelancer: "自由职业者", owner: "个体经营者", manager: "管理者", student: "学生"
  };
  var PERSON_TASKS = {
    comm:     { label: "沟通与会议", assist: 0.35 },
    writing:  { label: "写作与文档", assist: 0.45 },
    data:     { label: "数据与表格", assist: 0.50 },
    research: { label: "信息搜集与研究", assist: 0.45 },
    support:  { label: "客服与答疑", assist: 0.55 },
    learning: { label: "学习进修", assist: 0.30 },
    other:    { label: "其他", assist: 0.20 }
  };
  var PERSON_PAINS = {
    repeat: "重复劳动多", fragmented: "时间碎片", learnslow: "学习慢", acquire: "获客难", writing: "文案难产"
  };
  var PERSON_BAND = { low: 0.60, high: 0.90 }; // 潜在省时落地系数（假设值）
  var PERSON_SUB_PER_AGENT = { low: 40, high: 120 }; // 元/个/月（定价假设）
  var PERSON_LEARNING = {
    entry:  { label: "入门", hours: 20, weeks: 6 },
    skilled:{ label: "熟练", hours: 10, weeks: 4 },
    expert: { label: "精通", hours: 5,  weeks: 2 }
  };
  var SQUAD_TEMPLATES = {
    research: { name: "AI 研究助理", task: "research", duty: "资料搜集、竞品与行业信息整理、摘要与出处标注" },
    writing:  { name: "AI 写作助理", task: "writing", duty: "文案、邮件、方案初稿与改写润色" },
    comm:     { name: "AI 信息管家", task: "comm", duty: "会议纪要、沟通摘要、日程与待办整理" },
    support:  { name: "AI 客服助理", task: "support", duty: "常见问题答复草稿、客户答疑分流（发送前真人确认）" },
    learning: { name: "AI 学习教练", task: "learning", duty: "学习计划拆解、资料导读与复习提醒" },
    data:     { name: "AI 数据助理", task: "data", duty: "表格清洗、公式与图表、数据汇总说明" }
  };

  /**
   * 个人版评估（纯函数）
   * input: { occupation, monthlyIncome, hourlyRate, weeklyHours, tasks:{comm,...},
   *          literacy: entry|skilled|expert, currentAiSpend, pains:[keys] }
   * params: { monetizeRate } 时间变现率 0–1，默认 0.5
   */
  function evaluatePersonal(input, params) {
    var p = Object.assign({ monetizeRate: 0.5 }, params || {});
    var monetize = clamp(num(p.monetizeRate, 0.5), 0, 1);
    var weeklyHours = Math.max(0, num(input.weeklyHours, 0));
    var tasks = {}, taskSum = 0;
    Object.keys(PERSON_TASKS).forEach(function (k) {
      tasks[k] = Math.max(0, num(input.tasks && input.tasks[k], 0));
      taskSum += tasks[k];
    });
    var errors = [];
    if (weeklyHours <= 0) errors.push("请填写每周工作小时（大于 0）。");
    if (taskSum > weeklyHours + 1e-9) errors.push("任务时间合计（" + taskSum + " 小时）超过每周工作小时（" + weeklyHours + " 小时），请对齐后重新生成。");
    var hourlyInput = Math.max(0, num(input.hourlyRate, 0));
    var monthlyIncome = Math.max(0, num(input.monthlyIncome, 0));
    var hourly = hourlyInput > 0 ? hourlyInput : (weeklyHours > 0 && monthlyIncome > 0 ? monthlyIncome / (weeklyHours * 4.33) : 0);
    if (hourly <= 0) errors.push("请填写月收入或时薪，否则无法估算时间价值。");
    if (errors.length) return { valid: false, errors: errors };

    // 每任务潜在省时与区间
    var taskResults = [], relLow = 0, relHigh = 0;
    Object.keys(PERSON_TASKS).forEach(function (k) {
      var potential = tasks[k] * PERSON_TASKS[k].assist;
      var low = potential * PERSON_BAND.low, high = potential * PERSON_BAND.high;
      relLow += low; relHigh += high;
      taskResults.push({ key: k, label: PERSON_TASKS[k].label, hours: tasks[k], assist: PERSON_TASKS[k].assist, released: { low: low, high: high } });
    });
    var releasedWeek = { low: relLow, high: relHigh };
    var releasedMonth = { low: relLow * 4.33, high: relHigh * 4.33 };
    var timeValueMonth = { low: releasedMonth.low * hourly * monetize, high: releasedMonth.high * hourly * monetize };

    // 小队生成：按触发规则（任务工时或痛点）选岗，按预计省时排序，上限 5；无触发时给通用三件套
    var pains = input.pains || [];
    var picked = {};
    function want(taskKey) { picked[taskKey] = true; }
    if (tasks.research >= 2) want("research");
    if (tasks.writing >= 2 || pains.indexOf("writing") >= 0 || pains.indexOf("acquire") >= 0) want("writing");
    if (tasks.comm >= 3) want("comm");
    if (tasks.data >= 2) want("data");
    if (tasks.support >= 1 || pains.indexOf("repeat") >= 0 && tasks.support > 0) want("support");
    if (tasks.learning >= 2 || pains.indexOf("learnslow") >= 0 || input.occupation === "student") want("learning");
    var squadKeys = Object.keys(picked);
    if (squadKeys.length === 0) squadKeys = ["comm", "writing", "research"];
    var byTask = {};
    taskResults.forEach(function (t) { byTask[t.key] = t; });
    var squad = squadKeys.map(function (k) {
      var t = SQUAD_TEMPLATES[k];
      return { name: t.name, duty: t.duty, taskLabel: PERSON_TASKS[t.task].label, saveWeek: byTask[t.task].released };
    }).sort(function (a, b) { return b.saveWeek.high - a.saveWeek.high; }).slice(0, 5);

    var subCost = { low: squad.length * PERSON_SUB_PER_AGENT.low, high: squad.length * PERSON_SUB_PER_AGENT.high };
    var netMonthP = { low: timeValueMonth.low - subCost.high, high: timeValueMonth.high - subCost.low };
    var learn = PERSON_LEARNING[input.literacy] || PERSON_LEARNING.skilled;
    // 回本周数：学习投入小时 ÷ 每周净省时当量（中位释放×变现率 − 订阅成本折算小时）
    var midReleased = (relLow + relHigh) / 2;
    var subMidWeekYuan = ((subCost.low + subCost.high) / 2) / 4.33;
    var netHoursWeek = midReleased * monetize - (hourly > 0 ? subMidWeekYuan / hourly : 0);
    var paybackWeeks = netHoursWeek > 0 ? learn.hours / netHoursWeek : null;

    return {
      valid: true,
      occupationLabel: PERSON_OCCUPATIONS[input.occupation] || "公司职员",
      hourly: hourly, hourlyFromIncome: hourlyInput <= 0,
      weeklyHours: weeklyHours, taskSum: taskSum,
      tasks: taskResults, releasedWeek: releasedWeek, releasedMonth: releasedMonth,
      monetizeRate: monetize, timeValueMonth: timeValueMonth,
      squad: squad, subCost: subCost, currentAiSpend: Math.max(0, num(input.currentAiSpend, 0)),
      netMonth: netMonthP,
      learning: { hours: learn.hours, weeks: learn.weeks, label: learn.label },
      paybackWeeks: paybackWeeks
    };
  }

  var API = {
    evaluate: evaluate, evaluatePersonal: evaluatePersonal, coefficientTable: coefficientTable,
    INDUSTRY_REPEAT: INDUSTRY_REPEAT, DEPT_FACTOR: DEPT_FACTOR,
    DIGITAL_AUTO: DIGITAL_AUTO, PAIN_LABELS: PAIN_LABELS, PRICING: PRICING, DEFAULT_PARAMS: DEFAULT_PARAMS,
    TIERS: TIERS, tierOf: tierOf, READINESS: READINESS, MEETING_MULT: MEETING_MULT,
    J_RAMP: J_RAMP, J_YEAR_FACTOR: J_YEAR_FACTOR,
    PERSON_TASKS: PERSON_TASKS, PERSON_PAINS: PERSON_PAINS, PERSON_OCCUPATIONS: PERSON_OCCUPATIONS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.AIEngine = API;
})(typeof window !== "undefined" ? window : globalThis);
