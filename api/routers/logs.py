from fastapi import APIRouter, Depends, Query
from api.auth import require_permission
import subprocess, re

router = APIRouter()

@router.get("/", dependencies=[Depends(require_permission("logs", "view"))])
def get_logs(limit: int = Query(100, le=500), filter: str = Query("")):
    result = subprocess.run(
        f"sudo tail -n {limit} /var/log/mail.log",
        shell=True, capture_output=True, text=True
    )
    lines = result.stdout.strip().split("\n")
    parsed = []
    for line in reversed(lines):
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
    def count(pattern):
        r = subprocess.run(f"sudo grep -c '{pattern}' /var/log/mail.log 2>/dev/null || echo 0",
                          shell=True, capture_output=True, text=True)
        try:
            return int(r.stdout.strip())
        except:
            return 0
    return {
        "total_sent": count("status=sent"),
        "total_blocked": count("BLOCKED"),
        "total_virus": count("INFECTED"),
        "total_spam": count("Spam"),
    }
