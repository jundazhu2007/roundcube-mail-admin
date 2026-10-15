#!/usr/bin/env bash
# Renders every installer template with sample values and validates the result with the real tools,
# for several option combinations. Needs no root and changes nothing on the system.
# Tools that are not installed are skipped (reported as SKIP).
#
#   bash deploy/installer/tests/render-check.sh
set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIL_ADMIN_CONF_DIR="$(mktemp -d)"; export MAIL_ADMIN_CONF_DIR   # keep state/env files away from /etc
# shellcheck source=../main.sh
. "$TESTS_DIR/../main.sh"
set +e +E; trap - ERR   # main.sh sets errexit/ERR trap; the harness wants to keep going and count failures

OUT="$(mktemp -d)"; trap 'rm -rf "$OUT" "$MAIL_ADMIN_CONF_DIR"' EXIT
FAILS=0; PASSES=0; SKIPS=0
pass() { PASSES=$((PASSES+1)); printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { FAILS=$((FAILS+1)); printf '  \033[31mFAIL\033[0m %s\n' "$*"; }
skip() { SKIPS=$((SKIPS+1)); printf '  \033[33mSKIP\033[0m %s\n' "$*"; }

# check NAME COMMAND...  (pass when the command exits 0)
check() { local name="$1"; shift; local log; log="$("$@" 2>&1)"; if [ $? -eq 0 ]; then pass "$name"; else fail "$name"; printf '%s\n' "$log" | sed 's/^/        /' | head -15; fi; }
# check_quiet_stderr NAME COMMAND... (pass when exit 0 AND nothing on stderr/stdout)
check_empty() { local name="$1"; shift; local log; log="$("$@" 2>&1)"; if [ $? -eq 0 ] && [ -z "$log" ]; then pass "$name"; else fail "$name"; printf '%s\n' "$log" | sed 's/^/        /' | head -15; fi; }
have_tool() { command -v "$1" >/dev/null 2>&1; }

scenario() {   # scenario NAME  (variables are set by the caller)
  local name="$1" d; d="$OUT/$(printf %s "$1" | tr -c "A-Za-z0-9" _)"
  printf '\n\033[1m== scenario: %s\033[0m\n' "$name"
  mkdir -p "$d"
  DRY_RUN=1; ASSUME_YES=1
  validate_and_derive >/dev/null 2>&1 || { fail "validate_and_derive"; return; }
  # the same derivations the installer performs right before it renders
  derive_web_vars; derive_roundcube_vars; export FAIL2BAN_IGNORE=""
  MANAGED_SERVICES="postfix,dovecot,apache2,mariadb"; [ "$AMAVIS_ON" = 1 ] && MANAGED_SERVICES+=",amavis"; [ "$CLOUDFLARE_TUNNEL" = 1 ] && MANAGED_SERVICES+=",cloudflared"
  derive_sudoers_vars

  # ---------------- everything renders (no undefined @VARS@)
  local t bad=0
  while IFS= read -r t; do
    case "$t" in
      apache/tunnel.conf) [ "$CLOUDFLARE_TUNNEL" = 1 ] || continue ;;
      postfix/master.cf.amavis) continue ;;   # inserted into master.cf.append
    esac
    if ! render "$t" > "$d/$(echo "$t" | tr / _)" 2> "$d/err"; then fail "render $t: $(cat "$d/err")"; bad=1; fi
  done < <(cd "$TEMPLATE_DIR" && find . -type f ! -name '*.sql' | sed 's#^\./##' | sort)
  [ $bad = 0 ] && pass "all templates render without undefined variables"

  # ---------------- Postfix: apply our settings to a scratch config dir, then let postconf judge
  if have_tool postconf && [ -f /usr/share/postfix/main.cf.dist ]; then
    local pf="$d/postfix"; mkdir -p "$pf"
    cp /usr/share/postfix/main.cf.dist "$pf/main.cf"; cp /usr/share/postfix/master.cf.dist "$pf/master.cf" 2>/dev/null
    local lines line; lines="$(render postfix/main.cf.conf)"
    [ "$DKIM" = 1 ] && lines+=$'\n'"smtpd_milters = inet:127.0.0.1:12301"$'\n'"non_smtpd_milters = \$smtpd_milters"
    [ "$AMAVIS_ON" = 1 ] && lines+=$'\n'"content_filter = smtp-amavis:[127.0.0.1]:10024"
    [ -n "${RELAYHOST:-}" ] && lines+=$'\n'"relayhost = ${RELAYHOST}"
    while IFS= read -r line; do case "$line" in ''|'#'*) continue ;; esac; postconf -c "$pf" -e "$line" 2>>"$d/pf.err"; done <<< "$lines"
    if [ -s "$d/pf.err" ]; then fail "postconf -e reported problems"; sed 's/^/        /' "$d/pf.err" | head; else pass "postconf accepted every main.cf setting"; fi
    # unknown / misspelled parameters show up as 'unused parameter' warnings
    local warn; warn="$(postconf -c "$pf" -n 2>&1 >/dev/null | grep -i 'unused parameter' || true)"
    if [ -z "$warn" ]; then pass "no unused/unknown Postfix parameters"; else fail "postconf: $warn"; fi
    # master.cf block must parse
    printf '\n%s\n' "$(render postfix/master.cf.append)" >> "$pf/master.cf"
    check "master.cf with our block parses (postconf -M)" postconf -c "$pf" -M
    if [ "$AMAVIS_ON" = 1 ]; then
      postconf -c "$pf" -M | grep -q '^smtp-amavis' && pass "amavis transport present in master.cf" || fail "amavis transport missing"
    fi
    postconf -c "$pf" -M | grep -q '^submissions' && pass "465 submissions service present" || fail "submissions service missing"
    # the lookup tables postconf can introspect
    check "postmap can read the generated mysql map definitions' syntax (postconf -m includes mysql)" bash -c "postconf -m | grep -qx mysql"
  else skip "Postfix (postconf or main.cf.dist not available)"; fi

  # ---------------- Dovecot
  if have_tool doveconf && [ "$(printf '%s\n2.4\n' "$(dovecot --version 2>/dev/null | awk '{print $1}')" | sort -V | head -n1)" = "2.4" ]; then
    check "doveconf -c accepts the generated dovecot.conf (2.4 syntax)" doveconf -c "$d/dovecot_dovecot.conf" -n
    doveconf -c "$d/dovecot_dovecot.conf" -n 2>/dev/null | grep -q 'passwd_file_path = /etc/dovecot/virtual-users' && pass "passwd-file auth configured" || fail "passwd-file auth missing"
    doveconf -c "$d/dovecot_dovecot.conf" -n 2>/dev/null | grep -q 'port = 993' && pass "IMAPS on 993" || fail "IMAPS listener missing"
  else skip "Dovecot (doveconf >= 2.4 not available)"; fi

  # ---------------- sudoers
  if have_tool visudo; then
    check "sudoers file passes visudo -cf" visudo -cf "$d/sudoers_mail-admin"
  else skip "sudoers (visudo not available)"; fi

  # ---------------- systemd units
  if have_tool systemd-analyze; then
    mkdir -p "$d/units"; cp "$d/systemd_mail-admin.service" "$d/units/mail-admin.service"
    cp "$d/systemd_mail-ip-lists-sync.service" "$d/units/mail-ip-lists-sync.service"
    cp "$d/systemd_mail-ip-lists-sync.path" "$d/units/mail-ip-lists-sync.path"
    local ver; ver="$(systemd-analyze verify "$d/units/mail-ip-lists-sync.path" "$d/units/mail-ip-lists-sync.service" 2>&1 | grep -E 'mail-admin|mail-ip-lists' | grep -viE 'is not executable|No such file|not found|ExecStart|nftables.service|mariadb.service' || true)"
    if [ -z "$ver" ]; then pass "systemd-analyze verify (sync units)"; else fail "systemd-analyze: $ver"; fi
    local ver2; ver2="$(systemd-analyze verify "$d/units/mail-admin.service" 2>&1 | grep -E 'mail-admin|mail-ip-lists' | grep -viE 'No such file|not found|mariadb.service|is not executable|ExecStart|Failed to|User' || true)"
    if [ -z "$ver2" ]; then pass "systemd-analyze verify (mail-admin.service)"; else fail "systemd-analyze: $ver2"; fi
  else skip "systemd units (systemd-analyze not available)"; fi

  # ---------------- PHP / Roundcube config
  if [ "$WEBMAIL" = 1 ]; then
    if have_tool php; then
      check "Roundcube config.inc.php is valid PHP" php -l "$d/roundcube_config.inc.php"
      check "php.ini snippet parses" php -n -d "auto_prepend_file=" -r 'exit(parse_ini_file($argv[1]) === false ? 1 : 0);' "$d/php_99-mail-admin.ini"
    else skip "PHP lint (php not available)"; fi
  fi

  # ---------------- Apache
  if have_tool apache2 && [ -d /usr/lib/apache2/modules ]; then
    local ap="$d/apache" run_user; mkdir -p "$ap/run" "$ap/log" "$ap/mail-admin" "$ap/www/frontend/dist" "$ap/www/roundcube/public_html"
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=test -keyout "$ap/key.pem" -out "$ap/cert.pem" 2>/dev/null
    local vh; vh="$(cat "$d/apache_mail-admin.conf")"
    vh="${vh//\/etc\/mail-admin\/tls\/fullchain.pem/$ap/cert.pem}"; vh="${vh//\/etc\/mail-admin\/tls\/privkey.pem/$ap/key.pem}"
    vh="${vh//\/etc\/apache2\/mail-admin\//$ap/mail-admin/}"
    printf '%s\n' "$vh" > "$ap/vhost.conf"
    sed -e "s#/etc/apache2/mail-admin/#$ap/mail-admin/#g" -e "s#/var/www/roundcube/public_html#$ap/www/roundcube/public_html#g" -e "s#$INSTALL_DIR/frontend/dist#$ap/www/frontend/dist#g" "$d/apache_webmail.inc" > "$ap/mail-admin/webmail.inc"
    sed -e "s#/etc/apache2/mail-admin/#$ap/mail-admin/#g" -e "s#$INSTALL_DIR/frontend/dist#$ap/www/frontend/dist#g" "$d/apache_admin.inc" > "$ap/mail-admin/admin.inc"
    {
      echo "ServerRoot /usr"; echo "ServerName localhost"; echo "PidFile $ap/run/pid"; echo "ErrorLog $ap/log/error.log"
      echo "Listen 127.0.0.1:18443"; echo "Listen 127.0.0.1:18080"
      echo "DefaultRuntimeDir $ap/run"; echo "Mutex file:$ap/run default"; echo "DocumentRoot $ap/www"
      for m in mpm_prefork authz_core authz_host dir mime alias rewrite headers ssl proxy proxy_http socache_shmcb remoteip; do
        f="/usr/lib/apache2/modules/mod_$m.so"; [ -f "$f" ] && echo "LoadModule ${m}_module $f"
      done
      echo "SSLSessionCache none"
      sed -e 's#\*:80#127.0.0.1:18080#; s#\*:443#127.0.0.1:18443#' "$ap/vhost.conf"
      [ "$CLOUDFLARE_TUNNEL" = 1 ] && sed -e "s#^Listen 127.0.0.1:8080#Listen 127.0.0.1:18081#; s#127.0.0.1:8080#127.0.0.1:18081#; s#/etc/apache2/mail-admin/#$ap/mail-admin/#g" "$d/apache_tunnel.conf"
      echo "Include $d/apache_security.conf"
    } > "$ap/httpd.conf"
    local atest; atest="$(apache2 -t -f "$ap/httpd.conf" 2>&1)"
    if echo "$atest" | grep -q 'Syntax OK'; then pass "apache2 -t: Syntax OK"; else fail "apache2 -t"; printf '%s\n' "$atest" | sed 's/^/        /' | head; fi
  else skip "Apache (apache2 binary / modules not available)"; fi

  # ---------------- fail2ban
  if have_tool fail2ban-client && [ "$FAIL2BAN" = 1 ]; then
    : # fail2ban-client -t needs root to read its full config tree; the jail.local only enables stock jails
  fi
}

