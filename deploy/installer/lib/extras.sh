# shellcheck shell=bash
# fail2ban, firewall, service start-up, smoke tests and the final report.

setup_fail2ban() {
  [ "$FAIL2BAN" = 1 ] || return 0
  export FAIL2BAN_IGNORE=""
  install_template fail2ban/jail.local /etc/fail2ban/jail.local 644 root:root
  run systemctl enable --now fail2ban
}

setup_firewall() {
  [ "$FIREWALL" = ufw ] || return 0
  local ssh_ports p
  ssh_ports="$(sshd -T 2>/dev/null | awk '$1=="port"{print $2}' | sort -u | tr '\n' ' ')"
  ssh_ports="${ssh_ports:-22}"
  log "firewall (ufw): allowing SSH (${ssh_ports}), 25, 465, 993, 443 and 80"
  for p in $ssh_ports 25 465 993 443 80; do run ufw allow "${p}/tcp"; done
  run ufw default deny incoming
  run ufw default allow outgoing
  run ufw --force enable
}

enable_all_services() {
  local s
  if [ "$MODE" = full ]; then
    for s in mariadb postfix dovecot; do run systemctl enable "$s"; done
    [ "$DKIM" = 1 ] && run systemctl enable opendkim
    [ "$DKIM" = 1 ] && run systemctl restart opendkim
    run systemctl restart dovecot
    run systemctl restart postfix
  fi
  run systemctl restart apache2
}

# ---------------------------------------------------------------- smoke tests
smoke_tests() {
  [ "$DRY_RUN" = 1 ] && { echo "${C_YEL}[dry-run]${C_RST} smoke tests: service states, listening ports, IMAP + SMTP login, test message delivery"; return 0; }
  local s bad=0 svc_list=(mail-admin apache2)
  if [ "$MODE" = full ]; then
    svc_list+=(mariadb postfix dovecot)
    [ "$AMAVIS_ON" = 1 ] && svc_list+=(amavis)
    [ "$ANTIVIRUS" = 1 ] && svc_list+=(clamav-daemon)
    [ "$DKIM" = 1 ] && svc_list+=(opendkim)
    [ "$FAIL2BAN" = 1 ] && svc_list+=(fail2ban)
  fi
  [ "$CLOUDFLARE_TUNNEL" = 1 ] && svc_list+=(cloudflared)
  for s in "${svc_list[@]}"; do
    if systemctl is-active --quiet "$s"; then ok "$s is running"; else warn "$s is NOT running  (journalctl -u $s -n 50)"; bad=1; fi
  done

  if [ "$MODE" = full ]; then
    local port
    for port in 25 465 993 443; do
      if ss -H -ltn "sport = :$port" | grep -q .; then ok "port $port is listening"; else warn "nothing listens on port $port"; bad=1; fi
    done
  fi

  local code
  code="$(curl -ks -o /dev/null -w '%{http_code}' --max-time 10 --resolve "${MAIL_HOSTNAME}:443:127.0.0.1" "https://${MAIL_HOSTNAME}/admin/" || true)"
  if [ "$code" = 200 ]; then ok "https://${MAIL_HOSTNAME}/admin/ answers (200)"; else warn "admin panel returned HTTP ${code:-none} on localhost"; bad=1; fi

  if [ "$MODE" = full ] && [ "${FIRST_MAILBOX}" != "-" ] && [ -n "${FIRST_MAILBOX_PASSWORD:-}" ] && [ "${FIRST_MAILBOX_CREATED:-0}" = 1 ]; then
    local email="${FIRST_MAILBOX}@${MAIL_DOMAIN}"
    if SMOKE_USER="$email" SMOKE_PASS="$FIRST_MAILBOX_PASSWORD" python3 -I - <<'PY'
import imaplib, os, smtplib, ssl, sys
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
u, p = os.environ["SMOKE_USER"], os.environ["SMOKE_PASS"]
try:
    m = imaplib.IMAP4_SSL("127.0.0.1", 993, ssl_context=ctx, timeout=15); m.login(u, p); m.logout()
    print("IMAP login ok")
    s = smtplib.SMTP("127.0.0.1", 587, timeout=20); s.starttls(context=ctx); s.login(u, p); s.quit()
    print("SMTP AUTH ok")
except Exception as e:
    print("login test failed:", e); sys.exit(1)
PY
    then ok "IMAP and SMTP logins work for ${email}"; else warn "mail login test for ${email} failed - check: journalctl -u dovecot -u postfix"; bad=1; fi

    # end-to-end: send a message to ourselves and wait for it to land in the Maildir
    local box="${MAILDATA_PATH}/${MAIL_DOMAIN}/${FIRST_MAILBOX}/Maildir/new" before after i
    before="$(ls "$box" 2>/dev/null | wc -l)"
    SMOKE_USER="$email" SMOKE_PASS="$FIRST_MAILBOX_PASSWORD" python3 -I - <<'PY' || true
import os, smtplib, ssl
from email.message import EmailMessage
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
u, p = os.environ["SMOKE_USER"], os.environ["SMOKE_PASS"]
msg = EmailMessage(); msg["From"] = u; msg["To"] = u; msg["Subject"] = "mail-admin installer test message"
msg.set_content("If you can read this, Postfix -> Amavis -> Postfix -> Dovecot delivery works.")
s = smtplib.SMTP("127.0.0.1", 587, timeout=20); s.starttls(context=ctx); s.login(u, p); s.send_message(msg); s.quit()
PY
    after="$before"
    for i in $(seq 1 45); do
      after="$(ls "$box" 2>/dev/null | wc -l)"
      [ "$after" -gt "$before" ] && break
      sleep 2
    done
    if [ "$after" -gt "$before" ]; then ok "test message delivered end to end"
    else warn "test message was not delivered within 90 s (ClamAV may still be loading - check: postqueue -p ; tail /var/log/mail.log)"; fi
  fi
  SMOKE_FAILED="$bad"
}

