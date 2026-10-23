/* TransferOS-China service worker — offline-first precache */
const CACHE = "tog-v46";
const ASSETS = [
  "./",
  "./index.html",
  "./transfer.html",
  "./assess.html",
  "./planning.html",
  "./css/app.css",
  "./js/app.js",
  "./js/chat.js",
  "./data/faq.json",
  "./data/faq-en.json",
  "./data/faq-tw.json",
  "./data/i18n/en.js",
  "./data/i18n/zh-TW.js",
  "./js/i18n.js",
  "./manifest.json",
  "./data/deanza-uc_berkeley-p1.json",
  "./data/deanza-uc_berkeley-p2.json",
  "./data/deanza-uc_berkeley-p3.json",
  "./data/deanza-uc_berkeley-p4.json",
  "./data/deanza-uc_davis-p1.json",
  "./data/deanza-uc_davis-p2.json",
  "./data/deanza-uc_irvine-p1.json",
  "./data/deanza-uc_san_diego-p1.json",
  "./data/deanza-uc_san_diego-p2.json",
  "./data/deanza-uc_santa_cruz-p1.json",
  "./data/deanza-uc_santa_cruz-p2.json",
  "./data/deanza-ucla-p1.json",
  "./data/foothill-uc_berkeley-p1.json",
  "./data/foothill-uc_berkeley-p2.json",
  "./data/foothill-uc_davis-p1.json",
  "./data/foothill-uc_irvine-p1.json",
  "./data/foothill-uc_san_diego-p1.json",
  "./data/foothill-uc_san_diego-p2.json",
  "./data/foothill-uc_santa_cruz-p1.json",
  "./data/foothill-ucla-p1.json",
  "./data/index.json"
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // v45：一对一专属客户端（/one-on-one-app/）是独立产品、自管更新节奏，主站 SW
  // 不拦截、不缓存其任何资源——cache-first 运行时缓存会把旧版 app.js 长期喂给
  // 已安装用户（v14.1 个性化 manifest 真机复测仍落门页的嫌疑之一）。版本号 bump
  // 同时触发 activate 清掉旧缓存（含此前运行时缓存的一对一资源）。
  const reqUrl = new URL(e.request.url);
  if (reqUrl.origin === self.location.origin && reqUrl.pathname.startsWith("/one-on-one-app/")) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res && res.ok && new URL(e.request.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
