import { DEFAULT_TYPES, LS_LOGIN, LS_TOKEN, personFor } from "../config.js";
import type { CategoryType, Person, WatchlistData } from "../domain/types.js";

// ===== Constants =====


export const isListTab = (value: unknown): value is ListTab => LIST_TABS.includes(value as ListTab);

export function getTypes(): CategoryType[] {
  if (state.data && Array.isArray(state.data.types) && state.data.types.length > 0) {
    return state.data.types;
  }
  return DEFAULT_TYPES;
}

export function getTypeLabel(key: string): string {
  const t = getTypes().find((item) => item.key === key);
  return t ? t.label : key;
}

export function getTypeColor(key: string): string {
  const t = getTypes().find((item) => item.key === key);
  return t && t.color ? t.color : "#5b6b53";
}

type ChipKey = "all" | "watching";
type ListTab = "list" | "watched" | "dropped";
export type Tab = ListTab | "stats";
export type SortKey = "added-desc" | "watched-desc" | "rating-desc" | "title-asc";

export const CHIPS: readonly { key: ChipKey; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "watching", label: "Смотрим" }
];
// Tabs that show the item list; "list" is filtered by CHIPS, the others by their own status.
const LIST_TABS: readonly ListTab[] = ["list", "watched", "dropped"];

export const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: "added-desc", label: "Недавно добавленные" },
  { key: "watched-desc", label: "Недавно просмотренные" },
  { key: "rating-desc", label: "По оценке" },
  { key: "title-asc", label: "По названию" }
];

// ===== State =====

interface ReplyDraft { itemId: string; to: string }

interface AppState {
  token: string;
  login: string;
  person: Person | "";
  data: WatchlistData | null;
  dataBranch: string | null;
  loading: boolean;
  error: string | null;
  tab: Tab;
  statusFilter: ChipKey;
  typeFilter: string;
  search: string;
  sort: SortKey;
  editingId: string | null;
  commentingId: string | null;
  replyDraft: ReplyDraft | null;
  editingReplyId: string | null;
  highlightId: string | null;
}

export const state: AppState = {
  token: localStorage.getItem(LS_TOKEN) || "",
  login: localStorage.getItem(LS_LOGIN) || "",
  person: personFor(localStorage.getItem(LS_LOGIN) || ""),
  data: null,
  dataBranch: null,
  loading: true,
  error: null,
  tab: "list",
  statusFilter: "all",
  typeFilter: "all",
  search: "",
  sort: "added-desc",
  editingId: null,
  commentingId: null,
  replyDraft: null,
  editingReplyId: null,
  highlightId: null
};

// Per-card user choices: comments shown/hidden (overrides the status default) and expanded overviews.
export const openComments = new Map<string, boolean>();
export const expandedOverviews = new Set<string>();

export function readLocal(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? null; } catch { return null; }
}

export function writeLocal(key: string, value: unknown): void {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep in-memory drafts when storage is unavailable. */ }
}

function persistView(): void {
  if (state.loading) return;
  writeLocal("watchlist.view", { tab: state.tab, statusFilter: state.statusFilter, typeFilter: state.typeFilter, search: state.search, sort: state.sort });
}

let renderer: () => void = () => {};
/** main.ts registers the real renderer; every module calls render() from here. */
export function setRenderer(fn: () => void): void { renderer = fn; }
export function render(): void { persistView(); renderer(); }
