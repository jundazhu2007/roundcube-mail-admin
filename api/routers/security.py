import glob
import gzip
import ipaddress
import json
import os
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends
from api.auth import require_permission

router = APIRouter()

FAIL2BAN_LOG = "/var/log/fail2ban.log"
MAIL_LOG = "/var/log/mail.log"
AUTH_LOG = "/var/log/auth.log"
GEOIP_CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "geoip_cache.json")
GEOIP_TTL = 3600  # 只快取 1 小時，強調資料即時性，避免每次都重打外部 API 但也不會放太久
SECURITY_TOTALS_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "security_totals.json")

BAN_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ fail2ban\.actions\s+\[\d+\]:\s+NOTICE\s+"
    r"\[([\w-]+)\]\s+(Ban|Unban|Restore Ban|Increase Ban)\s+([0-9a-fA-F:.]+)"
)


def _read_lines(path, max_lines=20000):
    try:
        with open(path, errors="ignore") as f:
            return f.readlines()[-max_lines:]
    except FileNotFoundError:
        return []


def _rotated_files(base_path, max_generations=12):
    """回傳 base_path 所有輪替過的 log 檔（含 .gz 壓縮），由舊到新排序。
    這樣可以統計超過目前這份 log 範圍的歷史資料（依 logrotate 保留期間而定，這台大約 1 個月）。"""
    files = [base_path]
    for n in range(1, max_generations):
        for pattern in (f"{base_path}.{n}", f"{base_path}.{n}.gz"):
            if os.path.exists(pattern):
                files.append(pattern)
                break
    files.reverse()  # 最舊的在前面
    return files


def _iter_all_lines(base_path):
    for path in _rotated_files(base_path):
        try:
            if path.endswith(".gz"):
                with gzip.open(path, "rt", errors="ignore") as f:
                    yield from f
            else:
                with open(path, errors="ignore") as f:
                    yield from f
        except FileNotFoundError:
            continue


def _parse_fail2ban():
    """只看目前這份（未輪替）的 log，足夠算出目前封鎖狀態跟最近事件，效能較好。"""
    state = {}
    events = []
    for line in _read_lines(FAIL2BAN_LOG):
        m = BAN_RE.match(line)
        if not m:
            continue
        ts, jail, action, ip = m.groups()
        is_ban = action in ("Ban", "Restore Ban", "Increase Ban")
        state[(jail, ip)] = {"status": "banned" if is_ban else "unbanned", "since": ts}
        events.append({"time": ts, "jail": jail, "ip": ip, "action": action})

    banned = [
        {"jail": j, "ip": ip, "since": v["since"]}
        for (j, ip), v in state.items() if v["status"] == "banned"
    ]
    banned.sort(key=lambda x: x["since"], reverse=True)
    events.reverse()
    return banned, events[:40]


def _count_today(path, needle):
    today = date.today().isoformat()
    count = 0
    for line in _read_lines(path):
        if line[:10] == today and needle in line:
            count += 1
    return count


def _historical_ban_stats():
    """掃描所有輪替過的 fail2ban log（含壓縮檔），算出全部記錄範圍內的總封鎖次數，
    以及依日期分組的封鎖次數（用來畫時間序列圖）。範圍受 logrotate 保留期間限制（這台大約 1 個月）。"""
    daily = defaultdict(int)
    total = 0
    earliest = None
    for line in _iter_all_lines(FAIL2BAN_LOG):
        m = BAN_RE.match(line)
        if not m:
            continue
        ts, jail, action, ip = m.groups()
        if action not in ("Ban",):  # 只算真正新發生的 Ban，不算 Restore/Increase 避免重複膨脹
            continue
        day = ts[:10]
        daily[day] += 1
        total += 1
        if earliest is None or day < earliest:
            earliest = day
    return total, dict(sorted(daily.items())), earliest