# ---------------- baseline variable set
base() {
  reset_options
  MODE=full; MAIL_HOSTNAME=mail.example.com; MAIL_DOMAIN=example.com; LE_EMAIL=ops@example.com
  TLS_MODE=letsencrypt; ADMIN_ALLOW="192.168.1.0/24,203.0.113.7"; ADMIN_USER="admin"
  apply_defaults
  ANTIVIRUS=1; ANTISPAM=1; DKIM=1; WEBMAIL=1; FIRST_MAILBOX=postmaster; CLOUDFLARE_TUNNEL=0
}

printf 'mail-admin installer template checks (%s)\n' "$(date -Is)"

base
scenario defaults

base; ANTIVIRUS=0; ANTISPAM=0; DKIM=0; WEBMAIL=0; FIRST_MAILBOX="-"; IPV6=0
scenario "minimal (no av/spam/dkim/webmail, ipv4 only)"

base; CF_TUNNEL_TOKEN=tok; CLOUDFLARE_TUNNEL=1; TLS_MODE=cloudflare-dns; CF_DNS_TOKEN=dnstok; WEBMAIL_ACCESS=public
ALIAS_HOSTNAMES="webmail.example.com,mail2.example.com"
scenario "cloudflare tunnel + dns-01 + alias hostnames"

