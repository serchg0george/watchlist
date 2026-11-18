import { PEOPLE } from "../../config.js";
import { avgRating } from "../../domain/items.js";
import type { Item, Status } from "../../domain/types.js";
import { state, visibleIds } from "../../state/store.js";
import type { SortKey } from "../../state/store.js";
import { byId, el } from "../dom.js";
import { buildItemRow } from "./item-row.js";

export function renderHeader(): void {
  const line = byId("auth-status");
  line.textContent = state.token && state.login
    ? `Редактирует: ${state.login}${state.person ? ` (${state.person})` : ""}`
    : "Только просмотр";
  // Muted mark while the list is shown from the offline cache.
  const badge = byId("offline-badge");
  if (state.offline && state.offlineSince) {
    const date = new Date(state.offlineSince).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    badge.textContent = `Офлайн · данные от ${date}`;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function sortItems(items: Item[], key: SortKey): Item[] {
  const arr = items.slice();
  switch (key) {
    case "watched-desc":
      arr.sort((a, b) => (b.watchedAt || "").localeCompare(a.watchedAt || "") || b.addedAt.localeCompare(a.addedAt));
      break;
    case "rating-desc":
      arr.sort((a, b) => (avgRating(b) ?? -1) - (avgRating(a) ?? -1) || a.title.localeCompare(b.title, "ru"));
      break;
    case "title-asc":
      arr.sort((a, b) => a.title.localeCompare(b.title, "ru"));
      break;
    case "added-desc":
    default:
      // Stable sort: same-day items keep file order (new items are prepended).
      arr.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  return arr;
}

function updateChips(base: Item[]): void {
  const counts: Record<string, number> = { all: 0, planned: 0, watching: 0, watched: 0, dropped: 0 };
  base.forEach((it) => { counts[it.status] = (counts[it.status] ?? 0) + 1; });
  counts.all = counts.planned ?? 0;
  document.querySelectorAll<HTMLElement>("#chips .chip").forEach((chip) => {
    const key = chip.dataset.key ?? "";
    const count = chip.querySelector(".count");
    if (count) count.textContent = String(counts[key]);
    chip.classList.toggle("active", state.statusFilter === key);
  });
  document.querySelectorAll<HTMLElement>(".tab-btn .count").forEach((span) => {
    const key = span.parentElement?.dataset.tab ?? "";
    if (key in counts) span.textContent = String(counts[key]);
  });
}

function buildSection(items: Item[]): HTMLElement {
  const list = el("div", { class: "item-list" });
  if (items.length === 0) list.append(el("div", { class: "state-msg", text: "Ничего не найдено" }));
  else items.forEach((it) => list.append(buildItemRow(it)));
  return list;
}

export function renderList(): void {
  const box = byId("items");
  box.textContent = "";
  visibleIds.length = 0;

  if (state.loading) { box.append(el("div", { class: "state-msg", text: "Загрузка…" })); return; }
  if (state.error) { box.append(el("div", { class: "state-msg error", text: state.error })); return; }
  if (!state.data || state.data.items.length === 0) {
    box.append(el("div", { class: "state-msg", text: "Список пуст" }));
    updateChips([]);
    return;
  }

  const q = state.search.trim().toLowerCase();
  // Base list respects type + search filters (not the status filter).
  const base = state.data.items.filter((it) => {
    if (state.typeFilter !== "all" && it.type !== state.typeFilter) return false;
    if (q && !(it.title.toLowerCase().includes(q) || String(it.tmdb?.originalTitle || "").toLowerCase().includes(q) || it.note.toLowerCase().includes(q) || PEOPLE.some((p) => it.comments[p].toLowerCase().includes(q)) || it.replies.some((r) => r.text.toLowerCase().includes(q)))) return false;
    return true;
  });

  updateChips(base);
  const sorted = sortItems(base, state.sort);

  const status: Status = state.tab === "watched" || state.tab === "dropped" ? state.tab : state.statusFilter === "watching" ? "watching" : "planned";
  const shown = sorted.filter((it) => it.status === status);
  for (const it of shown) visibleIds.push(it.id);
  box.append(buildSection(shown));
}
