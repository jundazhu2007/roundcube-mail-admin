from collections import deque
from fastapi import APIRouter, Depends, Query
from api.auth import require_permission
from api.config import MAIL_LOG

router = APIRouter()

# 後台執行身分（systemd 服務帳號）在 adm 群組，/var/log/mail.log 是 syslog:adm 640，可以直接讀，不需要 sudo。
# 原本每個關鍵字各開一次 `sudo grep -c`（四個 sudo 行程、整份 log 掃四遍，而且每次都在 auth.log 留一筆 sudo 紀錄），
# 改成讀一遍同時計數，結果與 grep -c 相同（含該字串的行數）。
COUNT_PATTERNS = {"sent": "status=sent", "blocked": "BLOCKED", "virus": "INFECTED", "spam": "Spam"}


def mail_log_counts():
    counts = dict.fromkeys(COUNT_PATTERNS, 0)
    try:
        with open(MAIL_LOG, errors="ignore") as f:
            for line in f:
                for key, needle in COUNT_PATTERNS.items():
                    if needle in line:
                        counts[key] += 1
    except OSError:
        pass
    return counts


def _tail(path, n):
    try:
        with open(path, errors="ignore") as f:
            return [line.rstrip("\n") for line in deque(f, maxlen=n)]
    except OSError:
        return []


@router.get("/", dependencies=[Depends(require_permission("logs", "view"))])
def get_logs(limit: int = Query(100, le=500), filter: str = Query("")):
    parsed = []
    for line in reversed(_tail(MAIL_LOG, limit)):
        if filter and filter.lower() not in line.lower():
            continue
        log_type = "info"
        if "BLOCKED" in line or "reject" in line.lower():
            log_type = "blocked"
        elif "INFECTED" in line or "virus" in line.lower():
            log_type = "virus"
        elif "error" in line.lower():
            log_type = "error"
        elif "sent" in line.lower() or "delivered" in line.lower():
            log_type = "sent"
        parsed.append({"raw": line, "type": log_type})
    return parsed

@router.get("/stats", dependencies=[Depends(require_permission("logs", "view"))])
def log_stats():
    c = mail_log_counts()
    return {
        "total_sent": c["sent"],
        "total_blocked": c["blocked"],
        "total_virus": c["virus"],
        "total_spam": c["spam"],
    }
