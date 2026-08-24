import os

MAIL_LOG = os.environ.get("MAIL_ADMIN_LOG_PATH", "/var/log/mail.log")
MAILDATA_PATH = os.environ.get("MAIL_ADMIN_MAILDATA_PATH", "/mnt/maildata/homes")
SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "data", "settings.json")
AMAVIS_OVERRIDE_FILE = os.environ.get("MAIL_ADMIN_AMAVIS_OVERRIDE_FILE", "/etc/amavis/conf.d/50-user")
PASSKEYS_FILE = os.path.join(os.path.dirname(__file__), "data", "passkeys.json")
ADMINS_FILE = os.path.join(os.path.dirname(__file__), "data", "admins.json")
IP_LISTS_FILE = os.path.join(os.path.dirname(__file__), "data", "ip_lists.json")
WEBMAIL_POLICY_FILE = os.path.join(os.path.dirname(__file__), "data", "webmail_policy.json")
NOTIFICATIONS_FILE = os.path.join(os.path.dirname(__file__), "data", "notifications.json")
IP_WHITELIST_SYNC_FILE = os.environ.get("MAIL_ADMIN_IP_WHITELIST_FILE", "/etc/mail-admin/whitelist-ips.txt")
IP_BLACKLIST_SYNC_FILE = os.environ.get("MAIL_ADMIN_IP_BLACKLIST_FILE", "/etc/mail-admin/blacklist-ips.txt")
SECRET_KEY = os.environ["MAIL_ADMIN_JWT_SECRET"]
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("MAIL_ADMIN_TOKEN_EXPIRE_MINUTES", "480"))

DB_HOST = os.environ.get("MAIL_ADMIN_DB_HOST", "127.0.0.1")
DB_USER = os.environ.get("MAIL_ADMIN_DB_USER", "mailuser")
DB_PASS = os.environ["MAIL_ADMIN_DB_PASS"]
DB_NAME = os.environ.get("MAIL_ADMIN_DB_NAME", "mailserver")

DEFAULT_MAIL_DOMAIN = os.environ.get("MAIL_ADMIN_DEFAULT_DOMAIN", "example.com")
