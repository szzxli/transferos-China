# TransferOS-China

加州社区大学 → UC 转学顾问工具，面向中国二本/三本/专科学生。

**两所学校**：De Anza College / Foothill College（2026-27 非居民 $284/学分，官网已核实）
**两种方式**：💻 纯线上（人在中国，无需签证）/ ✈️ 赴美线下（F-1 签证）

## 六段流程

1. **评估**（evaluate.html）— 年龄 / 学历 / 英语（Duolingo·托福）三维评估
2. **费用**（cost.html）— 双模式费用测算，诚实总账
3. **选课**（plan.html）— 选 UC+专业 → 转学课程清单勾选 → 覆盖率
4. **规划**（track.html）— 1年/2年转学，quarter 制自动排课
5. **辅导**（coach.html）— 按季度跟踪 GPA 与进度
6. **转学**（transfer.html）— TAG / 网申 / 放榜 / 签证时间线 + checklist

另有 **指南**（guide.html）：申请时间线、材料清单、F-1 签证风险披露。

## 数据

`data/` 下 20 个 JSON：两校 × 6 所 UC 的 ASSIST 转学协议课程映射（2026-10-17 提取，226 个专业）。
协议每年更新，选课前请以 ASSIST 官网和学校 counselor 为准。

## 技术

纯静态 PWA，零后端。所有用户数据存 localStorage，无统计代码。

## 声明

本工具仅提供公开信息整理与测算，不构成留学中介服务，**不承诺任何录取结果**。
