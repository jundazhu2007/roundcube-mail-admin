#!/usr/bin/env bash
# mail-admin one-line installer.
#
#   curl -fsSL https://raw.githubusercontent.com/jundazhu2007/roundcube-mail-admin/main/install.sh | sudo bash
#   curl -fsSL https://raw.githubusercontent.com/jundazhu2007/roundcube-mail-admin/main/install.sh | sudo bash -s -- --help
#   curl -fsSL .../install.sh | sudo bash -s -- --yes --hostname mail.example.com --email me@example.com
#
# What this small script does: download the release tarball (it contains the prebuilt web UI), verify its
# SHA-256 against the SHA256SUMS published next to it, unpack it into a temporary directory and run the real
# installer (deploy/installer/main.sh) from there. Read it, and prefer downloading and inspecting it first
# if you do not want to pipe a script into a root shell:
#     curl -fsSLO https://raw.githubusercontent.com/jundazhu2007/roundcube-mail-admin/main/install.sh && less install.sh
#
# MAIL_ADMIN_REF=v1.1.1 pins a version (default: the latest release).
set -euo pipefail

REPO="${MAIL_ADMIN_REPO:-jundazhu2007/roundcube-mail-admin}"
REF="${MAIL_ADMIN_REF:-latest}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# Running from a checkout or an unpacked release? Use it as is.
self="${BASH_SOURCE[0]:-}"
if [ -n "$self" ] && [ -f "$self" ]; then
  here="$(cd "$(dirname "$self")" && pwd)"
  if [ -f "$here/deploy/installer/main.sh" ]; then
    exec bash "$here/deploy/installer/main.sh" "$@"
  fi
fi

for t in curl tar sha256sum; do command -v "$t" >/dev/null 2>&1 || die "$t is required"; done
if [ "$REF" = latest ]; then base="https://github.com/${REPO}/releases/latest/download"
else base="https://github.com/${REPO}/releases/download/${REF}"; fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> downloading mail-admin (${REF}) from github.com/${REPO}"
curl -fsSL --retry 3 -o "$work/mail-admin.tar.gz" "$base/mail-admin.tar.gz" || die "download failed: $base/mail-admin.tar.gz"
curl -fsSL --retry 3 -o "$work/SHA256SUMS" "$base/SHA256SUMS" || die "download failed: $base/SHA256SUMS"

expected="$(awk '$2 == "mail-admin.tar.gz" || $2 == "*mail-admin.tar.gz" {print $1}' "$work/SHA256SUMS")"
[ -n "$expected" ] || die "mail-admin.tar.gz is not listed in SHA256SUMS"
actual="$(sha256sum "$work/mail-admin.tar.gz" | cut -d' ' -f1)"
[ "$expected" = "$actual" ] || die "checksum mismatch (expected $expected, got $actual) - refusing to continue"
echo "==> checksum verified"

mkdir -p "$work/src"
tar -xzf "$work/mail-admin.tar.gz" -C "$work/src" --strip-components=1 --no-same-owner
[ -f "$work/src/deploy/installer/main.sh" ] || die "the release archive does not contain the installer"

# not `exec`: we want the temporary directory removed afterwards
rc=0
bash "$work/src/deploy/installer/main.sh" "$@" || rc=$?
exit "$rc"
