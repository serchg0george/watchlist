#!/usr/bin/env bash
# Prints the latest data/* branch name on origin, or empty string if none exists.
set -euo pipefail

git ls-remote --heads origin 'data/*' | awk '{sub(/^refs\/heads\//, "", $2); print $2}' | LC_ALL=C sort | tail -n 1
