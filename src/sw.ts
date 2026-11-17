/* Service worker: makes the site installable and usable offline.
 * Network-first for same-origin GET requests, so updates show up immediately;
 * the cached copy is used only when the network fails. GitHub API calls are not touched. */

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = "watchlist-v11";
const SHELL = ["./", "index.html", "style.css", "tmdb.js", "app.js", "manifest.json", "data/movies.json", "icons/icon-192.png", "icons/tmdb.svg"];

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
