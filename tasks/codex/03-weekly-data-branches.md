# 03 — Weekly data branches, squash into master, deploy via Actions

- Branch: `codex/03-weekly-data-branches` — ALREADY EXISTS on origin (it contains this file). Do `git fetch && git checkout codex/03-weekly-data-branches && git merge --ff-only origin/master` (if ff fails, stop and tell the user); do not create a new branch.
- Recommended model: GPT-6 Astra, reasoning effort high
- Files: `app.js`, `scripts/rollover.sh` (new), `.github/workflows/deploy.yml` (new), `.github/workflows/weekly-rollover.yml` (new), `README.md`, `AGENTS.md` + `CLAUDE.md` (one line each, see below), `sw.js` (CACHE bump)
- Do NOT change repository settings (Pages source, environments, branch protection) — Claude does that after review. Do NOT create `data/*` branches on origin.

## Why

Every rating/comment from the site is a commit on `master` (hundreds of tiny commits). New model: the site writes data to a per-week branch; once a week a workflow squashes that week into ONE commit on `master`. Week branches are kept forever with full history. `master` is never force-pushed or rewritten.

## Model

- Week = Monday 00:00 – Sunday 23:59:59 in `Europe/Sofia` (EET/EEST, DST-aware).
- Week branch name: `data/<monday>_<sunday>`, dates `YYYY-MM-DD`, e.g. `data/2026-11-16_2026-11-22`. Names sort lexicographically = chronologically.
- "Current data branch" = the lexicographically greatest existing `data/*` branch. If none exists: `master` (backward-compatible fallback — the site keeps working before the first rollover).
- Week branches only ever change `data/movies.json`. Code lives on `master` only.

## 1. Client (`app.js`)

- Replace the fixed `BRANCH`/`API_FILE_URL` with a resolved data branch:
  - `resolveDataBranch(token)`: `GET https://api.github.com/repos/${REPO}/git/matching-refs/heads/data/` (auth header if token), pick the greatest ref name, strip `refs/heads/`; none / 404 → `"master"`. Use the existing `fetchTimed` and timeout conventions.
  - Resolve on load (logged-in path) and again at the start of EVERY save attempt inside `performSave` (so a rollover is picked up within one save). Read the file with `contents/${FILE_PATH}?ref=<branch>` and PUT with `branch: <branch>`.
  - On PUT 404/409/422: re-resolve and retry within the existing retry loop (do not add new retry counts beyond the current scheme).
  - Store the resolved branch in `state.dataBranch` for debugging; no UI needed except: in the settings dialog status line, show «Данные: <branch>» in muted text.
- Logged-out viewers keep loading `data/movies.json` from the Pages site (deploy overlays current week data — see 3). No change.
- `op` replay semantics, save queue, drafts, retry button: unchanged.

## 2. Rollover script (`scripts/rollover.sh`) + workflow (`.github/workflows/weekly-rollover.yml`)

Put all logic in a bash script so it can be tested locally against a throwaway repo; the workflow just checks out with full history and runs it. Requirements:

