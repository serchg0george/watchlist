# Rollover integration tests

Added nine integration tests in `tests/rollover.test.ts` and the associated ambient Node declarations in `tests/node-shims.d.ts`. Each test uses a private bare Git repository, a seed clone and a runner clone. No production refs are touched.

Covered inactive and explicit bootstrap, an existing week, a two-author squash with duplicate and bot trailers, a clean three-way merge, a conflict, rejected validation, dry run, backwards rotation and a late write. The squash uses the production data validator. Failure and no-op cases check the origin refs.

With up to four independent fixtures running at once, all nine scenarios passed in two consecutive runs on Windows with Git Bash and Node 26.12.1 (21.7 and 21.5 seconds). The late-write scenario passed both times with its four-second wait. The test used Node's TypeScript stripping and the branch's validator sources. No rollover bug was exposed and the production script is unchanged. GitHub Actions on Linux treats a missing GNU date as an error. Other environments without a compatible date or Bash report an explicit skip.

Integration check: the combined Node suite passed all 123 tests without skips in 21.0 seconds, and the data validator reported zero errors and warnings. The test and service-worker TypeScript projects also compiled with the available TypeScript 6.0.3 compiler. The locked dependency installation was blocked by network access to npm, so the React suite and full Vite build were not run locally.
