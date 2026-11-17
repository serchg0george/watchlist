/* Watchlist: personal film/series tracker.
 * Strict TypeScript compiled by tsc to native ES modules, no libraries.
 * Data lives in data/movies.json; edits are committed to the repo
 * through the GitHub Contents API with a user-provided fine-grained token. */

import { DEFAULT_TYPES, LS_LOGIN, LS_PERSON, LS_TOKEN, PALETTE_PRESETS, PEOPLE, REACTION_KINDS, STATUS_LABELS, UNDO_MS, personFor } from "./config.js";
import { GitHubRepository, apiHeaders, friendlyError, httpError } from "./data/github.js";
import { SaveQueue } from "./data/save-queue.js";
import type { SaveEntry } from "./data/save-queue.js";
import { todayStr } from "./domain/dates.js";
import { asRecord, isPerson, isReactionKind, isStatus } from "./domain/guards.js";
import { avgRating, commentAuthor } from "./domain/items.js";
import { normalizeGenres } from "./domain/normalize.js";
import { applyOp, describeOp, isOp } from "./domain/ops.js";
import type { Op } from "./domain/ops.js";
import { MONTH_FULL, computeStats } from "./domain/stats.js";
import type { Stats } from "./domain/stats.js";
import { transliterate } from "./domain/text.js";
import type { CategoryType, Item, Person, ReactionKind, Reply, Status, TmdbItemMetadata, WatchlistData } from "./domain/types.js";
import { WatchlistTMDB } from "./tmdb.js";
import type { ElChild } from "./ui/dom.js";
import { byId, el, statsSvg } from "./ui/dom.js";
import { newId } from "./util/id.js";

// ===== Constants =====


const isListTab = (value: unknown): value is ListTab => LIST_TABS.includes(value as ListTab);

function getTypes(): CategoryType[] {
  if (state.data && Array.isArray(state.data.types) && state.data.types.length > 0) {
    return state.data.types;
  }
  return DEFAULT_TYPES;
}

function getTypeLabel(key: string): string {
  const t = getTypes().find((item) => item.key === key);
  return t ? t.label : key;
}

function getTypeColor(key: string): string {
  const t = getTypes().find((item) => item.key === key);
  return t && t.color ? t.color : "#5b6b53";
}

type ChipKey = "all" | "watching";
type ListTab = "list" | "watched" | "dropped";
type Tab = ListTab | "stats";
type SortKey = "added-desc" | "watched-desc" | "rating-desc" | "title-asc";

const CHIPS: readonly { key: ChipKey; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "watching", label: "Смотрим" }
];
// Tabs that show the item list; "list" is filtered by CHIPS, the others by their own status.
const LIST_TABS: readonly ListTab[] = ["list", "watched", "dropped"];

const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: "added-desc", label: "Недавно добавленные" },
  { key: "watched-desc", label: "Недавно просмотренные" },
  { key: "rating-desc", label: "По оценке" },
  { key: "title-asc", label: "По названию" }
];

// ===== State =====

interface ReplyDraft { itemId: string; to: string }

interface AppState {
  token: string;
  login: string;
  person: Person | "";
  data: WatchlistData | null;
  dataBranch: string | null;
  loading: boolean;
  error: string | null;
  tab: Tab;
  statusFilter: ChipKey;
  typeFilter: string;
  search: string;
  sort: SortKey;
  editingId: string | null;
  commentingId: string | null;
  replyDraft: ReplyDraft | null;
  editingReplyId: string | null;
  highlightId: string | null;
}

const state: AppState = {
  token: localStorage.getItem(LS_TOKEN) || "",
  login: localStorage.getItem(LS_LOGIN) || "",
  person: personFor(localStorage.getItem(LS_LOGIN) || ""),
  data: null,
  dataBranch: null,
  loading: true,
  error: null,
  tab: "list",
  statusFilter: "all",
  typeFilter: "all",
  search: "",
  sort: "added-desc",
  editingId: null,
  commentingId: null,
  replyDraft: null,
  editingReplyId: null,
  highlightId: null
};

let lastPickId: string | null = null;
const openItems = new Set<string>();
const draftMemory = new Map<string, unknown>();
const draftCleanups = new Map<string, unknown>();
let catalogSavePending = false;
// Per login, so a queue left by one account is never overwritten by another.
const pendingKey = (login: string): string => `watchlist.pendingSaves.${login}`;

function readLocal(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? null; } catch { return null; }
}

function writeLocal(key: string, value: unknown): void {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep in-memory drafts when storage is unavailable. */ }
}

function draftKey(kind: string, id: string): string { return `watchlist.draft.${state.login}.${kind}.${id}`; }
function readDraft(key: string): Record<string, unknown> | null { return asRecord(draftMemory.get(key) ?? readLocal(key)); }
function writeDraft(key: string, value: unknown): void {
  if (value == null) draftMemory.delete(key); else draftMemory.set(key, value);
  writeLocal(key, value);
}

function clearDraftAfterSave(key: string, snapshot: unknown): void {
  draftCleanups.set(key, snapshot);
  saves.wait().then(() => {
    if (JSON.stringify(readDraft(key)) === JSON.stringify(snapshot)) writeDraft(key, null);
    draftCleanups.delete(key);
  }).catch(() => {});
}
let highlightTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let saveHideTimer: ReturnType<typeof setTimeout> | undefined;

// ===== Data loading =====

const repo = new GitHubRepository();

async function loadAll(): Promise<void> {
  if (saves.hasUnsaved()) return;
  state.loading = true;
  state.error = null;
  render();
  try {
    const loaded = await repo.load(state.token);
    state.dataBranch = loaded.branch;
    state.data = loaded.data;
  } catch (e) {
    console.error("load failed", e);
    state.error = friendlyError(e);
  } finally {
    state.loading = false;
    render();
  }
}

// ===== Saving: retained optimistic queue with conflict retry =====

const saves = new SaveQueue<Op>({
  async save(entry) {
    const saved = await repo.save(entry.token, (data) => applyOp(data, entry.op, entry.login), entry.message);
    state.dataBranch = saved.branch;
    return saved.data;
  },
  apply: (data, entry) => applyOp(data, entry.op, entry.login),
  // Tokens are never stored: after a reload the entries get the current token back.
  // The queue only flushes under its own login, so state.login owns every entry.
  persist: (entries) => writeLocal(pendingKey(state.login), entries.length ? entries.map(({ op, message, login }) => ({ op, message, login })) : null),
  currentLogin: () => state.login,
  onSaved(data) {
    state.data = data;
    render();
  },
  onChange: updateSaveIndicator,
  onFlushed() {
    for (const [key, snapshot] of draftCleanups) {
      if (JSON.stringify(readDraft(key)) === JSON.stringify(snapshot)) writeDraft(key, null);
    }
    draftCleanups.clear();
    if (catalogSavePending) {
      catalogSavePending = false;
      WatchlistTMDB.acknowledgeSave();
    }
  },
  onError() {
    showToast("Не удалось сохранить. Изменения остались здесь — нажмите «Повторить сохранение».");
  }
});

function applyAndSave(op: Op): boolean {
  if (!state.token || !state.data) {
    showToast("Войдите через ⚙, чтобы редактировать список");
    return false;
  }
  if (saves.hasEntriesFromOther(state.login)) {
    showToast("Сначала сохраните изменения предыдущего пользователя");
    return false;
  }
  const message = describeOp(op, state.data);
  applyOp(state.data, op, state.login);
  render();
  saves.enqueue({ op, message, token: state.token, login: state.login });
  return true;
}

// Edits that were queued but not committed when the page closed are replayed after the first load.
function restorePendingSaves(): void {
  const stored = readLocal(pendingKey(state.login));
  if (!Array.isArray(stored) || !state.data) return;
  const entries: SaveEntry<Op>[] = [];
  for (const raw of stored) {
    const rec = asRecord(raw);
    if (!rec || !isOp(rec.op) || typeof rec.message !== "string" || rec.login !== state.login) continue;
    entries.push({ op: rec.op, message: rec.message, token: state.token, login: state.login });
  }
  if (!state.token || !entries.length) return;
  for (const entry of entries) applyOp(state.data, entry.op, entry.login);
  render();
  saves.restore(entries);
}


function updateSaveIndicator(): void {
  const ind = document.getElementById("save-indicator");
  if (!ind) return;
  clearTimeout(saveHideTimer);
  ind.setAttribute("role", "status");
  let retry = document.getElementById("retry-save-btn") as HTMLButtonElement | null;
  if (!retry) {
    retry = el("button", { id: "retry-save-btn", type: "button", class: "btn retry-save-btn", text: "Повторить сохранение" });
    retry.addEventListener("click", () => saves.retry());
    ind.after(retry);
  }
  retry.hidden = !saves.error;
  retry.disabled = saves.running;
  ind.classList.toggle("save-error", !!saves.error);
  if (saves.error) {
    ind.textContent = `Не сохранено: ${saves.size}. Не закрывайте страницу.`;
    ind.classList.add("visible");
    ind.classList.remove("busy");
  } else if (saves.size > 0) {
    ind.textContent = `Сохраняется: ${saves.size}…`;
    ind.classList.add("visible", "busy");
  } else {
    ind.textContent = "Сохранено";
    ind.classList.add("visible");
    ind.classList.remove("busy");
    saveHideTimer = setTimeout(() => ind.classList.remove("visible"), 1600);
  }
}

