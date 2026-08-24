import json
import os
import re
import subprocess
import time
import urllib.request

from fastapi import APIRouter, Depends

from api.auth import require_permission, require_super_admin
from api.routers.security import _iter_all_lines
from api.routers.notifications import add_notification_once

router = APIRouter()

APT_HISTORY_LOG = "/var/log/apt/history.log"
UPGRADE_SCRIPT = "/usr/local/sbin/mail-admin-apt-upgrade.sh"
UPGRADE_STATE_DIR = "/var/lib/mail-admin-apt-upgrade"
UPGRADE_LOG_TAIL_LINES = 200
END_DATE_RE = re.compile(r"^End-Date:\s*(.+)$")
PKG_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9.+-]*$")
CHANGELOG_ENTRY_RE = re.compile(r"^\S+ \(([^)]+)\)\s+\S+;\s+urgency=\S+")
CHANGELOG_TRAILER_RE = re.compile(r"^ -- .*?  (.+)$")
CHANGELOG_TIMEOUT = 25

CLAMSCAN_SCRIPT = "/usr/local/sbin/mail-admin-clamav-fullscan.sh"
CLAMSCAN_STATE_DIR = "/var/lib/mail-admin-clamav-scan"
RKHUNTER_SCRIPT = "/usr/local/sbin/mail-admin-rkhunter-check.sh"
RKHUNTER_STATE_DIR = "/var/lib/mail-admin-rkhunter"
SCAN_LOG_TAIL_LINES = 300

ROUNDCUBE_DIR = "/var/www/roundcube"
ROUNDCUBE_VERSION_RE = re.compile(r"define\('RCMAIL_VERSION',\s*'([^']+)'\)")
ROUNDCUBE_RELEASES_API = "https://api.github.com/repos/roundcube/roundcubemail/releases"
ROUNDCUBE_UPGRADE_SCRIPT = "/usr/local/sbin/mail-admin-roundcube-upgrade.sh"
ROUNDCUBE_UPGRADE_STATE_DIR = "/var/lib/mail-admin-roundcube-upgrade"
ROUNDCUBE_FETCH_TIMEOUT = 10
ROUNDCUBE_RELEASES_CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "roundcube_releases_cache.json")
ROUNDCUBE_RELEASES_CACHE_TTL = 3600  # GitHub 未登入 API 每小時每個 IP 只有 60 次額度，Dashboard/系統更新頁每次載入
# 都會查一次，很容易就超過額度（已經實際踩到這個問題），用跟 security.py 的 GeoIP 快取一樣的
# 模式快取 1 小時，大幅減少呼叫次數；額度用完時優先回傳快取（即使過期），比整個功能掛掉好。

# rkhunter 的警告訊息是給系統管理員看的技術用語，這裡收錄目前遇過的幾種常見警告，
# 用白話文解釋「這通常代表什麼」，方便後台使用者不用自己查 rkhunter 文件。
# 沒收錄到的警告類型會走 fallback，誠實告知目前沒有現成說明，不會編造內容。
RKHUNTER_EXPLANATIONS = [
    (re.compile(r"has been replaced by a script"),
     "這通常是正常現象，不是被入侵的跡象。有些指令官方版本本來就是用 Perl/Shell 寫的文字腳本，"
     "不是編譯過的執行檔（例如這次遇到的 lwp-request 就是 libwww-perl 套件本身的設計）。"
     "rkhunter 只是機械式地檢查「這個指令是不是二進位檔」，看到是腳本就一律示警，但腳本本身可能完全合法。"
     "建議：用 `dpkg -S <檔案路徑>` 確認是哪個官方套件安裝的，確認後可以把它加進 rkhunter 的白名單。"),
    (re.compile(r"PermitRootLogin.*has not been set"),
     "SSH 伺服器「root 帳號能不能登入、用什麼方式登入」這項設定，沒有在設定檔裡明確寫出來，"
     "此時系統會套用內建的預設值。這本身不代表已經出問題，但沒有白紙黑字寫清楚的話，"
     "以後系統版本更新如果預設值改變，可能沒人會注意到。建議：直接在設定檔裡明確寫死這個選項。"),
    (re.compile(r"Hidden file found"),
     "在 Linux/Unix 系統，檔名開頭是「.」的檔案會被視為隱藏檔。這只是 rkhunter 的通用檢查邏輯"
     "（因為惡意程式有時會用隱藏檔藏匿自己），但絕大部分隱藏檔其實是作業系統或軟體自己產生的"
     "正常設定/備份檔案，不是問題。需要個別確認這個檔案實際是什麼來源，確認安全後可以加進白名單。"),
    (re.compile(r"SSH and rkhunter configuration options should be the same"),
     "這是在比對兩份設定是不是「講同一件事」：一份是 SSH 伺服器自己的設定（root 能不能登入），"
     "另一份是 rkhunter 自己記錄的「它認為 SSH 應該長怎樣」。這兩者目前字面上的寫法對不上"
     "（例如一個寫 prohibit-password、一個寫 no），所以 rkhunter 提醒兩邊要對齊。"
     "這不是被入侵的跡象，純粹是兩份設定檔用詞沒同步，把 rkhunter 那邊的值改成跟 SSH 設定"
     "完全一樣的文字（rkhunter 是逐字比對，不會自動理解語意相同的不同寫法）即可。"),
]


