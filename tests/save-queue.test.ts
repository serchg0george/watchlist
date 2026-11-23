import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { WatchlistData } from "../src/domain/types.js";
import { SaveQueue, combineMessages, type SaveEntry } from "../src/data/save-queue.js";

type T = { add: number };
type Entry = SaveEntry<T>;

interface Deferred { entries: readonly Entry[]; resolve(data: WatchlistData): void; reject(error: unknown): void }

const data = (version: number): WatchlistData => ({ version, types: [], items: [] });
const entry = (add: number, login = "me", token = "tok"): Entry => ({ op: { add }, message: `m${add}`, token, login });
const flushMicrotasks = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function setup(initialLogin = "me") {
  const calls = {
    saves: [] as Deferred[],
    persisted: [] as Entry[][],
    saved: [] as WatchlistData[],
    errors: [] as unknown[],
    changes: 0,
    flushed: 0,
    applied: [] as number[],
  };
  const state = { login: initialLogin };
  const queue = new SaveQueue<T>({
    save: (e) => new Promise<WatchlistData>((resolve, reject) => { calls.saves.push({ entries: [...e], resolve, reject }); }),
    apply(d, e) { calls.applied.push(e.op.add); d.version += e.op.add; },
    persist: (entries) => { calls.persisted.push([...entries]); },
    currentLogin: () => state.login,
    onSaved: (d) => { calls.saved.push(JSON.parse(JSON.stringify(d)) as WatchlistData); },
    onChange: () => { calls.changes++; },
    onFlushed: () => { calls.flushed++; },
    onError: (e) => { calls.errors.push(e); },
  });
  return { queue, calls, state };
}

