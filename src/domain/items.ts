import { PEOPLE } from "../config.js";
import { isPerson } from "./guards.js";
import type { Item, Person } from "./types.js";

export function avgRating(it: Item): number | null {
  const vals = PEOPLE.map((p) => it.ratings[p]).filter((r): r is number => r != null);
  return vals.length ? vals.reduce((s, r) => s + r, 0) / vals.length : null;
}

/** Author of a comment (target = person) or reply (target = reply id); null if it no longer exists. */
export function commentAuthor(item: Item, target: string): Person | null {
  if (isPerson(target)) return item.comments[target] ? target : null;
  return item.replies.find((r) => r.id === target)?.by || null;
}
