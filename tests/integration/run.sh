#!/usr/bin/env bash
# End-to-end test of the API against a throwaway MariaDB, using the installer's own database setup,
# the real privileged helper (run without sudo, inside a temp directory) and the real `doveadm`.
# Needs: mariadbd + mariadb-install-db, doveadm, and a Python with the packages from requirements.txt + httpx.
#   PYTHON=/path/to/venv/bin/python  bash tests/integration/run.sh
# Nothing outside a temp directory is touched; the database listens on 127.0.0.1:${TEST_DB_PORT:-33306}.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON="${PYTHON:-python3}"
PORT="${TEST_DB_PORT:-33306}"

for t in mariadbd mariadb-install-db mariadb doveadm; do
  command -v "$t" >/dev/null 2>&1 || { echo "SKIP: $t not installed"; exit 0; }
done

T="$(mktemp -d)"
cleanup() {
  if [ -f "$T/mdb.pid" ]; then kill "$(cat "$T/mdb.pid")" 2>/dev/null; fi
  sleep 1; rm -rf "$T"
}
trap cleanup EXIT

echo "== starting a throwaway MariaDB on 127.0.0.1:$PORT"
mariadb-install-db --no-defaults --datadir="$T/data" --auth-root-authentication-method=normal --skip-test-db >"$T/install.log" 2>&1 || { cat "$T/install.log"; exit 1; }
mariadbd --no-defaults --datadir="$T/data" --socket="$T/sock" --port="$PORT" --bind-address=127.0.0.1 \
         --pid-file="$T/mdb.pid" --skip-name-resolve --log-error="$T/err.log" >/dev/null 2>&1 &
for _ in $(seq 1 40); do mariadb -S "$T/sock" -uroot -e 'select 1' >/dev/null 2>&1 && break; sleep 1; done
mariadb -S "$T/sock" -uroot -e 'select 1' >/dev/null 2>&1 || { echo "MariaDB did not start"; cat "$T/err.log"; exit 1; }

# shims: the installer calls `mariadb` as root over the default socket and `systemctl` to enable services
mkdir -p "$T/bin"
printf '#!/bin/sh\nexec /usr/bin/mariadb -S "%s" -uroot "$@"\n' "$T/sock" > "$T/bin/mariadb"
printf '#!/bin/sh\necho "systemctl $*" >> "%s/systemctl.log"\n' "$T" > "$T/bin/systemctl"
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH"

echo "== installer: setup_database_full (the real function, real SQL)"
(
  . "$ROOT/deploy/installer/main.sh"
  set +eE; trap - ERR
  reset_options; MODE=full; MAIL_HOSTNAME=mail.test.example; MAIL_DOMAIN=test.example; TLS_MODE=selfsigned; ADMIN_ALLOW=127.0.0.1
  apply_defaults; WEBMAIL=1
  DB_MAILUSER_PASS="DbPass_$(gen_secret 12)"; RC_DB_PASS="RcPass_$(gen_secret 12)"
  DRY_RUN=0; setup_database_full || exit 1
  printf '%s' "$DB_MAILUSER_PASS" > "$T/dbpass"
) || { echo "FAIL: installer database setup"; exit 1; }

mkdir -p "$T/mail/homes" "$T/etc/dovecot" "$T/etc/mail-admin" "$T/etc/amavis/conf.d"
printf 'MAIL_ADMIN_MAILDATA_PATH=%s\nMAIL_ADMIN_AMAVIS_OVERRIDE_FILE=%s\n' "$T/mail/homes" "$T/etc/amavis/conf.d/50-user" > "$T/api.env"

MAIL_ADMIN_JWT_SECRET="test-secret-$(date +%s)"; export MAIL_ADMIN_JWT_SECRET
export MAIL_ADMIN_USER=tester
MAIL_ADMIN_PASS_HASH="$("$PYTHON" -c 'import bcrypt; print(bcrypt.hashpw(b"integration-test-pw", bcrypt.gensalt(4)).decode())')"; export MAIL_ADMIN_PASS_HASH
export MAIL_ADMIN_DB_HOST=127.0.0.1 MAIL_ADMIN_DB_PORT="$PORT" MAIL_ADMIN_DB_USER=mailuser MAIL_ADMIN_DB_NAME=mailserver
MAIL_ADMIN_DB_PASS="$(cat "$T/dbpass")"; export MAIL_ADMIN_DB_PASS
export MAIL_ADMIN_MAILDATA_PATH="$T/mail/homes"
export MAIL_ADMIN_HELPER="$ROOT/deploy/sbin/mail-admin-helper" MAIL_ADMIN_SUDO="" MAIL_ADMIN_ENV_FILE="$T/api.env" MAIL_ADMIN_HELPER_ETC="$T/etc"
export MAIL_ADMIN_DEFAULT_DOMAIN=test.example
export TEST_TMP="$T" PYTHONDONTWRITEBYTECODE=1
# the API writes its JSON state next to the code; keep that out of the repo during the test
rm -rf "$T/app" && mkdir -p "$T/app" && cp -r "$ROOT/api" "$T/app/api" && cp "$ROOT/VERSION" "$T/app/VERSION"
rm -rf "$T/app/api/data" && mkdir -p "$T/app/api/data"

echo "== API tests"
cd "$T/app" && PYTHONPATH="$T/app" "$PYTHON" -W ignore "$ROOT/tests/integration/test_api.py"