// ===== Actions (each builds a serializable Op and hands it to applyAndSave) =====

function addItem(title: string, type: string, metadata: TmdbItemMetadata = {}): boolean {
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

function toggleWatched(id: string): void {
  const item = findItem(id);
  if (!item) return;
  const snap = snapshotOf(item);
  const toWatched = !(item.status === "watched" || item.status === "dropped");
  const op: Op = toWatched ? { kind: "markWatched", itemId: id, date: todayStr() } : { kind: "unmarkWatched", itemId: id };
  if (applyAndSave(op)) {
    offerUndo(toWatched ? `«${item.title}» — просмотрено` : `«${item.title}» снова в списке`, snap);
  }
}

function rateItem(id: string, person: Person, star: number): void {
  const item = findItem(id);
  if (!item) return;
  // Clicking the current rating again clears it.
  const newRating = item.ratings[person] === star ? null : star;
  applyAndSave({ kind: "rate", itemId: id, person, rating: newRating });
}

function setComment(id: string, person: Person, text: string): void {
  const item = findItem(id);
  if (!item) return;
  closeEditors();
  if ((item.comments[person] || "") === text) { render(); return; }
  applyAndSave({ kind: "setComment", itemId: id, person, text });
}

function closeEditors(): void {
  state.editingId = null;
  state.commentingId = null;
  state.replyDraft = null;
  state.editingReplyId = null;
}

function addReply(id: string, to: string, text: string): void {
  const item = findItem(id);
  const by = state.person;
  if (!state.token || !isPerson(by) || !item) return;
  closeEditors();
  const trimmed = text.trim();
  if (!trimmed || !commentAuthor(item, to)) { render(); return; }
  const reply: Reply = { id: newId(), to, by, text: trimmed, at: new Date().toISOString() };
  applyAndSave({ kind: "addReply", itemId: id, reply });
}

function editReply(id: string, replyId: string, text: string): void {
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

function deleteReply(id: string, replyId: string): void {
  const item = findItem(id);
  const by = state.person;
  const reply = item?.replies.find((r) => r.id === replyId);
  if (!state.token || !reply || reply.by !== by || !confirm("Удалить ответ?")) return;
  closeEditors();
  applyAndSave({ kind: "deleteReply", itemId: id, replyId, by });
}

function reactToComment(id: string, target: string, kind: ReactionKind): void {
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

function commitEdit(id: string, fields: EditFields): void {
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

function deleteItem(id: string): void {
  const item = findItem(id);
  if (!item) return;
  state.editingId = null;
  const snap = snapshotOf(item);
  if (applyAndSave({ kind: "deleteItem", itemId: id })) offerUndo(`«${item.title}» удалено`, snap);
}

function addCategory(label: string, color: string | null): void {
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
    renderCategoriesDialog();
  }
}

function updateCategoryColor(key: string, newColor: string): void {
  const trimmed = newColor.trim();
  if (!/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return;
  const current = getTypes().find((t) => t.key === key);
  if (!current || current.color === trimmed) return;
  if (applyAndSave({ kind: "setCategoryColor", key, color: trimmed })) {
    renderCategoriesDialog();
  }
}

function updateCategory(key: string, newLabel: string): void {
  const trimmed = newLabel.trim();
  if (!trimmed) {
    showToast("Название категории не может быть пустым");
    renderCategoriesDialog();
    return;
  }
  const current = getTypes().find((t) => t.key === key);
  if (!current || current.label === trimmed) return;
  if (applyAndSave({ kind: "renameCategory", key, label: trimmed })) {
    showToast(`Категория переименована в «${trimmed}»`);
    renderCategoriesDialog();
  }
}

function deleteCategory(key: string): void {
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
    renderCategoriesDialog();
  }
}

// Random pick from "planned", respecting the type filter; avoids repeating the previous pick.
function pickRandom(): void {
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
  state.highlightId = pick.id;
  render();
  showToast(`🎲 ${pick.title}`);
  const row = document.querySelector(`.item-row[data-id="${CSS.escape(pick.id)}"]`);
  if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  // Drop the highlight without a re-render, so nothing in progress gets rebuilt.
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    state.highlightId = null;
    document.querySelectorAll(".item-row.highlight").forEach((r) => r.classList.remove("highlight"));
  }, 3000);
}

// ===== Rendering =====

function render(): void {
  persistView();
  renderHeader();
  updateTypeSelects();
  document.querySelectorAll<HTMLElement>(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const isList = isListTab(state.tab);
  byId("list-tab").hidden = !isList;
  byId("stats-tab").hidden = state.tab !== "stats";
  byId("add-form").hidden = !state.token || state.tab !== "list";
  byId("mobile-add-btn").hidden = !state.token || state.tab !== "list";
  byId("chips").hidden = state.tab !== "list";
  byId("random-btn").hidden = state.tab !== "list";
  if (isList) renderList();
  else renderStats();
}

function renderHeader(): void {
  const line = byId("auth-status");
  line.textContent = state.token && state.login
    ? `Редактирует: ${state.login}${state.person ? ` (${state.person})` : ""}`
    : "Только просмотр";
}

function sortItems(items: Item[], key: SortKey): Item[] {
  const arr = items.slice();
  switch (key) {
    case "watched-desc":
      arr.sort((a, b) => (b.watchedAt || "").localeCompare(a.watchedAt || "") || b.addedAt.localeCompare(a.addedAt));
      break;
    case "rating-desc":
      arr.sort((a, b) => (avgRating(b) ?? -1) - (avgRating(a) ?? -1) || a.title.localeCompare(b.title, "ru"));
      break;
    case "title-asc":
      arr.sort((a, b) => a.title.localeCompare(b.title, "ru"));
      break;
    case "added-desc":
    default:
      // Stable sort: same-day items keep file order (new items are prepended).
      arr.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  return arr;
}

function updateChips(base: Item[]): void {
  const counts: Record<string, number> = { all: 0, planned: 0, watching: 0, watched: 0, dropped: 0 };
  base.forEach((it) => { counts[it.status] = (counts[it.status] ?? 0) + 1; });
  counts.all = counts.planned ?? 0;
  document.querySelectorAll<HTMLElement>("#chips .chip").forEach((chip) => {
    const key = chip.dataset.key ?? "";
    const count = chip.querySelector(".count");
    if (count) count.textContent = String(counts[key]);
    chip.classList.toggle("active", state.statusFilter === key);
  });
  document.querySelectorAll<HTMLElement>(".tab-btn .count").forEach((span) => {
    span.textContent = String(counts[span.parentElement?.dataset.tab ?? ""]);
  });
}

function buildCommentEditor(person: Person | "", text: string, save: (text: string) => void, label: string): HTMLElement {
  const identity = state.editingReplyId ? `edit-${state.editingReplyId}` : state.replyDraft ? `reply-${state.replyDraft.itemId}-${state.replyDraft.to}` : `comment-${state.commentingId}-${person}`;
  const key = draftKey("comment", identity);
  const ta = el("textarea", { class: "comment-input", rows: 2, placeholder: label, "aria-label": label });
  const draftText = readDraft(key)?.text;
  ta.value = typeof draftText === "string" ? draftText : text;
  ta.addEventListener("input", () => writeDraft(key, { text: ta.value }));
  const submit = () => {
    const snapshot = { text: ta.value };
    writeDraft(key, snapshot);
    save(ta.value.trim());
    clearDraftAfterSave(key, snapshot);
  };
  const cancel = () => { closeEditors(); render(); };
  const saveBtn = el("button", { type: "button", class: "btn btn-primary", text: "Сохранить" });
  const cancelBtn = el("button", { type: "button", class: "btn", text: "Отмена" });
  saveBtn.addEventListener("click", submit);
  cancelBtn.addEventListener("click", cancel);
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  const editor = el("div", { class: `comment-line person-${person.toLowerCase()} mine` },
    el("span", { class: "person-tag", text: person }), ta,
    el("div", { class: "comment-actions" }, saveBtn, cancelBtn));
  setTimeout(() => { if (ta.isConnected) ta.focus(); }, 0);
  return editor;
}

function buildCommentActions(item: Item, target: string, author: Person, canEdit: boolean, isReply: boolean): HTMLElement {
  const actions = el("div", { class: "comment-controls" });
  const reactions = el("div", { class: "reaction-options", role: "group", "aria-label": "Реакции" });
  const links = el("div", { class: "comment-links" });
  const mine = canEdit && state.person === author;
  const map = item.reactions[target] || {};
  for (const kind of REACTION_KINDS) {
    const count = PEOPLE.filter((p) => map[p]?.includes(kind.key)).length;
    const active = canEdit && isPerson(state.person) && map[state.person]?.includes(kind.key);
    const btn = el("button", {
      type: "button",
      class: `reaction-pill${active ? ` person-${state.person.toLowerCase()}` : ""}`,
      disabled: !canEdit || mine,
      title: mine ? "Нельзя реагировать на свой комментарий" : canEdit ? kind.label : "Войдите, чтобы реагировать",
      "aria-label": `${kind.label}: ${count}`,
      "aria-pressed": String(!!active)
    }, el("span", { class: "reaction-emoji", text: kind.emoji, "aria-hidden": "true" }),
    count ? el("span", { class: "reaction-count", text: count, "aria-hidden": "true" }) : null);
    btn.addEventListener("click", () => reactToComment(item.id, target, kind.key));
    reactions.append(btn);
  }
  if (canEdit) {
    const replyBtn = el("button", { type: "button", class: "comment-action", text: "Ответить" });
    replyBtn.addEventListener("click", () => {
      closeEditors();
      state.replyDraft = { itemId: item.id, to: target };
      render();
    });
    links.append(replyBtn);
  }
  if (isReply && mine) {
    const editBtn = el("button", { type: "button", class: "comment-action", text: "Изменить" });
    editBtn.addEventListener("click", () => { closeEditors(); state.editingReplyId = target; render(); });
    const deleteBtn = el("button", { type: "button", class: "comment-action", text: "Удалить" });
    deleteBtn.addEventListener("click", () => deleteReply(item.id, target));
    links.append(editBtn, deleteBtn);
  }
  actions.append(reactions);
  if (links.children.length) actions.append(links);
  return actions;
}

function replyDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildComments(item: Item, canEdit: boolean): HTMLElement {
  const comments = el("div", { class: "comments" });
  const sorted = item.replies.slice().sort((a, b) => a.at.localeCompare(b.at));
  const children = new Map<string, Reply[]>();
  const ids = new Set(item.replies.map((r) => r.id));
  for (const reply of sorted) {
    const list = children.get(reply.to) ?? [];
    list.push(reply);
    children.set(reply.to, list);
  }
  const appendDraft = (node: HTMLElement, target: string): void => {
    if (canEdit && state.replyDraft?.itemId === item.id && state.replyDraft.to === target) {
      node.append(buildCommentEditor(state.person, "", (text) => addReply(item.id, target, text), "Ваш ответ…"));
    }
  };
  // Flatten the tree so the visual indent can stop growing after level three.
  // Track reply objects to render malformed cycles/duplicate ids without looping or losing text.
  const visited = new Set<Reply>();
  const appendReplies = (replies: Reply[], depth: number): void => {
    const stack = replies.slice().reverse().map((reply) => ({ reply, depth }));
    for (let next = stack.pop(); next; next = stack.pop()) {
      const { reply, depth } = next;
      if (visited.has(reply)) continue;
      visited.add(reply);
      const node = el("div", {
        class: "comment-node reply-node", style: `--reply-depth:${Math.min(depth, 3)}`, "data-reply-id": reply.id
      });
      const mine = canEdit && state.person === reply.by;
      if (mine && state.editingReplyId === reply.id) {
        node.append(buildCommentEditor(reply.by, reply.text,
          (text) => editReply(item.id, reply.id, text), "Ваш ответ…"));
      } else {
        node.append(el("div", { class: `comment-line person-${reply.by.toLowerCase()}` },
          el("span", { class: "person-tag", text: reply.by }),
          el("span", { class: "comment-text", text: reply.text }),
          el("span", { class: "reply-date", text: `${replyDate(reply.at)}${reply.editedAt ? " (изм.)" : ""}` })),
        buildCommentActions(item, reply.id, reply.by, canEdit, true));
      }
      appendDraft(node, reply.id);
      comments.append(node);
      const nested = children.get(reply.id) || [];
      for (const child of nested.slice().reverse()) stack.push({ reply: child, depth: depth + 1 });
    }
  };
  for (const p of PEOPLE) {
    const text = item.comments[p];
    const mine = canEdit && state.person === p;
    const rootReplies = children.get(p) || [];
    const node = el("div", { class: "comment-node" });
    if (mine && state.commentingId === item.id) {
      node.append(buildCommentEditor(p, text, (value) => setComment(item.id, p, value), `Комментарий ${p}`));
    } else {
      if (text || rootReplies.length) {
        const line = el("div", {
          class: `comment-line person-${p.toLowerCase()}${mine && text ? " mine" : ""}${!text ? " comment-deleted" : ""}`,
          role: mine && text ? "button" : null,
          tabindex: mine && text ? 0 : null,
          title: mine && text ? "Изменить комментарий" : null
        }, el("span", { class: "person-tag", text: p }),
        el("span", { class: "comment-text", text: text || "Комментарий удалён" }));
        if (mine && text) {
          const open = () => { closeEditors(); state.commentingId = item.id; render(); };
          line.addEventListener("click", open);
          line.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
        }
        node.append(line);
        if (text) node.append(buildCommentActions(item, p, p, canEdit, false));
      }
      if (!text && mine) {
        const addBtn = el("button", { type: "button", class: "comment-add", text: "💬 Комментарий" });
        addBtn.addEventListener("click", () => { closeEditors(); state.commentingId = item.id; render(); });
        node.append(addBtn);
      }
    }
    appendDraft(node, p);
    if (node.children.length) comments.append(node);
    appendReplies(rootReplies, 1);
  }
  // Orphans follow both roots. Cycles have no root, so start any remaining component here as well.
  appendReplies(sorted.filter((r) => !isPerson(r.to) && !ids.has(r.to)), 1);
  for (const reply of sorted) if (!visited.has(reply)) appendReplies([reply], 1);
  return comments;
}

function buildItemRow(item: Item): HTMLElement {
  if (state.editingId === item.id && state.token) return buildEditor(item);

  const isFinished = item.status === "watched" || item.status === "dropped";
  const canEdit = !!state.token;

  // Checkbox: checked for watched/dropped.
  const cb = el("input", { type: "checkbox", class: "item-check", "aria-label": `Просмотрено: ${item.title}` });
  cb.checked = isFinished;
  if (!canEdit) cb.disabled = true;
  cb.addEventListener("change", () => toggleWatched(item.id));

  const children: HTMLElement[] = [el("label", { class: "check-wrap" }, cb)];
  children.push(el("span", { class: "item-title", text: item.title }));
  const typeColor = getTypeColor(item.type);
  children.push(el("span", { class: "badge badge-type", style: `--cat-color: ${typeColor}`, text: getTypeLabel(item.type) }));

  if (item.status === "watching" || item.status === "dropped") {
    children.push(el("span", { class: `badge badge-status-${item.status}`, text: STATUS_LABELS[item.status] }));
  }
  const details = el("details", { class: "item-details" }, el("summary", { text: "Подробности и обсуждение" }));
  details.open = openItems.has(item.id) || state.commentingId === item.id || state.replyDraft?.itemId === item.id || item.replies.some((r) => r.id === state.editingReplyId);
  details.addEventListener("toggle", () => { if (details.isConnected) { if (details.open) openItems.add(item.id); else openItems.delete(item.id); } });
  if (item.note) details.append(el("span", { class: "item-note", text: item.note }));
  if (item.genres?.length) details.append(el("span", { class: "item-genres", text: item.genres.join(" · ") }));
  if (item.tmdb && ["movie", "tv"].includes(item.tmdb.mediaType) && Number.isSafeInteger(item.tmdb.id) && item.tmdb.id > 0) {
    const meta = item.tmdb;
    children.push(el("span", { class: "item-meta", text: [meta.year, meta.runtime != null && meta.runtime > 0 ? `${meta.runtime} мин${meta.mediaType === "tv" ? " / серия" : ""}` : ""].filter(Boolean).join(" · ") }));
    const info = el("div", { class: "catalog-info" });
    if (typeof meta.posterPath === "string" && /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(meta.posterPath)) {
      const image = el("img", { class: "catalog-poster", src: `https://image.tmdb.org/t/p/w185${meta.posterPath}`, alt: `Постер: ${item.title}`, loading: "lazy", width: 92, height: 138 });
      image.addEventListener("error", () => { image.hidden = true; });
      info.append(image);
    }
    info.append(el("div", { class: "catalog-description" }, el("p", { text: meta.overview || "Описание пока отсутствует." }),
      el("a", { class: "catalog-source", href: `https://www.themoviedb.org/${meta.mediaType}/${meta.id}`, target: "_blank", rel: "noopener noreferrer", text: "Открыть в TMDB" })));
    details.append(info);
  }
  const finishedAt = item.status === "dropped" ? item.droppedAt : item.status === "watched" ? item.watchedAt : null;
  if (finishedAt) children.push(el("span", { class: "item-date", text: `${item.status === "dropped" ? "Брошено" : "Просмотрено"}: ${finishedAt.split("-").reverse().join(".")}` }));

  // Each person rates only on their own line; the other line is read-only.
  if (isFinished) {
    const ratings = el("div", { class: "ratings" });
    for (const p of PEOPLE) {
      const value = item.ratings[p];
      const mine = canEdit && state.person === p;
      const line = el("div", { class: `rating-line person-${p.toLowerCase()}${mine ? " mine" : ""}` },
        el("span", { class: "person-tag", text: p }));
      const stars = el("span", { class: "stars" });
      for (let i = 1; i <= 10; i++) {
        const on = value != null && i <= value;
        if (mine) {
          const s = el("button", { type: "button", class: `star${on ? " on" : ""}`, text: on ? "★" : "☆", "aria-label": `${p}: ${i} из 10` });
          s.addEventListener("click", () => rateItem(item.id, p, i));
          stars.append(s);
        } else {
          stars.append(el("span", { class: `star static${on ? " on" : ""}`, text: on ? "★" : "☆" }));
        }
      }
      line.append(stars, el("span", { class: "rating-value", text: value != null ? String(value) : "—" }));
      ratings.append(line);
    }
    details.append(ratings);
  }

  const comments = buildComments(item, canEdit);
  if (comments.children.length > 0) details.append(comments);
  children.push(details);

  if (canEdit) {
    const editBtn = el("button", { type: "button", class: "icon-btn edit-btn", text: "✎", "aria-label": "Редактировать" });
    editBtn.addEventListener("click", () => { closeEditors(); state.editingId = item.id; render(); });
    children.push(editBtn);
  }

  return el("div", { class: `item-row${state.highlightId === item.id ? " highlight" : ""}`, "data-id": item.id }, ...children);
}

function buildEditor(item: Item): HTMLElement {
  const key = draftKey("item", item.id);
  const draft = readDraft(key);
  const titleInput = el("input", { type: "text", class: "edit-title", value: item.title, "aria-label": "Название" });
  const typeSelect = el("select", { class: "edit-type", "aria-label": "Тип" },
    ...getTypes().map((t) => el("option", { value: t.key, text: t.label })));
  typeSelect.value = item.type;
  const firstType = getTypes()[0];
  if (!typeSelect.value && firstType) {
    typeSelect.value = firstType.key;
  }

  const statusSelect = el("select", { class: "edit-status", "aria-label": "Статус" },
    ...Object.entries(STATUS_LABELS).map(([k, v]) => el("option", { value: k, text: v })));
  statusSelect.value = item.status;

  const noteInput = el("input", { type: "text", class: "edit-note", value: item.note || "", placeholder: "Заметка", "aria-label": "Заметка" });
  const genresInput = el("input", { type: "text", value: (item.genres || []).join(", "), placeholder: "Например: комедия, драма", "aria-label": "Жанры через запятую" });
  const genresField = el("label", { class: "edit-genres" }, el("span", { text: "Жанры через запятую" }), genresInput);
  const dateInput = el("input", { type: "date", class: "edit-date" });
  const dateLabel = el("span");
  const dateField = el("label", { class: "edit-date-field" }, dateLabel, dateInput,
    el("small", { text: "При смене статуса дата ставится автоматически. Можно исправить вручную." }));
  let dateEdited = false;
  const updateDateField = (): void => {
    const status = statusSelect.value;
    const key: "watchedAt" | "droppedAt" | null = status === "watched" ? "watchedAt" : status === "dropped" ? "droppedAt" : null;
    dateField.hidden = !key;
    dateLabel.textContent = status === "dropped" ? "Дата отказа от просмотра" : "Дата просмотра";
    dateInput.setAttribute("aria-label", dateLabel.textContent);
    dateInput.value = key ? (status !== item.status ? todayStr() : item[key] || "") : "";
    dateEdited = false;
  };
  updateDateField();
  statusSelect.addEventListener("change", updateDateField);
  dateInput.addEventListener("input", () => { dateEdited = true; });
  if (draft) {
    const text = (value: unknown, fallback: string): string => typeof value === "string" ? value : fallback;
    titleInput.value = text(draft.title, item.title);
    typeSelect.value = typeof draft.type === "string" && getTypes().some((t) => t.key === draft.type) ? draft.type : item.type;
    statusSelect.value = isStatus(draft.status) ? draft.status : item.status;
    noteInput.value = text(draft.note, item.note);
    genresInput.value = text(draft.genres, (item.genres || []).join(", "));
    updateDateField();
    dateInput.value = text(draft.date, dateInput.value);
    dateEdited = !!draft.dateEdited;
  }
  const snapshot = () => ({ title: titleInput.value, type: typeSelect.value, status: statusSelect.value, note: noteInput.value, genres: genresInput.value, date: dateInput.value, dateEdited });
  for (const input of [titleInput, typeSelect, statusSelect, noteInput, genresInput, dateInput]) {
    input.addEventListener("input", () => writeDraft(key, snapshot()));
    input.addEventListener("change", () => writeDraft(key, snapshot()));
  }

  const saveBtn = el("button", { type: "button", class: "btn btn-primary", text: "Сохранить" });
  const cancelBtn = el("button", { type: "button", class: "btn", text: "Отмена" });
  const deleteBtn = el("button", { type: "button", class: "btn btn-danger", text: "Удалить" });

  saveBtn.addEventListener("click", () => {
    const t = titleInput.value.trim();
    if (!t) { showToast("Название не может быть пустым"); return; }
    if (!dateField.hidden && !dateInput.checkValidity()) { dateInput.reportValidity(); return; }
    const savedDraft = snapshot();
    writeDraft(key, savedDraft);
    commitEdit(item.id, {
      title: t,
      type: typeSelect.value,
      status: isStatus(statusSelect.value) ? statusSelect.value : item.status,
      note: noteInput.value.trim(),
      genres: genresInput.value.split(","),
      finishedAt: dateInput.value || null,
      dateEdited
    });
    clearDraftAfterSave(key, savedDraft);
  });
  cancelBtn.addEventListener("click", () => { state.editingId = null; render(); });
  deleteBtn.addEventListener("click", () => {
    if (confirm(`Удалить «${item.title}»?`)) deleteItem(item.id);
  });

  return el("div", { class: "editor" },
    el("div", { class: "editor-grid" }, titleInput, typeSelect, statusSelect, noteInput, genresField, dateField),
    el("div", { class: "editor-actions" }, saveBtn, cancelBtn, deleteBtn)
  );
}

function buildSection(items: Item[]): HTMLElement {
  const list = el("div", { class: "item-list" });
  if (items.length === 0) list.append(el("div", { class: "state-msg", text: "Ничего не найдено" }));
  else items.forEach((it) => list.append(buildItemRow(it)));
  return list;
}

function renderList(): void {
  const box = byId("items");
  box.textContent = "";

  if (state.loading) { box.append(el("div", { class: "state-msg", text: "Загрузка…" })); return; }
  if (state.error) { box.append(el("div", { class: "state-msg error", text: state.error })); return; }
  if (!state.data || state.data.items.length === 0) {
    box.append(el("div", { class: "state-msg", text: "Список пуст" }));
    updateChips([]);
    return;
  }

  const q = state.search.trim().toLowerCase();
  // Base list respects type + search filters (not the status filter).
  const base = state.data.items.filter((it) => {
    if (state.typeFilter !== "all" && it.type !== state.typeFilter) return false;
    if (q && !(it.title.toLowerCase().includes(q) || String(it.tmdb?.originalTitle || "").toLowerCase().includes(q) || it.note.toLowerCase().includes(q) || PEOPLE.some((p) => it.comments[p].toLowerCase().includes(q)) || it.replies.some((r) => r.text.toLowerCase().includes(q)))) return false;
    return true;
  });

  updateChips(base);
  const sorted = sortItems(base, state.sort);

  const status: Status = state.tab === "watched" || state.tab === "dropped" ? state.tab : state.statusFilter === "watching" ? "watching" : "planned";
  box.append(buildSection(sorted.filter((it) => it.status === status)));
}

// ===== Stats tab =====

const MONTH_NAMES = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function statsFmt(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(1).replace(".", ",");
}


function statsChart(width: number, height: number, label: string, interactive = false): SVGSVGElement {
  return statsSvg("svg", { width: "100%", viewBox: `0 0 ${width} ${height}`, role: interactive ? "group" : "img", "aria-label": label });
}

function statsWho(person: Person, text: string = person): HTMLElement {
  return el("b", { class: `who ${person.toLowerCase()}`, text });
}

function statsBadge(item: Item): HTMLElement {
  const type = getTypes().find((t) => t.key === item.type);
  return el("span", { class: "badge", style: `--c:${type?.color || "var(--muted)"}`, text: type?.label || item.type || "Без типа" });
}

function statsEmpty(text: string): HTMLElement {
  return el("p", { class: "empty", text });
}

function statsSection(key: string, title: string, note?: string | null): { section: HTMLElement; body: HTMLElement } {
  const body = el("div", { class: "sec-body", id: key });
  const section = el("section", { class: `card sec-${key}`, "aria-labelledby": `h-${key}` },
    el("h2", { class: "sec-title", id: `h-${key}`, text: title }),
    note ? el("p", { class: "sec-note", text: note }) : null, body);
  return { section, body };
}

function statsLegend(entries: [string, string][]): HTMLElement {
  return el("div", { class: "legend" }, ...entries.map(([label, color]) => el("span", {}, el("i", { class: "sw", style: `background:${color}`, "aria-hidden": "true" }), label)));
}

function statsTooltip(tip: HTMLElement, node: HTMLElement | SVGElement, content: () => Node[]): void {
  const hide = () => { tip.hidden = true; };
  const show = () => {
    tip.replaceChildren(...content());
    tip.hidden = false;
    const bounds = node.getBoundingClientRect(), margin = 8;
    tip.style.left = `${Math.max(margin, Math.min(window.innerWidth - tip.offsetWidth - margin, bounds.left + bounds.width / 2 - tip.offsetWidth / 2))}px`;
    const top = bounds.top - tip.offsetHeight - margin;
    tip.style.top = `${Math.max(margin, Math.min(window.innerHeight - tip.offsetHeight - margin, top < margin ? bounds.bottom + margin : top))}px`;
  };
  node.addEventListener("pointerenter", show);
  node.addEventListener("focus", show);
  node.addEventListener("pointerleave", hide);
  node.addEventListener("blur", hide);
  node.addEventListener("keydown", (event: Event) => { if (event instanceof KeyboardEvent && event.key === "Escape") hide(); });
}

function renderStatsHero(items: Item[], data: Stats): HTMLElement {
  const card = (name: string, label: string, ...children: ElChild[]): HTMLElement => el("div", { class: `card hero-${name}` }, el("div", { class: "kpi-label", text: label }), ...children);
  const statuses: [Status, string, string][] = [
    ["watched", "Просмотрено", "var(--accent)"], ["watching", "Смотрим", "color-mix(in srgb,var(--accent) 50%,transparent)"],
    ["planned", "В планах", "var(--track)"], ["dropped", "Брошено", "var(--danger)"]
  ];
  const watched = card("watched", "Просмотрено", el("div", { class: "kpi" }, data.statuses.watched, el("small", { text: ` из ${items.length}` })));
  if (items.length) watched.append(el("div", { class: "status-bar", role: "img", "aria-label": statuses.map(([key, label]) => `${label}: ${data.statuses[key]}`).join(", ") },
    ...statuses.filter(([key]) => data.statuses[key]).map(([key, label, color]) => el("i", { style: `flex:${data.statuses[key]};background:${color}`, title: `${label}: ${data.statuses[key]}` }))),
    statsLegend(statuses.map(([key, label, color]): [string, string] => [`${label} ${data.statuses[key]}`, color])));
  else watched.append(statsEmpty("Список пока пуст"));
  const average = card("avg", "Средняя оценка");
  if (data.values.S.length || data.values.L.length) {
    average.append(el("div", { class: "vs" },
      el("div", { class: "vs-side s" }, statsWho("S"), el("span", { class: "kpi", text: statsFmt(data.averages.S) })),
      el("div", { class: "vs-sep", text: "vs" }),
      el("div", { class: "vs-side l" }, statsWho("L"), el("span", { class: "kpi", text: statsFmt(data.averages.L) }))));
    average.append(el("div", { class: "avg-bars", "aria-hidden": "true" },
      ...PEOPLE.map((person) => el("div", { class: `avg-bar ${person.toLowerCase()}` }, el("i", { style: `width:${(data.averages[person] || 0) * 10}%` }))),
      el("div", { class: "avg-ticks" }, ...[0, 5, 10].map((n) => el("span", { text: n })))));
    let caption = "Для сравнения нужны оценки S и L";
    if (data.averages.S != null && data.averages.L != null) {
      const difference = data.averages.S - data.averages.L;
      caption = Math.abs(difference) < 0.05 ? "Поровну" : `${difference > 0 ? "S" : "L"} щедрее на ${statsFmt(Math.abs(difference))}`;
    }
    average.append(el("div", { class: "kpi-cap", text: caption }));
  } else average.append(statsEmpty("Пока нет оценок"));
  average.append(el("div", { class: "kpi-cap", text: `Оценок: S ${data.values.S.length} · L ${data.values.L.length}` }));
  const match = card("match", "Совпадение вкусов");
  if (data.both.length) {
    const percentage = Math.round(data.close / data.both.length * 100), circumference = 2 * Math.PI * 24;
    const ring = statsSvg("svg", { width: 60, height: 60, viewBox: "0 0 60 60", "aria-hidden": "true" },
      statsSvg("circle", { cx: 30, cy: 30, r: 24, fill: "none", stroke: "var(--track)", "stroke-width": 8 }),
      statsSvg("circle", { cx: 30, cy: 30, r: 24, fill: "none", stroke: "var(--accent)", "stroke-width": 8, "stroke-dasharray": `${circumference * data.close / data.both.length} ${circumference}`, transform: "rotate(-90 30 30)" }));
    match.append(el("div", { class: "match" }, ring, el("div", { class: "kpi-m", text: `${percentage}%` })), el("div", { class: "kpi-cap", text: `${data.close} из ${data.both.length} общих оценок с разницей ≤ 1` }));
  } else match.append(statsEmpty("Пока нет общих оценок"));
  const both = card("both", "Оценили оба", el("div", { class: "kpi-m", text: data.both.length }), el("div", { class: "kpi-cap", text: `Совпали точно: ${data.exact}` }));
  return el("section", { class: "hero", "aria-label": "Главное" }, watched, average, match, both);
}

function renderStatsHistogram(data: Stats, tip: HTMLElement): HTMLElement {
  const mode = (person: Person): number => data.counts[person].indexOf(Math.max(...data.counts[person]));
  const phrases = PEOPLE.filter((person) => data.values[person].length).map((person, i) => `${person}${i ? " —" : " ставит"} ${mode(person)}`);
  const { section, body } = statsSection("hist", "Распределение оценок", phrases.length ? `Чаще всего ${phrases.join(", ")}` : null);
  if (!phrases.length) { body.append(statsEmpty("Пока нет оценок")); return section; }
  const chart = statsChart(440, 220, "Распределение оценок S и L от 1 до 10");
  const max = Math.max(...data.counts.S, ...data.counts.L), step = max <= 4 ? 1 : Math.ceil(max / 4), ceiling = Math.ceil(max / step) * step;
  const y = (n: number): number => 182 - n / ceiling * 160;
  for (let n = 0; n <= ceiling; n += step) chart.append(statsSvg("line", { class: "grid", x1: 26, x2: 438, y1: y(n), y2: y(n) }), statsSvg("text", { class: "ax", x: 18, y: y(n) + 4, "text-anchor": "end" }, n));
  for (let rating = 1; rating <= 10; rating++) {
    const cx = 26 + (rating - 0.5) * 41.2;
    const group = statsSvg("g", { class: "col", tabindex: 0, "aria-label": `Оценка ${rating}: S ${data.counts.S[rating]}, L ${data.counts.L[rating]}` });
    group.append(statsSvg("rect", { class: "col-bg", x: cx - 19, y: 4, width: 38, height: 198, rx: 6 }));
    PEOPLE.forEach((person, index) => {
      const count = data.counts[person][rating] ?? 0, x = cx + (index ? 1 : -15);
      if (count) group.append(statsSvg("rect", { x, y: y(count), width: 14, height: 182 - y(count), rx: 3, fill: `var(--${person.toLowerCase()})` }), statsSvg("text", { class: "val", x: x + 7, y: y(count) - 5, "text-anchor": "middle", fill: `var(--${person.toLowerCase()})` }, count));
    });
    group.append(statsSvg("text", { class: "ax-strong", x: cx, y: 201, "text-anchor": "middle" }, rating));
    statsTooltip(tip, group, () => [el("div", { class: "tip-h", text: `Оценка ${rating}` }), ...PEOPLE.map((person) => el("div", { class: "tip-row" }, statsWho(person), `${data.counts[person][rating]} тайтлов`))]);
    chart.append(group);
  }
  chart.append(statsSvg("text", { class: "ax", x: 232, y: 218, "text-anchor": "middle" }, "оценка"));
  body.append(statsLegend([["S", "var(--s)"], ["L", "var(--l)"]]), el("div", { class: "chart" }, chart));
  return section;
}

function renderStatsMonths(data: Stats, tip: HTMLElement): HTMLElement {
  const total = data.months.reduce((sum, month) => sum + month.count, 0);
  const best = data.months.reduce((a, b) => b.count > a.count ? b : a);
  const note = total ? `${total} за 12 месяцев · больше всего — ${MONTH_FULL[best.month]} (${best.count}) · текущий месяц ещё идёт` : "Последние 12 календарных месяцев · текущий месяц ещё идёт";
  const { section, body } = statsSection("months", "Просмотрено по месяцам", note);
  if (!total) { body.append(statsEmpty("За последние 12 месяцев ничего не просмотрено")); return section; }
  const chart = statsChart(440, 220, "Просмотрено за последние 12 календарных месяцев");
  const max = Math.max(...data.months.map((month) => month.count));
  chart.append(statsSvg("line", { class: "grid", x1: 2, x2: 438, y1: 192, y2: 192 }));
  data.months.forEach((month, index) => {
    const x = 2 + (index + 0.5) * 436 / 12, height = month.count / max * 168;
    const group = statsSvg("g", { class: "col", tabindex: 0, "aria-label": `${MONTH_FULL[month.month]} ${month.year}: ${month.count}` });
    group.append(statsSvg("rect", { class: "col-bg", x: x - 17, y: 4, width: 34, height: 214, rx: 6 }),
      statsSvg("rect", { x: x - 11, y: month.count ? 192 - height : 190, width: 22, height: month.count ? height : 2, rx: 3, fill: month.count ? "var(--accent)" : "var(--track)", "fill-opacity": index === 11 ? 0.55 : 1 }),
      statsSvg("text", { class: "val", x, y: month.count ? 187 - height : 183, "text-anchor": "middle", fill: "var(--text)" }, month.count),
      statsSvg("text", { class: index === 11 ? "ax-strong" : "ax", x, y: 212, "text-anchor": "middle" }, MONTH_NAMES[month.month]));
    statsTooltip(tip, group, () => [el("div", { class: "tip-h", text: `${MONTH_FULL[month.month]} ${month.year}` }), ...(month.items.length ? month.items.map((item) => el("div", { class: "tip-row", text: item.title })) : [el("div", { class: "tip-sub", text: "Ничего не просмотрено" })])]);
    chart.append(group);
  });
  body.append(el("div", { class: "chart" }, chart));
  return section;
}

function renderStatsScatter(data: Stats, tip: HTMLElement): HTMLElement {
  const { section, body } = statsSection("scatter", "S против L", "Каждая точка — тайтл, оценённый обоими. Нажмите на точку, чтобы увидеть названия.");
  if (!data.both.length) { body.append(statsEmpty("Пока нет общих оценок")); return section; }
  const chart = statsChart(440, 440, "Оценка S по горизонтали, оценка L по вертикали. Выберите точку, чтобы увидеть тайтлы", true);
  const x = (value: number): number => 30 + (value - 0.5) * 40, y = (value: number): number => 404 - (value - 0.5) * 39.4;
  const band: [number, number][] = [[0.5, 1.5], [9.5, 10.5], [10.5, 10.5], [10.5, 9.5], [1.5, 0.5], [0.5, 0.5]];
  chart.append(statsSvg("polygon", { points: band.map(([s, l]) => `${x(s)},${y(l)}`).join(" "), fill: "var(--accent)", "fill-opacity": 0.1 }));
  for (let rating = 1; rating <= 10; rating++) chart.append(
    statsSvg("line", { class: "grid", x1: x(rating), x2: x(rating), y1: 10, y2: 404 }), statsSvg("line", { class: "grid", x1: 30, x2: 430, y1: y(rating), y2: y(rating) }),
    statsSvg("text", { class: "ax-strong", x: x(rating), y: 420, "text-anchor": "middle" }, rating), statsSvg("text", { class: "ax-strong", x: 22, y: y(rating) + 4, "text-anchor": "end" }, rating));
  chart.append(statsSvg("line", { x1: x(0.5), x2: x(10.5), y1: y(0.5), y2: y(10.5), stroke: "var(--muted)", "stroke-dasharray": "5 5" }),
    statsSvg("text", { class: "ax", x: 150, y: 265, transform: "rotate(-45 150 265)", "text-anchor": "middle" }, "согласны · ±1"),
    statsSvg("text", { x: x(1), y: y(10), fill: "var(--l)", "font-size": 12, "font-weight": 600 }, "L выше"),
    statsSvg("text", { x: x(10), y: y(1), fill: "var(--s)", "font-size": 12, "font-weight": 600, "text-anchor": "end" }, "S выше"),
    statsSvg("text", { class: "ax", x: 230, y: 438, "text-anchor": "middle" }, "оценка S →"),
    statsSvg("text", { class: "ax", transform: "translate(9 207) rotate(-90)", "text-anchor": "middle" }, "оценка L →"));
  const detail = el("div", { class: "scatter-detail", id: "scatter-detail", hidden: true, role: "region", "aria-label": "Выбранные тайтлы", "aria-live": "polite" });
  const points: SVGGElement[] = [];
  [...data.groups.values()].sort((a, b) => b.length - a.length).forEach((items) => {
    const first = items[0];
    if (!first) return;
    const { S: s, L: l } = first.ratings, color = s > l ? "var(--s)" : l > s ? "var(--l)" : "var(--accent)";
    const point = statsSvg("g", { class: "pt", tabindex: 0, role: "button", "aria-label": `S ${s}, L ${l}: ${items.map((item) => item.title).join(", ")}. Показать тайтлы`, "aria-controls": "scatter-detail", "aria-expanded": "false", "fill-opacity": 0.5 });
    point.append(statsSvg("circle", { cx: x(s), cy: y(l), r: Math.min(18, 7 + (items.length - 1) * 4), fill: color, stroke: color, "stroke-width": 1.5 }));
    if (items.length > 1) point.append(statsSvg("text", { x: x(s), y: y(l) + 4, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "var(--text)", "fill-opacity": 1 }, items.length));
    const select = () => {
      tip.hidden = true;
      points.forEach((other) => other.setAttribute("aria-expanded", String(other === point)));
      detail.replaceChildren(el("div", { class: "scatter-detail-head" }, statsWho("S", `S ${s}`), statsWho("L", `L ${l}`)),
        el("div", { class: "scatter-detail-list" }, ...items.map((item) => el("div", { class: "scatter-detail-item" }, el("span", { class: "title", text: item.title }), statsBadge(item)))));
      detail.hidden = false;
    };
    point.addEventListener("click", select);
    point.addEventListener("keydown", (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } });
    statsTooltip(tip, point, () => items.map((item) => el("div", { class: "tip-row" }, el("span", { text: item.title }), el("span", { class: "tip-r" }, statsWho("S", `S ${s}`), statsWho("L", `L ${l}`)))));
    points.push(point); chart.append(point);
  });
  body.append(el("div", { class: "chart scatter-box" }, chart), statsLegend([["S выше", "var(--s)"], ["L выше", "var(--l)"], ["поровну", "var(--accent)"]]),
    el("p", { class: "sec-note", text: "Размер и число — сколько тайтлов" }), detail);
  return section;
}

function statsItemButton(item: Item): HTMLElement {
  const button = el("button", { type: "button", class: "title stats-title-button", text: item.title, title: item.title, "aria-label": `Открыть обсуждение: ${item.title}` });
  button.addEventListener("click", () => {
    closeEditors();
    state.tab = item.status === "watched" || item.status === "dropped" ? item.status : "list";
    state.statusFilter = item.status === "watching" ? "watching" : "all";
    state.typeFilter = "all";
    state.search = "";
    byId<HTMLInputElement>("search").value = "";
    state.highlightId = item.id;
    openItems.add(item.id);
    render();
    const row = document.querySelector<HTMLElement>(`.item-row[data-id="${CSS.escape(item.id)}"]`);
    if (row) { row.setAttribute("tabindex", "-1"); row.focus({ preventScroll: true }); row.scrollIntoView({ behavior: "smooth", block: "center" }); }
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      state.highlightId = null;
      document.querySelectorAll(".item-row.highlight").forEach((node) => node.classList.remove("highlight"));
    }, 3000);
  });
  return button;
}

