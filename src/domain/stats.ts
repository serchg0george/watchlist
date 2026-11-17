import { STATUSES } from "../config.js";
import type { CategoryType, Item, Person, Status } from "./types.js";

export const MONTH_FULL = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export interface StatsMonth { key: string; month: number; year: number; count: number; items: Item[] }
export type RatedItem = Item & { ratings: { S: number; L: number } };
export interface GenreStats {
  label: string;
  count: number;
  people: Record<Person, { count: number; average: number | null }>;
  paired: number;
  agreement: number | null;
}
export interface CategoryStats extends CategoryType { total: number; watched: number }
export interface Stats {
  values: Record<Person, number[]>;
  counts: Record<Person, number[]>;
  averages: Record<Person, number | null>;
  both: RatedItem[];
  groups: Map<string, RatedItem[]>;
  genres: GenreStats[];
  favoriteMonth: { label: string; count: number; items: RatedItem[] };
  close: number;
  exact: number;
  statuses: Record<Status, number>;
  months: StatsMonth[];
  diffs: RatedItem[];
  top: RatedItem[];
  categories: CategoryStats[];
}

export function computeMonths(items: Item[], today = new Date()): StatsMonth[] {
  const months = Array.from({ length: 12 }, (_, i): StatsMonth => {
    const date = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
    return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, month: date.getMonth(), year: date.getFullYear(), count: 0, items: [] };
  });
  items.forEach((item) => {
    if (item.status !== "watched" || !item.watchedAt) return;
    const watchedMonth = item.watchedAt.slice(0, 7);
    const month = months.find((m) => m.key === watchedMonth);
    if (month) { month.count++; month.items.push(item); }
  });
  return months;
}

export function computeStats(items: Item[], types: CategoryType[], today = new Date()): Stats {
  const valid = (r: unknown): r is number => typeof r === "number" && Number.isInteger(r) && r >= 1 && r <= 10;
  const isRated = (item: Item): item is RatedItem => valid(item.ratings?.S) && valid(item.ratings?.L);
  const perPerson = <T>(fn: (person: Person) => T): Record<Person, T> => ({ S: fn("S"), L: fn("L") });
  const values = perPerson((person) => items.map((item) => item.ratings?.[person]).filter(valid));
  const counts = perPerson((person) => {
    const histogram: number[] = Array(11).fill(0);
    values[person].forEach((r) => { histogram[r] = (histogram[r] ?? 0) + 1; });
    return histogram;
  });
  const averages = perPerson((person) => values[person].length ? values[person].reduce((sum, r) => sum + r, 0) / values[person].length : null);
  const both = items.filter(isRated);
  const newer = (a: Item, b: Item): number => (b.watchedAt || "").localeCompare(a.watchedAt || "");
  const groups = new Map<string, RatedItem[]>();
  both.forEach((item) => {
    const key = `${item.ratings.S}:${item.ratings.L}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  });
  // Preserve items whose category is no longer in the configured list.
  const categories = types.map((type) => ({ ...type }));
  items.forEach((item) => {
    if (!categories.some((type) => type.key === item.type)) categories.push({ key: item.type, label: item.type || "Без типа", color: "var(--muted)" });
  });
  const watched = items.filter((item) => item.status === "watched");
  const watchedBoth = both.filter((item) => item.status === "watched");
  const genreGroups = new Map<string, { label: string; items: Item[] }>();
  watched.forEach((item) => {
    const seen = new Set<string>();
    for (const raw of Array.isArray(item.genres) ? item.genres : []) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const label = raw.trim(), key = label.toLocaleLowerCase("ru-RU");
      if (seen.has(key)) continue;
      seen.add(key);
      const group = genreGroups.get(key) ?? { label, items: [] };
      group.items.push(item);
      genreGroups.set(key, group);
    }
  });
  const genres = [...genreGroups.values()].map((genre): GenreStats => {
    const paired = genre.items.filter(isRated);
    const people = perPerson((person) => {
      const ratings = genre.items.map((item) => item.ratings?.[person]).filter(valid);
      return { count: ratings.length, average: ratings.length ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null };
    });
    return { label: genre.label, count: genre.items.length, people, paired: paired.length,
      agreement: paired.length ? 100 * (1 - paired.reduce((sum, item) => sum + Math.abs(item.ratings.S - item.ratings.L), 0) / paired.length / 9) : null };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const currentDate = `${currentMonth}-${String(today.getDate()).padStart(2, "0")}`;
  const monthly = watchedBoth.filter((item) => {
    const watchedAt = item.watchedAt || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(watchedAt) || watchedAt.slice(0, 7) !== currentMonth || watchedAt > currentDate) return false;
    const day = Number(watchedAt.slice(8)), maxDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return day >= 1 && day <= maxDay;
  });
  const bestMonthly = Math.max(0, ...monthly.map((item) => item.ratings.S + item.ratings.L));
  return {
    values, counts, averages, both, groups, genres,
    favoriteMonth: { label: `${MONTH_FULL[today.getMonth()]} ${today.getFullYear()}`, count: monthly.length,
      items: monthly.filter((item) => item.ratings.S + item.ratings.L === bestMonthly).sort((a, b) => newer(a, b) || a.title.localeCompare(b.title, "ru")) },
    close: both.filter((item) => Math.abs(item.ratings.S - item.ratings.L) <= 1).length,
    exact: both.filter((item) => item.ratings.S === item.ratings.L).length,
    statuses: { planned: 0, watching: 0, watched: 0, dropped: 0, ...Object.fromEntries(STATUSES.map((status) => [status, items.filter((item) => item.status === status).length])) },
    months: computeMonths(items, today),
    diffs: watchedBoth.filter((item) => item.ratings.S !== item.ratings.L).sort((a, b) => Math.abs(b.ratings.S - b.ratings.L) - Math.abs(a.ratings.S - a.ratings.L) || newer(a, b)).slice(0, 5),
    top: [...both].sort((a, b) => (b.ratings.S + b.ratings.L) - (a.ratings.S + a.ratings.L) || newer(a, b)).slice(0, 10),
    categories: categories.map((type) => ({ ...type, total: items.filter((item) => item.type === type.key).length, watched: items.filter((item) => item.type === type.key && item.status === "watched").length }))
  };
}
