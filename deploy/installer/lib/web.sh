# shellcheck shell=bash
# Roundcube, Apache vhosts and the optional Cloudflare Tunnel.

RC_DIR=/var/www/roundcube

# ---------------------------------------------------------------- Roundcube
roundcube_installed_version() {
  sed -n "s/.*define('RCMAIL_VERSION', *'\([^']*\)').*/\1/p" "$RC_DIR/program/include/iniset.php" 2>/dev/null | head -n1
}

# Expected SHA-256 of the "complete" tarball: pinned for the default version, GitHub's published digest otherwise.
roundcube_expected_sha256() {
  if [ -n "${ROUNDCUBE_SHA256:-}" ]; then printf '%s' "${ROUNDCUBE_SHA256#sha256:}"; return; fi
  if [ "$ROUNDCUBE_VERSION" = "$DEFAULT_ROUNDCUBE_VERSION" ]; then printf '%s' "$DEFAULT_ROUNDCUBE_SHA256"; return; fi
  curl -fsSL --max-time 30 "https://api.github.com/repos/roundcube/roundcubemail/releases/tags/${ROUNDCUBE_VERSION}" 2>/dev/null |
    python3 -I -c '
import json, sys
d = json.load(sys.stdin)
n = "roundcubemail-%s-complete.tar.gz" % d["tag_name"]
dg = next((a.get("digest", "") for a in d["assets"] if a["name"] == n), "")
print(dg.replace("sha256:", ""), end="")' 2>/dev/null || true
}

derive_roundcube_vars() {
  local plugins="" p
  for p in $(split_list "$ROUNDCUBE_PLUGINS"); do plugins+="'${p}', "; done
  export RC_PLUGINS_PHP="${plugins%, }"
  if [ "$TLS_MODE" = selfsigned ] || [ "${TLS_PENDING:-0}" = 1 ]; then export RC_SSL_VERIFY=false; else export RC_SSL_VERIFY=true; fi
  if [ "$CLOUDFLARE_TUNNEL" = 1 ]; then
    export RC_PROXY_LINES="// requests arrive from cloudflared on loopback; trust its forwarded headers
\$config['proxy_whitelist'] = ['127.0.0.1'];"
  else
    export RC_PROXY_LINES=""
  fi
}

install_roundcube() {
  [ "$WEBMAIL" = 1 ] || { log "webmail skipped (--no-webmail)"; return 0; }
  local want="$ROUNDCUBE_VERSION" have_v
  have_v="$(roundcube_installed_version || true)"

  if [ -n "$have_v" ] && [ "$DRY_RUN" != 1 ]; then
    log "Roundcube $have_v already installed in $RC_DIR - keeping the application files (upgrade from the panel's System updates page)"
  else
    local work url expected actual
    work="$(mktemp -d)"
    url="https://github.com/roundcube/roundcubemail/releases/download/${want}/roundcubemail-${want}-complete.tar.gz"
    log "downloading Roundcube ${want}"
    expected="$(roundcube_expected_sha256)"
    if [ "$DRY_RUN" = 1 ]; then
      echo "${C_YEL}[dry-run]${C_RST} curl $url; verify sha256 ${expected:-<from GitHub API>}; extract to $RC_DIR"
    else
      [ -n "$expected" ] || die "no SHA-256 known for Roundcube ${want}; pass --roundcube-sha256"
      curl -fL --retry 3 -o "$work/rc.tgz" "$url" || die "download failed: $url"
      actual="$(sha256sum "$work/rc.tgz" | cut -d' ' -f1)"
      [ "$actual" = "$expected" ] || die "Roundcube checksum mismatch (expected $expected, got $actual)"
      ok "checksum verified"
      tar -xzf "$work/rc.tgz" -C "$work"
      mkdir -p "$(dirname "$RC_DIR")"
      mv "$work/roundcubemail-${want}" "$RC_DIR"
      chown -R root:root "$RC_DIR"
      rm -rf "$work" "$RC_DIR/installer"
    fi
  fi

  # --- writable runtime dirs live outside the code tree
  run install -d -o www-data -g www-data -m 750 /var/lib/roundcube /var/lib/roundcube/temp
  run install -d -o www-data -g adm -m 2750 /var/log/roundcube
  local f; for f in userlogins.log errors.log; do
    if [ "$DRY_RUN" != 1 ] && [ ! -e "/var/log/roundcube/$f" ]; then install -o www-data -g adm -m 640 /dev/null "/var/log/roundcube/$f"; fi
  done
  install_template logrotate/mail-admin /etc/logrotate.d/mail-admin 644 root:root

  # --- config
  derive_roundcube_vars
  install_template roundcube/config.inc.php "$RC_DIR/config/config.inc.php" 640 root:www-data

  # --- database schema (only the first time)
  if [ "$DRY_RUN" = 1 ]; then
    echo "${C_YEL}[dry-run]${C_RST} import $RC_DIR/SQL/mysql.initial.sql into the roundcube database (if empty)"
  elif [ "$(mariadb -N -B roundcube -e "SHOW TABLES LIKE 'session'" | wc -l)" = 0 ]; then
    mariadb roundcube < "$RC_DIR/SQL/mysql.initial.sql"
    ok "Roundcube database initialised"
  fi
}

