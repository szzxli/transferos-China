/* TransferOS-Global service worker — offline-first precache */
const CACHE = "tog-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./evaluate.html",
  "./cost.html",
  "./plan.html",
  "./track.html",
  "./coach.html",
  "./transfer.html",
  "./guide.html",
  "./whitelist.html",
  "./apply.html",
  "./css/app.css",
  "./js/app.js",
  "./js/chat.js",
  "./data/faq.json",
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
