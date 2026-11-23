import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyOp, describeOp, isOp } from "../src/domain/ops.js";
import type { ItemFields, Op } from "../src/domain/ops.js";
import { normalize } from "../src/domain/normalize.js";
import type { Item, WatchlistData } from "../src/domain/types.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function makeData(): WatchlistData {
  return normalize({
    items: [
      {
        id: "dune", title: "Dune", type: "movie", status: "planned",
        comments: { S: "great", L: "" },
        replies: [
          { id: "r1", to: "S", by: "L", text: "agree", at: "2026-01-01" },
          { id: "r2", to: "r1", by: "S", text: "thanks", at: "2026-01-02" },
          { id: "r3", to: "r2", by: "L", text: "np", at: "2026-01-03" }
        ],
        reactions: { S: { L: ["like"] }, r1: { S: ["fire"] }, r2: { L: ["heart"] } }
      },
      { id: "other", title: "Other", type: "series", tmdb: { id: 5, mediaType: "tv", originalTitle: "O", year: 2020, overview: "", posterPath: null, runtime: null } }
    ]
  });
}

function item(data: WatchlistData, id: string): Item {
  const found = data.items.find((x) => x.id === id);
  if (!found) throw new Error(`item ${id} missing`);
  return found;
}

function applyTwice(op: Op, login = "bob"): { once: WatchlistData; twice: WatchlistData } {
  const once = makeData();
  applyOp(once, op, login);
  const twice = clone(once);
  applyOp(twice, op, login);
  return { once, twice };
}

const fields: ItemFields = { title: "Dune 2", type: "series", status: "watching", note: "n", genres: ["Drama", "drama", " Sci-Fi "] };

