#!/usr/bin/env bash
# Full-system ClamAV scan for the admin panel. Runs as root through sudo (or from cron).
# State contract: /var/lib/mail-admin-clamav-scan/{status,finished_at,scan.log}; status: running | clean | infected | failed
# Mail storage is skipped: every message is already scanned on delivery by Amavis.
set -uo pipefail
STATE_DIR=/var/lib/mail-admin-clamav-scan
mkdir -p "$STATE_DIR"; chmod 755 "$STATE_DIR"

exec 9>/run/lock/mail-admin-clamav.lock
flock -n 9 || { echo "a scan is already running"; exit 0; }

MAILDATA=/var/vmail/homes
if [ -r /etc/mail-admin/mail-admin.env ]; then
  v="$(sed -n 's/^MAIL_ADMIN_MAILDATA_PATH=//p' /etc/mail-admin/mail-admin.env | tail -n1)"
  [ -n "$v" ] && MAILDATA="$v"
fi

echo running > "$STATE_DIR/status"
: > "$STATE_DIR/scan.log"
chmod 644 "$STATE_DIR"/*

if ! command -v clamscan >/dev/null 2>&1; then
  echo "clamscan is not installed (the antivirus component was not selected at install time)" > "$STATE_DIR/scan.log"
  echo failed > "$STATE_DIR/status"; date -Is > "$STATE_DIR/finished_at"; exit 0
fi

nice -n 19 ionice -c3 clamscan --recursive --infected \
  --exclude-dir='^/proc' --exclude-dir='^/sys' --exclude-dir='^/dev' --exclude-dir='^/run' \
  --exclude-dir='^/snap' --exclude-dir="^${MAILDATA}" --exclude-dir='^/mnt' --exclude-dir='^/media' \
  --exclude-dir='^/var/lib/clamav' --exclude-dir='^/var/lib/amavis/virusmails' \
  / >> "$STATE_DIR/scan.log" 2>&1
rc=$?

case $rc in
  0) echo clean > "$STATE_DIR/status" ;;
  1) echo infected > "$STATE_DIR/status" ;;
  *) echo failed > "$STATE_DIR/status" ;;
esac
date -Is > "$STATE_DIR/finished_at"
chmod 644 "$STATE_DIR"/*
exit 0