def _explain_rkhunter_warning(text: str) -> str:
    for pattern, explanation in RKHUNTER_EXPLANATIONS:
        if pattern.search(text):
            return explanation
    return "目前沒有收錄這種警告類型的說明。建議把警告內容拿去搜尋，或查閱 rkhunter 官方文件確認是否為已知的誤報類型。"


def _parse_rkhunter_warnings(text: str):
    """把 --report-warnings-only 的輸出切成一則一則的 Warning 區塊（含縮排的延續行）。"""
    warnings = []
    current = []
    for line in text.splitlines():
        if line.startswith("Warning:"):
            if current:
                warnings.append("\n".join(current))
            current = [line]
        elif current and line.startswith(" ") and line.strip():
            current.append(line)
        elif line.startswith("=") or (not line.strip() and current):
            if current:
                warnings.append("\n".join(current))
                current = []
    if current:
        warnings.append("\n".join(current))
    return warnings

PKG_RE = re.compile(
    r"^(?P<name>\S+)/(?P<repo>\S+)\s+(?P<new>\S+)\s+(?P<arch>\S+)\s+\[upgradable from:\s*(?P<old>[^\]]+)\]"
)

# 判斷一個可更新的套件屬於「Ubuntu 系統本身」還是「應用軟體」：
# kernel/firmware/開機相關 一律算 Ubuntu 系統套件，其餘（含 apache2/php/mariadb/postfix/dovecot/openssl/roundcube）算軟體更新
OS_PREFIXES = ("linux-", "grub", "initramfs-tools", "ubuntu-", "systemd", "base-files")
OS_NAMES = {"apport", "packagekit", "packagekit-tools", "dpkg", "apt"}

TRACKED_SOFTWARE = ["apache2", "mariadb-server", "postfix", "dovecot-core", "openssl", "roundcube-core"]


def _run(cmd, timeout=15):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except subprocess.TimeoutExpired:
        return ""


def _is_active(service: str) -> bool:
    return _run(f"systemctl is-active {service}") == "active"


def _is_enabled(service: str) -> bool:
    return _run(f"systemctl is-enabled {service}") == "enabled"


def _is_os_package(name: str) -> bool:
    return name.startswith(OS_PREFIXES) or name in OS_NAMES


def _installed_version(pkg: str) -> str:
    return _run(f"dpkg-query -W -f='${{Version}}' {pkg} 2>/dev/null")


def _is_version_newer(candidate: str, baseline: str) -> bool:
    r = subprocess.run(["dpkg", "--compare-versions", candidate, "gt", baseline], capture_output=True)
    return r.returncode == 0


def _parse_changelog(text: str):
    """解析 apt-get changelog 的 debian changelog 格式，切成一筆一筆 {version, date, changes}。"""
    entries = []
    version = None
    date = None
    changes = []
    for line in text.splitlines():
        m = CHANGELOG_ENTRY_RE.match(line)
        if m:
            if version is not None:
                entries.append({"version": version, "date": date, "changes": changes})
            version = m.group(1)
            date = None
            changes = []
            continue
        t = CHANGELOG_TRAILER_RE.match(line)
        if t and version is not None:
            date = t.group(1).strip()
            continue
        stripped = line.strip()
        if version is not None and (stripped.startswith("*") or stripped.startswith("-")):
            changes.append(stripped)
    if version is not None:
        entries.append({"version": version, "date": date, "changes": changes})
    return entries


