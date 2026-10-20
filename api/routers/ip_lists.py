import ipaddress
import json
import os
import subprocess
from datetime import datetime, timezone
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import privileged
from api.auth import require_permission, verify_token
from api.config import IP_LISTS_FILE, IP_WHITELIST_SYNC_FILE, IP_BLACKLIST_SYNC_FILE
from api.routers.security import (
    _parse_fail2ban, _geo_lookup, _cached_geo, _fill_geoip_cache, _ban_count_per_ip, _is_private,
)
from api.routers.notifications import add_notification

router = APIRouter()

# 攻擊次數太頻繁的判斷門檻：歷史上被 fail2ban 真正 Ban 過 3 次（含）以上，
# 視為「反覆重犯」，自動加入永久黑名單（fail2ban 的封鎖是有時效的，時間到就解封，
# 永久黑名單則是持續生效，靠 deploy/ 內的 mail-ip-lists-sync.path（systemd path unit）同步進防火牆）。
AUTO_BLACKLIST_THRESHOLD = 3


def _validate_ip(ip: str):
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "invalid_ip_format"})


def _validate_cidr(cidr: str):
    try:
        ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "invalid_cidr_format"})


def _load():
    if os.path.exists(IP_LISTS_FILE):
        try:
            with open(IP_LISTS_FILE) as f:
                data = json.load(f)
                data.setdefault("blocked_ranges", [])
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"whitelist": [], "blacklist": [], "blocked_ranges": []}


