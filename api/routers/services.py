from fastapi import APIRouter, Depends
from api import privileged
from api.auth import require_permission, require_super_admin
from api.config import MAILDATA_PATH, MAILDATA_MOUNT
from api.routers.notifications import add_notification_once
import ipaddress
import math
import os
import re
import subprocess
import time

router = APIRouter()

SERVICES = [s.strip() for s in os.environ.get(
    "MAIL_ADMIN_MANAGED_SERVICES",
    "postfix,dovecot,amavis,clamav-daemon,opendkim,apache2,fail2ban,mariadb",
).split(",") if s.strip()]


def _default_iface():
    """預設路由所在的網卡（讀 /proc/net/route），找不到才退回 eth0。可用 MAIL_ADMIN_NETWORK_IFACE 覆寫。"""
    try:
        with open("/proc/net/route") as f:
            next(f)
            for line in f:
                parts = line.split()
                if len(parts) > 3 and parts[1] == "00000000" and int(parts[3], 16) & 2:
                    return parts[0]
    except (OSError, ValueError, StopIteration):
        pass
    return "eth0"


NETWORK_IFACE = os.environ.get("MAIL_ADMIN_NETWORK_IFACE") or _default_iface()
# 留空 = 加總所有實體磁碟（sd*/vd*/xvd*/nvme*n*/mmcblk*）；指定單一裝置名稱則只看那一顆
DISK_DEVICE = os.environ.get("MAIL_ADMIN_DISK_DEVICE", "")
_WHOLE_DISK_RE = re.compile(r"^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$")
SECTOR_SIZE = 512
# 用來把連線標成「內網 / 外網」的網段（逗號分隔 CIDR），預設為 RFC1918 私有網段；只影響即時動態頁的標示，不是安全邊界
INTERNAL_NETWORKS = [
    ipaddress.ip_network(n.strip(), strict=False)
    for n in (os.environ.get("MAIL_ADMIN_INTERNAL_NETWORKS")
              or os.environ.get("MAIL_ADMIN_INTERNAL_NETWORK")
              or "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16").split(",")
    if n.strip()
]

def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return r.stdout.strip()


def _unit_states(units):
    """一次 `systemctl show` 查完全部服務（原本每個服務各跑 is-active、show 兩次，9 個服務 18 個子程序）。
    systemctl show 依參數順序輸出、每個 unit 一段，段落之間空一行；ActiveState 就是 is-active 印出的值。"""
    out = subprocess.run(
        ["systemctl", "show", *units, "--property=ActiveState,ActiveEnterTimestamp"],
        capture_output=True, text=True,
    ).stdout
    blocks = out.strip().split("\n\n")
    states = {}
    for unit, block in zip(units, blocks):
        props = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        states[unit] = {"status": props.get("ActiveState", "unknown"), "uptime": props.get("ActiveEnterTimestamp", "")}
    return states


@router.get("/", dependencies=[Depends(require_permission("services", "view"))])
def get_services():
    states = _unit_states(SERVICES)
    return [{"name": svc, **states.get(svc, {"status": "unknown", "uptime": ""})} for svc in SERVICES]

def check_and_notify_health():
    """由 main.py 的背景排程週期性呼叫：任何一個核心服務不是 active 狀態就發通知，
    不需要有人打開後台頁面才會發現服務掛了。同一個服務在被標記已讀之前不會重複通知，
    見 notifications.py 的 add_notification_once 說明。"""
    for svc, st in _unit_states(SERVICES).items():
        if st["status"] != "active":
            add_notification_once("service_down", svc, service=svc, status=st["status"])


@router.post("/restart/{service}", dependencies=[Depends(require_permission("services", "modify"))])
def restart_service(service: str):
    if service not in SERVICES:
        return {"error": {"code": "service_not_allowed"}}
    privileged.systemctl("restart", service)
    return {"status": "ok", "service": service}

def _meminfo_mb():
    """回傳 (已用, 總量) MB，與 `free -m` 的 used/total 相同定義（used = MemTotal - MemAvailable）。"""
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            key, _, rest = line.partition(":")
            info[key] = int(rest.split()[0])  # kB
    total = info["MemTotal"]
    return (total - info["MemAvailable"]) // 1024, total // 1024


def _human_size(n):
    """模仿 `df -h`：1024 進位、無條件進位，小於 10 時保留一位小數。"""
    for unit in ("", "K", "M", "G", "T", "P"):
        if n < 1024 or unit == "P":
            break
        n /= 1024
    if unit and n < 10:
        return f"{math.ceil(n * 10) / 10:.1f}{unit}"
    return f"{math.ceil(n)}{unit}"


def _df_h(path):
    """等同 `df -h <path>` 的「已用/總量 (使用率)」，用 statvfs 直接取得，不開子程序。"""
    st = os.statvfs(path)
    size = st.f_blocks * st.f_frsize
    used = (st.f_blocks - st.f_bfree) * st.f_frsize
    avail = st.f_bavail * st.f_frsize
    pct = math.ceil(used * 100 / (used + avail)) if used + avail else 0
    return f"{_human_size(used)}/{_human_size(size)} ({pct}%)"


