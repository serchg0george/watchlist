# Plan: Rezka-style light theme, half-star ratings, expanded watched cards, stats layout, React

Roles:
- **Dispatcher** — local model on the phone (S26 Ultra). Reads this file, picks the next subtask, sends it to the Mac.
- **Executors** — models on the Mac via `scripts/delegate.sh`; they write the code.
- **Claude** — wrote this plan; does the final review and commit after all subtasks (or a batch) are done.

Each subtask is a block with fixed fields. The `TASK` text is sent to the executor verbatim; the dispatcher must not
rewrite it.

## Dispatcher rules

1. Pick the first subtask in file order whose `status` is `todo` and whose every `depends` id has status `done`.
2. Run it on the Mac with the command from the executor table, passing the subtask's `TASK` text as the task.
   Before switching between `coder` and `27b`, run `scripts/qwen.sh down` (two local models do not fit in 48 GB).
   `acli` runs in the cloud and may run at the same time as a local subtask, if their `files` do not overlap.
3. Shallow checks on the patch, in this order:
   - the patch is not empty;
   - drop changes to files not listed in `files` (`git apply --include=<file>` for each listed file);
   - `git apply` succeeds;
   - `npm run check && npm test` pass.
4. All checks pass → set `status: done`. A check fails → `git checkout -- .` is NOT allowed (other subtasks are in the
   working tree); revert only this patch with `git apply -R <patch>`, rerun once with the `TASK` text plus
   `Previous attempt failed: <first 30 lines of the error>`. Fails again → `status: blocked`, continue with the next
   subtask that does not depend on it.
5. Never commit, never push, never edit `TASK` texts. Keep every patch in `design/patches/<id>.patch` and append one
   line per run to `design/patches/log.txt`: `<id> <executor> <done|retry|blocked> <short reason>`.
6. Stop when no subtask can run. Report: done / blocked ids.

## Executors

| Key | Command | Use for |
|---|---|---|
| `coder` | `QWEN_MODEL=qwen/qwen3-coder-30b scripts/delegate.sh <task-file>` | MoE, fast: exact values, CSS, 1:1 markup ports |
| `27b` | `scripts/delegate.sh <task-file>` (`qwen3.8-27b`) | Dense, slower: logic, tests, state, tooling |
| `acli` | `scripts/delegate.sh <task-file> --acli` (Gemini Flash Low) | Docs, trivial edits; parallel lane |

Claude review effort at the end: `low` — diff + tests; `medium` — diff line by line, edge cases, site opened locally;
`high` — `medium` + browser check (light/dark, 360px and 1440px), a11y, touch targets, deploy/offline.

Global rules (already in every executor run via `delegate.sh`, repeated here for the dispatcher): strict TypeScript in
`src/`, UI text Russian, code and comments English, no new dependencies unless TASK allows them, do not touch
`@media (prefers-color-scheme: dark)` blocks unless TASK says so, never edit `js/`, `dist/`, `sw.js`.

## Summary

| id | Subtask | Executor | Review | Depends | Status |
|---|---|---|---|---|---|
| 1.1 | Light palette, theme-color | coder | low | — | done |
| 1.2 | Highlight + card borders | Claude | medium | 1.1 | done |
| 1.3 | Sweep leftover greens | — | — | — | done (nothing left) |
| 2.1 | Rating guard, normalize, validate, stats domain + tests | 27b | medium | — | done |
| 2.3 | README schema | acli | low | — | done |
| 2.4 | Half-star buttons | 27b | high | 2.1 | done |
| 2.5 | Stats UI formatting | coder | medium | 2.1 | done |
| 3.1 | Collapse state + toggle | coder | medium | 2.4 | done |
| 3.2 | Expanded watched body + CSS | coder | medium | 3.1 | done |
| 4.1 | Scatter next to genres | coder | high | 2.5 | done |
| 5.1 | Vite + React tooling | 27b | high | 3.2, 4.1 | done |
| 5.2 | Deploy from dist | coder | high | 5.1 | done |
| 5.3 | Store hook | 27b | high | 5.1 | done |
| 5.4 | Toast, Stars | coder | medium | 5.3 | done |
| 5.5 | Comments | coder | medium | 5.4 | done |
| 5.6 | ItemRow | 27b | high | 5.5 | done |
| 5.7 | BulkBar, Editor | coder | medium | 5.6 | done |
| 5.8 | List | coder | medium | 5.7 | done |
| 5.9 | Stats part 1 | coder | medium | 5.3 | done |
| 5.10 | Stats part 2 | coder | medium | 5.9 | done |
| 5.11 | Dialogs | coder | medium | 5.3 | done |
| 5.12 | App, remove old rendering | 27b | high | 5.8, 5.10, 5.11 | done |
| 5.13 | SW SHELL from Vite manifest | 27b | high | 5.12 | done |
| 5.14 | Docs | acli | low | 5.13 | done |
| 5.15 | React component tests | 27b | medium | 5.14 | done |

