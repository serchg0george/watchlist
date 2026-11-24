# Rollover integration tests

Added nine integration tests in `tests/rollover.test.ts` and the associated ambient Node declarations in `tests/node-shims.d.ts`. Each test uses a private bare Git repository, a seed clone and a runner clone. No production refs are touched.

Covered inactive and explicit bootstrap, an existing week, a two-author squash with duplicate and bot trailers, a clean three-way merge, a conflict, rejected validation, dry run, backwards rotation and a late write. The squash uses the production data validator. Failure and no-op cases check the origin refs.

All nine passed locally on Windows with Git Bash and Node 26.12.1. The local run took 67.9 seconds, exceeding the 30-second target on this machine. The test used Node's TypeScript stripping and the branch's validator sources. No rollover bug was exposed and the production script is unchanged. GitHub Actions on Linux treats a missing GNU date as an error. Other environments without a compatible date or Bash report an explicit skip.
