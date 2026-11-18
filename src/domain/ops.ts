/* Data operations as plain, serializable values.
 * An Op carries every id, date and value it needs, so applying it is deterministic:
 * the same Op is applied to local data for the optimistic UI, then replayed on the freshest
 * server copy on each save attempt (and later sent as-is to a backend).
 * applyOp must therefore look items up by id and tolerate targets that are already gone. */

import { DEFAULT_TYPES, REACTION_KINDS } from "../config.js";
import { isPerson } from "./guards.js";
import { commentAuthor } from "./items.js";
import { normalizeGenres } from "./normalize.js";
import type { CategoryType, Item, Person, ReactionKind, Reply, Status, WatchlistData } from "./types.js";

export type DateField = "watchedAt" | "droppedAt";

export interface ItemFields {
  title: string;
  type: string;
  status: Status;
  note: string;
  genres: string[];
}

export type Op =
  | { kind: "addItem"; item: Item }
  | { kind: "restoreItem"; item: Item; index: number }
  | { kind: "markWatched"; itemId: string; date: string }
  | { kind: "unmarkWatched"; itemId: string }
  | { kind: "rate"; itemId: string; person: Person; rating: number | null }
  | { kind: "setComment"; itemId: string; person: Person; text: string }
  | { kind: "addReply"; itemId: string; reply: Reply }
  | { kind: "editReply"; itemId: string; replyId: string; by: Person; text: string; editedAt: string }
  | { kind: "deleteReply"; itemId: string; replyId: string; by: Person }
  | { kind: "react"; itemId: string; target: string; by: Person; reaction: ReactionKind; add: boolean }
  | { kind: "editItem"; itemId: string; fields: ItemFields; date: { field: DateField; value: string } | null }
  | { kind: "setStatus"; itemId: string; status: Status; date: string | null }
  | { kind: "batch"; ops: Exclude<Op, { kind: "batch" }>[] }
  | { kind: "deleteItem"; itemId: string }
  | { kind: "addCategory"; category: CategoryType }
  | { kind: "setCategoryColor"; key: string; color: string }
  | { kind: "renameCategory"; key: string; label: string }
  | { kind: "deleteCategory"; key: string };

export type OpKind = Op["kind"];

function assertNever(value: never): never {
  throw new Error(`Unhandled op: ${JSON.stringify(value)}`);
}

// Ops are applied to several data copies; never share nested objects between them.
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findItem(data: WatchlistData, id: string): Item | undefined {
  return data.items.find((it) => it.id === id);
}

function ensureTypes(data: WatchlistData): CategoryType[] {
  if (!Array.isArray(data.types)) data.types = DEFAULT_TYPES.map((t) => ({ ...t }));
  return data.types;
}

/** Applies op to data in place. `login` is recorded as updatedBy on touched items. */
export function applyOp(data: WatchlistData, op: Op, login: string): void {
  switch (op.kind) {
    case "addItem": {
      const { item } = op;
      if (data.items.some((e) => e.id === item.id || (item.tmdb && e.tmdb?.id === item.tmdb.id && e.tmdb?.mediaType === item.tmdb.mediaType))) return;
      data.items.unshift(copy(item));
      return;
    }
    case "restoreItem": {
      const restored = copy(op.item);
      const i = data.items.findIndex((x) => x.id === restored.id);
      if (i >= 0) data.items[i] = restored;
      else data.items.splice(Math.min(Math.max(op.index, 0), data.items.length), 0, restored);
      return;
    }
    case "markWatched": {
      const it = findItem(data, op.itemId);
      if (!it) return;
      it.status = "watched";
      it.watchedAt = op.date;
      it.updatedBy = login;
      return;
    }
    case "unmarkWatched": {
      const it = findItem(data, op.itemId);
      if (!it) return;
      it.status = "planned";
      it.watchedAt = null;
      it.droppedAt = null;
      it.updatedBy = login;
      return;
    }
    case "rate": {
      const it = findItem(data, op.itemId);
      if (!it) return;
      it.ratings[op.person] = op.rating;
      it.updatedBy = login;
      return;
    }
    case "setComment": {
      const it = findItem(data, op.itemId);
      if (!it) return;
      it.comments[op.person] = op.text;
      if (!op.text) delete it.reactions[op.person];
      it.updatedBy = login;
      return;
    }
    case "addReply": {
      const it = findItem(data, op.itemId);
      if (!it || !commentAuthor(it, op.reply.to) || it.replies.some((r) => r.id === op.reply.id)) return;
      it.replies.push(copy(op.reply));
      it.updatedBy = login;
      return;
    }
    case "editReply": {
      const it = findItem(data, op.itemId);
      const r = it?.replies.find((x) => x.id === op.replyId);
      if (!it || !r || r.by !== op.by) return;
      r.text = op.text;
      r.editedAt = op.editedAt;
      it.updatedBy = login;
      return;
    }
    case "deleteReply": {
      const it = findItem(data, op.itemId);
      const r = it?.replies.find((x) => x.id === op.replyId);
      if (!it || !r || r.by !== op.by) return;
      // Re-parent answers to the deleted reply so the thread stays connected.
      for (const child of it.replies) {
        if (child.to === op.replyId) child.to = r.to;
      }
      it.replies = it.replies.filter((x) => x.id !== op.replyId);
      delete it.reactions[op.replyId];
      it.updatedBy = login;
      return;
    }
    case "react": {
      const it = findItem(data, op.itemId);
      if (!it) return;
      const author = commentAuthor(it, op.target);
      if (!author || author === op.by) return;
      const map = { ...it.reactions[op.target] };
      const given = new Set<ReactionKind>(map[op.by]);
      if (op.add) given.add(op.reaction);
      else given.delete(op.reaction);
      const kinds = REACTION_KINDS.map((r) => r.key).filter((k) => given.has(k));
      if (kinds.length) map[op.by] = kinds;
      else delete map[op.by];
      if (Object.keys(map).length) it.reactions = { ...it.reactions, [op.target]: map };
      else delete it.reactions[op.target];
      it.updatedBy = login;
      return;
    }
    case "editItem": {
      const it = findItem(data, op.itemId);
      if (!it) return;
      it.title = op.fields.title;
      it.type = op.fields.type;
      it.status = op.fields.status;
      it.note = op.fields.note;
      it.genres = normalizeGenres(op.fields.genres);
      if (op.date) it[op.date.field] = op.date.value;
      it.updatedBy = login;
      return;
    }
    case "setStatus": {
      const it = findItem(data, op.itemId);
      if (!it) return;
      it.status = op.status;
      switch (op.status) {
        case "watched":
          if (op.date != null) it.watchedAt = op.date;
          break;
        case "dropped":
          if (op.date != null) it.droppedAt = op.date;
          break;
        case "planned":
          // Same as unmarkWatched: back to the list, no dates.
          it.watchedAt = null;
          it.droppedAt = null;
          break;
        case "watching":
          // Dates are left unchanged.
          break;
      }
      it.updatedBy = login;
      return;
    }
    case "batch":
      for (const inner of op.ops) applyOp(data, inner, login);
      return;
    case "deleteItem":
      data.items = data.items.filter((it) => it.id !== op.itemId);
      return;
    case "addCategory": {
      // Idempotent: a persisted queue may replay an op the server already committed.
      const types = ensureTypes(data);
      if (!types.some((t) => t.key === op.category.key)) types.push({ ...op.category });
      return;
    }
    case "setCategoryColor": {
      const t = ensureTypes(data).find((x) => x.key === op.key);
      if (t) t.color = op.color;
      return;
    }
    case "renameCategory": {
      const t = ensureTypes(data).find((x) => x.key === op.key);
      if (t) t.label = op.label;
      return;
    }
    case "deleteCategory":
      data.types = ensureTypes(data).filter((x) => x.key !== op.key);
      return;
    default:
      assertNever(op);
  }
}