def _detect_php_package() -> str:
    out = _run("dpkg-query -f='${Package}\\n' -W 'php*-common' 2>/dev/null")
    lines = [l for l in out.splitlines() if l.strip()]
    return lines[0] if lines else ""


def _get_roundcube_installed_version():
    try:
        with open(os.path.join(ROUNDCUBE_DIR, "program/include/iniset.php")) as f:
            content = f.read()
    except OSError:
        return None
    m = ROUNDCUBE_VERSION_RE.search(content)
    return m.group(1) if m else None


def _load_roundcube_releases_cache():
    if os.path.exists(ROUNDCUBE_RELEASES_CACHE_FILE):
        try:
            with open(ROUNDCUBE_RELEASES_CACHE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None
    return None


def _save_roundcube_releases_cache(releases):
    os.makedirs(os.path.dirname(ROUNDCUBE_RELEASES_CACHE_FILE), exist_ok=True)
    with open(ROUNDCUBE_RELEASES_CACHE_FILE, "w") as f:
        json.dump({"_cached_at": time.time(), "releases": releases}, f)


def _fetch_roundcube_releases(per_page: int = 15):
    """查 Roundcube 官方 GitHub Release，Roundcube 是用 Composer 部署（不是 apt 套件），
    dpkg/apt 完全管不到它的版本，所以版本資訊只能查官方 release，不能沿用 apt 那套機制。
    GitHub 未登入 API 額度是每小時每個 IP 60 次，先查快取（1 小時內直接用），
    快取過期才真的打 API；打 API 失敗（含額度用完）時，寧可回傳過期的快取資料，
    也不要整個功能顯示查詢失敗——舊資料總比沒資料好。"""
    cached = _load_roundcube_releases_cache()
    if cached and time.time() - cached.get("_cached_at", 0) < ROUNDCUBE_RELEASES_CACHE_TTL:
        return cached["releases"]

    try:
        req = urllib.request.Request(
            f"{ROUNDCUBE_RELEASES_API}?per_page={per_page}",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "mail-admin"},
        )
        with urllib.request.urlopen(req, timeout=ROUNDCUBE_FETCH_TIMEOUT) as resp:
            releases = json.loads(resp.read().decode())
        _save_roundcube_releases_cache(releases)
        return releases
    except Exception:
        return cached["releases"] if cached else None


STABLE_VERSION_RE = re.compile(r"^\d+(\.\d+)+$")


def _version_tuple(v):
    """只接受純數字版號（1.7.3），rc/beta/alpha 這種預覽版標籤回傳 None 讓呼叫端排除掉——
    不然像 '1.7-rc6' 取數字會變成 (1,7,6)，誤判成比 1.7.3 還新的正式版。"""
    if not v or not STABLE_VERSION_RE.match(v):
        return None
    return tuple(int(n) for n in v.split("."))


def _get_boot_time():
    """從 /proc/stat 的 btime 讀取系統開機時間（epoch 秒），這同時也是「上次重新啟動時間」。"""
    try:
        with open("/proc/stat") as f:
            for line in f:
                if line.startswith("btime "):
                    return int(line.split()[1])
    except OSError:
        pass
    return None


def _get_last_package_update():
    """掃描 /var/log/apt/history.log（含輪替檔）找出最後一次「真的有套件被 Upgrade/Install」的紀錄時間，
    只看 apt update（只更新套件索引，沒有實際變動套件）不算。回傳 epoch 秒。"""
    last_end_date = None
    block_has_change = False
    for line in _iter_all_lines(APT_HISTORY_LOG):
        line = line.rstrip("\n")
        if line.startswith("Start-Date:"):
            block_has_change = False
        elif line.startswith("Upgrade:") or line.startswith("Install:"):
            block_has_change = True
        else:
            m = END_DATE_RE.match(line)
            if m and block_has_change:
                normalized = " ".join(m.group(1).split())  # 有些版本日期時間中間是兩個空白，統一normalize成一個
                try:
                    last_end_date = int(time.mktime(time.strptime(normalized, "%Y-%m-%d %H:%M:%S")))
                except ValueError:
                    pass
    return last_end_date


