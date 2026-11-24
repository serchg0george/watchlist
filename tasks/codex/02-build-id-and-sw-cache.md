# Codex task 02 — build id in the app, service worker cache named per build

- Branch: `patch_1.0.3` (PR title: `patch 1.0.3: infrastructure hardening`)
- Depends on: `tasks/codex/01` merged into the branch (pull first). Do it before `tasks/codex/03` (both touch `vite.config.ts`).
- Runs in parallel with: `tasks/gemini/*`.
- Files you may touch: `vite.config.ts`, `vitest.config.ts`, `tools/sw-shell.ts`, `src/sw.ts`, `src/build-info.ts` (new), `src/env.d.ts` (new, ambient declarations only), `src/ui/react/SettingsDialog.tsx`, `tests/sw-shell.test.ts`, the cache line in `CLAUDE.md` section 3 and in `CODEX.md` code rules.

## Why

- The site is an installable PWA with a network-first service worker; on a phone it is impossible to tell which build is running.
- `CACHE` in `src/sw.ts` is a hand-bumped constant (`watchlist-v22`). Every deploy installs a new worker (the precache list changes), but under the same cache name, so hashed assets of every old build stay in that cache forever — `activate` only deletes caches with other names. Bumping by hand is also a rule agents forget.

## Do

1. `vite.config.ts`: compute `buildId` = `git rev-parse --short=7 HEAD` (`node:child_process`). If git fails: `"dev"` locally, but throw when `process.env.CI` is set (a CI build must never fall back). Expose `__BUILD_ID__` and `__BUILD_TIME__` (ISO string) through `define`.
2. `src/env.d.ts`: `declare const __BUILD_ID__: string; declare const __BUILD_TIME__: string;`. `src/build-info.ts`: export `BUILD_ID`, `BUILD_TIME` reading those constants. Keep them out of `domain/`, `data/`, `state/`.
3. `vitest.config.ts`: the same `define` with fixed test values (`"test"`, a fixed ISO time) so component tests can render `SettingsDialog`.
4. `src/sw.ts`: `const CACHE = "__CACHE__";` placeholder. `tools/sw-shell.ts`: add `injectCache(swSource, name)` that replaces it and throws if the placeholder is missing, same style as `injectShell`. The Vite plugin injects `watchlist-<buildId>`. The existing `activate` cleanup then deletes the old `watchlist-v22` and every earlier build's cache.
5. `SettingsDialog.tsx`: under the `data-branch-status` line, a muted line `Версия: <id> · <date time in ru-RU, local>` using the existing class and style pattern of that paragraph. No new CSS.
6. Docs: replace the "поднять `CACHE`" instruction in `CLAUDE.md` section 3 and "Bump `CACHE` in `src/sw.ts`…" in `CODEX.md` with one sentence each: the cache name is `watchlist-<commit>` and is set at build time.
7. `tests/sw-shell.test.ts`: cover `injectCache` (replaces, throws without placeholder) and assert `src/sw.ts` keeps both placeholders.

## Acceptance

- [ ] `npm run check && npm test && npm run build` green.
- [ ] `dist/sw.js` contains `watchlist-<current short sha>` and neither `__CACHE__` nor `__SHELL__`.
- [ ] `npx vite preview`: ⚙ shows the version line; DevTools → Application → Cache Storage shows exactly one `watchlist-<sha>` cache after a reload; offline reload still works.
- [ ] Report: before/after cache names, what you checked in the browser.