def _ban_count_per_ip():
    """統計每個 IP 歷史上總共被 fail2ban 真正 Ban 過幾次（不含 Restore/Increase Ban，避免重複膨脹），
    給自動永久黑名單機制判斷「攻擊次數太頻繁」用（見 ip_lists.py 的 _check_auto_blacklist()）。"""
    counts = defaultdict(int)
    for line in _iter_all_lines(FAIL2BAN_LOG):
        m = BAN_RE.match(line)
        if m and m.group(3) == "Ban":
            counts[m.group(4)] += 1
    return dict(counts)


def _historical_unique_ips():
    """掃描所有輪替過的 fail2ban log，收集歷史上出現過的不重複攻擊 IP（只是文字比對，不查外部 API，很快）。"""
    ips = set()
    for line in _iter_all_lines(FAIL2BAN_LOG):
        m = BAN_RE.match(line)
        if m:
            ips.add(m.group(4))
    return ips


def _historical_attack_stats():
    """掃描所有輪替過的 mail.log / auth.log，算出全部記錄範圍內的認證失敗總次數與每日分佈。"""
    daily = defaultdict(int)
    total = 0
    for line in _iter_all_lines(MAIL_LOG):
        if "SASL LOGIN authentication failed" in line:
            day = line[:10]
            daily[day] += 1
            total += 1
    for line in _iter_all_lines(AUTH_LOG):
        if "Failed password" in line or "Invalid user" in line:
            day = line[:10]
            daily[day] += 1
            total += 1
    return total, dict(sorted(daily.items()))


def _load_security_totals():
    if os.path.exists(SECURITY_TOTALS_FILE):
        try:
            with open(SECURITY_TOTALS_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"attack_days": {}, "ban_days": {}}


def _save_security_totals(totals):
    os.makedirs(os.path.dirname(SECURITY_TOTALS_FILE), exist_ok=True)
    with open(SECURITY_TOTALS_FILE, "w") as f:
        json.dump(totals, f)


def _persistent_alltime_totals(attack_daily, ban_daily):
    """`total_attacks_alltime`/`total_bans_alltime` 是即時掃描目前還留著的 log 算出來的，
    受 logrotate 保留期間限制（這台大約 1 個月），舊 log 被清掉後那些天數就從「歷史總數」
    裡消失了，並不是真正「這台伺服器上線以來全部總計」。這裡另外維護一份不受 logrotate
    影響的持久化累計檔：每天的次數一旦被看過就記錄進 JSON 檔，就算該天的原始 log 之後被
    清掉，記錄的數字還是留著不會消失，真正做到「只增不減」的全部總計。
    第一次啟用時會把當下 log 還看得到的完整期間（約 1 個月）都拿來當起始基礎值，
    再更早、log 已經被清掉的攻擊次數本來就已經不存在，沒辦法回溯補上。"""
    totals = _load_security_totals()
    changed = False
    for day, count in attack_daily.items():
        if totals["attack_days"].get(day) != count:
            totals["attack_days"][day] = count
            changed = True
    for day, count in ban_daily.items():
        if totals["ban_days"].get(day) != count:
            totals["ban_days"][day] = count
            changed = True
    if changed:
        _save_security_totals(totals)

    tracking_started = min(
        [*totals["attack_days"].keys(), *totals["ban_days"].keys()], default=None
    )
    return sum(totals["attack_days"].values()), sum(totals["ban_days"].values()), tracking_started


def _is_private(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip).is_private
    except ValueError:
        return True


