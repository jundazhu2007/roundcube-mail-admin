import json
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from api.auth import verify_token
from api.config import NOTIFICATIONS_FILE

router = APIRouter()

MAX_NOTIFICATIONS = 300  # 超過就砍掉最舊的，避免檔案無限長大

# 每種通知類型的預設嚴重程度，前端用來決定圖示顏色跟篩選分類，沒列在這裡的一律當作 info。
SEVERITY_BY_TYPE = {
    "auto_blacklist": "warning",
    "reboot_required": "warning",
    "apt_security_updates": "warning",
    "roundcube_security_update": "danger",
    "clamav_infected": "danger",
    "rkhunter_warning": "warning",
    "service_down": "danger",
}


def _load():
    if os.path.exists(NOTIFICATIONS_FILE):
        try:
            with open(NOTIFICATIONS_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return []


def _save(items):
    os.makedirs(os.path.dirname(NOTIFICATIONS_FILE), exist_ok=True)
    items = items[-MAX_NOTIFICATIONS:]
    with open(NOTIFICATIONS_FILE, "w") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)


def add_notification(type_: str, dedup_key: str | None = None, **extra):
    """給其他模組呼叫，寫入一筆通知。"""
    items = _load()
    items.append({
        "id": uuid.uuid4().hex[:12],
        "type": type_,
        "dedup_key": dedup_key,
        "severity": SEVERITY_BY_TYPE.get(type_, "info"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "read": False,
        **extra,
    })
    _save(items)


def add_notification_once(type_: str, dedup_key: str, **extra):
    """跟 add_notification 一樣會寫入一筆通知，但如果同一種 type + dedup_key 已經有一筆
    「未讀」的通知存在，就不會重複新增。用在背景排程定期檢查系統健康狀態的情境（見
    main.py 的 _health_notification_loop），避免同一個問題每次檢查都洗一筆新通知出來——
    只要使用者還沒標記已讀，就代表這件事還沒被看到，不需要再提醒一次；已讀之後如果問題
    依然存在，下次檢查會再開一筆新的，代表「已讀不等於已解決」，不會被永久靜音。"""
    items = _load()
    for n in items:
        if n.get("type") == type_ and n.get("dedup_key") == dedup_key and not n.get("read"):
            return
    add_notification(type_, dedup_key, **extra)


@router.get("/", dependencies=[Depends(verify_token)])
def list_notifications(
    unread_only: bool = False,
    type: str | None = Query(None),
    severity: str | None = Query(None),
):
    items = _load()
    items.sort(key=lambda n: n["created_at"], reverse=True)
    unread_count = sum(1 for n in items if not n.get("read"))

    filtered = items
    if unread_only:
        filtered = [n for n in filtered if not n.get("read")]
    if type:
        filtered = [n for n in filtered if n.get("type") == type]
    if severity:
        filtered = [n for n in filtered if n.get("severity", "info") == severity]

    return {
        "items": filtered,
        "unread_count": unread_count,
        "total_count": len(items),
    }


@router.post("/{notif_id}/read", dependencies=[Depends(verify_token)])
def mark_read(notif_id: str):
    items = _load()
    for n in items:
        if n["id"] == notif_id:
            n["read"] = True
    _save(items)
    return {"status": "ok"}


@router.post("/read-all", dependencies=[Depends(verify_token)])
def mark_all_read():
    items = _load()
    for n in items:
        n["read"] = True
    _save(items)
    return {"status": "ok"}


@router.delete("/clear-read", dependencies=[Depends(verify_token)])
def clear_read():
    """只清掉已讀的通知，未讀的保留，避免手滑清掉還沒看過的重要通知。"""
    items = _load()
    items = [n for n in items if not n.get("read")]
    _save(items)
    return {"status": "ok"}


@router.delete("/{notif_id}", dependencies=[Depends(verify_token)])
def dismiss_notification(notif_id: str):
    items = _load()
    items = [n for n in items if n["id"] != notif_id]
    _save(items)
    return {"status": "ok"}
