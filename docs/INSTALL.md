# Installation guide

This is the reference for `install.sh`. For the short version see the [README](../README.md).

- [Before you start](#before-you-start)
- [Running the installer](#running-the-installer)
- [All options](#all-options)
- [Cloudflare (optional)](#cloudflare-optional)
- [Mail storage: local disk or NFS](#mail-storage-local-disk-or-nfs)
- [Certificates](#certificates)
- [After the installation: DNS](#after-the-installation-dns)
- [Config files, re-running, upgrading](#config-files-re-running-upgrading)
- [Attaching the panel to an existing mail server](#attaching-the-panel-to-an-existing-mail-server)
- [What the installer changes on your system](#what-the-installer-changes-on-your-system)
- [Troubleshooting](#troubleshooting)

## Before you start

1. A fresh **Ubuntu 26.04 LTS** (or newer) server with a public IP. A VM is fine.
2. A **DNS name** for it (for example `mail.example.com`) – create the `A` record first if you plan to use
   Let's Encrypt over HTTP.
3. The inbound ports **25, 465, 993, 443** (and **80** for HTTP certificate issuance) open on your router or
   cloud firewall.
4. Outbound port 25 must work for sending mail. If your provider blocks it, plan to use a smarthost
   (`--relayhost`).
5. Reverse DNS (PTR) for the IP pointing at your mail host name – set at your ISP/VPS provider. Without it many
   receivers will reject or spam-folder your mail.

> The installer **overwrites** the Postfix and Dovecot configuration. It refuses to run on a server that already
> looks like a configured mail server unless you pass `--force` (or use [`--mode admin-only`](#attaching-the-panel-to-an-existing-mail-server)).

## Running the installer

```bash
# interactive wizard
curl -fsSL https://raw.githubusercontent.com/jundazhu2007/roundcube-mail-admin/main/install.sh | sudo bash

# preview everything without changing anything (no root needed)
curl -fsSL https://raw.githubusercontent.com/jundazhu2007/roundcube-mail-admin/main/install.sh | bash -s -- \
  --dry-run --yes --hostname mail.example.com --admin-allow 192.168.1.0/24
```

The wizard asks (each has a default; an answer given as a flag is not asked again):

1. public host name and first mail domain
2. how to get certificates (Let's Encrypt over HTTP / over Cloudflare DNS / your own files / self-signed)
3. whether to publish the web UI through a **Cloudflare Tunnel**
4. whether mail lives on the **local disk or an NFS share**
5. webmail, spam filter, antivirus, DKIM, fail2ban, firewall
6. which networks may open the admin panel

then prints the plan and asks for confirmation. Afterwards it prints a report (also saved to
`/root/mail-admin-install.txt`, readable by root only) containing the URLs, the generated passwords and the DNS
records to create.

`--yes` makes it fully non-interactive; anything not given as a flag takes its default, and anything required
(`--hostname`) that is missing is an error.

## All options

Run `install.sh --help` for the authoritative list. Summary:

### General
| Flag | Meaning |
|---|---|
| `--yes`, `-y` | never prompt |
| `--dry-run` | print every action, change nothing, no root needed |
| `--config FILE` | read answers from `FILE` (`KEY=VALUE` lines, see [below](#config-files-re-running-upgrading)) |
| `--force` | proceed although an existing mail setup is detected |
| `--upgrade` | upgrade only the application |
| `--skip-os-check` | do not require Ubuntu 26.04+ (unsupported) |

### Identity
| Flag | Default | Meaning |
|---|---|---|
| `--hostname FQDN` | *required* | the mail server's public name |
| `--domain DOMAIN` | host name without its first label | first mail domain |
| `--email ADDRESS` | – | Let's Encrypt contact |
| `--alias-hostnames A,B` | – | extra names the web UI answers to (included in the certificate) |

### Admin panel
| Flag | Default | Meaning |
|---|---|---|
| `--admin-user NAME` | `admin` | super-admin login |
| `--admin-password PASS` | generated | at least 12 characters |
| `--admin-allow CIDRS` | server LAN + your SSH client IP | networks allowed to open `/admin` and `/api`; `any` = everyone (not recommended) |
| `--no-ssh-allow` | | do not add your SSH client IP automatically |
| `--api-port PORT` | `8000` | local API port |
| `--service-user NAME` | `mailadmin` | unprivileged account the API runs as |
| `--install-dir DIR` | `/opt/mail-admin` | |
| `--first-mailbox NAME` / `--no-first-mailbox` | `postmaster` | mailbox created at the end |
| `--first-mailbox-password PASS` | generated | |
| `--extra-services A,B` | – | more systemd services to show/restart on the Services page |

### Mail storage
| Flag | Default | Meaning |
|---|---|---|
| `--maildata-path DIR` | `/var/vmail/homes` | where mailboxes live |
| `--nfs-server HOST:/EXPORT` | – | store mail on NFS, see [below](#mail-storage-local-disk-or-nfs) |
| `--nfs-options OPTS` | `nfsvers=4.1,_netdev,hard,noatime` | |
| `--vmail-uid N` | `5000` | uid/gid of the `vmail` account |

### Certificates and Cloudflare
| Flag | Meaning |
|---|---|
| `--tls letsencrypt\|cloudflare-dns\|existing\|selfsigned` | certificate source (default `letsencrypt`) |
| `--cert-file F` `--key-file F` | for `--tls existing` |
| `--le-staging` | use the Let's Encrypt staging CA (rehearsals) |
| `--cloudflare-dns-token T` | Cloudflare API token (Zone → DNS → Edit) for `--tls cloudflare-dns` |
| `--cloudflare-tunnel-token T` | install `cloudflared` and run the tunnel with this token |
| `--tunnel-expose-admin` | also publish `/admin` and `/api` through the tunnel |

### Webmail
| Flag | Default | Meaning |
|---|---|---|
| `--no-webmail` | | skip Roundcube |
| `--webmail-access public\|internal` | `public` | `internal` = only the `--admin-allow` networks |
| `--roundcube-version X.Y.Z` | pinned (1.7.4) | other versions are verified against the SHA-256 GitHub publishes for the release asset |
| `--roundcube-sha256 HEX` | | supply your own checksum |
| `--roundcube-plugins LIST` | `archive,zipdownload` | |
| `--roundcube-skin NAME` | `elastic` | `elastic`, `larry`, `classic` |
| `--webmail-name TEXT` | `Webmail` | product name on the login page |
| `--webmail-language CODE` | `en_US` | e.g. `zh_TW`, `ja_JP` |

### Mail features and hardening
| Flag | Default | Meaning |
|---|---|---|
| `--no-antivirus` | on | skip ClamAV + rkhunter (saves ~1.2 GB RAM; automatically off below 3 GB RAM) |
| `--no-antispam` | on | skip SpamAssassin |
| `--no-dkim`, `--dkim-selector S` | on, `mail` | |
| `--max-message-mb N` | `25` | message size limit (Postfix, PHP, Roundcube) |
| `--no-ipv6` | | Postfix IPv4 only |
| `--relayhost [HOST]:PORT` `--relay-user U` `--relay-pass P` | – | send through a smarthost |
| `--no-fail2ban` | on | |
| `--firewall none\|ufw` | `none` | `ufw` opens only SSH, 25, 465, 993, 443, 80 and enables it |
| `--log-retention-days N` | `365` | webmail log rotation |

## Cloudflare (optional)

Cloudflare support is two independent features. Use neither, either, or both.

### 1. Cloudflare Tunnel for the web UI (`--cloudflare-tunnel-token`)

Useful when the server is behind NAT/CGNAT or you do not want to open port 443. The installer installs
`cloudflared` from Cloudflare's apt repository, stores the token in `/etc/cloudflared/tunnel.env` (root only),
runs it as a systemd service, and adds an Apache virtual host that listens **only on `127.0.0.1:8080`**.

1. In the Cloudflare dashboard open *Zero Trust → Networks → Tunnels*, create a tunnel, and copy its **token**.
2. Add a public hostname to the tunnel (for example `webmail.example.com`) with the service
   **`http://localhost:8080`**.
3. Run the installer with `--cloudflare-tunnel-token TOKEN`.

What you get and what you do not:

* Webmail (`/roundcube`) is reachable through the tunnel. The real visitor IP is taken from `CF-Connecting-IP`
  (only trusted from the local `cloudflared`), so login history and fail2ban see real addresses.
* `/admin` and `/api` are **not** published unless you add `--tunnel-expose-admin`. If you do, they are still
  restricted by `--admin-allow` (against the real visitor IP) – put **Cloudflare Access** in front, or use
  `--admin-allow any` only behind Access.
* **Mail itself cannot use a tunnel.** SMTP and IMAP need a direct connection: the `A` record of the mail host
  must be **DNS-only (grey cloud)** and ports 25/465/993 must reach the server.
* Passkeys are bound to `--hostname`; open the panel on that name.

### 2. Let's Encrypt via the Cloudflare API (`--tls cloudflare-dns`)

DNS-01 validation: no inbound port 80 is needed and it works behind NAT. Create an API token with
**Zone → DNS → Edit** for your zone and pass it as `--cloudflare-dns-token`. It is stored in
`/etc/letsencrypt/cloudflare.ini` (mode 600) for automatic renewals; a renewal hook reloads Apache, Postfix and
Dovecot.

## Mail storage: local disk or NFS

Default: `/var/vmail/homes` on the local disk.

For a NAS use `--nfs-server`:

```bash
sudo ./install.sh --nfs-server 10.0.0.10:/volume1/mail --maildata-path /mnt/maildata/homes ...
```

The export is mounted at the **parent directory** of `--maildata-path` (here `/mnt/maildata`), an entry is added
to `/etc/fstab`, and `postfix` and `dovecot` get a systemd drop-in with `RequiresMountsFor=` so they never
start before the share is mounted (otherwise they would write into an empty mount point). The NAS must let the
`vmail` uid (default 5000) write; with `root_squash` exports make sure that uid is mapped or owns the share.
The admin panel shows the storage state on the Services and Dashboard pages.

## Certificates

Postfix, Dovecot and Apache all read `/etc/mail-admin/tls/fullchain.pem` and `privkey.pem`, which are
**symlinks**. The installer first links a self-signed placeholder so every service can start, then replaces the
links when a real certificate is issued. If issuance fails (usually DNS), the install still completes with the
placeholder and tells you; fix the cause and run `sudo mail-admin-install --yes` again.

## After the installation: DNS

The report lists exactly what to create. In general:

| Type | Name | Value |
|---|---|---|
| A | `mail.example.com` | your server's public IP (DNS-only if you use Cloudflare) |
| MX | `example.com` | `10 mail.example.com.` |
| TXT | `example.com` | `"v=spf1 mx ~all"` |
| TXT | `mail._domainkey.example.com` | the DKIM key printed in the report |
| TXT | `_dmarc.example.com` | `"v=DMARC1; p=none; rua=mailto:postmaster@example.com"` (tighten later) |
| PTR | your IP | `mail.example.com` (at your ISP) |

Additional mail domains: add them in the panel, create their MX/SPF/DMARC records, and run
`sudo mail-admin-dkim-add-domain example.org` for DKIM.

## Config files, re-running, upgrading

* The installer saves your answers and generated secrets in `/etc/mail-admin/install.conf` (root only). Running
  `sudo mail-admin-install` again reuses them; flags you pass override them. Existing mailboxes and the admin
  database are never recreated, passwords are never regenerated.
* `--config FILE` takes the same names, one `KEY=VALUE` per line, `#` for comments:

  ```ini
  MAIL_HOSTNAME=mail.example.com
  MAIL_DOMAIN=example.com
  TLS_MODE=cloudflare-dns
  CF_DNS_TOKEN=xxxxxxxx
  ADMIN_ALLOW=192.168.1.0/24,203.0.113.7
  NFS_SERVER=10.0.0.10:/volume1/mail
  MAILDATA_PATH=/mnt/maildata/homes
  ANTIVIRUS=0
  ```
  Names are the upper-case versions of the flags (see `deploy/installer/lib/options.sh`).
* **Upgrade** the panel (code, helper scripts, sudoers, systemd units – not mail, config or data):

  ```bash
  curl -fsSL https://raw.githubusercontent.com/jundazhu2007/roundcube-mail-admin/main/install.sh | sudo bash -s -- --upgrade
  ```
  Pin a release with `MAIL_ADMIN_REF=v1.1.1`.
* Roundcube and the OS packages are updated from the panel's **System updates** page.

## Attaching the panel to an existing mail server

`--mode admin-only` installs just the admin panel (and Apache) and connects it to a database you already have:

```bash
sudo ./install.sh --mode admin-only --hostname panel.example.com --admin-allow 10.0.0.0/8 \
  --db-host 127.0.0.1 --db-user mailuser --db-pass '…' --db-name mailserver \
  --maildata-path /var/vmail --create-schema
```

The panel expects Postfix/Dovecot to read the same three tables (`domains`, `users`, `aliases` –
[`deploy/templates/sql/schema.sql`](../deploy/templates/sql/schema.sql)) and Dovecot to authenticate from
`/etc/dovecot/virtual-users`; see the Postfix lookups in
[`deploy/templates/postfix/mysql/`](../deploy/templates/postfix/mysql) and the Dovecot settings in
[`deploy/templates/dovecot/dovecot.conf`](../deploy/templates/dovecot/dovecot.conf). The services it detects
(postfix, dovecot, …) are shown on the Services page; add others with `--extra-services`.

## What the installer changes on your system

| Area | Files / actions |
|---|---|
| Packages | Postfix, Dovecot, MariaDB, Amavis, ClamAV, SpamAssassin, OpenDKIM, Apache + PHP, certbot, fail2ban, nftables, … (`apt`) |
| Accounts | `vmail` (uid 5000), `mailadmin` (runs the API), MariaDB users `mailuser` (DML only) and `roundcube` |
| Postfix | `postconf -e` settings, a marked block in `master.cf`, `/etc/postfix/mysql/*.cf`; originals saved as `*.pre-mail-admin` |
| Dovecot | `/etc/dovecot/dovecot.conf` (original saved), `/etc/dovecot/virtual-users` |
| Amavis / DKIM | `/etc/amavis/conf.d/{15-content_filter_mode,50-user,60-mail-admin}`, `/etc/opendkim*` |
| Web | `/etc/apache2/sites-available/mail-admin*.conf`, `/etc/apache2/mail-admin/*.inc`, `/var/www/roundcube` |
| Panel | `/opt/mail-admin`, `/etc/mail-admin/` (env, TLS links, install.conf), `/etc/sudoers.d/mail-admin`, `/usr/local/sbin/mail-admin-*`, systemd units |
| Optional | `/etc/fstab` + systemd drop-ins (NFS), `cloudflared`, `ufw`, `/etc/fail2ban/jail.local`, `/etc/aliases` (root → first mailbox) |

## Troubleshooting

| Symptom | Look at |
|---|---|
| Installer stops with an error | it names the failing line; fix and re-run `sudo mail-admin-install --yes` (idempotent) |
| No certificate | the report says so; check DNS, port 80, or the Cloudflare token, then re-run |
| Panel unreachable (403) | `--admin-allow` does not include your IP – re-run: `sudo mail-admin-install --yes --admin-allow YOUR.IP.ADDR/32,192.168.1.0/24` |
| API won't start | `journalctl -u mail-admin -n 50` |
| Mail not delivered | `tail -f /var/log/mail.log`, `postqueue -p` |
| Outgoing mail never arrives | provider blocks port 25 → `--relayhost` |
| Antivirus eats RAM | `--no-antivirus`, or add swap |
