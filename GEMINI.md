# Instructions for Gemini

You are Gemini (Gemini CLI or Antigravity), running on a separate machine. You implement tasks from `tasks/gemini/NN-*.md`; Claude writes those tasks and reviews your branch. This file overrides `AGENTS.md` where they differ.

**Delegated mode.** If your prompt starts with "You are the DEVELOPER for this repo", you were started by `scripts/delegate.sh` in a throwaway clone without a remote: ignore this file, do only the TASK from that prompt, do not run git.

## What overrides AGENTS.md

- Do the work yourself. Ignore AGENTS.md sections 4–5 (local Qwen, `scripts/qwen.sh`, `scripts/delegate.sh`).
- Never commit to or push `master`. Work only on the plan's patch branch named in the task header (`patch_X.Y.Z`): one plan = one branch = one PR, never a branch or PR per task.
- Talk to the user in Russian; code comments, commit messages and the report are in English.

## Setup (once per clone)

```sh
git config --local user.name serchg0george
git config --local user.email serchg0george@users.noreply.github.com
git config --local core.hooksPath .githooks
```

Never use `git config --global`.

## Workflow for a task

1. `git fetch --all --prune`. If the patch branch exists on `origin`: `git checkout patch_X.Y.Z && git pull --ff-only`. Otherwise: `git checkout master && git pull --ff-only && git checkout -b patch_X.Y.Z`. If pull fails, stop and tell the user.
2. Never rename the branch: renaming a branch on GitHub closes its PR.
3. Read the whole task file, `README.md` and every file the task touches before editing.
4. Implement exactly the task scope: no refactors, renames, new files or dependencies the task does not ask for. Only `actions/*` GitHub Actions; no third-party actions.
5. Self-check: `npm run check && npm test`, plus the task's acceptance checklist. If your environment cannot run shell commands, say so in the report and list the commands the reviewer must run.
6. Register yourself as co-author: `scripts/coauthor.sh aliases`. Gemini 3.8 Flash in Antigravity is `gemini-flash`; for any other model add yourself explicitly, e.g. `scripts/coauthor.sh add "Gemini 3.8 Pro (Gemini CLI) <gemini-3.8-pro@models.invalid>"`. The commit hook adds the `Co-authored-by` trailer and clears the list after the first commit, so for further commits pass `--trailer "Co-authored-by: ..."` explicitly.
7. Small logical commits, English messages, imperative mood.
8. Write `tasks/gemini/NN-report.md` on the branch: what changed (files), how you verified it, deviations from the task, open questions. Commit it.
9. `git push -u origin patch_X.Y.Z`. Never `--force`, never push other branches. If the push is rejected because the branch moved (another agent pushed), stop and tell the user; no rebase or merge without the user's explicit request.
10. PR: if the plan's PR does not exist yet, open it as a draft (`gh pr create --draft --base master --head patch_X.Y.Z`) with the title from the task header. Then update its description: read the current body (`gh pr view --json body -q .body`), keep every existing bullet, append one bullet per change you made — a single past-tense sentence in Russian (e.g. «Введён единый источник версии Node — `.nvmrc`») — and keep the «Проверено / Не проверено» line current. Write it back with `gh pr edit --body-file`.
11. Tell the user in one line that the branch is pushed.

## Code rules

- Layout, commands and conventions: `AGENTS.md` section 3. React 19 + Vite + strict TypeScript; `domain/`, `data/`, `state/`, `tmdb.ts`, `config.ts`, `util/` never import React. No `any`; narrow `unknown` from JSON/network.
- UI text in Russian; identifiers, comments, workflow step names in English.
- Do not edit `data/movies.json` or any `data/*` branch: it is live data written by the site.
- Tests under `tests/*.test.ts` run with `node --test` after `tsc -p tsconfig.test.json`; there is no `@types/node`, Node APIs are declared by hand in `tests/node-shims.d.ts` — extend it minimally when you need a new API.
- GitHub Actions: `permissions` minimal and per job where possible, `timeout-minutes` on every job, Node version from `.nvmrc` (`node-version-file`).
