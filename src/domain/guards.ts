import { PEOPLE, REACTION_KINDS, STATUSES } from "../config.js";
import type { Person, ReactionKind, Status } from "./types.js";

export const isPerson = (value: unknown): value is Person => PEOPLE.includes(value as Person);
export const isStatus = (value: unknown): value is Status => STATUSES.includes(value as Status);
export const isReactionKind = (value: unknown): value is ReactionKind => REACTION_KINDS.some((r) => r.key === value);
export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