def _load_geo_cache():
    if os.path.exists(GEOIP_CACHE_FILE):
        try:
            with open(GEOIP_CACHE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_geo_cache(cache):
    os.makedirs(os.path.dirname(GEOIP_CACHE_FILE), exist_ok=True)
    with open(GEOIP_CACHE_FILE, "w") as f:
        json.dump(cache, f)


def _rdap_lookup(ip: str):
    """直接即時查詢權威區域網路註冊機構(RIPE/ARIN/APNIC/LACNIC/AFRINIC)的 RDAP 紀錄，
    這是網段實際登記的擁有者資訊，而不是猜測。"""
    try:
        req = urllib.request.Request(
            f"https://rdap.org/ip/{ip}", headers={"Accept": "application/rdap+json"}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            registry_url = resp.geturl()
    except Exception:
        return None

    registry = "unknown"
    for key, name in (("ripe", "RIPE"), ("arin", "ARIN"), ("apnic", "APNIC"), ("lacnic", "LACNIC"), ("afrinic", "AFRINIC")):
        if key in registry_url:
            registry = name
            break

    org = None
    for entity in data.get("entities", []):
        if "registrant" in entity.get("roles", []):
            handle = entity.get("handle", "")
            if "RIPE-NCC" in handle or "MNT" in handle:
                continue
            for item in entity.get("vcardArray", [None, []])[1]:
                if item[0] == "fn" and item[3]:
                    org = item[3]
                    break
            if org:
                break

    return {
        "registry": registry,
        "netname": data.get("name", "unknown"),
        "registrant_org": org or data.get("name", "unknown"),
        "registered_country": data.get("country") or "unknown",
    }


def _geo_lookup(ips):
    """對每個 IP 同時保留兩種獨立來源，不合併成單一結論：
    - rdap: 即時查詢區域網路註冊機構的官方登記資料（權威，但反映的是「登記地」不一定是實際發送地）
    - geoip: 商用 IP 定位服務的推測資料（ip-api.com，反映的是「推測實際位置」，僅供參考）
    兩者常常不一致（尤其是 VPS/雲端主機），刻意都顯示出來讓你自己判斷，而不是只給一個看起來很篤定但其實是猜的答案。
    """
    result = {}
    cache = _load_geo_cache()
    now = time.time()
    to_query = []

    for ip in ips:
        if _is_private(ip):
            result[ip] = {"is_private": True, "rdap": None, "geoip": None, "queried_at": None}
            continue
        cached = cache.get(ip)
        if cached and now - cached.get("_cached_at", 0) < GEOIP_TTL:
            result[ip] = cached["data"]
        else:
            to_query.append(ip)

    if to_query:
        geoip_rows = {}
        try:
            body = json.dumps(to_query[:100]).encode()
            req = urllib.request.Request(
                "http://ip-api.com/batch?fields=status,country,countryCode,regionName,isp,city,as,query",
                data=body, headers={"Content-Type": "application/json"}, method="POST",
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                for row in json.loads(resp.read().decode()):
                    geoip_rows[row.get("query")] = row
        except Exception:
            pass

        # RDAP 查詢是逐一發出的即時網路請求（不像上面的 GeoIP 是一次批次呼叫），
        # 如果用簡單 for 迴圈依序查詢，N 個沒快取的 IP 就要等 N 次網路來回時間加總，
        # 快取 TTL 只有 1 小時，IP 清單/登入紀錄放置幾天沒開，重新整理時很容易一次要查 8~10 個 IP，
        # 疊加起來可以到 5 秒以上（這是資安中心/登入紀錄頁面明顯變慢的根本原因）。
        # 改用執行緒池平行查，總耗時趨近「最慢那一個 IP」而不是「全部 IP 時間相加」。
        with ThreadPoolExecutor(max_workers=min(10, len(to_query))) as pool:
            rdap_results = dict(zip(to_query, pool.map(_rdap_lookup, to_query)))

        for ip in to_query:
            row = geoip_rows.get(ip)
            geoip_data = None
            if row and row.get("status") == "success":
                geoip_data = {
                    "country": row.get("country", "unknown"),
                    "country_code": row.get("countryCode", ""),
                    "isp": row.get("isp", "unknown"),
                    "city": row.get("city", ""),
                    "region": row.get("regionName", ""),
                    "as": row.get("as", ""),
                }
            rdap_data = rdap_results.get(ip)
            data = {
                "is_private": False,
                "rdap": rdap_data,
                "geoip": geoip_data,
                "queried_at": datetime.now(timezone.utc).isoformat(),
            }
            result[ip] = data
            cache[ip] = {"data": data, "_cached_at": now}
        _save_geo_cache(cache)

    return result


def _pick_country(geo_entry):
    """跟前端 pickPrimary 邏輯一致：優先採 GeoIP 推測的國家，查無資料才退回 RDAP 登記國家。"""
    if not geo_entry or geo_entry.get("is_private"):
        return None
    geoip = geo_entry.get("geoip")
    if geoip and geoip.get("country_code"):
        return geoip["country_code"], geoip["country"]
    rdap = geo_entry.get("rdap")
    if rdap and rdap.get("registered_country") not in (None, "unknown"):
        code = rdap["registered_country"]
        return code, code
    return None


def _country_distribution(live_geo: dict):
    """統計攻擊來源的國家分布。即時查詢過的 IP（live_geo）直接採用；
    歷史上出現過但這次沒有即時查詢的 IP，只用「已經快取過」的資料（不額外發外部請求，避免拖慢回應），
    所以這張分布圖會隨著資安中心被開啟的次數愈來愈完整，但不會讓單次載入變慢。"""
    cache = _load_geo_cache()
    counts = defaultdict(int)
    names = {}

    def add(ip, entry):
        picked = _pick_country(entry)
        if picked:
            code, name = picked
            counts[code] += 1
            names[code] = name

    seen = set()
    for ip, entry in live_geo.items():
        add(ip, entry)
        seen.add(ip)

    for ip in _historical_unique_ips():
        if ip in seen:
            continue
        cached = cache.get(ip)
        if cached:
            add(ip, cached.get("data", {}))

    result = [{"country_code": code, "country": names[code], "count": c} for code, c in counts.items()]
    result.sort(key=lambda x: x["count"], reverse=True)
    return result


@router.get("/", dependencies=[Depends(require_permission("security", "view"))])
def get_security():
    banned, events = _parse_fail2ban()
    by_jail = {}
    for b in banned:
        by_jail[b["jail"]] = by_jail.get(b["jail"], 0) + 1

    bans_today = sum(1 for e in events if e["time"][:10] == date.today().isoformat() and e["action"] in ("Ban", "Restore Ban", "Increase Ban"))

    all_ips = list({b["ip"] for b in banned} | {e["ip"] for e in events})
    geo = _geo_lookup(all_ips)

    for b in banned:
        b["geo"] = geo.get(b["ip"], {})
    for e in events:
        e["geo"] = geo.get(e["ip"], {})

    country_distribution = _country_distribution(geo)

    total_bans_alltime, daily_bans, earliest_day = _historical_ban_stats()
    total_attacks_alltime, daily_attacks = _historical_attack_stats()
    attacks_since_tracking, bans_since_tracking, tracking_started_at = _persistent_alltime_totals(daily_attacks, daily_bans)

    all_days = sorted(set(daily_bans) | set(daily_attacks))
    daily_series = [
        {"date": d, "bans": daily_bans.get(d, 0), "attacks": daily_attacks.get(d, 0)}
        for d in all_days
    ]

    return {
        "currently_banned": banned,
        "recent_events": events,
        "banned_by_jail": by_jail,
        "bans_today": bans_today,
        "total_banned": len(banned),
        "sasl_failures_today": _count_today(MAIL_LOG, "SASL LOGIN authentication failed"),
        "ssh_failures_today": _count_today(AUTH_LOG, "Failed password") + _count_today(AUTH_LOG, "Invalid user"),
        "total_bans_alltime": total_bans_alltime,
        "total_attacks_alltime": total_attacks_alltime,
        "attacks_since_tracking": attacks_since_tracking,
        "bans_since_tracking": bans_since_tracking,
        "tracking_started_at": tracking_started_at,
        "unique_attacker_ips_alltime": len(_historical_unique_ips()),
        "history_since": earliest_day,
        "daily_series": daily_series,
        "country_distribution": country_distribution,
    }
