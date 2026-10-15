# shellcheck shell=bash
# Shared helpers for the mail-admin installer. Sourced by main.sh; never run directly.

# ---------- output ----------
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_BLU=$'\033[34m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_BLU=""; C_BLD=""; C_RST=""
fi

log()  { printf '%s\n' "${C_BLU}==>${C_RST} $*"; }
ok()   { printf '%s\n' "${C_GRN} ok${C_RST} $*"; }
warn() { printf '%s\n' "${C_YEL}warn${C_RST} $*" >&2; }
die()  { printf '%s\n' "${C_RED}error${C_RST} $*" >&2; exit 1; }
step() { printf '\n%s\n' "${C_BLD}[$((++STEP_NO))/${STEP_TOTAL:-?}] $*${C_RST}"; }
STEP_NO=0

# ---------- paths ----------
INSTALLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # deploy/installer
DEPLOY_DIR="$(cd "$INSTALLER_DIR/.." && pwd)"                       # deploy
APP_SRC_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"                         # repo / release root
TEMPLATE_DIR="$DEPLOY_DIR/templates"
CONF_DIR="${MAIL_ADMIN_CONF_DIR:-/etc/mail-admin}"
STATE_FILE="$CONF_DIR/install.conf"
ENV_FILE="$CONF_DIR/mail-admin.env"          # the API environment (the systemd unit points at /etc/mail-admin/mail-admin.env)
CRED_FILE="/root/mail-admin-install.txt"

DRY_RUN="${DRY_RUN:-0}"
ASSUME_YES="${ASSUME_YES:-0}"

# ---------- command execution (everything that mutates the system goes through these) ----------
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s\n' "${C_YEL}[dry-run]${C_RST} $*"
    return 0
  fi
  "$@"
}

# run a command, tolerate failure (but say so)
try() {
  if [ "$DRY_RUN" = 1 ]; then printf '%s\n' "${C_YEL}[dry-run]${C_RST} $*"; return 0; fi
  "$@" || { warn "command failed (continuing): $*"; return 0; }
}

# run a command whose stdin is given as a here-string/pipe; dry-run only prints the command
run_stdin() {
  local input="$1"; shift
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s\n' "${C_YEL}[dry-run]${C_RST} $* <<< (${#input} bytes of input)"
    return 0
  fi
  printf '%s' "$input" | "$@"
}

# install a file with owner/mode from stdin-less content: write_file PATH MODE OWNER:GROUP CONTENT
write_file() {
  local path="$1" mode="$2" owner="$3" content="$4"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s\n' "${C_YEL}[dry-run]${C_RST} write $path (mode $mode, $owner, ${#content} bytes)"
    return 0
  fi
  mkdir -p "$(dirname "$path")"
  local tmp; tmp="$(mktemp "${path}.XXXXXX")"
  printf '%s\n' "$content" > "$tmp"
  chmod "$mode" "$tmp"
  chown "$owner" "$tmp"
  mv -f "$tmp" "$path"
}

# render TEMPLATE_RELATIVE_PATH -> stdout. Replaces @NAME@ with $NAME from the environment; errors on unset names.
render() {
  local src="$TEMPLATE_DIR/$1"
  [ -f "$src" ] || die "template not found: $src"
  python3 -I - "$src" <<'PY'
import os, re, sys
src = sys.argv[1]
text = open(src, encoding="utf-8").read()
missing = set()
def sub(m):
    name = m.group(1)
    if name not in os.environ:
        missing.add(name)
        return m.group(0)
    return os.environ[name]
out = re.sub(r"@([A-Z][A-Z0-9_]*)@", sub, text)
if missing:
    sys.stderr.write("render: %s: undefined variable(s): %s\n" % (src, ", ".join(sorted(missing))))
    sys.exit(1)
sys.stdout.write(out)
PY
}

# render a template and install it: install_template TEMPLATE DEST MODE OWNER
install_template() {
  local tpl="$1" dest="$2" mode="$3" owner="$4" content
  content="$(render "$tpl")" || die "failed to render $tpl"
  write_file "$dest" "$mode" "$owner" "$content"
}

# keep a one-time backup of a distro-provided file before we overwrite it
backup_once() {
  local f="$1"
  [ -e "$f" ] || return 0
  [ -e "$f.pre-mail-admin" ] && return 0
  run cp -a "$f" "$f.pre-mail-admin"
}

# ---------- random secrets ----------
gen_secret() {   # gen_secret LENGTH  -> random alphanumeric string
  python3 -I -c 'import secrets, string, sys
a = string.ascii_letters + string.digits
print("".join(secrets.choice(a) for _ in range(int(sys.argv[1]))), end="")' "${1:-24}"
}

