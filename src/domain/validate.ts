import { REACTION_KINDS, STATUSES } from "../config.js";
import { asRecord, isPerson, isRating, isReactionKind, isStatus } from "./guards.js";
import { normalize } from "./normalize.js";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_FIELDS = ["addedAt", "watchedAt", "droppedAt"] as const;

function isDate(value: unknown): boolean {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return date.getUTCFullYear() === y && date.getUTCMonth() === (m ?? 1) - 1 && date.getUTCDate() === d;
}

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

const jsonClone = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

/** Checks a parsed data/movies.json. Errors must block a deploy; warnings can occur legitimately. */
export function validateData(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = asRecord(raw);
  if (!root) {
    errors.push("Top level is not an object.");
    return { errors, warnings };
  }
  if (!Array.isArray(root.items)) {
    errors.push("`items` is not an array.");
    return { errors, warnings };
  }
  const rawItems: unknown[] = root.items;

  // Normalization is applied to copies: normalize() mutates the top-level object it is given.
  const once = normalize(jsonClone(raw));
  const onceJson = JSON.stringify(once);
  const twiceJson = JSON.stringify(normalize(JSON.parse(onceJson) as unknown));
  if (onceJson !== twiceJson) errors.push("normalize is not idempotent: normalize(normalize(x)) differs from normalize(x).");
  for (const key of Object.keys(root)) {
    if (!(key in once)) errors.push(`normalize drops top-level key "${key}".`);
  }
  const typeKeys = new Set(once.types.map((t) => t.key));

  const seenIds = new Set<string>();
  rawItems.forEach((rawItem, index) => {
    const item = asRecord(rawItem);
    if (!item) {
      errors.push(`items[${index}] is not an object.`);
      return;
    }
    const id = typeof item.id === "string" ? item.id : "";
    const title = typeof item.title === "string" ? item.title : "";
    const at = `item ${id ? `"${id}"` : `#${index}`} (${title || "no title"})`;

    if (!nonEmptyString(item.id)) errors.push(`${at}: id is missing or empty.`);
    else if (seenIds.has(item.id)) errors.push(`${at}: duplicate item id.`);
    else seenIds.add(item.id);
    if (!nonEmptyString(item.title)) errors.push(`${at}: title is empty.`);
    if (!isStatus(item.status)) errors.push(`${at}: status ${JSON.stringify(item.status)} is not one of ${STATUSES.join(", ")}.`);

    const ratings = asRecord(item.ratings);
    const ratingSources: [string, unknown][] = [["rating", item.rating], ["ratings.S", ratings?.S], ["ratings.L", ratings?.L]];
    for (const [name, value] of ratingSources) {
      if (value !== null && value !== undefined && !isRating(value)) {
        errors.push(`${at}: ${name} ${JSON.stringify(value)} is not a rating from 0.5 to 10 in steps of 0.5.`);
      }
    }
    for (const field of DATE_FIELDS) {
      const value = item[field];
      if (value !== null && value !== undefined && !isDate(value)) {
        errors.push(`${at}: ${field} ${JSON.stringify(value)} is not YYYY-MM-DD.`);
      }
    }

    if (item.statusAt !== undefined && item.statusAt !== null && (typeof item.statusAt !== "string" || !ISO_RE.test(item.statusAt) || Number.isNaN(Date.parse(item.statusAt)))) {
      warnings.push(`${at}: statusAt ${JSON.stringify(item.statusAt)} is not an ISO timestamp.`);
    }

    const normalized = once.items[index];
    if (normalized) {
      for (const key of Object.keys(item)) {
        if (key !== "statusAt" && !(key in normalized)) errors.push(`${at}: normalize drops key "${key}".`);
      }
    }
    if (typeof item.type === "string" && !typeKeys.has(item.type.trim())) {
      warnings.push(`${at}: type "${item.type}" is not among the defined types.`);
    }

    // Replies.
    const replyIds = new Set<string>();
    if (item.replies !== undefined && !Array.isArray(item.replies)) errors.push(`${at}: replies is not an array.`);
    const replies: unknown[] = Array.isArray(item.replies) ? item.replies : [];
    replies.forEach((rawReply, i) => {
      const reply = asRecord(rawReply);
      if (!reply) {
        errors.push(`${at}: replies[${i}] is not an object.`);
        return;
      }
      for (const field of ["id", "by", "to", "text", "at"] as const) {
        if (!nonEmptyString(reply[field])) errors.push(`${at}: replies[${i}].${field} is missing or empty.`);
      }
      if (reply.by !== undefined && nonEmptyString(reply.by) && !isPerson(reply.by)) {
        errors.push(`${at}: replies[${i}].by ${JSON.stringify(reply.by)} is not a known person.`);
      }
      if (nonEmptyString(reply.id)) {
        if (replyIds.has(reply.id)) errors.push(`${at}: duplicate reply id "${reply.id}".`);
        replyIds.add(reply.id);
      }
    });

    // Targets (reply.to, reaction keys) are legitimately left dangling when a comment is cleared.
    const comments = normalized?.comments;
    const resolvable = (target: string): boolean =>
      replyIds.has(target) || (isPerson(target) && !!comments && comments[target].trim() !== "");
    for (const rawReply of replies) {
      const reply = asRecord(rawReply);
      if (reply && nonEmptyString(reply.to) && !resolvable(reply.to)) {
        warnings.push(`${at}: reply "${String(reply.id)}" targets "${reply.to}", which is neither a non-empty comment nor a reply.`);
      }
    }

    // Reactions.
    if (item.reactions !== undefined && item.reactions !== null && !asRecord(item.reactions)) {
      errors.push(`${at}: reactions is not an object.`);
    }
    for (const [target, rawMap] of Object.entries(asRecord(item.reactions) ?? {})) {
      const map = asRecord(rawMap);
      if (!map) {
        errors.push(`${at}: reactions["${target}"] is not an object.`);
        continue;
      }
      for (const [person, value] of Object.entries(map)) {
        const kinds: unknown[] = Array.isArray(value) ? value : [value];
        for (const kind of kinds) {
          if (!isReactionKind(kind)) {
            errors.push(`${at}: reactions["${target}"].${person} has unknown kind ${JSON.stringify(kind)} (known: ${REACTION_KINDS.map((r) => r.key).join(", ")}).`);
          }
        }
      }
      if (!resolvable(target)) {
        warnings.push(`${at}: reactions target "${target}" is neither a non-empty comment nor a reply.`);
      }
    }
  });

  return { errors, warnings };
}
