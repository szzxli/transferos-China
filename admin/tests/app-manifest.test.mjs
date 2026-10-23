// 一对一 v14.1 前端断言（jsdom）：个性化 manifest 链接改写。
// A. 学生页带 ?s&k 打开 → <link rel="manifest"> 改指 Worker /api/manifest/client/<s>?key=<k>
// B. 学生页无参数、无本地凭据 → manifest 链接不动（仍为静态 manifest.json）
// C. 学生页无参数、localStorage 有凭据 → 同样改指（本机二次打开再添加桌面也直达）
// D. 家长页带 ?s&p 打开 → 改指 /api/manifest/parent/<s>?key=<p>；无凭据 → 不动（manifest-parent.json）
// 运行：node tests/app-manifest.test.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/home/hatch/workspace/tools/jsdomtest/node_modules/jsdom");

const HTML = readFileSync(new URL("../../one-on-one-app/index.html", import.meta.url), "utf8");
const APPJS = readFileSync(new URL("../../one-on-one-app/majors.js", import.meta.url), "utf8") + "\n" +
  readFileSync(new URL("../../one-on-one-app/app.js", import.meta.url), "utf8");
const PHTML = readFileSync(new URL("../../one-on-one-app/parent.html", import.meta.url), "utf8");
const PJS = readFileSync(new URL("../../one-on-one-app/parent.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function section(s) { console.log("\n== " + s); }
const tick = () => new Promise((r) => setTimeout(r, 40));

function makeStudent(url, seedLs) {
  const dom = new JSDOM(HTML, { url, runScripts: "outside-only" });
  const w = dom.window;
  if (seedLs) for (const [k, v] of Object.entries(seedLs)) w.localStorage.setItem(k, v);
  w.fetch = async () => ({ status: 404, ok: false, json: async () => ({ ok: false }) });
  w.eval(APPJS);
  return w;
}
function makeParent(url, seedLs) {
  const dom = new JSDOM(PHTML, { url, runScripts: "outside-only" });
  const w = dom.window;
  if (seedLs) for (const [k, v] of Object.entries(seedLs)) w.localStorage.setItem(k, v);
  w.fetch = async () => ({ status: 404, ok: false, json: async () => ({ ok: false }) });
  w.eval(PJS);
  return w;
}
const mlink = (w) => w.document.querySelector('link[rel="manifest"]').getAttribute("href");

section("A. 学生页带凭据打开");
{
  const w = makeStudent("https://zhuanuc.com/one-on-one-app/?s=fix&k=key-fix&api=https://api.test");
  await tick();
  ok(mlink(w) === "https://api.test/api/manifest/client/fix?key=key-fix", "manifest 改指学生端点且带本人密钥：" + mlink(w));
}

section("B. 学生页无凭据");
{
  const w = makeStudent("https://zhuanuc.com/one-on-one-app/");
  await tick();
  ok(mlink(w) === "manifest.json", "manifest 链接不动（静态 manifest.json）");
}

section("C. 学生页靠 localStorage 凭据");
{
  const w = makeStudent("https://zhuanuc.com/one-on-one-app/", {
    ooo_student_id: "fix", ooo_client_key: "key-fix", ooo_api_base: "https://api.test",
  });
  await tick();
  ok(mlink(w) === "https://api.test/api/manifest/client/fix?key=key-fix", "凭据来自 localStorage 时同样改指");
}

section("D. 家长页");
{
  const w = makeParent("https://zhuanuc.com/one-on-one-app/parent.html?s=fix&p=pkey-fix&api=https://api.test");
  await tick();
  ok(mlink(w) === "https://api.test/api/manifest/parent/fix?key=pkey-fix", "manifest 改指家长端点且带家长密钥：" + mlink(w));
  const w2 = makeParent("https://zhuanuc.com/one-on-one-app/parent.html");
  await tick();
  ok(mlink(w2) === "manifest-parent.json", "家长页无凭据时链接不动（静态 manifest-parent.json）");
}

console.log("\n==== app-manifest: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
