import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from api.auth import require_permission
from api.admin_store import ADMIN_LOGINS_LOG
from api.routers.security import _geo_lookup, _read_lines, _pick_country
from api.routers.webmail_logins import _parse_device, _parse_filter_dt, _record_region

router = APIRouter()


def _parse_admin_logins():
    records = []
    for line in _read_lines(ADMIN_LOGINS_LOG, max_lines=50000):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            dt = datetime.fromisoformat(entry["time"])
        except (json.JSONDecodeError, KeyError, ValueError):
            continue
        records.append({
            "time": dt,
            "user": entry.get("username", ""),
            "success": bool(entry.get("success")),
            "ip": entry.get("ip", "unknown"),
            **_parse_device(entry.get("user_agent", "")),
        })
    return records


def _record_country(record):
    geo = record.get("geo") or {}
    if geo.get("is_private"):
        return None
    picked = _pick_country(geo)
    return picked[0] if picked else None


@router.get("/", dependencies=[Depends(require_permission("admin_logins", "view"))])
def get_admin_logins(
    user: Optional[str] = Query(None),
    ip: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    region: Optional[str] = Query(None),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
):
    all_records = _parse_admin_logins()
    all_records.sort(key=lambda r: r["time"], reverse=True)

    ips = list({r["ip"] for r in all_records if r["ip"] and r["ip"] != "unknown"})
    geo = _geo_lookup(ips)
    for r in all_records:
        r["geo"] = geo.get(r["ip"], {})

    available_users = sorted({r["user"] for r in all_records if r["user"]})
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
        "filters": {"users": available_users, "countries": available_countries},
    }
