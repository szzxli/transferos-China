"use strict";
var assert = require("assert");
var formatTag = require("./tag-line.js").formatTag;

function view(uc, major, pace, avg) {
  return formatTag(uc, major, pace, avg);
}
function must(cond, msg) {
  assert.ok(cond, msg);
}
function noPromise(text, where) {
  must(!/包过/.test(text), where + " 出现了包过");
  must(!/保录(?!计划)/.test(text), where + " 出现了承诺式的保录：" + text);
  must(!/保证录取/.test(text), where + " 出现了保证录取");
}

var cases = [
  ["UC Berkeley", "Computer Science B.A", "2yr", 3.8],
  ["UCLA", "Psychology B.A", "2yr", 3.9],
  ["UC San Diego", "CSE Computer Science B.S", "1yr", 3.7],
  ["UC Davis", "Computer Science Engineering B.S", "1yr", 3.6],
  ["UC Davis", "Economics A.B", "2yr", 3.0],
  ["UC Davis", "Computer Science B.S", "2yr", 3.8],
  ["UC Davis", "Data Science B.S", "1yr", 3.5],
  ["UC Santa Cruz", "Psychology B.A", "2yr", 2.8],
  ["UC Irvine", "Psychology B.S", "2yr", 3.8],
  ["UC Irvine", "Psychology B.A", "1yr", 3.5],
  ["UC Irvine", "Business Administration B.A", "1yr", 3.9],
  ["UC Irvine", "Computer Science B.S", "2yr", 4],
  ["UC Irvine", "Data Science B.S", "1yr", 3.6],
  ["UC Irvine", "Computer Science and Engineering B.S", "2yr", 3.9],
  ["UC Irvine", "Economics B.A", "2yr", 3.2],
  ["UC Irvine", "Biology Education B.S", "2yr", 3.6],
  ["UC Irvine", "Biochemistry and Molecular Biology B.S", "2yr", 3.5],
  ["UC Irvine", "Ecology and Evolutionary Biology B.S", "1yr", 3.4],
  ["UC Merced", "Psychology B.A", "2yr", 3.1],
  ["UC Merced", "Mechanical Engineering B.S", "1yr", 2.9],
  ["UC Merced", "Economics B.A", "2yr", 3.2],
  ["UC Riverside", "Computer Science B.S", "1yr", 3.6],
  ["UC Riverside", "Computer Science with Business Applications B.S", "2yr", 3.3],
  ["UC Riverside", "Mechanical Engineering B.S", "1yr", 3.0],
  ["UC Riverside", "Art Studio B.A", "2yr", 3.5],
  ["UC Santa Barbara", "Mechanical Engineering B.S", "1yr", 3.8],
  ["UC Santa Barbara", "Economics B.A", "2yr", 3.5],
  ["UC Santa Barbara", "Dance B.A", "2yr", 3.6]
];

cases.forEach(function (c) {
  var tag = view(c[0], c[1], c[2], c[3]);
  var blob = tag.label + "\n" + tag.value + "\n" + tag.detail + "\n" + tag.summary;
  noPromise(blob, c[0] + " / " + c[1]);
  must(/以官网为准/.test(tag.summary), "小结缺少以官网为准：" + c[0]);
});

function isOut(tag) {
  must(tag.mode !== "line" || tag.value.indexOf("✅") === -1, "不该打勾：" + tag.value);
  must(tag.value.indexOf("✅") === -1, "出现了勾：" + tag.value);
  must(!/高出|还差/.test(tag.value), "出现了差距：" + tag.value);
}

var ucla = view("UCLA", "Psychology B.A", "2yr", 3.9);
isOut(ucla);
must(ucla.value.indexOf("该校不参与 TAG（保录计划）") >= 0, ucla.value);
must(ucla.value.indexOf("3.4") === -1, ucla.value);

var ucb = view("UC Berkeley", "Economics B.A", "1yr", 3.2);
isOut(ucb);
must(ucb.value.indexOf("该校不参与 TAG（保录计划）") >= 0, ucb.value);

var ucsd = view("UC San Diego", "Biology General Biology B.S", "2yr", 3.6);
isOut(ucsd);