---

## Task 2 — Half-point ratings (0.5 … 10, step 0.5)

### 2.1
- executor: 27b
- depends: —
- files: src/domain/guards.ts, src/domain/normalize.ts, src/domain/validate.ts, src/domain/stats.ts, tests/validate.test.ts, tests/normalize.test.ts, tests/stats.test.ts
- status: in progress (started by Claude)

### 2.4
- executor: 27b
- depends: 2.1
- files: src/ui/list/item-row.ts, src/actions.ts, style.css
- status: todo

TASK:
Half-point ratings in the card UI. A rating is any multiple of 0.5 from 0.5 to 10; `isRating` exists in src/domain/guards.ts.
Edit only src/ui/list/item-row.ts (rating lines, around lines 80-90), src/actions.ts (around line 99) and the `.star` rules in style.css.
1. Keep 10 stars per editable rating line. Each star i (1..10) is one element with a 40px touch target containing two absolutely positioned, transparent `<button type="button">` halves: the left half rates `i - 0.5`, the right half rates `i`. aria-labels in Russian with a comma decimal, e.g. `S: 6,5 из 10` and `S: 7 из 10` (use the person key S or L).
2. Fill state of star i for value v: full when `i <= v`, half when `i - 0.5 === v`, empty otherwise (v null → all empty). Add CSS class `.star.half` with `background: linear-gradient(90deg, var(--star-on) 50%, var(--star-off) 50%); -webkit-background-clip: text; background-clip: text; color: transparent;`. Do not add a new glyph. Read-only rating lines use the same three states.
3. The value label next to the stars shows `v.toLocaleString("ru-RU")` (e.g. `7,5`), or `—` when v is null.
4. src/actions.ts: the rating action receives the half-step value; clicking the current value again still clears the rating (sets null).
5. Run `npm run check && npm test` and fix until both pass.

### 2.5
- executor: coder
- depends: 2.1
- files: src/ui/stats.ts
- status: todo

TASK:
Half-point ratings in the stats UI. Ratings can now be 0.5, 1, 1.5 ... 10. Edit only src/ui/stats.ts.
1. Scatter plot: place points at the exact fractional S/L coordinates; axes and grid stay 1-10. Point labels and the detail head show values with `toLocaleString("ru-RU")` (e.g. `S 7,5`).
2. Histogram aria text becomes `Распределение оценок S и L, округление вниз до целого`. Bucket labels stay integers.
3. Every rating value printed in stats (top, diffs, favorite, badges, genre averages) is formatted with `value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })`.
4. Genre agreement note (around line 229): replace `/ 9` with `/ 9,5` and `разница в 9 баллов — 0%` with `разница в 9,5 балла — 0%`. In the genre scale (around lines 249-254) replace both `/ 9` with `/ 9.5` and `(value - 1)` with `(value - 0.5)`.
5. Run `npm run check && npm test` and fix until both pass.

---

## Task 3 — Watched cards expanded by default, collapsible

### 3.1
- executor: coder
- depends: 2.4
- files: src/state/store.ts, src/ui/list/item-row.ts
- status: todo

TASK:
Watched cards can be collapsed. Edit only src/state/store.ts and src/ui/list/item-row.ts.
1. src/state/store.ts: next to `openComments` / `expandedOverviews` add `export const collapsedCards = new Set<string>();` (session only, never saved).
2. src/ui/list/item-row.ts: `const isWatched = item.status === "watched"; const collapsed = isWatched && collapsedCards.has(item.id);`
3. For watched items only, add at the end of the card header row a `<button type="button" class="link-btn card-toggle">` with `aria-expanded` = `"false"` when collapsed else `"true"`, text `Развернуть` when collapsed else `Свернуть`. Click: add/remove item.id in collapsedCards, then call `render()`.
4. When `collapsed`, do not render the card body: poster/overview, date, ratings, comments toggle and comments. The header (checkbox/select, title, badges, status buttons, the new toggle) stays.
5. Run `npm run check && npm test` and fix until both pass.

