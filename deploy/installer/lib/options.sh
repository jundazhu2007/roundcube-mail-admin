# shellcheck shell=bash
# Option names, defaults, command-line parsing and usage text.

# Every configurable value. They are cleared on start so that only flags, --config and the saved
# state can set them (an unrelated MODE=... in the caller's environment must not leak in).
OPTION_VARS=(
  MODE MAIL_HOSTNAME MAIL_DOMAIN LE_EMAIL ALIAS_HOSTNAMES
  ADMIN_USER ADMIN_PASSWORD ADMIN_ALLOW ALLOW_SSH_CLIENT API_PORT SERVICE_USER INSTALL_DIR
  FIRST_MAILBOX FIRST_MAILBOX_PASSWORD
  DB_HOST DB_PORT DB_USER DB_PASS DB_NAME CREATE_SCHEMA
  MAILDATA_PATH NFS_SERVER NFS_OPTIONS VMAIL_UID
  TLS_MODE TLS_CERT TLS_KEY LE_STAGING
  CF_TUNNEL_TOKEN TUNNEL_EXPOSE_ADMIN CF_DNS_TOKEN
  WEBMAIL WEBMAIL_ACCESS ROUNDCUBE_VERSION ROUNDCUBE_SHA256 ROUNDCUBE_PLUGINS ROUNDCUBE_SKIN WEBMAIL_NAME WEBMAIL_LANGUAGE
  ANTIVIRUS ANTISPAM DKIM DKIM_SELECTOR MAX_MESSAGE_MB IPV6 RELAYHOST RELAY_USER RELAY_PASS
  FAIL2BAN FIREWALL LOG_RETENTION_DAYS EXTRA_SERVICES
)

# Generated secrets that are persisted so that a re-run keeps them.
SECRET_VARS=( DB_MAILUSER_PASS RC_DB_PASS RC_DES_KEY JWT_SECRET )

# Variables written to /etc/mail-admin/install.conf (passwords given on the command line are NOT saved
# except the ones the installer itself generated).
SAVED_VARS=(
  MODE MAIL_HOSTNAME MAIL_DOMAIN LE_EMAIL ALIAS_HOSTNAMES ADMIN_USER ADMIN_ALLOW ALLOW_SSH_CLIENT API_PORT
  SERVICE_USER INSTALL_DIR FIRST_MAILBOX DB_HOST DB_PORT DB_USER DB_NAME MAILDATA_PATH NFS_SERVER NFS_OPTIONS
  VMAIL_UID TLS_MODE TLS_CERT TLS_KEY LE_STAGING TUNNEL_EXPOSE_ADMIN WEBMAIL WEBMAIL_ACCESS ROUNDCUBE_VERSION
  ROUNDCUBE_PLUGINS ROUNDCUBE_SKIN WEBMAIL_NAME WEBMAIL_LANGUAGE ANTIVIRUS ANTISPAM DKIM DKIM_SELECTOR
  MAX_MESSAGE_MB IPV6 RELAYHOST RELAY_USER FAIL2BAN FIREWALL LOG_RETENTION_DAYS EXTRA_SERVICES CLOUDFLARE_TUNNEL CLOUDFLARE_DNS
  DB_MAILUSER_PASS RC_DB_PASS RC_DES_KEY JWT_SECRET
)

reset_options() {
  local v
  for v in "${OPTION_VARS[@]}" "${SECRET_VARS[@]}" CLOUDFLARE_TUNNEL CLOUDFLARE_DNS; do unset "$v"; done
  UPGRADE=0; FORCE=0; SKIP_OS_CHECK=0; NO_SAVE=0; CONFIG_FILE=""; SHOW_HELP=0
}

