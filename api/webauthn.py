import base64
import json
import os
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
import webauthn
from webauthn import generate_registration_options, verify_registration_response
from webauthn import generate_authentication_options, verify_authentication_response
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria, UserVerificationRequirement,
    ResidentKeyRequirement, AttestationConveyancePreference,
    PublicKeyCredentialDescriptor,
)

from api.auth import create_token, verify_token, _find_admin_safe, _client_ip
from api.config import PASSKEYS_FILE
from api.admin_store import log_admin_login

router = APIRouter()

RP_ID = os.environ.get("WEBAUTHN_RP_ID", "localhost")
RP_NAME = os.environ.get("WEBAUTHN_RP_NAME", "NannanCat Mail Admin")
ORIGIN = os.environ.get("WEBAUTHN_ORIGIN", "http://localhost:5173")

# 短命的 challenge session，單一 uvicorn process 內用記憶體存即可
_sessions = {}
SESSION_TTL = 300


def _new_session(challenge: bytes, operation: str) -> str:
    session_id = secrets.token_urlsafe(32)
    _sessions[session_id] = {"challenge": challenge, "operation": operation, "expires": time.time() + SESSION_TTL}
    return session_id


def _pop_session(session_id: str, operation: str) -> bytes:
    s = _sessions.pop(session_id, None)
    if not s or s["operation"] != operation or s["expires"] < time.time():
        raise HTTPException(status_code=400, detail={"code": "session_expired"})
    return s["challenge"]


def _load_passkeys():
    if os.path.exists(PASSKEYS_FILE):
        with open(PASSKEYS_FILE) as f:
            return json.load(f)
    return []


def _save_passkeys(passkeys):
    os.makedirs(os.path.dirname(PASSKEYS_FILE), exist_ok=True)
    with open(PASSKEYS_FILE, "w") as f:
        json.dump(passkeys, f)


class RegisterVerify(BaseModel):
    session_id: str
    credential: dict
    nickname: str = "我的裝置"


class AuthVerify(BaseModel):
    session_id: str
    credential: dict


# ============ 註冊（必須已用密碼登入才能加 Passkey） ============

@router.post("/webauthn/register/start")
def register_start(admin: dict = Depends(verify_token)):
    challenge = secrets.token_bytes(32)
    session_id = _new_session(challenge, "register")
    own_existing = [p for p in _load_passkeys() if p.get("owner") == admin["username"]]
    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_name=admin["username"],
        user_display_name=admin.get("display_name", admin["username"]),
        challenge=challenge,
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64.b64decode(p["credential_id"]))
            for p in own_existing
        ],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        attestation=AttestationConveyancePreference.NONE,
    )
    return {"session_id": session_id, "options": json.loads(webauthn.options_to_json(options))}


@router.post("/webauthn/register/verify")
def register_verify(req: RegisterVerify, admin: dict = Depends(verify_token)):
    challenge = _pop_session(req.session_id, "register")
    try:
        verification = verify_registration_response(
            credential=req.credential,
            expected_challenge=challenge,
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail={"code": "registration_failed", "params": {"detail": str(e)}})

    passkeys = _load_passkeys()
    passkeys.append({
        "credential_id": base64.b64encode(verification.credential_id).decode(),
        "public_key": base64.b64encode(verification.credential_public_key).decode(),
        "sign_count": verification.sign_count,
        "nickname": req.nickname or "我的裝置",
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "owner": admin["username"],
    })
    _save_passkeys(passkeys)
    return {"status": "ok"}


@router.get("/webauthn/credentials")
def list_credentials(admin: dict = Depends(verify_token)):
    return [
        {"credential_id": p["credential_id"], "nickname": p.get("nickname", "裝置"), "created_at": p.get("created_at", "")}
        for p in _load_passkeys()
        if p.get("owner") == admin["username"]
    ]


@router.delete("/webauthn/credentials/{credential_id:path}")
def delete_credential(credential_id: str, admin: dict = Depends(verify_token)):
    passkeys = _load_passkeys()
    target = next((p for p in passkeys if p["credential_id"] == credential_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail={"code": "passkey_not_found"})
    if target.get("owner") != admin["username"] and not (admin.get("super_admin") or admin.get("manage_admins")):
        raise HTTPException(status_code=403, detail={"code": "permission_denied", "module": "admins", "action": "manage"})
    remaining = [p for p in passkeys if p["credential_id"] != credential_id]
    _save_passkeys(remaining)
    return {"status": "ok"}


# ============ 登入（不需要先登入，這就是登入本身） ============

@router.post("/webauthn/auth/start")
def auth_start():
    passkeys = _load_passkeys()
    if not passkeys:
        raise HTTPException(status_code=400, detail={"code": "no_passkeys_registered"})
    challenge = secrets.token_bytes(32)
    session_id = _new_session(challenge, "auth")
    options = generate_authentication_options(
        rp_id=RP_ID,
        challenge=challenge,
        allow_credentials=[
            PublicKeyCredentialDescriptor(id=base64.b64decode(p["credential_id"]))
            for p in passkeys
        ],
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    return {"session_id": session_id, "options": json.loads(webauthn.options_to_json(options))}


@router.post("/webauthn/auth/verify")
def auth_verify(req: AuthVerify, request: Request):
    ip = _client_ip(request)
    user_agent = request.headers.get("user-agent", "")
    challenge = _pop_session(req.session_id, "auth")
    passkeys = _load_passkeys()

    try:
        raw_id = webauthn.base64url_to_bytes(req.credential.get("id", ""))
    except Exception:
        log_admin_login("passkey:invalid_credential", False, ip, user_agent)
        raise HTTPException(status_code=400, detail={"code": "invalid_credential_format"})

    match = next((p for p in passkeys if base64.b64decode(p["credential_id"]) == raw_id), None)
    if not match:
        log_admin_login("passkey:unrecognized", False, ip, user_agent)
        raise HTTPException(status_code=400, detail={"code": "passkey_unrecognized"})

    try:
        verification = verify_authentication_response(
            credential=req.credential,
            expected_challenge=challenge,
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
            credential_public_key=base64.b64decode(match["public_key"]),
            credential_current_sign_count=match["sign_count"],
        )
    except Exception as e:
        log_admin_login(match.get("owner", "passkey:unknown"), False, ip, user_agent)
        raise HTTPException(status_code=400, detail={"code": "verification_failed", "params": {"detail": str(e)}})

    owner = match.get("owner")
    owner_admin = _find_admin_safe(owner) if owner else None
    if owner_admin is None or owner_admin.get("disabled"):
        log_admin_login(owner or "passkey:unknown", False, ip, user_agent)
        raise HTTPException(status_code=401, detail={"code": "passkey_owner_invalid"})

    match["sign_count"] = verification.new_sign_count
    _save_passkeys(passkeys)

    log_admin_login(owner, True, ip, user_agent)
    return {"status": "成功", "access_token": create_token(owner), "token_type": "bearer"}
