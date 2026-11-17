import { PALETTE_PRESETS } from "./config.js";
import { todayStr } from "./domain/dates.js";
import { isPerson, isReactionKind } from "./domain/guards.js";
import { commentAuthor } from "./domain/items.js";
import { normalizeGenres } from "./domain/normalize.js";
import type { Op } from "./domain/ops.js";
import { transliterate } from "./domain/text.js";
import type { Item, Person, ReactionKind, Reply, Status, TmdbItemMetadata } from "./domain/types.js";
import { applyAndSave } from "./state/saving.js";
import { getTypes, render, state } from "./state/store.js";
import { byId } from "./ui/dom.js";
import { showToast } from "./ui/toast.js";
import { newId } from "./util/id.js";

let lastPickId: string | null = null;

// The highlight is dropped without a re-render, so nothing in progress gets rebuilt.
let highlightTimer: ReturnType<typeof setTimeout> | undefined;

export function highlightItem(id: string): void {
  state.highlightId = id;
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    state.highlightId = null;
    document.querySelectorAll(".item-row.highlight").forEach((r) => r.classList.remove("highlight"));
  }, 3000);
}

// ===== Actions (each builds a serializable Op and hands it to applyAndSave) =====

export function addItem(title: string, type: string, metadata: TmdbItemMetadata = {}): boolean {
  const item: Item = {
    id: newId(),
    title,
    type,
    status: "planned",
    ratings: { S: null, L: null },
    comments: { S: "", L: "" },
    replies: [],
    reactions: {},
    genres: normalizeGenres(metadata.genres),
    note: "",
    addedAt: todayStr(),
    watchedAt: null,
    droppedAt: null,
    updatedBy: state.login
  };
  if (metadata.tmdb) item.tmdb = { ...metadata.tmdb };
  return applyAndSave({ kind: "addItem", item });
}

// Undo restores the item exactly as it was before the change (re-inserting it if it was deleted).
interface ItemSnapshot { item: Item; index: number }

function snapshotOf(item: Item): ItemSnapshot {
  return { item: JSON.parse(JSON.stringify(item)) as Item, index: state.data?.items.indexOf(item) ?? -1 };
}

function offerUndo(msg: string, snap: ItemSnapshot): void {
  showToast(msg, { label: "Отменить", run: () => restoreItem(snap) });
}

function restoreItem(snap: ItemSnapshot): void {
  applyAndSave({ kind: "restoreItem", item: snap.item, index: snap.index });
}

function findItem(id: string): Item | undefined {
  return state.data?.items.find((i) => i.id === id);
}

export function toggleWatched(id: string): void {
  const item = findItem(id);
  if (!item) return;
  const snap = snapshotOf(item);
  const toWatched = !(item.status === "watched" || item.status === "dropped");
  const op: Op = toWatched ? { kind: "markWatched", itemId: id, date: todayStr() } : { kind: "unmarkWatched", itemId: id };
  if (applyAndSave(op)) {
    offerUndo(toWatched ? `«${item.title}» — просмотрено` : `«${item.title}» снова в списке`, snap);
  }
}

export function rateItem(id: string, person: Person, star: number): void {
  const item = findItem(id);
  if (!item) return;
  // Clicking the current rating again clears it.
  const newRating = item.ratings[person] === star ? null : star;
  applyAndSave({ kind: "rate", itemId: id, person, rating: newRating });
}

export function setComment(id: string, person: Person, text: string): void {
  const item = findItem(id);
  if (!item) return;
  closeEditors();
  if ((item.comments[person] || "") === text) { render(); return; }
  applyAndSave({ kind: "setComment", itemId: id, person, text });
}

export function closeEditors(): void {
  state.editingId = null;
  state.commentingId = null;
  state.replyDraft = null;
  state.editingReplyId = null;
}

export function addReply(id: string, to: string, text: string): void {
  const item = findItem(id);
  const by = state.person;
  if (!state.token || !isPerson(by) || !item) return;
  closeEditors();
  const trimmed = text.trim();
  if (!trimmed || !commentAuthor(item, to)) { render(); return; }
  const reply: Reply = { id: newId(), to, by, text: trimmed, at: new Date().toISOString() };
  applyAndSave({ kind: "addReply", itemId: id, reply });
}

export function editReply(id: string, replyId: string, text: string): void {
  const item = findItem(id);
  const by = state.person;
  const reply = item?.replies.find((r) => r.id === replyId);
  if (!state.token || !reply || reply.by !== by) return;
  closeEditors();
  const trimmed = text.trim();
  if (!trimmed || trimmed === reply.text) { render(); return; }
  const editedAt = new Date().toISOString();
  applyAndSave({ kind: "editReply", itemId: id, replyId, by, text: trimmed, editedAt });
}

export function deleteReply(id: string, replyId: string): void {
  const item = findItem(id);
  const by = state.person;
  const reply = item?.replies.find((r) => r.id === replyId);
  if (!state.token || !reply || reply.by !== by || !confirm("Удалить ответ?")) return;
  closeEditors();
  applyAndSave({ kind: "deleteReply", itemId: id, replyId, by });
}