### 3.2
- executor: coder
- depends: 3.1
- files: src/ui/list/item-row.ts, style.css
- status: todo

TASK:
Watched cards are fully expanded by default. Edit only src/ui/list/item-row.ts and style.css.
1. In src/ui/list/item-row.ts, when the item is watched (`item.status === "watched"`) and not collapsed: render the TMDB overview without the `clamp` class and without the `Ещё`/`Свернуть` overview toggle button; show the comments section unless `openComments` explicitly holds false for this card (the user hid them). Other statuses keep the current behaviour.
2. style.css: add `.card-toggle { margin-left: auto; min-height: 40px; }` and make it look like the other `.link-btn` buttons (reuse the existing `.link-btn` rules, do not duplicate them).
3. Run `npm run check && npm test` and fix until both pass.

---

## Task 4 — Stats: "S против L" next to "Совпадение по жанрам"

### 4.1
- executor: coder
- depends: 2.5
- files: style.css, src/ui/stats.ts
- status: todo

TASK:
Stats layout: on screens ≥760px the scatter section and the genres section share one row. Edit only style.css and src/ui/stats.ts.
1. style.css around line 885: remove `#stats .sec-scatter` and `#stats .sec-genres` from the full-width grid rule (they become normal half-width cells). Remove the rule that makes `.genre-grid` two columns (one column inside the half card).
2. style.css `#stats .scatter-box` (around line 694): set `max-width: 100%`. The scatter detail list must not overflow its card: add `min-width: 0; overflow-wrap: anywhere;` to the detail list if missing.
3. src/ui/stats.ts around lines 290-292: order the sections `hero, histogram, months, scatter, genres, categories, top, favorite, diffs` and update the comment above to describe this order.
4. Run `npm run check && npm test` and fix until both pass.

---

## Task 5 — Move the frontend to React

Goal: replace hand-written DOM rendering in `src/ui/`, `render()` in `src/state/store.ts` and `renderAll` in
`src/main.ts` with React components. Behaviour, look and data format identical. Stays framework-agnostic (no React
imports): `src/domain/*`, `src/data/*`, `src/tmdb.ts`, `src/config.ts`, `src/util/*` and their tests; `style.css`;
`data/movies.json` schema; `npm run validate-data`. Acceptance: deployed site identical (list, filters, ratings,
comments, bulk actions, stats, dialogs, offline start, install on phone); `deploy.yml` publishes `dist/`.

Common text appended to every component TASK (5.4–5.11), the dispatcher sends it as part of TASK:
`Port the existing module 1:1: same tags, classes, aria attributes and Russian texts. New files go to src/ui/react/. Do not delete the old module (5.12 does that). React and its types are already installed. Run npm run check && npm test and fix until both pass.`

### 5.1
- executor: 27b
- depends: 3.2, 4.1
- files: package.json, package-lock.json, vite.config.ts, tsconfig.json, tsconfig.sw.json, index.html, src/main.ts
- status: todo

TASK:
Add Vite + React tooling. New npm dependencies are ALLOWED in this task: dependencies `react`, `react-dom`; devDependencies `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`. Install with npm so package-lock.json updates.
1. vite.config.ts with the React plugin, `base: "/watchlist/"`, `build.outDir: "dist"`, `build.manifest: true`.
2. tsconfig.json: `"jsx": "react-jsx"`, include `.tsx`; keep strict settings. `npm run check` type-checks the app and `tsconfig.sw.json` as before.
3. package.json scripts: `dev` = `vite`, `build` = `vite build && tsc -p tsconfig.sw.json` (sw.js stays at the site root, copied into dist/), `check` unchanged in meaning, `test` unchanged.
4. index.html loads `/src/main.ts` as the Vite entry instead of `js/main.js`. `manifest.json`, `icons/`, `style.css` are served as static files (put them where Vite copies them into dist/ without renaming, e.g. publicDir, or reference them so Vite emits them).
5. The existing UI keeps working unchanged; no components yet.
6. `npm run build` must produce dist/index.html, dist/sw.js, dist/manifest.json, dist/icons/. Run `npm run check && npm test && npm run build`.

