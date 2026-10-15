#!/usr/bin/env bash
# mail-admin installer. Run through the repository's top-level install.sh (or `mail-admin-install` once installed).
set -Eeuo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
HERE="$(dirname "$SELF")"
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
# shellcheck source=lib/options.sh
. "$HERE/lib/options.sh"
# shellcheck source=lib/preflight.sh
. "$HERE/lib/preflight.sh"
# shellcheck source=lib/system.sh
. "$HERE/lib/system.sh"
# shellcheck source=lib/mailstack.sh
. "$HERE/lib/mailstack.sh"
# shellcheck source=lib/web.sh
. "$HERE/lib/web.sh"
# shellcheck source=lib/app.sh
. "$HERE/lib/app.sh"
# shellcheck source=lib/extras.sh
. "$HERE/lib/extras.sh"

APP_VERSION="$(cat "$APP_SRC_DIR/VERSION" 2>/dev/null || echo dev)"
DEFAULT_ROUNDCUBE_VERSION="1.7.4"
DEFAULT_ROUNDCUBE_SHA256="2c6c878f0093f1bf7fb6086781d2dd9269d652c016b86939c157c5f1729139a2"

trap 'die "installer stopped on line $LINENO: $BASH_COMMAND"' ERR

# ------------------------------------------------------------------ wizard
wizard() {
  local hn_default="" labels

  if [ "$MODE" != full ] && [ "$MODE" != admin-only ]; then die "--mode must be 'full' or 'admin-only'"; fi

  ask MAIL_HOSTNAME "Public hostname of this mail server (e.g. mail.example.com)" ""
  [ -n "${MAIL_HOSTNAME:-}" ] || die "--hostname is required"
  MAIL_HOSTNAME="${MAIL_HOSTNAME,,}"
  is_fqdn "$MAIL_HOSTNAME" || die "'$MAIL_HOSTNAME' is not a valid fully qualified hostname"

  labels="$(awk -F. '{print NF}' <<< "$MAIL_HOSTNAME")"
  if [ "$labels" -ge 3 ]; then hn_default="${MAIL_HOSTNAME#*.}"; else hn_default="$MAIL_HOSTNAME"; fi
  ask MAIL_DOMAIN "First mail domain (addresses will look like user@THIS)" "$hn_default"
  MAIL_DOMAIN="${MAIL_DOMAIN,,}"
  is_fqdn "$MAIL_DOMAIN" || die "'$MAIL_DOMAIN' is not a valid domain"

  ask_choice TLS_MODE "How should HTTPS / mail TLS certificates be obtained?" letsencrypt \
    "letsencrypt     Let's Encrypt over HTTP (port 80 must reach this server)" \
    "cloudflare-dns  Let's Encrypt via the Cloudflare DNS API (works behind NAT / closed port 80)" \
    "existing        use certificate files I already have" \
    "selfsigned      self-signed (testing only)"
  case "$TLS_MODE" in
    letsencrypt|cloudflare-dns) ask LE_EMAIL "Contact e-mail for Let's Encrypt expiry notices (optional)" "" ;;
  esac
  if [ "$TLS_MODE" = cloudflare-dns ]; then
    if [ -z "${CF_DNS_TOKEN:-}" ] && [ -r /etc/letsencrypt/cloudflare.ini ]; then
      CF_DNS_TOKEN="$(sed -n 's/^dns_cloudflare_api_token *= *//p' /etc/letsencrypt/cloudflare.ini | head -n1)"
    fi
    ask CF_DNS_TOKEN "Cloudflare API token with Zone:DNS:Edit" "" secret
  fi
  if [ "$TLS_MODE" = existing ]; then
    ask TLS_CERT "Path to the full-chain certificate (PEM)" ""
    ask TLS_KEY  "Path to the private key (PEM)" ""
  fi

  # --- Cloudflare Tunnel (optional)
  if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then CLOUDFLARE_TUNNEL=1; fi
  if [ "${CLOUDFLARE_TUNNEL-}" != 1 ] && [ -r /etc/cloudflared/tunnel.env ] && [ -f "$STATE_FILE" ]; then
    : # tunnel was set up by an earlier run; keep it unless explicitly turned off
  fi
  ask_yn CLOUDFLARE_TUNNEL "Publish the web UI through a Cloudflare Tunnel (cloudflared)?" no
  if [ "$CLOUDFLARE_TUNNEL" = 1 ] && [ -z "${CF_TUNNEL_TOKEN:-}" ]; then
    if [ -r /etc/cloudflared/tunnel.env ]; then
      CF_TUNNEL_TOKEN="$(sed -n 's/^TUNNEL_TOKEN=//p' /etc/cloudflared/tunnel.env | head -n1)"
    else
      ask CF_TUNNEL_TOKEN "Cloudflare Tunnel token (from Zero Trust > Networks > Tunnels)" "" secret
    fi
  fi

  if [ "$MODE" = full ]; then
    # --- mail storage
    if [ -z "${NFS_SERVER:-}" ]; then
      local use_nfs=""
      ask_yn use_nfs "Store mailboxes on an NFS share (NAS) instead of the local disk?" no
      if [ "$use_nfs" = 1 ]; then
        ask NFS_SERVER "NFS export (host:/path)" ""
        local mp="$MAILDATA_PATH"
        if [ "$mp" = "/var/vmail/homes" ]; then mp="/mnt/maildata/homes"; fi
        MAILDATA_PATH=""
        ask MAILDATA_PATH "Where to put mailboxes (the NFS share is mounted at the parent directory)" "$mp"
      fi
    fi

    ask_yn WEBMAIL "Install Roundcube webmail?" yes
    ask_yn ANTISPAM "Enable spam filtering (SpamAssassin)?" yes
    ask_yn ANTIVIRUS "Enable antivirus (ClamAV + rkhunter, needs ~1.2 GB RAM)?" yes
    ask_yn DKIM "Sign outgoing mail with DKIM (OpenDKIM)?" yes
    ask_choice FIREWALL "Configure the firewall?" none \
      "none  leave the firewall alone" \
      "ufw   allow only SSH, 25, 465, 993, 443, 80 and enable ufw"
    ask_yn FAIL2BAN "Install fail2ban (blocks repeated login failures)?" yes
  else
    # attached to an existing mail server: it keeps its own filtering, fail2ban and firewall
    WEBMAIL=0; ANTIVIRUS=0; ANTISPAM=0; DKIM=0
    : "${FAIL2BAN:=0}"; : "${FIREWALL:=none}"
  fi

  # --- who may open /admin
  if [ -z "${ADMIN_ALLOW:-}" ]; then
    local lan ssh_ip="" list=""
    lan="$(detect_lan_cidr || true)"
    [ "$ALLOW_SSH_CLIENT" = 1 ] && ssh_ip="$(detect_ssh_client_ip || true)"
    [ -n "$lan" ] && list="$lan"
    [ -n "$ssh_ip" ] && list="${list:+$list,}$ssh_ip"
    if interactive; then
      printf '%s\n' "The admin panel (/admin) and its API are only reachable from the networks you list here." > /dev/tty
      ask ADMIN_ALLOW "Allowed networks, comma separated ('any' = everyone, not recommended)" "$list"
    else
      ADMIN_ALLOW="$list"
    fi
    [ -n "${ADMIN_ALLOW:-}" ] || die "could not work out which networks may open the admin panel. Pass --admin-allow 192.168.1.0/24,203.0.113.7"
  fi
  ADMIN_ALLOW="${ADMIN_ALLOW// /}"
}