def _read_state_file(state_dir: str, name: str):
    try:
        with open(os.path.join(state_dir, name)) as f:
            return f.read().strip()
    except OSError:
        return None


def _read_upgrade_state_file(name: str):
    return _read_state_file(UPGRADE_STATE_DIR, name)


def _read_log_tail(state_dir: str, log_name: str, max_lines: int) -> str:
    try:
        with open(os.path.join(state_dir, log_name)) as f:
            return "".join(f.readlines()[-max_lines:])
    except OSError:
        return ""


@router.get("/upgrade-status", dependencies=[Depends(require_permission("services", "view"))])
def get_upgrade_status():
    status = _read_upgrade_state_file("status") or "idle"
    log_path = os.path.join(UPGRADE_STATE_DIR, "upgrade.log")
    log_tail = ""
    try:
        with open(log_path) as f:
            log_tail = "".join(f.readlines()[-UPGRADE_LOG_TAIL_LINES:])
    except OSError:
        pass
    return {
        "status": status,
        "finished_at": _read_upgrade_state_file("finished_at"),
        "log_tail": log_tail,
    }


@router.post("/upgrade", dependencies=[Depends(require_super_admin())])
def trigger_upgrade():
    """觸發 apt upgrade。高風險操作（可能造成服務短暫重啟），只有 super_admin 能用，前端有二次確認。
    實際執行的固定路徑腳本、以及運行此服務的系統帳號對它的 NOPASSWD sudo 授權，見 ~/fix-apt-oneclick-update.sh。
    腳本本身有 flock，這裡的狀態檢查只是為了讓使用者連點按鈕時能立刻得到提示，不是唯一防線。"""
    if _read_upgrade_state_file("status") == "running":
        return {"error": {"code": "upgrade_already_running"}}
    subprocess.Popen(["sudo", UPGRADE_SCRIPT])
    return {"status": "started"}


@router.get("/clamav-scan-status", dependencies=[Depends(require_permission("services", "view"))])
def get_clamav_scan_status():
    return {
        "status": _read_state_file(CLAMSCAN_STATE_DIR, "status") or "idle",
        "finished_at": _read_state_file(CLAMSCAN_STATE_DIR, "finished_at"),
        "log_tail": _read_log_tail(CLAMSCAN_STATE_DIR, "scan.log", SCAN_LOG_TAIL_LINES),
    }


@router.post("/clamav-scan", dependencies=[Depends(require_super_admin())])
def trigger_clamav_scan():
    """觸發全系統 ClamAV 掃描（本機檔案系統，不含 NFS 掛載的郵件儲存——郵件內容收發時已逐封掃過）。
    高風險操作定義成跟 apt upgrade 一樣（會占用系統資源一段時間），只有 super_admin 能觸發。
    實際腳本與運行此服務的系統帳號的 NOPASSWD sudo 授權見 ~/fix-security-scan.sh。"""
    if _read_state_file(CLAMSCAN_STATE_DIR, "status") == "running":
        return {"error": {"code": "scan_already_running"}}
    subprocess.Popen(["sudo", CLAMSCAN_SCRIPT])
    return {"status": "started"}


@router.get("/rkhunter-status", dependencies=[Depends(require_permission("services", "view"))])
def get_rkhunter_status():
    warning_count_raw = _read_state_file(RKHUNTER_STATE_DIR, "warning_count")
    try:
        warning_count = int(warning_count_raw) if warning_count_raw is not None else None
    except ValueError:
        warning_count = None
    log_tail = _read_log_tail(RKHUNTER_STATE_DIR, "check.log", SCAN_LOG_TAIL_LINES)
    warnings = [
        {"raw": w, "explanation": _explain_rkhunter_warning(w)}
        for w in _parse_rkhunter_warnings(log_tail)
    ]
    return {
        "status": _read_state_file(RKHUNTER_STATE_DIR, "status") or "idle",
        "finished_at": _read_state_file(RKHUNTER_STATE_DIR, "finished_at"),
        "warning_count": warning_count,
        "log_tail": log_tail,
        "warnings": warnings,
    }


