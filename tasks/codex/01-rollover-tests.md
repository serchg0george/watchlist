# Codex task 01 — integration tests for scripts/rollover.sh

- Branch: `patch_1.0.3` (PR title: `patch 1.0.3: infrastructure hardening`)
- Depends on: nothing. Do it before `tasks/codex/02` and `03`.
- Runs in parallel with: `tasks/gemini/*` (no shared files).
- Files you may touch: `tests/rollover.test.ts` (new), `tests/node-shims.d.ts` (extend only), `scripts/rollover.sh` (only to fix a real bug a test exposes — see below).

## Why

`scripts/rollover.sh` is the only code that pushes to `master` (weekly, from `.github/workflows/weekly-rollover.yml`). It squashes last week's data branch into master, three-way merges master-side data edits, forks the new week's branch, and carries late writes. It has no tests at all.

## Do

Write `tests/rollover.test.ts` (node:test; compiled by `tsconfig.test.json` and run by `npm test` like the other tests) that runs the real script against throwaway local repositories.

Harness:
- Every scenario builds its own fixture in `mkdtemp(os.tmpdir())`: a bare `origin.git`, a seed clone that commits `data/movies.json` (plus one unrelated file, e.g. `README.md`) to `master` and pushes the needed `data/*` branches, then a fresh clone in which the script runs (`cwd`). Remove the temp dir in `finally`.
- Isolate git from the machine: for every git call and the script pass `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, and for seed commits `-c user.name=test -c user.email=test@example.invalid -c core.hooksPath=/dev/null`.
- Script env: `TZ_NAME=Europe/Sofia`, `NOW_OVERRIDE` (e.g. `2026-11-30 01:00` → current week `data/2026-11-30_2026-12-06`, old week `data/2026-11-23_2026-11-29`), `LATE_WAIT=0` unless the scenario needs it, `GITHUB_OUTPUT=<temp file>`, `VALIDATOR` set explicitly (`true` / `false` for most scenarios; one happy path with the real validator as an absolute path: `node <repo>/.test-build/tools/validate-data.js`).
- Fixture data must pass `validateData` (read `src/domain/validate.ts`) and be pretty-printed so that edits to different items are far enough apart for `git merge-file` to merge them cleanly.
- The script needs GNU `date -d` (it prefers `gdate` when present). Probe once; if neither works, skip the whole file with a clear reason (macOS without coreutils). CI (`ubuntu-latest`) must run it.
- No network, never touch the real repository's refs.

Scenarios (one test each):
1. No data branches, `BOOTSTRAP=0` → exit 0, nothing pushed, `pushed=false` in `GITHUB_OUTPUT`. With `BOOTSTRAP=1` → current-week branch created at master tip, `pushed=true`.
2. Current week's branch already exists → exit 0, all refs unchanged.
3. Normal rollover: old-week branch has 2 data commits by different authors, one with a `Co-authored-by: X <x@example.invalid>` trailer → master gets exactly one new commit; its tree differs from the old master only in `data/movies.json`, which equals the old branch's blob; the message starts with `Data 2026-11-23 – 2026-11-29 (2 changes)` and lists each author and the trailer once as `Co-authored-by`, never the bot; the new branch points at the new master commit; the old branch is unchanged.
4. Master-side data edit after the week started, different item than the branch edits → master's new data contains both edits.
5. Same line edited on master and on the branch → non-zero exit, no ref on origin changed.
6. `VALIDATOR=false` → non-zero exit, no ref changed.
7. `DRY_RUN=1` → exit 0, no ref changed.
8. Latest data branch is later than the current week → non-zero exit.
9. Late writes: `LATE_WAIT=4`; start the script asynchronously, poll origin until the new branch exists, push a commit to the old branch editing another item, wait for exit 0 → the new branch has one extra commit `Carry late changes from data/2026-11-23_2026-11-29` containing the late edit. If it flakes, raise `LATE_WAIT`; do not add test hooks to the script.

Node APIs: there is no `@types/node`; declare what you use (`node:child_process`, `node:os`, `node:path`, extra `node:fs` functions, `test` options for skipping) in `tests/node-shims.d.ts`, minimally.

## If a test exposes a bug

Fix `scripts/rollover.sh` minimally, keep `shellcheck -S warning scripts/rollover.sh` clean, and describe the bug, the failing scenario and the fix in the report. Do not refactor the script otherwise.

## Acceptance

- [ ] `npm run check && npm test` green; the rollover tests run (not skipped) at least in CI — check the CI log on the branch.
- [ ] The whole file runs in under 30 s.
- [ ] Report: scenarios covered, anything skipped and why, bugs found.
