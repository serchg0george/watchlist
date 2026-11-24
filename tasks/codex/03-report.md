# Task 03 — production Content Security Policy

The build-only Vite plugin inserts the CSP immediately after the charset declaration. Development HTML is unchanged. The policy in `tools/csp.ts` is:

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://image.tmdb.org data:; connect-src 'self' https://api.github.com https://api.themoviedb.org; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
```

Reviewed 40 files including the modules reachable from the app entry point, service worker, public stylesheet and manifest. External requests go to api.github.com and api.themoviedb.org. Posters load from image.tmdb.org. www.themoviedb.org opens on user navigation. No raw inline style attribute or HTML-string injection was found in the reviewed sources.

Three focused tests passed on Node 26 against the PR sources, covering the policy, source-derived origins and placement. The isolated run used the JavaScript equivalent of the TypeScript helper. The final bundle, preview interactions, poster rendering, service worker installation and offline reload were not verified in this isolated run. Authenticated TMDB search and a GitHub save were not exercised.
