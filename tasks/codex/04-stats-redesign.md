# 04 — Statistics screen redesign

- Branch: `codex/04-stats-redesign`
- Start only after `codex/02-replies-reactions` is merged into `master` (both touch `app.js` / `style.css`).
- Recommended model: GPT-6.1 Sol, reasoning effort medium
- Files: `app.js` (function `renderStats` and its helpers only), `style.css` (stats rules), `sw.js`, `README.md` if it describes stats
- Design reference: `design/stats-mockup.html` (open it in a browser, light and dark). Do not ship this file; port its layout and styles.

## Goal

Rewrite the «Статистика» tab to match `design/stats-mockup.html`, computed from real data (`state.data.items`, `getTypes()`), with the changes below. Desktop-first (Mac/Windows browser is the main screen): grid of cards, max content width ~1120px; on narrow screens (< 760px) everything becomes one column without horizontal scroll.

## Sections (top to bottom, as in the mockup)

1. Hero cards (4):
   - «Просмотрено» `N из M` + segmented bar watched / watching / planned / dropped with legend counts (as mockup).
   - «Средняя оценка» S vs L with the two bars; caption «S щедрее на 0,3» / «L щедрее на …» / «Поровну». Fix the mockup's awkward wrap: put «Оценок: S 25 · L 25» on its own line.
   - «Совпадение вкусов» ring + % = share of items rated by both with |S−L| ≤ 1; caption «16 из 24 общих оценок с разницей ≤ 1».
   - REPLACE the mockup's «Брошено» card with «Оценили оба»: count of items rated by both, and «Совпали точно: K» below.
2. «Распределение оценок»: grouped vertical columns 1…10, S left / L right with value labels; subtitle «Чаще всего S ставит 9, L — 8» (mode; omit a person if they have no ratings). Remove the mockup's «левый столбец / правый столбец» legend — S/L colors and the subtitle are enough; keep a compact S/L color key.
3. «Просмотрено по месяцам»: last 12 calendar months ending with the current month (Europe/Sofia not required here; local time is fine), months without views shown as 0, current month bar visually lighter, subtitle like the mockup.
4. «S против L»: scatter as in the mockup — points colored by who rated higher (S higher / L higher / equal), point size + number for coinciding coordinates, ±1 agreement band, dashed diagonal, «L выше» / «S выше» corner labels, legend. ADD from the other design: clicking (or Enter on a focused) point opens a small panel under the chart listing the titles at that coordinate with their category badge; hover tooltip stays.
5. «Самые большие расхождения»: top 5 by |S−L| (ties: newer `watchedAt` first) as dumbbells on a 1–10 scale, chips «S 9 / L 3 / Δ 6».
6. «По типам»: one segmented bar, segment length = total in list per category, filled part = watched, category colors from `getTypes()`; legend «Фильм 12 / 14».
7. «Топ по средней оценке»: only items rated by both; top 10 by average (ties: newer `watchedAt`), two columns on desktop, one on mobile; rank, title, category badge, S/L mini-bars, average with one decimal and comma («9,5»).
- Remove the old «Кто отметил» section and the old `barRow`-based charts. Delete helpers that become unused.

## Rules

- Inline SVG built with the existing `el()` helper or a small `svg()` helper (namespace `http://www.w3.org/2000/svg`); no libraries.
- Colors only through CSS variables (`--s`, `--l`, `--accent`, `--muted`, `--track`, category colors); both themes must look like the mockup.
- Empty states: no ratings / no watched items → each section shows a short muted message instead of an empty chart.
- Numbers use `tabular-nums`; decimals with comma.
- Bump `CACHE` in `sw.js`.

## Acceptance checklist (report results)

1. Real `data/movies.json` renders all 7 sections; numbers match a manual count for 3 spot checks (list them in the report).
2. Empty data (`items: []`) and data with ratings by only one person render without errors.
3. Scatter click panel lists the right titles; keyboard focus works.
4. 1440px and 360px, light and dark: screenshots look like the mockup; no horizontal scroll.
5. `node --check app.js sw.js`, no console errors.
