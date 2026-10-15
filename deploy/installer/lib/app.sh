# shellcheck shell=bash
# The mail-admin application itself: files, Python venv, service account, secrets, sudoers, systemd.

ensure_frontend_dist() {
  [ -f "$APP_SRC_DIR/frontend/dist/index.html" ] && return 0
  log "no prebuilt frontend found - building it from source"
  if [ "$DRY_RUN" = 1 ]; then echo "${C_YEL}[dry-run]${C_RST} npm ci && npm run build (in $APP_SRC_DIR/frontend)"; return 0; fi
  local major
  if have node; then major="$(node -v | sed 's/^v//; s/\..*//')"; else major=0; fi
  if [ "$major" -lt 20 ]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm
    major="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//' || echo 0)"
    [ "${major:-0}" -ge 20 ] || die "building the frontend needs Node.js 20+ (found ${major:-none}). Use a release tarball (it ships the built frontend) or install Node.js 22."
  fi
  (cd "$APP_SRC_DIR/frontend" && npm ci --no-audit --no-fund && npm run build) || die "frontend build failed"
}

install_app_files() {
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    run useradd --system --home-dir "$INSTALL_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
  run usermod -aG adm "$SERVICE_USER"      # read access to /var/log/mail.log, apache and roundcube logs

  run mkdir -p "$INSTALL_DIR"
  if [ "$(readlink -f "$APP_SRC_DIR")" != "$(readlink -f "$INSTALL_DIR")" ]; then
    ensure_frontend_dist
    have rsync || { run env DEBIAN_FRONTEND=noninteractive apt-get install -y rsync; }
    run rsync -a --delete \
      --exclude 'api/data/' --exclude '/venv/' --exclude '__pycache__/' --exclude '.git/' --exclude '.github/' \
      --exclude 'frontend/node_modules/' --exclude '.env' \
      "$APP_SRC_DIR"/ "$INSTALL_DIR"/
  fi
  run mkdir -p "$INSTALL_DIR/api/data"

  if [ ! -x "$INSTALL_DIR/venv/bin/python" ] || [ "$DRY_RUN" = 1 ]; then run python3 -m venv "$INSTALL_DIR/venv"; fi
  log "installing Python dependencies"
  run "$INSTALL_DIR/venv/bin/pip" install --quiet --disable-pip-version-check --no-cache-dir -r "$INSTALL_DIR/requirements.txt"
  run "$INSTALL_DIR/venv/bin/python" -m compileall -q "$INSTALL_DIR/api"

  # code is root-owned and read-only for the service; only api/data is writable
  run chown -R root:root "$INSTALL_DIR"
  run chmod -R go-w "$INSTALL_DIR"
  run chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/api/data"
  run chmod 750 "$INSTALL_DIR/api/data"
}

write_app_env() {
  local hash managed
  if [ -n "${ADMIN_PASSWORD:-}" ]; then
    if [ "$DRY_RUN" = 1 ]; then hash='$2b$12$<bcrypt hash of the admin password>'
    else hash="$(printf '%s' "$ADMIN_PASSWORD" | "$INSTALL_DIR/venv/bin/python" -I -c 'import bcrypt,sys; print(bcrypt.hashpw(sys.stdin.read().encode(), bcrypt.gensalt(12)).decode())')"; fi
  else
    # re-run without a new password: keep the hash that is already in place - never hash an empty string
    hash="$(sed -n 's/^MAIL_ADMIN_PASS_HASH=//p' "$ENV_FILE" 2>/dev/null | head -n1)"
    [ -n "$hash" ] || die "no admin password given and no existing one found - pass --admin-password"
  fi

  if [ "$MODE" = admin-only ]; then
    # attach to whatever mail services already run on this host
    managed="apache2"
    local cand
    for cand in postfix dovecot amavis clamav-daemon opendkim fail2ban mariadb; do
      if systemctl list-unit-files "${cand}.service" 2>/dev/null | grep -q "^${cand}.service"; then managed+=",${cand}"; fi
    done
  else
    managed="postfix,dovecot,apache2,mariadb"
    [ "$AMAVIS_ON" = 1 ] && managed+=",amavis"
    [ "$ANTIVIRUS" = 1 ] && managed+=",clamav-daemon"
    [ "$DKIM" = 1 ] && managed+=",opendkim"
    [ "$FAIL2BAN" = 1 ] && managed+=",fail2ban"
  fi
  [ "$CLOUDFLARE_TUNNEL" = 1 ] && managed+=",cloudflared"
  if [ -n "${EXTRA_SERVICES:-}" ]; then
    local x
    for x in $(split_list "$EXTRA_SERVICES"); do
      [[ "$x" =~ ^[A-Za-z0-9_.@-]+$ ]] || die "invalid service name in --extra-services: $x"
      case ",$managed," in *",$x,"*) ;; *) managed+=",$x" ;; esac
    done
  fi
  MANAGED_SERVICES="$managed"; export MANAGED_SERVICES

  local nets; nets="$(split_list "$ADMIN_ALLOW" | grep -v '^any$' | paste -sd, - || true)"
  local internal="${nets:-10.0.0.0/8,172.16.0.0/12,192.168.0.0/16}"

  local env="# Managed by the mail-admin installer (re-running the installer rewrites this file).
