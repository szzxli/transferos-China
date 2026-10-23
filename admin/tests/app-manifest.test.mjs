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

section("E. v14.2 head 内联脚本同步改指（不加载 app.js，eval 后立即断言）");
function headInline(html, marker) {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return blocks.find((b) => b.includes(marker)) || null;
}
const S_INLINE = headInline(HTML, "/api/manifest/client/");
const P_INLINE = headInline(PHTML, "/api/manifest/parent/");
ok(!!S_INLINE, "学生页 <head> 内存在个性化 manifest 内联脚本");
ok(!!P_INLINE, "家长页 <head> 内存在个性化 manifest 内联脚本");
{
  const dom = new JSDOM(HTML, { url: "https://zhuanuc.com/one-on-one-app/?s=fix&k=key-fix&api=https://api.test", runScripts: "outside-only" });
  dom.window.eval(S_INLINE);
  ok(mlink(dom.window) === "https://api.test/api/manifest/client/fix?key=key-fix", "学生：仅内联脚本执行后 manifest 已同步改指：" + mlink(dom.window));
}
{
  const dom = new JSDOM(HTML, { url: "https://zhuanuc.com/one-on-one-app/", runScripts: "outside-only" });
  dom.window.localStorage.setItem("ooo_student_id", "fix");
  dom.window.localStorage.setItem("ooo_client_key", "key-fix");
  dom.window.localStorage.setItem("ooo_api_base", "https://api.test");
  dom.window.eval(S_INLINE);
  ok(mlink(dom.window) === "https://api.test/api/manifest/client/fix?key=key-fix", "学生：无 URL 参数、靠 localStorage 时内联脚本同样改指");
}
{
  const dom = new JSDOM(HTML, { url: "https://zhuanuc.com/one-on-one-app/", runScripts: "outside-only" });
  dom.window.eval(S_INLINE);
  ok(mlink(dom.window) === "manifest.json", "学生：无凭据时内联脚本不动 manifest 链接");
}
{
  const dom = new JSDOM(PHTML, { url: "https://zhuanuc.com/one-on-one-app/parent.html?s=fix&p=pkey-fix&api=https://api.test", runScripts: "outside-only" });
  dom.window.eval(P_INLINE);
  ok(mlink(dom.window) === "https://api.test/api/manifest/parent/fix?key=pkey-fix", "家长：仅内联脚本执行后 manifest 已同步改指：" + mlink(dom.window));
}
{
  const dom = new JSDOM(PHTML, { url: "https://zhuanuc.com/one-on-one-app/parent.html", runScripts: "outside-only" });
  dom.window.eval(P_INLINE);
  ok(mlink(dom.window) === "manifest-parent.json", "家长：无凭据时内联脚本不动 manifest 链接");
}

section("F. v14.2 JS 引用带版本参数（破缓存）");
for (const f of ["private.js", "problems.js", "majors.js", "app.js"]) {
  ok(HTML.includes('src="' + f + "?v="), "学生页 " + f + " 带 ?v= 版本参数");
}
ok(PHTML.includes('src="parent.js?v='), "家长页 parent.js 带 ?v= 版本参数");

console.log("\n==== app-manifest: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