def _save(data):
    os.makedirs(os.path.dirname(IP_LISTS_FILE), exist_ok=True)
    with open(IP_LISTS_FILE, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    _sync_to_disk(data)


def _write_sync_file(kind: str, ips: list):
    """Write the current IP list (one address per line) to /etc/mail-admin/<kind>-ips.txt through the privileged
    helper, which validates every line. Actually applying it to the firewall / fail2ban is done by a separate
    root-owned systemd path unit (deploy/templates/systemd/mail-ip-lists-sync.*), not by this process."""
    content = "\n".join(ips) + ("\n" if ips else "")
    privileged.run_helper("write-ip-list", kind, input=content, timeout=10)


def _sync_to_disk(data):
    _write_sync_file("whitelist", [e["ip"] for e in data["whitelist"]])
    _write_sync_file("blacklist", [e["ip"] for e in data["blacklist"]])
    # if the path unit is installed it has already noticed; this makes the change apply immediately
    privileged.systemctl("start", "mail-ip-lists-sync.service", timeout=10)


def _check_auto_blacklist():
    """每次讀取 IP 清單時順便檢查一次：有沒有 IP 歷史上被 fail2ban 真正封鎖過
    AUTO_BLACKLIST_THRESHOLD 次（含）以上，且還不在白名單/黑名單裡——有的話自動加入永久黑名單，
    並寫一筆通知（見 notifications.py），讓通知中心能顯示「哪個 IP 多久前被自動封鎖」。
    這個函式也會被 main.py 的背景排程週期性呼叫，不需要有人打開後台頁面才會觸發。"""
    data = _load()
    blacklisted_ips = {e["ip"] for e in data["blacklist"]}
    whitelisted_ips = {e["ip"] for e in data["whitelist"]}
    changed = False
    for ip, count in _ban_count_per_ip().items():
        # 內網 IP 永遠不自動加入永久黑名單：fail2ban 監控的 dovecot/postfix-sasl 認證失敗
        # 也可能來自內網合法使用者打錯密碼的郵件客戶端，自動封鎖內網 IP 會有把管理員自己鎖在
        # 後台/IMAP 之外的風險，這個機制只處理外部攻擊來源。
        if _is_private(ip):
            continue
        if count >= AUTO_BLACKLIST_THRESHOLD and ip not in blacklisted_ips and ip not in whitelisted_ips:
            data["blacklist"].append({
                "ip": ip,
                "note": f"系統自動加入：fail2ban 累計封鎖 {count} 次",
                "added_by": "system-auto",
                "added_at": datetime.now(timezone.utc).isoformat(),
            })
            blacklisted_ips.add(ip)
            changed = True
            add_notification("auto_blacklist", ip, ip=ip, banned_count=count)
    if changed:
        _save(data)
    return data


def fill_blacklist_geo():
    """main.py 背景排程呼叫：每輪幫永久黑名單補最多 100 個 IP 的國家/ISP（只查 GeoIP），
    清單頁面本身不再即時查黑名單的地理位置，靠這裡慢慢補齊。"""
    return _fill_geoip_cache([e["ip"] for e in _load()["blacklist"]])


class ListKind(str, Enum):
    whitelist = "whitelist"
    blacklist = "blacklist"


class IPEntryCreate(BaseModel):
    ip: str
    note: str = ""


class BulkIPCreate(BaseModel):
    ips: list[str] = Field(max_length=5000)
    note: str = ""


class BulkIPDelete(BaseModel):
    ips: list[str] = Field(max_length=5000)


class CIDREntryCreate(BaseModel):
    cidr: str
    note: str = ""


@router.get("/", dependencies=[Depends(require_permission("ip_lists", "view"))])
def get_ip_lists():
    data = _check_auto_blacklist()
    banned, _events = _parse_fail2ban()

    # 白名單跟 fail2ban 封鎖中的 IP 通常只有個位數，維持即時查詢；永久黑名單動輒上百筆，
    # 全部即時查 RDAP 會讓這頁卡 30 秒以上，所以只用快取（背景排程 fill_blacklist_geo 會慢慢補齊），
    # 完整的即時資料等點開單筆詳情時再查（GET /geo/{ip}）。
    geo = _geo_lookup(list({e["ip"] for e in data["whitelist"]} | {b["ip"] for b in banned}))
    geo = {**_cached_geo([e["ip"] for e in data["blacklist"] if e["ip"] not in geo]), **geo}
    for e in data["whitelist"]:
        e["geo"] = geo.get(e["ip"], {})
    for e in data["blacklist"]:
        e["geo"] = geo.get(e["ip"], {})
    for b in banned:
        b["geo"] = geo.get(b["ip"], {})

    return {
        "whitelist": data["whitelist"],
        "blacklist": data["blacklist"],
        "blocked_ranges": data["blocked_ranges"],
        "fail2ban_banned": banned,
    }


@router.get("/geo/{ip}", dependencies=[Depends(require_permission("ip_lists", "view"))])
def get_ip_geo(ip: str):
    _validate_ip(ip)
    return _geo_lookup([ip])[ip]


@router.post("/{kind}/bulk", dependencies=[Depends(require_permission("ip_lists", "modify"))])
def bulk_add(kind: ListKind, req: BulkIPCreate, admin: dict = Depends(verify_token)):
    """一次加入多個 IP（後台「新增」視窗可以直接貼上一整串）：格式錯誤、已經在清單裡的分別回報，
    其餘全部加入後只存檔＋同步防火牆一次。"""
    data = _load()
    entries = data[kind.value]
    existing = {e["ip"] for e in entries}
    added, duplicates, invalid = [], [], []
    added_at = datetime.now(timezone.utc).isoformat()
    for raw in req.ips:
        raw = raw.strip()
        if not raw:
            continue
        try:
            ip = str(ipaddress.ip_address(raw))
        except ValueError:
            invalid.append(raw)
            continue
        if ip in existing:
            duplicates.append(ip)
            continue
        existing.add(ip)
        entries.append({"ip": ip, "note": req.note, "added_by": admin["username"], "added_at": added_at})
        added.append(ip)
    if added:
        _save(data)
    return {"added": added, "duplicates": duplicates, "invalid": invalid}


@router.post("/{kind}/bulk-delete", dependencies=[Depends(require_permission("ip_lists", "modify"))])
def bulk_delete(kind: ListKind, req: BulkIPDelete):
    data = _load()
    targets = set(req.ips)
    remaining = [e for e in data[kind.value] if e["ip"] not in targets]
    removed = len(data[kind.value]) - len(remaining)
    if removed:
        data[kind.value] = remaining
        _save(data)
    return {"removed": removed}


@router.post("/whitelist", dependencies=[Depends(require_permission("ip_lists", "modify"))])
def add_whitelist(req: IPEntryCreate, admin: dict = Depends(verify_token)):
    _validate_ip(req.ip)
    data = _load()
    if any(e["ip"] == req.ip for e in data["whitelist"]):
        raise HTTPException(status_code=400, detail={"code": "ip_already_listed"})
    data["whitelist"].append({
        "ip": req.ip, "note": req.note, "added_by": admin["username"],
        "added_at": datetime.now(timezone.utc).isoformat(),
    })
    _save(data)
    return {"status": "ok"}


@router.delete("/whitelist/{ip}", dependencies=[Depends(require_permission("ip_lists", "modify"))])
def delete_whitelist(ip: str):
    data = _load()
    remaining = [e for e in data["whitelist"] if e["ip"] != ip]
    if len(remaining) == len(data["whitelist"]):
        raise HTTPException(status_code=404, detail={"code": "ip_not_found"})
    data["whitelist"] = remaining
    _save(data)
    return {"status": "ok"}


@router.post("/blacklist", dependencies=[Depends(require_permission("ip_lists", "modify"))])
def add_blacklist(req: IPEntryCreate, admin: dict = Depends(verify_token)):
    _validate_ip(req.ip)
    data = _load()
    if any(e["ip"] == req.ip for e in data["blacklist"]):
        raise HTTPException(status_code=400, detail={"code": "ip_already_listed"})
    data["blacklist"].append({
        "ip": req.ip, "note": req.note, "added_by": admin["username"],
        "added_at": datetime.now(timezone.utc).isoformat(),
    })
    _save(data)
    return {"status": "ok"}


@router.delete("/blacklist/{ip}", dependencies=[Depends(require_permission("ip_lists", "modify"))])
def delete_blacklist(ip: str):
    data = _load()
    remaining = [e for e in data["blacklist"] if e["ip"] != ip]
    if len(remaining) == len(data["blacklist"]):
        raise HTTPException(status_code=404, detail={"code": "ip_not_found"})
    data["blacklist"] = remaining
    _save(data)
    return {"status": "ok"}


# CIDR 網段封鎖：純紀錄／顯示用，不會被同步進 whitelist/blacklist-ips.txt 或觸發
# mail-ip-lists-sync.service（那條管線只認單一 IP，見 _write_sync_file/_sync_to_disk）。
# 實際生效的封鎖是管理員自己在伺服器上用 ufw 下的，這裡只是讓後台看得到、記錄誰在什麼
# 時候因為什麼理由封鎖了哪個網段，避免只留在 shell 歷史紀錄裡沒人看得到。
@router.post("/blocked-ranges", dependencies=[Depends(require_permission("ip_lists", "modify"))])
def add_blocked_range(req: CIDREntryCreate, admin: dict = Depends(verify_token)):
    _validate_cidr(req.cidr)
    data = _load()
    if any(e["cidr"] == req.cidr for e in data["blocked_ranges"]):
        raise HTTPException(status_code=400, detail={"code": "ip_already_listed"})
    data["blocked_ranges"].append({
        "cidr": req.cidr, "note": req.note, "added_by": admin["username"],
        "added_at": datetime.now(timezone.utc).isoformat(),
    })
    _save(data)
    return {"status": "ok"}


@router.delete("/blocked-ranges/{cidr:path}", dependencies=[Depends(require_permission("ip_lists", "modify"))])
def delete_blocked_range(cidr: str):
    data = _load()
    remaining = [e for e in data["blocked_ranges"] if e["cidr"] != cidr]
    if len(remaining) == len(data["blocked_ranges"]):
        raise HTTPException(status_code=404, detail={"code": "ip_not_found"})
    data["blocked_ranges"] = remaining
    _save(data)
    return {"status": "ok"}