MAIL_ADMIN_USER=${ADMIN_USER}
MAIL_ADMIN_PASS_HASH=${hash}
MAIL_ADMIN_JWT_SECRET=${JWT_SECRET}
MAIL_ADMIN_DB_HOST=${DB_HOST}
MAIL_ADMIN_DB_PORT=${DB_PORT}
MAIL_ADMIN_DB_USER=${DB_USER}
MAIL_ADMIN_DB_PASS=${DB_PASS}
MAIL_ADMIN_DB_NAME=${DB_NAME}
MAIL_ADMIN_DEFAULT_DOMAIN=${MAIL_DOMAIN}
MAIL_ADMIN_MAILDATA_PATH=${MAILDATA_PATH}
MAIL_ADMIN_MAILDATA_MOUNT=${NFS_MOUNT_POINT:-}
MAIL_ADMIN_AMAVIS_OVERRIDE_FILE=${AMAVIS_OVERRIDE_FILE:-/etc/amavis/conf.d/50-user}
MAIL_ADMIN_MANAGED_SERVICES=${MANAGED_SERVICES}
MAIL_ADMIN_INTERNAL_NETWORKS=${internal}
WEBAUTHN_RP_ID=${MAIL_HOSTNAME}
WEBAUTHN_RP_NAME=NannanCat Mail Admin
WEBAUTHN_ORIGIN=https://${MAIL_HOSTNAME}"
  [ "$WEBMAIL" = 1 ] && env+=$'\n'"MAIL_ADMIN_ROUNDCUBE_DIR=/var/www/roundcube"
  write_file "$ENV_FILE" 640 "root:${SERVICE_USER}" "$env"
}

derive_sudoers_vars() {
  local svc rules=""
  for svc in $(split_list "$MANAGED_SERVICES"); do
    rules+="${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart ${svc}"$'\n'
  done
  export RESTART_RULES="${rules%$'\n'}"
  export AMAVIS_OVERRIDE_FILE="${AMAVIS_OVERRIDE_FILE:-/etc/amavis/conf.d/50-user}"
}

write_sudoers() {
  derive_sudoers_vars
  local content; content="$(render sudoers/mail-admin)" || die "sudoers render failed"
  if [ "$DRY_RUN" = 1 ]; then
    echo "${C_YEL}[dry-run]${C_RST} install /etc/sudoers.d/mail-admin (validated with visudo -cf)"
    return 0
  fi
  local tmp; tmp="$(mktemp)"
  printf '%s\n' "$content" > "$tmp"
  if ! visudo -cf "$tmp" >/dev/null; then rm -f "$tmp"; die "generated sudoers file failed validation (visudo)"; fi
  install -m 440 -o root -g root "$tmp" /etc/sudoers.d/mail-admin
  rm -f "$tmp"
}

install_app_support() {
  local s
  for s in mail-admin-apt-upgrade.sh mail-admin-clamav-fullscan.sh mail-admin-rkhunter-check.sh \
           mail-admin-roundcube-upgrade.sh mail-admin-sync-ip-lists.sh mail-admin-tls-reload-hook.sh mail-admin-helper; do
    run install -m 755 -o root -g root "$DEPLOY_DIR/sbin/$s" "/usr/local/sbin/$s"
  done
  run install -m 755 -o root -g root "$DEPLOY_DIR/sbin/mail-admin-dkim-add-domain" /usr/local/sbin/mail-admin-dkim-add-domain
  run ln -sfn "$INSTALL_DIR/deploy/installer/main.sh" /usr/local/sbin/mail-admin-install

  install_template systemd/mail-admin.service /etc/systemd/system/mail-admin.service 644 root:root
  install_template systemd/mail-ip-lists-sync.path /etc/systemd/system/mail-ip-lists-sync.path 644 root:root
  install_template systemd/mail-ip-lists-sync.service /etc/systemd/system/mail-ip-lists-sync.service 644 root:root
  run systemctl daemon-reload

  # networks that fail2ban must never ban and that may reach the admin panel
  write_file /etc/mail-admin/trusted-networks.txt 644 root:root "$(split_list "$ADMIN_ALLOW" | grep -v '^any$' || true)"
  run touch /etc/mail-admin/whitelist-ips.txt /etc/mail-admin/blacklist-ips.txt
  run chown root:root /etc/mail-admin/whitelist-ips.txt /etc/mail-admin/blacklist-ips.txt
  write_sudoers
}

start_app() {
  run systemctl enable --now mail-admin
  run systemctl restart mail-admin
  run systemctl enable --now mail-ip-lists-sync.path mail-ip-lists-sync.service
  run systemctl start mail-ip-lists-sync.service
  if [ "$DRY_RUN" = 1 ]; then echo "${C_YEL}[dry-run]${C_RST} wait for http://127.0.0.1:${API_PORT}/api/health"; return 0; fi
  local i
  for i in $(seq 1 40); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; then ok "admin API is up"; return 0; fi
    sleep 1
  done
  journalctl -u mail-admin -n 30 --no-pager >&2 || true
  die "the admin API did not become healthy within 40 s (log above)"
}
