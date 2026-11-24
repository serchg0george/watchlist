#!/usr/bin/env bash
# Session co-author list: models that worked on the next commit.
# The prepare-commit-msg hook (.githooks/) turns it into Co-authored-by trailers; post-commit clears it.
# Usage: scripts/coauthor.sh add <alias|"Name <email>"> | list | clear | aliases
# Models without a GitHub account get an @models.invalid address (RFC 2606) so they never map to a real user.
# Exit: 0 ok, 1 usage / unknown alias.
set -u
cd "$(dirname "$0")/.." || exit 1
file="$(git rev-parse --git-common-dir)/session-coauthors"

resolve() {
  case "$1" in
    claude-opus-5.5)   echo "Claude Opus 5.5 <noreply@anthropic.com>" ;;
    claude-sonnet-5.5) echo "Claude Sonnet 5.5 <noreply@anthropic.com>" ;;
    cursor)            echo "Cursor <cursoragent@cursor.com>" ;;
    gemini-flash)      echo "Gemini 3.8 Flash (Antigravity) <gemini-3.8-flash@models.invalid>" ;;
    gemini-dr)         echo "Gemini Deep Research (Flash) <gemini-deep-research@models.invalid>" ;;
    qwen)              echo "Qwen3.8-27B (local) <qwen3.8-27b@models.invalid>" ;;
    glm)               echo "GLM-5.3-Flash (OpenCode Zen) <glm-5.3-flash@models.invalid>" ;;
    deepseek)          echo "DeepSeek V4.1 Flash (OpenCode Zen) <deepseek-v4.1-flash@models.invalid>" ;;
    codex-astra)       echo "GPT-6 Astra (Codex) <gpt-6-astra@models.invalid>" ;;
    codex-sol)         echo "GPT-6.1 Sol (Codex) <gpt-6.1-sol@models.invalid>" ;;
    codex-terra)       echo "GPT-6.1 Terra (Codex) <gpt-6.1-terra@models.invalid>" ;;
    *'<'*'@'*'>')      echo "$1" ;;
    *) return 1 ;;
  esac
}

case "${1:-}" in
  add)
    [[ $# -ge 2 ]] || { echo "usage: $0 add <alias|\"Name <email>\">" >&2; exit 1; }
    entry=$(resolve "$2") || { echo "coauthor: unknown alias '$2' (see: $0 aliases)" >&2; exit 1; }
    grep -qxF "$entry" "$file" 2>/dev/null || echo "$entry" >>"$file"
    ;;
  list)    [[ -s "$file" ]] && cat "$file" || true ;;
  clear)   rm -f "$file" ;;
  aliases) sed -n 's/^    \([a-z0-9.-]*\)) *echo "\(.*\)" ;;$/\1\t\2/p' "$0" ;;
  *) echo "usage: $0 add <alias|\"Name <email>\"> | list | clear | aliases" >&2; exit 1 ;;
esac
