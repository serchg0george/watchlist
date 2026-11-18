/* Watchlist: personal film/series tracker.
 * Strict TypeScript compiled by tsc to native ES modules, no libraries.
 * Data lives in data/movies.json; edits are committed to the repo
 * through the GitHub Contents API with a user-provided fine-grained token. */

import { addCategory, addItem, pickRandom } from "./actions.js";
import { PALETTE_PRESETS, REFRESH_AFTER_MS } from "./config.js";
import { asRecord } from "./domain/guards.js";
import { loadAll, markCatalogSave, msSinceLoad, restorePendingSaves, saves } from "./state/saving.js";
import { CHIPS, SORTS, getTypes, isListTab, readLocal, render, selectedIds, setRenderer, state, writeLocal } from "./state/store.js";
import type { SortKey, Tab } from "./state/store.js";
import { WatchlistTMDB } from "./tmdb.js";
import { byId, el } from "./ui/dom.js";
import { openCategories, renderCategoriesDialog, updateTypeSelects } from "./ui/dialogs/categories.js";
import { logout, openSettings, saveToken } from "./ui/dialogs/settings.js";
import { renderBulkBar } from "./ui/list/bulk-bar.js";
import { renderHeader, renderList } from "./ui/list/list.js";
import { renderStats } from "./ui/stats.js";

// ===== Rendering =====

