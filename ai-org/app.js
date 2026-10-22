/* 评估器 UI 逻辑（v2：企业版 + 个人版）：表单 → AIEngine → 报告渲染。效益数字全部来自 engine，本文件不含任何效益结论数字。 */
(function () {
  "use strict";
  var E = window.AIEngine;
  var $ = function (id) { return document.getElementById(id); };
  var DEPT_KEYS = ["service", "sales", "content", "finance", "ops", "misc"];
  var TASK_KEYS = ["comm", "writing", "data", "research", "support", "learning", "other"];

  // ---------- 模式切换 ----------
  function setMode(per) {
    $("entWrap").style.display = per ? "none" : "";
    $("perWrap").style.display = per ? "" : "none";
    $("tabEnt").className = "btn modeTab" + (per ? " ghost" : " active");
    $("tabPer").className = "btn modeTab" + (per ? " active" : " ghost");
  }
  $("tabEnt").addEventListener("click", function () { setMode(false); });
  $("tabPer").addEventListener("click", function () { setMode(true); });

  // ---------- 企业版 ----------
  // 示例预设（演示值，非真实企业数据）
  var PRESETS = {
    tax:  { industry: "tax", revenue: 600, total: 30, cost: 7000, digital: "basic", volume: 800,
            doc: "partial", lit: "mid", drive: "support", meeting: "mid",
            depts: { service: 6, sales: 4, content: 3, finance: 10, ops: 5, misc: 2 }, pains: ["labor", "scattered"] },
    ecom: { industry: "ecom", revenue: 3000, total: 80, cost: 6500, digital: "system", volume: 5000,
            doc: "partial", lit: "mid", drive: "strong", meeting: "mid",
            depts: { service: 25, sales: 15, content: 12, finance: 6, ops: 18, misc: 4 }, pains: ["night", "slow", "cac"] },
    edu:  { industry: "edu", revenue: 1200, total: 50, cost: 7500, digital: "basic", volume: 1500,
            doc: "partial", lit: "mid", drive: "support", meeting: "mid",
            depts: { service: 10, sales: 12, content: 8, finance: 5, ops: 13, misc: 2 }, pains: ["cac", "slow", "labor"] },
    mfg:  { industry: "mfg", revenue: 8000, total: 350, cost: 8000, digital: "basic", volume: 3000,
            doc: "none", lit: "low", drive: "support", meeting: "high",
            depts: { service: 30, sales: 40, content: 10, finance: 25, ops: 220, misc: 25 }, pains: ["labor", "unstable"] }
  };

  function readDepts() {
    var d = {};
    DEPT_KEYS.forEach(function (k) { d[k] = Math.max(0, parseInt($("d_" + k).value || "0", 10) || 0); });
    return d;
  }
  function deptSum(d) { return DEPT_KEYS.reduce(function (s, k) { return s + d[k]; }, 0); }

  function updateDeptHint() {
    var d = readDepts(), sum = deptSum(d), total = parseInt($("f_total").value || "0", 10) || 0;
    var h = $("deptHint");
    h.textContent = "部门合计：" + sum + " 人" + (total > 0 ? "｜员工总数：" + total + " 人" + (sum === total ? "（一致）" : "（相差 " + (sum - total) + " 人，生成前请对齐）") : "");
    h.className = "hint" + (total > 0 && sum !== total ? " err" : "");
  }
  DEPT_KEYS.forEach(function (k) { $("d_" + k).addEventListener("input", updateDeptHint); });
  $("f_total").addEventListener("input", updateDeptHint);

  document.querySelectorAll("[data-preset]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var pr = PRESETS[btn.getAttribute("data-preset")];
      $("f_industry").value = pr.industry; $("f_revenue").value = pr.revenue;
      $("f_total").value = pr.total; $("f_cost").value = pr.cost;
      $("f_digital").value = pr.digital; $("f_volume").value = pr.volume;
      $("f_doc").value = pr.doc; $("f_lit").value = pr.lit;
      $("f_drive").value = pr.drive; $("f_meeting").value = pr.meeting;
      DEPT_KEYS.forEach(function (k) { $("d_" + k).value = pr.depts[k]; });
      document.querySelectorAll("#painBox input").forEach(function (c) { c.checked = pr.pains.indexOf(c.value) >= 0; });
      updateDeptHint();
      $("formErr").textContent = "";
    });
  });

  [["p_rc", "v_rc", function (v) { return v + "%"; }],
   ["p_rn", "v_rn", function (v) { return v + "%"; }],
   ["p_rs", "v_rs", function (v) { return "×" + (v / 100).toFixed(2); }]].forEach(function (t) {
    $(t[0]).addEventListener("input", function () { $(t[1]).textContent = t[2](parseInt($(t[0]).value, 10)); });
  });

  function readInput() {
    return {
      industry: $("f_industry").value,
      revenueWan: parseFloat($("f_revenue").value) || 0,
      totalStaff: parseInt($("f_total").value || "0", 10) || 0,
      depts: readDepts(),
      monthlyCost: parseFloat($("f_cost").value) || 0,
      digital: $("f_digital").value,
      processDoc: $("f_doc").value,
      digitalLiteracy: $("f_lit").value,
      mgmtDrive: $("f_drive").value,
      meetingDensity: $("f_meeting").value,
      monthlyVolume: parseFloat($("f_volume").value) || 0,
      pains: Array.prototype.map.call(document.querySelectorAll("#painBox input:checked"), function (c) { return c.value; })
    };
  }
  function readParams() {
    return {
      realizeConservative: parseInt($("p_rc").value, 10) / 100,
      realizeNeutral: parseInt($("p_rn").value, 10) / 100,
      repeatScale: parseInt($("p_rs").value, 10) / 100,
      hostedLow: parseFloat($("p_hl").value) || 0,
      hostedHigh: parseFloat($("p_hh").value) || 0
    };
  }

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function yuan(n) { return "¥" + Math.round(n).toLocaleString("zh-CN"); }
  function wan(n) { return (n / 10000).toFixed(1).replace(/\.0$/, "") + " 万元"; }
  function range(a, b, f) { return f(a) + " – " + f(b); }
  function srcTag(s) {
    return s === "survey" ? '<span class="tag">调查报告</span>' :
           s === "benchmark" ? '<span class="tag">公开基准</span>' : '<span class="tag">假设值</span>';
  }
  function showReport(html) {
    var rep = $("report");
    rep.innerHTML = html;
    rep.style.display = "block";
    if (typeof rep.scrollIntoView === "function") rep.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("evalForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = readInput(), err = $("formErr");
    var sum = deptSum(input.depts);
    if (input.totalStaff <= 0) { err.textContent = "请填写员工总数（大于 0）。"; return; }
    if (sum !== input.totalStaff) { err.textContent = "部门人数合计（" + sum + "）与员工总数（" + input.totalStaff + "）不一致，请对齐后重新生成。"; return; }
    if (input.monthlyCost <= 0) { err.textContent = "请填写平均月人力成本（大于 0），否则无法估算折算价值。"; return; }
    err.textContent = "";
    render(input, E.evaluate(input, readParams()));
  });

  function render(input, r) {
    var painsTxt = input.pains.length ? input.pains.map(function (k) { return E.PAIN_LABELS[k]; }).join("、") : "未选择";
    var pb = r.paybackMonths;
    function pbFmt(v) { return v < 1 ? "不足 1" : v.toFixed(1); }
    var pbTxt = !pb ? "月净折算价值不足以覆盖托管费（见下）" :
      (!isFinite(pb.high) ? pbFmt(pb.low) + " 个月起（保守档月净折算价值为负，上限不成立）" :
       range(pb.low, pb.high, pbFmt) + " 个月");
    var readyPct = Math.round(r.readiness.factor * 100);

    var html = "";
    html += "<h2>评估报告</h2>";
    html += "<h3>输入回显</h3><p class='hint'>" +
      esc(r.meta.industryLabel) + "｜年营收 " + (input.revenueWan || "—") + " 万元｜员工 " + input.totalStaff +
      " 人（" + esc(r.tier.detail) + "）｜平均月人力成本 " + yuan(input.monthlyCost) + "/人｜数字化基础：" + esc(E.DIGITAL_AUTO[input.digital].label) +
      "｜流程文档化：" + esc(r.readiness.labels.doc) + "｜数字素养：" + esc(r.readiness.labels.lit) +
      (input.monthlyVolume > 0 ? "｜月业务量 " + input.monthlyVolume + " 件" : "") + "｜痛点：" + esc(painsTxt) + "</p>";
    if (r.tier.largePilotOnly) html += "<p class='hint err'>大型企业口径：员工规模与素质差异使复杂度与磨合成本显著升高，本评估只支持单部门试点口径，不做全公司效益承诺；培训等磨合成本仅按首批试点覆盖范围计算。</p>";
    if (r.revenueCheck && r.revenueCheck.warn) html += "<p class='hint err'>提示：按所填年营收估算，人力成本约占营收 " + Math.round(r.revenueCheck.ratio * 100) + "%，超出 3%–85% 的合理性宽带（假设值），请核对年营收或人力成本口径；本提示不拦截评估。</p>";

    html += "<h3>一、经济效益估算（区间：保守 – 中性）</h3>";
    html += "<p class='hint'>组织就绪度系数 <strong>" + readyPct + "%</strong>（流程文档化 × 数字素养 × 管理层推动力，假设值；数字化基础只进入可自动化比例，不重复计入）：理论毛折算价值须打折到此比例才是可实现折算价值，两者差距即组织障碍的量化。</p>";
    html += "<div class='big'>" +
      "<div class='kpi'><div class='k'>可释放工时（可实现，人月当量/月）</div><div class='v'>" + range(r.releasedFte.low, r.releasedFte.high, function (v) { return v.toFixed(1); }) + " 人</div></div>" +
      "<div class='kpi'><div class='k'>年释放工时折算价值</div><div class='v'>" + range(r.saveYear.low, r.saveYear.high, wan) + "</div></div>" +
      "<div class='kpi'><div class='k'>理论上限年折算价值（毛口径，未打折）</div><div class='v'>" + range(r.saveGrossYear.low, r.saveGrossYear.high, wan) + "</div></div>" +
      "<div class='kpi'><div class='k'>产能提升（覆盖范围内可释放工时占比）</div><div class='v'>" + range(r.capacity.low * 100, r.capacity.high * 100, function (v) { return v.toFixed(1); }) + "%</div></div>" +
      "<div class='kpi'><div class='k'>首年净效益（扣托管与磨合、含 J 曲线爬坡）</div><div class='v'>" + range(r.firstYearNet.low, r.firstYearNet.high, wan) + "</div></div>" +
      "<div class='kpi'><div class='k'>首年实施投入（诊断+试点+托管）</div><div class='v'>" + range(r.firstYearCost.low, r.firstYearCost.high, wan) + "</div></div>" +
      "<div class='kpi'><div class='k'>回本周期（一次性投入回收）</div><div class='v'>" + pbTxt + "</div></div>" +
      "<div class='kpi'><div class='k'>3 年净效益（扣实施成本）</div><div class='v'>" + range(r.net3Year.low, r.net3Year.high, wan) + "</div></div></div>";
    if (r.volumeGain) html += "<p class='hint'>按月业务量 " + input.monthlyVolume + " 件估算，同等人力下每月可多承接约 " + range(r.volumeGain.low, r.volumeGain.high, function (v) { return Math.round(v).toLocaleString("zh-CN"); }) + " 件（产能释放折算，非营收承诺）。</p>";
    var cov = r.coverage;
    if (cov) {
      if (cov.mode === "单部门试点口径") html += "<p class='hint'>岗位覆盖率（单部门试点口径）：仅「" + esc(cov.pilotDeptLabel || "") + "」1 个部门计入效益与成本，覆盖 " + cov.coveredHeads + "/" + cov.totalHeads + " 人（" + Math.round(cov.headRatio * 100) + "%）；其余部门不在本次口径内。</p>";
      else html += "<p class='hint'>岗位覆盖率：首批岗位覆盖 " + cov.coveredDeptCount + "/" + cov.deptCount + " 个部门、" + cov.coveredHeads + "/" + cov.totalHeads + " 人（" + Math.round(cov.headRatio * 100) + "%）；未覆盖部门的释放工时与成本均未计入本报告。</p>";
    }
    html += "<p class='hint'>变现条件：本报告的金额为释放工时折算价值（释放工时 × 人力成本）；只有当释放的工时带来真实减员或避免新增招聘时，才转化为现金节约，否则体现为产能释放（同等人力承接更多业务）。</p>";
    if (r.firstYearNet.high < 0) html += "<p class='hint err'>提示：即使中性档，首年净效益也为负——磨合与爬坡成本在第一年占主导，建议缩小试点范围或先补组织就绪度（流程文档化、培训）再扩展。</p>";
    else if (r.netMonth.low < 0) html += "<p class='hint err'>提示：保守档下月折算价值低于托管月费，建议缩小首批岗位范围先行试点，再按实测基线扩展。</p>";
    if (r.net3Clamped) html += "<p class='hint'>注：保守情形下 3 年净效益原始计算为负，表中按 0 显示；这表示该规模/成本结构下不宜全量托管，应先做单岗位试点验证。</p>";

    if (r.sensitivity) {
      html += "<h3>关键假设敏感性（单因素摆动对中性档月净折算价值的影响，前三）</h3><table><tr><th>假设</th><th>摆动</th><th>中性档月净折算价值区间</th><th>最大影响</th></tr>";
      r.sensitivity.forEach(function (s) {
        html += "<tr><td>" + esc(s.label) + "</td><td class='num'>" + esc(s.swing) + "</td><td class='num'>" + range(s.netLow, s.netHigh, wan) + "</td><td class='num'>" + wan(s.impact) + "</td></tr>";
      });
      html += "</table><p class='hint'>敏感性为单因素摆动：其余输入不变，逐个假设上下摆动 30% 后重算。影响越大，结论越依赖该假设，正式诊断应优先以企业真实基线替换该假设。</p>";
    }
    if (r.breakeven) {
      html += "<h3>盈亏平衡点（中性档，线性近似）</h3>";
      if (r.breakeven.hostedUnit !== null && r.breakeven.hostedUnit !== undefined) html += "<p class='hint'>托管单价平衡点：<strong>" + yuan(r.breakeven.hostedUnit) + "/岗/月</strong>（高于此价，中性档月净折算价值转负；当前参数低档 " + yuan(r.params.hostedLow) + "/岗/月）。</p>";
      else html += "<p class='hint'>托管单价平衡点：无解——中性档释放工时折算价值为 0，任何正单价都无法回本。</p>";
      if (r.breakeven.realization === null || r.breakeven.realization === undefined) html += "<p class='hint'>实现率平衡点：无解——中性档释放工时折算价值为 0。</p>";
      else if (r.breakeven.realizationExceeds) html += "<p class='hint'>实现率平衡点：超过 100%（无解）——即使实现率拉满，中性档月净折算价值仍为负，需先降成本或扩大试点范围。</p>";
      else html += "<p class='hint'>实现率平衡点：<strong>" + Math.round(r.breakeven.realization * 100) + "%</strong>（低于此实现率，中性档月净折算价值转负；当前中性情景实现率 " + Math.round(r.params.realizeNeutral * 100) + "%）。</p>";
    }

    html += "<h3>磨合成本（v2 新增，首年单列）</h3><table><tr><th>项目</th><th>口径</th><th>金额</th></tr>" +
      "<tr><td>全员培训工时成本</td><td>覆盖 " + r.friction.heads + " 人 × 人均 " + r.friction.trainHours + " 小时 × 时薪 " + yuan(r.friction.hourlyCost) + "</td><td class='num'>" + wan(r.friction.training) + "</td></tr>" +
      "<tr><td>流程改造与岗位卡建设（一次性）</td><td>按企业分级定额区间（定价假设）</td><td class='num'>" + range(r.friction.process.low, r.friction.process.high, wan) + "</td></tr>" +
      "<tr><td>首年沟通成本增量</td><td>首年人力成本 × " + (r.friction.commRate * 100).toFixed(2) + "%（分级费率 × 会议密度，假设值）</td><td class='num'>" + wan(r.friction.commYear1) + "</td></tr>" +
      "<tr><td><strong>磨合成本合计</strong></td><td>J 曲线：上线前 3 个月实现率按 30%/60%/85% 爬坡，已计入首年效益（折算系数 ×" + r.jFactor.toFixed(2) + "）</td><td class='num'><strong>" + range(r.friction.total.low, r.friction.total.high, wan) + "</strong></td></tr></table>";

    if (r.meetingAdvisory) {
      html += "<div class='advisory'><h3>" + esc(r.meetingAdvisory.title) + "</h3><ul>";
      r.meetingAdvisory.points.forEach(function (pt) { html += "<li>" + esc(pt) + "</li>"; });
      html += "</ul></div>";
    }

    html += "<h3>分部门明细（覆盖范围口径）</h3><table><tr><th>部门</th><th>人数</th><th>重复劳动占比</th><th>可自动化比例</th><th>可释放工时（人/月）</th><th>年折算价值（万元）</th><th>计入</th></tr>";
    r.depts.forEach(function (d) {
      if (d.headcount <= 0) return;
      html += "<tr><td>" + esc(d.label) + "</td><td class='num'>" + d.headcount + "</td><td class='num'>" +
        Math.round(d.repeatShare * 100) + "%</td><td class='num'>" + Math.round(d.autoBase * 100) + "%</td><td class='num'>" +
        range(d.fteConservative, d.fteNeutral, function (v) { return v.toFixed(1); }) + "</td><td class='num'>" +
        (d.covered ? range(d.saveMonthConservative * 12, d.saveMonthNeutral * 12, function (v) { return (v / 10000).toFixed(1); }) : "—") + "</td><td>" +
        (d.covered ? "计入" : "未计入（二期）") + "</td></tr>";
    });
    html += "</table><p class='hint'>未计入部门的释放工时为潜在口径，不进入本报告任何汇总；其岗位在首批达标后列入二期，届时按同一口径重算。</p>";

    html += "<h3>二、AI 组织实施结构方案</h3>";
    html += "<p>企业分级：<strong>" + esc(r.tier.detail) + "</strong>（" + esc(r.org.tierNote) + "）拟设 AI 数字员工岗位 " + r.postCount + " 个。首个试点岗位建议：<strong>" + esc(r.org.pilotPost) + "</strong>（按可释放工时最高测算）。</p>";
    html += "<table><tr><th>AI 岗位</th><th>对应部门</th><th>数量</th><th>职责</th><th>真人审核岗</th></tr>";
    r.org.posts.forEach(function (x) {
      html += "<tr><td>" + esc(x.name) + "</td><td>" + esc(x.dept) + "</td><td class='num'>" + x.count + "</td><td>" + esc(x.duty) + "</td><td>" + esc(x.reviewer) + "</td></tr>";
    });
    html += "</table>";
    if (r.org.deferred && r.org.deferred.length) html += "<p class='hint'>二期扩展岗位（首批达标后再上，避免一次配满托管岗）： " + r.org.deferred.map(esc).join("、") + "。</p>";
    html += "<h3>模块三层制（每个业务模块统一结构）</h3><ul>" +
      "<li><strong>执行队列</strong>：AI 员工领取任务、按岗位卡交付，任务按风险等级分发，高风险事项强制真人复核。</li>" +
      "<li><strong>审核台</strong>：真人只看异常与抽样，不逐条盯产出；审核岗见上表。</li>" +
      "<li><strong>档案</strong>：任务、产出、纠错全程留痕，形成岗位错误档案，作为考核与追责依据。</li></ul>";
    html += "<h3>真人保留与新增角色</h3><table><tr><th>角色</th><th>由谁担任</th><th>职责</th></tr>";
    r.org.humanRoles.forEach(function (x) {
      html += "<tr><td>" + esc(x.role) + "</td><td>" + esc(x.who) + "</td><td>" + esc(x.duty) + "</td></tr>";
    });
    html += "</table>";
    html += "<h3>分阶段路线（按分级差异化）</h3><ul>";
    r.org.route.forEach(function (s) { html += "<li>" + s + "</li>"; });
    html += "</ul>";
    html += "<h3>治理清单</h3><ul>" +
      "<li>岗位卡齐全（岗位目标、输入输出、工具权限、红线、上报路径）后才许上岗</li>" +
      "<li>错误档案：每次事故与纠正入档，同岗位全员必读</li>" +
      "<li>身份透明：对外服务明确为智能助理，真人责任人具名担责，不冒充真人</li>" +
      "<li>会议规则：默认异步书面简报代替 AI 入会；常规级会议只收纪要，负责人级会议真人参加终裁</li>" +
      "<li>数据合规：客户数据最小化采集、留痕，签数据处理条款，不出境、不进训练</li>" +
      "<li>效果三维并列：效率、成本、质量任一恶化即触发复盘</li></ul>";

    html += "<h3>三、假设清单（系数与来源）</h3><table><tr><th>系数</th><th>取值</th><th>来源类型</th><th>可信度</th></tr>";
    E.coefficientTable().forEach(function (row) {
      html += "<tr><td>" + esc(row.item) + "</td><td class='num'>" + esc(row.value) + "</td><td>" + srcTag(row.source) + "</td><td>" + esc(row.confidence) + "</td></tr>";
    });
    html += "</table><p class='hint'>本机调节参数：保守情景实现率 " + Math.round(r.params.realizeConservative * 100) + "%、中性情景实现率 " + Math.round(r.params.realizeNeutral * 100) + "%、重复占比缩放 ×" + r.params.repeatScale.toFixed(2) + "、托管单价 " + yuan(r.params.hostedLow) + "–" + yuan(r.params.hostedHigh) + "/岗位/月。标「假设值」的系数可在表单中调节，正式诊断将以企业真实基线数据替换。</p>";

    html += "<h3>下一步（服务入口）</h3><p>深度诊断：2 周流程盘点与基线测量，输出岗位 AI 化排序与试点方案。单岗位试点包：45 天单岗位托管试点，含岗位卡、治理规则与周效果账本，期末以实测数据复盘是否扩展。（本页为评估工具，正式合作请与服务团队联系签约。）</p>";
    html += "<p class='disclaimer'>免责声明：本报告基于公开基准与上表假设系数估算，不是收益承诺；行业与部门系数中标注「假设值」者未经逐户核实。正式诊断需以企业真实数据（处理量、响应时长、差错率、人力工时）做基线测量后重新测算。回本周期仅回收一次性投入（诊断+试点+培训+流程改造），托管月费已在月净折算价值中扣除；首年净效益已扣磨合成本并按 J 曲线爬坡折算，可能为负、照实呈现。</p>";

    showReport(html);
  }

  // ---------- 个人版 ----------
  var P_PRESETS = {
    consultant: { occ: "freelancer", hours: 50, income: "", hourly: 300, lit: "skilled", spend: 100,
                  tasks: { comm: 8, writing: 10, data: 6, research: 10, support: 6, learning: 4, other: 6 },
                  pains: ["writing", "acquire"] }
  };
  function readTasks() {
    var t = {};
    TASK_KEYS.forEach(function (k) { t[k] = Math.max(0, parseFloat($("t_" + k).value) || 0); });
    return t;
  }
  function updateTaskHint() {
    var t = readTasks(), sum = TASK_KEYS.reduce(function (s, k) { return s + t[k]; }, 0);
    var total = parseFloat($("pf_hours").value) || 0;
    var h = $("taskHint");
    h.textContent = "任务合计：" + sum + " 小时" + (total > 0 ? "｜每周工作：" + total + " 小时" + (sum <= total ? "（在工时内）" : "（超出 " + (sum - total) + " 小时，生成前请对齐）") : "");
    h.className = "hint" + (total > 0 && sum > total ? " err" : "");
  }
  TASK_KEYS.forEach(function (k) { $("t_" + k).addEventListener("input", updateTaskHint); });
  $("pf_hours").addEventListener("input", updateTaskHint);
  $("pf_mr").addEventListener("input", function () { $("v_mr").textContent = $("pf_mr").value + "%"; });

  document.querySelectorAll("[data-ppreset]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var pr = P_PRESETS[btn.getAttribute("data-ppreset")];
      $("pf_occ").value = pr.occ; $("pf_hours").value = pr.hours;
      $("pf_income").value = pr.income; $("pf_hourly").value = pr.hourly;
      $("pf_lit").value = pr.lit; $("pf_spend").value = pr.spend;
      TASK_KEYS.forEach(function (k) { $("t_" + k).value = pr.tasks[k]; });
      document.querySelectorAll("#pPainBox input").forEach(function (c) { c.checked = pr.pains.indexOf(c.value) >= 0; });
      updateTaskHint();
      $("pFormErr").textContent = "";
    });
  });

  function readPersonalInput() {
    return {
      occupation: $("pf_occ").value,
      monthlyIncome: parseFloat($("pf_income").value) || 0,
      hourlyRate: parseFloat($("pf_hourly").value) || 0,
      weeklyHours: parseFloat($("pf_hours").value) || 0,
      tasks: readTasks(),
      literacy: $("pf_lit").value,
      currentAiSpend: parseFloat($("pf_spend").value) || 0,
      pains: Array.prototype.map.call(document.querySelectorAll("#pPainBox input:checked"), function (c) { return c.value; })
    };
  }

  $("pForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = readPersonalInput();
    var r = E.evaluatePersonal(input, { monetizeRate: parseInt($("pf_mr").value, 10) / 100 });
    if (!r.valid) { $("pFormErr").textContent = r.errors[0]; return; }
    $("pFormErr").textContent = "";
    renderPersonal(input, r);
  });

  function renderPersonal(input, r) {
    var html = "";
    html += "<h2>个人评估报告</h2>";
    html += "<h3>输入回显</h3><p class='hint'>" + esc(r.occupationLabel) + "｜每周工作 " + r.weeklyHours +
      " 小时｜计价时薪 " + yuan(r.hourly) + (r.hourlyFromIncome ? "（由月收入折算）" : "（按填写时薪）") +
      "｜数字素养：" + esc(r.learning.label) + "｜当前 AI 月支出 " + yuan(r.currentAiSpend) + "｜时间变现率 " + Math.round(r.monetizeRate * 100) + "%</p>";

    html += "<h3>一、省时与效益（区间：保守 – 中性）</h3><div class='big'>" +
      "<div class='kpi'><div class='k'>每周可释放时间</div><div class='v'>" + range(r.releasedWeek.low, r.releasedWeek.high, function (v) { return v.toFixed(1); }) + " 小时</div></div>" +
      "<div class='kpi'><div class='k'>每月可释放时间</div><div class='v'>" + range(r.releasedMonth.low, r.releasedMonth.high, function (v) { return v.toFixed(1); }) + " 小时</div></div>" +
      "<div class='kpi'><div class='k'>月时间价值（按变现率折算）</div><div class='v'>" + range(r.timeValueMonth.low, r.timeValueMonth.high, wan) + "</div></div>" +
      "<div class='kpi'><div class='k'>智能体订阅成本（定价假设）</div><div class='v'>" + range(r.subCost.low, r.subCost.high, yuan) + "/月</div></div>" +
      "<div class='kpi'><div class='k'>月净效益（时间价值 − 订阅成本）</div><div class='v'>" + range(r.netMonth.low, r.netMonth.high, wan) + "</div></div>" +
      "<div class='kpi'><div class='k'>学习投入一次性</div><div class='v'>" + r.learning.hours + " 小时（适应期约 " + r.learning.weeks + " 周" + (r.paybackWeeks ? "，约 " + r.paybackWeeks.toFixed(1) + " 周回本" : "，当前口径下不回本") + "）</div></div></div>";
    if (r.monetizeRate === 0) html += "<p class='hint'>时间变现率为 0 时，时间价值按 0 计：省时仍真实存在，只是未折算为收入（可用于休息与生活）。</p>";
    if (r.netMonth.low < 0) html += "<p class='hint err'>提示：保守档下月净效益为负，建议先从预计省时最高的 1 个智能体试用起步，再扩充小队。</p>";

    html += "<h3>任务明细</h3><table><tr><th>任务</th><th>每周小时</th><th>可辅助比例</th><th>每周可释放（小时）</th></tr>";
    r.tasks.forEach(function (t) {
      if (t.hours <= 0) return;
      html += "<tr><td>" + esc(t.label) + "</td><td class='num'>" + t.hours + "</td><td class='num'>" +
        Math.round(t.assist * 100) + "%</td><td class='num'>" + range(t.released.low, t.released.high, function (v) { return v.toFixed(1); }) + "</td></tr>";
    });
    html += "</table>";

    html += "<h3>二、个人智能体小队（按任务分布与痛点生成）</h3><table><tr><th>智能体</th><th>服务任务</th><th>职责</th><th>预计省时（小时/周）</th></tr>";
    r.squad.forEach(function (s) {
      html += "<tr><td>" + esc(s.name) + "</td><td>" + esc(s.taskLabel) + "</td><td>" + esc(s.duty) + "</td><td class='num'>" +
        range(s.saveWeek.low, s.saveWeek.high, function (v) { return v.toFixed(1); }) + "</td></tr>";
    });
    html += "</table>";

    html += "<h3>三、90 天上手路线</h3><ul>" +
      "<li><strong>第 1–2 周 · 单点试用</strong>：只上「" + esc(r.squad[0].name) + "」一个智能体，记录实际省时与产出质量，定下自己的检查习惯。</li>" +
      "<li><strong>第 3–6 周 · 扩到三件套</strong>：按省时排序逐个加入小队成员，每加一个都留一周磨合，模板与提示词沉淀成个人档案。</li>" +
      "<li><strong>第 7–12 周 · 成习惯与复盘</strong>：每周复盘一次省时账本与适应期感受，淘汰不好用的智能体，学习投入（" + r.learning.hours + " 小时）在此阶段摊完。</li></ul>";
    html += "<h3>四、假设与声明</h3><p class='hint'>任务可辅助比例、落地系数与订阅单价均为假设值/定价假设（见企业版报告的假设清单口径）；省时估算不等于增收承诺，时间价值取决于变现率这一主观参数。时间价值与企业版同口径，均为释放工时折算价值：只有当省下的时间真实转化为收入时才是现金收益，否则为产能与生活空间。</p>";
    html += "<p class='disclaimer'>诚实声明：本报告与企业版同口径——所有数字由确定性公式按上表假设系数计算，是估算而非承诺；学习投入按小时单列、未折现进月净效益，回本周数按中位释放与变现率估算。建议以 2 周实测记录校准自己的可辅助比例后再做订阅决定。</p>";

    showReport(html);
  }

  updateDeptHint();
  updateTaskHint();
})();
