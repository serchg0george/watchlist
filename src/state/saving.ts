import { LS_DATA_CACHE } from "../config.js";
import { chooseFallback, makeCache, parseCache } from "../data/data-cache.js";
import { GitHubRepository, friendlyError } from "../data/github.js";
import { SaveQueue, combineMessages } from "../data/save-queue.js";
import type { SaveEntry } from "../data/save-queue.js";
import { asRecord } from "../domain/guards.js";
import { applyOp, describeOp, isOp } from "../domain/ops.js";
import type { Op } from "../domain/ops.js";
import { WatchlistTMDB } from "../tmdb.js";
import { showToast } from "./toast.js";
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

let lastLoadAt = 0; // Date.now() of the last successful load or save

export function msSinceLoad(): number { return Date.now() - lastLoadAt; }

export async function loadAll(options: { silent?: boolean } = {}): Promise<void> {
  if (saves.hasUnsaved()) return;
  const silent = options.silent === true;
  // A quiet refresh must not start while the initial load is in flight.
  if (silent && state.loading) return;
  // Silent: no "Загрузка…" flash, no error clearing before the request.
  if (!silent) {
    state.loading = true;
    state.error = null;
    render();
  }
  try {
    const loaded = await repo.load(state.token);
    // An edit may have been queued while the request was in flight: keep local data, the queue will bring fresh copies.
    if (silent && saves.hasUnsaved()) return;
    state.dataBranch = loaded.branch;
    state.data = loaded.data;
    writeLocal(LS_DATA_CACHE, makeCache(loaded.data, loaded.branch, new Date()));
    state.offline = false;
    state.offlineSince = null;
    state.error = null;
    lastLoadAt = Date.now();
  } catch (e) {
    console.error("load failed", e);
    if (!silent) {
      const fb = chooseFallback(readLocal(LS_DATA_CACHE));
      if (fb.kind === "cache") {
        // Show the cached copy instead of an error screen.
        state.data = fb.data;
        state.dataBranch = fb.branch;
        state.offline = true;
        state.offlineSince = fb.savedAt;
      } else {
        state.error = friendlyError(e);
      }
    } else if (state.data !== null) {
      // Keep the shown data, mark it as stale.
      state.offline = true;
      if (!state.offlineSince) {
        const cache = parseCache(readLocal(LS_DATA_CACHE));
        state.offlineSince = cache ? cache.savedAt : new Date().toISOString();
      }
    }
  } finally {
    if (!silent) state.loading = false;
    render();
  }
}

// ===== Saving: retained optimistic queue with conflict retry =====

// A rate op fully replaces the previous rating of the same person, so earlier ones in the same save are redundant.
function dropSupersededRatings(entries: readonly SaveEntry<Op>[]): SaveEntry<Op>[] {
  const seen = new Set<string>();
  const kept: SaveEntry<Op>[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.op.kind === "rate") {
      const key = `${entry.op.itemId}\u0000${entry.op.person}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(entry);
  }
  return kept.reverse();
}

export const saves = new SaveQueue<Op>({
  async save(batch) {
    const entries = dropSupersededRatings(batch);
    const last = batch[batch.length - 1]!;
    const saved = await repo.save(last.token, (data) => { for (const entry of entries) applyOp(data, entry.op, entry.login); }, combineMessages(entries.map((entry) => entry.message)));
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
    writeLocal(LS_DATA_CACHE, makeCache(data, state.dataBranch, new Date()));
    state.offline = false;
    state.offlineSince = null;
    lastLoadAt = Date.now();
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

// "Сохранено" stays visible for a moment after the queue drains; the header reads this flag.
export const saveIndicator = { touched: false, visible: false };

function updateSaveIndicator(): void {
  clearTimeout(saveHideTimer);
  saveIndicator.touched = true;
  saveIndicator.visible = true;
  if (!saves.error && saves.size === 0) {
    saveHideTimer = setTimeout(() => { saveIndicator.visible = false; render(); }, 1600);
  }
  render();
}