apply_defaults() {
  : "${MODE:=full}"
  : "${ADMIN_USER:=admin}"
  : "${ALLOW_SSH_CLIENT:=1}"
  : "${API_PORT:=8000}"
  : "${SERVICE_USER:=mailadmin}"
  : "${INSTALL_DIR:=/opt/mail-admin}"
  : "${DB_HOST:=127.0.0.1}"
  : "${DB_PORT:=3306}"
  : "${DB_USER:=mailuser}"
  : "${DB_NAME:=mailserver}"
  : "${CREATE_SCHEMA:=0}"
  : "${MAILDATA_PATH:=/var/vmail/homes}"
  : "${NFS_OPTIONS:=nfsvers=4.1,_netdev,hard,noatime}"
  : "${VMAIL_UID:=5000}"
  : "${LE_STAGING:=0}"
  : "${TUNNEL_EXPOSE_ADMIN:=0}"
  # WEBMAIL, ANTISPAM, ANTIVIRUS, DKIM, FAIL2BAN, FIREWALL and CLOUDFLARE_TUNNEL are deliberately NOT defaulted here:
  # the wizard asks for them (its own default is used when unattended) and validate_and_derive fills any gap.
  : "${WEBMAIL_ACCESS:=public}"
  : "${ROUNDCUBE_VERSION:=$DEFAULT_ROUNDCUBE_VERSION}"
  : "${ROUNDCUBE_PLUGINS:=archive,zipdownload}"
  : "${ROUNDCUBE_SKIN:=elastic}"
  : "${WEBMAIL_NAME:=Webmail}"
  : "${WEBMAIL_LANGUAGE:=en_US}"
  : "${DKIM_SELECTOR:=mail}"
  : "${MAX_MESSAGE_MB:=25}"
  : "${IPV6:=1}"
  : "${LOG_RETENTION_DAYS:=365}"
  : "${FIRST_MAILBOX:=postmaster}"
}

