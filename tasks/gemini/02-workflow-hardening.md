# Gemini task 02 — workflow hardening, data health check, guard tests

- Branch: `patch_1.0.3` (PR title: `patch 1.0.3: infrastructure hardening`)
- Depends on: `tasks/gemini/01` (same workflow files) — pull it first.
- Runs in parallel with: `tasks/codex/*` (no shared files).
- Files you may touch: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.github/workflows/weekly-rollover.yml`, `.github/workflows/data-health.yml` (new), `scripts/latest-data-branch.sh` (new), `tests/workflows.test.ts` (new), `tests/node-shims.d.ts` (extend only), `scripts/coauthor.sh` and `scripts/delegate.sh` (shellcheck fixes only). Never edit `scripts/rollover.sh` (Codex covers it with tests in parallel).

## Background you need

- Code lives on `master`; the site writes `data/movies.json` to the latest weekly branch `data/YYYY-MM-DD_YYYY-MM-DD` through the GitHub API. `scripts/rollover.sh` (weekly) squashes last week into `master` and forks the new week's branch **from master**, so each data branch carries the workflow files master had that Monday.
- Push-triggered workflows run from the pushed commit's own files. That is how this week's branch (forked before patch 1.0.2 removed `push: data/**` from `deploy.yml`) still runs **Deploy Pages on every site save** (~90 runs/week). It heals itself at the next rollover; the guard test below keeps it from coming back.
- `deploy.yml` checks out `ref: master` even when triggered by `workflow_run`, so if two PRs merge close together it can deploy a commit whose CI has not finished.

## Do

1. `deploy.yml`, build job checkout: `ref: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || 'master' }}` with a one-line comment why (deploy exactly the commit CI approved; rollover/dispatch use master).
2. `deploy.yml`, deploy job: add a post-deploy smoke step (bash, no checkout) using `steps.deployment.outputs.page_url`, up to 6 attempts 10 s apart (Pages CDN lags): the page returns 200 and contains `<div id="root">`; the first `assets/*.js` referenced in it returns 200; `sw.js` returns 200; `data/movies.json` returns 200 and parses (`jq empty`). Fail the job if any check still fails after the retries.
3. `timeout-minutes` on every job: CI `verify` 15, deploy `build` 15, `deploy` 10, `data-check` 5, rollover `rollover` 15 (it sleeps 180 s on purpose).
4. `ci.yml`: `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: ${{ github.event_name == 'pull_request' }} }` — superseded PR runs are cancelled, master runs never (Deploy Pages waits for them).
5. `ci.yml`: add a step `shellcheck -S warning scripts/*.sh .githooks/*` before `npm ci` (shellcheck is preinstalled on `ubuntu-latest`; verify in the run log). Locally it reports only SC2164 (`cd` without `|| exit`) in `scripts/coauthor.sh:8` and `scripts/delegate.sh:27` — fix those two with `|| exit 1`. `rollover.sh` is already clean; do not touch it.
6. `weekly-rollover.yml`, least privilege: top-level `permissions: contents: read`; job `rollover`: `contents: write`; job `deploy` (the reusable-workflow caller): `contents: read`, `pages: write`, `id-token: write`. Remove `actions: write` and `secrets: inherit` (nothing uses secrets; check with `grep -n secrets .github/workflows/deploy.yml`).
7. `scripts/latest-data-branch.sh`: prints the latest `data/*` branch name on `origin` (the same `git ls-remote --heads origin 'data/*' | … | LC_ALL=C sort | tail -n 1` logic as in `deploy.yml` today), empty output if none; `set -euo pipefail`. Use it from `deploy.yml` instead of the inline pipeline.
8. New `.github/workflows/data-health.yml`: `schedule` daily `17 4 * * *` + `workflow_dispatch`; `permissions: contents: read`; `timeout-minutes: 10`. Steps: checkout master (`fetch-depth: 0`), setup-node from `.nvmrc` with npm cache, `npm ci`, `npx tsc -p tsconfig.test.json`, resolve the branch with `scripts/latest-data-branch.sh`, fetch it and `git show "origin/$branch:data/movies.json" > "$RUNNER_TEMP/live.json"`, run `node .test-build/tools/validate-data.js "$RUNNER_TEMP/live.json"`, then a size check: above 512000 bytes `::warning::`, above 900000 bytes `::error::` and fail — the GitHub Contents API stops returning file content above 1 MB and the site would break. Why this exists: today invalid data written mid-week is only noticed at Monday's rollover.
9. New `tests/workflows.test.ts` (node:test, regex/text checks only — no YAML dependency):
   - no file in `.github/workflows/` has a `push` trigger whose branches mention `data/` (data branches keep old workflow files for a week; a push trigger there runs on every site save);
   - `deploy.yml` checkout uses `github.event.workflow_run.head_sha`;
   - every `runs-on:` job in every workflow has `timeout-minutes`;
   - no workflow uses `node-version:` (only `node-version-file: .nvmrc`).
   You will need `readdirSync(path)` without options in `tests/node-shims.d.ts`; extend the existing declaration minimally.

## Verify the rollover permissions without pushing data

After pushing, run once: `gh workflow run weekly-rollover.yml --ref patch_1.0.3 -f dry_run=true`. `DRY_RUN` pushes nothing. The run must not end in `startup_failure` (that is how a missing permission for the reusable deploy workflow shows up). Put the run URL in the report. Do not run it without `dry_run=true`.

## Acceptance

- [ ] `npm run check && npm test` green locally, including the new test; CI green on the branch.
- [ ] Shellcheck step visible and green in the CI log.
- [ ] Dry-run rollover finished `success`.
- [ ] `gh workflow run data-health.yml --ref patch_1.0.3` finished `success`; its log shows the validated branch and file size.
- [ ] Report lists anything you could not verify (the smoke step only runs on a real deploy after merge — say so).
