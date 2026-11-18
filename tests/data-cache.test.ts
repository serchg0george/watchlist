import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { chooseFallback, makeCache, parseCache } from "../src/data/data-cache.js";
import { normalize } from "../src/domain/normalize.js";

const data = normalize({ items: [{ id: "a", title: "T", rating: 7 }] });
const now = new Date("2026-11-18T10:30:00.000Z");

describe("makeCache / parseCache", () => {
  test("round-trips a cache entry through JSON", () => {
    const raw = JSON.parse(JSON.stringify(makeCache(data, "master", now)));
    assert.deepEqual(parseCache(raw), makeCache(data, "master", now));
  });

  test("keeps a null branch", () => {
    const parsed = parseCache(makeCache(data, null, now));
    assert.equal(parsed?.branch, null);
  });

  test("rejects garbage and missing fields", () => {
    for (const raw of [null, undefined, "x", 42, [], {}, { data }, { data, branch: "master" }, { data, savedAt: now.toISOString() }]) {
      assert.equal(parseCache(raw), null);
    }
  });

  test("rejects invalid field types", () => {
    const good = makeCache(data, "master", now);
    for (const raw of [
      { ...good, savedAt: undefined },
      { ...good, savedAt: "" },
      { ...good, savedAt: 123 },
      { ...good, branch: 7 },
      { ...good, data: "nope" },
      { ...good, data: null }
    ]) {
      assert.equal(parseCache(raw), null);
    }
  });
});

describe("chooseFallback", () => {
  test("returns normalized cache data for a valid cache", () => {
    const fb = chooseFallback(makeCache(data, "master", now));
    assert.deepEqual(fb, { kind: "cache", data, branch: "master", savedAt: now.toISOString() });
  });

  test("normalizes legacy cached data", () => {
    const raw = { data: { items: [{ id: "a", title: "T", rating: 7 }] }, branch: null, savedAt: now.toISOString() };
    const fb = chooseFallback(raw);
    assert.equal(fb.kind, "cache");
    if (fb.kind === "cache") assert.deepEqual(fb.data, data);
  });

  test("returns error for garbage", () => {
    for (const raw of [null, {}, { data, branch: "master", savedAt: "" }, { data: null, branch: "master", savedAt: now.toISOString() }]) {
      assert.deepEqual(chooseFallback(raw), { kind: "error" });
    }
  });
});
