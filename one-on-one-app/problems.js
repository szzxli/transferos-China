"use strict";
/* 问题解决中心（阶段 B/C · 本地规则引擎）
 * 硬纪律（蓝图第四节）：第一版不上云端分析——拆解、策略、知识卡匹配全部在本机完成，
 * 本文件不出现任何网络调用。离开设备的动作只有两个，都经 app.js 的 hooks 执行且须学生逐项确认：
 * ① syncProblem（把勾选的方案摘要字段同步到方案层）② escalateProblem（把学生确认过的摘要经既有留言通道发给导师）。
 * 自由文本（发生了什么/我试过什么/卡在哪）只用于本地画像与标签，永不进入同步载荷。 */
const OOOProblems = (() => {
  const DOMAINS = ["study", "exam", "business", "career", "family", "emotion", "other"];
  const BOTTLENECKS = {
    study: ["behind", "hard", "prereq", "plan"],
    exam: ["rules", "pace", "gap", "retries", "info"],
    business: ["compliance", "funds", "time", "product", "channel"],
    career: ["wait", "choice", "qual"],
    family: ["talk", "expect", "support"],
    emotion: ["low", "anxious", "alone"],
    other: ["stuck", "multi"],
  };
  /* 策略库（随 APP 静态发布）：每条 = 可能原因 / 今日止损 / 7 天方案（3–5 步带完成判据） / 求助顺序。
   * 文案走 i18n 键，库里只存键名，保证双语覆盖与口径统一。 */
  const LIB = {
    "exam:rules": { causes: ["c.exam.rules.1", "c.exam.rules.2"], today: "today.exam.rules", plan: ["p.exam.rules.1", "p.exam.rules.2", "p.exam.rules.3"], help: ["h.self.site", "h.mentor", "h.school.office"] },
    "exam:info": { causes: ["c.exam.info.1", "c.exam.info.2"], today: "today.exam.info", plan: ["p.exam.info.1", "p.exam.info.2", "p.exam.info.3"], help: ["h.mentor", "h.school.office"] },
    "exam:retries": { causes: ["c.exam.retries.1", "c.exam.retries.2"], today: "today.exam.retries", plan: ["p.exam.retries.1", "p.exam.retries.2", "p.exam.retries.3"], help: ["h.mentor", "h.school.office"] },
    "exam:pace": { causes: ["c.exam.pace.1", "c.exam.pace.2"], today: "today.exam.pace", plan: ["p.exam.pace.1", "p.exam.pace.2", "p.exam.pace.3"], help: ["h.self.plan", "h.mentor"] },
    "exam:gap": { causes: ["c.exam.gap.1", "c.exam.gap.2"], today: "today.exam.gap", plan: ["p.exam.gap.1", "p.exam.gap.2", "p.exam.gap.3"], help: ["h.self.review", "h.mentor"] },
    "study:prereq": { causes: ["c.study.prereq.1", "c.study.prereq.2"], today: "today.study.prereq", plan: ["p.study.prereq.1", "p.study.prereq.2", "p.study.prereq.3"], help: ["h.school.advisor", "h.mentor"] },
    "study:behind": { causes: ["c.study.behind.1", "c.study.behind.2"], today: "today.study.behind", plan: ["p.study.behind.1", "p.study.behind.2", "p.study.behind.3"], help: ["h.self.plan", "h.mentor"] },
    "study:hard": { causes: ["c.study.hard.1", "c.study.hard.2"], today: "today.study.hard", plan: ["p.study.hard.1", "p.study.hard.2", "p.study.hard.3"], help: ["h.school.tutor", "h.mentor"] },
    "study:plan": { causes: ["c.study.plan.1", "c.study.plan.2"], today: "today.study.plan", plan: ["p.study.plan.1", "p.study.plan.2", "p.study.plan.3"], help: ["h.mentor", "h.school.advisor"] },
    "business:compliance": { causes: ["c.biz.comp.1", "c.biz.comp.2"], today: "today.biz.comp", plan: ["p.biz.comp.1", "p.biz.comp.2", "p.biz.comp.3"], help: ["h.mentor", "h.pro.legal"] },
    "business:time": { causes: ["c.biz.time.1", "c.biz.time.2"], today: "today.biz.time", plan: ["p.biz.time.1", "p.biz.time.2", "p.biz.time.3"], help: ["h.self.plan", "h.mentor"] },
    "business:funds": { causes: ["c.biz.funds.1", "c.biz.funds.2"], today: "today.biz.funds", plan: ["p.biz.funds.1", "p.biz.funds.2", "p.biz.funds.3"], help: ["h.mentor"] },
    "business:product": { causes: ["c.biz.product.1", "c.biz.product.2"], today: "today.biz.product", plan: ["p.biz.product.1", "p.biz.product.2", "p.biz.product.3"], help: ["h.self.test", "h.mentor"] },
    "business:channel": { causes: ["c.biz.channel.1", "c.biz.channel.2"], today: "today.biz.channel", plan: ["p.biz.channel.1", "p.biz.channel.2", "p.biz.channel.3"], help: ["h.self.test", "h.mentor"] },
    "career:wait": { causes: ["c.career.wait.1", "c.career.wait.2"], today: "today.career.wait", plan: ["p.career.wait.1", "p.career.wait.2", "p.career.wait.3"], help: ["h.mentor"] },
    "career:choice": { causes: ["c.career.choice.1", "c.career.choice.2"], today: "today.career.choice", plan: ["p.career.choice.1", "p.career.choice.2", "p.career.choice.3"], help: ["h.mentor"] },
    "career:qual": { causes: ["c.career.qual.1", "c.career.qual.2"], today: "today.career.qual", plan: ["p.career.qual.1", "p.career.qual.2", "p.career.qual.3"], help: ["h.mentor", "h.school.office"] },
    "family:talk": { causes: ["c.family.talk.1", "c.family.talk.2"], today: "today.family.talk", plan: ["p.family.talk.1", "p.family.talk.2", "p.family.talk.3"], help: ["h.mentor.translate", "h.family.calm"] },
    "family:expect": { causes: ["c.family.expect.1", "c.family.expect.2"], today: "today.family.expect", plan: ["p.family.expect.1", "p.family.expect.2", "p.family.expect.3"], help: ["h.mentor.translate"] },
    "family:support": { causes: ["c.family.support.1", "c.family.support.2"], today: "today.family.support", plan: ["p.family.support.1", "p.family.support.2", "p.family.support.3"], help: ["h.mentor.translate", "h.family.calm"] },
    "emotion:low": { causes: ["c.emotion.low.1", "c.emotion.low.2"], today: "today.emotion.low", plan: ["p.emotion.low.1", "p.emotion.low.2", "p.emotion.low.3"], help: ["h.self.small", "h.school.counsel", "h.mentor"] },
    "emotion:anxious": { causes: ["c.emotion.anxious.1", "c.emotion.anxious.2"], today: "today.emotion.anxious", plan: ["p.emotion.anxious.1", "p.emotion.anxious.2", "p.emotion.anxious.3"], help: ["h.self.small", "h.school.counsel", "h.mentor"] },
    "emotion:alone": { causes: ["c.emotion.alone.1", "c.emotion.alone.2"], today: "today.emotion.alone", plan: ["p.emotion.alone.1", "p.emotion.alone.2", "p.emotion.alone.3"], help: ["h.mentor", "h.school.counsel"] },
    "other:stuck": { causes: ["c.other.stuck.1", "c.other.stuck.2"], today: "today.other.stuck", plan: ["p.other.stuck.1", "p.other.stuck.2", "p.other.stuck.3"], help: ["h.mentor"] },
    "other:multi": { causes: ["c.other.multi.1", "c.other.multi.2"], today: "today.other.multi", plan: ["p.other.multi.1", "p.other.multi.2", "p.other.multi.3"], help: ["h.self.plan", "h.mentor"] },
  };
  const DOMAIN_FALLBACK = {
    causes: ["c.generic.1", "c.generic.2"], today: "today.generic",
    plan: ["p.generic.1", "p.generic.2", "p.generic.3"], help: ["h.mentor"],
  };
  /* 合规关键词（与服务端 complianceFlag 同表，服务端会复算，本地只做即时提示） */
  const COMPLIANCE_WORDS = ["签证", "F-1", "工作许可", "打工", "营业执照", "公司注册", "代工厂", "食品", "销售许可", "税务", "报税", "收入申报", "移民", "OPT", "CPT", "雇佣", "创业注册", "经营许可"];
  const DOMAIN_TAGS = { exam: ["exam", "study"], study: ["study"], business: ["business"], career: [], family: [], emotion: [], other: [] };
  const RULE_BOTTLENECKS = ["rules", "info", "qual", "compliance", "retries"];

  /* 纯函数本地引擎：input = {domain, bottleneck, what, tried, stuck, impact, urgency, desired, support, resources[]}
   * knowledge = 接口下发的知识卡（tag 匹配子集）；tt = i18n 函数 (key) => text；riskCheck = 私密层风险词检测（app.js 注入）。
   * 输出五件：breakdown（拆解）/ causes（可能原因）/ todayAction + plan7（策略）/ knowledge（知识卡）/ helpOrder（求助顺序）
   * 外加 escalate（是否建议同步导师 + 命中条件）与 compliance（待核实标记）。全部本地计算，零上传。 */
  function solveLocally(input, knowledge, tt, riskCheck) {
    const t = typeof tt === "function" ? tt : (k) => k;
    const domain = DOMAINS.includes(input.domain) ? input.domain : "other";
    const bn = (BOTTLENECKS[domain] || []).includes(input.bottleneck) ? input.bottleneck : (BOTTLENECKS[domain] || ["stuck"])[0];
    const lib = LIB[domain + ":" + bn] || DOMAIN_FALLBACK;
    const impact = Math.min(5, Math.max(1, Number(input.impact) || 3));
    const urgency = Math.min(5, Math.max(1, Number(input.urgency) || 3));
    const score = impact * urgency;
    const level = score >= 16 ? "high" : score >= 8 ? "mid" : "low";
    const textBlob = [input.what, input.stuck, input.desired, input.support].join("\n");
    const complianceHit = COMPLIANCE_WORDS.filter((w) => textBlob.includes(w));
    if (bn === "compliance" && !complianceHit.length) complianceHit.push("compliance");
    const tags = DOMAIN_TAGS[domain] || [];
    const kn = (knowledge || []).filter((k) => tags.includes(String(k.tag || ""))).slice(0, 3)
      .map((k) => ({ id: k.id, title: k.title || "", body: k.body || "", tag: k.tag || "", why: t("pb.knowWhy") }));
    const reasons = [];
    if (impact >= 4 && urgency >= 4) reasons.push(t("pb.escHigh"));
    if (RULE_BOTTLENECKS.includes(bn)) reasons.push(t("pb.escRules"));
    if (complianceHit.length) reasons.push(t("pb.escCompliance"));
    const riskHit = typeof riskCheck === "function" && riskCheck(textBlob);
    if (riskHit) reasons.push(t("pb.escEmotion"));
    return {
      breakdown: {
        domain, domainLabel: t("pb.dom." + domain), bottleneck: bn, bottleneckLabel: t("pb.bn." + domain + "." + bn),
        impact, urgency, score, level, levelLabel: t("pb.level." + level),
      },
      causes: lib.causes.map((k) => t(k)),
      todayAction: t(lib.today),
      plan7: lib.plan.map((k) => {
        const raw = t(k);
        const parts = raw.split("｜");
        return { title: parts[0] || raw, criterion: parts[1] || "" };
      }),
      knowledge: kn,
      helpOrder: lib.help.map((k) => t(k)),
      escalate: { needed: reasons.length > 0, reasons },
      compliance: { flag: complianceHit.length ? "pending_review" : "ok", words: complianceHit },
      risk: riskHit,
    };
  }

  /* ================= 问题解决中心视图 ================= */
  function mount(root, hooks) {
    const t = hooks.t, esc = hooks.esc;
    let lastInput = null, lastResult = null, draftId = null;
    root.innerHTML =
      '<section class="card">' +
        '<h2>' + esc(t("pb.title")) + "</h2>" +
        '<p class="mut">' + esc(t("pb.localNote")) + "</p>" +
        '<form id="pb-form">' +
          '<label class="fld"><span>' + esc(t("pb.fDomain")) + '</span><select id="pb-domain">' +
            DOMAINS.map((d) => '<option value="' + d + '">' + esc(t("pb.dom." + d)) + "</option>").join("") + "</select></label>" +
          '<label class="fld"><span>' + esc(t("pb.fLine")) + '</span><select id="pb-line"></select></label>' +
          '<label class="fld"><span>' + esc(t("pb.fBottleneck")) + '</span><select id="pb-bn"></select></label>' +
          '<label class="fld"><span>' + esc(t("pb.fWhat")) + '</span><textarea id="pb-what" rows="2" maxlength="500" placeholder="' + esc(t("pb.localOnlyPh")) + '"></textarea></label>' +
          '<div id="pb-what-mic"></div>' +
          '<label class="fld"><span>' + esc(t("pb.fTried")) + '</span><textarea id="pb-tried" rows="2" maxlength="500" placeholder="' + esc(t("pb.localOnlyPh")) + '"></textarea></label>' +
          '<label class="fld"><span>' + esc(t("pb.fStuck")) + '</span><input id="pb-stuck" maxlength="120" placeholder="' + esc(t("pb.localOnlyPh")) + '"></label>' +
          '<div class="pb-sliders">' +
            '<label class="fld"><span>' + esc(t("pb.fImpact")) + ' <b id="pb-impact-v">3</b></span><input type="range" id="pb-impact" min="1" max="5" value="3"></label>' +
            '<label class="fld"><span>' + esc(t("pb.fUrgency")) + ' <b id="pb-urgency-v">3</b></span><input type="range" id="pb-urgency" min="1" max="5" value="3"></label>' +
          "</div>" +
          '<fieldset class="fld"><legend>' + esc(t("pb.fResources")) + "</legend>" +
            ["time", "money", "school", "mentor", "family", "peers", "none"].map((r) =>
              '<label class="chk"><input type="checkbox" class="pb-res" value="' + r + '"> ' + esc(t("pb.res." + r)) + "</label>").join("") +
          "</fieldset>" +
          '<label class="fld"><span>' + esc(t("pb.fDesired")) + '</span><input id="pb-desired" maxlength="120" placeholder="' + esc(t("pb.syncablePh")) + '"></label>' +
          '<label class="fld"><span>' + esc(t("pb.fSupport")) + '</span><input id="pb-support" maxlength="120" placeholder="' + esc(t("pb.syncablePh")) + '"></label>' +
          '<div class="priv-actions">' +
            '<button type="button" class="btn-ghost" id="pb-draft">' + esc(t("pb.saveDraft")) + "</button>" +
            '<button type="submit" class="btn-primary pb-gen">' + esc(t("pb.generate")) + "</button>" +
          "</div>" +
          '<p class="mut" id="pb-formmsg"></p>' +
        "</form>" +
      "</section>" +
      '<section class="card" id="pb-result-card" hidden><h2>' + esc(t("pb.resultTitle")) + '</h2><div id="pb-result"></div></section>' +
      '<section class="card"><h2>' + esc(t("pb.mine")) + '</h2><div id="pb-mine"></div></section>';

    const $id = (i) => root.querySelector("#" + i);
    function fillBottlenecks() {
      const d = $id("pb-domain").value;
      $id("pb-bn").innerHTML = (BOTTLENECKS[d] || []).map((b) =>
        '<option value="' + b + '">' + esc(t("pb.bn." + d + "." + b)) + "</option>").join("");
    }
    function fillLines() {
      const d = hooks.getData ? hooks.getData() : null;
      const lines = (d && d.goal_lines) || [];
      $id("pb-line").innerHTML = '<option value="">' + esc(t("pb.lineNone")) + "</option>" +
        lines.map((l) => '<option value="' + esc(l.name || "") + '">' + esc(l.name || "") + "</option>").join("");
    }
    $id("pb-domain").addEventListener("change", fillBottlenecks);
    $id("pb-impact").addEventListener("input", () => { $id("pb-impact-v").textContent = $id("pb-impact").value; });
    $id("pb-urgency").addEventListener("input", () => { $id("pb-urgency-v").textContent = $id("pb-urgency").value; });
    if (hooks.attachVoice) {
      hooks.attachVoice($id("pb-what"), { scope: "private", mount: $id("pb-what-mic") });
    }
    fillBottlenecks(); fillLines();

    function readInput() {
      return {
        domain: $id("pb-domain").value,
        line: $id("pb-line").value,
        bottleneck: $id("pb-bn").value,
        what: $id("pb-what").value.trim(),
        tried: $id("pb-tried").value.trim(),
        stuck: $id("pb-stuck").value.trim(),
        impact: Number($id("pb-impact").value),
        urgency: Number($id("pb-urgency").value),
        resources: [...root.querySelectorAll(".pb-res:checked")].map((x) => x.value),
        desired: $id("pb-desired").value.trim(),
        support: $id("pb-support").value.trim(),
      };
    }
    $id("pb-draft").addEventListener("click", async () => {
      const inp = readInput();
      const body = [inp.what, inp.tried, inp.stuck].filter(Boolean).join("\n");
      if (!body && !inp.desired) { $id("pb-formmsg").textContent = t("pb.needSomething"); return; }
      if (hooks.privateAddDraft) {
        draftId = await hooks.privateAddDraft({
          body: body || inp.desired,
          tags: [inp.domain],
          meta: { domain: inp.domain, bottleneck: inp.bottleneck, desired: inp.desired },
        });
        $id("pb-formmsg").textContent = t("pb.draftSaved");
      }
    });
    $id("pb-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      lastInput = readInput();
      const d = hooks.getData ? hooks.getData() : null;
      lastResult = solveLocally(lastInput, (d && d.knowledge) || [], t, hooks.riskCheck);
      renderResult();
    });

    function defaultTitle(inp, res) {
      if (inp.desired) return inp.desired.slice(0, 60);
      return res.breakdown.domainLabel + "：" + res.breakdown.bottleneckLabel;
    }
    function renderResult() {
      const res = lastResult, inp = lastInput;
      if (!res) return;
      const box = $id("pb-result");
      $id("pb-result-card").hidden = false;
      box.innerHTML =
        (res.risk
          ? '<div class="pb-care"><h3>' + esc(t("care.title")) + "</h3>" +
            '<p class="care-lead">' + esc(t("care.lead")) + "</p>" +
            '<ul class="care-list"><li>' + esc(t("care.us")) + "</li><li>" + esc(t("care.textline")) + "</li><li>" +
            esc(t("care.school")) + "</li><li>" + esc(t("care.cn")) + "</li></ul>" +
            '<p class="mut">' + esc(t("care.note")) + "</p></div>" : "") +
        (res.compliance.flag === "pending_review"
          ? '<div class="review-banner">' + esc(t("pb.reviewBanner")) + "</div>" : "") +
        '<div class="pb-sec"><h3>' + esc(t("pb.outBreakdown")) + "</h3>" +
          '<p>' + esc(res.breakdown.domainLabel) + " · " + esc(res.breakdown.bottleneckLabel) +
          " · " + esc(t("pb.impactWord")) + " " + res.breakdown.impact + "/5 · " + esc(t("pb.urgencyWord")) + " " + res.breakdown.urgency + "/5" +
          ' · <b>' + esc(res.breakdown.levelLabel) + "</b></p></div>" +
        '<div class="pb-sec"><h3>' + esc(t("pb.outCauses")) + "</h3><ul>" +
          res.causes.map((c) => "<li>" + esc(c) + "</li>").join("") + "</ul></div>" +
        '<div class="pb-sec"><h3>' + esc(t("pb.outToday")) + "</h3><p class='pb-today'>" + esc(res.todayAction) + "</p></div>" +
        '<div class="pb-sec"><h3>' + esc(t("pb.outPlan")) + "</h3><ol>" +
          res.plan7.map((p) => "<li><b>" + esc(p.title) + "</b>" + (p.criterion ? '<span class="mut">（' + esc(t("pb.criterion")) + "：" + esc(p.criterion) + "）</span>" : "") + "</li>").join("") + "</ol></div>" +
        (res.knowledge.length ? '<div class="pb-sec"><h3>' + esc(t("pb.outKnow")) + "</h3>" +
          res.knowledge.map((k) => '<div class="know-item"><div class="know-title">' + esc(k.title) + '</div><div class="mut">' + esc(k.why) + '</div><div class="know-body">' + esc(k.body) + "</div></div>").join("") + "</div>" : "") +
        '<div class="pb-sec"><h3>' + esc(t("pb.outHelp")) + "</h3><ol>" +
          res.helpOrder.map((h) => "<li>" + esc(h) + "</li>").join("") + "</ol></div>" +
        '<div class="pb-sec"><h3>' + esc(t("pb.outEscalate")) + "</h3>" +
          (res.escalate.needed
            ? '<p class="pb-esc-yes">' + esc(t("pb.escYes")) + "</p><ul>" + res.escalate.reasons.map((r) => "<li>" + esc(r) + "</li>").join("") + "</ul>"
            : '<p class="mut">' + esc(t("pb.escNo")) + "</p>") +
        "</div>" +
        '<div class="pb-sec pb-sync"><h3>' + esc(t("pb.syncTitle")) + "</h3>" +
          '<p class="mut">' + esc(t("pb.syncNote")) + "</p>" +
          [["title", t("pb.syncF.title")], ["desired", t("pb.syncF.desired")], ["strategy", t("pb.syncF.strategy")], ["actions", t("pb.syncF.actions")], ["support", t("pb.syncF.support")]].map(([k, label]) =>
            '<label class="chk"><input type="checkbox" class="pb-sync-f" value="' + k + '" checked> ' + esc(label) + "</label>").join("") +
          '<div class="priv-actions">' +
            '<button type="button" class="btn-primary" id="pb-sync-btn">' + esc(t("pb.syncBtn")) + "</button>" +
            '<button type="button" class="btn-ghost" id="pb-esc-btn">' + esc(t("pb.escBtn")) + "</button>" +
          "</div>" +
          '<p class="mut" id="pb-syncmsg"></p>' +
        "</div>";
      box.querySelector("#pb-sync-btn").addEventListener("click", async () => {
        const fields = [...box.querySelectorAll(".pb-sync-f:checked")].map((x) => x.value);
        if (!fields.length) { $id("pb-syncmsg").textContent = t("pb.syncNone"); return; }
        const strategy = t("pb.todayWord") + "：" + res.todayAction + "\n" + t("pb.planWord") + "：" + res.plan7.map((p) => p.title).join("；");
        const payload = {
          domain: res.breakdown.domain,
          title: fields.includes("title") ? defaultTitle(inp, res) : res.breakdown.domainLabel + "：" + res.breakdown.bottleneckLabel,
          desired_outcome: fields.includes("desired") ? inp.desired : "",
          strategy_summary: fields.includes("strategy") ? strategy : "",
          actions: fields.includes("actions") ? res.plan7.map((p) => ({ title: p.title })) : [],
          support_needed: fields.includes("support") ? inp.support : "",
          source_local_id: draftId || undefined,
        };
        const btn = box.querySelector("#pb-sync-btn");
        btn.disabled = true;
        const out = await hooks.syncProblem(payload);
        btn.disabled = false;
        $id("pb-syncmsg").textContent = out && out.ok ? t("pb.syncDone") : t("pb.syncFail");
        if (out && out.ok) { lastProblemId = out.problem && out.problem.id ? out.problem.id : null; refreshMine(); }
      });
      box.querySelector("#pb-esc-btn").addEventListener("click", async () => {
        const text = t("pb.escMsgHead") + "\n" +
          t("pb.outBreakdown") + "：" + res.breakdown.domainLabel + " · " + res.breakdown.bottleneckLabel + "\n" +
          (inp.desired ? t("pb.fDesired") + "：" + inp.desired + "\n" : "") +
          t("pb.outToday") + "：" + res.todayAction + "\n" +
          t("pb.planWord") + "：" + res.plan7.map((p) => p.title).join("；") +
          (inp.support ? "\n" + t("pb.fSupport") + "：" + inp.support : "");
        if (!window.confirm(t("pb.escConfirm") + "\n\n" + text)) return;
        const out = await hooks.escalateProblem(text, lastProblemId);
        $id("pb-syncmsg").textContent = out && out.ok ? t("pb.escDone") : t("pb.syncFail");
        if (out && out.ok) refreshMine();
      });
    }
    let lastProblemId = null;

    function refreshMine() {
      const d = hooks.getData ? hooks.getData() : null;
      const list = (d && d.problems) || [];
      $id("pb-mine").innerHTML = list.length ? list.map((p) =>
        '<div class="pb-item">' +
          '<div class="priv-meta"><span class="pill">' + esc(p.domain_label || "") + '</span>' +
          '<span class="badge ' + (p.progress === "resolved" ? "pass" : p.progress === "escalated" ? "fail" : "pending") + '">' + esc(p.progress_label || "") + "</span>" +
          (p.compliance === "pending_review" ? '<span class="pill review">' + esc(t("pb.reviewTag")) + "</span>" : "") +
          '<span class="mut">' + esc(String(p.created_at || "").slice(0, 10)) + "</span></div>" +
          '<div class="pb-item-title">' + esc(p.title || "") + "</div>" +
          (p.desired_outcome ? '<div class="mut">' + esc(t("pb.fDesired")) + "：" + esc(p.desired_outcome) + "</div>" : "") +
          (p.progress !== "resolved"
            ? '<div class="priv-item-actions"><button type="button" class="btn-ghost small" data-resolve="' + p.id + '">' + esc(t("pb.markResolved")) + "</button></div>"
            : (p.resolved_note ? '<div class="mut">' + esc(p.resolved_note) + "</div>" : "")) +
        "</div>").join("")
        : '<p class="empty">' + esc(t("pb.mineEmpty")) + "</p>";
      $id("pb-mine").querySelectorAll("[data-resolve]").forEach((b) => b.addEventListener("click", async () => {
        const note = window.prompt(t("pb.resolveNotePh")) || "";
        const out = await hooks.problemStatus(Number(b.getAttribute("data-resolve")), "resolved", note);
        if (out && out.ok) refreshMine();
      }));
    }

    function applyPrefill(prefill) {
      if (!prefill) return;
      if (prefill.draftId) draftId = prefill.draftId;
      if (prefill.draftText) $id("pb-what").value = prefill.draftText;
      fillLines();
    }
    refreshMine();
    return { refresh: () => { fillLines(); refreshMine(); }, applyPrefill, solveLocally };
  }

  return { DOMAINS, BOTTLENECKS, LIB, COMPLIANCE_WORDS, solveLocally, mount };
})();
