# Task 02 — Replies and reactions

Implemented on `codex/02-replies-reactions`, based on master `e804e13`.
Implementation: GPT-6.1 Sol with high reasoning effort; parent Codex session reviewed the diff and verified the browser behavior.

## Changes

- `app.js`: added `normalizeReplies`, `normalizeReactions`, reply CRUD operations, reaction toggling, and `buildComments` with inline editors, action rows, local dates, deleted-root placeholders, and reply search. Operations resolve fresh targets by id, capture their actor/timestamps, and tolerate missing targets. `closeEditors` keeps item/root/reply editors mutually exclusive. Rendering caps indentation at three levels and safely handles orphaned replies and malformed cyclic threads.
- `style.css`: added compact reaction pills, participant colors, wrapping action rows, and capped reply indentation for both themes and mobile widths.
- `sw.js`: advanced the shell cache from `watchlist-v4` to `watchlist-v5`.
- `README.md`: documented replies/reactions and their optional stored fields in Russian.
- `data/movies.json` was not modified. No dependencies or production files outside the requested scope were added.

## Verification

`node --check app.js`, `node --check sw.js`, and `git diff --check` passed. A disposable Node VM/DOM fixture suite outside the repository passed 17 checks. The site was served with `python -m http.server`; a separate disposable local fixture server simulated GitHub reads/writes without credentials or external API calls.

Acceptance results:

1. PASS: the actual data file loads in the browser; the fixture suite verifies unchanged ratings/comments after normalization and replayed saves. Items without discussion content retain their existing presentation; non-empty root comments gain the requested controls.
2. PASS: old records without new fields normalize; unknown item/reply fields survive. Malformed replies/reactions are filtered without dropping orphaned replies.
3. PASS: root and nested reply operations tested. Five nested levels rendered in the browser; measured left positions at 360 px were 36, 48, 60, 60, 60 px. Orphans follow both root threads. Cycle/duplicate-id fixtures terminate without losing reply text.
4. PASS: browser checks covered reaction removal, addition, replacement, active state, and disabled own-comment controls for S and L. Guest controls were all disabled with no editing actions. Node fixtures verify counts, replay behavior, ownership, and preservation of the other participant's reaction.
5. PASS at operation level: deleting an owned reply reparents direct children using its current parent, preserves grandchildren, and removes target reactions. Other-author and vanished-target cases are covered. Native browser confirmation could not be completed through this browser automation backend (see limitation below).
6. PASS: clearing S's root comment in the browser displayed the deleted-comment placeholder and retained all six fixture replies; Node tests verify reaction cleanup and preservation on non-empty edits.
7. PASS: browser search found the fixture item by text occurring only in an orphan reply.
8. PASS: syntax checks and browser console checks reported no application errors. Screenshots were inspected at 1440 px and 360 px in light and dark themes, with no horizontal document overflow. Browser checks also covered adding an answer with Ctrl+Enter and editing it with the edited marker. Node fixtures covered Ctrl/Cmd+Enter, Escape, empty cancellation, and editor exclusivity.

## Limitations and deviations

- The in-app browser automation timed out on the native `confirm` dialog for reply deletion and did not expose it through its dialog API. Verification continued in a fresh tab. The confirmation call and delete/reparent behavior were verified with controlled Node fixtures, but a manual native-dialog click-through remains useful during review.
- Browser themes were forced only by the disposable fixture server's CSS response. Production theme rules were not altered for testing.
- No live GitHub write was made during testing; save behavior was exercised against the local mock. Test scripts and fixtures remain outside the repository.
- No implementation scope deviations or open product questions. Task 04 has not been started because its instructions require task 02 to be merged into master first.