var davisEng = view("UC Davis", "Computer Science Engineering B.S", "1yr", 3.6);
must(davisEng.gpa === 3.5, "Davis 工学院应为 3.5");
must(davisEng.value.indexOf("3.5") >= 0 && davisEng.value.indexOf("✅") >= 0, davisEng.value);
must(davisEng.value.indexOf("高出 0.10") >= 0, davisEng.value);

var davisLs = view("UC Davis", "Psychology A.B", "2yr", 3.1);
must(davisLs.gpa === 3.2, "Davis 其他学院应为 3.2");
must(davisLs.value.indexOf("还差 0.10") >= 0, davisLs.value);

var davisCs = view("UC Davis", "Computer Science B.S", "2yr", 3.9);
isOut(davisCs);
must(davisCs.summary.indexOf("不在") >= 0, davisCs.summary);

var sc = view("UC Santa Cruz", "Computer Science B.S", "2yr", 3.0);
must(sc.gpa === 3.0, "Santa Cruz 应为 3.0");
must(sc.value.indexOf("达到这条线 ✅") >= 0, sc.value);
must(sc.detail.indexOf("专业课 GPA") >= 0, sc.detail);

var psy2 = view("UC Irvine", "Psychology B.S", "2yr", 3.9);
isOut(psy2);
must(psy2.value.indexOf("2028 秋不能走 UCI TAG（保录计划）") >= 0, psy2.value);
must(psy2.summary.indexOf("2028 秋不能走") >= 0, psy2.summary);

var psy1 = view("UC Irvine", "Psychology B.A", "1yr", 3.5);
must(psy1.mode === "line" && psy1.gpa === 3.4, "1 年 Psychology 仍可对照 3.4");
must(psy1.value.indexOf("✅") >= 0, psy1.value);
must(psy1.detail.indexOf("2028 秋") >= 0 && psy1.detail.indexOf("不能走") >= 0, psy1.detail);

var biz = view("UC Irvine", "Business Administration B.A", "2yr", 4);
isOut(biz);
must(biz.value.indexOf("2027 秋和 2028 秋") >= 0, biz.value);

var cse = view("UC Irvine", "Computer Science and Engineering B.S", "1yr", 3.8);
isOut(cse);
must(cse.value.indexOf("✅") === -1, cse.value);

var bio = view("UC Irvine", "Biochemistry and Molecular Biology B.S", "2yr", 3.2);
must(bio.mode === "line" && bio.gpa === 3.4, "生化不在排除名单");
must(bio.value.indexOf("还差") >= 0, bio.value);

var mercedP = view("UC Merced", "Psychology B.S", "1yr", 2.9);
must(mercedP.gpa === 3.0, "Merced Psychology 3.0");
var mercedE = view("UC Merced", "Bioengineering B.S", "2yr", 3.2);
must(mercedE.gpa === 3.0, "Merced 工学院 3.0");
var mercedX = view("UC Merced", "Economics B.A", "2yr", 3.4);
isOut(mercedX);
must(mercedX.detail.indexOf("2.8") >= 0 && mercedX.detail.indexOf("2.9") >= 0, mercedX.detail);

var rcs = view("UC Riverside", "Computer Science B.S", "1yr", 3.5);
must(rcs.gpa === 3.6, "UCR CS 3.6");
var rba = view("UC Riverside", "Computer Science with Business Applications B.S", "2yr", 3.3);
must(rba.gpa === 3.3, rba.value);
var rme = view("UC Riverside", "Mechanical Engineering B.S", "1yr", 3.1);
must(rme.gpa === 3.1 && rme.value.indexOf("达到这条线") >= 0, rme.value);
var ras = view("UC Riverside", "Art Studio B.A", "2yr", 4);
isOut(ras);

var sbEng = view("UC Santa Barbara", "Computer Engineering B.S", "2yr", 3.9);
isOut(sbEng);
var sbEcon = view("UC Santa Barbara", "Economics B.A", "1yr", 3.4);
must(sbEcon.gpa === 3.4, "UCSB 3.4");
must(sbEcon.detail.indexOf("专业课") >= 0, sbEcon.detail);
must(sbEcon.value.indexOf("达到这条线 ✅") >= 0, sbEcon.value);

var none = view("", "", "2yr", 3.8);
isOut(none);

console.log("tag-line tests passed");
cases.forEach(function (c) {
  var tag = view(c[0], c[1], c[2], c[3]);
  console.log([c[2], c[0], c[1], tag.mode, tag.gpa, tag.value].join(" | "));
});
