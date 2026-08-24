import ipaddress
import json
import os
import subprocess
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import require_permission, verify_token
from api.config import IP_LISTS_FILE, IP_WHITELIST_SYNC_FILE, IP_BLACKLIST_SYNC_FILE
from api.routers.security import _parse_fail2ban, _geo_lookup, _ban_count_per_ip, _is_private
from api.routers.notifications import add_notification

router = APIRouter()

# 攻擊次數太頻繁的判斷門檻：歷史上被 fail2ban 真正 Ban 過 3 次（含）以上，
# 視為「反覆重犯」，自動加入永久黑名單（fail2ban 的封鎖是有時效的，時間到就解封，
# 永久黑名單則是持續生效，靠 fix-ip-lists.sh 安裝的 systemd path unit 同步進 UFW）。
AUTO_BLACKLIST_THRESHOLD = 3


def _validate_ip(ip: str):
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "invalid_ip_format"})


def _load():
    if os.path.exists(IP_LISTS_FILE):
        try:
            with open(IP_LISTS_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"whitelist": [], "blacklist": []}


def _save(data):
    os.makedirs(os.path.dirname(IP_LISTS_FILE), exist_ok=True)
    with open(IP_LISTS_FILE, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    _sync_to_disk(data)


def _write_sync_file(path: str, ips: list):
    """把目前的 IP 清單寫到一個 root 擁有目錄下的純文字檔（一行一個 IP），
    運行後端服務的系統帳號對 tee 有 NOPASSWD，可以直接寫，不需要互動密碼。
    真正套用到防火牆/fail2ban 的動作交給另一個 root 自己的 systemd path unit 做（見 fix-ip-lists.sh），
    這裡完全不需要、也不會嘗試展開這個系統帳號的 sudo 權限範圍。"""
    content = "\n".join(ips) + ("\n" if ips else "")
    try:
        subprocess.run(["sudo", "mkdir", "-p", os.path.dirname(path)], capture_output=True, timeout=5)
        subprocess.run(["sudo", "tee", path], input=content, capture_output=True, text=True, timeout=5)
    except subprocess.TimeoutExpired:
        pass


def _sync_to_disk(data):
    _write_sync_file(IP_WHITELIST_SYNC_FILE, [e["ip"] for e in data["whitelist"]])
    _write_sync_file(IP_BLACKLIST_SYNC_FILE, [e["ip"] for e in data["blacklist"]])
    # 如果 fix-ip-lists.sh 已經裝好對應的 systemd path unit，這裡觸發立即套用；
    # 還沒裝的話這行單純失敗（unit not found），不影響資料本身已經存好。
    try:
        subprocess.run(["sudo", "systemctl", "start", "mail-ip-lists-sync.service"], capture_output=True, timeout=5)
    except subprocess.TimeoutExpired:
        pass


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


class IPEntryCreate(BaseModel):
    ip: str
    note: str = ""


@router.get("/", dependencies=[Depends(require_permission("ip_lists", "view"))])
def get_ip_lists():
    data = _check_auto_blacklist()
    banned, _events = _parse_fail2ban()

    all_ips = {e["ip"] for e in data["whitelist"]} | {e["ip"] for e in data["blacklist"]} | {b["ip"] for b in banned}
    geo = _geo_lookup(list(all_ips))
    for e in data["whitelist"]:
        e["geo"] = geo.get(e["ip"], {})
    for e in data["blacklist"]:
        e["geo"] = geo.get(e["ip"], {})
    for b in banned:
        b["geo"] = geo.get(b["ip"], {})

    return {
        "whitelist": data["whitelist"],
        "blacklist": data["blacklist"],
        "fail2ban_banned": banned,
    }


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
