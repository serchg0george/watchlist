#!/usr/bin/env bash
# Rotate weekly data branches without checking out or modifying the working tree.
set -euo pipefail
export LC_ALL=C

TZ_NAME=${TZ_NAME:-Europe/Sofia}
DRY_RUN=${DRY_RUN:-0}
BOOTSTRAP=${BOOTSTRAP:-0}
LATE_WAIT=${LATE_WAIT:-180}
FILE=data/movies.json
BOT_NAME='github-actions[bot]'
BOT_EMAIL='41898099+github-actions[bot]@users.noreply.github.com'
export GIT_AUTHOR_NAME="$BOT_NAME" GIT_COMMITTER_NAME="$BOT_NAME"
export GIT_AUTHOR_EMAIL="$BOT_EMAIL" GIT_COMMITTER_EMAIL="$BOT_EMAIL"
pushed=false
tmp_parent=$(cd "${TMPDIR:-/tmp}" && pwd -P)
tmp=$(mktemp -d "$tmp_parent/watchlist-rollover.XXXXXX")
finish() {
    local status=$?
    if [[ -n ${GITHUB_OUTPUT:-} ]]; then
        printf 'pushed=%s\n' "$pushed" >> "$GITHUB_OUTPUT"
    fi
    # Only remove the exact temporary directory under its resolved parent.
    if [[ -d $tmp && $(cd "$tmp" && pwd -P) == "$tmp_parent"/watchlist-rollover.* ]]; then
        rm -rf -- "$tmp"
    fi
    exit "$status"
}
trap finish EXIT

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $LATE_WAIT =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'LATE_WAIT must be a nonnegative number.'
date_cmd=date
if command -v gdate >/dev/null 2>&1; then date_cmd=gdate; fi
# Calendar arithmetic at noon avoids crossing a DST transition at midnight.
today=$(TZ="$TZ_NAME" "$date_cmd" -d "${NOW_OVERRIDE:-now}" +%F)
weekday=$(TZ="$TZ_NAME" "$date_cmd" -d "$today 12:00" +%u)
monday=$(TZ="$TZ_NAME" "$date_cmd" -d "$today 12:00 $((weekday - 1)) days ago" +%F)
sunday=$(TZ="$TZ_NAME" "$date_cmd" -d "$monday 12:00 6 days" +%F)
CUR="data/${monday}_${sunday}"
printf 'Current week: %s (%s)\n' "$CUR" "$TZ_NAME"

fetch_refs() {
    git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'
}
fetch_refs
OLD=$(git for-each-ref --format='%(refname:strip=3)' refs/remotes/origin/data/ | sort | tail -n 1)
master=$(git rev-parse refs/remotes/origin/master)

push_ref() {
    git push origin "$1:refs/heads/$2" || return "$?"
    pushed=true
}

if [[ -z $OLD ]]; then
    if [[ $BOOTSTRAP == 1 ]]; then
        printf 'Create %s at master %s (bootstrap).\n' "$CUR" "$master"
        if [[ $DRY_RUN != 1 ]]; then push_ref "$master" "$CUR"; fi
    else
        printf 'NOTICE: No data branches; use BOOTSTRAP=1 to create the first week.\n'
    fi
    exit 0
fi
if [[ $OLD == "$CUR" ]]; then
    printf 'NOTICE: %s already exists; nothing to do.\n' "$CUR"
    exit 0
fi
[[ $OLD < "$CUR" ]] || die "Latest data branch $OLD is later than $CUR; refusing to go backwards."
[[ $OLD =~ ^data/([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9]{4}-[0-9]{2}-[0-9]{2})$ ]] || die "Invalid weekly branch: $OLD"
old_monday=${BASH_REMATCH[1]}
old_sunday=${BASH_REMATCH[2]}
H1=$(git rev-parse "refs/remotes/origin/$OLD")
BASE=$(git merge-base "$master" "$H1")
count=$(git rev-list --count "$BASE..$H1" -- "$FILE")

