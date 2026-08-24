import json
import os
from datetime import datetime, timezone

import bcrypt

from api.config import ADMINS_FILE

ADMIN_LOGINS_LOG = os.path.join(os.path.dirname(ADMINS_FILE), "admin_logins.log")


def log_admin_login(username: str, success: bool, ip: str, user_agent: str):
    """後台登入紀錄，一行一筆 JSON（JSONL），比照 webmail 那邊的做法。
    運行後端服務的系統帳號對 api/data/ 有寫入權限，不需要 sudo，直接 append 即可。"""
    entry = {
        "time": datetime.now(timezone.utc).isoformat(),
        "username": username or "",
        "success": success,
        "ip": ip,
        "user_agent": user_agent or "",
    }
    os.makedirs(os.path.dirname(ADMIN_LOGINS_LOG), exist_ok=True)
    with open(ADMIN_LOGINS_LOG, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

MODULES_WITH_MODIFY = {"users", "domains", "aliases", "services", "settings", "ip_lists", "webmail_policy"}
MODULES_VIEW_ONLY = {"logs", "stats", "security", "webmail_logins", "admin_logins"}
ALL_MODULES = MODULES_WITH_MODIFY | MODULES_VIEW_ONLY

PHONE_DIAL_CODES = {"JP": "81", "TW": "886"}


def canonicalize_phone(country: str, raw: str) -> str:
    """把使用者輸入的電話號碼正規化成唯一的比對用格式（例如 +886912345678），
    不管當初輸入時開頭有沒有帶 0、有沒有帶符號分隔，正規化後都會是同一個結果。
    只支援日本／台灣（PHONE_DIAL_CODES 裡列的），其他國碼直接拒絕。"""
    if country not in PHONE_DIAL_CODES:
        raise ValueError("unsupported_country")
    digits = "".join(c for c in raw if c.isdigit())
    if digits.startswith("0"):
        digits = digits[1:]
    if not digits:
        raise ValueError("empty_phone")
    return f"+{PHONE_DIAL_CODES[country]}{digits}"


def _full_permissions():
    perms = {}
    for m in MODULES_WITH_MODIFY:
        perms[m] = {"view": True, "modify": True}
    for m in MODULES_VIEW_ONLY:
        perms[m] = {"view": True}
    return perms


def ensure_admins_file():
    """檔案不存在時，用環境變數的既有管理員建立第一筆 super_admin 帳號。
    Idempotent：檔案已存在就完全不動，每次 service 啟動呼叫都安全。"""
    if os.path.exists(ADMINS_FILE):
        return
    admin_user = os.environ["MAIL_ADMIN_USER"]
    admin_pass_hash = os.environ["MAIL_ADMIN_PASS_HASH"]
    data = {
        "schema_version": 1,
        "admins": [{
            "username": admin_user,
            "password_hash": admin_pass_hash,
            "display_name": admin_user,
            "disabled": False,
            "super_admin": True,
            "manage_admins": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "permissions": _full_permissions(),
        }],
    }
    save_admins(data)


def load_admins():
    with open(ADMINS_FILE) as f:
        return json.load(f)


def save_admins(data):
    os.makedirs(os.path.dirname(ADMINS_FILE), exist_ok=True)
    with open(ADMINS_FILE, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def find_admin(username: str):
    data = load_admins()
    for a in data["admins"]:
        if a["username"] == username:
            return a
    return None


def find_admin_by_phone(phone_e164: str):
    data = load_admins()
    for a in data["admins"]:
        if a.get("phone_e164") == phone_e164:
            return a
    return None


def verify_password(admin: dict, password: str) -> bool:
    return bcrypt.checkpw(password.encode(), admin["password_hash"].encode())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def count_enabled_super_admins(data) -> int:
    return sum(1 for a in data["admins"] if a.get("super_admin") and not a.get("disabled"))