describe("applyOp", () => {
  test("addItem puts the item first and copies it", () => {
    const data = makeData();
    const added = normalize({ items: [{ id: "new", title: "New" }] }).items[0] as Item;
    applyOp(data, { kind: "addItem", item: added }, "bob");
    assert.equal(data.items[0]?.id, "new");
    assert.ok(data.items[0] !== added);
    assert.equal(data.items.length, 3);
  });

  test("addItem skips duplicate id and duplicate tmdb id+mediaType", () => {
    const data = makeData();
    const sameId = normalize({ items: [{ id: "dune", title: "Dup" }] }).items[0] as Item;
    applyOp(data, { kind: "addItem", item: sameId }, "bob");
    const tmdb = { id: 5, mediaType: "tv" as const, originalTitle: "O", year: null, overview: "", posterPath: null, runtime: null };
    const sameTmdb = normalize({ items: [{ id: "x", title: "X", tmdb }] }).items[0] as Item;
    applyOp(data, { kind: "addItem", item: sameTmdb }, "bob");
    assert.equal(data.items.length, 2);
    const otherMedia = normalize({ items: [{ id: "y", title: "Y", tmdb: { ...tmdb, mediaType: "movie" } }] }).items[0] as Item;
    applyOp(data, { kind: "addItem", item: otherMedia }, "bob");
    assert.equal(data.items.length, 3);
  });

  test("addItem is idempotent", () => {
    const added = normalize({ items: [{ id: "new", title: "New" }] }).items[0] as Item;
    const { once, twice } = applyTwice({ kind: "addItem", item: added });
    assert.deepEqual(twice, once);
  });

  test("restoreItem replaces an existing item or inserts at a clamped index", () => {
    const data = makeData();
    const restored = { ...clone(item(data, "dune")), title: "Restored" };
    applyOp(data, { kind: "restoreItem", item: restored, index: 1 }, "bob");
    assert.equal(item(data, "dune").title, "Restored");
    assert.equal(data.items.length, 2);
    const gone = normalize({ items: [{ id: "gone", title: "Gone" }] }).items[0] as Item;
    applyOp(data, { kind: "restoreItem", item: gone, index: 99 }, "bob");
    assert.equal(data.items[2]?.id, "gone");
    const first = normalize({ items: [{ id: "first", title: "First" }] }).items[0] as Item;
    applyOp(data, { kind: "restoreItem", item: first, index: -3 }, "bob");
    assert.equal(data.items[0]?.id, "first");
    const again = clone(data);
    applyOp(again, { kind: "restoreItem", item: first, index: -3 }, "bob");
    assert.deepEqual(again, data);
  });

  test("markWatched sets status, date and updatedBy; idempotent", () => {
    const op: Op = { kind: "markWatched", itemId: "dune", date: "2026-05-05" };
    const { once, twice } = applyTwice(op);
    const it = item(once, "dune");
    assert.equal(it.status, "watched");
    assert.equal(it.watchedAt, "2026-05-05");
    assert.equal(it.updatedBy, "bob");
    assert.deepEqual(twice, once);
  });

  test("unmarkWatched resets status and dates", () => {
    const data = makeData();
    applyOp(data, { kind: "markWatched", itemId: "dune", date: "2026-05-05" }, "a");
    item(data, "dune").droppedAt = "2026-06-01";
    const op: Op = { kind: "unmarkWatched", itemId: "dune" };
    applyOp(data, op, "bob");
    const it = item(data, "dune");
    assert.equal(it.status, "planned");
    assert.equal(it.watchedAt, null);
    assert.equal(it.droppedAt, null);
    assert.equal(it.updatedBy, "bob");
    const again = clone(data);
    applyOp(again, op, "bob");
    assert.deepEqual(again, data);
  });

  test("rate sets and clears a rating for one person", () => {
    const { once, twice } = applyTwice({ kind: "rate", itemId: "dune", person: "S", rating: 8 });
    assert.deepEqual(item(once, "dune").ratings, { S: 8, L: null });
    assert.equal(item(once, "dune").updatedBy, "bob");
    assert.deepEqual(twice, once);
    applyOp(once, { kind: "rate", itemId: "dune", person: "S", rating: null }, "carol");
    assert.deepEqual(item(once, "dune").ratings, { S: null, L: null });
    assert.equal(item(once, "dune").updatedBy, "carol");
  });

  test("setComment sets text and keeps reactions when text is non-empty", () => {
    const { once, twice } = applyTwice({ kind: "setComment", itemId: "dune", person: "S", text: "updated" });
    assert.equal(item(once, "dune").comments.S, "updated");
    assert.deepEqual(item(once, "dune").reactions.S, { L: ["like"] });
    assert.equal(item(once, "dune").updatedBy, "bob");
    assert.deepEqual(twice, once);
  });

  test("setComment with empty text drops reactions on that comment only", () => {
    const { once, twice } = applyTwice({ kind: "setComment", itemId: "dune", person: "S", text: "" });
    const it = item(once, "dune");
    assert.equal(it.comments.S, "");
    assert.equal("S" in it.reactions, false);
    assert.ok(it.reactions.r1);
    assert.deepEqual(twice, once);
  });

  test("addReply appends a copy, ignores duplicates and missing parents", () => {
    const reply = { id: "r9", to: "r3", by: "S" as const, text: "hi", at: "2026-02-01" };
    const { once, twice } = applyTwice({ kind: "addReply", itemId: "dune", reply });
    assert.equal(item(once, "dune").replies.length, 4);
    assert.equal(item(once, "dune").replies[3]?.id, "r9");
    assert.ok(item(once, "dune").replies[3] !== reply);
    assert.equal(item(once, "dune").updatedBy, "bob");
    assert.deepEqual(twice, once);
  });

  test("addReply to a missing comment is ignored", () => {
    const data = makeData();
    const before = clone(data);
    applyOp(data, { kind: "addReply", itemId: "dune", reply: { id: "r9", to: "L", by: "S", text: "x", at: "t" } }, "bob");
    applyOp(data, { kind: "addReply", itemId: "dune", reply: { id: "r9", to: "nope", by: "S", text: "x", at: "t" } }, "bob");
    assert.deepEqual(data, before);
  });

  test("editReply changes text only for the author", () => {
    const op: Op = { kind: "editReply", itemId: "dune", replyId: "r1", by: "L", text: "edited", editedAt: "2026-03-03" };
    const { once, twice } = applyTwice(op);
    const reply = item(once, "dune").replies.find((r) => r.id === "r1");
    assert.equal(reply?.text, "edited");
    assert.equal(reply?.editedAt, "2026-03-03");
    assert.equal(item(once, "dune").updatedBy, "bob");
    assert.deepEqual(twice, once);
    const data = makeData();
    const before = clone(data);
    applyOp(data, { ...op, by: "S" }, "bob");
    assert.deepEqual(data, before);
  });

  test("deleteReply re-parents children and drops reactions of the reply", () => {
    const op: Op = { kind: "deleteReply", itemId: "dune", replyId: "r2", by: "S" };
    const { once, twice } = applyTwice(op);
    const it = item(once, "dune");
    assert.deepEqual(it.replies.map((r) => r.id), ["r1", "r3"]);
    assert.equal(it.replies.find((r) => r.id === "r3")?.to, "r1");
    assert.equal("r2" in it.reactions, false);
    assert.ok(it.reactions.r1);
    assert.equal(it.updatedBy, "bob");
    assert.deepEqual(twice, once);
  });

  test("deleteReply by a non-author is ignored", () => {
    const data = makeData();
    const before = clone(data);
    applyOp(data, { kind: "deleteReply", itemId: "dune", replyId: "r2", by: "L" }, "bob");
    assert.deepEqual(data, before);
  });

  test("react adds, merges and removes reactions in canonical order", () => {
    const data = makeData();
    applyOp(data, { kind: "react", itemId: "dune", target: "S", by: "L", reaction: "fire", add: true }, "bob");
    assert.deepEqual(item(data, "dune").reactions.S, { L: ["like", "fire"] });
    assert.equal(item(data, "dune").updatedBy, "bob");
    const op: Op = { kind: "react", itemId: "dune", target: "S", by: "L", reaction: "like", add: false };
    applyOp(data, op, "bob");
    assert.deepEqual(item(data, "dune").reactions.S, { L: ["fire"] });
    applyOp(data, { kind: "react", itemId: "dune", target: "S", by: "L", reaction: "fire", add: false }, "bob");
    assert.equal("S" in item(data, "dune").reactions, false);
  });

  test("react is idempotent for add and remove", () => {
    const add: Op = { kind: "react", itemId: "dune", target: "r2", by: "S", reaction: "eyes", add: true };
    const a = applyTwice(add);
    assert.deepEqual(a.twice, a.once);
    const remove: Op = { kind: "react", itemId: "dune", target: "r2", by: "S", reaction: "eyes", add: false };
    const r = applyTwice(remove);
    assert.deepEqual(r.twice, r.once);
  });

  test("react on own comment or reply, or on a missing target, is ignored", () => {
    const data = makeData();
    const before = clone(data);
    applyOp(data, { kind: "react", itemId: "dune", target: "S", by: "S", reaction: "like", add: true }, "bob");
    applyOp(data, { kind: "react", itemId: "dune", target: "r1", by: "L", reaction: "like", add: true }, "bob");
    applyOp(data, { kind: "react", itemId: "dune", target: "L", by: "S", reaction: "like", add: true }, "bob");
    applyOp(data, { kind: "react", itemId: "dune", target: "nope", by: "S", reaction: "like", add: true }, "bob");
    assert.deepEqual(data, before);
  });

  test("editItem updates fields, normalizes genres and sets a date", () => {
    const op: Op = { kind: "editItem", itemId: "dune", fields, date: { field: "watchedAt", value: "2026-04-04" } };
    const { once, twice } = applyTwice(op);
    const it = item(once, "dune");
    assert.equal(it.title, "Dune 2");
    assert.equal(it.type, "series");
    assert.equal(it.status, "watching");
    assert.equal(it.note, "n");
    assert.deepEqual(it.genres, ["Drama", "Sci-Fi"]);
    assert.equal(it.watchedAt, "2026-04-04");
    assert.equal(it.droppedAt, null);
    assert.equal(it.updatedBy, "bob");
    assert.deepEqual(twice, once);
  });

  test("editItem with date null leaves dates untouched", () => {
    const data = makeData();
    item(data, "dune").watchedAt = "2026-01-01";
    item(data, "dune").droppedAt = "2026-02-02";
    applyOp(data, { kind: "editItem", itemId: "dune", fields, date: null }, "bob");
    assert.equal(item(data, "dune").watchedAt, "2026-01-01");
    assert.equal(item(data, "dune").droppedAt, "2026-02-02");
  });

  test("setStatus sets each status with its date rules", () => {
    let data = makeData();
    item(data, "dune").watchedAt = "2026-01-01";
    item(data, "dune").droppedAt = "2026-02-02";
    applyOp(data, { kind: "setStatus", itemId: "dune", status: "planned", date: null }, "bob");
    let it = item(data, "dune");
    assert.equal(it.status, "planned");
    assert.equal(it.watchedAt, null);
    assert.equal(it.droppedAt, null);
    assert.equal(it.updatedBy, "bob");

    data = makeData();
    item(data, "dune").watchedAt = "2026-01-01";
    applyOp(data, { kind: "setStatus", itemId: "dune", status: "watching", date: null }, "bob");
    it = item(data, "dune");
    assert.equal(it.status, "watching");
    assert.equal(it.watchedAt, "2026-01-01");

    data = makeData();
    applyOp(data, { kind: "setStatus", itemId: "dune", status: "watched", date: "2026-05-05" }, "bob");
    it = item(data, "dune");
    assert.equal(it.status, "watched");
    assert.equal(it.watchedAt, "2026-05-05");

    data = makeData();
    applyOp(data, { kind: "setStatus", itemId: "dune", status: "dropped", date: "2026-06-06" }, "bob");
    it = item(data, "dune");
    assert.equal(it.status, "dropped");
    assert.equal(it.droppedAt, "2026-06-06");

    // A null date leaves the field untouched.
    data = makeData();
    item(data, "dune").watchedAt = "2026-01-01";
    applyOp(data, { kind: "setStatus", itemId: "dune", status: "watched", date: null }, "bob");
    it = item(data, "dune");
    assert.equal(it.status, "watched");
    assert.equal(it.watchedAt, "2026-01-01");
  });

  test("batch applies every inner op in order", () => {
    const data = makeData();
    applyOp(data, { kind: "batch", ops: [
      { kind: "markWatched", itemId: "dune", date: "2026-05-05" },
      { kind: "rate", itemId: "other", person: "S", rating: 7 },
      { kind: "deleteItem", itemId: "other" }
    ] }, "bob");
    assert.equal(item(data, "dune").status, "watched");
    assert.equal(item(data, "dune").updatedBy, "bob");
    assert.deepEqual(data.items.map((x) => x.id), ["dune"]);
  });

  test("deleteItem removes the item; idempotent", () => {
    const { once, twice } = applyTwice({ kind: "deleteItem", itemId: "dune" });
    assert.deepEqual(once.items.map((x) => x.id), ["other"]);
    assert.deepEqual(twice, once);
  });

  test("addCategory appends once, ignoring an existing key", () => {
    const category = { key: "doc", label: "Doc", color: "#123456" };
    const { once, twice } = applyTwice({ kind: "addCategory", category });
    assert.equal(once.types.filter((t) => t.key === "doc").length, 1);
    assert.deepEqual(twice, once);
    const before = clone(once);
    applyOp(once, { kind: "addCategory", category: { key: "movie", label: "Other", color: "#000000" } }, "bob");
    assert.deepEqual(once, before);
  });

  test("addCategory creates default types when the list is missing", () => {
    const data = makeData();
    delete (data as { types?: unknown }).types;
    applyOp(data, { kind: "addCategory", category: { key: "doc", label: "Doc", color: "#123456" } }, "bob");
    assert.deepEqual(data.types.map((t) => t.key), ["movie", "series", "anime", "show", "doc"]);
  });

  test("setCategoryColor and renameCategory change an existing category", () => {
    const color = applyTwice({ kind: "setCategoryColor", key: "movie", color: "#abcdef" });
    assert.equal(color.once.types.find((t) => t.key === "movie")?.color, "#abcdef");
    assert.deepEqual(color.twice, color.once);
    const rename = applyTwice({ kind: "renameCategory", key: "movie", label: "Кино" });
    assert.equal(rename.once.types.find((t) => t.key === "movie")?.label, "Кино");
    assert.deepEqual(rename.twice, rename.once);
  });

  test("deleteCategory removes the category; idempotent", () => {
    const { once, twice } = applyTwice({ kind: "deleteCategory", key: "movie" });
    assert.equal(once.types.some((t) => t.key === "movie"), false);
    assert.deepEqual(twice, once);
  });

  test("ops on a missing item or category are no-ops", () => {
    const ops: Op[] = [
      { kind: "markWatched", itemId: "zzz", date: "2026-01-01" },
      { kind: "unmarkWatched", itemId: "zzz" },
      { kind: "rate", itemId: "zzz", person: "S", rating: 5 },
      { kind: "setComment", itemId: "zzz", person: "S", text: "x" },
      { kind: "addReply", itemId: "zzz", reply: { id: "q", to: "S", by: "L", text: "x", at: "t" } },
      { kind: "editReply", itemId: "zzz", replyId: "r1", by: "L", text: "x", editedAt: "t" },
      { kind: "editReply", itemId: "dune", replyId: "zzz", by: "L", text: "x", editedAt: "t" },
      { kind: "deleteReply", itemId: "zzz", replyId: "r1", by: "L" },
      { kind: "deleteReply", itemId: "dune", replyId: "zzz", by: "L" },
      { kind: "react", itemId: "zzz", target: "S", by: "L", reaction: "like", add: true },
      { kind: "editItem", itemId: "zzz", fields, date: null },
      { kind: "setStatus", itemId: "zzz", status: "watched", date: null },
      { kind: "deleteItem", itemId: "zzz" },
      { kind: "setCategoryColor", key: "zzz", color: "#fff" },
      { kind: "renameCategory", key: "zzz", label: "x" },
      { kind: "deleteCategory", key: "zzz" }
    ];
    for (const op of ops) {
      const data = makeData();
      const before = clone(data);
      applyOp(data, op, "bob");
      assert.deepEqual(data, before, op.kind);
    }
  });
});