# ---------- prompts (read from the terminal even when the script itself is piped into bash) ----------
HAVE_TTY=0
if [ -r /dev/tty ] && [ -w /dev/tty ] && { : < /dev/tty; } 2>/dev/null; then HAVE_TTY=1; fi
interactive() { [ "$ASSUME_YES" != 1 ] && [ "$HAVE_TTY" = 1 ]; }

# ask VAR "Question" "default" [secret]
# If VAR is already set (flag, env, saved config) it is kept without asking.
ask() {
  local var="$1" question="$2" default="${3-}" secret="${4-}" reply=""
  if [ -n "${!var-}" ]; then return 0; fi
  if ! interactive; then
    printf -v "$var" '%s' "$default"
    return 0
  fi
  local hint=""; [ -n "$default" ] && hint=" [$default]"
  if [ "$secret" = secret ]; then
    read -r -s -p "$question$hint: " reply < /dev/tty > /dev/tty; printf '\n' > /dev/tty
  else
    read -r -p "$question$hint: " reply < /dev/tty > /dev/tty
  fi
  printf -v "$var" '%s' "${reply:-$default}"
}

# ask_yn VAR "Question" default(yes|no)   -> sets VAR to 1/0 unless already set
ask_yn() {
  local var="$1" question="$2" default="${3:-no}" reply=""
  if [ -n "${!var-}" ]; then return 0; fi
  if ! interactive; then
    [ "$default" = yes ] && printf -v "$var" '1' || printf -v "$var" '0'
    return 0
  fi
  local hint="[y/N]"; [ "$default" = yes ] && hint="[Y/n]"
  read -r -p "$question $hint: " reply < /dev/tty > /dev/tty
  reply="${reply:-$default}"
  case "${reply,,}" in y|yes|1|true) printf -v "$var" '1' ;; *) printf -v "$var" '0' ;; esac
}

# ask_choice VAR "Question" default choice1 choice2 ...
ask_choice() {
  local var="$1" question="$2" default="$3"; shift 3
  local choices=("$@") reply="" i
  if [ -n "${!var-}" ]; then return 0; fi
  if ! interactive; then printf -v "$var" '%s' "$default"; return 0; fi
  printf '%s\n' "$question" > /dev/tty
  for i in "${!choices[@]}"; do printf '  %d) %s\n' "$((i+1))" "${choices[$i]}" > /dev/tty; done
  read -r -p "Choice [$default]: " reply < /dev/tty > /dev/tty
  reply="${reply:-$default}"
  if [[ "$reply" =~ ^[0-9]+$ ]] && [ "$reply" -ge 1 ] && [ "$reply" -le "${#choices[@]}" ]; then
    printf -v "$var" '%s' "${choices[$((reply-1))]%% *}"
  else
    printf -v "$var" '%s' "$reply"
  fi
}

# ---------- validators ----------
is_fqdn()    { [[ "$1" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$ ]]; }
is_port()    { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
is_uint()    { [[ "$1" =~ ^[0-9]+$ ]]; }
is_cidr()    { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/([0-9]|[12][0-9]|3[0-2]))?$ ]] || [[ "$1" =~ ^[0-9A-Fa-f:]+(/[0-9]{1,3})?$ && "$1" == *:* ]]; }
is_user()    { [[ "$1" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; }
is_localpart() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9._%+-]{0,62}[A-Za-z0-9_%+-])?$ ]] && [[ "$1" != *..* ]]; }

# split a comma/space separated list into one item per line
split_list() { printf '%s' "$1" | tr ', ' '\n\n' | sed '/^$/d'; }

# ---------- system helpers ----------
have() { command -v "$1" >/dev/null 2>&1; }

svc_enable_now() { run systemctl enable --now "$@"; }

# install apt packages non-interactively
apt_install() {
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

# ---------- saved answers ----------
# Persist the answers (never passwords given on the command line) so that re-running the installer
# or `mail-admin-install --upgrade` is repeatable.
save_state() {
  local k lines=""
  for k in "$@"; do
    lines+="$k=$(printf '%q' "${!k-}")"$'\n'
  done
  write_file "$STATE_FILE" 600 root:root "# Saved by the mail-admin installer. Re-running the installer reuses these values.
${lines}"
}

load_state() {
  [ -f "$STATE_FILE" ] || return 0
  local line k
  while IFS= read -r line; do
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)= ]] || continue
    k="${BASH_REMATCH[1]}"
    # command-line flags / environment win over saved values
    if [ -z "${!k+x}" ]; then eval "$line"; fi
  done < "$STATE_FILE"
}