/** Commit message for op. Call with the data as it was before op is applied. */
export function describeOp(op: Op, data: WatchlistData): string {
  const title = (id: string): string => findItem(data, id)?.title ?? "";
  const target = (t: string): string => (isPerson(t) ? `${t} comment` : "reply");
  const category = (key: string): string => data.types.find((t) => t.key === key)?.label ?? key;
  switch (op.kind) {
    case "addItem": return `Add "${op.item.title}"`;
    case "restoreItem": return `Undo change of "${op.item.title}"`;
    case "markWatched": return `Mark "${title(op.itemId)}" watched`;
    case "unmarkWatched": return `Edit "${title(op.itemId)}"`;
    case "rate": return op.rating == null
      ? `Clear ${op.person} rating of "${title(op.itemId)}"`
      : `Rate "${title(op.itemId)}" ${op.person} ${op.rating}/10`;
    case "setComment": return op.text
      ? `Comment "${title(op.itemId)}" as ${op.person}`
      : `Clear ${op.person} comment of "${title(op.itemId)}"`;
    case "addReply": return `Reply to ${target(op.reply.to)} on "${title(op.itemId)}" as ${op.reply.by}`;
    case "editReply": return `Edit reply on "${title(op.itemId)}"`;
    case "deleteReply": return `Delete reply on "${title(op.itemId)}"`;
    case "react": return op.add
      ? `Add ${op.reaction} reaction to ${target(op.target)} on "${title(op.itemId)}" as ${op.by}`
      : `Remove ${op.reaction} reaction from ${target(op.target)} on "${title(op.itemId)}" as ${op.by}`;
    case "editItem": return `Edit "${op.fields.title}"`;
    case "setStatus": return `Set "${title(op.itemId)}" status to ${op.status}`;
    case "batch": {
      const kinds = new Set(op.ops.map((o) => o.kind));
      return kinds.size === 1 ? `Bulk ${op.ops[0]?.kind} of ${op.ops.length} items` : `Bulk: ${op.ops.length} changes`;
    }
    case "deleteItem": return `Delete "${title(op.itemId)}"`;
    case "addCategory": return `Add category "${op.category.label}"`;
    case "setCategoryColor": return `Change color for category "${category(op.key)}"`;
    case "renameCategory": return `Rename category to "${op.label}"`;
    case "deleteCategory": return `Delete category "${category(op.key)}"`;
    default: return assertNever(op);
  }
}

const OP_KINDS: readonly OpKind[] = [
  "addItem", "restoreItem", "markWatched", "unmarkWatched", "rate", "setComment", "addReply", "editReply",
  "deleteReply", "react", "editItem", "setStatus", "batch", "deleteItem", "addCategory", "setCategoryColor", "renameCategory", "deleteCategory"
];

/** Shallow shape check for ops restored from storage; anything unknown is dropped. */
export function isOp(value: unknown): value is Op {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  if (!OP_KINDS.includes(rec.kind as OpKind)) return false;
  // A batch must hold a flat list of valid ops (no nested batches).
  if (rec.kind === "batch") {
    if (!Array.isArray(rec.ops)) return false;
    for (const inner of rec.ops) {
      if (!isOp(inner) || (inner as { kind?: unknown }).kind === "batch") return false;
    }
  }
  return true;
}
