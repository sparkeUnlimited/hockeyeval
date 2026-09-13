// Network-first service worker: keeps the app shell available when rink Wi-Fi drops.
// Only same-origin GET requests are cached. The API (different origin) is never cached.
const CACHE = "tryout-shell-v1";
const SHELL = ["/", "/index.html", "/evaluate.html", "/admin.html", "/css/app.css", "/js/config.js", "/js/auth.js",
  "/js/api.js", "/js/criteria.js", "/js/evaluate.js", "/js/admin.js", "/vendor/amazon-cognito-identity.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html"))),
  );
});
