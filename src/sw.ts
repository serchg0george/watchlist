/* Service worker: makes the site installable and usable offline.
 * Network-first for same-origin GET requests, so updates show up immediately;
 * the cached copy is used only when the network fails. Every module is precached so the app
 * works offline right after install; tests/sw-shell.test.ts fails if a module is missing here. GitHub API calls are not touched. */

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = "watchlist-v20";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "js/actions.js",
  "js/config.js",
  "js/data/data-cache.js",
  "js/data/encoding.js",
  "js/data/github.js",
  "js/data/repository.js",
  "js/data/save-queue.js",
  "js/domain/dates.js",
  "js/domain/guards.js",
  "js/domain/items.js",
  "js/domain/normalize.js",
  "js/domain/ops.js",
  "js/domain/stats.js",
  "js/domain/text.js",
  "js/domain/types.js",
  "js/domain/validate.js",
  "js/main.js",
  "js/state/saving.js",
  "js/state/store.js",
  "js/tmdb.js",
  "js/ui/dialogs/categories.js",
  "js/ui/dialogs/settings.js",
  "js/ui/dom.js",
  "js/ui/list/bulk-bar.js",
  "js/ui/list/comments.js",
  "js/ui/list/editor.js",
  "js/ui/list/item-row.js",
  "js/ui/list/list.js",
  "js/ui/stats.js",
  "js/ui/toast.js",
  "js/util/id.js",
  "manifest.json",
  "data/movies.json",
  "icons/icon-192.png",
  "icons/tmdb.svg"
];

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
