# Architecture

## Components and ports

| Component | Listens on | Purpose |
|---|---|---|
| Postfix | 25 (receive), 465 (clients send, TLS + login), 127.0.0.1:587 (Roundcube), 127.0.0.1:10025 (Amavis re-injection) | SMTP |
| Dovecot 2.4 | 993 (IMAPS), unix socket for Postfix SASL | IMAP, authentication |
| Amavis | 127.0.0.1:10024 | content filter: ClamAV + SpamAssassin |
| OpenDKIM | 127.0.0.1:12301 | DKIM signing/verification (milter) |
| MariaDB | 127.0.0.1:3306 | `mailserver` (domains, users, aliases) and `roundcube` |
| Apache | 443 (+80 for ACME/redirect), 127.0.0.1:8080 (only with a Cloudflare Tunnel) | TLS, Roundcube, admin UI, reverse proxy to the API |
| Admin API | 127.0.0.1:8000 | FastAPI app, runs as the unprivileged `mailadmin` account |

## Mail flow

```
inbound:  other MTA → Postfix :25 → DKIM verify → Amavis (ClamAV, SpamAssassin) → Postfix :10025 → virtual delivery → Maildir
outbound: mail app → Postfix :465 / Roundcube → :587 → sender must be the logged-in user or an alias of it
          → Amavis → DKIM sign → internet
```

Spam is **tagged** (`***SPAM***` in the subject) and still delivered; nothing is silently dropped. Thresholds
are editable in the panel's Settings page, which rewrites `/etc/amavis/conf.d/50-user` through the helper.

## Data

* **MariaDB `mailserver`** is the source of truth for `domains`, `users` (SHA512-CRYPT hashes) and `aliases`.
  Postfix looks addresses up live (`/etc/postfix/mysql/*.cf`); adding a mailbox needs no reload.
* **Dovecot** authenticates from a flat file, `/etc/dovecot/virtual-users` (`user@domain:{SHA512-CRYPT}hash`),
  which the panel regenerates in full from the database on every change. Mailboxes are
  `<maildata>/<domain>/<user>/Maildir`, owned by `vmail`.
* **Roundcube** has its own database `roundcube` (settings, address books). It never touches `mailserver`; it
  logs in with the user's IMAP credentials.
* **Panel state** (admin accounts, passkeys, IP lists, caches, notifications) is JSON under
  `/opt/mail-admin/api/data/`, owned by `mailadmin`. Never committed, not part of the release bundle.
* **Installer state**: `/etc/mail-admin/install.conf` (answers + generated secrets, root only) and
  `/etc/mail-admin/mail-admin.env` (API environment).

## Privilege model

The API process is not root and has no general sudo. `/etc/sudoers.d/mail-admin` allows it to run only:

* `/usr/local/sbin/mail-admin-helper` – a root-owned Python program with a fixed set of verbs
  (`maildir-create|delete|size`, `write-virtual-users`, `write-amavis-override`, `write-ip-list`). Every
  argument and every input line is validated: domains and user names against strict patterns (no `.`/`..`, no
  slashes), mailbox paths must stay inside the configured mail directory and may not traverse symlinks, the
  password file accepts only well-formed `user@domain:{SCHEME}hash` lines, the Amavis override only the lines the
  Settings page generates, IP lists only valid addresses. The mail directory comes from the root-owned
  environment file, never from an argument.
* `systemctl restart <service>` for each service listed in `MAIL_ADMIN_MANAGED_SERVICES`, `systemctl reboot|poweroff`,
  and `systemctl start mail-ip-lists-sync.service`.
* The four maintenance scripts in `/usr/local/sbin/` (apt upgrade, ClamAV full scan, rkhunter check, Roundcube
  upgrade). They report progress through small state files under `/var/lib/mail-admin-*`, which the API reads.

sudoers contains **no wildcards** (sudo-rs on Ubuntu 26.04 does not allow them in arguments) and no blanket
`rm`, `tee` or `chown`. Treat compromise of the API account as the ability to manage mailboxes, but not as root.

## Network exposure

* `/admin` and `/api` are restricted in Apache by `Require ip` to the networks given with `--admin-allow`.
  The API additionally has bcrypt passwords, JWTs, per-IP lockout after repeated failures (it uses the address
  Apache observed, not a client-supplied header), optional passkeys, and role-based permissions per page.
* IP lists from the panel are applied by `mail-admin-sync-ip-lists.sh` (triggered by a systemd path unit): the
  blacklist is dropped by an nftables table (`inet mail_admin`, priority −50, whitelist wins), the whitelist
  and the admin networks are added to fail2ban's `ignoreip`.
* With `--cloudflare-tunnel-token` a second Apache virtual host listens on `127.0.0.1:8080` and `cloudflared`
  connects to it. It trusts `CF-Connecting-IP` only from loopback. SMTP/IMAP never use the tunnel.

## Where things are

| | |
|---|---|
| Installer | `install.sh` (downloads the release) → `deploy/installer/main.sh` + `lib/*.sh` |
| Templates for every generated config | `deploy/templates/` (`@NAME@` placeholders) |
| Maintenance scripts, helper | `deploy/sbin/` |
| Tests | `deploy/installer/tests/render-check.sh`, `tests/integration/` |
| Release bundle | `deploy/build-release.sh`, `.github/workflows/release.yml` |
