# shellcheck shell=bash
# Packages, mail storage (local disk or NFS) and TLS certificates.

# ---------------------------------------------------------------- packages
packages_for_selection() {
  local pk=(ca-certificates curl openssl python3 python3-venv python3-pip sudo rsyslog gnupg cron)
  if [ "$MODE" = full ]; then
    pk+=(mariadb-server postfix postfix-mysql dovecot-core dovecot-imapd nftables)
    [ "$DKIM" = 1 ] && pk+=(opendkim opendkim-tools)
    if [ "$ANTISPAM" = 1 ] || [ "$ANTIVIRUS" = 1 ]; then pk+=(amavisd-new); fi
    [ "$ANTISPAM" = 1 ] && pk+=(spamassassin spamc)
    [ "$ANTIVIRUS" = 1 ] && pk+=(clamav-daemon clamav-freshclam rkhunter)
    pk+=(apache2)
    if [ "$WEBMAIL" = 1 ]; then pk+=(libapache2-mod-php php-cli php-mysql php-mbstring php-intl php-xml php-zip php-curl php-gd); fi
    [ -n "${RELAYHOST:-}" ] && pk+=(libsasl2-modules)
  else
    pk+=(apache2 nftables)
  fi
  case "$TLS_MODE" in
    letsencrypt) pk+=(certbot) ;;
    cloudflare-dns) pk+=(certbot python3-certbot-dns-cloudflare) ;;
  esac
  [ "$FAIL2BAN" = 1 ] && pk+=(fail2ban)
  [ "$FIREWALL" = ufw ] && pk+=(ufw)
  [ -n "${NFS_SERVER:-}" ] && pk+=(nfs-common)
  printf '%s\n' "${pk[@]}"
}

install_packages() {
  local pk
  mapfile -t pk < <(packages_for_selection)
  log "installing ${#pk[@]} packages (this takes a few minutes)"
  if [ "$MODE" = full ]; then
    # keep Postfix's installer from asking questions
    run_stdin "postfix postfix/main_mailer_type select Internet Site
postfix postfix/mailname string ${MAIL_HOSTNAME}
postfix postfix/destinations string ${MAIL_HOSTNAME}, localhost
" debconf-set-selections
    run_stdin "${MAIL_HOSTNAME}
" tee /etc/mailname >/dev/null
  fi
  run env DEBIAN_FRONTEND=noninteractive apt-get update
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y "${pk[@]}"
}

# ---------------------------------------------------------------- mail storage
setup_vmail_and_storage() {
  if ! getent group vmail >/dev/null; then run groupadd -g "$VMAIL_UID" vmail; fi
  if ! getent passwd vmail >/dev/null; then
    run useradd -g vmail -u "$VMAIL_UID" -d "$MAILDATA_PATH" -M -s /usr/sbin/nologin vmail
  fi

  if [ -n "${NFS_SERVER:-}" ]; then
    NFS_MOUNT_POINT="$(dirname "$MAILDATA_PATH")"
    [ "$NFS_MOUNT_POINT" != "/" ] || die "--maildata-path must be a subdirectory of the NFS mount (e.g. /mnt/maildata/homes)"
    export NFS_MOUNT_POINT
    log "mail storage: NFS ${NFS_SERVER} -> ${NFS_MOUNT_POINT}"
    run mkdir -p "$NFS_MOUNT_POINT"
    local fstab_line="${NFS_SERVER} ${NFS_MOUNT_POINT} nfs ${NFS_OPTIONS} 0 0"
    if [ "$DRY_RUN" = 1 ]; then
      echo "${C_YEL}[dry-run]${C_RST} ensure /etc/fstab contains: $fstab_line"
    else
      grep -qsF " ${NFS_MOUNT_POINT} nfs " /etc/fstab || printf '%s\n' "# mail storage (added by the mail-admin installer)" "$fstab_line" >> /etc/fstab
      systemctl daemon-reload
      mountpoint -q "$NFS_MOUNT_POINT" || mount "$NFS_MOUNT_POINT" || die "could not mount ${NFS_SERVER} on ${NFS_MOUNT_POINT}. Check the export, firewall and (for root_squash exports) that uid ${VMAIL_UID} may write."
    fi
    # Postfix and Dovecot must not start before the mount exists, otherwise they would write into the empty mount point.
    local unit
    for unit in postfix dovecot; do
      install_template systemd/nfs-mail-storage.conf "/etc/systemd/system/${unit}.service.d/nfs-mail-storage.conf" 644 root:root
    done
    run systemctl daemon-reload
  else
    NFS_MOUNT_POINT=""; export NFS_MOUNT_POINT
    log "mail storage: local disk at ${MAILDATA_PATH}"
  fi

  run mkdir -p "$MAILDATA_PATH"
  run chown vmail:vmail "$MAILDATA_PATH"
  run chmod 750 "$MAILDATA_PATH"
  if [ "$DRY_RUN" != 1 ] && [ -n "$NFS_MOUNT_POINT" ]; then
    sudo -u vmail test -w "$MAILDATA_PATH" || warn "uid ${VMAIL_UID} cannot write to ${MAILDATA_PATH} on the NFS export - mail delivery will fail until the export allows it (check root_squash / squash mapping on the NAS)."
  fi
}

