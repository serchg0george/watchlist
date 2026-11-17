import { PEOPLE } from "../config.js";
import type { Item } from "./types.js";

export function avgRating(it: Item): number | null {
  const vals = PEOPLE.map((p) => it.ratings[p]).filter((r): r is number => r != null);
  return vals.length ? vals.reduce((s, r) => s + r, 0) / vals.length : null;
}
