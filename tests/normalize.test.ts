import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalize } from "../src/domain/normalize.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("normalize", () => {
  test("legacy rating moves to ratings.S", () => {
    const data = normalize({ items: [{ id: "a", title: "T", rating: 7 }] });
    assert.deepEqual(data.items[0]?.ratings, { S: 7, L: null });
  });

  test("unknown fields are preserved on the document and on items", () => {
    const data = normalize({ future: { x: 1 }, items: [{ id: "a", title: "T", custom: [1, 2] }] });
    assert.deepEqual((data as unknown as Record<string, unknown>).future, { x: 1 });
    assert.deepEqual((data.items[0] as unknown as Record<string, unknown>).custom, [1, 2]);
  });

  test("legacy single-string reactions become arrays", () => {
    const data = normalize({ items: [{ id: "a", title: "T", reactions: { S: { L: "heart" } } }] });
    assert.deepEqual(data.items[0]?.reactions, { S: { L: ["heart"] } });
  });

  test("invalid reaction kinds and people are dropped", () => {
    const data = normalize({ items: [{ id: "a", title: "T", reactions: { S: { L: ["nope"], X: ["like"] } } }] });
    assert.deepEqual(data.items[0]?.reactions, {});
  });

  test("invalid ratings are dropped", () => {
    const data = normalize({ items: [
      { id: "a", title: "T", ratings: { S: 0, L: 5.5 } },
      { id: "b", title: "U", ratings: { S: 11, L: 10 } },
      { id: "c", title: "V", ratings: { S: 0.3, L: 10.5 } },
      { id: "d", title: "W", ratings: { S: 0.5, L: 7.5 } }
    ] });
    assert.deepEqual(data.items[0]?.ratings, { S: null, L: 5.5 });
    assert.deepEqual(data.items[1]?.ratings, { S: null, L: 10 });
    assert.deepEqual(data.items[2]?.ratings, { S: null, L: null });
    assert.deepEqual(data.items[3]?.ratings, { S: 0.5, L: 7.5 });
  });

  test("defaults for a bare item and missing types", () => {
    const data = normalize({ items: [{}] });
    const first = data.items[0];
    assert.equal(first?.status, "planned");
    assert.equal(first?.type, "movie");
    assert.equal(data.version, 1);
    assert.ok(data.types.length > 0);
  });

  test("is idempotent", () => {
    const raw = {
      items: [{
        id: "a", title: "T", rating: 4, status: "bogus", genres: ["Драма", "драма", " "],
        replies: [{ id: "r", to: "S", by: "L", text: " hi ", at: "x" }, { id: "bad" }],
        reactions: { S: { L: "fire" } }
      }]
    };
    const once = JSON.stringify(normalize(clone(raw)));
    const twice = JSON.stringify(normalize(JSON.parse(once) as unknown));
    assert.equal(twice, once);
  });
});
