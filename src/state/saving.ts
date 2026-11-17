import { GitHubRepository, friendlyError } from "../data/github.js";
import { SaveQueue } from "../data/save-queue.js";
import type { SaveEntry } from "../data/save-queue.js";
import { asRecord } from "../domain/guards.js";
import { applyOp, describeOp, isOp } from "../domain/ops.js";
import type { Op } from "../domain/ops.js";
import { WatchlistTMDB } from "../tmdb.js";
import { el } from "../ui/dom.js";
import { showToast } from "../ui/toast.js";
import { readLocal, render, state, writeLocal } from "./store.js";

const draftMemory = new Map<string, unknown>();
const draftCleanups = new Map<string, unknown>();

let catalogSavePending = false;
export function markCatalogSave(): void { catalogSavePending = true; }

// Per login, so a queue left by one account is never overwritten by another.
const pendingKey = (login: string): string => `watchlist.pendingSaves.${login}`;

export function draftKey(kind: string, id: string): string { return `watchlist.draft.${state.login}.${kind}.${id}`; }
export function readDraft(key: string): Record<string, unknown> | null { return asRecord(draftMemory.get(key) ?? readLocal(key)); }
export function writeDraft(key: string, value: unknown): void {
  if (value == null) draftMemory.delete(key); else draftMemory.set(key, value);
  writeLocal(key, value);
}

export function clearDraftAfterSave(key: string, snapshot: unknown): void {
  draftCleanups.set(key, snapshot);
  saves.wait().then(() => {
    if (JSON.stringify(readDraft(key)) === JSON.stringify(snapshot)) writeDraft(key, null);
    draftCleanups.delete(key);
  }).catch(() => {});
}

let saveHideTimer: ReturnType<typeof setTimeout> | undefined;

// ===== Data loading =====

const repo = new GitHubRepository();

export async function loadAll(): Promise<void> {
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

export const saves = new SaveQueue<Op>({
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

export function applyAndSave(op: Op): boolean {
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
export function restorePendingSaves(): void {
  // A live queue already holds (and persists) everything stored for this login.
  if (saves.hasUnsaved()) return;
  const stored = readLocal(pendingKey(state.login));
  if (!Array.isArray(stored) || !state.data) return;
  const entries: SaveEntry<Op>[] = [];
  for (const raw of stored) {
    const rec = asRecord(raw);
    if (!rec || !isOp(rec.op) || typeof rec.message !== "string" || rec.login !== state.login) continue;
    entries.push({ op: rec.op, message: rec.message, token: state.token, login: state.login });
  }
  if (!state.token || !entries.length) return;
  // isOp checks only the kind; an op that fails to apply locally is dropped instead of wedging the queue.
  const data = state.data;
  const applied = entries.filter((entry) => {
    try { applyOp(data, entry.op, entry.login); return true; }
    catch (error) { console.warn("dropped unreadable pending save", entry.op, error); return false; }
  });
  render();
  saves.restore(applied);
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
