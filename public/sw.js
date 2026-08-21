/* RugRadar service worker — hand-written, no deps.
   Strategies:
   - /_next/static/* and /icon* : cache-first (immutable build assets)
   - navigations (pages)        : network-first, cache fallback, then
                                  branded offline page
   - /api/*                     : network-only (scans/alerts are live data)
   Bump VERSION to invalidate all caches on next deploy. */

const VERSION = "v1";
const STATIC_CACHE = `rugradar-static-${VERSION}`;
const PAGE_CACHE = `rugradar-pages-${VERSION}`;
const KNOWN_CACHES = [STATIC_CACHE, PAGE_CACHE];

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#05080d">
<title>RugRadar — offline</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #05080d; color: #e4e4e7;
         font-family: ui-sans-serif, system-ui, sans-serif; text-align: center; padding: 1.5rem; }
  h1 { color: #00e5ff; font-size: 1.25rem; margin: 0 0 .5rem; }
  p { color: #a1a1aa; margin: 0; }
</style>
</head>
<body>
<main>
  <h1>RugRadar — you're offline.</h1>
  <p>Scans need a connection. Reconnect and try again.</p>
</main>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll(["/", "/icon.svg"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !KNOWN_CACHES.includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Live data — never cache
  if (url.pathname.startsWith("/api/")) return;

  // Immutable build assets + icons — cache-first
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon")
  ) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // Pages — network-first with cache fallback, then offline page
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const hit = await caches.match(request);
          return (
            hit ||
            new Response(OFFLINE_HTML, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            })
          );
        })
    );
  }
});
