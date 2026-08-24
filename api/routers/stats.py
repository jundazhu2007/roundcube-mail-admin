from fastapi import APIRouter, Depends
from api.auth import require_permission
import subprocess

router = APIRouter()

@router.get("/", dependencies=[Depends(require_permission("stats", "view"))])
def get_stats():
    def count(pattern):
        r = subprocess.run(f"sudo grep -c '{pattern}' /var/log/mail.log 2>/dev/null || echo 0",
                          shell=True, capture_output=True, text=True)
        try:
            return int(r.stdout.strip())
        except:
            return 0
    return {
        "sent": count("status=sent"),
        "blocked": count("BLOCKED"),
        "virus": count("INFECTED"),
        "spam": count("Spam"),
    }
