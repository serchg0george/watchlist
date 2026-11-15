#!/usr/bin/env bash
# Delegate a coding or text task to a cheaper model.
# Runs in a throwaway clone with NO git remote (cannot push), prints the resulting patch.
# The main agent reviews the patch and applies it: git apply <patch>.
# Usage: scripts/delegate.sh <task-file|-> [--acli]
#   default executor — local Qwen via OpenCode (scripts/qwen.sh up is run if needed);
#   --acli — Antigravity CLI (gemini-3.8-flash-low, accept-edits, sandbox): light edits, or a session
#   where the local model is unreachable. Qwen fails to load — falls back to Antigravity CLI.
# Env: EDIT_PATCH (default $TMPDIR/delegate-<ts>.patch), AGY_MODEL, QWEN_MODEL (default qwen3.8-27b).
# No time limit: quality over speed. Exit: 0 patch produced, 1 usage, 2 run failed, 3 no changes.
set -u
repo=$(cd "$(dirname "$0")/.." && pwd)
[[ $# -ge 1 ]] || { echo "usage: $0 <task-file|-> [--acli]" >&2; exit 1; }
if [[ "$1" == "-" ]]; then task=$(cat); else task=$(cat "$1"); fi
executor=qwen; [[ "${2:-}" == "--acli" ]] && executor=acli

if [[ $executor == qwen ]] && ! "$repo/scripts/qwen.sh" up >&2; then
  echo "delegate: Qwen unavailable — falling back to ACLI" >&2; executor=acli
fi

work=$(mktemp -d -t delegate)
trap 'rm -rf "$work"' EXIT
git clone -q --local --no-hardlinks "$repo" "$work/repo" 2>/dev/null || { mkdir -p "$work/repo"; git -C "$work/repo" init -q; }
# Include uncommitted work so the executor edits the current state.
(cd "$repo" && git rev-parse -q --verify HEAD >/dev/null && git diff HEAD --binary) | (cd "$work/repo" && git apply --allow-empty 2>/dev/null || true)
(cd "$repo" && git ls-files --others --exclude-standard -z | tar --null -T - -cf - 2>/dev/null) | (cd "$work/repo" && tar -xf - 2>/dev/null || true)
cd "$work/repo"
git remote remove origin 2>/dev/null
git add -A >/dev/null && git -c user.name=x -c user.email=x@x -c core.hooksPath=/dev/null commit -qm base --allow-empty

preamble="You are the DEVELOPER for this repo (a static GitHub Pages site). Do exactly what TASK describes, nothing else.
Rules: create or edit files in place; plain HTML/CSS/JavaScript, no build step, no npm, no frameworks;
Russian for UI text and documentation, English for code identifiers and code comments;
do not run git, do not commit; do not create files TASK does not ask for.
Finish with a one-line summary of the files you changed."
prompt="$preamble

TASK:
$task"

log="$work/run.log"
if [[ $executor == qwen ]]; then
  OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1 opencode run --auto -m "lmstudio/${QWEN_MODEL:-qwen3.8-27b}" "$prompt" </dev/null >"$log" 2>&1
else
  # Headless agy auto-denies writes; allow them only inside the clone (real path, no glob — globs don't match).
  agy --model "${AGY_MODEL:-gemini-3.8-flash-low}" --mode accept-edits --sandbox \
    --settings "{\"permissions\":{\"allow\":[\"write_file($(pwd -P))\"]}}" \
    -p="$prompt" </dev/null >"$log" 2>&1
fi
rc=$?
tail -n 3 "$log" | sed "s/^/[$executor] /" >&2
if [[ $rc -ne 0 ]]; then
  echo "delegate: $executor failed with exit code $rc" >&2
  exit 2
fi
git add -A >/dev/null
patch=${EDIT_PATCH:-${TMPDIR:-/tmp}/delegate-$(date +%Y%m%d-%H%M%S).patch}
git diff --cached --binary >"$patch"
if [[ ! -s "$patch" ]]; then echo "delegate: no changes ($executor, rc $rc)" >&2; exit 3; fi
if [[ $executor == qwen ]]; then "$repo/scripts/coauthor.sh" add qwen
elif [[ "${AGY_MODEL:-gemini-3.8-flash-low}" == gemini-3.8-flash* ]]; then "$repo/scripts/coauthor.sh" add gemini-flash
else "$repo/scripts/coauthor.sh" add "$AGY_MODEL (Antigravity) <$AGY_MODEL@models.invalid>"; fi
echo "delegate: $executor rc $rc — patch $patch ($(git diff --cached --stat | tail -n 1))"
