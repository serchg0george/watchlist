import { DEFAULT_TYPES, PALETTE_PRESETS, REACTION_KINDS } from "../config.js";
import { todayStr } from "./dates.js";
import { asRecord, isPerson, isRating, isStatus } from "./guards.js";
import type { CategoryType, Comments, Item, Person, Ratings, ReactionKind, Reactions, Reply, WatchlistData } from "./types.js";

export function validRating(r: unknown): number | null {
  return isRating(r) ? r : null;
}

export function normalizeRatings(it: Record<string, unknown>): Ratings {
  const src = asRecord(it.ratings) ?? { S: it.rating };
  return { S: validRating(src.S), L: validRating(src.L) };
}

export function normalizeComments(it: Record<string, unknown>): Comments {
  const src = asRecord(it.comments) ?? {};
  return { S: String(src.S ?? ""), L: String(src.L ?? "") };
}

export function normalizeReplies(it: Record<string, unknown>): Reply[] {
  if (!Array.isArray(it.replies)) return [];
  return it.replies.flatMap((raw: unknown): Reply[] => {
    const r = asRecord(raw);
    if (!r || typeof r.id !== "string" || !isPerson(r.by) ||
      typeof r.text !== "string" || !r.text.trim() ||
      typeof r.to !== "string" || typeof r.at !== "string") return [];
    const reply: Reply = { ...r, id: r.id, by: r.by, to: r.to, at: r.at, text: r.text.trim() };
    if (typeof r.editedAt === "string") reply.editedAt = r.editedAt;
    else delete reply.editedAt;
    return [reply];
  });
}

export function normalizeReactions(it: Record<string, unknown>): Reactions {
  const reactions = asRecord(it.reactions);
  if (!reactions) return {};
  return Object.fromEntries(Object.entries(reactions).flatMap(([target, raw]) => {
    const map = asRecord(raw);
    if (!map) return [];
    const entries = Object.entries(map).flatMap(([person, value]): [Person, ReactionKind[]][] => {
      if (!isPerson(person)) return [];
      // Legacy format stored a single kind string per person.
      const given: unknown[] = Array.isArray(value) ? value : [value];
      const kinds = REACTION_KINDS.map((r) => r.key).filter((k) => given.includes(k));
      return kinds.length ? [[person, kinds]] : [];
    });
    return entries.length ? [[target, Object.fromEntries(entries)]] : [];
  }));
}
export function normalizeTypes(rawTypes: unknown): CategoryType[] {
  if (Array.isArray(rawTypes) && rawTypes.length > 0) {
    const seen = new Set<string>();
    const result: CategoryType[] = [];
    for (let i = 0; i < rawTypes.length; i++) {
      const t = asRecord(rawTypes[i]);
      if (!t) continue;
      const key = String(t.key ?? "").trim();
      const label = String(t.label ?? key).trim();
      if (!key || !label || seen.has(key)) continue;
      seen.add(key);
      const color = typeof t.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(t.color.trim())
        ? t.color.trim()
        : PALETTE_PRESETS[i % PALETTE_PRESETS.length] ?? "#5b6b53";
      result.push({ key, label, color });
    }
    if (result.length > 0) return result;
  }
  return DEFAULT_TYPES.map((t) => ({ ...t }));
}

export function normalizeGenres(value: unknown): string[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).filter((genre): genre is string => {
    if (typeof genre !== "string" || !genre.trim()) return false;
    const key = genre.trim().toLocaleLowerCase("ru-RU");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((genre) => genre.trim());
}

export function normalize(raw: unknown): WatchlistData {
  const data = asRecord(raw) ?? {};
  const types = normalizeTypes(data.types);
  const fallbackKey = types[0]?.key || "movie";
  const rawItems: unknown[] = Array.isArray(data.items) ? data.items : [];
  // Spread first: fields added by newer app versions (e.g. replies, reactions) must survive a save from this version.
  const items = rawItems.map((raw0): Item => {
    const it = asRecord(raw0) ?? {};
    return {
      ...it,
      id: String(it.id ?? ""),
      title: String(it.title ?? ""),
      type: typeof it.type === "string" && it.type.trim() ? it.type.trim() : fallbackKey,
      status: isStatus(it.status) ? it.status : "planned",
      ratings: normalizeRatings(it),
      comments: normalizeComments(it),
      replies: normalizeReplies(it),
      reactions: normalizeReactions(it),
      genres: normalizeGenres(it.genres),
      note: String(it.note ?? ""),
      addedAt: typeof it.addedAt === "string" && it.addedAt ? it.addedAt : todayStr(),
      watchedAt: typeof it.watchedAt === "string" && it.watchedAt ? it.watchedAt : null,
      droppedAt: typeof it.droppedAt === "string" && it.droppedAt ? it.droppedAt : null,
      updatedBy: String(it.updatedBy ?? "")
    };
  });
  return Object.assign(data, { version: Number.isInteger(data.version) ? Number(data.version) : 1, types, items });
}
