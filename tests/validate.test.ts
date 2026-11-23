import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateData } from "../src/domain/validate.js";

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "a1",
    title: "Coco",
    type: "movie",
    status: "watched",
    ratings: { S: 8, L: null },
    comments: { S: "nice", L: "" },
    replies: [],
    reactions: {},
    genres: [],
    note: "",
    addedAt: "2026-11-01",
    watchedAt: "2026-11-02",
    droppedAt: null,
    updatedBy: "S",
    ...overrides
  };
}

function doc(...items: Record<string, unknown>[]): Record<string, unknown> {
  return { version: 1, types: [{ key: "movie", label: "Movie", color: "#e05638" }], items };
}

const reply = (overrides: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id: "r1", to: "S", by: "L", text: "agree", at: "2026-11-03T10:00:00.000Z", ...overrides });

function errorsOf(raw: unknown): string[] {
  return validateData(raw).errors;
}

describe("validateData", () => {
  test("a valid minimal document passes", () => {
    assert.deepEqual(validateData(doc(item())), { errors: [], warnings: [] });
    assert.deepEqual(validateData(doc()), { errors: [], warnings: [] });
  });

  test("top level must be an object with an items array", () => {
    assert.equal(errorsOf([]).length, 1);
    assert.equal(errorsOf(null).length, 1);
    assert.equal(errorsOf({ version: 1, items: {} }).length, 1);
  });

  test("missing, empty and duplicate ids", () => {
    assert.ok(errorsOf(doc(item({ id: "" }))).some((e) => e.includes("id is missing")));
    assert.ok(errorsOf(doc(item({ id: undefined }))).some((e) => e.includes("id is missing")));
    const dup = errorsOf(doc(item(), item({ title: "Other" })));
    assert.ok(dup.some((e) => e.includes("duplicate item id") && e.includes('"a1"')));
  });

  test("empty title and bad status", () => {
    assert.ok(errorsOf(doc(item({ title: " " }))).some((e) => e.includes("title is empty")));
    assert.ok(errorsOf(doc(item({ status: "done" }))).some((e) => e.includes("status")));
  });

  test("ratings must be null, absent or a multiple of 0.5 from 0.5 to 10", () => {
    for (const good of [0.5, 7.5, 10]) {
      assert.deepEqual(errorsOf(doc(item({ ratings: { S: good, L: null } }))), [], `rating ${String(good)}`);
    }
    for (const bad of [0, 0.3, 10.5, "7"]) {
      const errors = errorsOf(doc(item({ ratings: { S: bad, L: null } })));
      assert.ok(errors.some((e) => e.includes("ratings.S")), `rating ${String(bad)}`);
    }
    assert.ok(errorsOf(doc(item({ rating: 99 }))).some((e) => e.includes("rating 99")));
  });

  test("dates must be YYYY-MM-DD", () => {
    assert.ok(errorsOf(doc(item({ addedAt: "2026-11-1" }))).some((e) => e.includes("addedAt")));
    assert.ok(errorsOf(doc(item({ watchedAt: "2026-02-30" }))).some((e) => e.includes("watchedAt")));
    assert.ok(errorsOf(doc(item({ droppedAt: "2026-11-01T00:00:00Z" }))).some((e) => e.includes("droppedAt")));
  });

  test("replies need all fields and unique ids", () => {
    assert.deepEqual(errorsOf(doc(item({ replies: [reply()] }))), []);
    for (const field of ["id", "by", "to", "text", "at"]) {
      const errors = errorsOf(doc(item({ replies: [reply({ [field]: undefined })] })));
      assert.ok(errors.some((e) => e.includes(`.${field}`)), field);
    }
    const dup = errorsOf(doc(item({ replies: [reply(), reply({ text: "again" })] })));
    assert.ok(dup.some((e) => e.includes("duplicate reply id")));
  });

  test("unknown reaction kind is an error, legacy string kind is fine", () => {
    assert.deepEqual(errorsOf(doc(item({ reactions: { S: { L: "heart" } } }))), []);
    const errors = errorsOf(doc(item({ reactions: { S: { L: ["heart", "poop"] } } })));
    assert.ok(errors.some((e) => e.includes("unknown kind") && e.includes("poop")));
  });

  test("unknown keys survive normalize, so they are not reported", () => {
    assert.deepEqual(errorsOf({ ...doc(item({ extra: { a: 1 } })), future: true }), []);
  });

  test("warnings are not errors", () => {
    const result = validateData(doc(
      item({ type: "deleted-category" }),
      item({
        id: "a2",
        comments: { S: "", L: "" },
        replies: [reply({ to: "S" })],
        reactions: { S: { L: ["heart"] }, ghost: { S: ["fire"] } }
      })
    ));
    assert.deepEqual(result.errors, []);
    assert.equal(result.warnings.length, 4);
    assert.ok(result.warnings.some((w) => w.includes("type")));
    assert.ok(result.warnings.some((w) => w.includes("reply")));
    assert.ok(result.warnings.some((w) => w.includes('"ghost"')));
  });

  test("reply and reaction targets resolve to non-empty comments and reply ids", () => {
    const result = validateData(doc(item({
      replies: [reply({ id: "r1", to: "S" }), reply({ id: "r2", to: "r1", by: "S" })],
      reactions: { S: { L: ["like"] }, r1: { S: ["fire"] } }
    })));
    assert.deepEqual(result, { errors: [], warnings: [] });
  });
});

describe("validateData statusAt", () => {
  test("valid ISO timestamp passes; invalid values only warn", () => {
    assert.deepEqual(validateData(doc(item({ statusAt: "2026-11-22T20:15:00.000Z" }))), { errors: [], warnings: [] });
    for (const bad of ["yesterday", "2026-11-22", 5]) {
      const res = validateData(doc(item({ statusAt: bad })));
      assert.deepEqual(res.errors, []);
      assert.equal(res.warnings.length, 1);
    }
  });
});