describe("SaveQueue", () => {
  test("entries queued during an in-flight save go out together in the next save", async () => {
    const { queue, calls } = setup();
    const [a, b, c] = [entry(1), entry(2), entry(3)];
    queue.enqueue(a);
    queue.enqueue(b);
    queue.enqueue(c);
    await flushMicrotasks();
    // The first save started synchronously with only `a`; b and c waited.
    assert.equal(queue.size, 3);
    assert.equal(queue.running, true);
    assert.equal(calls.saves.length, 1);
    assert.deepEqual(calls.saves[0]?.entries, [a]);

    calls.saves[0]?.resolve(data(1));
    await flushMicrotasks();
    assert.equal(queue.size, 2);
    assert.equal(calls.saves.length, 2);
    assert.deepEqual(calls.saves[1]?.entries, [b, c]);

    calls.saves[1]?.resolve(data(6));
    await flushMicrotasks();
    assert.equal(calls.saves.length, 2);
    assert.equal(queue.size, 0);
    assert.equal(queue.running, false);
    assert.equal(queue.hasUnsaved(), false);
    assert.equal(queue.error, null);
    assert.equal(calls.flushed, 1);
  });

  test("a run of entries from another login is a separate save", async () => {
    const { queue, calls } = setup();
    const [a, b, c, d] = [entry(1), entry(2), entry(3, "other"), entry(4, "other")];
    queue.restore([a, b, c, d]);
    await flushMicrotasks();
    assert.deepEqual(calls.saves[0]?.entries, [a, b]);
  });

  test("login boundary: next save stops with an error at the first foreign entry", async () => {
    const { queue, calls, state } = setup();
    const [a, b, c] = [entry(1), entry(2, "other"), entry(3, "other")];
    queue.restore([a, b, c]);
    await flushMicrotasks();
    assert.deepEqual(calls.saves[0]?.entries, [a]);
    calls.saves[0]?.resolve(data(1));
    await flushMicrotasks();
    assert.equal(calls.saves.length, 1);
    assert.ok(queue.error instanceof Error);
    assert.equal(queue.size, 2);
    state.login = "other";
    queue.retry();
    await flushMicrotasks();
    assert.deepEqual(calls.saves[1]?.entries, [b, c]);
  });

  test("onSaved receives saved data with remaining pending ops re-applied", async () => {
    const { queue, calls } = setup();
    queue.enqueue(entry(1));
    queue.enqueue(entry(10));
    queue.enqueue(entry(100));
    await flushMicrotasks();

    calls.saves[0]?.resolve(data(1));
    await flushMicrotasks();
    // Entries 10 and 100 were both sent in the second save: nothing left to re-apply after the first one except them.
    assert.deepEqual(calls.applied, [10, 100]);
    assert.equal(calls.saved[0]?.version, 111);

    calls.saves[1]?.resolve(data(111));
    await flushMicrotasks();
    assert.equal(calls.applied.length, 2);
    assert.equal(calls.saved[1]?.version, 111);
  });

  test("entries enqueued while a combined save is in flight are kept and re-applied", async () => {
    const { queue, calls } = setup();
    queue.enqueue(entry(1));
    await flushMicrotasks();
    queue.enqueue(entry(2));
    queue.enqueue(entry(3));
    calls.saves[0]?.resolve(data(1));
    await flushMicrotasks();
    assert.equal(calls.saves[1]?.entries.length, 2);
    queue.enqueue(entry(4));
    calls.saves[1]?.resolve(data(6));
    await flushMicrotasks();
    assert.deepEqual(calls.saves[2]?.entries.map((e) => e.op.add), [4]);
    assert.equal(calls.applied.at(-1), 4);
  });

  test("persist is called on enqueue, after each save, and with [] when drained", async () => {
    const { queue, calls } = setup();
    const [a, b, c] = [entry(1), entry(2), entry(3)];
    queue.enqueue(a);
    queue.enqueue(b);
    queue.enqueue(c);
    assert.deepEqual(calls.persisted.map((p) => p.length), [1, 2, 3]);
    await flushMicrotasks();

    calls.saves[0]?.resolve(data(1));
    await flushMicrotasks();
    assert.deepEqual(calls.persisted[3], [b, c]);

    calls.saves[1]?.resolve(data(6));
    await flushMicrotasks();
    assert.deepEqual(calls.persisted[4], []);
    assert.equal(calls.persisted.length, 5);
  });

  test("restore appends, persists and flushes; empty restore is a no-op", async () => {
    const { queue, calls } = setup();
    queue.restore([]);
    assert.equal(calls.persisted.length, 0);
    assert.equal(calls.changes, 0);

    const [a, b] = [entry(1), entry(2)];
    queue.restore([a, b]);
    assert.equal(queue.size, 2);
    assert.deepEqual(calls.persisted[0], [a, b]);
    await flushMicrotasks();
    assert.deepEqual(calls.saves[0]?.entries, [a, b]);
    assert.equal(queue.running, true);
  });

  test("wait resolves immediately when empty and after drain otherwise", async () => {
    const { queue, calls } = setup();
    await queue.wait();
    queue.enqueue(entry(1));
    let done = false;
    const w = queue.wait().then(() => { done = true; });
    await flushMicrotasks();
    assert.equal(done, false);
    calls.saves[0]?.resolve(data(1));
    await w;
    assert.equal(done, true);
  });

  test("save failure keeps head, sets error, rejects wait, stops flushing", async () => {
    const { queue, calls } = setup();
    const [a, b] = [entry(1), entry(2)];
    queue.enqueue(a);
    queue.enqueue(b);
    const failure = new Error("boom");
    const w = queue.wait();
    await flushMicrotasks();
    calls.saves[0]?.reject(failure);
    await assert.rejects(w, (e) => e === failure);
    await flushMicrotasks();

    assert.equal(queue.error, failure);
    assert.equal(queue.running, false);
    assert.equal(queue.size, 2);
    assert.equal(calls.saves.length, 1);
    assert.deepEqual(calls.errors, [failure]);
    assert.equal(calls.flushed, 0);
    await assert.rejects(queue.wait(), (e) => e === failure);
  });

  test("failure of a combined save keeps every entry of it queued", async () => {
    const { queue, calls } = setup();
    const [a, b, c] = [entry(1), entry(2), entry(3)];
    queue.enqueue(a);
    await flushMicrotasks();
    queue.enqueue(b);
    queue.enqueue(c);
    calls.saves[0]?.resolve(data(1));
    await flushMicrotasks();
    assert.deepEqual(calls.saves[1]?.entries, [b, c]);
    const failure = new Error("boom");
    calls.saves[1]?.reject(failure);
    await flushMicrotasks();
    assert.equal(queue.size, 2);
    assert.equal(queue.error, failure);
    assert.deepEqual(calls.persisted.at(-1), [b, c]);
    queue.retry();
    await flushMicrotasks();
    assert.deepEqual(calls.saves[2]?.entries, [b, c]);
  });

  test("combineMessages: single keeps message, several get a summary line", () => {
    assert.equal(combineMessages(["x"]), "x");
    assert.equal(combineMessages(["x", "y", "z"]), "3 changes\nx\ny\nz");
  });

  test("after an error enqueue does not flush until retry, then drains", async () => {
    const { queue, calls } = setup();
    const failure = new Error("boom");
    queue.enqueue(entry(1));
    await flushMicrotasks();
    calls.saves[0]?.reject(failure);
    await flushMicrotasks();

    queue.enqueue(entry(2));
    await flushMicrotasks();
    assert.equal(queue.size, 2);
    assert.equal(calls.saves.length, 1);

    queue.retry();
    assert.equal(queue.error, null);
    await flushMicrotasks();
    assert.equal(calls.saves.length, 2);
    assert.deepEqual(calls.saves[1]?.entries.map((e) => e.op.add), [1, 2]);

    const w = queue.wait();
    calls.saves[1]?.resolve(data(3));
    await w;
    assert.equal(queue.size, 0);
    assert.equal(calls.flushed, 1);
    assert.equal(calls.errors.length, 1);
  });

  test("retry is a no-op when running or empty", async () => {
    const { queue, calls } = setup();
    queue.retry();
    assert.equal(calls.changes, 0);
    queue.enqueue(entry(1));
    await flushMicrotasks();
    queue.retry();
    assert.equal(calls.saves.length, 1);
  });

  test("login mismatch stops the flush with an error and keeps the entry", async () => {
    const { queue, calls, state } = setup("other");
    const e = entry(1, "me");
    queue.enqueue(e);
    await flushMicrotasks();
    assert.equal(calls.saves.length, 0);
    assert.ok(queue.error instanceof Error);
    assert.equal(calls.errors.length, 1);
    assert.equal(queue.size, 1);
    assert.equal(queue.running, false);
    assert.equal(calls.flushed, 0);
    await assert.rejects(queue.wait());

    state.login = "me";
    queue.retry();
    await flushMicrotasks();
    assert.deepEqual(calls.saves[0]?.entries, [e]);
  });

  test("login change mid-queue stops before the next entry", async () => {
    const { queue, calls, state } = setup();
    queue.enqueue(entry(1, "me"));
    queue.enqueue(entry(2, "me"));
    await flushMicrotasks();
    state.login = "other";
    calls.saves[0]?.resolve(data(1));
    await flushMicrotasks();
    assert.equal(queue.size, 1);
    assert.equal(calls.saves.length, 1);
    assert.ok(queue.error instanceof Error);
  });

  test("rebind updates tokens only when all entries belong to the login", () => {
    const { queue } = setup("nobody");
    const mine = entry(1, "me", "old");
    const theirs = entry(2, "other", "old");
    queue.enqueue(mine);
    assert.equal(queue.rebind("new", "me"), true);
    assert.equal(mine.token, "new");

    queue.enqueue(theirs);
    assert.equal(queue.rebind("newer", "me"), false);
    assert.equal(mine.token, "new");
    assert.equal(theirs.token, "old");
  });

  test("hasEntriesFromOther", () => {
    const { queue } = setup("nobody");
    assert.equal(queue.hasEntriesFromOther("me"), false);
    queue.enqueue(entry(1, "me"));
    assert.equal(queue.hasEntriesFromOther("me"), false);
    assert.equal(queue.hasEntriesFromOther("other"), true);
    queue.enqueue(entry(2, "other"));
    assert.equal(queue.hasEntriesFromOther("me"), true);
  });
});