function renderStatsGenres(data: Stats): HTMLElement {
  const { section, body } = statsSection("genres", "Совпадение по жанрам", "Только просмотренное. Один тайтл может входить в несколько жанров.");
  if (!data.genres.length) { body.append(statsEmpty("Добавьте жанры в редакторе просмотренных тайтлов — здесь появится сравнение ваших вкусов.")); return section; }
  body.append(el("div", { class: "genre-grid" }, ...data.genres.map((genre) => {
    const card = el("article", { class: "genre-card" },
      el("div", { class: "genre-head" }, el("h3", { text: genre.label }), el("span", { class: "genre-count", text: `Просмотрено: ${genre.count}` })),
      el("div", { class: "genre-ratings" }, ...PEOPLE.map((person) => el("div", { class: "genre-rating" },
        statsWho(person), el("strong", { text: statsFmt(genre.people[person].average) }),
        el("span", { class: "genre-count", text: `оценок: ${genre.people[person].count}` })))),
      el("div", { class: "genre-agreement" }, el("strong", { text: genre.agreement == null ? "Пока не сравнить" : `${Math.round(genre.agreement)}% совпадения` }),
        el("span", { class: "genre-count", text: `Оценили оба: ${genre.paired}` })));
    if (genre.agreement != null) card.append(el("div", { class: "genre-meter", "aria-hidden": "true" }, el("i", { style: `width:${genre.agreement}%` })));
    if (genre.paired < 3) card.append(el("p", { class: "sec-note", text: genre.paired ? "Пока мало совместных оценок — результат предварительный." : "Нужны оценки обоих на одни и те же тайтлы." }));
    return card;
  })));
  body.append(el("p", { class: "sec-note genre-formula", text: "Средние оценки S и L учитывают все их оценки в жанре. Совпадение = 100 × (1 − средняя разница общих оценок / 9): одинаковые оценки дают 100%, разница в 9 баллов — 0%." }));
  return section;
}