### 5.2
- executor: coder
- depends: 5.1
- files: .github/workflows/deploy.yml
- status: todo

TASK:
Edit only .github/workflows/deploy.yml. Build with `npm ci && npm run build` and publish the `dist/` directory instead of copying `index.html style.css js/` and the other root files. Keep the step that overlays data/movies.json from the current data/* branch, but write it into `dist/data/movies.json`. Keep the validate-data step as it is. Make sure dist/ contains manifest.json, icons/ and sw.js before upload.

### 5.3
- executor: 27b
- depends: 5.1
- files: src/state/store.ts, src/state/saving.ts, src/ui/react/useWatchlist.ts, src/ui/react/UiState.tsx
- status: todo

TASK:
React store hook. Edit src/state/store.ts and src/state/saving.ts only as needed; new files src/ui/react/useWatchlist.ts and src/ui/react/UiState.tsx. React is installed.
1. In store.ts add a minimal subscribe/notify mechanism: `subscribe(listener): () => void` and a version counter or snapshot getter; every existing `render()` call also notifies subscribers. The old render path keeps working.
2. src/ui/react/useWatchlist.ts: `useWatchlist()` built on `useSyncExternalStore(subscribe, getSnapshot)` returning the current state the UI needs (data, filters, user, saving status). actions.ts keeps working through the existing Op / applyOp path; components call the existing action functions.
3. src/ui/react/UiState.tsx: a `UiStateProvider` + `useUiState()` context holding the session-only sets `openComments`, `expandedOverviews`, `collapsedCards` with toggle functions that trigger a re-render.
4. Run `npm run check && npm test` and fix until both pass.

### 5.4
- executor: coder
- depends: 5.3
- files: src/ui/react/Toast.tsx, src/ui/react/Stars.tsx
- status: todo

TASK:
Create src/ui/react/Toast.tsx from src/ui/toast.ts and src/ui/react/Stars.tsx from the star rendering in src/ui/list/item-row.ts. Stars props: `person`, `value: number | null`, `editable: boolean`, `onRate(value: number): void`. Keep the half-star behaviour exactly: two half buttons per star (`i - 0.5` / `i`), aria-labels like `S: 6,5 из 10`, classes for full / `.half` / empty, value label `toLocaleString("ru-RU")` or `—`.

### 5.5
- executor: coder
- depends: 5.4
- files: src/ui/react/Comments.tsx
- status: todo

TASK:
Create src/ui/react/Comments.tsx from the comments rendering (comments, replies, reactions) in src/ui/list/. Use useWatchlist() for data and existing action functions for edits.

### 5.6
- executor: 27b
- depends: 5.5
- files: src/ui/react/ItemRow.tsx
- status: todo

TASK:
Create src/ui/react/ItemRow.tsx from src/ui/list/item-row.ts using Stars and Comments components and useUiState() for openComments / expandedOverviews / collapsedCards. Keep: selection checkbox, title, badges, status buttons, edit button, watched-card collapse toggle (`Свернуть`/`Развернуть`, aria-expanded), collapsed hides the body, watched expanded shows full overview without clamp, other statuses keep the clamp and `Ещё` toggle.

### 5.7
- executor: coder
- depends: 5.6
- files: src/ui/react/BulkBar.tsx, src/ui/react/Editor.tsx
- status: todo

TASK:
Create src/ui/react/BulkBar.tsx from src/ui/list/bulk-bar.ts and src/ui/react/Editor.tsx from the item editor module in src/ui/list/ (add/edit form, TMDB search preview).

### 5.8
- executor: coder
- depends: 5.7
- files: src/ui/react/List.tsx
- status: todo

TASK:
Create src/ui/react/List.tsx from the list rendering in src/ui/list/: tabs, filters, type filter, sections, empty states, random pick button, selection mode. Renders ItemRow, BulkBar and Editor.

### 5.9
- executor: coder
- depends: 5.3
- files: src/ui/react/Stats.tsx
- status: todo

TASK:
Create src/ui/react/Stats.tsx from src/ui/stats.ts, part 1: the Stats container and the sections hero, histogram, months, categories. Numbers come only from computeStats in src/domain/stats.ts. Leave clearly named placeholders (empty functions returning null) for scatter, genres, top, favorite, diffs.

### 5.10
- executor: coder
- depends: 5.9
- files: src/ui/react/Stats.tsx
- status: todo

TASK:
In src/ui/react/Stats.tsx replace the placeholders with ports from src/ui/stats.ts: scatter (with its detail list), genres, top, favorite, diffs. Section order: hero, histogram, months, scatter, genres, categories, top, favorite, diffs. Ratings formatted with `toLocaleString("ru-RU", { maximumFractionDigits: 1 })`.

### 5.11
- executor: coder
- depends: 5.3
- files: src/ui/react/SettingsDialog.tsx, src/ui/react/CategoriesDialog.tsx
- status: todo

TASK:
Create src/ui/react/SettingsDialog.tsx and src/ui/react/CategoriesDialog.tsx from the modules in src/ui/dialogs/. Keep the native `<dialog>` element, the same form fields, token storage behaviour and texts.

### 5.12
- executor: 27b
- depends: 5.8, 5.10, 5.11
- files: src/ui/react/App.tsx, src/main.ts, src/state/store.ts, src/ui/dom.ts, src/ui/toast.ts, src/ui/stats.ts, src/ui/list/*, src/ui/dialogs/*, index.html
- status: todo

TASK:
Switch the app to React and delete the old rendering. Create src/ui/react/App.tsx that renders the header, List, Stats, dialogs and Toast inside UiStateProvider. src/main.ts keeps init (data load, auth, refresh on visibility) and mounts `<App />` with `createRoot` into the existing root element in index.html. Remove `render()` from store.ts (subscribers stay), `renderAll` from main.ts, and delete src/ui/dom.ts and the old modules in src/ui/ (toast.ts, stats.ts, list/, dialogs/) once nothing imports them. No `document.createElement`-style rendering may remain in src/ui/. Run `npm run check && npm test && npm run build` and fix until all pass.

### 5.13
- executor: 27b
- depends: 5.12
- files: src/sw.ts, vite.config.ts, package.json, tests/sw-shell.test.ts, tools/*
- status: todo

TASK:
Service worker shell list from the Vite build. Instead of the hand-kept `SHELL` array in src/sw.ts, generate it at build time from dist/.vite/manifest.json (hashed file names) plus index.html, style.css (if not hashed), manifest.json and icons. Use a small Vite plugin in vite.config.ts or a build step script; no new dependencies. Bump `CACHE` in src/sw.ts. Update tests/sw-shell.test.ts so it checks that every file referenced by the generated shell exists in dist/ after a build (or checks the generator on a sample manifest if the test must not build). Run `npm run check && npm test && npm run build`.

### 5.14
- executor: acli
- depends: 5.13
- files: CLAUDE.md, README.md
- status: todo

TASK:
Update docs in Russian. CLAUDE.md section 3 ("Структура"): the site is React 19 + Vite + TypeScript; components in src/ui/react/; `npm run dev` for local work, `npm run build` emits dist/ (and sw.js); `deploy.yml` publishes dist/; the service worker shell list is generated from the Vite manifest at build time (remove the rule about adding modules to SHELL by hand); dependencies are react, react-dom, vite and their types. Also in CLAUDE.md line 3 change "оценка 1–10" to "оценка от 0,5 до 10". README.md: local run section becomes `npm install` then `npm run dev`, open the URL Vite prints; remove `npm run watch` and `python3 -m http.server`. Change nothing else.

### 5.15
- executor: 27b
- depends: 5.14
- files: package.json, package-lock.json, vitest.config.ts, tests/react/*
- status: todo

TASK:
React component tests. New devDependencies ALLOWED: `vitest`, `@testing-library/react`, `jsdom`. `npm test` runs the existing `node --test` domain tests and `vitest run` (tests in tests/react/, jsdom environment). Mock the store via the useWatchlist provider; no network. Cover: Stars (full/half/empty fill, left half sets i-0.5, right half sets i, clicking the current value clears it, aria-labels), ItemRow (watched card expanded by default, collapse toggle hides the body, other statuses keep the clamp), Comments (render and add), BulkBar (count text `Выбрано: N`, actions called), List (filters and sections), Stats (section order, rating shown as `7,5`). Run `npm run check && npm test` until both pass.