# Keep the original author/trailer spelling, deduplicate, and omit our bot.
coauthors() {
    git log --format='%an <%ae>%n%(trailers:key=Co-authored-by,valueonly)' "$1..$2" -- "$FILE" |
        awk -v bot="$BOT_EMAIL" 'NF && index(tolower($0), "<" tolower(bot) ">") == 0 && !seen[$0]++ { print "Co-authored-by: " $0 }'
}
{
    printf 'Data %s – %s (%s changes)\n\nSquashed from branch %s.\n\n' "$old_monday" "$old_sunday" "$count" "$OLD"
    coauthors "$BASE" "$H1"
} > "$tmp/squash-message"

# Build a tree with only the data entry replaced; never use the user's index.
commit_data() {
    local parent=$1 blob=$2 message=$3 mode tree
    mode=$(git ls-tree "$parent" -- "$FILE" | awk '{ print $1 }') || return
    [[ $mode == 100644 || $mode == 100755 ]] || die "Missing or nonregular $FILE in $parent"
    GIT_INDEX_FILE="$tmp/index" git read-tree "$parent" || return
    GIT_INDEX_FILE="$tmp/index" git update-index --add --cacheinfo "$mode,$blob,$FILE" || return
    tree=$(GIT_INDEX_FILE="$tmp/index" git write-tree) || return
    git commit-tree "$tree" -p "$parent" < "$message"
}
data_blob=$(git rev-parse "$H1:$FILE")
M=$master
for attempt in 1 2 3; do
    master=$(git rev-parse refs/remotes/origin/master)
    if [[ $(git rev-parse "$master:$FILE") == "$data_blob" ]]; then
        printf 'Data already matches master; skip squash commit.\n'
        M=$master
        break
    fi
    M=$(commit_data "$master" "$data_blob" "$tmp/squash-message")
    printf 'Squash %s (%s changes) onto master %s; attempt %s.\n' "$OLD" "$count" "$master" "$attempt"
    if [[ $DRY_RUN == 1 ]]; then
        printf 'DRY_RUN: would push %s to master.\n' "$M"
        break
    fi
    if push_ref "$M" master; then break; fi
    [[ $attempt != 3 ]] || die 'Could not push master after 3 attempts.'
    fetch_refs
done
printf 'Create %s at %s.\n' "$CUR" "$M"
if [[ $DRY_RUN == 1 ]]; then
    printf 'DRY_RUN: would push the current week, wait %ss, and carry any clean late changes from %s.\n' "$LATE_WAIT" "$OLD"
    exit 0
fi
push_ref "$M" "$CUR"

printf 'Wait %ss for writes still targeting %s.\n' "$LATE_WAIT" "$OLD"
sleep "$LATE_WAIT"
fetch_refs
H2=$(git rev-parse "refs/remotes/origin/$OLD")
if [[ $H2 == "$H1" ]]; then
    printf 'No late writes.\n'
    exit 0
fi
git show "$H1:$FILE" > "$tmp/base"
git show "$H2:$FILE" > "$tmp/theirs"
{
    printf 'Carry late changes from %s\n\n' "$OLD"
    coauthors "$H1" "$H2"
} > "$tmp/carry-message"
for attempt in 1 2 3; do
    current=$(git rev-parse "refs/remotes/origin/$CUR")
    git show "$current:$FILE" > "$tmp/ours"
    if git merge-file -p -L "$CUR" -L "$OLD at rollover" -L "$OLD late writes" \
        "$tmp/ours" "$tmp/base" "$tmp/theirs" > "$tmp/merged"; then
        merged_blob=$(git hash-object -w "$tmp/merged")
    else
        printf 'ERROR: Late changes conflict; resolve %s on %s manually. %s is preserved.\n' "$FILE" "$CUR" "$OLD" >&2
        cat "$tmp/merged" >&2
        exit 1
    fi
    if [[ $merged_blob == $(git rev-parse "$current:$FILE") ]]; then
        printf 'Late changes already present in %s.\n' "$CUR"
        exit 0
    fi
    carry=$(commit_data "$current" "$merged_blob" "$tmp/carry-message")
    printf 'Carry late changes onto %s; attempt %s.\n' "$CUR" "$attempt"
    if push_ref "$carry" "$CUR"; then exit 0; fi
    [[ $attempt != 3 ]] || die 'Could not push late changes after 3 attempts.'
    fetch_refs
done
