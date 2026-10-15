#!/usr/bin/env bash
# rkhunter rootkit check for the admin panel. Runs as root through sudo (or from cron).
# State contract: /var/lib/mail-admin-rkhunter/{status,finished_at,warning_count,check.log}
# status: running | clean | warning | failed
set -uo pipefail
STATE_DIR=/var/lib/mail-admin-rkhunter
mkdir -p "$STATE_DIR"; chmod 755 "$STATE_DIR"

exec 9>/run/lock/mail-admin-rkhunter.lock
flock -n 9 || { echo "a check is already running"; exit 0; }

echo running > "$STATE_DIR/status"
: > "$STATE_DIR/check.log"
chmod 644 "$STATE_DIR"/*

if ! command -v rkhunter >/dev/null 2>&1; then
  echo "rkhunter is not installed (the antivirus component was not selected at install time)" > "$STATE_DIR/check.log"
  echo failed > "$STATE_DIR/status"; echo 0 > "$STATE_DIR/warning_count"; date -Is > "$STATE_DIR/finished_at"; exit 0
fi

rkhunter --update >/dev/null 2>&1 || true
nice -n 19 rkhunter --check --skip-keypress --report-warnings-only --nocolors >> "$STATE_DIR/check.log" 2>&1
rc=$?

count="$(grep -c '^Warning:' "$STATE_DIR/check.log" || true)"
echo "${count:-0}" > "$STATE_DIR/warning_count"
if [ "$rc" -ge 2 ] && [ "${count:-0}" -eq 0 ]; then
  echo failed > "$STATE_DIR/status"
elif [ "${count:-0}" -gt 0 ]; then
  echo warning > "$STATE_DIR/status"
else
  echo clean > "$STATE_DIR/status"
fi
date -Is > "$STATE_DIR/finished_at"
chmod 644 "$STATE_DIR"/*
exit 0