@router.get("/system", dependencies=[Depends(require_permission("services", "view"))])
def system_info():
    cpu = run("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'")
    used, total = _meminfo_mb()
    # 郵件儲存若是獨立掛載（NFS/NAS/另一顆碟）就檢查掛載點；本機碟則只確認目錄存在
    storage_ok = os.path.ismount(MAILDATA_MOUNT) if MAILDATA_MOUNT else os.path.isdir(MAILDATA_PATH)
    nfs_mounted = storage_ok
    return {
        "cpu": cpu,
        "memory": f"{used}/{total}",
        "disk_root": _df_h("/"),
        "disk_nas": _df_h(MAILDATA_MOUNT or MAILDATA_PATH) if nfs_mounted else "N/A",
        "nfs": "mounted" if nfs_mounted else "unmounted",
    }


def _read_iface_counter(name: str):
    try:
        with open(f"/sys/class/net/{NETWORK_IFACE}/statistics/{name}") as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


def _read_disk_io():
    """/proc/diskstats 是全域可讀，欄位定義見 kernel Documentation/admin-guide/iostats.rst：
    第 3 欄（index 2）是裝置名稱，第 6 欄（index 5）是累計讀取磁區數，第 10 欄（index 9）是
    累計寫入磁區數，乘以磁區大小（512 bytes）換算成位元組。"""
    read_sectors = write_sectors = 0
    found = False
    try:
        with open("/proc/diskstats") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 10:
                    continue
                name = parts[2]
                if (DISK_DEVICE and name == DISK_DEVICE) or (not DISK_DEVICE and _WHOLE_DISK_RE.match(name)):
                    read_sectors += int(parts[5])
                    write_sectors += int(parts[9])
                    found = True
    except (OSError, ValueError, IndexError):
        return None, None
    if not found:
        return None, None
    return read_sectors * SECTOR_SIZE, write_sectors * SECTOR_SIZE


def _read_cpu_jiffies():
    """/proc/stat 第一行的累計 CPU 時間（jiffies）：回傳 (總計, 閒置)。前 8 欄是 user nice system idle iowait irq softirq steal，
    guest 已包含在 user 內不重複加；閒置 = idle + iowait。前端用兩次讀數的差算出這段時間的 CPU 使用率，
    跟網路/硬碟一樣是累計計數器。"""
    try:
        with open("/proc/stat") as f:
            fields = [int(x) for x in f.readline().split()[1:9]]
        return sum(fields), fields[3] + fields[4]
    except (OSError, ValueError, IndexError):
        return None, None


def _count_connections():
    """對內/對外只能用「目前連線數」概念性區分（依對方 IP 是否落在 INTERNAL_NETWORKS
    任一網段），不是真正的流量位元組拆分——單一網卡在作業系統層級沒辦法直接拆出「這個位元組屬於
    哪個連線」，要做到真正的對內/對外流量拆分需要另外裝 nethogs/conntrack 這類工具並拿
    root 權限讀取，目前先用連線數當作對內/對外活動的概略指標，不需要額外權限。"""
    internal = external = 0
    for line in run("ss -tn state established").splitlines()[1:]:
        parts = line.split()
        if len(parts) < 4:
            continue
        peer = parts[-1].rsplit(":", 1)[0].strip("[]")
        try:
            ip = ipaddress.ip_address(peer)
        except ValueError:
            continue
        if ip.is_loopback:
            continue
        if any(ip in net for net in INTERNAL_NETWORKS):
            internal += 1
        else:
            external += 1
    return {"internal": internal, "external": external}


@router.get("/live-stats", dependencies=[Depends(require_permission("services", "view"))])
def get_live_stats():
    """給側邊欄「即時系統動態」頁面用（開著時每 2 秒一次）：記憶體是即時快照，CPU/網路/硬碟是累計計數器
    （不是速率）——前端自己用兩次讀數的差 / 時間差算出即時值，後端不維護取樣狀態，
    每次呼叫都是無狀態的即時讀數，簡單可靠，也不怕後端重啟後狀態遺失。
    全部直接讀 /proc，不開 top/free 子程序。"""
    cpu_total, cpu_idle = _read_cpu_jiffies()
    mem_used, mem_total = _meminfo_mb()
    disk_read_bytes, disk_write_bytes = _read_disk_io()

    return {
        "timestamp": time.time(),
        "cpu_total": cpu_total,
        "cpu_idle": cpu_idle,
        "mem_used_mb": mem_used,
        "mem_total_mb": mem_total,
        "rx_bytes": _read_iface_counter("rx_bytes"),
        "tx_bytes": _read_iface_counter("tx_bytes"),
        "disk_read_bytes": disk_read_bytes,
        "disk_write_bytes": disk_write_bytes,
        "connections": _count_connections(),
    }


@router.post("/power/reboot", dependencies=[Depends(require_super_admin())])
def reboot_system():
    """重開機。高風險操作，只有 super_admin 能用，前端有二次確認。
    `systemctl reboot` 只是把請求送給 systemd（PID 1）就會立刻返回，
    真正關閉服務/重開機是 systemd 之後才執行的，所以這支 API 來得及先回應 200。"""
    subprocess.Popen([*privileged._PREFIX, "systemctl", "reboot"])
    return {"status": "ok", "action": "reboot"}


@router.post("/power/shutdown", dependencies=[Depends(require_super_admin())])
def shutdown_system():
    """關機。高風險操作，只有 super_admin 能用，前端有二次確認。"""
    subprocess.Popen([*privileged._PREFIX, "systemctl", "poweroff"])
    return {"status": "ok", "action": "shutdown"}
