/* Service worker: makes the site installable and usable offline.
 * Network-first for same-origin GET requests, so updates show up immediately;
 * the cached copy is used only when the network fails. Every built file is precached so the app
 * works offline right after install; the list is generated at build time (tests/sw-shell.test.ts). GitHub API calls are not touched. */

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = "watchlist-v22";
// Filled in at build time from the Vite output (tools/sw-shell.ts via vite.config.ts); hashed names change every release.
const SHELL: string[] = ["__SHELL__"];

sw.addEventListener("install", (e: ExtendableEvent) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => sw.skipWaiting()));
});

sw.addEventListener("activate", (e: ExtendableEvent) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener("fetch", (e: FetchEvent) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== sw.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error()))
  );
});