describe("describeOp", () => {
  const data = makeData();
  const d = (op: Op): string => describeOp(op, data);

  test("item ops", () => {
    const added = normalize({ items: [{ id: "n", title: "New" }] }).items[0] as Item;
    assert.equal(d({ kind: "addItem", item: added }), 'Add "New"');
    assert.equal(d({ kind: "restoreItem", item: added, index: 0 }), 'Undo change of "New"');
    assert.equal(d({ kind: "markWatched", itemId: "dune", date: "2026-01-01" }), 'Mark "Dune" watched');
    assert.equal(d({ kind: "unmarkWatched", itemId: "dune" }), 'Edit "Dune"');
    assert.equal(d({ kind: "editItem", itemId: "dune", fields, date: null }), 'Edit "Dune 2"');
    assert.equal(d({ kind: "deleteItem", itemId: "dune" }), 'Delete "Dune"');
    assert.equal(d({ kind: "deleteItem", itemId: "gone" }), 'Delete ""');
  });

  test("rate and comment ops", () => {
    assert.equal(d({ kind: "rate", itemId: "dune", person: "S", rating: 8 }), 'Rate "Dune" S 8/10');
    assert.equal(d({ kind: "rate", itemId: "dune", person: "S", rating: null }), 'Clear S rating of "Dune"');
    assert.equal(d({ kind: "setComment", itemId: "dune", person: "L", text: "hi" }), 'Comment "Dune" as L');
    assert.equal(d({ kind: "setComment", itemId: "dune", person: "L", text: "" }), 'Clear L comment of "Dune"');
  });

  test("reply and reaction ops", () => {
    assert.equal(d({ kind: "addReply", itemId: "dune", reply: { id: "x", to: "S", by: "L", text: "t", at: "a" } }), 'Reply to S comment on "Dune" as L');
    assert.equal(d({ kind: "addReply", itemId: "dune", reply: { id: "x", to: "r1", by: "S", text: "t", at: "a" } }), 'Reply to reply on "Dune" as S');
    assert.equal(d({ kind: "editReply", itemId: "dune", replyId: "r1", by: "L", text: "t", editedAt: "a" }), 'Edit reply on "Dune"');
    assert.equal(d({ kind: "deleteReply", itemId: "dune", replyId: "r1", by: "L" }), 'Delete reply on "Dune"');
    assert.equal(d({ kind: "react", itemId: "dune", target: "S", by: "L", reaction: "fire", add: true }), 'Add fire reaction to S comment on "Dune" as L');
    assert.equal(d({ kind: "react", itemId: "dune", target: "r1", by: "S", reaction: "like", add: false }), 'Remove like reaction from reply on "Dune" as S');
  });

  test("setStatus and batch", () => {
    assert.equal(d({ kind: "setStatus", itemId: "dune", status: "watched", date: null }), 'Set "Dune" status to watched');
    assert.equal(
      d({ kind: "batch", ops: [{ kind: "markWatched", itemId: "dune", date: "2026-01-01" }, { kind: "rate", itemId: "dune", person: "S", rating: 5 }] }),
      "Bulk: 2 changes"
    );
    assert.equal(
      d({ kind: "batch", ops: [{ kind: "deleteItem", itemId: "dune" }, { kind: "deleteItem", itemId: "other" }] }),
      "Bulk deleteItem of 2 items"
    );
  });

  test("category ops use the label when known and the key otherwise", () => {
    assert.equal(d({ kind: "addCategory", category: { key: "doc", label: "Doc", color: "#fff" } }), 'Add category "Doc"');
    assert.equal(d({ kind: "setCategoryColor", key: "movie", color: "#fff" }), 'Change color for category "Фильм"');
    assert.equal(d({ kind: "setCategoryColor", key: "zzz", color: "#fff" }), 'Change color for category "zzz"');
    assert.equal(d({ kind: "renameCategory", key: "movie", label: "Кино" }), 'Rename category to "Кино"');
    assert.equal(d({ kind: "deleteCategory", key: "anime" }), 'Delete category "Аниме"');
  });
});

