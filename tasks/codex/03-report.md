# Task 03: weekly data branches

## Handoff to Claude (user requested checkpoint)

Implementation and the local acceptance checks below are complete; work is stopped here at the user's request. No live rollover, bootstrap, Pages deployment or repository-setting changes have been performed.

Remaining work for Claude:

1. Review the combined diff, especially rollover race handling, contributor trailers and reusable workflow permissions/outputs. Run actionlint and shellcheck on a machine where available; neither is installed here.
2. Validate the workflows in GitHub Actions after review. Local fixtures cover Git behavior, but actual Ubuntu artifact staging, Pages environment policy and reusable deployment have not been executed.
3. Merge only after review, then perform the three ordered setup steps below. Start with an optional dry run, run bootstrap, and check both the resulting data branch and public Pages data.
4. Smoke-test authenticated saving to the current week and anonymous viewing after deployment. Do not run the rollover against the real origin merely to repeat local tests.

External test harnesses are intentionally not committed. On this Windows machine: `%TEMP%/watchlist-rollover-03/test_rollover.py`, `test_iana.py`, `fixtures_v5/results.md` and per-case `runs.log`; client tests: `%TEMP%/watchlist-weekly-client-tests.cjs`. The report records the tested scenarios and representative graph so the handoff remains useful on another machine.

Implemented on the existing `codex/03-weekly-data-branches` branch. Updated it with `pull --ff-only`; the task-prescribed `merge --ff-only origin/master` reported already up to date. No repository settings, real data branches, live movies data or master history were modified.

## Changes

- `app.js`: resolve the lexicographically greatest `refs/heads/data/*`, with empty/404 fallback to master. Authenticated load resolves once; every save attempt resolves again and pairs the selected branch with its file SHA and PUT body. PUT404/409/422 and a disappearing file GET404 use the existing three-attempt limit. Anonymous viewers still read the Pages copy. Settings display the selected branch in muted text. Queue, operation replay and drafts retain their existing semantics.
- `scripts/rollover.sh`: Sofia calendar weeks, bootstrap/dry-run, isolated-index data-only commits, preserved weekly branches, bot identity and deduplicated contributor trailers, bounded non-fast-forward retries, and a three-way carry of late writes. The EXIT trap exports whether any push succeeded, including failures after publishing the new week.
- `weekly-rollover.yml`: requested UTC schedules and manual inputs, full master checkout, serialized rollovers, explicit reusable deploy whenever a push occurred. A late conflict remains a failed run while the already-published current branch can still deploy.
- `deploy.yml`: always checkout master code, fetch/overlay the latest data branch, stage only the site and deploy an official Pages artifact. Separate `pages` concurrency avoids cancelling the calling rollover.
- README documents the model, bootstrap/dry-run, conflict recovery and lag of master data; CLAUDE explains the deployment source. `AGENTS.md` is a Git symlink (mode120000) to CLAUDE.md, represented as a pointer file by Windows. Its target text is updated; the symlink is intentionally preserved rather than replaced with a duplicate document.
- Service-worker cache is v10.

## Validation

- Nine mocked client checks passed: greatest ref, empty/404 fallback, optional auth, permission errors, rollover after each retryable PUT status, three-attempt bound, and unchanged anonymous loading.
- Browser fixture with intercepted GitHub requests displayed `data/2026-11-23_2026-11-29` in settings, with no console errors. No live writes were used.
- `node --check` passed for app.js, sw.js and tmdb.js; `bash -n` and `git diff --check` passed.
- actionlint and shellcheck are unavailable in this environment. Two agents carefully reviewed the YAML against GitHub workflow/Pages documentation: triggers, permission inheritance, concurrency, outputs after failure, checkout source, overlay and exclusions. Actual Actions deployment awaits the one-time setup below.

## Rollover fixture results

All required cases passed in throwaway bare repositories and clones outside this project: missing-branch notice, dry-run bootstrap and rollover (no pushes), bootstrap without a commit, same-week no-op, five data commits by two authors with existing coauthor trailers, data-only squash, preserved OLD/worktree/index, concurrent master code with successful retry, exactly three rejected master attempts, clean late carry, conflicting late carry (exit1 without destroying either branch), concurrent current-week write with carry retry, several-week gap, and identical-data skip. GITHUB_OUTPUT reported true after the late conflict and false after exhausted master pushes.

DST checks passed first with an equivalent POSIX rule, then with the actual Europe/Sofia TZif file from a tzdata wheel extracted outside the repository. Git Bash lacks system IANA zoneinfo, so the latter tests used an absolute TZ_NAME path; Actions Ubuntu uses Europe/Sofia normally. UTC boundaries produced:

- March29 20:55Z: `data/2026-03-23_2026-03-29`; March29 21:05Z: `data/2026-03-30_2026-04-05`.
- October25 21:55Z: `data/2026-10-19_2026-10-25`; October25 22:05Z: `data/2026-10-26_2026-11-01`.

The following fixture graph was produced by `git log --graph --oneline --all` against the external bare squash-test repository (not this project's origin):

```text
* 09da893 Data 2026-11-16 – 2026-11-22 (5 changes)
| * 26d17e1 Change 5
| * 5d19a4b Change 4
| * ce340e3 Change 3
| * c06bc57 Change 2
| * 663f4d1 Change 1
|/
* cdd0df7 Initial fixture
```

The squash commit's author and committer are `github-actions[bot] <41898099+github-actions[bot]@users.noreply.github.com>`. Its body contains `Squashed from branch data/2026-11-16_2026-11-22.` and exactly one trailer each for `Alice Original <alice@example.test>`, `Bob Original <bob@example.test>` and `Carol Exact <carol@example.test>`. The data-only diff and unchanged OLD tip were asserted.

## Required one-time setup after review and merge

1. Set **Settings → Pages → Build and deployment → Source → GitHub Actions**.
2. Under **Settings → Environments → github-pages → Deployment branches and tags**, allow `master` and branch pattern `data/*` if selected-branch restrictions are enabled. Do this before the first data-branch deploy.
3. Run **Actions → Weekly rollover → Run workflow**, choose `master`, set `bootstrap=true`, `dry_run=false`. It creates the current week without an extra commit, then invokes Deploy Pages. Verify both jobs succeed and that the site's settings show the new branch. A preliminary `bootstrap=true`, `dry_run=true` run is optional and makes no pushes.

These steps are deliberately left for Claude after review, as the task requires. A conflict in late changes must be resolved manually on the current data branch; a same-week rerun is a no-op. Writes arriving on OLD after the single post-wait snapshot also require manual recovery. No history is deleted to handle either case.

## Delegation

The rollover implementation/tests and independent workflow/client review used GPT-6 Astra with high reasoning, as recommended in the task. The primary agent integrated the client/workflows/docs and performed browser verification. Coauthors identify Astra and the primary Codex agent without guessing its unexposed model variant.
