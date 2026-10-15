from fastapi import APIRouter, Depends
from api.auth import require_permission
from api.routers.logs import mail_log_counts

router = APIRouter()

@router.get("/", dependencies=[Depends(require_permission("stats", "view"))])
def get_stats():
    return mail_log_counts()
