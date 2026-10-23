#!/usr/bin/env bash
# Pick the trusted copy of a CI driver script (corpus-gate.mjs,
# harness-diff.mjs) for a job that must not run the change's own copy.
#
#   select-driver.sh <root> <history-ref> <base> <outdir> <path>...
#
# For each repo-relative <path>:
#  - If <path> has ever existed on the history of <history-ref> (the target
#    branch, e.g. origin/main), the driver must come from <base> (the merge
#    base). If <base> lacks it, the branch predates the driver: fail closed
#    and ask the author to merge the target branch in.
#  - Only if <path> never existed on <history-ref> (the change that adds the
#    driver) is the HEAD copy used, with a notice.
#  - A shallow clone or a git error fails closed: the history cannot be read
#    in full, so "never existed" cannot be told apart from "not fetched".
# Same shape as pinHistoryOf in corpus-gate.mjs.
#
# This file is read from the checked-out change, like the workflow that calls
# it, so it is protected only as far as .github/workflows/** is (review and
# code-owner rules), not by this job.
#
# Exit codes: 0 ok, 1 fail closed, 3 usage error.
set -uo pipefail

if [ "$#" -lt 5 ]; then
  echo "usage: select-driver.sh <root> <history-ref> <base> <outdir> <path>..." >&2
  exit 3
fi
root=$1 ref=$2 base=$3 out=$4
shift 4

fail() { echo "::error::$*"; exit 1; }

shallow=$(git -C "$root" rev-parse --is-shallow-repository 2>/dev/null) || fail "select-driver: cannot read the repository at $root"
[ "$shallow" = "false" ] || fail "select-driver: the checkout is shallow, so the history of $ref cannot be read in full; failing closed (check out with fetch-depth: 0)"
git -C "$root" rev-parse --verify -q "$ref^{commit}" >/dev/null || fail "select-driver: $ref is not a commit in this checkout; failing closed"
git -C "$root" rev-parse --verify -q "$base^{commit}" >/dev/null || fail "select-driver: base $base is not a commit in this checkout; failing closed"

mkdir -p "$out" || fail "select-driver: cannot create $out"
for path in "$@"; do
  name=$(basename "$path")
  hist=$(git -C "$root" rev-list -1 "$ref" -- "$path" 2>/dev/null) || fail "select-driver: cannot read the history of $path on $ref; failing closed"
  if [ -n "$hist" ]; then
    if git -C "$root" cat-file -e "$base:$path" 2>/dev/null; then
      git -C "$root" show "$base:$path" > "$out/$name" || fail "select-driver: cannot read $path at $base"
      echo "select-driver: $name from the merge base $base"
    else
      fail "select-driver: $path exists on $ref (last changed in $hist) but not at the merge base $base. This branch predates it; merge $ref into this branch and push again. The job will not run this change's own copy."
    fi
  else
    # Only the change that adds the driver takes this branch.
    git -C "$root" cat-file -e "HEAD:$path" 2>/dev/null || fail "select-driver: $path is on neither $ref nor HEAD"
    git -C "$root" show "HEAD:$path" > "$out/$name" || fail "select-driver: cannot read $path at HEAD"
    echo "::notice::$path has never existed on $ref; running this change's copy (bootstrap)"
  fi
done
