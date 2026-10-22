// 一对一 v13.2 前端断言（jsdom）：添加到主屏幕
// A. manifest 规范（学生/家长）：字段齐、display=standalone、start_url、PNG 图标条目
// B. 图标文件实测：192/512/180 PNG 存在且 IHDR 尺寸精确
// C. 两页 head：apple-touch-icon / theme-color / mobile-web-app-capable / manifest 链接 / BIP 捕获脚本
// D. 环境分流（以 UA + standalone + BIP 事件实测）：ios / android-menu / android-bip / inapp / standalone / desktop
// E. 关闭记忆：点关闭写 localStorage 且不再显示；预置 dismissed 时不显示；家长端独立前缀
// F. 双语：切换 EN 后引导卡文案真变英文
// 运行：node tests/app-install.test.mjs
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/home/hatch/workspace/tools/jsdomtest/node_modules/jsdom");

const DIR = new URL("../../one-on-one-app/", import.meta.url);
const HTML = readFileSync(new URL("index.html", DIR), "utf8");
const PHTML = readFileSync(new URL("parent.html", DIR), "utf8");
const APP = readFileSync(new URL("app.js", DIR), "utf8");
const PARENT = readFileSync(new URL("parent.js", DIR), "utf8");
const PRIV = readFileSync(new URL("private.js", DIR), "utf8");
const PROB = readFileSync(new URL("problems.js", DIR), "utf8");
const MAJORS_JS = readFileSync(new URL("majors.js", DIR), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("manifest.json", DIR), "utf8"));
const PMANIFEST = JSON.parse(readFileSync(new URL("manifest-parent.json", DIR), "utf8"));

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function section(s) { console.log("\n== " + s); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));

/* ================= A. manifest 规范 ================= */
section("A. manifest 规范");
{
  ok(MANIFEST.name === "一对一专属客户端" && !!MANIFEST.short_name, "学生 manifest name/short_name 齐");
  ok(MANIFEST.display === "standalone", "学生 manifest display=standalone");
  ok(MANIFEST.start_url === "./index.html", "学生 manifest start_url=./index.html");
  ok(MANIFEST.theme_color === "#16453a" && MANIFEST.background_color === "#f6f6f1", "学生 manifest 主题/背景色与设计一致");
  const pngs = MANIFEST.icons.filter((i) => i.type === "image/png");
  ok(pngs.some((i) => i.sizes === "192x192" && i.src === "icon-192.png"), "学生 manifest 含 192 PNG 图标");
  ok(pngs.some((i) => i.sizes === "512x512" && i.src === "icon-512.png"), "学生 manifest 含 512 PNG 图标");
  ok(pngs.some((i) => i.purpose === "maskable" && i.sizes === "512x512"), "学生 manifest 含 maskable 512 图标");
  ok(PMANIFEST.name === "家长更新" && PMANIFEST.display === "standalone", "家长 manifest name + standalone");
  ok(PMANIFEST.start_url === "./parent.html", "家长 manifest start_url=./parent.html（不落到学生页）");
  ok(PMANIFEST.theme_color === "#16453a", "家长 manifest 主题色一致");
  const ppngs = PMANIFEST.icons.filter((i) => i.type === "image/png");
  ok(ppngs.some((i) => i.sizes === "192x192") && ppngs.some((i) => i.sizes === "512x512"), "家长 manifest 含 192/512 PNG 图标");
}