function renderStatsFavorite(data: Stats): HTMLElement {
  const favorite = data.favoriteMonth;
  const { section, body } = statsSection("favorite", "Фаворит месяца", `${favorite.label} · по средней оценке двоих`);
  if (!favorite.items.length) { body.append(statsEmpty("В этом месяце пока нет просмотренных тайтлов с датой и оценками обоих.")); return section; }
  body.append(el("p", { class: "sec-note", text: `Тайтлов с двумя оценками за месяц: ${favorite.count}${favorite.items.length > 1 ? ". Первое место разделили:" : ""}` }));
  favorite.items.forEach((item) => body.append(el("div", { class: "favorite-row" },
    el("div", { class: "favorite-main" }, statsItemButton(item), statsBadge(item)),
    el("div", { class: "pair" }, statsWho("S", `S ${item.ratings.S}`), statsWho("L", `L ${item.ratings.L}`)),
    el("strong", { class: "favorite-score", "aria-label": `Средняя оценка ${statsFmt((item.ratings.S + item.ratings.L) / 2)}`, text: statsFmt((item.ratings.S + item.ratings.L) / 2) }))));
  return section;
}

function renderStatsDiffs(data: Stats): HTMLElement {
  const { section, body } = statsSection("diff", "Самые спорные просмотры", "Пять самых больших расхождений среди просмотренного. Нажмите на название, чтобы открыть обсуждение.");
  body.id = "diffs";
  if (!data.diffs.length) { body.append(statsEmpty("Пока нет просмотренных тайтлов с разными оценками обоих.")); return section; }
  const position = (value: number): number => (value - 1) / 9 * 100;
  data.diffs.forEach((item) => {
    const { S: s, L: l } = item.ratings;
    const scale = el("div", { class: "scale", "aria-hidden": "true" }, el("div", { class: "scale-track" }));
    for (let value = 1; value <= 10; value++) scale.append(el("i", { class: "scale-tick", style: `left:${position(value)}%` }));
    scale.append(el("i", { class: "scale-line", style: `left:${position(Math.min(s, l))}%;width:${Math.abs(s - l) / 9 * 100}%;background:linear-gradient(90deg,var(--${s <= l ? "s" : "l"}),var(--${s <= l ? "l" : "s"}))` }),
      el("span", { class: "dot s", style: `left:${position(s)}%`, text: "S" }), el("span", { class: "dot l", style: `left:${position(l)}%`, text: "L" }));
    body.append(el("div", { class: "row" }, el("div", { class: "row-head" }, statsItemButton(item),
      el("span", { class: "pair" }, statsWho("S", `S ${s}`), statsWho("L", `L ${l}`)), el("span", { class: "delta", "aria-label": `разница ${Math.abs(s - l)}`, text: `Δ ${Math.abs(s - l)}` })), scale));
  });
  body.append(el("div", { class: "scale-axis", "aria-hidden": "true" }, ...Array.from({ length: 10 }, (_, i) => el("span", { style: `left:${position(i + 1)}%`, text: i + 1 }))));
  return section;
}

