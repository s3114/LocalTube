const CACHE_NAME = "localtube-shell-v3";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/app-core.js",
  "/app-feedback.js",
  "/app-home-cards.js",
  "/app-renderers.js",
  "/app-comments.js",
  "/app-home-browser.js",
  "/app-dashboard.js",
  "/app-settings-ui.js",
  "/app-player-ui.js",
  "/app-player-page.js",
  "/app-local-video.js",
  "/app-state.js",
  "/app-actions.js",
  "/app-routing.js",
  "/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) return caches.delete(key);
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/downloads/")) return;
  if (url.pathname === "/events" || url.pathname === "/ping") return;
  if (request.headers.get("range")) return;

  const canCacheResponse = (response) =>
    !!response && response.status === 200 && response.type === "basic";

  const safeCachePut = async (cacheKey, response) => {
    if (!canCacheResponse(response)) return;
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, response.clone());
    } catch (_error) {
      // キャッシュ保存失敗は致命ではないため握りつぶす
    }
  };

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          void safeCachePut("/index.html", response);
          return response;
        })
        .catch(async () => {
          const fallback = await caches.match("/index.html");
          return fallback || new Response("Offline", { status: 503 });
        })
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        void safeCachePut(request, response);
        return response;
      } catch (_error) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response("Offline", { status: 503 });
      }
    })()
  );
});
