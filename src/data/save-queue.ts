import type { WatchlistData } from "../domain/types.js";

// ===== Saving: retained optimistic queue with conflict retry =====

export interface SaveEntry<T> { op: T; message: string; token: string; login: string }

export interface SaveQueueDeps<T> {
  /** Persist a run of entries (same login, FIFO) as one save, return the saved normalized data. */
  save(entries: readonly SaveEntry<T>[]): Promise<WatchlistData>;
  /** Replay a pending entry on fresh data (with the entry's own login). */
  apply(data: WatchlistData, entry: SaveEntry<T>): void;
  /** Queue contents changed (enqueue, restore, entry saved): store them for reload recovery. */
  persist(entries: readonly SaveEntry<T>[]): void;
  currentLogin(): string;
  /** After each saved entry: data with the remaining pending ops re-applied. */
  onSaved(data: WatchlistData): void;
  /** Size, running or error changed (indicator). */
  onChange(): void;
  /** Queue drained without error (draft cleanup, TMDB ack). */
  onFlushed(): void;
  /** Flush stopped on error (toast). */
  onError(error: unknown): void;
}

/** One commit message for several entries: one entry keeps its message; otherwise "N changes" plus one line each. */
export function combineMessages(messages: readonly string[]): string {
  if (messages.length <= 1) return messages[0] ?? "";
  return [`${messages.length} changes`, ...messages].join("\n");
}

export class SaveQueue<T> {
  private readonly queue: SaveEntry<T>[] = [];
  private readonly waiters: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  private isRunning = false;
  private lastError: unknown = null;

  constructor(private readonly deps: SaveQueueDeps<T>) {}

  get size(): number { return this.queue.length; }
  get running(): boolean { return this.isRunning; }
  get error(): unknown { return this.lastError; }

  hasUnsaved(): boolean {
    return this.queue.length > 0;
  }

  hasEntriesFromOther(login: string): boolean {
    return this.queue.some((entry) => entry.login !== login);
  }

  enqueue(entry: SaveEntry<T>): void {
    this.queue.push(entry);
    this.deps.persist(this.queue);
    this.deps.onChange();
    void this.flush();
  }

  /** Appends entries recovered from storage (already persisted) and starts flushing. */
  restore(entries: SaveEntry<T>[]): void {
    if (!entries.length) return;
    this.queue.push(...entries);
    this.deps.persist(this.queue);
    this.deps.onChange();
    void this.flush();
  }

  wait(): Promise<void> {
    if (this.lastError) return Promise.reject(this.lastError);
    if (!this.queue.length) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  retry(): void {
    if (this.isRunning || !this.queue.length) return;
    this.lastError = null;
    this.deps.onChange();
    void this.flush();
  }

  rebind(token: string, login: string): boolean {
    if (this.hasEntriesFromOther(login)) return false;
    for (const entry of this.queue) entry.token = token;
    return true;
  }

  private settle(error?: unknown): void {
    if (!error) this.deps.onFlushed();
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }

  private async flush(): Promise<void> {
    if (this.isRunning || this.lastError || !this.queue.length) return;
    this.isRunning = true;
    try {
      while (this.queue.length) {
        const login = this.queue[0]!.login;
        if (this.deps.currentLogin() !== login) throw new Error("Войдите под автором несохранённых изменений");
        // Everything queued so far under the same login goes out as ONE save; later edits wait for the next one.
        let count = 1;
        while (count < this.queue.length && this.queue[count]!.login === login) count++;
        const batch = this.queue.slice(0, count);
        const saved = await this.deps.save(batch);
        this.queue.splice(0, count);
        this.deps.persist(this.queue);
        // Keep subsequent optimistic edits visible while each save is committed.
        for (const pending of this.queue) this.deps.apply(saved, pending);
        this.deps.onSaved(saved);
        this.deps.onChange();
      }
      this.settle();
    } catch (error) {
      // The failed entries remain queued. Never reload over unsaved local edits.
      this.lastError = error;
      this.settle(error);
      this.deps.onError(error);
    } finally {
      this.isRunning = false;
      this.deps.onChange();
    }
  }
}