function renderStatsCategories(items: Item[], data: Stats): HTMLElement {
  const { section, body } = statsSection("cats", "По типам", "Длина отрезка — всего в списке, заливка — просмотрено");
  if (!items.length) { body.append(statsEmpty("Список пока пуст")); return section; }
  body.append(el("div", { class: "seg", role: "img", "aria-label": data.categories.map((type) => `${type.label}: ${type.watched} из ${type.total}`).join(", ") },
    ...data.categories.filter((type) => type.total).map((type) => el("div", { class: "seg-part", style: `--c:${type.color || "var(--muted)"};flex:${type.total}`, title: `${type.label}: ${type.watched} из ${type.total}` }, el("i", { style: `width:${type.watched / type.total * 100}%` })))),
    el("div", { class: "cat-grid" }, ...data.categories.map((type) => el("div", { class: "cat-item" }, el("span", { class: "cat-name" }, el("i", { class: "sw", style: `background:${type.color || "var(--muted)"}` }), type.label), el("span", { class: "cnt" }, type.watched, el("small", { text: ` / ${type.total}` }))))));
  return section;
}

function renderStatsTop(data: Stats): HTMLElement {
  const { section, body } = statsSection("top", "Топ по средней оценке", "Только тайтлы, оценённые обоими");
  if (!data.top.length) { body.append(statsEmpty("Пока нет общих оценок")); return section; }
  body.style.setProperty("--top-rows", String(Math.ceil(data.top.length / 2)));
  data.top.forEach((item, index) => body.append(el("div", { class: "top-row" }, el("span", { class: "rank", text: index + 1 }),
    el("div", { class: "top-main" }, el("span", { class: "title", text: item.title, title: item.title }), statsBadge(item)),
    el("div", { class: "mini-pair", "aria-label": `S ${item.ratings.S}, L ${item.ratings.L}` }, ...PEOPLE.map((person) => el("div", { class: `mini ${person.toLowerCase()}`, "aria-hidden": "true" }, el("b", { text: person }), el("span", { class: "mini-bar" }, el("i", { style: `width:${item.ratings[person] * 10}%` })), el("span", { text: item.ratings[person] })))),
    el("span", { class: "avg", "aria-label": `средняя ${statsFmt((item.ratings.S + item.ratings.L) / 2)}`, text: statsFmt((item.ratings.S + item.ratings.L) / 2) }))));
  return section;
}

