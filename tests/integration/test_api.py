"""Integration test: drives the FastAPI app (in-process, no network) against a real MariaDB and the real
privileged helper. Run through tests/integration/run.sh, which prepares the environment."""
import os
import re
import subprocess
import sys

from fastapi.testclient import TestClient

from api.main import app

TMP = os.environ["TEST_TMP"]
HOME_DIR = os.path.join(TMP, "mail", "homes")
HELPER = os.environ["MAIL_ADMIN_HELPER"]
passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


# no `with` block: background loops (which poll apt, GitHub, logs) are not started
c = TestClient(app, raise_server_exceptions=False)

r = c.get("/api/health")
check("health reports the version", r.status_code == 200 and r.json().get("version") == open(os.path.join(os.getcwd(), "VERSION")).read().strip(), r.text)

r = c.post("/api/login", json={"username": "tester", "password": "wrong"})
check("wrong password is rejected", r.status_code == 401)
r = c.post("/api/login", json={"username": "tester", "password": "integration-test-pw"})
check("login with the bootstrap admin works", r.status_code == 200 and "access_token" in r.json(), r.text)
H = {"Authorization": "Bearer " + r.json()["access_token"]}

# ---- domains / users / aliases against the schema the installer created
r = c.post("/api/domains/", json={"name": "test.example"}, headers=H)
check("create domain", r.status_code == 200, r.text)
r = c.post("/api/domains/", json={"name": "test.example"}, headers=H)
check("duplicate domain rejected", r.status_code == 400)

pw = "correct horse battery staple"
r = c.post("/api/users/", json={"username": "alice", "password": pw, "domain": "test.example", "quota_mb": 1024}, headers=H)
check("create mailbox", r.status_code == 200 and r.json().get("email") == "alice@test.example", r.text)

for sub in ("new", "cur", "tmp"):
    check(f"Maildir/{sub} created", os.path.isdir(os.path.join(HOME_DIR, "test.example", "alice", "Maildir", sub)))
mode = oct(os.stat(os.path.join(HOME_DIR, "test.example", "alice", "Maildir")).st_mode & 0o777)
check("mailbox directory is private (0700)", mode == "0o700", mode)
mode = oct(os.stat(os.path.join(HOME_DIR, "test.example")).st_mode & 0o777)
check("domain directory is 0750", mode == "0o750", mode)

vu = open(os.path.join(TMP, "etc", "dovecot", "virtual-users")).read().strip().splitlines()
check("virtual-users has exactly the new mailbox", len(vu) == 1 and vu[0].startswith("alice@test.example:{SHA512-CRYPT}$6$"), repr(vu))
h = vu[0].split(":", 1)[1]
ok = subprocess.run(["doveadm", "pw", "-t", h, "-p", pw], capture_output=True, text=True)
check("the stored hash verifies with doveadm", ok.returncode == 0, ok.stdout + ok.stderr)
bad = subprocess.run(["doveadm", "pw", "-t", h, "-p", "not the password"], capture_output=True, text=True)
check("...and rejects a wrong password", bad.returncode != 0)
check("virtual-users is world-readable 0644", oct(os.stat(os.path.join(TMP, "etc", "dovecot", "virtual-users")).st_mode & 0o777) == "0o644")

r = c.get("/api/users/", headers=H)
check("list users includes size from the helper", r.status_code == 200 and r.json()[0]["maildir_size_mb"] in ("0", "1"), r.text)

for bad_name in ("..", ".", ".hidden", "a..b", "trailing.", "a/b", "x" * 65):
    r = c.post("/api/users/", json={"username": bad_name, "password": pw, "domain": "test.example"}, headers=H)
    check(f"username {bad_name[:12]!r} rejected", r.status_code == 400, r.text)
r = c.post("/api/users/", json={"username": "bob", "password": "short", "domain": "test.example"}, headers=H)
check("short password rejected", r.status_code == 400)

r = c.post("/api/aliases/", json={"alias_prefix": "info", "domain": "test.example", "destination_email": "alice@test.example"}, headers=H)
check("create alias", r.status_code == 200, r.text)
r = c.post("/api/aliases/", json={"alias_prefix": "ghost", "domain": "test.example", "destination_email": "nobody@test.example"}, headers=H)
check("alias to a non-existent mailbox rejected", r.status_code == 400)
r = c.get("/api/aliases/", headers=H)
check("list aliases", r.status_code == 200 and r.json()[0]["alias"] == "info@test.example", r.text)

# ---- settings -> Amavis override through the helper
r = c.post("/api/settings/", json={"spamassassin_threshold": 6.5, "default_quota_mb": 2048}, headers=H)
check("update spam threshold", r.status_code == 200, r.text)
amavis = open(os.path.join(TMP, "etc", "amavis", "conf.d", "50-user")).read()
check("Amavis override written with the new threshold", "$sa_tag2_level_deflt = 6.5;" in amavis and "$sa_kill_level_deflt = 6.5;" in amavis, amavis)

