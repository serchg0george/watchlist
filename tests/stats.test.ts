import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalize } from "../src/domain/normalize.js";
import { computeMonths, computeStats } from "../src/domain/stats.js";

const today = new Date(2026, 10, 17); // 17 Nov 2026, local time

describe("computeMonths", () => {
  test("returns 12 consecutive months ending with the current one", () => {
    const months = computeMonths([], today);
    assert.equal(months.length, 12);
    assert.equal(months[0]?.key, "2025-12");
    assert.equal(months[11]?.key, "2026-11");
    assert.deepEqual(months.map((m) => m.month).slice(0, 2), [11, 0]);
    assert.ok(months.every((m) => m.count === 0 && m.items.length === 0));
  });

  test("buckets only watched items with a date inside the window", () => {
    const { items } = normalize({
      items: [
        { id: "a", title: "A", status: "watched", watchedAt: "2026-11-01" },
        { id: "b", title: "B", status: "watched", watchedAt: "2026-11-30" },
        { id: "c", title: "C", status: "watched", watchedAt: "2025-12-31" },
        { id: "d", title: "D", status: "watched", watchedAt: "2025-11-30" },
        { id: "e", title: "E", status: "planned", watchedAt: "2026-10-10" },
        { id: "f", title: "F", status: "watched" }
      ]
    });
    const months = computeMonths(items, today);
    const byKey = Object.fromEntries(months.map((m) => [m.key, m.items.map((i) => i.id)]));
    assert.deepEqual(byKey["2026-11"], ["a", "b"]);
    assert.deepEqual(byKey["2025-12"], ["c"]);
    assert.equal(months.reduce((sum, m) => sum + m.count, 0), 3);
  });
});

describe("computeStats", () => {
  const data = normalize({
    items: [
      { id: "a", title: "A", type: "movie", status: "watched", watchedAt: "2026-11-10", ratings: { S: 8, L: 8 }, genres: ["Drama"] },
      { id: "b", title: "B", type: "movie", status: "watched", watchedAt: "2026-11-12", ratings: { S: 10, L: 7 }, genres: ["drama", "Comedy"] },
      { id: "c", title: "C", type: "series", status: "watched", watchedAt: "2026-10-01", ratings: { S: 5, L: null } },
      { id: "d", title: "D", type: "series", status: "planned" },
      { id: "e", title: "E", type: "mystery", status: "dropped" }
    ]
  });
  const stats = computeStats(data.items, data.types, today);

  test("counts statuses and categories, keeping unknown categories", () => {
    assert.deepEqual(stats.statuses, { planned: 1, watching: 0, watched: 3, dropped: 1 });
    const movie = stats.categories.find((c) => c.key === "movie");
    assert.equal(movie?.total, 2);
    assert.equal(movie?.watched, 2);
    const mystery = stats.categories.find((c) => c.key === "mystery");
    assert.equal(mystery?.total, 1);
    assert.equal(mystery?.label, "mystery");
    assert.equal(stats.categories.length, data.types.length + 1);
  });

  test("averages and histograms per person", () => {
    assert.deepEqual(stats.values.S, [8, 10, 5]);
    assert.deepEqual(stats.values.L, [8, 7]);
    assert.equal(stats.averages.S, 23 / 3);
    assert.equal(stats.averages.L, 7.5);
    assert.equal(stats.counts.S[8], 1);
    assert.equal(stats.counts.S[10], 1);
    assert.equal(stats.counts.L[7], 1);
    assert.equal(stats.counts.S.length, 11);
  });

  test("averages are null without ratings", () => {
    const empty = computeStats([], data.types, today);
    assert.deepEqual(empty.averages, { S: null, L: null });
    assert.equal(empty.both.length, 0);
  });

  test("agreement counts use only items rated by both", () => {
    assert.deepEqual(stats.both.map((i) => i.id), ["a", "b"]);
    assert.equal(stats.exact, 1);
    assert.equal(stats.close, 1);
    assert.deepEqual(stats.diffs.map((i) => i.id), ["b"]);
    assert.deepEqual(stats.top.map((i) => i.id), ["b", "a"]);
  });

  test("genres are merged case-insensitively, counting watched items only", () => {
    assert.deepEqual(stats.genres.map((g) => [g.label, g.count]), [["Drama", 2], ["Comedy", 1]]);
    const drama = stats.genres[0];
    assert.equal(drama?.people.S.average, 9);
    assert.equal(drama?.paired, 2);
  });

  test("favorite month uses the current month and the best combined rating", () => {
    assert.equal(stats.favoriteMonth.label, "ноябрь 2026");
    assert.equal(stats.favoriteMonth.count, 2);
    assert.deepEqual(stats.favoriteMonth.items.map((i) => i.id), ["b"]);
  });

  test("months match computeMonths", () => {
    assert.deepEqual(stats.months, computeMonths(data.items, today));
    assert.equal(stats.months[11]?.count, 2);
    assert.equal(stats.months[10]?.count, 1);
  });
});