function renderStats(): void {
  const box = byId("stats");
  box.textContent = "";
  if (state.loading) { box.append(el("div", { class: "state-msg", text: "Загрузка…" })); return; }
  if (state.error) { box.append(el("div", { class: "state-msg error", text: state.error })); return; }
  const items = state.data?.items || [], data = computeStats(items, getTypes());
  const tip = el("div", { class: "tip", role: "tooltip", hidden: true });
  const stack = el("div", { class: "stack" }, renderStatsHero(items, data), renderStatsFavorite(data), renderStatsDiffs(data), renderStatsGenres(data), renderStatsHistogram(data, tip), renderStatsMonths(data, tip), renderStatsScatter(data, tip), renderStatsCategories(items, data), renderStatsTop(data));
  box.append(el("div", { class: "stats-wrap" }, el("header", { class: "page-head" }, el("h1", { text: "Статистика" }), el("p", { text: `S и L · данные на ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}` })), stack), tip);
}

// ===== Toast =====

interface ToastAction { label: string; run: () => void }

// action: optional { label, run } rendered as a button inside the toast (e.g. undo).
function showToast(msg: string, action?: ToastAction): void {
  const t = byId("toast");
  t.textContent = "";
  t.append(el("span", { class: "toast-text", text: msg }));
  if (action) {
    const btn = el("button", { type: "button", class: "toast-action", text: action.label });
    btn.addEventListener("click", () => {
      clearTimeout(toastTimer);
      t.classList.remove("visible");
      action.run();
    });
    t.append(btn);
  }
  t.classList.toggle("has-action", !!action);
  t.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("visible"), action ? UNDO_MS : 2600);
}

