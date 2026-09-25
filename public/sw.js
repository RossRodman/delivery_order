// Hand-written service worker (plan.md §8.1). Runtime caching only: no install-time precache,
// no HTML parsing. Registered only after the app confirms the user is signed in (see
// src/app/sw-register.tsx), so this SW never observes the unauthenticated /login shell as the
// cached copy of an offline-capable page.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL_CACHE = `shell-${VERSION}`;
const STATIC_CACHE = `static-${VERSION}`;

// Pages that must keep working offline once visited online at least once in this build.
const OFFLINE_CAPABLE_PATHS = new Set(["/order", "/orders", "/login"]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    /\.(?:png|jpg|jpeg|svg|ico|webp|woff2?|ttf)$/.test(url.pathname)
  );
}

async function networkFirstShell(request, pathname) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeout);
    if (response && response.ok && !response.redirected && response.type === "basic") {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(pathname, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(pathname, { ignoreSearch: true });
    if (cached) return cached;
    const fallback = await cache.match("/orders");
    if (fallback) return fallback;
    return new Response("<!doctype html><title>Offline</title><p>You're offline.</p>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never intercept the API: offline data comes from IndexedDB, never a stale cached JSON body.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    if (OFFLINE_CAPABLE_PATHS.has(url.pathname)) {
      event.respondWith(networkFirstShell(request, url.pathname));
    }
    return; // other navigations: network only (default behaviour)
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstStatic(request));
  }
});