- Inputs/env: `TZ_NAME=Europe/Sofia`, remote `origin`, `DRY_RUN=1` support (print actions, push nothing), `BOOTSTRAP=1` support.
- Compute the current Sofia week `CUR=data/<mon>_<sun>` with `TZ=Europe/Sofia date` (GNU date in Actions; for local macOS tests allow `gdate` if present).
- Let `OLD` = greatest existing `data/*` branch on origin.
- Cases:
  - `BOOTSTRAP=1` and no `data/*` exists: create `CUR` from `origin/master` (no new commit) and push it. Done.
  - `OLD` is missing (and not bootstrap) → exit 0 with a notice (nothing to do).
  - `OLD == CUR` → exit 0 (week not over; makes the workflow idempotent).
  - `OLD < CUR` → roll over:
    1. `H1 = origin/OLD` head. `BASE = merge-base(origin/master, H1)`.
    2. Squash commit on master: new commit on top of `origin/master` whose tree = master's tree with `data/movies.json` replaced by `H1:data/movies.json` (use `git read-tree`/`update-index`/`write-tree`/`commit-tree` or a temp worktree; never touch other files). If the file is identical to master's, still proceed to step 3 but skip the commit.
       - Author/committer: `github-actions[bot] <41898099+github-actions[bot]@users.noreply.github.com>`.
       - Message: `Data <mon> – <sun> (<N> changes)` where N = number of commits in `BASE..H1` touching `data/movies.json`; blank line; body `Squashed from branch data/<mon>_<sun>.`; blank line; `Co-authored-by:` trailers — unique union of (a) authors of those commits and (b) existing `Co-authored-by:` trailers in their messages, excluding the bot. Keep the original name/email strings.
       - Push master with a plain fast-forward push (`git push origin <sha>:refs/heads/master`). If rejected (someone pushed code meanwhile), fetch and redo step 2 on the new master, max 3 attempts, then fail.
    3. Create `CUR` at the new master commit M (data already identical to H1) and push it. From now on clients write to `CUR`.
    4. Late writes: sleep `LATE_WAIT` seconds (default 180), fetch, `H2 = origin/OLD`. If `H2 != H1`, carry the late change into `CUR`: three-way merge of the single file with `git merge-file` (base = `H1:data/movies.json`, ours = `origin/CUR:data/movies.json`, theirs = `H2:data/movies.json`); clean → commit on `CUR` (`Carry late changes from data/<old>`), push (retry on non-ff like above); conflict → leave everything, print the conflict and exit 1 so the run is red. (The late commits also end up in master with next week's squash.)
    5. Never delete or rewrite `OLD`.
  - If `OLD` is several weeks behind (workflow was down), roll straight to `CUR` the same way (one squash commit labelled with OLD's dates).
- The workflow:
  - `on: schedule` — cron `5 21-23 * * 0` and `5 0-3 * * 1` (UTC; GitHub cron can be delayed, the script's idempotency makes extra runs harmless), plus `workflow_dispatch` with boolean inputs `bootstrap` and `dry_run`.
  - `permissions: contents: write, pages: write, id-token: write, actions: write`; `concurrency: { group: rollover, cancel-in-progress: false }`.
  - `actions/checkout@v4` with `fetch-depth: 0`, then `bash scripts/rollover.sh`.
  - Pushes made with `GITHUB_TOKEN` do not trigger other workflows, so after a rollover that pushed anything, call the deploy as a job: `uses: ./.github/workflows/deploy.yml` (reusable workflow, `needs:` the rollover job; pass `secrets: inherit`).

## 3. Deploy (`.github/workflows/deploy.yml`)

- Triggers: `push` to `master` and to `data/**`; `workflow_dispatch`; `workflow_call`.
- `permissions: contents: read, pages: write, id-token: write`; `concurrency: { group: pages, cancel-in-progress: true }`.
- Build job: checkout `master` explicitly (`ref: master`, even when triggered from a data branch), `fetch-depth: 0`; find the greatest `data/*` ref with `git ls-remote --heads origin 'data/*'`; if found, `git show origin/<branch>:data/movies.json > data/movies.json` (fetch that ref first); copy the site into `_site/` excluding `.git`, `.github`, `.githooks`, `scripts`, `tasks`, `design`, `*.md`, `opencode.jsonc`, `.idea`; `actions/upload-pages-artifact@v3` with `path: _site`.
- Deploy job: `environment: github-pages` with `url: ${{ steps.deployment.outputs.page_url }}`, `actions/deploy-pages@v4`.
- Use only official `actions/*` actions.

## 4. Docs

- `README.md` (Russian): new section «Недельные ветки данных» — how it works (week branches, Sunday→Monday squash at ~00:05 Sofia, branches kept, master gets one data commit per week), how to bootstrap (`Actions → Weekly rollover → Run workflow → bootstrap`), dry run, what to do if the run is red (late-change conflict: resolve by hand on the current week branch), and that local `data/movies.json` on master can be up to a week behind the site.
- `AGENTS.md` and `CLAUDE.md`: replace «GitHub Pages публикует `master` из корня.» with «GitHub Pages собирается workflow `deploy.yml`: код из `master`, `data/movies.json` из текущей ветки `data/*`.» (identical edit in both files.)
- `sw.js`: bump `CACHE`.

## Acceptance checklist (report results)

1. Local test of `scripts/rollover.sh` against a throwaway bare repo + clone (outside this repo), with faked dates (env override like `NOW_OVERRIDE=2026-11-23T00:05:00` honoured only when set): bootstrap; same week → no-op; rollover with 5 data commits by 2 authors with Co-authored-by trailers → one master commit with correct N, trailers and only `data/movies.json` changed; master moved meanwhile (non-ff retry); late write without conflict carried into CUR; late write with conflict → exit 1, nothing destroyed; several weeks gap. Paste the resulting `git log --graph --oneline --all` of the test repo into the report.
2. DST: weeks containing the last Sunday of March and October compute correct names.
3. Client: with a mocked GitHub API (no live writes) — resolves greatest `data/*`; falls back to `master` with no data branches; a save during "rollover" (refs change between attempts) lands on the new branch.
4. `actionlint` (if available) or careful YAML review; `node --check app.js sw.js tmdb.js`; `bash -n scripts/rollover.sh`; `shellcheck` if available.
5. Report the exact one-time setup steps Claude must do after merge (Pages source → GitHub Actions, `github-pages` environment deployment branch policy including `data/*`, bootstrap run), in order.