// ===== Settings dialog =====

function openSettings(): void {
  const dlg = byId<HTMLDialogElement>("settings-dialog");
  let branchStatus = document.getElementById("data-branch-status");
  if (!branchStatus) {
    branchStatus = el("p", { id: "data-branch-status", class: "settings-text", style: "color: var(--muted)" });
    dlg.querySelector("h2")?.after(branchStatus);
  }
  branchStatus.textContent = `Данные: ${state.dataBranch || "опубликованная версия GitHub Pages"}`;
  byId("settings-error").textContent = "";
  dlg.showModal();
}

async function saveToken(): Promise<void> {
  const input = byId<HTMLInputElement>("token-input");
  const errEl = byId("settings-error");
  const token = input.value.trim() || state.token;
  if (!token) { errEl.textContent = "Введите токен."; return; }
  errEl.textContent = "";
  try {
    // Verify the token and learn our login.
    const res = await fetch("https://api.github.com/user", { headers: apiHeaders(token), cache: "no-store" });
    if (!res.ok) throw httpError(`GitHub API: HTTP ${res.status}`, res.status);
    const user = asRecord(await res.json());
    const login = typeof user?.login === "string" ? user.login : "";
    if (!saves.rebind(token, login)) {
      errEl.textContent = "Сначала сохраните изменения текущего пользователя. Можно обновить его токен.";
      return;
    }
    localStorage.setItem(LS_TOKEN, token);
    localStorage.setItem(LS_LOGIN, login);
    localStorage.removeItem(LS_PERSON); // legacy: person is now derived from the login
    state.token = token;
    state.login = login;
    state.person = personFor(state.login);
    saves.retry();
    input.value = "";
    byId<HTMLDialogElement>("settings-dialog").close();
    showToast(`Вход выполнен: ${state.login} (${state.person})`);
    void loadAll(); // from now on read fresh data via the API
  } catch (e) {
    console.error("token check failed", e);
    errEl.textContent = friendlyError(e);
  }
}

function logout(): void {
  if (saves.hasUnsaved()) { showToast("Сначала сохраните изменения — нажмите «Повторить сохранение»."); return; }
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_LOGIN);
  localStorage.removeItem(LS_PERSON);
  state.token = "";
  state.login = "";
  state.person = "";
  byId<HTMLDialogElement>("settings-dialog").close();
  showToast("Вы вышли. Режим: только просмотр.");
  void loadAll(); // back to the public copy of data/movies.json
}

// ===== Categories dialog =====

let selectedCategoryKey: string | null = null;

function renderPaletteSwatches(): void {
  const container = document.getElementById("palette-swatches");
  if (!container) return;
  container.textContent = "";
  PALETTE_PRESETS.forEach((hex) => {
    const btn = el("button", {
      type: "button",
      class: "palette-swatch-btn",
      style: `background-color: ${hex}`,
      title: hex,
      "aria-label": `Оттенок ${hex}`
    });
    btn.addEventListener("click", () => {
      if (selectedCategoryKey) {
        updateCategoryColor(selectedCategoryKey, hex);
      }
      const newColorInput = document.getElementById("new-category-color") as HTMLInputElement | null;
      if (newColorInput) newColorInput.value = hex;
    });
    container.append(btn);
  });
}

function openCategories(): void {
  const dlg = byId<HTMLDialogElement>("categories-dialog");
  renderCategoriesDialog();
  dlg.showModal();
}