describe("isOp", () => {
  const kinds = [
    "addItem", "restoreItem", "markWatched", "unmarkWatched", "rate", "setComment", "addReply", "editReply",
    "deleteReply", "react", "editItem", "setStatus", "deleteItem", "addCategory", "setCategoryColor", "renameCategory", "deleteCategory"
  ];

  test("accepts every kind", () => {
    for (const kind of kinds) assert.equal(isOp({ kind }), true, kind);
  });

  test("batch needs a flat list of valid ops", () => {
    assert.equal(isOp({ kind: "batch", ops: [{ kind: "markWatched", itemId: "dune", date: "2026-01-01" }] }), true);
    assert.equal(isOp({ kind: "batch", ops: [] }), true);
    assert.equal(isOp({ kind: "batch" }), false);
    assert.equal(isOp({ kind: "batch", ops: "nope" }), false);
    assert.equal(isOp({ kind: "batch", ops: [{ kind: "nope" }] }), false);
    assert.equal(isOp({ kind: "batch", ops: [{ kind: "batch", ops: [] }] }), false);
  });

  test("rejects junk", () => {
    for (const junk of [null, undefined, 0, 1, "addItem", [], {}, { kind: "nope" }, { kind: 5 }, { kind: null }, { type: "addItem" }]) {
      assert.equal(isOp(junk), false, JSON.stringify(junk));
    }
  });
});

