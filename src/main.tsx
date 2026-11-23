/* Watchlist: personal film/series tracker.
 * React UI over a framework-agnostic core (domain/, data/, state/), bundled by Vite.
 * Data lives in data/movies.json; edits are committed to the repo
 * through the GitHub Contents API with a user-provided fine-grained token. */

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { addItem } from "./actions.js";
import { REFRESH_AFTER_MS } from "./config.js";
import { asRecord } from "./domain/guards.js";
import { loadAll, markCatalogSave, msSinceLoad, restorePendingSaves, saves } from "./state/saving.js";
import { CHIPS, SORTS, afterRender, getTypes, isListTab, readLocal, render, state, writeLocal } from "./state/store.js";
import { WatchlistTMDB } from "./tmdb.js";
import { App } from "./ui/react/App.js";

function restoreView(): void {
  const view = asRecord(readLocal("watchlist.view")) ?? {};
  state.tab = view.tab === "stats" || isListTab(view.tab) ? view.tab : "list";
  if (state.tab === "list" && (view.statusFilter === "watched" || view.statusFilter === "dropped")) state.tab = view.statusFilter;
  state.statusFilter = CHIPS.find((c) => c.key === view.statusFilter)?.key ?? "all";
  state.typeFilter = typeof view.typeFilter === "string" ? view.typeFilter : "all";
  state.search = typeof view.search === "string" ? view.search : "";
  state.sort = SORTS.find((s) => s.key === view.sort)?.key ?? "added-desc";
  state.finishedSort = SORTS.find((s) => s.key === view.finishedSort)?.key ?? "watched-desc";
}

function initCatalog(): void {
  WatchlistTMDB.init({
    getItems: () => state.data?.items || [], getTypes, canEdit: () => !!state.token && !state.loading && !state.error,
    add: async (title, type, metadata) => {
      const tmdb = metadata?.tmdb;
      if (tmdb && state.data?.items.some((it) => it.tmdb?.id === tmdb.id && it.tmdb?.mediaType === tmdb.mediaType)) {
        throw new Error("Этот тайтл уже есть в списке.");
      }
      if (!addItem(title, type, metadata)) return false;
      markCatalogSave();
      await saves.wait();
      return true;
    }
  });
}

function init(): void {
  const savedScroll = asRecord(readLocal("watchlist.scroll")) ?? {};
  window.addEventListener("beforeunload", (event) => {
    if (!saves.hasUnsaved()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  // Back online: retry failed saves, or reload data shown from the offline cache.
  window.addEventListener("online", () => {
    if (saves.error) saves.retry();
    else if (saves.size === 0 && state.offline) void loadAll();
  });
  // Back in the tab: retry failed saves, or quietly refresh data that went stale while away.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (saves.error) saves.retry();
    else if (!saves.hasUnsaved() && msSinceLoad() >= REFRESH_AFTER_MS) void loadAll({ silent: true });
  });
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => writeLocal("watchlist.scroll", { tab: state.tab, y: window.scrollY }), 200); }, { passive: true });

  // Installable app / offline cache (needs http(s), not file://).
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((e: unknown) => console.warn("service worker registration failed", e));
  }

  restoreView();
  const rootNode = document.getElementById("root");
  if (!rootNode) throw new Error("Missing element: #root");
  // Mount synchronously: tmdb.ts binds to the add form and settings nodes by id.
  flushSync(() => createRoot(rootNode).render(<App />));
  render();
  void loadAll().then(() => {
    restorePendingSaves();
    initCatalog();
    const y = savedScroll.y;
    if (savedScroll.tab === state.tab && typeof y === "number" && Number.isFinite(y)) afterRender(() => window.scrollTo(0, y));
  });
}

document.addEventListener("DOMContentLoaded", init);
