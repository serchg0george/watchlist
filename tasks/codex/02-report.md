# Task 02 — build version and offline cache

Vite resolves the current commit with `git rev-parse --short=7 HEAD`. A missing Git revision fails CI builds and uses `dev` locally. Settings displays the revision and the build time in the browser's local time zone. Vitest supplies fixed values for both fields.

The service worker previously used `watchlist-v22`. The build now injects `watchlist-<short SHA>` and the shell manifest into the compiled worker. The existing activation handler removes older caches.

All three shell-generation tests passed locally on Node 26.12.1, including missing-placeholder detection. A headless Edge test served the worker with an isolated fixture, seeded `watchlist-v22`, activated a worker named `watchlist-abcd123`, and confirmed Cache Storage contained only the latter cache. Reloading the page after stopping the HTTP server returned the precached page.

The local browser test used a fixture revision. It did not exercise the production settings dialog or a Vite preview of the complete application.
