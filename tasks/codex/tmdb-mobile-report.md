# TMDB adding and mobile usability

Branch `codex/tmdb-mobile` starts at freshly updated master `c805fb9`. No master commits, deployment or live data edits.

## Changes

- `tmdb.js`: Russian title search, direct TMDB movie/TV links, IMDb external-ID lookup, result selection and confirmation, safe metadata allowlist, duplicate detection, manual fallback, cancellable requests and timeout/error states. The read token stays in browser storage and is sent only to the fixed TMDB API host; redirects are rejected. No supplied credentials are embedded in files.
- `index.html`: catalog form, separate TMDB token controls, attribution with official logo, mobile add control and deferred catalog script.
- `app.js`: idempotent addition of metadata, original-title search, compact expandable details, editor/comment drafts, retained serial save queue with explicit retry and 15-second network timeouts. Later optimistic changes survive completion of earlier writes. Failed writes block the queue rather than reloading away input. Pending operations remain in memory; beforeunload warns. Account switching/logout is blocked while writes remain; same-owner token renewal is allowed. Successful retries clear only unchanged submitted drafts.
- Browser-local filters, sort, search and scroll restoration; existing data fields remain compatible. Metadata does not assign ratings or change other users' comments.
- `style.css`: mobile16px form fields, larger targets, safe-area add button hidden near the form/while typing, scrolling dialogs, compact cards and responsive catalog preview. Long descriptions are collapsed so confirmation is reachable.
- `sw.js`: cache v9 adds `tmdb.js` and `icons/tmdb.svg`. Logo retrieved unchanged from TMDB's official assets. README documents setup, schema and recovery limits.

## Validation

- Syntax checks for all three JavaScript files and `git diff --check`.
- Twelve external mocked TMDB checks: title/link parsing, spoofed host rejection, poster validation, metadata projection, localization, missing values, drafts, fixed-host bearer requests, result filtering and confirmed saves.
- Nine save/draft checks against actual app.js: ordered writes, optimistic preservation, failed head retention/retry, account binding, conflict retries, no false success, draft preservation/cleanup and timeouts during GET, response JSON and PUT.
- Browser fixture used intercepted GitHub requests, never the live data endpoint. Injected503 showed persistent unsaved status; retry wrote exactly one item, cleared the unchanged add draft and showed success. Reload restored typed input and selected preview. Compact cards and mobile layout checked at360px without horizontal overflow.
- Real TMDB requests using the supplied read token confirmed Russian search for Inception, its metadata/poster, IMDb lookup, and direct TV-series lookup for Breaking Bad. Editor text survived a reload. Mock401 and missing-token states showed actionable messages without losing the query. Desktop1440px and mobile360px views had no horizontal overflow; browser console was clean. The token was entered only through local browser settings and removed afterward, not put in source files, scripts or reports.

## Limitations and delegation

No future backend migration work was added. Search shows the first page of TMDB results; a more specific title can narrow matches. Mobile checks use a browser viewport, not physical iOS/Safari hardware. Tokens must be entered separately on the eventual GitHub Pages origin and each device. Local draft storage can be unavailable/full; add flow reports that condition. The in-memory queue cannot survive forcibly closing a tab.

Three inherited-model subagents implemented catalog markup/client, mobile CSS and a reviewed save-queue patch; the primary agent integrated, reviewed and browser-tested the result. Exact variants were not exposed, so coauthorship identifies Codex without guessing a model.