function renderAll(): void {
  renderHeader();
  updateTypeSelects();
  document.querySelectorAll<HTMLElement>(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const isList = isListTab(state.tab);
  // Losing the token or leaving the list ends selection mode.
  if (!state.token || !isList) { state.selecting = false; selectedIds.clear(); }
  byId("list-tab").hidden = !isList;
  byId("stats-tab").hidden = state.tab !== "stats";
  byId("add-form").hidden = !state.token || state.tab !== "list";
  byId("mobile-add-btn").hidden = !state.token || state.tab !== "list";
  byId("chips").hidden = state.tab !== "list";
  byId("random-btn").hidden = state.tab !== "list";
  const selectBtn = byId("select-btn");
  selectBtn.hidden = !state.token || !isList;
  selectBtn.textContent = state.selecting ? "Готово" : "☑ Выбрать";
  document.body.classList.toggle("selecting", state.selecting);
  if (isList) renderList();
  else renderStats();
  renderBulkBar();
}

// The item editor is rebuilt on every render; its values come back from the draft,
// so put focus and caret where they were to keep typing uninterrupted.
function renderPreservingEditorFocus(): void {
  const active = document.activeElement;
  let className: string | null = null;
  let selStart: number | null = null;
  let selEnd: number | null = null;
  if ((active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) && active.closest(".editor")) {
    className = active.classList[0] ?? null;
    const text = active as HTMLInputElement | HTMLTextAreaElement;
    if (typeof text.selectionStart === "number" && typeof text.selectionEnd === "number") {
      selStart = text.selectionStart;
      selEnd = text.selectionEnd;
    }
  }
  renderAll();
  if (!className) return;
  const next = document.querySelector<HTMLElement>(`.editor .${CSS.escape(className)}`);
  if (!next || !next.isConnected) return;
  next.focus({ preventScroll: true });
  if (selStart != null && selEnd != null && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) {
    next.setSelectionRange(selStart, selEnd);
  }
}

// ===== Init =====

function init(): void {
  setRenderer(renderPreservingEditorFocus);
  const savedScroll = asRecord(readLocal("watchlist.scroll")) ?? {};
  const tabScroll: Record<Tab, number> = { list: 0, watched: 0, dropped: 0, stats: 0 };
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
  // Tabs.
  document.querySelectorAll<HTMLElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab !== "stats" && !isListTab(tab)) return;
      tabScroll[state.tab] = window.scrollY;
      state.tab = tab;
      render();
      window.scrollTo(0, tabScroll[state.tab] || 0);
    });
  });

  // Status chips (built once, counts updated on each list render).
  const chipsEl = byId("chips");
  CHIPS.forEach((c) => {
    const chip = el("button", { type: "button", class: "chip", "data-key": c.key }, c.label, el("span", { class: "count" }));
    chip.addEventListener("click", () => { state.statusFilter = c.key; render(); });
    chipsEl.append(chip);
  });

  // Type filter.
  const typeSel = byId<HTMLSelectElement>("type-filter");
  typeSel.addEventListener("change", () => {
    if (typeSel.value === "__manage__") {
      typeSel.value = state.typeFilter;
      openCategories();
      return;
    }
    state.typeFilter = typeSel.value;
    render();
  });

  // Search.
  const searchInput = byId<HTMLInputElement>("search");
  searchInput.addEventListener("input", () => { state.search = searchInput.value; render(); });

  // Sort.
  const sortSel = byId<HTMLSelectElement>("sort");
  const findSort = (value: unknown): SortKey | undefined => SORTS.find((s) => s.key === value)?.key;
  SORTS.forEach((s) => sortSel.append(el("option", { value: s.key, text: s.label })));
  sortSel.addEventListener("change", () => { state.sort = findSort(sortSel.value) ?? state.sort; render(); });

  updateTypeSelects();
  const initCatalog = (): void => WatchlistTMDB.init({
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
  const view = asRecord(readLocal("watchlist.view")) ?? {};
  state.tab = view.tab === "stats" || isListTab(view.tab) ? view.tab : "list";
  if (state.tab === "list" && (view.statusFilter === "watched" || view.statusFilter === "dropped")) state.tab = view.statusFilter;
  state.statusFilter = CHIPS.find((c) => c.key === view.statusFilter)?.key ?? "all";
  state.typeFilter = typeof view.typeFilter === "string" ? view.typeFilter : "all";
  state.search = typeof view.search === "string" ? view.search : "";
  state.sort = findSort(view.sort) ?? "added-desc";
  searchInput.value = state.search;
  sortSel.value = state.sort;
  const clearFilters = el("button", { type: "button", class: "btn", text: "Сбросить фильтры" });
  clearFilters.addEventListener("click", () => { state.statusFilter = "all"; state.typeFilter = "all"; state.search = ""; searchInput.value = ""; render(); });
  document.querySelector(".filters")?.append(clearFilters);
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => writeLocal("watchlist.scroll", { tab: state.tab, y: window.scrollY }), 200); }, { passive: true });

  // Random pick.
  byId("random-btn").addEventListener("click", pickRandom);

  // Selection mode with bulk actions.
  byId("select-btn").addEventListener("click", () => {
    state.selecting = !state.selecting;
    if (!state.selecting) selectedIds.clear();
    render();
  });

  // Installable app / offline cache (needs http(s), not file://).
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((e: unknown) => console.warn("service worker registration failed", e));
  }

  // Settings dialog.
  byId("settings-btn").addEventListener("click", openSettings);
  byId("save-token-btn").addEventListener("click", () => { void saveToken(); });
  byId("logout-btn").addEventListener("click", logout);
  const dlg = byId<HTMLDialogElement>("settings-dialog");
  byId("cancel-settings-btn").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  // Categories dialog.
  byId("categories-btn").addEventListener("click", openCategories);
  byId("open-categories-from-settings").addEventListener("click", () => {
    dlg.close();
    openCategories();
  });
  const catDlg = byId<HTMLDialogElement>("categories-dialog");
  byId("close-categories-btn").addEventListener("click", () => catDlg.close());
  catDlg.addEventListener("click", (e) => { if (e.target === catDlg) catDlg.close(); });

  const addCategoryForm = byId<HTMLFormElement>("add-category-form");
  const newCategoryInput = byId<HTMLInputElement>("new-category-input");
  const newCategoryColor = document.getElementById("new-category-color") as HTMLInputElement | null;
  addCategoryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = newCategoryInput.value.trim();
    if (!val) return;
    const color = newCategoryColor ? newCategoryColor.value : null;
    addCategory(val, color);
    renderCategoriesDialog();
    newCategoryInput.value = "";
    if (newCategoryColor) {
      newCategoryColor.value = PALETTE_PRESETS[getTypes().length % PALETTE_PRESETS.length] ?? newCategoryColor.value;
    }
  });

  render();
  void loadAll().then(() => {
    restorePendingSaves();
    initCatalog();
    const y = savedScroll.y;
    if (savedScroll.tab === state.tab && typeof y === "number" && Number.isFinite(y)) window.scrollTo(0, y);
  });
}

document.addEventListener("DOMContentLoaded", init);