# ---------------------------------------------------------------- report
dkim_txt_value() {
  local f="/etc/opendkim/keys/${MAIL_DOMAIN}/${DKIM_SELECTOR}.txt"
  [ -r "$f" ] || return 0
  tr -d '\n\t' < "$f" | sed -E 's/^[^(]*\(//; s/\)[^)]*$//; s/" +"//g; s/"//g'
}

final_report() {
  local public_ip dkim url admin_url report web_note="" cf_note="" p80=""
  public_ip="$(detect_public_ip)"; public_ip="${public_ip:-<server public IP>}"
  admin_url="https://${MAIL_HOSTNAME}/admin/"
  url="https://${MAIL_HOSTNAME}/roundcube/"
  dkim="$(dkim_txt_value || true)"
  if [ "$WEBMAIL_ACCESS" = internal ]; then web_note="   (restricted to: ${ADMIN_ALLOW})"; fi
  if [ "$CLOUDFLARE_DNS" = 1 ]; then cf_note=", e.g. Cloudflare - keep the mail host DNS-only (grey cloud)"; fi
  if [ "$TLS_MODE" = letsencrypt ]; then p80=", 80 (certificate renewal)"; fi

  report="mail-admin ${APP_VERSION} - installation summary ($(date -Is))

ADMIN PANEL
  URL        ${admin_url}   (reachable from: ${ADMIN_ALLOW})
  user       ${ADMIN_USER}
  password   ${ADMIN_PASSWORD_SHOWN:-<unchanged - the password from the earlier installation is still valid>}
"
  if [ "$WEBMAIL" = 1 ]; then
    report+="
WEBMAIL
  URL        ${url}${web_note}
"
    [ "$CLOUDFLARE_TUNNEL" = 1 ] && report+="  via tunnel  point the tunnel's public hostname at  http://localhost:8080
"
  fi
  if [ "$MODE" = full ] && [ "${FIRST_MAILBOX}" != "-" ]; then
    report+="
FIRST MAILBOX
  address    ${FIRST_MAILBOX}@${MAIL_DOMAIN}
  password   ${FIRST_MAILBOX_PASSWORD_SHOWN:-<unchanged>}
  IMAP       ${MAIL_HOSTNAME}:993 (SSL/TLS)      SMTP  ${MAIL_HOSTNAME}:465 (SSL/TLS) with login
"
  fi
  if [ "$MODE" = full ]; then
    report+="
DNS RECORDS TO CREATE (at your DNS provider${cf_note})
  A      ${MAIL_HOSTNAME}                 ${public_ip}
  MX     ${MAIL_DOMAIN}                   10 ${MAIL_HOSTNAME}.
  TXT    ${MAIL_DOMAIN}                   \"v=spf1 mx ~all\"
"
    [ -n "$dkim" ] && report+="  TXT    ${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}   \"${dkim}\"
"
    report+="  TXT    _dmarc.${MAIL_DOMAIN}            \"v=DMARC1; p=none; rua=mailto:${FIRST_MAILBOX/#-/postmaster}@${MAIL_DOMAIN}\"   (tighten to p=quarantine once mail flows)
  PTR    ${public_ip}  ->  ${MAIL_HOSTNAME}   (reverse DNS - set at your ISP / VPS provider; many receivers reject mail without it)

PORTS TO OPEN ON YOUR ROUTER / CLOUD FIREWALL
  25 (receive mail), 465 (mail clients: send), 993 (mail clients: read), 443 (web)${p80}
  Many ISPs and clouds block outbound port 25 - if outgoing mail never arrives, use a smarthost (--relayhost).
"
  fi
  if [ "${TLS_PENDING:-0}" = 1 ]; then
    report+="
!! CERTIFICATE NOT ISSUED - a self-signed placeholder is in use. Fix DNS / the Cloudflare token, then run:
     sudo mail-admin-install --yes
"
  fi
  report+="
FILES
  settings & generated passwords   ${STATE_FILE}   (root only)
  panel environment                /etc/mail-admin/mail-admin.env
  this report                      ${CRED_FILE}
  re-run / change options          sudo mail-admin-install --help
  upgrade the panel                sudo mail-admin-install --upgrade
  add a DKIM domain                sudo mail-admin-dkim-add-domain example.org
"
  write_file "$CRED_FILE" 600 root:root "$report"
  printf '\n%s\n' "${C_BLD}============================ DONE ============================${C_RST}"
  printf '%s\n' "$report"
  printf '%s\n' "(this report is saved in ${CRED_FILE} - delete it once you have stored the passwords)"
}
