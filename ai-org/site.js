/* ai-org-app · site.js
 * 全站动效与首页六阶段导航器。零依赖、零外部资源；所有选择器都有空值防护，
 * 在没有对应元素的页面（评估器 / 指南 / 服务 / 合作）只做导航与显现动效，不报错。
 * 阶段文案与本站已验口径一致；任何价格出现时必带「定价假设」。 */
(function () {
  "use strict";
  document.documentElement.classList.add("js");

  /* ---- 导航：滚动毛玻璃 + 移动菜单 ---- */
  var header = document.querySelector(".siteNav");
  var toggle = document.querySelector(".menuToggle");
  if (header) {
    var onScroll = function () { header.classList.toggle("scrolled", window.scrollY > 12); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  if (header && toggle) {
    toggle.addEventListener("click", function () {
      var open = header.classList.toggle("menu-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    });
    var navLinks = header.querySelectorAll("nav a");
    for (var i = 0; i < navLinks.length; i++) {
      navLinks[i].addEventListener("click", function () {
        header.classList.remove("menu-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    }
  }

  /* ---- 首页：六阶段导航器 ---- */
  var stages = [
    {
      num: "01", name: "评估", role: "先算清楚，再动手",
      desc: "本站评估器按企业分级、组织就绪度与磨合成本三层口径出区间报告：毛节约与可实现节约分开算，首年净效益可为负、照实呈现。",
      input: "输入：企业属性、产值、员工数、部门人力",
      output: "输出：效益区间、候选岗位、组织结构草案",
      href: "evaluator.html", cta: "去做企业评估"
    },
    {
      num: "02", name: "诊断", role: "流程拆解与岗位筛选",
      desc: "把企业的真实流程拆开，挑出适合 AI 岗位化的环节，逐岗写清岗位卡：职责、输入输出、权限边界、验收口径。",
      input: "输入：现有流程、岗位构成、痛点清单",
      output: "输出：岗位卡、试点范围、验收口径",
      href: "services.html", cta: "查看服务与标准"
    },
    {
      num: "03", name: "试点", role: "单岗位先跑通",
      desc: "先上一个岗位，用影子运行和 100% 人工审核磨合，通过试点门（成功率、差错率、稳定运行天数等六项）再谈扩展；价格为定价假设。",
      input: "输入：试点岗位卡、基线数据",
      output: "输出：试点报告、三道门验收结论",
      href: "services.html", cta: "查看三道验收门"
    },
    {
      num: "04", name: "托管运营", role: "按月跑，周周有账",
      desc: "数字员工进入日常运行：每周一份效果账本（处理量、成功率、差错、节约工时、调用成本、真人介入率），漂移自动告警；价格为定价假设。",
      input: "输入：已验收的岗位与口径",
      output: "输出：周效果账本、告警与处置记录",
      href: "services.html", cta: "查看运营口径"
    },
    {
      num: "05", name: "集成商交付", role: "现场实施归伙伴",
      desc: "平台定标准、做评估、管验收；持证集成商做现场部署、系统对接与培训陪跑。集成商不自创口径，不代平台下验收结论。",
      input: "输入：平台标准包、验收口径",
      output: "输出：现场部署、培训与磨合陪跑",
      href: "partner.html", cta: "查看合作入口"
    },
    {
      num: "06", name: "数据与认证", role: "沉淀成可复用的规则",
      desc: "运行数据只回流脱敏聚合指标，沉淀为转型数据包与评估系数；测评认证让合格的智能体与集成商有据可查，不靠自吹。",
      input: "输入：脱敏聚合指标、验收档案",
      output: "输出：数据包版本、系数校准记录",
      href: "partner.html", cta: "查看合作入口"
    }
  ];
  var tabs = document.querySelectorAll("[data-stage]");
  var dNum = document.getElementById("stage-num");
  var dRole = document.getElementById("stage-role");
  var dDesc = document.getElementById("stage-desc");
  var dIn = document.getElementById("stage-input");
  var dOut = document.getElementById("stage-output");
  var dLink = document.getElementById("stage-link");
  var dPanel = document.querySelector(".stage-detail");
  if (tabs.length && dNum && dRole && dDesc && dIn && dOut && dLink) {
    var selectStage = function (idx) {
      var s = stages[idx];
      if (!s) return;
      for (var j = 0; j < tabs.length; j++) {
        var on = j === idx;
        tabs[j].classList.toggle("active", on);
        tabs[j].setAttribute("aria-selected", on ? "true" : "false");
      }
      dNum.textContent = s.num;
      dRole.textContent = s.role;
      dDesc.textContent = s.desc;
      dIn.textContent = s.input;
      dOut.textContent = s.output;
      dLink.setAttribute("href", s.href);
      dLink.firstChild.textContent = s.cta + " ";
      if (dPanel) {
        dPanel.classList.remove("swap");
        void dPanel.offsetWidth;
        dPanel.classList.add("swap");
      }
    };
    for (var k = 0; k < tabs.length; k++) {
      (function (idx) {
        tabs[idx].addEventListener("click", function () { selectStage(idx); });
      })(k);
    }
  }

  /* ---- 滚动显现 ---- */
  var revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length) {
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("visible"); io.unobserve(e.target); }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
      revealEls.forEach(function (el) { io.observe(el); });
    } else {
      revealEls.forEach(function (el) { el.classList.add("visible"); });
    }
  }
})();