describe("statusAt", () => {
  const at = "2026-11-22T20:15:00.000Z";

  test("markWatched records at; old ops without at still apply", () => {
    const data = makeData();
    applyOp(data, { kind: "markWatched", itemId: "dune", date: "2026-11-22" }, "a");
    assert.equal(item(data, "dune").statusAt, undefined);
    applyOp(data, { kind: "markWatched", itemId: "dune", date: "2026-11-22", at }, "a");
    assert.equal(item(data, "dune").statusAt, at);
  });

  test("setStatus sets statusAt only when the status changes", () => {
    const data = makeData();
    applyOp(data, { kind: "setStatus", itemId: "dune", status: "watched", date: "2026-11-22", at }, "a");
    assert.equal(item(data, "dune").statusAt, at);
    applyOp(data, { kind: "setStatus", itemId: "dune", status: "watched", date: "2026-11-22", at: "2026-11-23T00:00:00.000Z" }, "a");
    assert.equal(item(data, "dune").statusAt, at);
    applyOp(data, { kind: "setStatus", itemId: "dune", status: "dropped", date: "2026-11-23" }, "a");
    assert.equal(item(data, "dune").statusAt, at);
  });

  test("editItem sets statusAt only on a status change", () => {
    const data = makeData();
    const fields: ItemFields = { title: "Dune", type: "movie", status: "planned", note: "", genres: [] };
    applyOp(data, { kind: "editItem", itemId: "dune", fields, date: null, at }, "a");
    assert.equal(item(data, "dune").statusAt, undefined);
    applyOp(data, { kind: "editItem", itemId: "dune", fields: { ...fields, status: "watched" }, date: null, at }, "a");
    assert.equal(item(data, "dune").statusAt, at);
  });
});
