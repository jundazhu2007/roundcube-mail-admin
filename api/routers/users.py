import os
import re
import subprocess
import time
import mysql.connector
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.auth import require_permission
from api import privileged
from api.config import DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, MAILDATA_PATH, DEFAULT_MAIL_DOMAIN

router = APIRouter()

LOCAL_PART_RE = re.compile(r"^[A-Za-z0-9._%+-]{1,64}$")


def _is_safe_local_part(name: str) -> bool:
    """The username becomes a directory name under MAILDATA_PATH (and is passed to `sudo rm -rf` on delete),
    so '.', '..' and anything that starts/ends with a dot or contains '..' must never be accepted."""
    return bool(LOCAL_PART_RE.match(name)) and not name.startswith(".") and not name.endswith(".") and ".." not in name
DOMAIN_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")
MIN_PASSWORD_LENGTH = 12

# 信箱大小要對 NAS 上的每個檔案做 stat（du 走 NFS），每次打開使用者頁都重算一遍既慢又會在 auth.log 留一堆 sudo 紀錄；
# 快取 5 分鐘，大小最多晚 5 分鐘更新，對管理用途沒有影響。
MAILDIR_SIZE_TTL = 300
_maildir_size_cache = {}


def _maildir_size_mb(domain, username):
    key = (domain, username)
    hit = _maildir_size_cache.get(key)
    if hit and time.time() - hit[1] < MAILDIR_SIZE_TTL:
        return hit[0]
    # Mailboxes belong to vmail:vmail and are not readable by the service account: ask the privileged helper
    r = privileged.run_helper("maildir-size", domain, username)
    size = (r.stdout.strip() if r.returncode == 0 else "0") or "0"
    _maildir_size_cache[key] = (size, time.time())
    return size


def get_db():
    return mysql.connector.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASS, database=DB_NAME
    )


def rebuild_virtual_users():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT email, password FROM users WHERE active=1")
    rows = cursor.fetchall()
    db.close()
    content = "".join(f"{email}:{pw_hash}\n" for email, pw_hash in rows)
    r = privileged.run_helper("write-virtual-users", input=content)
    if r.returncode != 0:
        raise HTTPException(status_code=500, detail={"code": "virtual_users_write_failed"})


def hash_password(password: str) -> str:
    r = subprocess.run(['doveadm', 'pw', '-s', 'SHA512-CRYPT', '-p', password],
                        capture_output=True, text=True)
    return r.stdout.strip()


class UserCreate(BaseModel):
    username: str
    password: str
    domain: str = DEFAULT_MAIL_DOMAIN
    quota_mb: int = 10240


class PasswordReset(BaseModel):
    password: str


class UserUpdate(BaseModel):
    quota_mb: int
    active: bool


@router.get("/", dependencies=[Depends(require_permission("users", "view"))])
def list_users():
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT u.id, u.email, u.quota_mb, u.active, d.name "
        "FROM users u JOIN domains d ON u.domain_id = d.id "
        "ORDER BY u.email"
    )
    rows = cursor.fetchall()
    db.close()

    users = []
    for id_, email, quota_mb, active, domain in rows:
        username = email.split('@')[0]
        size = _maildir_size_mb(domain, username)
        users.append({
            "id": id_,
            "username": username,
            "email": email,
            "domain": domain,
            "quota_mb": quota_mb,
            "active": bool(active),
            "maildir_size_mb": size,
        })
    return users


@router.post("/", dependencies=[Depends(require_permission("users", "modify"))])
def create_user(user: UserCreate):
    if not _is_safe_local_part(user.username):
        raise HTTPException(status_code=400, detail={"code": "invalid_username_format"})
    if not DOMAIN_RE.match(user.domain):
        raise HTTPException(status_code=400, detail={"code": "invalid_domain_format"})
    if len(user.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail={"code": "password_too_short", "params": {"min": MIN_PASSWORD_LENGTH}})

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id FROM domains WHERE name=%s AND active=1", (user.domain,))
    domain_row = cursor.fetchone()
    if not domain_row:
        db.close()
        raise HTTPException(status_code=400, detail={"code": "domain_not_found"})

    pw_hash = hash_password(user.password)
    email = f"{user.username}@{user.domain}"

    try:
        cursor.execute(
            "INSERT INTO users (domain_id, email, password, quota_mb) VALUES (%s, %s, %s, %s)",
            (domain_row[0], email, pw_hash, user.quota_mb),
        )
        db.commit()
    except mysql.connector.IntegrityError:
        db.close()
        raise HTTPException(status_code=400, detail={"code": "email_exists"})
    db.close()

    r = privileged.run_helper("maildir-create", user.domain, user.username)
    if r.returncode != 0:
        raise HTTPException(status_code=500, detail={"code": "maildir_create_failed"})

    rebuild_virtual_users()

    return {"status": "ok", "email": email}


@router.delete("/{email:path}", dependencies=[Depends(require_permission("users", "modify"))])
def delete_user(email: str):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT u.email, d.name FROM users u JOIN domains d ON u.domain_id = d.id WHERE u.email=%s",
        (email,),
    )
    row = cursor.fetchone()
    if not row:
        db.close()
        raise HTTPException(status_code=404, detail={"code": "user_not_found"})

    found_email, domain = row
    username = found_email.split('@')[0]

    cursor.execute("DELETE FROM users WHERE email=%s", (email,))
    db.commit()
    db.close()

    if _is_safe_local_part(username) and DOMAIN_RE.match(domain):
        privileged.run_helper("maildir-delete", domain, username)

    rebuild_virtual_users()
    return {"status": "ok"}


@router.put("/{email:path}", dependencies=[Depends(require_permission("users", "modify"))])
def update_user(email: str, req: UserUpdate):
    if req.quota_mb < 0:
        raise HTTPException(status_code=400, detail={"code": "quota_negative"})

    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE users SET quota_mb=%s, active=%s WHERE email=%s",
        (req.quota_mb, int(req.active), email),
    )
    db.commit()
    updated = cursor.rowcount
    db.close()
    if not updated:
        raise HTTPException(status_code=404, detail={"code": "user_not_found_or_unchanged"})
    rebuild_virtual_users()
    return {"status": "ok"}


@router.post("/{email:path}/password", dependencies=[Depends(require_permission("users", "modify"))])
def reset_password(email: str, req: PasswordReset):
    if len(req.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail={"code": "password_too_short", "params": {"min": MIN_PASSWORD_LENGTH}})
    db = get_db()
    cursor = db.cursor()
    pw_hash = hash_password(req.password)
    cursor.execute("UPDATE users SET password=%s WHERE email=%s", (pw_hash, email))
    db.commit()
    updated = cursor.rowcount
    db.close()
    if not updated:
        raise HTTPException(status_code=404, detail={"code": "user_not_found"})
    rebuild_virtual_users()
    return {"status": "ok"}
