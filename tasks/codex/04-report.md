# Task 04 — Statistics screen redesign

Implemented on `codex/04-stats-redesign`, based on master `9ad3e9f` after task 02 was merged. Three GPT-6.1 Sol agents with medium reasoning effort handled statistics logic, CSS, and independent review; the parent Codex session integrated the changes and performed browser verification.

## Changes

- `app.js`: replaced only the statistics section and its helpers. `computeStats` calculates counts, averages, agreement, grouped coordinates, rankings, and category totals. `computeMonths` returns the last 12 calendar months including zero months, counting only watched items. Seven rendering functions produce the hero cards, grouped histogram, monthly chart, interactive scatter, dumbbells, category bar, and both-rated top ten. SVG points expose keyboard focus, Enter/Space activation, tooltips, and a details panel with titles and category badges. Removed obsolete chart helpers and the author-activity section.
- `style.css`: ported the reference layout into scoped statistics rules, with a 1120px canvas, four desktop hero cards, two-column charts/top list, and one column below 760px. Colors use existing theme/category variables. The list retains its 760px width. Added visible scatter focus/selection styles and wrapping detail content.
- `sw.js`: advanced the shell cache to `watchlist-v6`.
- `README.md`: described the new statistics and keyboard interaction, and removed the outdated reference to the deleted author-activity section.
- `data/movies.json`, `index.html`, and `design/stats-mockup.html` are unchanged. No dependencies were added.

## Verification

All acceptance checks passed:

1. All seven sections render from the actual data file. Independent manual totals and browser output agreed:
   - Statuses: 35 total = 14 watched + 1 watching + 15 planned + 5 dropped. The hero shows 14 of 35; the monthly series has November 2026 = 14 and zero for the preceding eleven months.
   - Ratings: S has 18 ratings summing to 131, so 131/18 = 7.2778, displayed as 7,3. L has 19 ratings summing to 149, so 149/19 = 7.8421, displayed as 7,8. The difference displays as L +0,6.
   - Agreement: 18 items rated by both, 8 exact matches, 11 within one point; round(11/18 * 100) = 61%.
2. Browser fixtures for an empty list and S-only ratings render without errors or invalid numeric output. Independent Node DOM fixtures additionally cover L-only ratings. Empty sections show explanatory messages. Twenty-one model assertions cover calendar/year boundaries, zero months, watched-only counting, both-only rankings, recency ties, coordinate grouping, unknown categories, and comma decimals.
3. Clicking the 10/10 point lists exactly five titles: Дюна, Тайна Коко, 50 первых поцелуев, Ты, Дюна: часть 2, each with its category. Enter on 7/7 lists Душа and Семейка Аддамс. Tab moves focus between points and exposes the matching tooltip; active points have a visible focus/selection outline.
4. Opened and inspected the reference in both themes. Inspected implementation screenshots at 1440px and 360px in light and dark themes. No horizontal document overflow. An additional 800px check found no overflow inside the four hero cards. Verified 1120px statistics and 760px list widths when switching tabs.
5. `node --check app.js`, `node --check sw.js`, and `git diff --check` passed. No browser console warnings/errors occurred in tested flows. The ordinary site was served using `python -m http.server`, in addition to a disposable fixture server outside the repository.

## Notes

- Test scripts, fixture server, and screenshots are outside the repository. The fixture server forced CSS themes only for testing; the production app continues to follow the system theme. No live data writes or external API writes were performed during verification.
- For tied histogram modes, the lowest tied rating is displayed. Mean differences below the displayed one-decimal precision show «Поровну». Unknown/deleted category keys remain represented using their key and the muted theme color.
- No scope deviations, unresolved defects, or open questions identified. The task branch is ready for review; master was not modified by this task.
