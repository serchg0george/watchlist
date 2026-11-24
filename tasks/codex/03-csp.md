# Codex task 03 — Content Security Policy for the production build

- Branch: `patch_1.0.3` (PR title: `patch 1.0.3: infrastructure hardening`)
- Depends on: `tasks/codex/02` (both touch `vite.config.ts`) — pull first.
- Runs in parallel with: `tasks/gemini/*`.
- Files you may touch: `vite.config.ts`, `tools/csp.ts` (new), `tests/csp.test.ts` (new), `tests/node-shims.d.ts` (extend only).

## Why

The GitHub write token (and the TMDB token) live in `localStorage`. For the collaborator it is a classic `public_repo` token, i.e. write access to every public repository that account can push to. Any injected script would read it. GitHub Pages cannot send response headers, so a `<meta http-equiv="Content-Security-Policy">` is the only defence-in-depth layer available until the planned backend replaces tokens with real auth.

## Do

1. `tools/csp.ts`: export the policy as a string built from a directive map, so the test can import it:
   - `default-src 'self'`
   - `script-src 'self'`
   - `style-src 'self'` (React `style` props go through CSSOM and are not blocked; confirm nothing sets a `style` attribute via `setAttribute` or HTML strings — grep `src/`)
   - `img-src 'self' https://image.tmdb.org data:`
   - `connect-src 'self' https://api.github.com https://api.themoviedb.org`
   - `font-src 'self'`, `manifest-src 'self'`, `worker-src 'self'`
   - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`
   Before finalising, list every external origin the built site actually uses (grep `src/`, `public/`, `dist/` for `https://`) and make the policy match; links the user only clicks (e.g. GitHub settings pages) need no directive.
2. `vite.config.ts`: a build-only plugin (`apply: "build"`, `transformIndexHtml`) that inserts the meta tag right after `<meta charset>` so it precedes every resource. Not in dev: Vite's dev server injects inline scripts.
3. Check `dist/index.html` after `npm run build`: no inline `<script>` or `<style>`, so no `'unsafe-inline'` is needed. If something requires it, stop and describe it in the report instead of loosening the policy.
4. `tests/csp.test.ts`: the policy contains the directives above, never `'unsafe-inline'` or `'unsafe-eval'`, and allows the API origins used in `src/config.ts` and `src/tmdb.ts` (read those files and extract the origins, so a new API origin without a CSP update fails the test).

## Acceptance

- [ ] `npm run check && npm test && npm run build` green; `dist/index.html` has the meta tag right after charset.
- [ ] `npx vite preview` → `/watchlist/` with DevTools console open: no CSP violations on load without a token (public API), opening/closing ⚙ and the categories dialog, switching to «Статистика», posters on cards, service worker install and an offline reload.
- [ ] TMDB search and a GitHub save: verify if you have tokens; otherwise mark them «не проверено» in the report and the PR.
- [ ] Report: final policy, external origins found, what was verified in the browser.
