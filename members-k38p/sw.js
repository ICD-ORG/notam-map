/* Service Worker — מפת נוט"מ: עבודה גם ללא רשת */
const CACHE = "notam-v2";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "./manifest.json"])));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // זיהוי בקשת עמוד עמיד יותר: mode "navigate" לא תמיד אמין בספארי, destination "document" נתמך טוב יותר בכל הדפדפנים
  const isDoc = e.request.mode === "navigate" || e.request.destination === "document" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");

  // עמוד ראשי + נתונים: תמיד רשת קודם (הכי טרי), ואם אין קליטה - מהמטמון
  if (url.pathname.endsWith("notam-data.json") || url.pathname.endsWith("pamat-meta.json") || isDoc) {
    e.respondWith(
      fetch(e.request).then(r => {
        const cp = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
        return r;
      }).catch(() => caches.match(e.request).then(r => r || caches.match("./")))
    );
    return;
  }
  // שאר הקבצים: קודם מטמון, השלמה מהרשת
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const cp = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, cp));
      return res;
    }))
  );
});