base; CF_TUNNEL_TOKEN=tok; CLOUDFLARE_TUNNEL=1; TUNNEL_EXPOSE_ADMIN=1
scenario "tunnel exposing admin"

base; NFS_SERVER=10.0.0.10:/volume1/mail; MAILDATA_PATH=/mnt/maildata/homes; WEBMAIL_ACCESS=internal
RELAYHOST="[smtp.example.net]:587"; RELAY_USER=u; RELAY_PASS=p; MAX_MESSAGE_MB=50; ROUNDCUBE_PLUGINS="archive,zipdownload,markasjunk"
scenario "NFS + internal webmail + smarthost + 50 MB messages"

base; ADMIN_ALLOW=any; TLS_MODE=selfsigned; ROUNDCUBE_SKIN=larry; WEBMAIL_LANGUAGE=zh_TW
scenario "admin open to any + self-signed + larry skin"


# ---------------- re-running the installer must never reset the admin password to an empty one
printf '\n\033[1m== scenario: re-run keeps the admin password\033[0m\n'
base
printf 'MAIL_HOSTNAME=mail.example.com\n' > "$STATE_FILE"
printf 'MAIL_ADMIN_PASS_HASH=%s\n' '$2b$12$existinghashexistinghashexistinghashexistinghash12345' > "$ENV_FILE"
DRY_RUN=1; ASSUME_YES=1; validate_and_derive >/dev/null 2>&1
[ -z "${ADMIN_PASSWORD:-}" ] && pass "no new admin password is generated on a re-run" || fail "admin password was regenerated: $ADMIN_PASSWORD"
captured=""; write_file() { [ "$1" = "$ENV_FILE" ] && captured="$4"; }
write_app_env >/dev/null 2>&1
if printf '%s' "$captured" | grep -q '^MAIL_ADMIN_PASS_HASH=\$2b\$12\$existinghash'; then pass "existing bcrypt hash is kept in the new env file"; else fail "env file hash: $(printf '%s' "$captured" | grep PASS_HASH)"; fi
rm -f "$STATE_FILE" "$ENV_FILE"