# ---------------------------------------------------------------- TLS
# Postfix, Dovecot and Apache all read /etc/mail-admin/tls/{fullchain,privkey}.pem. Those are symlinks, so
# switching from a placeholder certificate to a real one never needs a config change.
TLS_DIR=/etc/mail-admin/tls

tls_link() {  # tls_link CERT KEY
  run mkdir -p "$TLS_DIR"; run chmod 755 /etc/mail-admin; run chmod 700 "$TLS_DIR"
  run ln -sfn "$1" "$TLS_DIR/fullchain.pem"
  run ln -sfn "$2" "$TLS_DIR/privkey.pem"
}

tls_selfsigned() {
  local d="$TLS_DIR/selfsigned" san="DNS:${MAIL_HOSTNAME}" a
  for a in $(split_list "${ALIAS_HOSTNAMES:-}"); do san+=",DNS:${a}"; done
  run mkdir -p "$d"; run chmod 700 "$TLS_DIR" "$d"
  if [ ! -s "$d/fullchain.pem" ] || [ "$DRY_RUN" = 1 ]; then
    run openssl req -x509 -newkey rsa:3072 -sha256 -days 825 -nodes \
      -keyout "$d/privkey.pem" -out "$d/fullchain.pem" \
      -subj "/CN=${MAIL_HOSTNAME}" -addext "subjectAltName=${san}"
    run chmod 600 "$d/privkey.pem"
  fi
  tls_link "$d/fullchain.pem" "$d/privkey.pem"
}

tls_certbot_domains() {
  local args=(-d "$MAIL_HOSTNAME") a
  for a in $(split_list "${ALIAS_HOSTNAMES:-}"); do args+=(-d "$a"); done
  printf '%s\n' "${args[@]}"
}

setup_tls() {
  run mkdir -p "$TLS_DIR"; run chmod 700 "$TLS_DIR"
  TLS_PENDING=0

  case "$TLS_MODE" in
    selfsigned)
      warn "self-signed certificate: mail clients and browsers will show warnings. Fine for testing only."
      tls_selfsigned ;;
    existing)
      [ -r "$TLS_CERT" ] && [ -r "$TLS_KEY" ] || [ "$DRY_RUN" = 1 ] || die "--cert-file/--key-file not readable"
      tls_link "$TLS_CERT" "$TLS_KEY" ;;
    letsencrypt|cloudflare-dns)
      # Placeholder first, so every service can start and Apache's config is valid even if issuance fails.
      tls_selfsigned
      local cb=(certbot certonly --non-interactive --agree-tos --cert-name "$MAIL_HOSTNAME" --keep-until-expiring)
      if [ -n "${LE_EMAIL:-}" ]; then cb+=(-m "$LE_EMAIL"); else cb+=(--register-unsafely-without-email); fi
      [ "$LE_STAGING" = 1 ] && cb+=(--staging)
      mapfile -t doms < <(tls_certbot_domains)
      if [ "$TLS_MODE" = letsencrypt ]; then
        run mkdir -p /var/www/html
        cb+=(--webroot -w /var/www/html "${doms[@]}")
        log "requesting a Let's Encrypt certificate (HTTP-01; port 80 of ${MAIL_HOSTNAME} must reach this server)"
      else
        local ini=/etc/letsencrypt/cloudflare.ini
        write_file "$ini" 600 root:root "# Managed by the mail-admin installer
dns_cloudflare_api_token = ${CF_DNS_TOKEN}"
        cb+=(--dns-cloudflare --dns-cloudflare-credentials "$ini" --dns-cloudflare-propagation-seconds 30 "${doms[@]}")
        log "requesting a Let's Encrypt certificate (DNS-01 through the Cloudflare API)"
      fi
      if [ "$DRY_RUN" = 1 ]; then
        echo "${C_YEL}[dry-run]${C_RST} ${cb[*]}"
      elif "${cb[@]}"; then
        tls_link "/etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem" "/etc/letsencrypt/live/${MAIL_HOSTNAME}/privkey.pem"
        ok "certificate issued"
      else
        TLS_PENDING=1
        warn "certificate issuance FAILED - continuing with a self-signed placeholder certificate."
        warn "Fix the cause (usually DNS: ${MAIL_HOSTNAME} must point at this server) and re-run: sudo mail-admin-install --yes"
      fi
      write_file /etc/letsencrypt/renewal-hooks/deploy/mail-admin-reload.sh 755 root:root "$(cat "$DEPLOY_DIR/sbin/mail-admin-tls-reload-hook.sh")" ;;
    *) die "unknown --tls mode: $TLS_MODE (letsencrypt | cloudflare-dns | existing | selfsigned)" ;;
  esac
  export TLS_PENDING
}
