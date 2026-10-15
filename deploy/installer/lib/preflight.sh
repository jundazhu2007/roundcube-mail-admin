# shellcheck shell=bash
# Environment detection and pre-flight checks.

detect_default_iface() {
  ip -4 route show default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}'
}

# Prints the private LAN network (CIDR) of the default interface, or nothing if the address is public.
detect_lan_cidr() {
  local iface addr
  iface="$(detect_default_iface)"; [ -n "$iface" ] || return 0
  addr="$(ip -4 -o addr show dev "$iface" scope global 2>/dev/null | awk '{print $4; exit}')"; [ -n "$addr" ] || return 0
  python3 -I - "$addr" <<'PY'
import ipaddress, sys
i = ipaddress.ip_interface(sys.argv[1])
if i.ip.is_private:
    print(i.network)
PY
}

# IP of the machine the installer is being run from over SSH (best effort).
detect_ssh_client_ip() {
  local ip=""
  if [ -n "${SSH_CONNECTION:-}" ]; then ip="${SSH_CONNECTION%% *}"
  elif [ -n "${SSH_CLIENT:-}" ]; then ip="${SSH_CLIENT%% *}"
  else ip="$(who -m 2>/dev/null | sed -n 's/.*(\(.*\)).*/\1/p' | head -n1)"
  fi
  if [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || [[ "$ip" == *:* && "$ip" =~ ^[0-9A-Fa-f:]+$ ]]; then printf '%s' "$ip"; fi
}

detect_timezone() {
  local tz=""
  tz="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
  [ -n "$tz" ] || tz="$(cat /etc/timezone 2>/dev/null || true)"
  printf '%s' "${tz:-UTC}"
}

detect_public_ip() {
  curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true
}

mem_mb() { awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo; }

# Ports we need that something else already listens on. Prints "port:process" lines.
foreign_listeners() {
  local port
  for port in "$@"; do
    ss -H -ltnp "sport = :$port" 2>/dev/null | awk -v p="$port" '
      { n = match($0, /users:\(\("[^"]+"/); name = n ? substr($0, RSTART+9, RLENGTH-10) : "unknown";
        if (name !~ /^(apache2|postfix|master|smtpd|dovecot|cloudflared)$/) print p ":" name }'
  done | sort -u
}

existing_mail_stack() {
  # Anything that looks like a configured mail server that we did not install.
  local found=()
  [ -f "$STATE_FILE" ] && return 1                    # our own earlier run: resuming is fine
  [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/VERSION" ] && found+=("mail-admin in $INSTALL_DIR")
  if [ -f /etc/postfix/main.cf ] && grep -qE '^(virtual_mailbox_domains|content_filter|smtpd_milters)\s*=' /etc/postfix/main.cf 2>/dev/null; then
    found+=("a configured Postfix with virtual domains/filters (/etc/postfix/main.cf)")
  fi
  if getent passwd vmail >/dev/null 2>&1 || [ -s /etc/dovecot/virtual-users ]; then
    found+=("an existing virtual-mailbox setup (vmail account or /etc/dovecot/virtual-users)")
  fi
  [ -d /var/www/roundcube ] && found+=("Roundcube in /var/www/roundcube")
  [ "${#found[@]}" -gt 0 ] && printf '%s\n' "${found[@]}"
  return 0
}

preflight() {
  local id="" ver="" arch mem

  if [ "$DRY_RUN" != 1 ] && [ "$(id -u)" != 0 ]; then
    die "run as root (sudo). Use --dry-run to preview without root."
  fi

  if [ -r /etc/os-release ]; then id="$(. /etc/os-release; echo "${ID:-}")"; ver="$(. /etc/os-release; echo "${VERSION_ID:-}")"; fi
  if [ "$SKIP_OS_CHECK" != 1 ]; then
    # Dovecot 2.4 (new configuration syntax) is what Ubuntu 26.04 ships; Ubuntu 24.04 has 2.3, which this
    # release's configuration does not support.
    if [ "$id" != ubuntu ] || [ "$(printf '%s\n26.04\n' "$ver" | sort -V | head -n1)" != "26.04" ]; then
      die "this release supports Ubuntu 26.04 LTS or newer (found: ${id:-unknown} ${ver:-?}). Ubuntu 24.04 ships Dovecot 2.3, whose configuration syntax differs. Use --skip-os-check at your own risk."
    fi
  fi
  ok "OS: ${id:-?} ${ver:-?}"

  arch="$(uname -m)"
  case "$arch" in x86_64|aarch64) ok "architecture: $arch" ;; *) die "unsupported architecture: $arch" ;; esac

  mem="$(mem_mb)"
  if [ "$mem" -lt 1000 ]; then
    [ "$FORCE" = 1 ] || die "only ${mem} MB of RAM. A mail server with webmail needs at least 1 GB (2 GB+ recommended; use --force to try anyway)."
  fi
  if [ "$mem" -lt 3000 ] && [ -z "${ANTIVIRUS:-}" ]; then
    warn "only ${mem} MB of RAM - ClamAV needs ~1.2 GB; antivirus defaults to OFF (enable with the wizard or by setting ANTIVIRUS=1 in a --config file)."
    ANTIVIRUS=0
  fi
  ok "memory: ${mem} MB"

  local free_gb
  free_gb="$(df -BG --output=avail / | tail -n1 | tr -dc '0-9')"
  [ "${free_gb:-0}" -ge 5 ] || warn "only ${free_gb:-?} GB free on / (5 GB+ recommended)"

  if [ "$MODE" = full ]; then
    local existing
    existing="$(existing_mail_stack)"
    if [ -n "$existing" ] && [ "$FORCE" != 1 ]; then
      printf '%s\n' "$existing" | sed 's/^/  found: /' >&2
      die "this server already looks like it runs a mail setup. A full install would overwrite its configuration.
       - to attach only the admin panel to it, re-run with --mode admin-only
       - to upgrade an installation made by this installer, use --upgrade
       - if you really want to overwrite it, re-run with --force (back up /etc first)"
    fi
    local fl
    fl="$(foreign_listeners 25 80 443 465 993)"
    if [ -n "$fl" ] && [ "$FORCE" != 1 ]; then
      printf '%s\n' "$fl" | sed 's/^/  port in use: /' >&2
      die "another program already listens on a port the mail stack needs (see above). Stop it or use --force."
    fi
  fi
}