# ---- IP lists -> helper
r = c.post("/api/ip-lists/whitelist", json={"ip": "203.0.113.9", "note": "test"}, headers=H)
check("add whitelist entry", r.status_code == 200, r.text)
r = c.post("/api/ip-lists/blacklist", json={"ip": "198.51.100.77", "note": "test"}, headers=H)
check("add blacklist entry", r.status_code == 200, r.text)
check("whitelist file written", open(os.path.join(TMP, "etc", "mail-admin", "whitelist-ips.txt")).read() == "203.0.113.9\n")
check("blacklist file written", open(os.path.join(TMP, "etc", "mail-admin", "blacklist-ips.txt")).read() == "198.51.100.77\n")
r = c.post("/api/ip-lists/blacklist", json={"ip": "not-an-ip"}, headers=H)
check("invalid IP rejected by the API", r.status_code == 400)

# ---- bulk add / delete (IP lists page)
r = c.post("/api/ip-lists/blacklist/bulk", json={"ips": ["198.51.100.1", "198.51.100.2", "198.51.100.77", "bogus", " "], "note": "bulk"}, headers=H)
check("bulk add reports added / duplicate / invalid", r.status_code == 200 and r.json() == {"added": ["198.51.100.1", "198.51.100.2"], "duplicates": ["198.51.100.77"], "invalid": ["bogus"]}, r.text)
bl = open(os.path.join(TMP, "etc", "mail-admin", "blacklist-ips.txt")).read().split()
check("bulk add is written to the sync file once, validated", sorted(bl) == ["198.51.100.1", "198.51.100.2", "198.51.100.77"], str(bl))
r = c.post("/api/ip-lists/nonsense/bulk", json={"ips": ["198.51.100.9"]}, headers=H)
check("unknown list name rejected", r.status_code == 422)
r = c.post("/api/ip-lists/blacklist/bulk-delete", json={"ips": ["198.51.100.1", "198.51.100.2", "203.0.113.200"]}, headers=H)
check("bulk delete removes only existing entries", r.status_code == 200 and r.json() == {"removed": 2}, r.text)
check("blacklist file updated after bulk delete", open(os.path.join(TMP, "etc", "mail-admin", "blacklist-ips.txt")).read() == "198.51.100.77\n")

# ---- delete path
r = c.delete("/api/users/alice@test.example", headers=H)
check("delete mailbox", r.status_code == 200, r.text)
check("mailbox directory removed", not os.path.exists(os.path.join(HOME_DIR, "test.example", "alice")))
check("...but the base directory survives", os.path.isdir(HOME_DIR))
check("virtual-users emptied", open(os.path.join(TMP, "etc", "dovecot", "virtual-users")).read() == "")


# ---- the helper refuses anything it should not do (called directly, as the API would through sudo)
def helper(*args, stdin=None):
    return subprocess.run([HELPER, *args], input=stdin, capture_output=True, text=True)


r = helper("maildir-create", "../etc", "root"); check("helper: domain with .. refused", r.returncode != 0)
r = helper("maildir-create", "test.example", ".."); check("helper: user .. refused", r.returncode != 0)
r = helper("maildir-delete", "test.example", ".."); check("helper: delete user .. refused", r.returncode != 0)
check("helper: nothing outside the mail dir was touched", os.path.isdir(HOME_DIR))
os.makedirs(os.path.join(HOME_DIR, "test.example"), exist_ok=True)
victim = os.path.join(TMP, "victim"); os.makedirs(victim)
open(os.path.join(victim, "keep.txt"), "w").write("x")
os.symlink(victim, os.path.join(HOME_DIR, "test.example", "evil"))
r = helper("maildir-delete", "test.example", "evil")
check("helper: refuses to follow a symlink", r.returncode != 0 and os.path.exists(os.path.join(victim, "keep.txt")), r.stderr)
r = helper("write-virtual-users", stdin="evil@x.example:{PLAIN}secret::0:0::/:/bin/sh\n")
check("helper: rejects a passwd-file line with extra fields", r.returncode != 0)
r = helper("write-virtual-users", stdin="a@x.example:{SHA512-CRYPT}$6$abcdefgh$ijklmnopqrstuvwxyz\na@x.example:{SHA512-CRYPT}$6$abcdefgh$zzzzzzzzzzzzzzzzz\n")
check("helper: rejects duplicate users", r.returncode != 0)
r = helper("write-amavis-override", stdin='use strict;\nsystem("id");\n1;\n')
check("helper: rejects arbitrary Perl in the Amavis override", r.returncode != 0)
r = helper("write-ip-list", "blacklist", stdin="203.0.113.1\n; rm -rf /\n")
check("helper: rejects non-IP lines", r.returncode != 0)
r = helper("write-ip-list", "../../etc/passwd", stdin="")
check("helper: rejects an unknown list name", r.returncode != 0)
r = helper("rm-everything"); check("helper: unknown command refused", r.returncode != 0)
r = helper("maildir-size", "test.example"); check("helper: wrong argument count refused", r.returncode != 0)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