@router.post("/rkhunter-check", dependencies=[Depends(require_super_admin())])
def trigger_rkhunter_check():
    """觸發 rkhunter rootkit 檢查，只有 super_admin 能觸發。
    實際腳本與運行此服務的系統帳號的 NOPASSWD sudo 授權見 ~/fix-security-scan.sh。"""
    if _read_state_file(RKHUNTER_STATE_DIR, "status") == "running":
        return {"error": {"code": "scan_already_running"}}
    subprocess.Popen(["sudo", RKHUNTER_SCRIPT])
    return {"status": "started"}


def _newer_roundcube_releases(releases, installed):
    """Roundcube 官方同時維護 1.6.x（LTS）跟 1.7.x 兩條分支，GitHub API 回傳的清單是
    依發布時間排序、兩條分支混在一起，不能直接「找到目前版本就停止」（會誤把同時間
    發布的舊分支版本當成更新）。改用版本數字實際比大小，只挑比目前安裝版本新的，
    且照版本高到低排序。tag 不是純數字版號（rc/beta 這類預覽版）的一律排除。"""
    installed_tuple = _version_tuple(installed) or ()
    tagged = [(r, _version_tuple(r.get("tag_name"))) for r in releases]
    newer = [(r, v) for r, v in tagged if v is not None and v > installed_tuple]
    newer.sort(key=lambda pair: pair[1], reverse=True)
    return [r for r, _ in newer]


@router.get("/roundcube-status", dependencies=[Depends(require_permission("services", "view"))])
def get_roundcube_status():
    installed = _get_roundcube_installed_version()
    releases = _fetch_roundcube_releases(per_page=15)
    if not releases:
        return {"installed_version": installed, "latest_version": None, "fetch_failed": True}

    newer = _newer_roundcube_releases(releases, installed)
    if not newer:
        return {
            "installed_version": installed,
            "latest_version": installed,
            "published_at": None,
            "up_to_date": True,
            "is_security_pending": False,
        }

    latest = newer[0]
    is_security_pending = any("security" in (r.get("body") or "").lower() for r in newer)

    return {
        "installed_version": installed,
        "latest_version": latest.get("tag_name"),
        "published_at": latest.get("published_at"),
        "up_to_date": False,
        "is_security_pending": is_security_pending,
    }


@router.get("/roundcube-changelog", dependencies=[Depends(require_permission("services", "view"))])
def get_roundcube_changelog():
    """跟套件 changelog 概念一樣，但 Roundcube 版本資訊來自官方 GitHub Release，
    不是 apt——只列出比目前安裝版本新的版次（見 _newer_roundcube_releases 的說明）。"""
    installed = _get_roundcube_installed_version()
    releases = _fetch_roundcube_releases(per_page=15)
    if not releases:
        return {"installed_version": installed, "entries": [], "fetch_failed": True}

    entries = []
    for r in _newer_roundcube_releases(releases, installed):
        body = (r.get("body") or "").strip()
        changes = [line.strip() for line in body.splitlines() if line.strip().startswith(("-", "*"))]
        entries.append({
            "version": r.get("tag_name"),
            "date": r.get("published_at"),
            "changes": changes or ([body] if body else []),
        })
    return {"installed_version": installed, "entries": entries}


@router.get("/roundcube-update-status", dependencies=[Depends(require_permission("services", "view"))])
def get_roundcube_update_status():
    return {
        "status": _read_state_file(ROUNDCUBE_UPGRADE_STATE_DIR, "status") or "idle",
        "finished_at": _read_state_file(ROUNDCUBE_UPGRADE_STATE_DIR, "finished_at"),
        "log_tail": _read_log_tail(ROUNDCUBE_UPGRADE_STATE_DIR, "upgrade.log", SCAN_LOG_TAIL_LINES),
    }


