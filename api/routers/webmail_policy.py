import json
import os

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.auth import require_permission
from api.config import WEBMAIL_POLICY_FILE
from api.routers.security import _geo_lookup, _pick_country, _is_private

router = APIRouter()

DEFAULT_POLICY = {"mode": "disabled", "countries": []}  # mode: disabled | whitelist | blacklist


def _load():
    if os.path.exists(WEBMAIL_POLICY_FILE):
        try:
            with open(WEBMAIL_POLICY_FILE) as f:
                return {**DEFAULT_POLICY, **json.load(f)}
        except (json.JSONDecodeError, OSError):
            pass
    return dict(DEFAULT_POLICY)


def _save(data):
    os.makedirs(os.path.dirname(WEBMAIL_POLICY_FILE), exist_ok=True)
    with open(WEBMAIL_POLICY_FILE, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


class PolicyUpdate(BaseModel):
    mode: str
    countries: list[str] = []


@router.get("/", dependencies=[Depends(require_permission("webmail_policy", "view"))])
def get_policy():
    return _load()


@router.put("/", dependencies=[Depends(require_permission("webmail_policy", "modify"))])
def update_policy(req: PolicyUpdate):
    if req.mode not in ("disabled", "whitelist", "blacklist"):
        return {"status": "error", "code": "invalid_mode"}
    data = {"mode": req.mode, "countries": [c.upper() for c in req.countries]}
    _save(data)
    return {"status": "ok"}


@router.get("/check")
def check_ip(ip: str):
    """給 Roundcube 的 country_gate plugin 用，只從本機（127.0.0.1）呼叫，不需要認證。
    刻意「查詢失敗/查不到就一律放行」（fail open）：這是防止使用者被鎖在 webmail 外面最重要的安全設計，
    寧可這個功能在異常狀況下完全不生效，也不要因為它自己出問題而擋到正常使用者登入。"""
    try:
        policy = _load()
        if policy["mode"] == "disabled":
            return {"allowed": True, "reason": "policy_disabled"}

        if _is_private(ip):
            return {"allowed": True, "reason": "private_ip"}

        geo = _geo_lookup([ip]).get(ip, {})
        picked = _pick_country(geo)
        if not picked:
            return {"allowed": True, "reason": "country_unknown"}
        code = picked[0]

        if policy["mode"] == "whitelist":
            allowed = code in policy["countries"]
        else:  # blacklist
            allowed = code not in policy["countries"]
        return {"allowed": allowed, "reason": "policy_match", "country": code}
    except Exception:
        # 任何未預期錯誤：一律放行，絕對不能因為這支 API 本身壞掉而讓合法使用者登不進 webmail
        return {"allowed": True, "reason": "check_error"}
