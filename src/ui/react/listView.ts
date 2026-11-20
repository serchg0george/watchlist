import { PEOPLE } from "../../config.js";
import { avgRating } from "../../domain/items.js";
import type { Item, Status } from "../../domain/types.js";
import { state } from "../../state/store.js";
import type { SortKey } from "../../state/store.js";

export type ListContent =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "items"; items: Item[] };

export interface ListView {
  content: ListContent;
  // Per-status counts for chips and tab badges; null while loading or on error (badges keep their last text).
  counts: Record<string, number> | null;
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

function countByStatus(base: Item[]): Record<string, number> {
  const counts: Record<string, number> = { all: 0, planned: 0, watching: 0, watched: 0, dropped: 0 };
  base.forEach((it) => { counts[it.status] = (counts[it.status] ?? 0) + 1; });
  counts.all = counts.planned ?? 0;
  return counts;
}

export function computeListView(): ListView {
  if (state.loading) return { content: { kind: "loading" }, counts: null };
  if (state.error) return { content: { kind: "error", message: state.error }, counts: null };
  if (!state.data || state.data.items.length === 0) return { content: { kind: "empty" }, counts: countByStatus([]) };
  const q = state.search.trim().toLowerCase();
  // Base list respects type + search filters (not the status filter).
  const base = state.data.items.filter((it) => {
    if (state.typeFilter !== "all" && it.type !== state.typeFilter) return false;
    if (q && !(it.title.toLowerCase().includes(q) || String(it.tmdb?.originalTitle || "").toLowerCase().includes(q) || it.note.toLowerCase().includes(q) || PEOPLE.some((p) => it.comments[p].toLowerCase().includes(q)) || it.replies.some((r) => r.text.toLowerCase().includes(q)))) return false;
    return true;
  });
  const status: Status = state.tab === "watched" || state.tab === "dropped" ? state.tab : state.statusFilter === "watching" ? "watching" : "planned";
  return { content: { kind: "items", items: sortItems(base, state.sort).filter((it) => it.status === status) }, counts: countByStatus(base) };
}
