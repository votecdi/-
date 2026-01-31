const CACHE = "dp-maker-v3";
const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./frame1.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try { await c.addAll(CORE); } catch {}
    // frame2 optional
    try { await c.add("./frame2.png"); } catch {}
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