# ------------------------------------------------------------------ validation + derived values
validate_and_derive() {
  local n x
  : "${ANTIVIRUS:=1}"; : "${ANTISPAM:=1}"; : "${WEBMAIL:=1}"; : "${DKIM:=1}"; : "${FAIL2BAN:=1}"; : "${FIREWALL:=none}"
  : "${CLOUDFLARE_TUNNEL:=0}"
  is_port "$API_PORT" || die "invalid --api-port"
  is_user "$SERVICE_USER" || die "invalid --service-user"
  [[ "$INSTALL_DIR" == /* ]] || die "--install-dir must be an absolute path"
  [[ "$MAILDATA_PATH" == /* ]] || die "--maildata-path must be an absolute path"
  is_uint "$VMAIL_UID" && [ "$VMAIL_UID" -ge 1000 ] || die "--vmail-uid must be a number >= 1000"
  is_uint "$MAX_MESSAGE_MB" && [ "$MAX_MESSAGE_MB" -ge 1 ] || die "--max-message-mb must be a positive number"
  is_uint "$LOG_RETENTION_DAYS" || die "--log-retention-days must be a number"
  case "$WEBMAIL_ACCESS" in public|internal) ;; *) die "--webmail-access must be public or internal" ;; esac
  case "$FIREWALL" in none|ufw) ;; *) die "--firewall must be none or ufw" ;; esac
  [[ "$ROUNDCUBE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid --roundcube-version"
  [[ "$DKIM_SELECTOR" =~ ^[A-Za-z0-9-]+$ ]] || die "invalid --dkim-selector"
  [[ "$ADMIN_USER" =~ ^[A-Za-z0-9._@-]{2,64}$ ]] || die "invalid --admin-user"
  [ "$FIRST_MAILBOX" = "-" ] || is_localpart "$FIRST_MAILBOX" || die "invalid --first-mailbox"
  if [ -n "${NFS_SERVER:-}" ]; then [[ "$NFS_SERVER" =~ ^[^:/[:space:]]+:/.+$ ]] || die "--nfs-server must look like host:/export/path"; fi
  if [ -n "${RELAYHOST:-}" ] && [ -n "${RELAY_USER:-}" ] && [ -z "${RELAY_PASS:-}" ]; then die "--relay-user needs --relay-pass"; fi
  if [ "$ADMIN_ALLOW" != any ]; then
    for n in $(split_list "$ADMIN_ALLOW"); do is_cidr "$n" || die "invalid network in --admin-allow: $n"; done
  fi
  for x in $(split_list "${ALIAS_HOSTNAMES:-}"); do is_fqdn "$x" || die "invalid name in --alias-hostnames: $x"; done
  [ "$CLOUDFLARE_TUNNEL" != 1 ] || [ -n "${CF_TUNNEL_TOKEN:-}" ] || die "--cloudflare-tunnel-token is required to use a Cloudflare Tunnel"
  if [ "$TLS_MODE" = cloudflare-dns ]; then [ -n "${CF_DNS_TOKEN:-}" ] || die "--cloudflare-dns-token is required for --tls cloudflare-dns"; fi
  if [ "$TLS_MODE" = existing ]; then [ -n "${TLS_CERT:-}" ] && [ -n "${TLS_KEY:-}" ] || die "--tls existing needs --cert-file and --key-file"; fi
  if [ "$MODE" = admin-only ]; then
    [ -n "${DB_PASS:-}" ] || die "admin-only mode needs --db-pass (and usually --db-host/--db-user/--db-name)"
  fi

  # secrets: generated once, then kept in the saved state
  : "${DB_MAILUSER_PASS:=$(gen_secret 28)}"; : "${RC_DB_PASS:=$(gen_secret 28)}"
  : "${RC_DES_KEY:=$(gen_secret 24)}";       : "${JWT_SECRET:=$(gen_secret 64)}"
  if [ "$MODE" = full ]; then DB_PASS="$DB_MAILUSER_PASS"; fi

  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    if [ -f "$ENV_FILE" ] && [ -f "$STATE_FILE" ]; then ADMIN_PASSWORD=""        # keep the existing one
    else ADMIN_PASSWORD="$(gen_secret 20)"; ADMIN_PASSWORD_SHOWN="$ADMIN_PASSWORD"; fi
  else
    [ "${#ADMIN_PASSWORD}" -ge 12 ] || die "--admin-password must be at least 12 characters"
    ADMIN_PASSWORD_SHOWN="(the password you supplied)"
  fi
  if [ "$FIRST_MAILBOX" != "-" ] && [ -z "${FIRST_MAILBOX_PASSWORD:-}" ]; then FIRST_MAILBOX_PASSWORD="$(gen_secret 20)"; fi
  FIRST_MAILBOX_PASSWORD_SHOWN="${FIRST_MAILBOX_PASSWORD:-}"
  [ -z "${FIRST_MAILBOX_PASSWORD:-}" ] || [ "${#FIRST_MAILBOX_PASSWORD}" -ge 12 ] || die "--first-mailbox-password must be at least 12 characters"

  [ "$MODE" = admin-only ] && { WEBMAIL=0; ANTIVIRUS=0; ANTISPAM=0; DKIM=0; }
  AMAVIS_ON=0; { [ "$ANTIVIRUS" = 1 ] || [ "$ANTISPAM" = 1 ]; } && AMAVIS_ON=1
  [ "$IPV6" = 1 ] && INET_PROTOCOLS=all || INET_PROTOCOLS=ipv4
  MAX_MESSAGE_BYTES=$(( MAX_MESSAGE_MB * 1024 * 1024 ))
  CLOUDFLARE_DNS=0; [ "$TLS_MODE" = cloudflare-dns ] && CLOUDFLARE_DNS=1
  : "${CLOUDFLARE_TUNNEL:=0}"
  AMAVIS_OVERRIDE_FILE=/etc/amavis/conf.d/50-user
  NFS_MOUNT_POINT="${NFS_MOUNT_POINT:-}"

  export MAIL_HOSTNAME MAIL_DOMAIN MAILDATA_PATH VMAIL_UID DB_HOST DB_PORT DB_USER DB_PASS DB_NAME \
         MAX_MESSAGE_MB MAX_MESSAGE_BYTES INET_PROTOCOLS INSTALL_DIR API_PORT SERVICE_USER WEBMAIL_NAME \
         ROUNDCUBE_SKIN WEBMAIL_LANGUAGE RC_DB_PASS RC_DES_KEY LOG_RETENTION_DAYS AMAVIS_OVERRIDE_FILE \
         NFS_MOUNT_POINT AMAVIS_BYPASS_LINES=""
  export AMAVIS_MASTER_BLOCK=""
  if [ "$AMAVIS_ON" = 1 ]; then AMAVIS_MASTER_BLOCK="$(cat "$TEMPLATE_DIR/postfix/master.cf.amavis")"$'\n'; fi
}

print_plan() {
  printf '\n%s\n' "${C_BLD}Installation plan${C_RST}"
  printf '  %-22s %s\n' "mode" "$MODE" "version" "$APP_VERSION" "hostname" "$MAIL_HOSTNAME" "mail domain" "$MAIL_DOMAIN"
  printf '  %-22s %s\n' "TLS certificates" "$TLS_MODE$( [ "$LE_STAGING" = 1 ] && echo ' (staging CA)')"
  printf '  %-22s %s\n' "Cloudflare tunnel" "$( [ "$CLOUDFLARE_TUNNEL" = 1 ] && echo "yes (cloudflared, origin http://localhost:8080)" || echo no)"
  printf '  %-22s %s\n' "admin panel allowed" "$ADMIN_ALLOW"
  if [ "$MODE" = full ]; then
    printf '  %-22s %s\n' "mail storage" "$( [ -n "${NFS_SERVER:-}" ] && echo "NFS ${NFS_SERVER} -> ${MAILDATA_PATH}" || echo "local disk ${MAILDATA_PATH}")"
    printf '  %-22s %s\n' "webmail (Roundcube)" "$( [ "$WEBMAIL" = 1 ] && echo "yes, ${ROUNDCUBE_VERSION} (${WEBMAIL_ACCESS})" || echo no)"
    printf '  %-22s %s\n' "spam / virus / DKIM" "$( [ "$ANTISPAM" = 1 ] && echo on || echo off) / $( [ "$ANTIVIRUS" = 1 ] && echo on || echo off) / $( [ "$DKIM" = 1 ] && echo on || echo off)"
    printf '  %-22s %s\n' "fail2ban / firewall" "$( [ "$FAIL2BAN" = 1 ] && echo on || echo off) / ${FIREWALL}"
    printf '  %-22s %s\n' "first mailbox" "$( [ "$FIRST_MAILBOX" = "-" ] && echo none || echo "${FIRST_MAILBOX}@${MAIL_DOMAIN}")"
  else
    printf '  %-22s %s\n' "database" "${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  fi
  printf '\n'
}

# ------------------------------------------------------------------ actions
do_upgrade() {
  [ -f "$STATE_FILE" ] || die "no saved installation found at $STATE_FILE - nothing to upgrade"
  load_state
  apply_defaults
  : "${CLOUDFLARE_TUNNEL:=0}"; : "${CLOUDFLARE_DNS:=0}"; : "${ANTIVIRUS:=0}"; : "${ANTISPAM:=0}"; : "${WEBMAIL:=1}"
  AMAVIS_ON=0; { [ "$ANTIVIRUS" = 1 ] || [ "$ANTISPAM" = 1 ]; } && AMAVIS_ON=1
  NFS_MOUNT_POINT=""; [ -n "${NFS_SERVER:-}" ] && NFS_MOUNT_POINT="$(dirname "$MAILDATA_PATH")"
  [ "$(readlink -f "$APP_SRC_DIR")" != "$(readlink -f "$INSTALL_DIR")" ] || die "run --upgrade from the new release (download it and run its install.sh --upgrade), not from the installed copy"
  local old; old="$(cat "$INSTALL_DIR/VERSION" 2>/dev/null || echo unknown)"
  log "upgrading the admin panel ${old} -> ${APP_VERSION} (mail stack, mailboxes and settings are not touched)"
  export MAIL_HOSTNAME MAIL_DOMAIN MAILDATA_PATH INSTALL_DIR API_PORT SERVICE_USER NFS_MOUNT_POINT
  install_app_files
  # keep the existing env file; only the code, scripts, sudoers and units are refreshed
  MANAGED_SERVICES="$(sed -n 's/^MAIL_ADMIN_MANAGED_SERVICES=//p' "$ENV_FILE" | head -n1)"; export MANAGED_SERVICES
  install_app_support
  run systemctl restart mail-admin
  if [ "$DRY_RUN" != 1 ]; then
    local i; for i in $(seq 1 40); do curl -fsS --max-time 2 "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1 && { ok "upgraded to $(cat "$INSTALL_DIR/VERSION")"; return 0; }; sleep 1; done
    die "the API did not come back after the upgrade - check: journalctl -u mail-admin -n 50"
  fi
}

do_install() {
  apply_defaults
  [ -f "$STATE_FILE" ] && log "found an earlier installation - reusing its saved settings (flags you pass now override them)"

  [ "$MODE" = full ] || WEBMAIL=0
  preflight
  wizard
  validate_and_derive
  print_plan
  if interactive; then
    local go=""; ask_yn go "Proceed with the installation?" yes
    [ "$go" = 1 ] || die "cancelled"
  fi

  if [ "$MODE" = full ]; then STEP_TOTAL=14; else STEP_TOTAL=6; fi

  step "Packages"
  install_packages

  if [ "$MODE" = full ]; then
    step "Mail storage"
    setup_vmail_and_storage
    step "Database"
    setup_database_full
  fi

  step "TLS certificates"
  setup_tls

  if [ "$MODE" = full ]; then
    step "Postfix (SMTP)"
    setup_postfix
    step "Dovecot (IMAP)"
    setup_dovecot
    step "Spam and virus filtering"
    setup_amavis
    step "DKIM"
    setup_opendkim
    step "Webmail (Roundcube)"
    install_roundcube
  fi

  step "Web server"
  setup_apache
  setup_cloudflare_tunnel

  step "Admin panel"
  install_app_files
  [ "$MODE" = admin-only ] && check_database_from_venv
  write_app_env
  install_app_support

  if [ "$MODE" = full ]; then
    step "Hardening"
    setup_fail2ban
    setup_firewall
    step "Initial data and start-up"
    seed_initial_data
    enable_all_services
  else
    setup_fail2ban
    setup_firewall
    enable_all_services
  fi
  start_app

  [ "$MODE" = full ] || true
  step "Verification"
  smoke_tests || true

  [ "$NO_SAVE" = 1 ] || save_state "${SAVED_VARS[@]}"
  final_report
}

main() {
  reset_options
  parse_args "$@"
  if [ "$SHOW_HELP" = 1 ]; then usage; exit 0; fi
  trap 'die "installer stopped on line $LINENO: $BASH_COMMAND"' ERR

  [ "$DRY_RUN" = 1 ] && warn "DRY RUN: nothing will be changed"
  if [ "$DRY_RUN" != 1 ] && [ "$(id -u)" != 0 ]; then die "run as root (sudo)"; fi

  [ -z "$CONFIG_FILE" ] || load_config_file "$CONFIG_FILE"
  if [ "$UPGRADE" = 1 ]; then do_upgrade; exit 0; fi
  load_state
  do_install
}

# allow `source main.sh` from the test harness without running the installer
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