# ---------------------------------------------------------------- Apache
php_apache_ini_dir() {
  local v; v="$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null || true)"
  [ -n "$v" ] && [ -d "/etc/php/$v/apache2/conf.d" ] && printf '/etc/php/%s/apache2/conf.d' "$v"
}

net_require_line() {  # net_require_line "<cidr list>" -> an Apache Require directive
  local list="$1" n out=""
  if [ "$list" = any ]; then printf '    Require all granted'; return; fi
  for n in $(split_list "$list"); do out+=" $n"; done
  printf '    Require ip 127.0.0.1 ::1%s' "$out"
}

derive_web_vars() {
  export POST_MAX_MB=$(( MAX_MESSAGE_MB + 5 ))
  TIMEZONE="$(detect_timezone)"; export TIMEZONE

  export ADMIN_REQUIRE; ADMIN_REQUIRE="$(net_require_line "$ADMIN_ALLOW")"
  if [ "$WEBMAIL_ACCESS" = internal ]; then export WEBMAIL_REQUIRE; WEBMAIL_REQUIRE="$(net_require_line "$ADMIN_ALLOW")"
  else export WEBMAIL_REQUIRE="    Require all granted"; fi

  local alias_line=""
  if [ -n "${ALIAS_HOSTNAMES:-}" ]; then alias_line="    ServerAlias $(split_list "$ALIAS_HOSTNAMES" | paste -sd' ' -)"$'\n'; fi
  export SERVER_ALIAS_LINE="$alias_line"
  if [ "$WEBMAIL" = 1 ]; then export ROOT_REDIRECT_LINE="    RedirectMatch ^/\$ /roundcube/"; else export ROOT_REDIRECT_LINE="    RedirectMatch ^/\$ /admin/"; fi
  export TUNNEL_ADMIN_INCLUDE=""
  if [ "$TUNNEL_EXPOSE_ADMIN" = 1 ]; then export TUNNEL_ADMIN_INCLUDE="    IncludeOptional /etc/apache2/mail-admin/admin.inc"$'\n'; fi
}

setup_apache() {
  derive_web_vars
  local mods=(ssl headers rewrite proxy proxy_http)
  [ "$CLOUDFLARE_TUNNEL" = 1 ] && mods+=(remoteip)
  run a2enmod "${mods[@]}"

  if [ "$WEBMAIL" = 1 ]; then
    local ini; ini="$(php_apache_ini_dir || true)"
    if [ -n "$ini" ]; then install_template php/99-mail-admin.ini "$ini/99-mail-admin.ini" 644 root:root
    elif [ "$DRY_RUN" = 1 ]; then echo "${C_YEL}[dry-run]${C_RST} write PHP ini (upload limits) under /etc/php/<ver>/apache2/conf.d/"
    else warn "could not locate PHP's Apache conf.d; message size limit for webmail attachments is PHP's default"; fi
  fi

  run mkdir -p /etc/apache2/mail-admin
  if [ "$WEBMAIL" = 1 ]; then install_template apache/webmail.inc /etc/apache2/mail-admin/webmail.inc 644 root:root
  else write_file /etc/apache2/mail-admin/webmail.inc 644 root:root "# webmail not installed"; fi
  install_template apache/admin.inc /etc/apache2/mail-admin/admin.inc 644 root:root
  install_template apache/security.conf /etc/apache2/conf-available/mail-admin-security.conf 644 root:root
  install_template apache/mail-admin.conf /etc/apache2/sites-available/mail-admin.conf 644 root:root
  if [ "$CLOUDFLARE_TUNNEL" = 1 ]; then
    install_template apache/tunnel.conf /etc/apache2/sites-available/mail-admin-tunnel.conf 644 root:root
    run a2ensite mail-admin-tunnel
  else
    run a2dissite mail-admin-tunnel 2>/dev/null || true
  fi
  run a2enconf mail-admin-security
  run a2ensite mail-admin
  run a2dissite 000-default default-ssl
  # keep a harmless landing file for ACME webroot challenges
  run mkdir -p /var/www/html

  if [ "$DRY_RUN" != 1 ]; then
    apache2ctl configtest 2>&1 || die "Apache configuration test failed (see above)"
    systemctl enable apache2
    systemctl restart apache2
  fi
  ok "Apache configured"
}

# ---------------------------------------------------------------- Cloudflare Tunnel
setup_cloudflare_tunnel() {
  [ "$CLOUDFLARE_TUNNEL" = 1 ] || return 0
  log "installing cloudflared (Cloudflare Tunnel connector)"
  run install -d -m 755 /usr/share/keyrings
  if [ "$DRY_RUN" = 1 ]; then
    echo "${C_YEL}[dry-run]${C_RST} add Cloudflare apt repository (pkg.cloudflare.com) and install cloudflared"
  else
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
    DEBIAN_FRONTEND=noninteractive apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y cloudflared
  fi
  # The token goes in a root-only file rather than on the command line / world-readable unit file.
  write_file /etc/cloudflared/tunnel.env 600 root:root "TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}"
  write_file /etc/systemd/system/cloudflared.service 644 root:root "[Unit]
Description=Cloudflare Tunnel (cloudflared)
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
TimeoutStartSec=0
EnvironmentFile=/etc/cloudflared/tunnel.env
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target"
  run systemctl daemon-reload
  run systemctl enable --now cloudflared
  ok "cloudflared running. In the Cloudflare Zero Trust dashboard set the tunnel's public hostname to  http://localhost:8080"
}
