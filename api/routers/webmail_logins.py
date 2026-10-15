import os
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from api.auth import require_permission
from api.routers.security import _geo_lookup, _iter_all_lines, _pick_country

router = APIRouter()

USERLOGINS_LOG = os.environ.get("MAIL_ADMIN_ROUNDCUBE_LOGINS_LOG", "/var/log/roundcube/userlogins.log")
APACHE_VHOST_LOG = os.environ.get("MAIL_ADMIN_APACHE_ACCESS_LOG", "/var/log/apache2/other_vhosts_access.log")

# 例：[25-Jul-2026 02:02:33 +0000]: <b1ca7be0> Successful login for user@example.com (ID: 2) from 203.0.113.10 (X-Forwarded-For: 203.0.113.10) in session b1ca7be0325753ef
USERLOGIN_RE = re.compile(
    r"^\[(?P<time>[^\]]+)\]:\s+<(?P<session>\w+)>\s+"
    r"(?P<result>Successful login|Failed login) for (?P<user>\S+?)(?:\s+\(ID:\s*\d+\))?"
    r"\s+from\s+(?P<ip>[0-9a-fA-F:.]+)"
)

# 例：mail.example.com:443 203.0.113.10 - - [25/Jul/2026:02:02:23 +0000] "POST /roundcube/?_task=login HTTP/1.1" 401 3515 "..." "Mozilla/5.0 ..." "h=203.0.113.10"
APACHE_LOGIN_RE = re.compile(
    r'^\S+ (?P<ip>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] '
    r'"POST /roundcube/\?_task=login[^"]*" (?P<status>\d{3}) \S+ "[^"]*" "(?P<ua>[^"]*)"'
)

_MATCH_WINDOW_SECONDS = 10

_BROWSER_PATTERNS = [
    ("edge", re.compile(r"Edg(e|A|iOS)?/[\d.]+")),
    ("chrome", re.compile(r"Chrome/[\d.]+")),
    ("firefox", re.compile(r"Firefox/[\d.]+")),
    ("samsung_internet", re.compile(r"SamsungBrowser/[\d.]+")),
    ("safari", re.compile(r"Version/[\d.]+.*Safari/")),
]

_IOS_RE = re.compile(r"iPhone|iPad|iPod|CPU (iPhone )?OS \d")
_ANDROID_RE = re.compile(r"Android [\d.]+")
_MACOS_RE = re.compile(r"Mac OS X [\d_]+")
_WINDOWS_RE = re.compile(r"Windows NT [\d.]+")
_LINUX_RE = re.compile(r"Linux")


def _parse_device(ua: str):
    """輕量 regex 解析 User-Agent，不引入額外套件。回傳穩定的英文代碼（不是中文字串），
    前端自己用 i18n 字典翻成顯示文字。

    已知限制：iPadOS 13 之後，Safari 預設會把 UA 偽裝成桌面版 macOS Safari（不含 iPad/Mobile 字樣），
    跟真正的 Mac 桌機在 UA 字串層級完全無法分辨——這不是我們的 regex 寫得不夠好，是協定本身的限制，
    只有讓瀏覽器端用 JS 讀 navigator.maxTouchPoints 才能真正區分，但 Roundcube 的登入頁沒辦法加這段
    JS（除非另外寫 Roundcube plugin，超出目前範圍）。這裡選擇誠實回傳 macos_or_ipados／
    desktop_or_tablet 這種「無法確定」的代碼，而不是繼續自信地誤判成 macOS。
    """
    if not ua:
        return {"os": "unknown", "device_type": "unknown", "browser": "unknown", "raw": ua}

    browser = next((name for name, pat in _BROWSER_PATTERNS if pat.search(ua)), "unknown")

    if _IOS_RE.search(ua):
        os_name = "ios"
        device_type = "tablet" if "iPad" in ua else "phone"
    elif _ANDROID_RE.search(ua):
        os_name = "android"
        device_type = "phone" if "Mobile" in ua else "tablet"
    elif _MACOS_RE.search(ua):
        if browser == "safari":
            os_name = "macos_or_ipados"
            device_type = "desktop_or_tablet"
        else:
            os_name = "macos"
            device_type = "desktop"
    elif _WINDOWS_RE.search(ua):
        os_name = "windows"
        device_type = "desktop"
    elif _LINUX_RE.search(ua):
        os_name = "linux"
        device_type = "desktop"
    else:
        os_name = "unknown"
        device_type = "unknown"

    return {"os": os_name, "device_type": device_type, "browser": browser, "raw": ua}


def _parse_userlogins():
    """讀取全部歷史紀錄，含未來 logrotate 之後產生的輪替檔（目前只有一份未輪替的 base 檔）。"""
    records = []
    for line in _iter_all_lines(USERLOGINS_LOG):
        m = USERLOGIN_RE.match(line.strip())
        if not m:
            continue
        try:
            dt = datetime.strptime(m.group("time"), "%d-%b-%Y %H:%M:%S %z")
        except ValueError:
            continue
        records.append({
            "time": dt,
            "user": m.group("user"),
            "ip": m.group("ip"),
            "success": m.group("result") == "Successful login",
        })
    return records


