import asyncio
import logging
import os

from fastapi import FastAPI
from api.routers import (
    users, domains, aliases, logs, services, stats, settings, security, webmail_logins,
    admins, ip_lists, admin_logins, system_updates, notifications,
)
from api import auth, webauthn
from api.admin_store import ensure_admins_file

ensure_admins_file()

def _read_version():
    try:
        with open(os.path.join(os.path.dirname(__file__), "..", "VERSION")) as f:
            return f.read().strip()
    except OSError:
        return "unknown"


VERSION = _read_version()
app = FastAPI(title="NannanCat Mail Admin API", version=VERSION)

AUTO_BLACKLIST_INTERVAL_SECONDS = 300  # 每 5 分鐘檢查一次攻擊次數過頻的 IP，不需要有人打開後台頁面才會觸發
HEALTH_NOTIFICATION_INTERVAL_SECONDS = 300  # 每 5 分鐘檢查一次系統健康狀態，寫進通知中心


# 背景檢查都是同步函式（讀 log、跑 apt/systemctl），直接在 async 迴圈裡呼叫會卡住整個事件迴圈，
# 檢查期間所有 API 請求都得等；用 asyncio.to_thread 丟到背景執行緒，後台操作不受影響。
async def _auto_blacklist_loop():
    while True:
        try:
            await asyncio.to_thread(ip_lists._check_auto_blacklist)
        except Exception:
            logging.exception("auto blacklist background check failed")
        await asyncio.sleep(AUTO_BLACKLIST_INTERVAL_SECONDS)


async def _health_notification_loop():
    while True:
        try:
            await asyncio.to_thread(system_updates.check_and_notify_health)
        except Exception:
            logging.exception("system update health notification check failed")
        try:
            await asyncio.to_thread(services.check_and_notify_health)
        except Exception:
            logging.exception("service health notification check failed")
        await asyncio.sleep(HEALTH_NOTIFICATION_INTERVAL_SECONDS)


@app.on_event("startup")
async def _start_background_tasks():
    asyncio.create_task(_auto_blacklist_loop())
    asyncio.create_task(_health_notification_loop())

# 前端跟後端一律同源（正式環境靠 Apache Alias，開發環境靠 vite.config.js 的 /api proxy），
# 從來沒有真的需要跨源請求，CORSMiddleware 原本開 allow_origins=["*"] + allow_credentials=True
# 是不必要的攻擊面，移除。

app.include_router(auth.router, prefix="/api")
app.include_router(webauthn.router, prefix="/api")
app.include_router(users.router, prefix="/api/users")
app.include_router(domains.router, prefix="/api/domains")
app.include_router(aliases.router, prefix="/api/aliases")
app.include_router(logs.router, prefix="/api/logs")
app.include_router(services.router, prefix="/api/services")
app.include_router(stats.router, prefix="/api/stats")
app.include_router(settings.router, prefix="/api/settings")
app.include_router(security.router, prefix="/api/security")
app.include_router(webmail_logins.router, prefix="/api/webmail-logins")
app.include_router(admins.router, prefix="/api/admins")
app.include_router(ip_lists.router, prefix="/api/ip-lists")
app.include_router(admin_logins.router, prefix="/api/admin-logins")
app.include_router(system_updates.router, prefix="/api/system-updates")
app.include_router(notifications.router, prefix="/api/notifications")

@app.get("/api/health")
def health():
    return {"status": "ok", "version": VERSION}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
