import type { CategoryType, Person, ReactionKindInfo, Status } from "./domain/types.js";

// ===== Constants =====

export const REPO = "serchg0george/watchlist";
export const FILE_PATH = "data/movies.json";
export const API_CONTENTS_URL = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
export const LS_TOKEN = "watchlist.token";
export const LS_LOGIN = "watchlist.login";
export const LS_PERSON = "watchlist.person";
export const LS_DATA_CACHE = "watchlist.dataCache";

export const PEOPLE: readonly Person[] = ["S", "L"];
export const REACTION_KINDS: readonly ReactionKindInfo[] = [
  { key: "like", emoji: "👍", label: "Нравится" },
  { key: "fire", emoji: "🔥", label: "Огонь" },
  { key: "heart", emoji: "❤️", label: "Люблю" },
  { key: "grin", emoji: "😁", label: "Улыбаюсь" },
  { key: "eyes", emoji: "👀", label: "Интересно" },
  { key: "laugh", emoji: "🤣", label: "Очень смешно" },
  { key: "sad", emoji: "😢", label: "Грустно" },
  { key: "dislike", emoji: "👎", label: "Не нравится" }
];
// Exactly two editors: the repo owner is S, the collaborator (any other login with write access) is L.
export const OWNER_LOGIN = "serchg0george";
export const UNDO_MS = 5000;

export function personFor(login: string): Person | "" {
  if (!login) return "";
  return login.toLowerCase() === OWNER_LOGIN ? "S" : "L";
}
export const DEFAULT_TYPES: CategoryType[] = [
  { key: "movie", label: "Фильм", color: "#e05638" },
  { key: "series", label: "Сериал", color: "#2563eb" },
  { key: "anime", label: "Аниме", color: "#7c3aed" },
  { key: "show", label: "Шоу", color: "#059669" }
];

export const PALETTE_PRESETS = [
  "#e05638", "#ea580c", "#d97706", "#ca8a04",
  "#65a30d", "#16a34a", "#059669", "#0d9488",
  "#0891b2", "#0284c7", "#2563eb", "#4f46e5",
  "#7c3aed", "#9333ea", "#c026d3", "#db2777",
  "#e11d48", "#475569"
];

export const STATUSES: readonly Status[] = ["planned", "watching", "watched", "dropped"];
export const STATUS_LABELS: Record<Status, string> = { planned: "Хочу посмотреть", watching: "Смотрим", watched: "Просмотрено", dropped: "Брошено" };