usage() {
  cat <<'EOF'
mail-admin installer

USAGE
  install.sh [options]            install (interactive wizard when run in a terminal)
  install.sh --upgrade            upgrade only the mail-admin application (keeps data and config)

Run with no options in a terminal to be asked the important questions. Every question can be answered
up front with a flag, which is how unattended installs work (combine with --yes).

GENERAL
  --yes, -y                  never prompt; use flags/defaults (fails if something required is missing)
  --dry-run                  print every action, change nothing (works without root)
  --config FILE              read KEY=VALUE answers from FILE (same names as in /etc/mail-admin/install.conf)
  --force                    proceed even if an existing mail setup is detected (read docs first!)
  --skip-os-check            do not require Ubuntu 24.04+
  --upgrade                  upgrade the application only
  --help, -h                 this text

WHAT TO INSTALL
  --mode full|admin-only     full: whole mail stack + Roundcube + admin panel (default)
                             admin-only: just the admin panel, attached to a mail server you already run
  --hostname FQDN            the mail server's public name, e.g. mail.example.com      (required)
  --domain DOMAIN            first mail domain, e.g. example.com   (default: hostname without first label)
  --email ADDRESS            contact address for Let's Encrypt expiry notices
  --alias-hostnames A,B      extra names the web UI answers to (e.g. webmail.example.com)

ADMIN PANEL
  --admin-user NAME          panel super-admin login                                  (default: admin)
  --admin-password PASS      panel password                                           (default: generated)
  --admin-allow CIDRS        networks allowed to open /admin and /api, comma separated
                             e.g. 192.168.1.0/24,203.0.113.7  ("any" = no restriction, not recommended)
                             (default: this server's LAN + the IP you are running the installer from)
  --no-ssh-allow             do not auto-add the SSH client's IP to the allow list
  --api-port PORT            local port of the API                                    (default: 8000)
  --service-user NAME        unix account that runs the API                           (default: mailadmin)
  --install-dir DIR          where the panel lives                                    (default: /opt/mail-admin)
  --first-mailbox NAME       create NAME@domain at the end                            (default: postmaster)
  --no-first-mailbox         do not create a mailbox
  --first-mailbox-password P password for it                                          (default: generated)

DATABASE   (admin-only mode; in full mode the installer creates everything itself)
  --db-host H  --db-port P  --db-user U  --db-pass PW  --db-name N
  --create-schema            create the domains/users/aliases tables if they are missing

MAIL STORAGE
  --maildata-path DIR        where mailboxes are stored                               (default: /var/vmail/homes)
  --nfs-server HOST:/EXPORT  store mail on NFS instead of the local disk (adds /etc/fstab entry and
                             makes Postfix/Dovecot wait for the mount at boot)
  --nfs-options OPTS         mount options                      (default: nfsvers=4.1,_netdev,hard,noatime)
  --vmail-uid N              uid/gid of the "vmail" account                           (default: 5000)

TLS CERTIFICATES
  --tls MODE                 letsencrypt      HTTP-01 on port 80 (default)
                             cloudflare-dns   DNS-01 through the Cloudflare API (no inbound port 80 needed)
                             existing         use --cert-file / --key-file you already have
                             selfsigned       generate a self-signed certificate (testing only)
  --cert-file FILE  --key-file FILE
  --le-staging               use Let's Encrypt's staging CA (for rehearsals; certificates are not trusted)

CLOUDFLARE (optional, independent of each other)
  --cloudflare-tunnel-token T   install cloudflared and publish the web UI through a Cloudflare Tunnel.
                                 Create the tunnel in the Zero Trust dashboard, point its public hostname at
                                 http://localhost:8080 and paste the tunnel token here. Only HTTP(S) goes
                                 through a tunnel - SMTP/IMAP still need a direct, DNS-only A record.
  --tunnel-expose-admin         also publish /admin and /api through the tunnel (still limited by --admin-allow;
                                 protect it with Cloudflare Access)
  --cloudflare-dns-token T      API token (Zone:DNS:Edit) used for DNS-01 certificate validation

WEBMAIL (Roundcube)
  --no-webmail               skip Roundcube
  --webmail-access public|internal   internal = only --admin-allow networks may open webmail
  --roundcube-version X.Y.Z  (default: pinned release)         --roundcube-sha256 HEX  (verify a custom version)
  --roundcube-plugins LIST   comma separated                                          (default: archive,zipdownload)
  --roundcube-skin NAME      elastic | larry | classic                                (default: elastic)
  --webmail-name TEXT        product name shown on the login page                     (default: Webmail)
  --webmail-language CODE    default UI language, e.g. en_US, zh_TW, ja_JP            (default: en_US)

MAIL FEATURES
  --no-antivirus             skip ClamAV + rkhunter (saves ~1.2 GB RAM)
  --no-antispam              skip SpamAssassin
  --no-dkim                  skip OpenDKIM
  --dkim-selector NAME       DKIM selector                                            (default: mail)
  --max-message-mb N         maximum message size                                     (default: 25)
  --no-ipv6                  make Postfix IPv4-only
  --relayhost [HOST]:PORT    send outgoing mail through a smarthost (for ISPs that block port 25)
  --relay-user U --relay-pass P   credentials for the smarthost

HARDENING / OPERATIONS
  --no-fail2ban              skip fail2ban
  --firewall none|ufw        ufw: open only the needed ports and enable the firewall   (default: none)
  --log-retention-days N     keep mail/web/webmail logs this long                     (default: 365)
  --extra-services A,B       more systemd services to show on the panel's Services page (and allow restarting),
                             e.g. unbound,redis-server. The services the installer sets up are added automatically.

Examples
  # interactive
  sudo ./install.sh

  # unattended, Cloudflare for DNS certificates and a tunnel for webmail, mail on a NAS
  sudo ./install.sh --yes --hostname mail.example.com --email me@example.com \
       --tls cloudflare-dns --cloudflare-dns-token "$CF_API_TOKEN" \
       --cloudflare-tunnel-token "$CF_TUNNEL_TOKEN" --webmail-access public \
       --nfs-server 10.0.0.10:/volume1/mail --admin-allow 192.168.1.0/24
EOF
}

need_arg() { [ "$#" -ge 2 ] && [ -n "$2" ] || die "option $1 needs a value (see --help)"; }

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -h|--help) SHOW_HELP=1; shift ;;
      -y|--yes) ASSUME_YES=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --force) FORCE=1; shift ;;
      --skip-os-check) SKIP_OS_CHECK=1; shift ;;
      --upgrade) UPGRADE=1; shift ;;
      --no-save) NO_SAVE=1; shift ;;
      --config) need_arg "$@"; CONFIG_FILE="$2"; shift 2 ;;
      --mode) need_arg "$@"; MODE="$2"; shift 2 ;;
      --hostname) need_arg "$@"; MAIL_HOSTNAME="${2,,}"; shift 2 ;;
      --domain) need_arg "$@"; MAIL_DOMAIN="${2,,}"; shift 2 ;;
      --email) need_arg "$@"; LE_EMAIL="$2"; shift 2 ;;
      --alias-hostnames) need_arg "$@"; ALIAS_HOSTNAMES="${2,,}"; shift 2 ;;
      --admin-user) need_arg "$@"; ADMIN_USER="$2"; shift 2 ;;
      --admin-password) need_arg "$@"; ADMIN_PASSWORD="$2"; shift 2 ;;
      --admin-allow) need_arg "$@"; ADMIN_ALLOW="$2"; shift 2 ;;
      --no-ssh-allow) ALLOW_SSH_CLIENT=0; shift ;;
      --api-port) need_arg "$@"; API_PORT="$2"; shift 2 ;;
      --service-user) need_arg "$@"; SERVICE_USER="$2"; shift 2 ;;
      --install-dir) need_arg "$@"; INSTALL_DIR="$2"; shift 2 ;;
      --first-mailbox) need_arg "$@"; FIRST_MAILBOX="$2"; shift 2 ;;
      --no-first-mailbox) FIRST_MAILBOX="-"; shift ;;
      --first-mailbox-password) need_arg "$@"; FIRST_MAILBOX_PASSWORD="$2"; shift 2 ;;
      --db-host) need_arg "$@"; DB_HOST="$2"; shift 2 ;;
      --db-port) need_arg "$@"; DB_PORT="$2"; shift 2 ;;
      --db-user) need_arg "$@"; DB_USER="$2"; shift 2 ;;
      --db-pass) need_arg "$@"; DB_PASS="$2"; shift 2 ;;
      --db-name) need_arg "$@"; DB_NAME="$2"; shift 2 ;;
      --create-schema) CREATE_SCHEMA=1; shift ;;
      --maildata-path) need_arg "$@"; MAILDATA_PATH="${2%/}"; shift 2 ;;
      --nfs-server) need_arg "$@"; NFS_SERVER="$2"; shift 2 ;;
      --nfs-options) need_arg "$@"; NFS_OPTIONS="$2"; shift 2 ;;
      --vmail-uid) need_arg "$@"; VMAIL_UID="$2"; shift 2 ;;
      --tls) need_arg "$@"; TLS_MODE="$2"; shift 2 ;;
      --cert-file) need_arg "$@"; TLS_CERT="$2"; shift 2 ;;
      --key-file) need_arg "$@"; TLS_KEY="$2"; shift 2 ;;
      --le-staging) LE_STAGING=1; shift ;;
      --cloudflare-tunnel-token) need_arg "$@"; CF_TUNNEL_TOKEN="$2"; shift 2 ;;
      --tunnel-expose-admin) TUNNEL_EXPOSE_ADMIN=1; shift ;;
      --cloudflare-dns-token) need_arg "$@"; CF_DNS_TOKEN="$2"; shift 2 ;;
      --no-webmail) WEBMAIL=0; shift ;;
      --webmail-access) need_arg "$@"; WEBMAIL_ACCESS="$2"; shift 2 ;;
      --roundcube-version) need_arg "$@"; ROUNDCUBE_VERSION="$2"; shift 2 ;;
      --roundcube-sha256) need_arg "$@"; ROUNDCUBE_SHA256="$2"; shift 2 ;;
      --roundcube-plugins) need_arg "$@"; ROUNDCUBE_PLUGINS="$2"; shift 2 ;;
      --roundcube-skin) need_arg "$@"; ROUNDCUBE_SKIN="$2"; shift 2 ;;
      --webmail-name) need_arg "$@"; WEBMAIL_NAME="$2"; shift 2 ;;
      --webmail-language) need_arg "$@"; WEBMAIL_LANGUAGE="$2"; shift 2 ;;
      --no-antivirus) ANTIVIRUS=0; shift ;;
      --no-antispam) ANTISPAM=0; shift ;;
      --no-dkim) DKIM=0; shift ;;
      --dkim-selector) need_arg "$@"; DKIM_SELECTOR="$2"; shift 2 ;;
      --max-message-mb) need_arg "$@"; MAX_MESSAGE_MB="$2"; shift 2 ;;
      --no-ipv6) IPV6=0; shift ;;
      --relayhost) need_arg "$@"; RELAYHOST="$2"; shift 2 ;;
      --relay-user) need_arg "$@"; RELAY_USER="$2"; shift 2 ;;
      --relay-pass) need_arg "$@"; RELAY_PASS="$2"; shift 2 ;;
      --no-fail2ban) FAIL2BAN=0; shift ;;
      --firewall) need_arg "$@"; FIREWALL="$2"; shift 2 ;;
      --log-retention-days) need_arg "$@"; LOG_RETENTION_DAYS="$2"; shift 2 ;;
      --extra-services) need_arg "$@"; EXTRA_SERVICES="$2"; shift 2 ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
  done
}

# fill unset variables from a KEY=VALUE file (a user-supplied --config file)
load_config_file() {
  local f="$1" line k v ok
  [ -f "$f" ] || die "config file not found: $f"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"; line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || die "$f: cannot parse line: $line"
    k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"
    v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
    ok=0; local o
    for o in "${OPTION_VARS[@]}"; do [ "$o" = "$k" ] && ok=1; done
    [ "$ok" = 1 ] || die "$f: unknown setting $k"
    if [ -z "${!k+x}" ]; then printf -v "$k" '%s' "$v"; fi
  done < "$f"
}