def _parse_apache_logins():
    """回傳 (ip, dt) -> user_agent 的候選清單，用來跟 userlogins.log 的紀錄比對取得裝置資訊，
    因為 Roundcube 自己的登入 log 沒有記錄 User-Agent。掃描所有輪替過的 log（含 .gz）以涵蓋全部歷史。"""
    entries = []
    for line in _iter_all_lines(APACHE_VHOST_LOG):
        m = APACHE_LOGIN_RE.match(line)
        if not m:
            continue
        try:
            dt = datetime.strptime(m.group("time"), "%d/%b/%Y:%H:%M:%S %z")
        except ValueError:
            continue
        entries.append({
            "ip": m.group("ip"),
            "time": dt,
            "status": m.group("status"),
            "ua": m.group("ua"),
        })
    return entries


def _match_user_agent(login, apache_entries):
    """在同一個 IP、時間差在 _MATCH_WINDOW_SECONDS 秒內的 Apache 請求裡，找最接近的一筆當作這次登入的瀏覽器來源。"""
    expected_status = "302" if login["success"] else "401"
    best = None
    best_diff = None
    for e in apache_entries:
        if e["ip"] != login["ip"] or e["status"] != expected_status:
            continue
        diff = abs((e["time"] - login["time"]).total_seconds())
        if diff > _MATCH_WINDOW_SECONDS:
            continue
        if best_diff is None or diff < best_diff:
            best, best_diff = e, diff
    return best["ua"] if best else None


def _build_login_records():
    """回傳全部歷史登入紀錄（含 GeoIP/RDAP 位置資訊），由新到舊排序。不做筆數截斷，
    篩選交給 API 層的 query 參數處理。"""
    logins = _parse_userlogins()
    logins.sort(key=lambda r: r["time"], reverse=True)

    apache_entries = _parse_apache_logins()

    records = []
    for login in logins:
        ua = _match_user_agent(login, apache_entries)
        records.append({
            "time": login["time"],
            "user": login["user"],
            "ip": login["ip"],
            "success": login["success"],
            **_parse_device(ua),
        })

    ips = list({r["ip"] for r in records})
    geo = _geo_lookup(ips)
    for r in records:
        r["geo"] = geo.get(r["ip"], {})

    return records


def _parse_filter_dt(s: Optional[str]):
    """接受 'YYYY-MM-DDTHH'（年月日時，最粗的篩選粒度）到完整 ISO 8601 字串。
    沒有時區資訊時一律當作 UTC（跟這台伺服器 log 的時區一致）。"""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _record_country(record):
    geo = record.get("geo") or {}
    if geo.get("is_private"):
        return None
    picked = _pick_country(geo)
    return picked[0] if picked else None


def _record_region(record):
    geo = record.get("geo") or {}
    geoip = geo.get("geoip") or {}
    return " ".join(filter(None, [geoip.get("region"), geoip.get("city")]))


@router.get("/", dependencies=[Depends(require_permission("webmail_logins", "view"))])
def get_webmail_logins(
    user: Optional[str] = Query(None, description="依帳號篩選（不分大小寫、包含比對）"),
    ip: Optional[str] = Query(None, description="依 IP 篩選（包含比對，例如打 '203.0.113' 可以比對到整個網段）"),
    country: Optional[str] = Query(None, description="依國家代碼篩選（例如 JP、TW）"),
    region: Optional[str] = Query(None, description="依城市/地區篩選（不分大小寫、包含比對）"),
    start: Optional[str] = Query(None, description="起始時間，格式 YYYY-MM-DDTHH（年月日時），預設 UTC"),
    end: Optional[str] = Query(None, description="結束時間，格式同 start"),
):
    all_records = _build_login_records()

    # 篩選選單用：從全部（未篩選）歷史紀錄算出目前有哪些帳號/國家可以選
    available_users = sorted({r["user"] for r in all_records})
    country_names = {}
    for r in all_records:
        code = _record_country(r)
        if code:
            geoip = (r.get("geo") or {}).get("geoip") or {}
            country_names[code] = geoip.get("country", code)
    available_countries = [{"code": c, "name": n} for c, n in sorted(country_names.items())]

    start_dt = _parse_filter_dt(start)
    end_dt = _parse_filter_dt(end)

    records = all_records
    if user:
        needle = user.lower()
        records = [r for r in records if needle in r["user"].lower()]
    if ip:
        records = [r for r in records if ip in r["ip"]]
    if country:
        records = [r for r in records if _record_country(r) == country.upper()]
    if region:
        needle = region.lower()
        records = [r for r in records if needle in _record_region(r).lower()]
    if start_dt:
        records = [r for r in records if r["time"] >= start_dt]
    if end_dt:
        records = [r for r in records if r["time"] <= end_dt]

    logins = [{**r, "time": r["time"].isoformat()} for r in records]

    return {
        "logins": logins,
        "total_alltime": len(all_records),
        "total_filtered": len(logins),
        "filters": {
            "users": available_users,
            "countries": available_countries,
        },
    }
