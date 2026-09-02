#!/bin/sh
# Stamp the current git branch and commit into index.html's BUILD constant, so
# the footer can say which source a running copy came from.
#
# The app has no build step (see README), so this is a deliberate, manual step
# rather than something a bundler does. Two ways to use it:
#
#   * Deploying by copying index.html to a host — run this on the checked-out
#     tree first, and the stamp is exact for what you ship.
#   * Deploying by committing — the stamp names the commit you ran it on, i.e.
#     the parent of the commit it lands in. A file cannot contain the hash of
#     the commit it becomes part of, so that lag is unavoidable.
#
# Usage: tools/stamp-build.sh [--reset]
#   --reset  put the placeholders back (what a fresh clone should carry)
set -eu

root=$(git rev-parse --show-toplevel)
file="$root/index.html"

if [ "${1:-}" = "--reset" ]; then
  branch=unstamped; commit=unstamped; date=
else
  branch=$(git rev-parse --abbrev-ref HEAD)
  commit=$(git rev-parse --short HEAD)
  date=$(git log -1 --format=%cs)
fi

# Branch names may not contain a single quote, so the replacement is safe to
# splice into the JS literal as-is (git check-ref-format rejects them).
case "$branch" in
  *"'"*) echo "stamp-build: branch name contains a quote, refusing" >&2; exit 1;;
esac

python3 - "$file" "$branch" "$commit" "$date" <<'PY'
import io, re, sys
path, branch, commit, date = sys.argv[1:5]
src = io.open(path, encoding='utf-8').read()
pat = re.compile(r"^const BUILD = \{.*\};$", re.M)
if not pat.search(src):
    sys.exit('stamp-build: BUILD constant not found in ' + path)
new = "const BUILD = { branch:'%s', commit:'%s', date:'%s' };" % (branch, commit, date)
io.open(path, 'w', encoding='utf-8').write(pat.sub(lambda m: new, src, count=1))
PY

echo "stamped $branch@$commit${date:+ ($date)}"