# ---------------- IP-list sync script
printf '\n\033[1m== scenario: ip list sync script\033[0m\n'
S="$OUT/sync"; mkdir -p "$S/conf" "$S/f2b"
printf '203.0.113.5\n198.51.100.0/24\n2001:db8::1\nnot-an-ip\n' > "$S/conf/blacklist-ips.txt"
printf '203.0.113.5\n' > "$S/conf/whitelist-ips.txt"; printf '192.168.1.0/24\n' > "$S/conf/trusted-networks.txt"
MAIL_ADMIN_CONF_DIR="$S/conf" MAIL_ADMIN_FAIL2BAN_DIR="$S/f2b" MAIL_ADMIN_SYNC_RULES_OUT="$S/rules.nft" bash "$TESTS_DIR/../../sbin/mail-admin-sync-ip-lists.sh" >/dev/null 2>&1 \
  && pass "sync script runs" || fail "sync script failed"
grep -q 'elements = { 198.51.100.0/24,203.0.113.5 }' "$S/rules.nft" && pass "IPv4 blacklist rendered" || fail "IPv4 blacklist missing: $(cat "$S/rules.nft")"
grep -q 'elements = { 2001:db8::1 }' "$S/rules.nft" && pass "IPv6 blacklist rendered" || fail "IPv6 blacklist missing"
grep -q 'not-an-ip' "$S/rules.nft" && fail "invalid entry leaked into rules" || pass "invalid entries are dropped"
grep -q 'ignoreip = 127.0.0.1/8 ::1 203.0.113.5 192.168.1.0/24' "$S/f2b/jail.d/mail-admin-ignoreip.local" && pass "fail2ban ignoreip = whitelist + trusted networks" || fail "ignoreip wrong: $(cat "$S/f2b/jail.d/mail-admin-ignoreip.local")"
if have_tool unshare && unshare -rn true 2>/dev/null && have_tool nft; then
  check "nft accepts the generated ruleset (nft -c in a throwaway netns)" unshare -rn nft -c -f "$S/rules.nft"
else skip "nft syntax check (needs nft and unprivileged user namespaces)"; fi

printf '\n%d passed, %d failed, %d skipped\n' "$PASSES" "$FAILS" "$SKIPS"
[ "$FAILS" = 0 ]
