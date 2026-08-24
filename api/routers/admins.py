from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import verify_token, require_manage_admins
from api.admin_store import (
    load_admins, save_admins, verify_password, hash_password,
    count_enabled_super_admins, _full_permissions, ALL_MODULES, MODULES_WITH_MODIFY,
    canonicalize_phone, find_admin_by_phone, PHONE_DIAL_CODES,
)

router = APIRouter()

MIN_PASSWORD_LENGTH = 12


def _check_password_strength(password: str):
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail={"code": "password_too_short", "params": {"min": MIN_PASSWORD_LENGTH}})


def _public(admin: dict) -> dict:
    return {k: v for k, v in admin.items() if k != "password_hash"}


def _validate_permissions(permissions: dict):
    for module, actions in (permissions or {}).items():
        if module not in ALL_MODULES:
            raise HTTPException(status_code=400, detail={"code": "unknown_module", "module": module})
        if not isinstance(actions, dict) or "view" not in actions:
            raise HTTPException(status_code=400, detail={"code": "invalid_permissions", "module": module})
        if module not in MODULES_WITH_MODIFY and actions.get("modify"):
            raise HTTPException(status_code=400, detail={"code": "modify_not_applicable", "module": module})


class AdminCreate(BaseModel):
    username: str
    password: str
    display_name: str = ""
    permissions: dict = {}
    manage_admins: bool = False
    super_admin: bool = False


class AdminUpdate(BaseModel):
    display_name: str = ""
    disabled: bool = False
    permissions: dict = {}
    manage_admins: bool = False
    super_admin: bool = False


class PasswordSet(BaseModel):
    password: str


class SelfPasswordChange(BaseModel):
    old_password: str
    new_password: str


class PhoneBind(BaseModel):
    country: str
    phone: str


@router.get("/me")
def get_me(admin: dict = Depends(verify_token)):
    return _public(admin)


@router.post("/me/phone")
def bind_own_phone(req: PhoneBind, admin: dict = Depends(verify_token)):
    if req.country not in PHONE_DIAL_CODES:
        raise HTTPException(status_code=400, detail={"code": "unsupported_phone_country"})
    try:
        phone_e164 = canonicalize_phone(req.country, req.phone)
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "invalid_phone_format"})

    existing = find_admin_by_phone(phone_e164)
    if existing and existing["username"] != admin["username"]:
        raise HTTPException(status_code=400, detail={"code": "phone_already_bound"})

    data = load_admins()
    record = next(a for a in data["admins"] if a["username"] == admin["username"])
    record["phone_country"] = req.country
    record["phone_raw"] = req.phone
    record["phone_e164"] = phone_e164
    save_admins(data)
    return {"status": "ok", "phone_e164": phone_e164}


@router.delete("/me/phone")
def unbind_own_phone(admin: dict = Depends(verify_token)):
    data = load_admins()
    record = next(a for a in data["admins"] if a["username"] == admin["username"])
    for k in ("phone_country", "phone_raw", "phone_e164"):
        record.pop(k, None)
    save_admins(data)
    return {"status": "ok"}


@router.post("/me/password")
def change_own_password(req: SelfPasswordChange, admin: dict = Depends(verify_token)):
    if not verify_password(admin, req.old_password):
        raise HTTPException(status_code=401, detail={"code": "wrong_password"})
    _check_password_strength(req.new_password)
    data = load_admins()
    record = next(a for a in data["admins"] if a["username"] == admin["username"])
    record["password_hash"] = hash_password(req.new_password)
    save_admins(data)
    return {"status": "ok"}


@router.get("/", dependencies=[Depends(require_manage_admins())])
def list_admins():
    return [_public(a) for a in load_admins()["admins"]]


@router.post("/", dependencies=[Depends(require_manage_admins())])
def create_admin(req: AdminCreate):
    if not req.username.strip():
        raise HTTPException(status_code=400, detail={"code": "username_required"})
    _check_password_strength(req.password)
    _validate_permissions(req.permissions)

    data = load_admins()
    if any(a["username"] == req.username for a in data["admins"]):
        raise HTTPException(status_code=400, detail={"code": "username_exists"})

    data["admins"].append({
        "username": req.username,
        "password_hash": hash_password(req.password),
        "display_name": req.display_name or req.username,
        "disabled": False,
        "super_admin": req.super_admin,
        "manage_admins": req.manage_admins,
        "permissions": req.permissions or _full_permissions(),
    })
    save_admins(data)
    return {"status": "ok"}


@router.put("/{username}", dependencies=[Depends(require_manage_admins())])
def update_admin(username: str, req: AdminUpdate):
    _validate_permissions(req.permissions)
    data = load_admins()
    record = next((a for a in data["admins"] if a["username"] == username), None)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "admin_not_found"})

    would_lose_super = record.get("super_admin") and not req.super_admin
    would_disable = req.disabled and record.get("super_admin")
    if (would_lose_super or would_disable) and count_enabled_super_admins(data) <= 1:
        raise HTTPException(status_code=400, detail={"code": "last_super_admin"})

    record["display_name"] = req.display_name or username
    record["disabled"] = req.disabled
    record["permissions"] = req.permissions or {}
    record["manage_admins"] = req.manage_admins
    record["super_admin"] = req.super_admin
    save_admins(data)
    return {"status": "ok"}


@router.post("/{username}/password", dependencies=[Depends(require_manage_admins())])
def reset_admin_password(username: str, req: PasswordSet):
    _check_password_strength(req.password)
    data = load_admins()
    record = next((a for a in data["admins"] if a["username"] == username), None)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "admin_not_found"})
    record["password_hash"] = hash_password(req.password)
    save_admins(data)
    return {"status": "ok"}


@router.delete("/{username}")
def delete_admin(username: str, admin: dict = Depends(require_manage_admins())):
    if username == admin["username"]:
        raise HTTPException(status_code=400, detail={"code": "cannot_delete_self"})

    data = load_admins()
    record = next((a for a in data["admins"] if a["username"] == username), None)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "admin_not_found"})

    if record.get("super_admin") and not record.get("disabled") and count_enabled_super_admins(data) <= 1:
        raise HTTPException(status_code=400, detail={"code": "last_super_admin"})

    data["admins"] = [a for a in data["admins"] if a["username"] != username]
    save_admins(data)
    return {"status": "ok"}
