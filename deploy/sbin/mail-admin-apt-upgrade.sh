#!/usr/bin/env bash
# One-click "apt upgrade" for the admin panel (System updates page). Runs as root through sudo.
# State contract with api/routers/system_updates.py: /var/lib/mail-admin-apt-upgrade/{status,finished_at,upgrade.log}
# status: running | success | failed
set -uo pipefail
STATE_DIR=/var/lib/mail-admin-apt-upgrade
mkdir -p "$STATE_DIR"; chmod 755 "$STATE_DIR"

exec 9>/run/lock/mail-admin-apt-upgrade.lock
flock -n 9 || { echo "another upgrade is already running"; exit 0; }

: > "$STATE_DIR/upgrade.log"
echo running > "$STATE_DIR/status"
date -Is > "$STATE_DIR/started_at"
chmod 644 "$STATE_DIR"/*

(
  export DEBIAN_FRONTEND=noninteractive
  echo "== $(date -Is) apt-get update"
  apt-get update || exit 1
  echo "== $(date -Is) apt-get upgrade"
  # --with-new-pkgs lets kernels/library transitions install; phased updates are included on purpose
  apt-get -y --with-new-pkgs \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold \
    -o APT::Get::Always-Include-Phased-Updates=true upgrade || exit 1
  apt-get -y autoremove --purge || true
) >> "$STATE_DIR/upgrade.log" 2>&1
rc=$?

if [ $rc -eq 0 ]; then echo success > "$STATE_DIR/status"; else echo failed > "$STATE_DIR/status"; fi
date -Is > "$STATE_DIR/finished_at"
chmod 644 "$STATE_DIR"/*
exit 0