function renderCategoriesDialog(): void {
  const list = document.getElementById("categories-list");
  if (!list) return;
  list.textContent = "";
  const types = getTypes();
  const canEdit = !!state.token;

  const hint = document.getElementById("categories-auth-hint");
  if (hint) hint.hidden = canEdit;

  const addForm = document.getElementById("add-category-form");
  if (addForm) addForm.hidden = !canEdit;

  const paletteBox = document.getElementById("palette-presets-box");
  if (paletteBox) paletteBox.hidden = !canEdit;

  renderPaletteSwatches();

  types.forEach((t) => {
    const count = state.data ? state.data.items.filter((i) => i.type === t.key).length : 0;

    const colorInput = el("input", {
      type: "color",
      class: "category-color-input",
      value: t.color || "#5b6b53",
      title: "Выбрать цвет из палитры",
      "aria-label": `Цвет категории ${t.label}`,
      disabled: !canEdit
    });

    colorInput.addEventListener("focus", () => { selectedCategoryKey = t.key; });
    colorInput.addEventListener("change", () => {
      selectedCategoryKey = t.key;
      updateCategoryColor(t.key, colorInput.value);
    });

    const input = el("input", {
      type: "text",
      class: "category-name-input",
      value: t.label,
      "aria-label": `Название категории ${t.label}`,
      disabled: !canEdit
    });

    input.addEventListener("focus", () => { selectedCategoryKey = t.key; });

    const saveBtn = el("button", {
      type: "button",
      class: "icon-btn category-save-btn",
      text: "✓",
      title: "Сохранить название",
      "aria-label": "Сохранить название",
      disabled: true
    });

    const handleSave = (): void => {
      const val = input.value.trim();
      if (val && val !== t.label) {
        updateCategory(t.key, val);
      } else {
        input.value = t.label;
        saveBtn.disabled = true;
      }
    };

    input.addEventListener("input", () => {
      saveBtn.disabled = !canEdit || input.value.trim() === t.label || !input.value.trim();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        input.value = t.label;
        saveBtn.disabled = true;
      }
    });

    saveBtn.addEventListener("click", handleSave);

    const countSpan = el("span", { class: "category-count", text: `${count}` });

    const delBtn = el("button", {
      type: "button",
      class: "icon-btn category-del-btn",
      text: "✕",
      title: "Удалить категорию",
      "aria-label": `Удалить категорию ${t.label}`,
      disabled: !canEdit || types.length <= 1
    });
    delBtn.addEventListener("click", () => deleteCategory(t.key));

    const row = el("div", { class: "category-row" }, colorInput, input, saveBtn, countSpan, delBtn);
    list.append(row);
  });
}

function updateTypeSelects(): void {
  const types = getTypes();

  const typeSel = document.getElementById("type-filter") as HTMLSelectElement | null;
  if (typeSel) {
    const curVal = state.typeFilter;
    typeSel.textContent = "";
    typeSel.append(el("option", { value: "all", text: "Все типы" }));
    types.forEach((t) => typeSel.append(el("option", { value: t.key, text: t.label })));
    typeSel.append(el("option", { value: "__manage__", text: "⚙ Настроить категории…" }));
    if (curVal === "all" || types.some((t) => t.key === curVal)) {
      typeSel.value = curVal;
    } else {
      state.typeFilter = "all";
      typeSel.value = "all";
    }
  }

  const addType = document.getElementById("add-type") as HTMLSelectElement | null;
  if (addType) {
    const curVal = addType.value;
    addType.textContent = "";
    types.forEach((t) => addType.append(el("option", { value: t.key, text: t.label })));
    const firstType = types[0];
    if (types.some((t) => t.key === curVal)) {
      addType.value = curVal;
    } else if (firstType) {
      addType.value = firstType.key;
    }
  }
}

// ===== Init =====

function persistView(): void {
  if (state.loading) return;
  writeLocal("watchlist.view", { tab: state.tab, statusFilter: state.statusFilter, typeFilter: state.typeFilter, search: state.search, sort: state.sort });
}

function init(): void {
  const savedScroll = asRecord(readLocal("watchlist.scroll")) ?? {};
  const tabScroll: Record<Tab, number> = { list: 0, watched: 0, dropped: 0, stats: 0 };
  window.addEventListener("beforeunload", (event) => {
    if (!saves.hasUnsaved()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  // Tabs.
  document.querySelectorAll<HTMLElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab !== "stats" && !isListTab(tab)) return;
      tabScroll[state.tab] = window.scrollY;
      state.tab = tab;
      render();
      window.scrollTo(0, tabScroll[state.tab] || 0);
    });
  });

  // Status chips (built once, counts updated on each list render).
  const chipsEl = byId("chips");
  CHIPS.forEach((c) => {
    const chip = el("button", { type: "button", class: "chip", "data-key": c.key }, c.label, el("span", { class: "count" }));
    chip.addEventListener("click", () => { state.statusFilter = c.key; render(); });
    chipsEl.append(chip);
  });

  // Type filter.
  const typeSel = byId<HTMLSelectElement>("type-filter");
  typeSel.addEventListener("change", () => {
    if (typeSel.value === "__manage__") {
      typeSel.value = state.typeFilter;
      openCategories();
      return;
    }
    state.typeFilter = typeSel.value;
    render();
  });

  // Search.
  const searchInput = byId<HTMLInputElement>("search");
  searchInput.addEventListener("input", () => { state.search = searchInput.value; render(); });

  // Sort.
  const sortSel = byId<HTMLSelectElement>("sort");
  const findSort = (value: unknown): SortKey | undefined => SORTS.find((s) => s.key === value)?.key;
  SORTS.forEach((s) => sortSel.append(el("option", { value: s.key, text: s.label })));
  sortSel.addEventListener("change", () => { state.sort = findSort(sortSel.value) ?? state.sort; render(); });

  updateTypeSelects();
  const initCatalog = (): void => WatchlistTMDB.init({
    getItems: () => state.data?.items || [], getTypes, canEdit: () => !!state.token && !state.loading && !state.error,
    add: async (title, type, metadata) => {
      const tmdb = metadata?.tmdb;
      if (tmdb && state.data?.items.some((it) => it.tmdb?.id === tmdb.id && it.tmdb?.mediaType === tmdb.mediaType)) {
        throw new Error("Этот тайтл уже есть в списке.");
      }
      if (!addItem(title, type, metadata)) return false;
      catalogSavePending = true;
      await saves.wait();
      return true;
    }
  });
  const view = asRecord(readLocal("watchlist.view")) ?? {};
  state.tab = view.tab === "stats" || isListTab(view.tab) ? view.tab : "list";
  if (state.tab === "list" && (view.statusFilter === "watched" || view.statusFilter === "dropped")) state.tab = view.statusFilter;
  state.statusFilter = CHIPS.find((c) => c.key === view.statusFilter)?.key ?? "all";
  state.typeFilter = typeof view.typeFilter === "string" ? view.typeFilter : "all";
  state.search = typeof view.search === "string" ? view.search : "";
  state.sort = findSort(view.sort) ?? "added-desc";
  searchInput.value = state.search;
  sortSel.value = state.sort;
  const clearFilters = el("button", { type: "button", class: "btn", text: "Сбросить фильтры" });
  clearFilters.addEventListener("click", () => { state.statusFilter = "all"; state.typeFilter = "all"; state.search = ""; searchInput.value = ""; render(); });
  document.querySelector(".filters")?.append(clearFilters);
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => writeLocal("watchlist.scroll", { tab: state.tab, y: window.scrollY }), 200); }, { passive: true });

  // Random pick.
  byId("random-btn").addEventListener("click", pickRandom);

  // Installable app / offline cache (needs http(s), not file://).
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((e: unknown) => console.warn("service worker registration failed", e));
  }

  // Settings dialog.
  byId("settings-btn").addEventListener("click", openSettings);
  byId("save-token-btn").addEventListener("click", () => { void saveToken(); });
  byId("logout-btn").addEventListener("click", logout);
  const dlg = byId<HTMLDialogElement>("settings-dialog");
  byId("cancel-settings-btn").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  // Categories dialog.
  byId("categories-btn").addEventListener("click", openCategories);
  byId("open-categories-from-settings").addEventListener("click", () => {
    dlg.close();
    openCategories();
  });
  const catDlg = byId<HTMLDialogElement>("categories-dialog");
  byId("close-categories-btn").addEventListener("click", () => catDlg.close());
  catDlg.addEventListener("click", (e) => { if (e.target === catDlg) catDlg.close(); });

  const addCategoryForm = byId<HTMLFormElement>("add-category-form");
  const newCategoryInput = byId<HTMLInputElement>("new-category-input");
  const newCategoryColor = document.getElementById("new-category-color") as HTMLInputElement | null;
  addCategoryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = newCategoryInput.value.trim();
    if (!val) return;
    const color = newCategoryColor ? newCategoryColor.value : null;
    addCategory(val, color);
    newCategoryInput.value = "";
    if (newCategoryColor) {
      newCategoryColor.value = PALETTE_PRESETS[getTypes().length % PALETTE_PRESETS.length] ?? newCategoryColor.value;
    }
  });

  render();
  void loadAll().then(() => {
    restorePendingSaves();
    initCatalog();
    const y = savedScroll.y;
    if (savedScroll.tab === state.tab && typeof y === "number" && Number.isFinite(y)) window.scrollTo(0, y);
  });
}

document.addEventListener("DOMContentLoaded", init);
