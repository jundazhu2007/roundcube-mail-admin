import json
import os
import time
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import bcrypt
import jwt
from datetime import datetime, timedelta
from api.config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from api.admin_store import find_admin, find_admin_by_phone, verify_password, _full_permissions, canonicalize_phone, log_admin_login

router = APIRouter()
security = HTTPBearer()

ADMIN_USER = os.environ["MAIL_ADMIN_USER"]
ADMIN_PASS_HASH = os.environ["MAIL_ADMIN_PASS_HASH"].encode()

MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 300
_failed_attempts = {}  # ip -> {"count": int, "locked_until": float}


class LoginRequest(BaseModel):
    username: Optional[str] = None
    phone_country: Optional[str] = None
    phone: Optional[str] = None
    password: str


def _break_glass_admin():
    """admins.json 損毀/遺失，或該帳號被刪掉時的救援身分：永遠對應環境變數裡的原始管理員。"""
    return {
        "username": ADMIN_USER, "display_name": ADMIN_USER, "disabled": False,
        "super_admin": True, "manage_admins": True, "permissions": _full_permissions(),
    }


def _find_admin_safe(username: str):
    try:
        return find_admin(username)
    except (FileNotFoundError, json.JSONDecodeError, KeyError, OSError):
        return None


def authenticate(username: str, password: str):
    """回傳驗證成功的 admin dict，失敗回傳 None。"""
    admin = _find_admin_safe(username)
    if admin is not None:
        if admin.get("disabled") or not verify_password(admin, password):
            return None
        return admin
    if username == ADMIN_USER and bcrypt.checkpw(password.encode(), ADMIN_PASS_HASH):
        return _break_glass_admin()
    return None


def authenticate_by_phone(phone_country: str, phone: str, password: str):
    """電話號碼登入：電話當帳號用，密碼還是要輸入。只支援已在自己的系統設定裡綁定過電話的管理員。"""
    try:
        phone_e164 = canonicalize_phone(phone_country, phone)
    except ValueError:
        return None
    try:
        admin = find_admin_by_phone(phone_e164)
    except (FileNotFoundError, json.JSONDecodeError, KeyError, OSError):
        return None
    if admin is None or admin.get("disabled") or not verify_password(admin, password):
        return None
    return admin


def create_token(username: str):
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail={"code": "invalid_token"})

    admin = _find_admin_safe(username)
    if admin is None and username == ADMIN_USER:
        admin = _break_glass_admin()
    if admin is None or admin.get("disabled"):
        raise HTTPException(status_code=401, detail={"code": "invalid_token"})
    return admin


def require_permission(module: str, action: str = "view"):
    """取代單純的 Depends(verify_token)：super_admin 略過檢查，其餘要求該模組的 view/modify 權限為 true。"""
    def dependency(admin: dict = Depends(verify_token)):
        if admin.get("super_admin"):
            return admin
        if not admin.get("permissions", {}).get(module, {}).get(action):
            raise HTTPException(status_code=403, detail={"code": "permission_denied", "module": module, "action": action})
        return admin
    return dependency


def require_super_admin():
    """給關機/重開機這類高風險系統操作用，比 require_manage_admins 更嚴格，只有 super_admin 能用。"""
    def dependency(admin: dict = Depends(verify_token)):
        if not admin.get("super_admin"):
            raise HTTPException(status_code=403, detail={"code": "permission_denied", "module": "system", "action": "power"})
        return admin
    return dependency


def require_manage_admins():
    """管理員帳號本身的 CRUD 專用權限，跟一般模組的 view/modify 分開，只有 manage_admins 或 super_admin 能用。"""
    def dependency(admin: dict = Depends(verify_token)):
        if not (admin.get("super_admin") or admin.get("manage_admins")):
            raise HTTPException(status_code=403, detail={"code": "permission_denied", "module": "admins", "action": "manage"})
        return admin
    return dependency


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/login")
def login(req: LoginRequest, request: Request):
    ip = _client_ip(request)
    record = _failed_attempts.get(ip)
    now = time.time()

    if record and record["locked_until"] > now:
        remaining = int(record["locked_until"] - now)
        raise HTTPException(status_code=429, detail={"code": "too_many_attempts", "params": {"remaining": remaining}})

    if req.phone_country and req.phone:
        admin = authenticate_by_phone(req.phone_country, req.phone, req.password)
    elif req.username:
        admin = authenticate(req.username, req.password)
    else:
        raise HTTPException(status_code=400, detail={"code": "username_required"})

    attempted_identity = req.username or (f"phone:{req.phone_country}:{req.phone}" if req.phone else "")
    user_agent = request.headers.get("user-agent", "")

    if admin is None:
        record = record or {"count": 0, "locked_until": 0}
        record["count"] += 1
        if record["count"] >= MAX_ATTEMPTS:
            record["locked_until"] = now + LOCKOUT_SECONDS
            record["count"] = 0
        _failed_attempts[ip] = record
        log_admin_login(attempted_identity, False, ip, user_agent)
        raise HTTPException(status_code=401, detail={"code": "wrong_credentials"})

    _failed_attempts.pop(ip, None)
    log_admin_login(admin["username"], True, ip, user_agent)
    return {"access_token": create_token(admin["username"]), "token_type": "bearer"}
