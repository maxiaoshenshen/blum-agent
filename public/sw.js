/// <reference lib="webworker" />

const CACHE_NAME = "blum-agent-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/favicon.svg",
];

// Install: cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first for HTML, cache-first for assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin API requests
  if (event.request.method !== "GET") return;

  // API routes: network only
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // For navigation requests, try network first
      if (event.request.mode === "navigate") {
        try {
          const response = await fetch(event.request);
          if (response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        } catch {
          const cached = await cache.match(event.request);
          return cached || new Response("Offline", { status: 503 });
        }
      }

      // For assets, try cache first
      const cached = await cache.match(event.request);
      if (cached) return cached;

      // Then try network
      try {
        const response = await fetch(event.request);
        if (response.ok && url.pathname.startsWith("/assets/")) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        return cached || new Response("Offline", { status: 503 });
      }
    })()
  );
});