@router.post("/roundcube-update", dependencies=[Depends(require_super_admin())])
def trigger_roundcube_update():
    """觸發 Roundcube 更新。風險比 apt upgrade 更高（沒有 dpkg 幫忙管理版本/回滾，
    是直接置換 Composer 部署的應用程式檔案），只有 super_admin 能觸發，前端有二次確認。
    更新前一定會先備份檔案+資料庫，見 ~/fix-roundcube-oneclick-update.sh。"""
    if _read_state_file(ROUNDCUBE_UPGRADE_STATE_DIR, "status") == "running":
        return {"error": {"code": "upgrade_already_running"}}
    subprocess.Popen(["sudo", ROUNDCUBE_UPGRADE_SCRIPT])
    return {"status": "started"}


@router.get("/changelog/{package}", dependencies=[Depends(require_permission("services", "view"))])
def get_package_changelog(package: str):
    """查某個套件的 changelog（推出時間 + 更新內容），純讀取不需要 sudo。
    apt-get changelog 會即時連線抓 changelogs.ubuntu.com，只在使用者點「詳細」時才呼叫，
    不在 GET /system-updates/ 主頁面就對每個套件都抓一次，避免拖慢主頁面載入。"""
    if not PKG_NAME_RE.match(package):
        return {"error": {"code": "invalid_package_name"}}

    installed_version = _installed_version(package) or None
    try:
        r = subprocess.run(
            ["apt-get", "changelog", package],
            capture_output=True, text=True, timeout=CHANGELOG_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return {"package": package, "installed_version": installed_version, "entries": [], "fetch_failed": True}

    if r.returncode != 0 or not r.stdout.strip():
        return {"package": package, "installed_version": installed_version, "entries": [], "fetch_failed": True}

    entries = _parse_changelog(r.stdout)
    if installed_version:
        newer = [e for e in entries if _is_version_newer(e["version"], installed_version)]
        entries = newer if newer else entries[:3]
    else:
        entries = entries[:3]

    return {"package": package, "installed_version": installed_version, "entries": entries}


@router.get("/", dependencies=[Depends(require_permission("services", "view"))])
def get_system_updates():
    os_packages = []
    software_packages = []
    for line in _run("apt list --upgradable 2>/dev/null").splitlines():
        m = PKG_RE.match(line.strip())
        if not m:
            continue
        entry = {
            "name": m.group("name"),
            "repo": m.group("repo"),
            "current_version": m.group("old").strip(),
            "new_version": m.group("new"),
            "is_security": "security" in m.group("repo").lower(),
        }
        (os_packages if _is_os_package(entry["name"]) else software_packages).append(entry)

    reboot_required = os.path.exists("/var/run/reboot-required")
    reboot_required_packages = []
    if reboot_required and os.path.exists("/var/run/reboot-required.pkgs"):
        with open("/var/run/reboot-required.pkgs") as f:
            reboot_required_packages = [l.strip() for l in f if l.strip()]

    clamav_version = _run("clamscan --version 2>&1")
    clamav_db_updated_at = None
    try:
        clamav_db_updated_at = os.path.getmtime("/var/lib/clamav/daily.cld")
    except OSError:
        pass
    clamav_daemon_active = _is_active("clamav-daemon")
    clamav_freshclam_active = _is_active("clamav-freshclam")

    tracked_names = list(TRACKED_SOFTWARE)
    php_pkg = _detect_php_package()
    if php_pkg:
        tracked_names.append(php_pkg)
    upgradable_names = {p["name"] for p in software_packages} | {p["name"] for p in os_packages}
    tracked_services = [
        {
            "name": name,
            # roundcube-core 是用 Composer 部署，dpkg 完全管不到它的版本（見 25.x 節），
            # 版本要另外從程式碼常數讀；是否有更新請看下面專屬的 Roundcube 卡片（那裡才會
            # 即時查官方 GitHub Release，這裡不重複打一次外部 API，避免拖慢這個主要列表）
            "installed_version": (_get_roundcube_installed_version() if name == "roundcube-core" else _installed_version(name)) or None,
            "upgradable": False if name == "roundcube-core" else name in upgradable_names,
        }
        for name in tracked_names
    ]

    return {
        "overview": {
            "reboot_required": reboot_required,
            "reboot_required_packages": reboot_required_packages,
            "total_packages": len(os_packages) + len(software_packages),
            "security_packages": sum(1 for p in os_packages + software_packages if p["is_security"]),
            "os_package_count": len(os_packages),
            "software_package_count": len(software_packages),
            "unattended_upgrades": {
                "enabled": _is_enabled("unattended-upgrades"),
                "active": _is_active("unattended-upgrades"),
            },
            "clamav_ok": clamav_daemon_active and clamav_freshclam_active,
            "boot_time": _get_boot_time(),
            "last_package_update_at": _get_last_package_update(),
        },
        "os_updates": {
            "packages": os_packages,
        },
        "software_updates": {
            "packages": software_packages,
            "tracked_services": tracked_services,
        },
        "antivirus_updates": {
            "version": clamav_version,
            "daemon_active": clamav_daemon_active,
            "freshclam_active": clamav_freshclam_active,
            "db_updated_at": clamav_db_updated_at,
        },
    }


@router.get("/summary", dependencies=[Depends(require_permission("services", "view"))])
def get_system_updates_summary():
    """給 Dashboard 首頁用的輕量彙總，把系統更新總覽頁面裡各種不同性質的「待更新項目」
    （apt 套件、Roundcube、ClamAV 病毒庫、rkhunter 掃描結果、是否需要重開機）統一整理成
    一份清單，不用重複寫一次判斷邏輯——直接呼叫既有的幾支函式再彙整。"""
    full = get_system_updates()
    overview = full["overview"]
    rc = get_roundcube_status()
    rk = get_rkhunter_status()

    items = [
        {"key": "os_packages", "needs_action": overview["os_package_count"] > 0, "count": overview["os_package_count"]},
        {"key": "software_packages", "needs_action": overview["software_package_count"] > 0, "count": overview["software_package_count"]},
        {"key": "roundcube", "needs_action": bool(rc.get("installed_version")) and not rc.get("up_to_date", True) and not rc.get("fetch_failed"), "is_security": rc.get("is_security_pending", False)},
        {"key": "clamav_db", "needs_action": not overview["clamav_ok"]},
        {"key": "rkhunter", "needs_action": rk.get("status") == "warning", "count": rk.get("warning_count") or 0},
        {"key": "reboot_required", "needs_action": overview["reboot_required"]},
    ]
    return {
        "items": items,
        "total_needing_action": sum(1 for i in items if i["needs_action"]),
        "reboot_required": overview["reboot_required"],
    }


def check_and_notify_health():
    """由 main.py 的背景排程週期性呼叫（不需要有人打開後台頁面才會觸發），把「系統更新總覽」
    頁面本來就會顯示的幾種待處理狀態，同步寫成通知中心的通知，讓管理員不用主動點進頁面
    才會發現「有套件安全更新／Roundcube 有安全性更新／掃描出問題／需要重開機」。
    全部用 add_notification_once 防止洗版，見 notifications.py 的說明。"""
    if os.path.exists("/var/run/reboot-required"):
        pkgs = []
        if os.path.exists("/var/run/reboot-required.pkgs"):
            with open("/var/run/reboot-required.pkgs") as f:
                pkgs = [l.strip() for l in f if l.strip()]
        add_notification_once("reboot_required", "reboot", packages=pkgs)

    full = get_system_updates()
    sec_count = full["overview"]["security_packages"]
    if sec_count > 0:
        add_notification_once("apt_security_updates", str(sec_count), count=sec_count)

    rc = get_roundcube_status()
    if rc.get("is_security_pending") and rc.get("latest_version"):
        add_notification_once(
            "roundcube_security_update", rc["latest_version"],
            current=rc.get("installed_version"), latest=rc.get("latest_version"),
        )

    clamav_status = _read_state_file(CLAMSCAN_STATE_DIR, "status")
    clamav_finished_at = _read_state_file(CLAMSCAN_STATE_DIR, "finished_at")
    if clamav_status == "infected" and clamav_finished_at:
        add_notification_once("clamav_infected", clamav_finished_at, finished_at=clamav_finished_at)

    rk = get_rkhunter_status()
    if rk.get("status") == "warning" and rk.get("finished_at"):
        add_notification_once(
            "rkhunter_warning", rk["finished_at"],
            count=rk.get("warning_count") or 0, finished_at=rk.get("finished_at"),
        )
