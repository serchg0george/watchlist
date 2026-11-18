// Offline data cache: pure helpers for the localStorage snapshot written after
// every successful load/save and read back when the network is unavailable.

import { asRecord } from "../domain/guards.js";
import { normalize } from "../domain/normalize.js";
import type { WatchlistData } from "../domain/types.js";

export interface DataCache { data: unknown; branch: string | null; savedAt: string }  // savedAt ISO string

export function makeCache(data: WatchlistData, branch: string | null, now: Date): DataCache {
  return { data, branch, savedAt: now.toISOString() };
}

// Validates the stored shape; returns null for anything that is not a cache entry.
export function parseCache(raw: unknown): DataCache | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  if (typeof rec.savedAt !== "string" || !rec.savedAt) return null;
  if (!(rec.branch === null || typeof rec.branch === "string")) return null;
  if (!asRecord(rec.data)) return null;
  return { data: rec.data, branch: rec.branch, savedAt: rec.savedAt };
}

export type LoadFallback = { kind: "cache"; data: WatchlistData; branch: string | null; savedAt: string } | { kind: "error" };

// A load failed: use the cached copy if it is valid, otherwise surface an error.
export function chooseFallback(raw: unknown): LoadFallback {
  const cache = parseCache(raw);
  if (!cache) return { kind: "error" };
  return { kind: "cache", data: normalize(cache.data), branch: cache.branch, savedAt: cache.savedAt };
}