export function reactToComment(id: string, target: string, kind: ReactionKind): void {
  const item = findItem(id);
  const by = state.person;
  if (!state.token || !isPerson(by) || !item || !isReactionKind(kind)) return;
  const author = commentAuthor(item, target);
  if (!author || author === by) return;
  const adding = !item.reactions[target]?.[by]?.includes(kind);
  applyAndSave({ kind: "react", itemId: id, target, by, reaction: kind, add: adding });
}

interface EditFields {
  title: string;
  type: string;
  status: Status;
  note: string;
  genres: string[];
  finishedAt: string | null;
  dateEdited: boolean;
}

export function commitEdit(id: string, fields: EditFields): void {
  const item = findItem(id);
  if (!item) return;
  const dateKey = fields.status === "watched" ? "watchedAt" : fields.status === "dropped" ? "droppedAt" : null;
  const transitioned = fields.status !== item.status;
  const date = fields.finishedAt || todayStr();
  state.editingId = null; // close the editor on save
  // The date is decided once here, so conflict retries and replays reuse the same value.
  applyAndSave({
    kind: "editItem",
    itemId: id,
    fields: { title: fields.title, type: fields.type, status: fields.status, note: fields.note, genres: fields.genres },
    date: dateKey && (transitioned || fields.dateEdited) ? { field: dateKey, value: date } : null
  });
}

export function deleteItem(id: string): void {
  const item = findItem(id);
  if (!item) return;
  state.editingId = null;
  const snap = snapshotOf(item);
  if (applyAndSave({ kind: "deleteItem", itemId: id })) offerUndo(`«${item.title}» удалено`, snap);
}

export function addCategory(label: string, color: string | null): void {
  const trimmed = label.trim();
  if (!trimmed) return;
  const types = getTypes();
  if (types.some((t) => t.label.toLowerCase() === trimmed.toLowerCase())) {
    showToast(`Категория «${trimmed}» уже существует`);
    return;
  }
  const baseSlug = transliterate(trimmed).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let key = baseSlug || `type-${Date.now().toString(36)}`;
  if (types.some((t) => t.key === key)) {
    key = `${key}-${Date.now().toString(36).slice(-4)}`;
  }
  const chosenColor = color && /^#[0-9a-fA-F]{3,8}$/.test(color.trim())
    ? color.trim()
    : PALETTE_PRESETS[types.length % PALETTE_PRESETS.length] ?? "#5b6b53";
  if (applyAndSave({ kind: "addCategory", category: { key, label: trimmed, color: chosenColor } })) {
    showToast(`Категория «${trimmed}» добавлена`);
  }
}

export function updateCategoryColor(key: string, newColor: string): void {
  const trimmed = newColor.trim();
  if (!/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return;
  const current = getTypes().find((t) => t.key === key);
  if (!current || current.color === trimmed) return;
  applyAndSave({ kind: "setCategoryColor", key, color: trimmed });
}

export function updateCategory(key: string, newLabel: string): void {
  const trimmed = newLabel.trim();
  if (!trimmed) {
    showToast("Название категории не может быть пустым");
    return;
  }
  const current = getTypes().find((t) => t.key === key);
  if (!current || current.label === trimmed) return;
  if (applyAndSave({ kind: "renameCategory", key, label: trimmed })) {
    showToast(`Категория переименована в «${trimmed}»`);
  }
}

export function deleteCategory(key: string): void {
  const types = getTypes();
  if (types.length <= 1) {
    showToast("Нельзя удалить последнюю категорию");
    return;
  }
  const target = types.find((t) => t.key === key);
  if (!target) return;
  const count = state.data ? state.data.items.filter((i) => i.type === key).length : 0;
  const confirmMsg = count > 0
    ? `В категории «${target.label}» есть ${count} элементов. При удалении категории они сохранятся. Удалить категорию?`
    : `Удалить категорию «${target.label}»?`;
  if (!confirm(confirmMsg)) return;

  if (applyAndSave({ kind: "deleteCategory", key })) {
    showToast(`Категория «${target.label}» удалена`);
  }
}

// Random pick from "planned", respecting the type filter; avoids repeating the previous pick.
export function pickRandom(): void {
  if (!state.data) return;
  const pool = state.data.items.filter((it) => it.status === "planned" && (state.typeFilter === "all" || it.type === state.typeFilter));
  if (pool.length === 0) { showToast("В списке «Все» пусто"); return; }
  const candidates = pool.length > 1 ? pool.filter((it) => it.id !== lastPickId) : pool;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  if (!pick) return;
  lastPickId = pick.id;
  // Make sure the picked row is visible.
  state.tab = "list";
  state.statusFilter = "all";
  state.search = "";
  byId<HTMLInputElement>("search").value = "";
  highlightItem(pick.id);
  render();
  showToast(`🎲 ${pick.title}`);
  const row = document.querySelector(`.item-row[data-id="${CSS.escape(pick.id)}"]`);
  if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
}
