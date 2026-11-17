import type { WatchlistData } from "../domain/types.js";

// ===== Saving: retained optimistic queue with conflict retry =====

export interface SaveEntry<T> { op: T; message: string; token: string; login: string }

export interface SaveQueueDeps<T> {
  /** Persist one entry, return the saved normalized data. */
  save(entry: SaveEntry<T>): Promise<WatchlistData>;
  /** Replay a pending op on fresh data. */
  apply(data: WatchlistData, op: T): void;
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
      for (let entry = this.queue[0]; entry; entry = this.queue[0]) {
        if (this.deps.currentLogin() !== entry.login) throw new Error("Войдите под автором несохранённых изменений");
        const saved = await this.deps.save(entry);
        this.queue.shift();
        // Keep subsequent optimistic edits visible while each operation is committed.
        for (const pending of this.queue) this.deps.apply(saved, pending.op);
        this.deps.onSaved(saved);
        this.deps.onChange();
      }
      this.settle();
    } catch (error) {
      // The failed head remains queued. Never reload over unsaved local edits.
      this.lastError = error;
      this.settle(error);
      this.deps.onError(error);
    } finally {
      this.isRunning = false;
      this.deps.onChange();
    }
  }
}
