import os
from fastapi import APIRouter, Depends
from api.auth import require_permission, require_super_admin
from api.routers.notifications import add_notification_once
import ipaddress
import subprocess
import time

router = APIRouter()

SERVICES = os.environ.get(
    "MAIL_ADMIN_MANAGED_SERVICES",
    "postfix,dovecot,amavis,clamav-daemon,opendkim,apache2,fail2ban,mariadb",
).split(",")
NETWORK_IFACE = os.environ.get("MAIL_ADMIN_NETWORK_IFACE", "eth0")
DISK_DEVICE = os.environ.get("MAIL_ADMIN_DISK_DEVICE", "sda")
SECTOR_SIZE = 512
INTERNAL_NETWORK = ipaddress.ip_network(os.environ.get("MAIL_ADMIN_INTERNAL_NETWORK", "192.168.1.0/24"))

def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return r.stdout.strip()

@router.get("/", dependencies=[Depends(require_permission("services", "view"))])
def get_services():
    result = []
    for svc in SERVICES:
        status = run(f"systemctl is-active {svc}")
        uptime = run(f"systemctl show {svc} --property=ActiveEnterTimestamp --value")
        result.append({"name": svc, "status": status, "uptime": uptime})
    return result

def check_and_notify_health():
    """由 main.py 的背景排程週期性呼叫：任何一個核心服務不是 active 狀態就發通知，
    不需要有人打開後台頁面才會發現服務掛了。同一個服務在被標記已讀之前不會重複通知，
    見 notifications.py 的 add_notification_once 說明。"""
    for svc in SERVICES:
        status = run(f"systemctl is-active {svc}")
        if status != "active":
            add_notification_once("service_down", svc, service=svc, status=status)


@router.post("/restart/{service}", dependencies=[Depends(require_permission("services", "modify"))])
def restart_service(service: str):
    if service not in SERVICES:
        return {"error": {"code": "service_not_allowed"}}
    run(f"sudo systemctl restart {service}")
    return {"status": "ok", "service": service}

@router.get("/system", dependencies=[Depends(require_permission("services", "view"))])
def system_info():
    cpu = run("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'")
    mem = run("free -m | awk 'NR==2{printf \"%s/%s\", $3, $2}'")
    disk_root = run("df -h / | awk 'NR==2{print $3\"/\"$2\" (\"$5\")\"}'")
    disk_nas = run("df -h /mnt/maildata | awk 'NR==2{print $3\"/\"$2\" (\"$5\")\"}' 2>/dev/null || echo 'N/A'")
    nfs = run("mountpoint -q /mnt/maildata && echo 'mounted' || echo 'unmounted'")
    return {"cpu": cpu, "memory": mem, "disk_root": disk_root, "disk_nas": disk_nas, "nfs": nfs}


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
    try:
        with open("/proc/diskstats") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 10 and parts[2] == DISK_DEVICE:
                    return int(parts[5]) * SECTOR_SIZE, int(parts[9]) * SECTOR_SIZE
    except (OSError, ValueError, IndexError):
        pass
    return None, None


def _count_connections():
    """對內/對外只能用「目前連線數」概念性區分（依對方 IP 是否在 INTERNAL_NETWORK 設定的網段內），
    不是真正的流量位元組拆分——單一網卡在作業系統層級沒辦法直接拆出「這個位元組屬於
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
        if ip in INTERNAL_NETWORK:
            internal += 1
        else:
            external += 1
    return {"internal": internal, "external": external}


@router.get("/live-stats", dependencies=[Depends(require_permission("services", "view"))])
def get_live_stats():
    """給側邊欄「即時系統動態」頁面用：CPU/記憶體是即時快照，網路/硬碟是累計計數器
    （不是速率）——前端自己用兩次讀數的差 / 時間差算出即時速率，後端不維護取樣狀態，
    每次呼叫都是無狀態的即時讀數，簡單可靠，也不怕後端重啟後狀態遺失。"""
    cpu = run("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'")
    mem_used = run("free -m | awk 'NR==2{print $3}'")
    mem_total = run("free -m | awk 'NR==2{print $2}'")
    disk_read_bytes, disk_write_bytes = _read_disk_io()

    def _to_float(s):
        try:
            return float(s)
        except (TypeError, ValueError):
            return None

    return {
        "timestamp": time.time(),
        "cpu_percent": _to_float(cpu),
        "mem_used_mb": _to_float(mem_used),
        "mem_total_mb": _to_float(mem_total),
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
    subprocess.Popen(["sudo", "systemctl", "reboot"])
    return {"status": "ok", "action": "reboot"}


@router.post("/power/shutdown", dependencies=[Depends(require_super_admin())])
def shutdown_system():
    """關機。高風險操作，只有 super_admin 能用，前端有二次確認。"""
    subprocess.Popen(["sudo", "systemctl", "poweroff"])
    return {"status": "ok", "action": "shutdown"}
