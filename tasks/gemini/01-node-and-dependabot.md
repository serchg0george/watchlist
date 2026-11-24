# Gemini task 01 — single Node version, Dependabot, current action majors

- Branch: `patch_1.0.3` (PR title: `patch 1.0.3: infrastructure hardening`)
- Depends on: nothing. Do it before `tasks/gemini/02`.
- Runs in parallel with: `tasks/codex/*` (no shared files).
- Files you may touch: `.nvmrc` (new), `package.json` (`engines` only), `.github/dependabot.yml` (new), `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.github/workflows/weekly-rollover.yml`.

## Why

- CI pins `node-version: 22` in three workflows; the owner's machine runs Node 20 (end of life since April 2026). Nothing says which version the project supports.
- No Dependabot: npm packages and GitHub Actions only get updated when someone remembers. The actions are still on `@v4`/`@v3` majors.

## Do

1. Add `.nvmrc` containing the single line `24`.
2. `package.json`: add `"engines": { "node": ">=24" }`. Change nothing else; do not touch dependency versions or the lockfile.
3. In all three workflows replace `node-version: 22` with `node-version-file: .nvmrc` (keep `cache: npm`).
4. Bump every action to its latest major. Find it with `gh release view --repo actions/<name> --json tagName -q .tagName` for `checkout`, `setup-node`, `upload-pages-artifact`, `deploy-pages`. Read each release's breaking changes and record in the report what affects this repo. Known one: newer `upload-pages-artifact` skips hidden files, so `_site/.vite/manifest.json` is no longer published — that is fine, the site does not use it (the service worker list already excludes `.vite/`).
5. Add `.github/dependabot.yml`:
   - `npm`, directory `/`, monthly; group all minor+patch updates into one PR; ignore `typescript` semver-major (TypeScript 7 is a separate decision); `cooldown` 7 days (skip versions published less than a week ago); `open-pull-requests-limit: 3`; commit-message prefix `deps`.
   - `github-actions`, directory `/`, monthly; one group for all actions; commit-message prefix `ci`.
   - Validate the file against the official schema keys (`version: 2`, `updates`, `groups`, `ignore`, `cooldown`); do not invent keys.

## Do not

- Do not change triggers, permissions, jobs or steps beyond the Node version and the `uses:` versions; that is task 02.
- Do not run `npm update` / `npm install <pkg>`.

## Acceptance

- [ ] `grep -rn "node-version:" .github/workflows` prints nothing; `grep -rn "node-version-file: .nvmrc" .github/workflows` shows 3 hits.
- [ ] `npm ci && npm run check && npm test && npm run build && npm run validate-data` green on Node 24 locally (`nvm use` or equivalent).
- [ ] CI on the pushed branch is green (`gh run list --branch patch_1.0.3 -L 3`).
- [ ] Report lists the old → new major of each action and the breaking changes you checked.
