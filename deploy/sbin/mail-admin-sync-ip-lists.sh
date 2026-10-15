#!/usr/bin/env bash
# Applies the admin panel's IP lists (written by the API to /etc/mail-admin/*-ips.txt) to the system:
#   blacklist -> dropped by an nftables table ("inet mail_admin"), unless the address is also whitelisted
#   whitelist -> never dropped by that table and ignored by fail2ban
# Triggered by mail-ip-lists-sync.path / .service; also runs at boot so the rules survive a reboot.
#
# Test hooks: MAIL_ADMIN_CONF_DIR, MAIL_ADMIN_FAIL2BAN_DIR, and MAIL_ADMIN_SYNC_RULES_OUT=FILE
# (write the generated nft ruleset to FILE instead of loading it).
set -euo pipefail
CONF="${MAIL_ADMIN_CONF_DIR:-/etc/mail-admin}"
F2B_DIR="${MAIL_ADMIN_FAIL2BAN_DIR:-/etc/fail2ban}"
WL="$CONF/whitelist-ips.txt"; BL="$CONF/blacklist-ips.txt"; TRUSTED="$CONF/trusted-networks.txt"

valid() { grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$|^[0-9A-Fa-f:]+:[0-9A-Fa-f:]*(/[0-9]{1,3})?$' "$1" 2>/dev/null | sort -u || true; }
v4() { grep -v ':' || true; }
v6() { grep ':' || true; }
join() { paste -sd, - ; }

wl="$(valid "$WL")"; bl="$(valid "$BL")"

set_block() {  # set_block NAME TYPE ELEMENTS
  local name="$1" type="$2" elems="$3"
  printf '  set %s {\n    type %s\n    flags interval\n    auto-merge\n' "$name" "$type"
  if [ -n "$elems" ]; then printf '    elements = { %s }\n' "$elems"; fi
  printf '  }\n'
}

build_rules() {
  echo "table inet mail_admin"
  echo "delete table inet mail_admin"
  echo "table inet mail_admin {"
  set_block whitelist4 ipv4_addr "$(printf '%s\n' "$wl" | v4 | join)"
  set_block whitelist6 ipv6_addr "$(printf '%s\n' "$wl" | v6 | join)"
  set_block blacklist4 ipv4_addr "$(printf '%s\n' "$bl" | v4 | join)"
  set_block blacklist6 ipv6_addr "$(printf '%s\n' "$bl" | v6 | join)"
  cat <<'RULES'
  chain input {
    type filter hook input priority -50; policy accept;
    ip saddr @whitelist4 accept
    ip6 saddr @whitelist6 accept
    ip saddr @blacklist4 drop
    ip6 saddr @blacklist6 drop
  }
}
RULES
}

if [ -n "${MAIL_ADMIN_SYNC_RULES_OUT:-}" ]; then
  build_rules > "$MAIL_ADMIN_SYNC_RULES_OUT"
elif command -v nft >/dev/null 2>&1; then
  rules="$(mktemp)"; trap 'rm -f "$rules"' EXIT
  build_rules > "$rules"
  nft -f "$rules"
fi

# fail2ban must never ban whitelisted addresses or the networks allowed to use the admin panel
if [ -d "$F2B_DIR" ]; then
  ignore="127.0.0.1/8 ::1"
  if [ -n "$wl" ]; then ignore="$ignore $(printf '%s\n' "$wl" | paste -sd' ' -)"; fi
  if [ -f "$TRUSTED" ]; then
    t="$(valid "$TRUSTED" | paste -sd' ' -)"
    if [ -n "$t" ]; then ignore="$ignore $t"; fi
  fi
  mkdir -p "$F2B_DIR/jail.d"
  printf '# Managed by mail-admin-sync-ip-lists.sh\n[DEFAULT]\nignoreip = %s\n' "$ignore" > "$F2B_DIR/jail.d/mail-admin-ignoreip.local"
  # only reload the real fail2ban (not when a test points F2B_DIR somewhere else)
  if [ "$F2B_DIR" = /etc/fail2ban ] && systemctl is-active --quiet fail2ban 2>/dev/null; then fail2ban-client reload >/dev/null 2>&1 || true; fi
fi
