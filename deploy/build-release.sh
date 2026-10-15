#!/usr/bin/env bash
# Maintainer tool: build the release bundle that install.sh downloads.
#   bash deploy/build-release.sh 1.1.0        ->  dist-release/mail-admin.tar.gz + SHA256SUMS
# Must run in a git checkout of the commit being released (uses `git archive`, so only tracked files ship).
# The bundle includes the built frontend (frontend/dist) so servers do not need Node.js.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
version="${1:?usage: build-release.sh VERSION}"
[ "$(cat VERSION)" = "$version" ] || { echo "VERSION file says $(cat VERSION), not $version" >&2; exit 1; }

echo "==> building the frontend"
(cd frontend && npm ci --no-audit --no-fund && npm run build)
[ -f frontend/dist/index.html ] || { echo "frontend build produced no index.html" >&2; exit 1; }

out="dist-release"; rm -rf "$out"; mkdir -p "$out"
stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
top="mail-admin-${version}"

git archive --format=tar --prefix="${top}/" HEAD | tar -x -C "$stage"
rm -rf "${stage:?}/${top}/tests" "${stage:?}/${top}/.github"
cp -r frontend/dist "$stage/$top/frontend/dist"
printf '%s\n' "$version" > "$stage/$top/VERSION"

# reproducible archive: sorted names, fixed owner, mtime of the commit
mtime="$(git log -1 --format=%ct)"
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@${mtime}" -C "$stage" -cf - "$top" | gzip -9n > "$out/mail-admin.tar.gz"
(cd "$out" && sha256sum mail-admin.tar.gz > SHA256SUMS)
echo "==> $out/mail-admin.tar.gz ($(du -h "$out/mail-admin.tar.gz" | cut -f1))"
cat "$out/SHA256SUMS"
