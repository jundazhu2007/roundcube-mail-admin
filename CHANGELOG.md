# Changelog

## [1.1.0] – 2026-10-15

### Added
- **One-command installer** (`install.sh`): installs and configures Postfix, Dovecot 2.4, MariaDB, Amavis
  (ClamAV + SpamAssassin), OpenDKIM, Roundcube 1.7, Apache, certbot, fail2ban and the admin panel on Ubuntu
  26.04 LTS. Interactive wizard, fully scriptable with flags or a config file, `--dry-run`, idempotent re-runs,
  `--upgrade`, `--mode admin-only` for existing servers. Prints the DNS records to create.
- Optional **Cloudflare** support: Tunnel (`cloudflared`) for the web UI and Let's Encrypt via the Cloudflare
  DNS API – independent of each other.
- Optional **NFS** mail storage (fstab entry + systemd `RequiresMountsFor`), or the local disk.
- Many more choices: certificate source, who may reach the panel, webmail access/plugins/skin/language,
  antivirus/antispam/DKIM on or off, smarthost relay, message size, IPv6, firewall, fail2ban, log retention.
- `mail-admin-dkim-add-domain` (DKIM for more than one domain), maintenance scripts the panel's update/scan
  buttons call, nftables/fail2ban sync of the panel's IP lists.
- Tests: template validation against the real Postfix/Dovecot/Apache/sudoers/systemd/PHP tools; API
  integration test against a real MariaDB and the real privileged helper. CI and release workflows.
- Panel: `/api/health` reports the version; `MAIL_ADMIN_DB_PORT`, `MAIL_ADMIN_MAILDATA_MOUNT`,
  `MAIL_ADMIN_INTERNAL_NETWORKS`, `MAIL_ADMIN_MANAGED_SERVICES` and other settings are configurable.

### Security
- **Login lockout could be bypassed** by sending a forged `X-Forwarded-For` header; the lockout now uses the
  address Apache observed (fixed in the running deployment earlier, now in the open-source tree).
- **Mailbox names `.` / `..`** were accepted and could make a later mailbox deletion remove the whole mail
  directory. Rejected now (API and helper).
- The API no longer has blanket `sudo rm/tee/chown/mkdir/du`: all privileged file operations go through
  `mail-admin-helper`, which validates its inputs. sudo is invoked with `-n` so a missing rule fails fast.
- Dovecot password file, Amavis override and IP list writes are validated before they reach disk; mailbox
  directories are created `0700` (domain level `0750`).

### Changed
- Dovecot configuration is now **2.4 syntax** (the 2.3-style snippets in the old guide did not work with the
  Dovecot that Ubuntu 26.04 ships). Ubuntu 24.04 (Dovecot 2.3) is not supported by this release.
- The Roundcube `country_gate` plugin and the "Webmail country policy" page were removed (the feature was
  retired in the running deployment).
- Dashboard "NAS/NFS" labels now read "Mail storage / Available" so local-disk installs do not look broken.
- Disk I/O graph sums all physical disks unless `MAIL_ADMIN_DISK_DEVICE` is set; the network interface is
  detected from the default route.
- `install.sh` is now the production installer; the old developer script is `dev-setup.sh`.

### Fixed
- Real internal network details that were hardcoded in 1.0 (subnet, interface, disk) are configurable.

## 1.0.0
Initial open-source release of the admin panel.
