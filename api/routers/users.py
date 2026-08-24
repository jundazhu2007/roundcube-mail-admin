import os
import re
import subprocess
import mysql.connector
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.auth import require_permission
from api.config import DB_HOST, DB_USER, DB_PASS, DB_NAME, MAILDATA_PATH, DEFAULT_MAIL_DOMAIN

router = APIRouter()

LOCAL_PART_RE = re.compile(r"^[A-Za-z0-9._%+-]{1,64}$")
DOMAIN_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")
MIN_PASSWORD_LENGTH = 12


def get_db():
    return mysql.connector.connect(
        host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME
    )


def rebuild_virtual_users():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT email, password FROM users WHERE active=1")
    rows = cursor.fetchall()
    db.close()
    content = "".join(f"{email}:{pw_hash}\n" for email, pw_hash in rows)
    subprocess.run(['sudo', 'tee', '/etc/dovecot/virtual-users'],
                    input=content, capture_output=True, text=True)
    subprocess.run(['sudo', 'chmod', '644', '/etc/dovecot/virtual-users'])


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
        maildir = os.path.join(MAILDATA_PATH, domain, username, 'Maildir')
        # Maildir 屬於 vmail:vmail，運行後端服務的系統帳號沒有讀取權限，必須透過 sudo（已在 NOPASSWD 白名單內）
        r = subprocess.run(['sudo', 'du', '-sm', maildir], capture_output=True, text=True)
        size = r.stdout.split('\t')[0].strip() if r.returncode == 0 else "0"
        size = size or "0"
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
    if not LOCAL_PART_RE.match(user.username):
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

    maildir = os.path.join(MAILDATA_PATH, user.domain, user.username, 'Maildir')
    subprocess.run(['sudo', 'mkdir', '-p', f"{maildir}/new", f"{maildir}/cur", f"{maildir}/tmp"])
    subprocess.run(['sudo', 'chown', '-R', 'vmail:vmail',
                     os.path.join(MAILDATA_PATH, user.domain, user.username)])

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

    if LOCAL_PART_RE.match(username) and DOMAIN_RE.match(domain):
        subprocess.run(['sudo', 'rm', '-rf', os.path.join(MAILDATA_PATH, domain, username)])

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
