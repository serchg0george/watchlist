# 02 — Replies and reactions on comments

- Branch: `codex/02-replies-reactions`
- Recommended model: GPT-6.1 Sol, reasoning effort high
- Files: `app.js`, `style.css`, `sw.js`, `README.md`
- Read first: `CODEX.md`, `README.md` (data schema), `app.js` functions `normalize`, `normalizeComments`, `applyAndSave`, `setComment`, `buildItemRow` (the comments block), `renderList` (search filter).

## Goal

Two viewers, S and L, can already leave one root comment each per item (`item.comments.S`, `item.comments.L`). Add:
1. Threaded replies to root comments and to other replies.
2. Reactions on any comment or reply: 👍 like, ❤️ heart, 👎 dislike.

Existing data must stay intact: `ratings` and `comments` are not changed in shape or meaning.

## Data model (per item, both optional in stored JSON)

```json
"replies": [
  { "id": "uuid", "to": "S", "by": "L", "text": "Согласна", "at": "2026-11-16T18:20:00.000Z" },
  { "id": "uuid2", "to": "uuid", "by": "S", "text": "…", "at": "…", "editedAt": "…" }
],
"reactions": {
  "S":    { "L": "heart" },
  "uuid": { "S": "like" }
}
```

- `replies[].to`: `"S"` / `"L"` = reply to that person's root comment; otherwise the `id` of another reply of the same item.
- `replies[].by`: `"S"` or `"L"` (from `state.person`). `at` / `editedAt`: ISO strings from `new Date().toISOString()`. `id`: `crypto.randomUUID()`.
- `reactions` key: the target — `"S"` / `"L"` for root comments, a reply `id` for replies. Value: map person → kind, kind ∈ `"like" | "heart" | "dislike"`. One reaction per person per target.

## normalize()

- Keep the existing spread (`...it`) so unknown fields survive.
- Add `normalizeReplies(it)`: array of valid replies only (string `id`, `by` ∈ PEOPLE, non-empty trimmed `text`, string `to`, string `at`; keep `editedAt` if string). Drop invalid entries. Never drop a reply just because its parent is missing: at render time a reply whose `to` matches neither a root (`"S"`/`"L"`) nor an existing reply id is shown at depth 1 after both root threads.
- Add `normalizeReactions(it)`: keep only object entries whose persons ∈ PEOPLE and kinds are valid; drop empty maps.
- Normalized items always have `replies` (array, may be empty) and `reactions` (object, may be empty).

## Behaviour

Rendering (in the existing comments block of `buildItemRow`):
- Root comment line as today. If a root comment is empty but has replies, render a muted placeholder line «Комментарий удалён» with the person tag, and its replies under it.
- Replies are rendered under their target, sorted by `at` ascending, indented per level (left border/indent). Visual indent caps at depth 3; deeper replies render at depth 3.
- Each reply line: person tag (S/L colors as roots), text, small muted relative-free date (`DD.MM` + `HH:MM` local), «(изм.)» if `editedAt`.
- Under every non-empty root comment and every reply: an actions row with
  - three reaction buttons 👍 ❤️ 👎, each showing its count (0–2) when > 0; my current reaction highlighted (`aria-pressed="true"`);
  - «Ответить» (only when logged in, i.e. `canEdit`);
  - «Изменить» / «Удалить» on my own replies only.
- Reactions: allowed only when logged in and not on my own comment/reply (buttons disabled with title «Нельзя реагировать на свой комментарий»; counts still visible). Clicking my active kind removes it; clicking another kind replaces it. Logged-out viewers see counts, buttons disabled.
- Reply/edit editor: inline textarea under the target, same UX as the root comment editor (Ctrl/Cmd+Enter save, Esc cancel, «Сохранить» / «Отмена», autofocus). Empty text on save = cancel. Only one editor open at a time (reuse the pattern of `state.commentingId`: add `state.replyDraft = { itemId, to } | null` and `state.editingReplyId`).
- Delete my reply: confirm via `confirm("Удалить ответ?")`; remove it; its direct children are re-parented to the deleted reply's `to`; remove `reactions[replyId]`.
- Clearing a root comment (existing `setComment` with empty text): keep its replies (they show under «Комментарий удалён»); remove `reactions["S"|"L"]` for that root. Editing a root comment's text keeps its reactions.
- Search in `renderList` also matches reply texts.

Saving — every change via `applyAndSave(op, message)`; ops find the item and reply by id in `data`, are no-ops if the target vanished, and set `it.updatedBy = state.login`. Generate ids/timestamps before building the op. Commit messages:
- `Reply to S comment on "<title>" as L` / `Reply to reply on "<title>" as S`
- `Edit reply on "<title>"`, `Delete reply on "<title>"`
- `React heart to L comment on "<title>" as S`, `Remove reaction on "<title>"`

## Styling

- Compact actions row (font-size ~12–13px, muted), reaction buttons as small pills; active pill uses the reacting person's color (`--s`/`--l`, bg `--s-bg`/`--l-bg`).
- Indented replies with a thin left border in `--border`; reuse `.comment-line`, `.person-tag`, `.person-s` / `.person-l` classes where possible.
- Works in light and dark theme; no horizontal scroll at 360px.

## Also

- `sw.js`: bump `CACHE` to the next version.
- `README.md` (Russian): add `replies` and `reactions` rows to the schema table and a short bullet in «Удобства» about replies and reactions.

## Acceptance checklist (verify and list results in the report)

1. Existing `data/movies.json` loads; nothing visible changes for items without replies/reactions; `ratings` and `comments` untouched after a save.
2. Old data without `replies`/`reactions` and data with unknown extra fields both normalize without loss (test `normalize()` in node or the browser console with a local fixture).
3. Reply to a root, reply to a reply, 4 levels deep renders capped at depth 3.
4. Reactions: toggle, replace, cannot react to own, counts correct for both people.
5. Delete a reply with children: children stay, re-parented; its reactions removed.
6. Clear a root comment that has replies: placeholder shown, replies kept.
7. Search finds text inside replies.
8. No console errors; `node --check app.js sw.js` passes; layout fine at 1440px and 360px, light and dark.
