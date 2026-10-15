#!/usr/bin/env bash
# One-click Roundcube upgrade for the admin panel. Runs as root through sudo.
# Backs up the application directory and the roundcube database first, verifies the download against the
# SHA-256 digest GitHub publishes for the release asset, then uses Roundcube's own installto.sh.
# State contract: /var/lib/mail-admin-roundcube-upgrade/{status,finished_at,upgrade.log}
# status: running | success | up_to_date | failed
set -uo pipefail
STATE_DIR=/var/lib/mail-admin-roundcube-upgrade
RC_DIR=/var/www/roundcube
BACKUP_DIR=/var/backups/mail-admin-roundcube
mkdir -p "$STATE_DIR" "$BACKUP_DIR"; chmod 755 "$STATE_DIR"; chmod 700 "$BACKUP_DIR"

exec 9>/run/lock/mail-admin-roundcube.lock
flock -n 9 || { echo "an upgrade is already running"; exit 0; }

if [ -r /etc/mail-admin/mail-admin.env ]; then
  v="$(sed -n 's/^MAIL_ADMIN_ROUNDCUBE_DIR=//p' /etc/mail-admin/mail-admin.env | tail -n1)"
  [ -n "$v" ] && RC_DIR="$v"
fi

: > "$STATE_DIR/upgrade.log"
echo running > "$STATE_DIR/status"
chmod 644 "$STATE_DIR"/*

finish() {  # finish STATUS
  echo "$1" > "$STATE_DIR/status"; date -Is > "$STATE_DIR/finished_at"; chmod 644 "$STATE_DIR"/*; exit 0
}

(
  set -euo pipefail
  installed="$(sed -n "s/.*define('RCMAIL_VERSION', *'\([^']*\)').*/\1/p" "$RC_DIR/program/include/iniset.php" | head -n1)"
  echo "installed version: ${installed:-unknown}"

  release_json="$(curl -fsSL --max-time 30 https://api.github.com/repos/roundcube/roundcubemail/releases/latest)"
  latest="$(printf '%s' "$release_json" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
  digest="$(printf '%s' "$release_json" | python3 -I -c '
import json,sys
d=json.load(sys.stdin); n="roundcubemail-%s-complete.tar.gz" % d["tag_name"]
print(next((a.get("digest","") for a in d["assets"] if a["name"]==n),""))')"
  echo "latest release: $latest"

  if [ "$(printf '%s\n%s\n' "$installed" "$latest" | sort -V | tail -n1)" = "$installed" ]; then
    echo "already up to date"; exit 42
  fi
  case "$digest" in sha256:*) ;; *) echo "GitHub did not publish a SHA-256 digest for this release; refusing to continue"; exit 1 ;; esac

  ts="$(date +%Y%m%d-%H%M%S)"
  echo "backing up files and database to $BACKUP_DIR (timestamp $ts)"
  tar -C "$(dirname "$RC_DIR")" -czf "$BACKUP_DIR/files-$ts.tar.gz" "$(basename "$RC_DIR")"
  if command -v mariadb-dump >/dev/null 2>&1; then
    mariadb-dump --single-transaction roundcube | gzip > "$BACKUP_DIR/db-$ts.sql.gz"
  fi
  chmod 600 "$BACKUP_DIR"/*

  work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
  url="https://github.com/roundcube/roundcubemail/releases/download/${latest}/roundcubemail-${latest}-complete.tar.gz"
  echo "downloading $url"
  curl -fsSL --max-time 300 -o "$work/rc.tar.gz" "$url"
  actual="sha256:$(sha256sum "$work/rc.tar.gz" | cut -d' ' -f1)"
  [ "$actual" = "$digest" ] || { echo "checksum mismatch: expected $digest, got $actual"; exit 1; }
  echo "checksum ok"

  tar -xzf "$work/rc.tar.gz" -C "$work"
  # The config stays in place; installto.sh only replaces application files and runs DB migrations.
  (cd "$work/roundcubemail-${latest}" && php bin/installto.sh -y "$RC_DIR")
  chown -R root:root "$RC_DIR" 2>/dev/null || true
  [ -d "$RC_DIR/config" ] && chgrp www-data "$RC_DIR/config" "$RC_DIR/config/config.inc.php" 2>/dev/null || true
  rm -rf "$RC_DIR/installer"
  echo "upgrade finished"
) >> "$STATE_DIR/upgrade.log" 2>&1
rc=$?

case $rc in
  0) finish success ;;
  42) finish up_to_date ;;
  *) finish failed ;;
esac
