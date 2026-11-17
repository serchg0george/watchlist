# Instructions for OpenAI Codex

You are Codex, running on a separate PC. You implement tasks from `tasks/codex/NN-*.md`; Claude (on another machine) writes those tasks and reviews your branch. This file overrides `AGENTS.md` where they differ.

## What overrides AGENTS.md

- Do the work yourself. Ignore the local Qwen and delegation sections (`scripts/qwen.sh`, `scripts/delegate.sh`) — they do not exist for you.
- Never commit to or push `master`. You work only on your task branch.
- Communicate with the user in Russian; code comments, commit messages and the report are in English.

## Setup (once per clone)

```sh
git config --local user.name serchg0george
git config --local user.email serchg0george@users.noreply.github.com
git config --local core.hooksPath .githooks
```

Never use `git config --global`.

## Workflow for a task

1. `git checkout master && git pull --ff-only`. If pull fails, stop and tell the user.
2. Create the branch named in the task header: `git checkout -b codex/NN-<slug>`.
3. Read the whole task file, `README.md` (data schema) and the code it touches before editing.
4. Implement exactly the task scope. Nothing outside it: no refactors, renames, new files or dependencies the task does not ask for.
5. Self-check: `npm run check` and `npm test`; run `python3 -m http.server` and open the site; follow the task's acceptance checklist. Put throwaway test scripts/fixtures outside the repo (or delete them before committing).
6. Register yourself as co-author with the alias matching the model you run on: `scripts/coauthor.sh add codex-astra | codex-sol | codex-terra`. The commit hook adds the `Co-authored-by` trailer.
7. Commit in small logical commits, English messages, imperative mood.
8. Write `tasks/codex/NN-report.md` on the branch: what changed (files, functions), how you verified it, deviations from the task, open questions. Commit it.
9. `git push -u origin codex/NN-<slug>`. Never `--force`, never push other branches.
10. Tell the user in one line that the branch is pushed.

## Code rules

- Strict TypeScript in `src/` (`domain/` is pure logic without DOM, `data/` holds the repository and SaveQueue, `ui/dom.ts`, `main.ts` wires UI), compiled by `tsc` to native ES modules in `js/` (`src/main.ts` → `js/main.js`) and `sw.js` in the repo root (`npm run build`; outputs are gitignored and built in `deploy.yml`). No frameworks, bundlers, runtime dependencies or CDN libraries. Run `npm run check && npm test` before committing; no `any`, narrow `unknown` from JSON/network.
- UI text in Russian; identifiers and comments in English. Follow existing style: the `el()` DOM helper (`src/ui/dom.ts`), `render()` re-rendering.
- Every data change is an `Op` (serializable value, `src/domain/`) passed to `applyAndSave(op)`. The queue is persisted and ops are replayed on fresh server data on conflict, so `applyOp` must find targets by id inside `data`, never capture objects from `state.data`, and be idempotent: safe to apply where the target is already gone.
- Data compatibility is mandatory: never remove or rename existing fields in `data/movies.json`; new fields are optional and `normalize()` must keep unknown fields (it spreads the original item first).
- Do not edit `data/movies.json` — it is live data written by the site. Use a local fixture outside the repo for testing.
- When the list of shell files changes, or app logic/CSS changes, bump `CACHE` in `src/sw.ts`. Only `js/main.js` is precached; other modules are cached on first fetch.
- Desktop (Mac/Windows browser) is the primary screen; mobile must still work (single column, no horizontal scroll).