/* ================= B. 图标文件实测 ================= */
section("B. 图标 PNG 尺寸实测");
function pngSize(name) {
  const p = new URL(name, DIR);
  if (!existsSync(p)) return null;
  const b = readFileSync(p);
  if (b.length < 24 || b.toString("ascii", 1, 4) !== "PNG") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
{
  const s192 = pngSize("icon-192.png"), s512 = pngSize("icon-512.png"), s180 = pngSize("icon-180.png");
  ok(s192 && s192.w === 192 && s192.h === 192, "icon-192.png 实测 192x192");
  ok(s512 && s512.w === 512 && s512.h === 512, "icon-512.png 实测 512x512");
  ok(s180 && s180.w === 180 && s180.h === 180, "icon-180.png (apple-touch-icon) 实测 180x180");
}

/* ================= C. 两页 head ================= */
section("C. head meta 与链接");
{
  ok(HTML.includes('<link rel="apple-touch-icon" href="icon-180.png">'), "学生页 apple-touch-icon 指向 icon-180.png");
  ok(HTML.includes('<meta name="theme-color" content="#16453a">'), "学生页 theme-color");
  ok(HTML.includes('name="mobile-web-app-capable" content="yes"'), "学生页 mobile-web-app-capable");
  ok(HTML.includes('name="apple-mobile-web-app-capable" content="yes"'), "学生页 apple-mobile-web-app-capable");
  ok(HTML.includes('<link rel="manifest" href="manifest.json">'), "学生页 manifest 链接");
  ok(HTML.includes("beforeinstallprompt") && HTML.includes("__bipEvent"), "学生页 head 有 BIP 捕获脚本");
  ok(HTML.includes('id="install-card"'), "学生页含引导卡节点");
  ok(PHTML.includes('<link rel="manifest" href="manifest-parent.json">'), "家长页 manifest 链接指向 manifest-parent.json");
  ok(!PHTML.includes("manifest.webmanifest"), "家长页不再引用不存在的 manifest.webmanifest");
  ok(PHTML.includes('<link rel="apple-touch-icon" href="icon-180.png">'), "家长页 apple-touch-icon");
  ok(PHTML.includes('name="mobile-web-app-capable" content="yes"'), "家长页 mobile-web-app-capable");
  ok(PHTML.includes("__bipEvent"), "家长页 head 有 BIP 捕获脚本");
  ok(PHTML.includes('id="install-card"'), "家长页含引导卡节点");
}

/* ================= D/E/F. 行为分流 ================= */
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const UA_WECHAT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49";
const UA_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function bootStudent({ ua, preset, standalone }) {
  const dom = new JSDOM(HTML, {
    url: "https://zhuanuc.com/one-on-one-app/?s=fix&k=key-fix&api=https://api.test",
    runScripts: "outside-only",
    userAgent: ua,
  });
  const w = dom.window;
  Object.defineProperty(w.navigator, "userAgent", { value: ua, configurable: true }); // 本机 jsdom 构建忽略 userAgent 选项，须手动覆盖
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.fetch = async () => ({ status: 404, ok: false, json: async () => ({ ok: false }) });
  if (standalone) {
    w.matchMedia = (q) => ({ matches: /standalone/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
  if (preset) for (const [k, v] of Object.entries(preset)) w.localStorage.setItem(k, v);
  w.eval(PRIV + "\n" + PROB + "\n" + MAJORS_JS + "\n" + APP);
  return w;
}
function bootParent({ ua, preset }) {
  const dom = new JSDOM(PHTML, {
    url: "https://zhuanuc.com/one-on-one-app/parent.html?s=fix&p=key-fix&api=https://api.test",
    runScripts: "outside-only",
    userAgent: ua,
  });
  const w = dom.window;
  Object.defineProperty(w.navigator, "userAgent", { value: ua, configurable: true });
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.fetch = async () => ({ status: 404, ok: false, json: async () => ({ ok: false }) });
  if (preset) for (const [k, v] of Object.entries(preset)) w.localStorage.setItem(k, v);
  w.eval(PARENT);
  return w;
}
const vis = (w, id) => !w.document.getElementById(id).hidden;

section("D. 环境分流（学生端）");
{
  const wIos = bootStudent({ ua: UA_IPHONE });
  ok(vis(wIos, "install-card"), "iOS Safari：引导卡显示");
  ok(vis(wIos, "install-steps-ios") && !vis(wIos, "install-steps-android") && !vis(wIos, "install-steps-inapp") && !vis(wIos, "install-btn"),
    "iOS Safari：只显示分享三步，无安装按钮");

  const wAnd = bootStudent({ ua: UA_ANDROID });
  ok(vis(wAnd, "install-card") && vis(wAnd, "install-steps-android") && !vis(wAnd, "install-btn"),
    "Android 无 BIP 事件：显示菜单三步兜底，无一键按钮");

  const wBip = bootStudent({ ua: UA_ANDROID });
  const ev = new wBip.Event("beforeinstallprompt");
  let prompted = false;
  ev.prompt = () => { prompted = true; };
  ev.userChoice = Promise.resolve({ outcome: "accepted" });
  wBip.dispatchEvent(ev);
  ok(vis(wBip, "install-btn") && !vis(wBip, "install-steps-android"), "Android BIP 事件到达后：切换为一键安装按钮");
  wBip.document.getElementById("install-btn").click();
  await tick(30);
  ok(prompted, "点一键安装按钮调用了原生 prompt()");
  ok(!vis(wBip, "install-card") && wBip.localStorage.getItem("ooo_install_dismissed") === "1",
    "接受安装后：卡片隐藏且写入关闭记忆");

  const wWx = bootStudent({ ua: UA_WECHAT });
  ok(vis(wWx, "install-card") && vis(wWx, "install-steps-inapp") && !vis(wWx, "install-steps-ios"),
    "微信内置浏览器：显示先用系统浏览器打开的提示，不显示 iOS 步骤");

  const wSa = bootStudent({ ua: UA_IPHONE, standalone: true });
  ok(!vis(wSa, "install-card"), "已 standalone 打开：引导卡不显示");

  const wDesk = bootStudent({ ua: UA_DESKTOP });
  ok(!vis(wDesk, "install-card"), "桌面浏览器：引导卡不显示");
}

section("E. 关闭记忆");
{
  const w = bootStudent({ ua: UA_IPHONE });
  ok(vis(w, "install-card"), "关闭前卡片可见");
  w.document.getElementById("install-close").click();
  ok(!vis(w, "install-card") && w.localStorage.getItem("ooo_install_dismissed") === "1", "点关闭：隐藏并写入 ooo_install_dismissed=1");
  const w2 = bootStudent({ ua: UA_IPHONE, preset: { ooo_install_dismissed: "1" } });
  ok(!vis(w2, "install-card"), "已关闭过的设备：再次打开不再显示");
  const wp = bootParent({ ua: UA_IPHONE });
  ok(vis(wp, "install-card") && vis(wp, "install-steps-ios"), "家长端 iOS：引导卡与步骤显示");
  wp.document.getElementById("install-close").click();
  ok(wp.localStorage.getItem("oop_install_dismissed") === "1" && wp.localStorage.getItem("ooo_install_dismissed") === null,
    "家长端关闭记忆用独立前缀 oop_，不污染学生端");
  const wp2 = bootParent({ ua: UA_IPHONE, preset: { ooo_install_dismissed: "1" } });
  ok(vis(wp2, "install-card"), "家长端不受学生端关闭标记影响（隔离）");
}

section("F. 双语切换");
{
  const w = bootStudent({ ua: UA_IPHONE });
  const titleZh = w.document.querySelector("#install-card .install-title").textContent;
  ok(titleZh === "把专属APP放到手机桌面", "默认中文标题实测：" + titleZh);
  w.document.getElementById("lang-toggle").click();
  await tick(30);
  const titleEn = w.document.querySelector("#install-card .install-title").textContent;
  const stepEn = w.document.querySelector("#install-steps-ios li span, #install-steps-ios li").textContent;
  ok(titleEn === "Put your app on the home screen", "切 EN 后标题变英文实测：" + titleEn);
  ok(/Share button/.test(w.document.getElementById("install-steps-ios").textContent), "切 EN 后 iOS 步骤变英文");
  ok(stepEn.length > 0, "步骤文案非空");
  const wp = bootParent({ ua: UA_IPHONE });
  wp.document.getElementById("lang-toggle").click();
  await tick(30);
  ok(wp.document.querySelector("#install-card .install-title").textContent === "Put the parent view on your home screen",
    "家长端切 EN 后标题变英文（家长口径）");
}

console.log("\n==== app-install: " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
