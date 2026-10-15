import os

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

MAIL_LOG = os.environ.get("MAIL_ADMIN_LOG_PATH", "/var/log/mail.log")
MAILDATA_PATH = os.environ.get("MAIL_ADMIN_MAILDATA_PATH", "/var/vmail/homes")
# Only set this if the mail storage is a separate mount (NFS/NAS/extra disk); leave empty for local disk.
MAILDATA_MOUNT = os.environ.get("MAIL_ADMIN_MAILDATA_MOUNT", "")
SETTINGS_FILE = os.path.join(_DATA_DIR, "settings.json")
AMAVIS_OVERRIDE_FILE = os.environ.get("MAIL_ADMIN_AMAVIS_OVERRIDE_FILE", "/etc/amavis/conf.d/50-user")
PASSKEYS_FILE = os.path.join(_DATA_DIR, "passkeys.json")
ADMINS_FILE = os.path.join(_DATA_DIR, "admins.json")
IP_LISTS_FILE = os.path.join(_DATA_DIR, "ip_lists.json")
NOTIFICATIONS_FILE = os.path.join(_DATA_DIR, "notifications.json")
IP_WHITELIST_SYNC_FILE = os.environ.get("MAIL_ADMIN_IP_WHITELIST_FILE", "/etc/mail-admin/whitelist-ips.txt")
IP_BLACKLIST_SYNC_FILE = os.environ.get("MAIL_ADMIN_IP_BLACKLIST_FILE", "/etc/mail-admin/blacklist-ips.txt")
SECRET_KEY = os.environ["MAIL_ADMIN_JWT_SECRET"]
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("MAIL_ADMIN_TOKEN_EXPIRE_MINUTES", "480"))

DB_HOST = os.environ.get("MAIL_ADMIN_DB_HOST", "127.0.0.1")
DB_PORT = int(os.environ.get("MAIL_ADMIN_DB_PORT", "3306"))
DB_USER = os.environ.get("MAIL_ADMIN_DB_USER", "mailuser")
DB_PASS = os.environ["MAIL_ADMIN_DB_PASS"]
DB_NAME = os.environ.get("MAIL_ADMIN_DB_NAME", "mailserver")

DEFAULT_MAIL_DOMAIN = os.environ.get("MAIL_ADMIN_DEFAULT_DOMAIN", "example.com")
