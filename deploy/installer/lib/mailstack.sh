# shellcheck shell=bash
# MariaDB, Postfix, Dovecot, Amavis/ClamAV/SpamAssassin, OpenDKIM and initial data.

sql_escape() { printf '%s' "$1" | sed "s/'/''/g; s/\\\\/\\\\\\\\/g"; }

# Run SQL as the MariaDB root account (unix_socket authentication, we are root).
mysql_root() { run_stdin "$1" mariadb; }

# ---------------------------------------------------------------- database
setup_database_full() {
  run systemctl enable --now mariadb
  local pw; pw="$(sql_escape "$DB_MAILUSER_PASS")"
  local rcpw; rcpw="$(sql_escape "$RC_DB_PASS")"
  local sql="CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${pw}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${pw}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${pw}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${pw}';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';"
  if [ "$WEBMAIL" = 1 ]; then
    sql+="
CREATE DATABASE IF NOT EXISTS roundcube CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'roundcube'@'localhost' IDENTIFIED BY '${rcpw}';
ALTER USER 'roundcube'@'localhost' IDENTIFIED BY '${rcpw}';
GRANT ALL PRIVILEGES ON roundcube.* TO 'roundcube'@'localhost';"
  fi
  sql+="
FLUSH PRIVILEGES;"
  mysql_root "$sql"
  mysql_root "USE \`${DB_NAME}\`;
$(cat "$TEMPLATE_DIR/sql/schema.sql")"
  ok "databases ready"
}

# admin-only mode: the database already exists somewhere; check it and optionally create the tables.
setup_database_existing() {
  [ -n "${DB_PASS:-}" ] || die "--db-pass is required in admin-only mode"
  if [ "$DRY_RUN" = 1 ]; then echo "${C_YEL}[dry-run]${C_RST} check connection to ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"; return 0; fi
  # python3 + mysql connector are not installed system-wide; the check runs after the venv exists (see app.sh)
  :
}

check_database_from_venv() {
  [ "$DRY_RUN" = 1 ] && return 0
  local schema="$TEMPLATE_DIR/sql/schema.sql"
  MAIL_ADMIN_CHECK_SCHEMA="$schema" MAIL_ADMIN_CREATE_SCHEMA="$CREATE_SCHEMA" \
  MAIL_ADMIN_DB_HOST="$DB_HOST" MAIL_ADMIN_DB_PORT="$DB_PORT" MAIL_ADMIN_DB_USER="$DB_USER" \
  MAIL_ADMIN_DB_PASS="$DB_PASS" MAIL_ADMIN_DB_NAME="$DB_NAME" \
  "$INSTALL_DIR/venv/bin/python" -I - <<'PY' || die "cannot use the database (see message above)"
import os, sys
import mysql.connector
try:
    db = mysql.connector.connect(host=os.environ["MAIL_ADMIN_DB_HOST"], port=int(os.environ["MAIL_ADMIN_DB_PORT"]),
                                 user=os.environ["MAIL_ADMIN_DB_USER"], password=os.environ["MAIL_ADMIN_DB_PASS"],
                                 database=os.environ["MAIL_ADMIN_DB_NAME"])
except Exception as e:
    print("database connection failed:", e); sys.exit(1)
cur = db.cursor()
cur.execute("SHOW TABLES")
have = {r[0] for r in cur.fetchall()}
missing = {"domains", "users", "aliases"} - have
if missing and os.environ["MAIL_ADMIN_CREATE_SCHEMA"] == "1":
    sql = open(os.environ["MAIL_ADMIN_CHECK_SCHEMA"]).read()
    for stmt in [s.strip() for s in sql.split(";") if s.strip() and not s.strip().startswith("--")]:
        cur.execute(stmt)
    db.commit(); print("created tables:", ", ".join(sorted(missing)))
elif missing:
    print("missing tables: %s - re-run with --create-schema or create them (deploy/templates/sql/schema.sql)" % ", ".join(sorted(missing))); sys.exit(1)
else:
    print("database OK (domains, users, aliases present)")
PY
}

# ---------------------------------------------------------------- Postfix
setup_postfix() {
  local f lines
  for f in virtual-mailbox-domains virtual-mailbox-maps virtual-alias-maps sender-login-maps; do
    install_template "postfix/mysql/${f}.cf" "/etc/postfix/mysql/${f}.cf" 640 root:postfix
  done
  run chmod 750 /etc/postfix/mysql 2>/dev/null || true
  run chgrp postfix /etc/postfix/mysql 2>/dev/null || true

  backup_once /etc/postfix/main.cf
  backup_once /etc/postfix/master.cf

  lines="$(render postfix/main.cf.conf)"
  # optional features appended as extra settings
  if [ "$DKIM" = 1 ]; then lines+=$'\n'"smtpd_milters = inet:127.0.0.1:12301"$'\n'"non_smtpd_milters = \$smtpd_milters"$'\n'"milter_default_action = accept"$'\n'"milter_protocol = 6"; fi
  if [ "$AMAVIS_ON" = 1 ]; then lines+=$'\n'"content_filter = smtp-amavis:[127.0.0.1]:10024"; fi
  if [ -n "${RELAYHOST:-}" ]; then
    lines+=$'\n'"relayhost = ${RELAYHOST}"
    if [ -n "${RELAY_USER:-}" ]; then
      lines+=$'\n'"smtp_sasl_auth_enable = yes"$'\n'"smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd"$'\n'"smtp_sasl_security_options = noanonymous"$'\n'"smtp_tls_security_level = encrypt"
      write_file /etc/postfix/sasl_passwd 600 root:root "${RELAYHOST} ${RELAY_USER}:${RELAY_PASS}"
      run postmap /etc/postfix/sasl_passwd
    fi
  fi
  local line
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    run postconf -e "$line"
  done <<< "$lines"

  # master.cf: replace our managed block (idempotent)
  local block
  block="$(render postfix/master.cf.append)"
  if [ "$DRY_RUN" = 1 ]; then
    echo "${C_YEL}[dry-run]${C_RST} update managed block in /etc/postfix/master.cf (submissions :465, 127.0.0.1:587$( [ "$AMAVIS_ON" = 1 ] && echo ', amavis transport'))"
  else
    python3 -I - /etc/postfix/master.cf "$block" <<'PY'
import re, sys
path, block = sys.argv[1], sys.argv[2]
s = open(path).read()
s = re.sub(r"\n?# ---- BEGIN mail-admin.*?# ---- END mail-admin ----\n?", "\n", s, flags=re.S)
open(path, "w").write(s.rstrip("\n") + "\n\n" + block.rstrip("\n") + "\n")
PY
  fi

  # system mail (cron, fail2ban, unattended-upgrades) goes to the first mailbox
  if [ "${FIRST_MAILBOX}" != "-" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      echo "${C_YEL}[dry-run]${C_RST} /etc/aliases: root -> ${FIRST_MAILBOX}@${MAIL_DOMAIN}"
    else
      sed -i '/^root:/d' /etc/aliases 2>/dev/null || true
      echo "root: ${FIRST_MAILBOX}@${MAIL_DOMAIN}" >> /etc/aliases
      newaliases
    fi
  fi

  if [ "$DRY_RUN" != 1 ]; then postfix check || die "postfix check failed (see output above)"; fi
  ok "Postfix configured"
}

# ---------------------------------------------------------------- Dovecot
setup_dovecot() {
  if [ "$DRY_RUN" != 1 ]; then
    local dv; dv="$(dovecot --version 2>/dev/null | awk '{print $1}')"
    if [ "$(printf '%s\n2.4\n' "$dv" | sort -V | head -n1)" != "2.4" ]; then
      die "Dovecot ${dv:-?} is installed but this release configures Dovecot 2.4 (Ubuntu 26.04+). Aborting before touching its configuration."
    fi
  fi
  backup_once /etc/dovecot/dovecot.conf
  install_template dovecot/dovecot.conf /etc/dovecot/dovecot.conf 644 root:root
  [ -e /etc/dovecot/virtual-users ] || write_file /etc/dovecot/virtual-users 644 root:root ""
  # The distribution's conf.d/ files are not included by our minimal config; remove nothing, just stop loading them.
  if [ "$DRY_RUN" != 1 ]; then doveconf -n >/dev/null || die "dovecot configuration is invalid (doveconf failed)"; fi
  ok "Dovecot configured"
}

# ---------------------------------------------------------------- Amavis / ClamAV / SpamAssassin
setup_amavis() {
  [ "$AMAVIS_ON" = 1 ] || { log "Amavis not needed (no antivirus and no antispam selected)"; return 0; }
  local bypass=""
  [ "$ANTIVIRUS" = 1 ] || bypass+='@bypass_virus_checks_maps = (1);'$'\n'
  [ "$ANTISPAM" = 1 ] || bypass+='@bypass_spam_checks_maps = (1);'$'\n'
  export AMAVIS_BYPASS_LINES="${bypass%$'\n'}"
  install_template amavis/15-content_filter_mode /etc/amavis/conf.d/15-content_filter_mode 644 root:root
  [ -e "$AMAVIS_OVERRIDE_FILE" ] || install_template amavis/50-user "$AMAVIS_OVERRIDE_FILE" 644 root:root
  install_template amavis/60-mail-admin /etc/amavis/conf.d/60-mail-admin 644 root:root

  if [ "$ANTIVIRUS" = 1 ]; then
    run adduser --quiet clamav amavis || true
    run adduser --quiet amavis clamav || true
    log "downloading virus signatures (a few minutes)"
    run systemctl stop clamav-freshclam
    try freshclam --quiet
    run systemctl enable --now clamav-freshclam clamav-daemon
    # rkhunter: refresh its baseline after every apt run so package updates do not raise false alarms
    if [ -f /etc/default/rkhunter ] && [ "$DRY_RUN" != 1 ]; then
      sed -i -E 's/^#?\s*APT_AUTOGEN=.*/APT_AUTOGEN="true"/; s/^#?\s*CRON_DAILY_RUN=.*/CRON_DAILY_RUN="false"/; s/^#?\s*CRON_DB_UPDATE=.*/CRON_DB_UPDATE="false"/' /etc/default/rkhunter
    fi
    try rkhunter --propupd --quiet
    write_file /etc/cron.d/mail-admin-security-scan 644 root:root "# Managed by the mail-admin installer. Results show up on the admin panel's System updates page.
30 3 * * * root /usr/local/sbin/mail-admin-clamav-fullscan.sh >/dev/null 2>&1
0 4 * * * root /usr/local/sbin/mail-admin-rkhunter-check.sh >/dev/null 2>&1"
  fi
  if [ "$ANTISPAM" = 1 ]; then
    # Amavis calls SpamAssassin as a library; the standalone spamd daemon (port 783) is not needed.
    try systemctl disable --now spamd spamassassin
    try systemctl enable --now spamassassin-maintenance.timer
  fi
  run systemctl enable --now amavis
  run systemctl restart amavis
  ok "Amavis configured (antivirus: $([ "$ANTIVIRUS" = 1 ] && echo on || echo off), antispam: $([ "$ANTISPAM" = 1 ] && echo on || echo off))"
}

# ---------------------------------------------------------------- OpenDKIM
setup_opendkim() {
  [ "$DKIM" = 1 ] || return 0
  backup_once /etc/opendkim.conf
  install_template opendkim/opendkim.conf /etc/opendkim.conf 644 root:root
  run mkdir -p /etc/opendkim/keys
  [ -e /etc/opendkim/trusted.hosts ] || write_file /etc/opendkim/trusted.hosts 644 root:root "127.0.0.1
::1
localhost"
  run touch /etc/opendkim/key.table /etc/opendkim/signing.table
  run chown -R opendkim:opendkim /etc/opendkim
  run install -m 755 "$DEPLOY_DIR/sbin/mail-admin-dkim-add-domain" /usr/local/sbin/mail-admin-dkim-add-domain
  run /usr/local/sbin/mail-admin-dkim-add-domain "$MAIL_DOMAIN" "$DKIM_SELECTOR"
  ok "OpenDKIM configured for ${MAIL_DOMAIN} (selector ${DKIM_SELECTOR})"
}

# ---------------------------------------------------------------- first domain / first mailbox
rebuild_virtual_users_file() {
  [ "$DRY_RUN" = 1 ] && { echo "${C_YEL}[dry-run]${C_RST} rebuild /etc/dovecot/virtual-users from the database"; return 0; }
  mariadb -N -B "$DB_NAME" -e "SELECT CONCAT(email, ':', password) FROM users WHERE active=1" > /etc/dovecot/virtual-users.new
  chmod 644 /etc/dovecot/virtual-users.new
  mv -f /etc/dovecot/virtual-users.new /etc/dovecot/virtual-users
}

seed_initial_data() {
  mysql_root "USE \`${DB_NAME}\`;
INSERT IGNORE INTO domains (name, active) VALUES ('$(sql_escape "$MAIL_DOMAIN")', 1);"
  if [ "${FIRST_MAILBOX}" = "-" ]; then return 0; fi
  local email="${FIRST_MAILBOX}@${MAIL_DOMAIN}" hash=""
  if [ "$DRY_RUN" = 1 ]; then
    echo "${C_YEL}[dry-run]${C_RST} create mailbox ${email} (password hashed with doveadm pw -s SHA512-CRYPT)"
  else
    if [ "$(mariadb -N -B "$DB_NAME" -e "SELECT COUNT(*) FROM users WHERE email='$(sql_escape "$email")'")" = 0 ]; then
      hash="$(doveadm pw -s SHA512-CRYPT -p "$FIRST_MAILBOX_PASSWORD")"
      mysql_root "USE \`${DB_NAME}\`;
INSERT INTO users (domain_id, email, password, quota_mb)
SELECT id, '$(sql_escape "$email")', '$(sql_escape "$hash")', 10240 FROM domains WHERE name='$(sql_escape "$MAIL_DOMAIN")';"
      FIRST_MAILBOX_CREATED=1
    else
      FIRST_MAILBOX_CREATED=0
      FIRST_MAILBOX_PASSWORD_SHOWN=""     # the freshly generated one was not used
      log "mailbox ${email} already exists - leaving it unchanged"
    fi
    install -d -o vmail -g vmail -m 700 "${MAILDATA_PATH}/${MAIL_DOMAIN}" "${MAILDATA_PATH}/${MAIL_DOMAIN}/${FIRST_MAILBOX}" \
      "${MAILDATA_PATH}/${MAIL_DOMAIN}/${FIRST_MAILBOX}/Maildir" "${MAILDATA_PATH}/${MAIL_DOMAIN}/${FIRST_MAILBOX}/Maildir/new" \
      "${MAILDATA_PATH}/${MAIL_DOMAIN}/${FIRST_MAILBOX}/Maildir/cur" "${MAILDATA_PATH}/${MAIL_DOMAIN}/${FIRST_MAILBOX}/Maildir/tmp"
  fi
  rebuild_virtual_users_file
  ok "domain ${MAIL_DOMAIN} and mailbox ${email} created"
}
