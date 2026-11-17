#!/usr/bin/env bash
# DGX Spark hardware acceptance and health test.
# SSH is transport only. No passwords are read or stored.
# Compatible with bash 3.2 (stock macOS) and newer.

set -u

VERSION="2.2.0"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEFAULT_CONFIG="$SCRIPT_DIR/dgx-spark.env"

# Captured before config load so the environment beats the file and flags beat both.
ORIG_HOST=${DGX_HOST:-}
ORIG_USER=${DGX_USER:-}
ORIG_PORT=${DGX_PORT:-}
ORIG_IDENTITY=${DGX_IDENTITY:-}
ORIG_TIMEOUT=${DGX_TIMEOUT:-}
ORIG_ACCEPT_NEW=${DGX_ACCEPT_NEW:-}
ORIG_STRICT=${DGX_STRICT:-}
ORIG_INTERACTIVE=${DGX_INTERACTIVE:-}
ORIG_FINGERPRINT=${DGX_EXPECT_FINGERPRINT:-}
ORIG_EXPECT_DISK_TB=${DGX_EXPECT_DISK_TB:-}
ORIG_HOST_KEY_ALIAS=${DGX_HOST_KEY_ALIAS:-}

CLI_HOST=""
CLI_USER=""
CLI_PORT=""
CLI_IDENTITY=""
CLI_TIMEOUT=""
CLI_ACCEPT_NEW=""
CLI_STRICT=""
CLI_INTERACTIVE=""
CLI_AUTO_INTERACTIVE=0
CLI_FINGERPRINT=""
CLI_EXPECT_DISK_TB=""
CLI_HOST_KEY_ALIAS=""
CLI_CONFIG=""
CLI_COLOR=""
CLI_PREPARE=0
SHOW_HELP=0

FILE_HOST=""
FILE_USER=""
FILE_PORT=""
FILE_IDENTITY=""
FILE_TIMEOUT=""
FILE_ACCEPT_NEW=""
FILE_STRICT=""
FILE_INTERACTIVE=""
FILE_FINGERPRINT=""
FILE_EXPECT_DISK_TB=""
FILE_HOST_KEY_ALIAS=""

HOST=""
USER_NAME=""
PORT=""
IDENTITY=""
TIMEOUT=""
ACCEPT_NEW=0
STRICT=0
INTERACTIVE=0
EXPECT_FP=""
EXPECT_DISK_TB=1
HOST_KEY_ALIAS=""
USE_COLOR=1

C_RESET=""
C_BOLD=""
C_DIM=""
C_NV=""
C_OK=""
C_BAD=""
C_WARN=""
C_TEXT=""

STARTED_MS=0
CHECKS_TOTAL=0
CHECKS_FAIL=0
NOTES=""
VERDICT="FAILED"
VERDICT_HINT=""
EXIT_CODE=1
SYSTEM_READY=0

R_HOSTNAME=""
R_FQDN=""
R_KERNEL=""
R_ARCH=""
R_OS=""
R_DGX_NAME=""
R_DGX_VERSION=""
R_UPTIME=""
R_LOAD=""
R_MEM_TOTAL=""
R_MEM_AVAIL=""
R_DISK=""
R_CPU=""
R_NCPU=""
R_GPU_CSV=""
R_GPU_LIST=""
R_CUDA=""
R_IP=""
R_DISKS=""
R_ROOT_DEVICE=""
R_NVME_HEALTH=""
R_NVME_CRITICAL=""
R_NVME_MEDIA_ERRORS=""
R_NVME_TEMP=""
R_NVME_MODEL=""
R_NVME_SERIAL=""
R_NVME_FIRMWARE=""
R_NVME_SPARE=""
R_NVME_SPARE_THRESHOLD=""
R_NVME_PERCENT_USED=""
R_NVME_DATA_READ=""
R_NVME_DATA_WRITTEN=""
R_NVME_BUSY_MINUTES=""
R_NVME_POWER_CYCLES=""
R_NVME_POWER_HOURS=""
R_NVME_UNSAFE_SHUTDOWNS=""
R_NVME_ERROR_ENTRIES=""
R_DISK_WRITE_MBPS=""
R_DISK_READ_MBPS=""
R_DISK_TEST=""
R_MEMORY_TEST=""
R_GPU_TEST=""
R_GPU_TEST_DETAIL=""
R_XID_ERRORS=""
R_SYSTEM_ERRORS=""
R_MAX_TEMP=""
R_MAX_TEMP_LABEL=""
R_SYSTEM_VENDOR=""
R_PRODUCT_NAME=""
R_PRODUCT_VERSION=""
R_BOARD_VENDOR=""
R_BOARD_NAME=""
HOST_FP=""
HOST_FP_TYPE=""
SCANNED_MATCHING_KEY=""
RESOLVED_IP=""

usage() {
  cat <<'EOF'
Usage: dgx-spark-health-check.sh [options]

  Run a DGX Spark acceptance test over SSH. It checks the purchased hardware,
  health signals, and short memory/disk/GPU exercises—not merely connectivity.

Options:
  --host HOST              mDNS name or address (DGX_HOST)
  --user USER              account from first boot (DGX_USER, default nvidia)
  --port PORT              SSH port (DGX_PORT, default 22)
  --identity FILE          private key path (DGX_IDENTITY)
  --timeout SECONDS        handshake timeout, 1-30 (DGX_TIMEOUT, default 5)
  --accept-new             store a new host key after you verify it
  --expect-fingerprint FP  require this SHA256 host-key fingerprint
  --expect-disk-tb N       purchased SSD size: 1 or 4 (default 1)
  --host-key-alias NAME    known_hosts identity (OpenSSH HostKeyAlias)
  --interactive            let ssh prompt for a password in this terminal
  --interactive-if-no-key  prompt only when no identity file is configured
  --prepare                install SMART, journal, RDMA, and PyTorch CUDA tools
  --strict                 fail on any hardware mismatch or health warning
  --config FILE            key=value file (default: ./dgx-spark.env if present)
  --color / --no-color     force or disable ANSI color
  -h, --help               show this help

The check writes and removes one 256 MiB temporary disk-test file. The memory
test touches 512 MiB. --prepare installs nvme-cli, smartmontools, PCI/RDMA
diagnostics and, when absent, PyTorch CUDA 13 in an isolated user environment.
It also grants the target account read-only journal membership; log out and
back in afterward.
Passwords are refused on the command line, environment, and config file.

SECURITY NOTES:
  --accept-new trusts the key seen on the network the first time.
  Compare the printed SHA256 fingerprint with the Spark console before using it.
  The script does not forward your agent, does not scan the LAN, does not
  read ~/.ssh/config, and does not print key material.
  --prepare requires sudo and never runs during a normal read-only check.
EOF
}

die_usage() {
  printf 'dgx-spark-health-check: %s\n' "$1" >&2
  printf 'Run with --help for usage.\n' >&2
  exit 2
}

now_ms() {
  perl -MTime::HiRes=time -e 'printf "%d\n", int(time()*1000)'
}

elapsed_since() {
  now_ms_value=$(now_ms)
  echo $((now_ms_value - $1))
}

fmt_ms() {
  ms=$1
  if [ "$ms" -ge 10000 ]; then
    printf '%ds' $((ms / 1000))
  elif [ "$ms" -ge 1000 ]; then
    printf '%d.%ds' $((ms / 1000)) $(((ms % 1000) / 100))
  else
    printf '%dms' "$ms"
  fi
}

trim() {
  printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

strip_quotes() {
  v=$(trim "$1")
  case "$v" in
    \"*\") v=${v#\"}; v=${v%\"} ;;
    \'*\') v=${v#\'}; v=${v%\'} ;;
  esac
  printf '%s' "$v"
}

expand_home() {
  case "$1" in
    \~/*) printf '%s/%s' "$HOME" "${1#\~/}" ;;
    \$HOME/*) printf '%s/%s' "$HOME" "${1#\$HOME/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

mode_is_shared() {
  mode=$1
  case "$mode" in
    [0-9][0-9][0-9][0-9]) mode=${mode#?} ;;
  esac
  case "$mode" in
    [0-9][0-9][0-9]) ;;
    *) return 1 ;;
  esac
  group=${mode#?}
  group=${group%?}
  others=${mode#??}
  if [ "$group" != "0" ] || [ "$others" != "0" ]; then
    return 0
  fi
  return 1
}

is_uint() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  return 0
}

parse_bool() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) echo 1 ;;
    0|false|no|off|'') echo 0 ;;
    *) echo invalid ;;
  esac
}

shorten() {
  text=$1
  max=$2
  if [ "${#text}" -le "$max" ]; then
    printf '%s' "$text"
    return
  fi
  if [ "$max" -le 1 ]; then
    printf '…'
    return
  fi
  printf '%s…' "${text:0:$((max - 1))}"
}

enable_color() {
  if [ "$USE_COLOR" -eq 1 ]; then
    C_RESET=$'\033[0m'
    C_BOLD=$'\033[1m'
    C_DIM=$'\033[2m'
    C_NV=$'\033[38;2;118;185;0m'
    C_OK=$'\033[38;2;118;185;0m'
    C_BAD=$'\033[38;2;255;92;92m'
    C_WARN=$'\033[38;2;242;184;75m'
    C_TEXT=$'\033[38;2;236;236;236m'
  else
    C_RESET=""
    C_BOLD=""
    C_DIM=""
    C_NV=""
    C_OK=""
    C_BAD=""
    C_WARN=""
    C_TEXT=""
  fi
}

hr() {
  printf '  %b' "$C_DIM"
  perl -e 'print "─" x shift' 68
  printf '%b\n' "$C_RESET"
}

print_row() {
  label=$1
  detail=$2
  ms=$3
  status=$4
  color=$C_DIM
  case "$status" in
    PASS) color=$C_OK ;;
    FAIL) color=$C_BAD ;;
    WARN|NOTE) color=$C_WARN ;;
  esac
  printf '  %b%-20s%b  %-26s  %6s   %b%s%b\n' \
    "$C_TEXT" "$(shorten "$label" 20)" "$C_RESET" \
    "$(shorten "$detail" 26)" \
    "$(fmt_ms "$ms")" \
    "$color" "$status" "$C_RESET"
}

add_note() {
  note_color=$C_WARN
  case "$1" in
    FAIL:*) note_color=$C_BAD ;;
    WARN:*) note_color=$C_WARN ;;
  esac
  NOTES="${NOTES}  ${note_color}· $1${C_RESET}
"
}

box_rule() {
  perl -e 'print "─" x 66'
}

text_len() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys; print(len(sys.argv[1]))' "$1"
    return
  fi
  printf '%s\n' "${#1}"
}

box_row() {
  plain=$1
  color=$2
  if [ "$(text_len "$plain")" -gt 66 ]; then
    plain=$(shorten "$plain" 66)
  fi
  pad=$((66 - $(text_len "$plain")))
  spaces=$(printf '%*s' "$pad" '')
  printf '  %b│%b%b%s%b%s%b│%b\n' \
    "$C_NV" "$C_RESET" "$color" "$plain" "$C_RESET" "$spaces" "$C_NV" "$C_RESET"
}

print_header() {
  target="${USER_NAME}@${HOST}:${PORT}"
  if [ -n "$IDENTITY" ]; then
    key_label=$(basename -- "$IDENTITY")
  else
    key_label="default key files"
  fi
  if [ "$INTERACTIVE" -eq 1 ]; then
    auth_label="key or terminal prompt"
  else
    auth_label="$key_label"
  fi
  rule=$(box_rule)
  printf '\n'
  printf '  %b┌%s┐%b\n' "$C_NV" "$rule" "$C_RESET"
  box_row "  ◆  DGX SPARK" "$C_BOLD$C_NV"
  box_row "  Hardware acceptance & health check" "$C_TEXT"
  box_row "" "$C_TEXT"
  box_row "  $(shorten "$target" 62)" "$C_TEXT"
  box_row "  $(shorten "auth  ${auth_label}" 62)" "$C_DIM"
  printf '  %b└%s┘%b\n' "$C_NV" "$rule" "$C_RESET"
  printf '\n'
  printf '  %b%-20s  %-26s  %6s   %s%b\n' \
    "$C_DIM" "CHECK" "DETAIL" "TIME" "STATUS" "$C_RESET"
  hr
}

print_field() {
  label=$1
  value=$2
  if [ -z "$value" ]; then
    return
  fi
  printf '  %b%-16s%b  %s\n' "$C_DIM" "$label" "$C_RESET" "$value"
}

print_section() {
  printf '\n  %b%s%b\n' "$C_BOLD$C_NV" "$1" "$C_RESET"
  hr
}

fmt_kib() {
  LC_ALL=C awk -v k="$1" 'BEGIN {
    k += 0
    if (k >= 1048576) printf "%.1f GiB", k / 1048576
    else if (k >= 1024) printf "%.1f MiB", k / 1024
    else printf "%d KiB", k
  }'
}

fmt_bytes() {
  LC_ALL=C awk -v b="$1" 'BEGIN {
    b += 0
    if (b >= 1099511627776) printf "%.1f TiB", b / 1099511627776
    else if (b >= 1073741824) printf "%.1f GiB", b / 1073741824
    else if (b >= 1048576) printf "%.1f MiB", b / 1048576
    else printf "%d B", b
  }'
}

fmt_uptime() {
  LC_ALL=C awk -v s="$1" 'BEGIN {
    s = int(s + 0)
    d = int(s / 86400); s = s % 86400
    h = int(s / 3600); s = s % 3600
    m = int(s / 60)
    if (d > 0) printf "%dd %dh %dm", d, h, m
    else if (h > 0) printf "%dh %dm", h, m
    else printf "%dm", m
  }'
}

finish() {
  code=$1
  total=$(elapsed_since "$STARTED_MS")
  if [ -n "$NOTES" ]; then
    print_section "Notes"
    printf '%s' "$NOTES"
  fi
  printf '\n'
  hr
  color=$C_BAD
  case "$VERDICT" in
    HEALTHY) color=$C_OK ;;
    ATTENTION) color=$C_WARN ;;
  esac
  printf '  %b%-16s%b  %b%s%b\n' "$C_DIM" "Result" "$C_RESET" "$C_BOLD$color" "$VERDICT" "$C_RESET"
  printf '  %b%-16s%b  %s transport checks, %s failed; %s hardware failures, %s warnings\n' \
    "$C_DIM" "Summary" "$C_RESET" "$CHECKS_TOTAL" "$CHECKS_FAIL" "$HW_FAILS" "$HW_WARNS"
  printf '  %b%-16s%b  %s\n' "$C_DIM" "Elapsed" "$C_RESET" "$(fmt_ms "$total")"
  if [ -n "$VERDICT_HINT" ]; then
    printf '  %b%-16s%b  %s\n' "$C_DIM" "Next" "$C_RESET" "$VERDICT_HINT"
  fi
  printf '  %b%-16s%b  %s\n\n' "$C_DIM" "When" "$C_RESET" "$(date '+%Y-%m-%d %H:%M')"
  exit "$code"
}

record_check() {
  CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
  if [ "$4" = "FAIL" ]; then
    CHECKS_FAIL=$((CHECKS_FAIL + 1))
  fi
  print_row "$1" "$2" "$3" "$4"
}

load_config() {
  file=$1
  if [ ! -f "$file" ]; then
    die_usage "config file not found: $file"
  fi
  if [ ! -r "$file" ]; then
    die_usage "config file is not readable: $file"
  fi
  mode=""
  mode=$(stat -f '%OLp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || true)
  if mode_is_shared "$mode"; then
    CONFIG_MODE_WARN=1
  fi
  line_no=0
  while IFS= read -r line || [ -n "$line" ]; do
    line_no=$((line_no + 1))
    trimmed=$(trim "$line")
    case "$trimmed" in
      ''|'#'*) continue ;;
    esac
    case "$trimmed" in
      *=*) ;;
      *) die_usage "config line $line_no is not key=value" ;;
    esac
    key=$(trim "${trimmed%%=*}")
    raw_val=${trimmed#*=}
    if [ "${#raw_val}" -gt 300 ]; then
      die_usage "config value for $key is too long"
    fi
    val=$(strip_quotes "$raw_val")
    case "$key" in
      DGX_PASSWORD|SSH_PASSWORD|PASSWORD)
        die_usage "config key $key is refused; use a key or --interactive"
        ;;
      DGX_HOST) FILE_HOST=$val ;;
      DGX_USER) FILE_USER=$val ;;
      DGX_PORT) FILE_PORT=$val ;;
      DGX_IDENTITY) FILE_IDENTITY=$(expand_home "$val") ;;
      DGX_TIMEOUT) FILE_TIMEOUT=$val ;;
      DGX_ACCEPT_NEW) FILE_ACCEPT_NEW=$val ;;
      DGX_STRICT) FILE_STRICT=$val ;;
      DGX_INTERACTIVE) FILE_INTERACTIVE=$val ;;
      DGX_EXPECT_FINGERPRINT) FILE_FINGERPRINT=$val ;;
      DGX_EXPECT_DISK_TB) FILE_EXPECT_DISK_TB=$val ;;
      DGX_HOST_KEY_ALIAS) FILE_HOST_KEY_ALIAS=$val ;;
      *) die_usage "unknown config key $key" ;;
    esac
  done < "$file"
}

validate_host() {
  case "$1" in
    ''|-*) die_usage "host contains unsupported characters" ;;
    *[!A-Za-z0-9._:\[\]-]*) die_usage "host contains unsupported characters" ;;
  esac
}

validate_user() {
  case "$1" in
    ''|-*|*[!a-zA-Z0-9._-]*)
      die_usage "user must be a plain account name"
      ;;
  esac
}

resolve_host() {
  name=$1
  case "$name" in
    [0-9]*.[0-9]*.[0-9]*.[0-9]*)
      printf '%s\n' "$name"
      return 0
      ;;
  esac
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$name" <<'PY'
import socket, sys
try:
    infos = socket.getaddrinfo(sys.argv[1], None)
except socket.gaierror:
    sys.exit(1)
print(infos[0][4][0])
PY
    return $?
  fi
  perl -MSocket -e '
    my $name = shift @ARGV;
    my ($err, @addrs) = Socket::getaddrinfo($name, "", {socktype => Socket::SOCK_STREAM()});
    exit 1 if $err || !@addrs;
    my ($e, $ip) = Socket::getnameinfo($addrs[0]->{addr}, Socket::NI_NUMERICHOST());
    exit 1 if $e;
    print "$ip\n";
  ' "$name"
}

tcp_open() {
  name=$1
  port=$2
  timeout=$3
  if command -v python3 >/dev/null 2>&1; then
    if python3 - "$name" "$port" "$timeout" <<'PY'
import socket, sys
host, port, timeout = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
try:
    with socket.create_connection((host, port), timeout=timeout):
        pass
except OSError:
    sys.exit(1)
PY
    then
      return 0
    fi
  fi
  if ! command -v nc >/dev/null 2>&1; then
    command -v python3 >/dev/null 2>&1 && return 1
    return 2
  fi
  if [ "$(uname -s)" = "Darwin" ]; then
    nc -z -G "$timeout" "$name" "$port" >/dev/null 2>&1
  else
    nc -z -w "$timeout" "$name" "$port" >/dev/null 2>&1
  fi
}

known_host_lookup() {
  if [ -n "$HOST_KEY_ALIAS" ]; then
    printf '%s' "$HOST_KEY_ALIAS"
  elif [ "$PORT" != "22" ]; then
    bare_host=${HOST#\[}
    bare_host=${bare_host%\]}
    printf '[%s]:%s' "$bare_host" "$PORT"
  else
    printf '%s' "$HOST"
  fi
}

# Return 0 when the exact host:port entry matches the live fingerprint,
# 1 when no entry exists, and 2 when a stale/different key exists.
host_key_status() {
  KNOWN_HOST_NAME=$(known_host_lookup)
  known_lines=$(ssh-keygen -F "$KNOWN_HOST_NAME" -f "$HOME/.ssh/known_hosts" 2>/dev/null |
    awk '!/^#/ && NF' || true)
  if [ -z "$known_lines" ]; then
    return 1
  fi
  known_fingerprints=$(printf '%s\n' "$known_lines" |
    ssh-keygen -lf - 2>/dev/null |
    awk '{print $2}' || true)
  for known_fp in $known_fingerprints; do
    if fingerprint_matches "$HOST_FP" "$known_fp"; then
      return 0
    fi
  done
  return 2
}

scan_fingerprint() {
  keys=$(ssh-keyscan -T "$TIMEOUT" -p "$PORT" -t ed25519,ecdsa,rsa "$HOST" 2>/dev/null || true)
  if [ -z "$keys" ]; then
    return 1
  fi
  fps=$(printf '%s\n' "$keys" | ssh-keygen -lf - 2>/dev/null || true)
  line=$(printf '%s\n' "$fps" | awk '/ED25519/ { print; exit }')
  if [ -z "$line" ]; then
    line=$(printf '%s\n' "$fps" | head -n 1)
  fi
  if [ -z "$line" ]; then
    return 1
  fi
  HOST_FP=$(printf '%s\n' "$line" | awk '{ print $2 }')
  HOST_FP_TYPE=$(printf '%s\n' "$line" | sed -n 's/.*(\([^)]*\)).*/\1/p')
  SCANNED_MATCHING_KEY=""
  while IFS= read -r key_line; do
    [ -n "$key_line" ] || continue
    key_fp=$(printf '%s\n' "$key_line" | ssh-keygen -lf - 2>/dev/null | awk '{print $2}')
    if [ -n "$key_fp" ] && fingerprint_matches "$HOST_FP" "$key_fp"; then
      SCANNED_MATCHING_KEY=$key_line
      break
    fi
  done <<EOF
$keys
EOF
  [ -n "$HOST_FP" ]
}

fingerprint_matches() {
  want=$1
  got=$2
  want=$(printf '%s' "$want" | tr '[:lower:]' '[:upper:]')
  got=$(printf '%s' "$got" | tr '[:lower:]' '[:upper:]')
  case "$want" in
    SHA256:*) ;;
    *) want="SHA256:$want" ;;
  esac
  [ "$want" = "$got" ]
}

replace_known_host_with_scanned_key() {
  [ -n "$KNOWN_HOST_NAME" ] && [ -n "$SCANNED_MATCHING_KEY" ] || return 1
  known_file="$HOME/.ssh/known_hosts"
  mkdir -p "$HOME/.ssh" || return 1
  chmod 700 "$HOME/.ssh" 2>/dev/null || true
  if [ ! -f "$known_file" ]; then
    (umask 077 && : >"$known_file") || return 1
  fi
  key_type=$(printf '%s\n' "$SCANNED_MATCHING_KEY" | awk '{print $2}')
  key_data=$(printf '%s\n' "$SCANNED_MATCHING_KEY" | awk '{print $3}')
  [ -n "$key_type" ] && [ -n "$key_data" ] || return 1
  ssh-keygen -R "$KNOWN_HOST_NAME" -f "$known_file" >/dev/null 2>&1 || return 1
  printf '%s %s %s\n' "$KNOWN_HOST_NAME" "$key_type" "$key_data" >>"$known_file" || return 1
  chmod 600 "$known_file" 2>/dev/null || true
  host_key_status
}

build_ssh_opts() {
  known="$HOME/.ssh/known_hosts"
  SSH_OPTS=(
    -F /dev/null
    -T
    -p "$PORT"
    -o "ConnectTimeout=${TIMEOUT}"
    -o ConnectionAttempts=1
    -o ForwardAgent=no
    -o ForwardX11=no
    -o ClearAllForwardings=yes
    -o LogLevel=ERROR
    -o ServerAliveInterval=2
    -o ServerAliveCountMax=2
    -o "UserKnownHostsFile=${known}"
    -o GlobalKnownHostsFile=/dev/null
  )
  if [ -n "$HOST_KEY_ALIAS" ]; then
    SSH_OPTS+=(-o "HostKeyAlias=${HOST_KEY_ALIAS}")
  fi
  if [ "$ACCEPT_NEW" -eq 1 ]; then
    SSH_OPTS+=(-o StrictHostKeyChecking=accept-new)
  else
    SSH_OPTS+=(-o StrictHostKeyChecking=yes)
  fi
  if [ "$INTERACTIVE" -eq 1 ]; then
    SSH_OPTS+=(
      -o BatchMode=no
      -o NumberOfPasswordPrompts=1
      -o PreferredAuthentications=publickey,keyboard-interactive,password
    )
  else
    SSH_OPTS+=(
      -o BatchMode=yes
      -o PreferredAuthentications=publickey
      -o IdentitiesOnly=yes
    )
  fi
  if [ -n "$IDENTITY" ]; then
    SSH_OPTS+=(-o IdentitiesOnly=yes -o "IdentityFile=${IDENTITY}")
  fi
}

classify_ssh_error() {
  err=$1
  if printf '%s' "$err" | grep -qi 'permission denied\|authentication failed'; then
    printf '%s' "authentication rejected"
  elif printf '%s' "$err" | grep -qi 'host key verification failed\|remote host identification'; then
    printf '%s' "host key rejected"
  elif printf '%s' "$err" | grep -qi 'could not resolve\|name or service not known\|nodename nor servname'; then
    printf '%s' "name did not resolve"
  elif printf '%s' "$err" | grep -qi 'connection refused'; then
    printf '%s' "connection refused"
  elif printf '%s' "$err" | grep -qi 'timed out\|timeout\|operation timed'; then
    printf '%s' "timed out"
  elif printf '%s' "$err" | grep -qi 'no route to host'; then
    printf '%s' "no route to host"
  elif printf '%s' "$err" | grep -qi 'connection reset\|connection closed'; then
    printf '%s' "connection closed"
  else
    one=$(printf '%s\n' "$err" | sed '/^$/d' | head -n 1)
    if [ -z "$one" ]; then
      one="ssh failed"
    fi
    shorten "$one" 26
    return
  fi
}

prepare_remote() {
  command -v base64 >/dev/null 2>&1 || {
    record_check "Preparation" "local base64 unavailable" "0ms" "FAIL"
    return 1
  }
  payload=$(base64 <<'REMOTE_PREPARE' | tr -d '\r\n'
set -euo pipefail
target_user=$1
id "$target_user" >/dev/null
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  nvme-cli \
  smartmontools \
  pciutils \
  rdma-core \
  python3-venv \
  python3-pip
target_home=$(getent passwd "$target_user" | cut -d: -f6)
torch_ready=0
for python_bin in \
  "$target_home/.local/share/mydgx/comfyui/venv/bin/python" \
  "$target_home/.local/share/mydgx/whisper/venv/bin/python" \
  /usr/bin/python3; do
  if [ -x "$python_bin" ] &&
     runuser -u "$target_user" -- "$python_bin" -c 'import torch' >/dev/null 2>&1; then
    torch_ready=1
    break
  fi
done
if [ "$torch_ready" -eq 0 ]; then
  venv="$target_home/.local/share/dgx-health-check/venv"
  install -d -o "$target_user" -g "$(id -gn "$target_user")" "$(dirname "$venv")"
  runuser -u "$target_user" -- python3 -m venv "$venv"
  runuser -u "$target_user" -- "$venv/bin/pip" install \
    --index-url https://download.pytorch.org/whl/cu130 torch
fi
if getent group systemd-journal >/dev/null 2>&1; then
  usermod -aG systemd-journal "$target_user"
fi
REMOTE_PREPARE
)
  start=$(now_ms)
  printf '%s\n' "Preparing the DGX; the CUDA-enabled PyTorch download can be several GB."
  if ssh "${SSH_OPTS[@]}" -tt -- "${USER_NAME}@${HOST}" \
    "printf '%s' '$payload' | base64 -d | sudo bash -s -- '$USER_NAME'"; then
    record_check "Preparation" "diagnostics installed" "$(elapsed_since "$start")" "PASS"
    add_note "Journal access may require logging out and back in once."
    return 0
  fi
  record_check "Preparation" "installation failed" "$(elapsed_since "$start")" "FAIL"
  VERDICT="PREPARATION FAILED"
  VERDICT_HINT="Review the APT or sudo error above; the normal check was not modified."
  return 1
}

run_remote() {
  out=$1
  err=$2
  ssh "${SSH_OPTS[@]}" -- "${USER_NAME}@${HOST}" bash -s >"$out" 2>"$err" <<'REMOTE'
set -u
PATH="/usr/local/cuda-13.0/bin:/usr/local/cuda-13/bin:/usr/local/cuda/bin:$PATH"
export PATH
emit() {
  v=$(printf '%s' "$2" | tr '\n|' '  ')
  printf 'DGXTEST|%s|%s\n' "$1" "$v"
}
host=$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo "")
fqdn=$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "")
emit hostname "$host"
emit fqdn "$fqdn"
emit kernel "$(uname -r 2>/dev/null || echo "")"
emit arch "$(uname -m 2>/dev/null || echo "")"
pretty=""
if [ -r /etc/os-release ]; then
  pretty=$(awk -F= '/^PRETTY_NAME=/{gsub(/"/,"",$2); print $2; exit}' /etc/os-release)
fi
emit os "$pretty"
read_dmi() {
  field=$1
  path="/sys/class/dmi/id/$field"
  if [ -r "$path" ]; then
    tr '\n|' '  ' < "$path" 2>/dev/null
  fi
}
emit system_vendor "$(read_dmi sys_vendor)"
emit product_name "$(read_dmi product_name)"
emit product_version "$(read_dmi product_version)"
emit board_vendor "$(read_dmi board_vendor)"
emit board_name "$(read_dmi board_name)"
dgx_name=""
dgx_ver=""
if [ -r /etc/dgx-release ]; then
  dgx_name=$(awk -F= '/^DGX_PRETTY_NAME=/{gsub(/"/,"",$2); print $2; exit}' /etc/dgx-release)
  if [ -z "$dgx_name" ]; then
    dgx_name=$(awk -F= '/^DGX_NAME=/{gsub(/"/,"",$2); print $2; exit}' /etc/dgx-release)
  fi
  dgx_ver=$(awk -F= '/^DGX_SWBUILD_VERSION=/{gsub(/"/,"",$2); print $2; exit}' /etc/dgx-release)
fi
emit dgx_name "$dgx_name"
emit dgx_version "$dgx_ver"
if [ -r /proc/uptime ]; then
  emit uptime_s "$(awk '{print int($1)}' /proc/uptime)"
fi
if [ -r /proc/loadavg ]; then
  emit load "$(awk '{print $1" "$2" "$3}' /proc/loadavg)"
fi
if [ -r /proc/meminfo ]; then
  emit mem_total_kb "$(awk '/^MemTotal:/{print $2}' /proc/meminfo)"
  emit mem_avail_kb "$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)"
fi
if command -v df >/dev/null 2>&1; then
  disk=$(df -B1 / 2>/dev/null | awk 'NR==2{printf "%s %s %s", $2, $3, $5}')
  if [ -z "$disk" ]; then
    disk=$(df -k / 2>/dev/null | awk 'NR==2{printf "%s %s %s", $2 * 1024, $3 * 1024, $5}')
  fi
  emit disk "$disk"
fi
root_device=$(findmnt -n -o SOURCE / 2>/dev/null || true)
emit root_device "$root_device"
if command -v lsblk >/dev/null 2>&1; then
  disks=$(lsblk -bdn -o NAME,MODEL,SIZE,ROTA,TYPE 2>/dev/null |
    awk '$5=="disk" {
      model=$2
      for(i=3;i<NF-2;i++) model=model" "$i
      printf "%s%s,%s,%s,%s", sep, $1, model, $(NF-2), $(NF-1)
      sep="; "
    }')
  emit disks "$disks"
fi
if [ -r /proc/cpuinfo ]; then
  cpu=$(awk -F: '/model name|Model|CPU part/{gsub(/^[ \t]+/,"",$2); if($2!=""){print $2; exit}}' /proc/cpuinfo)
  emit cpu "$cpu"
fi
if command -v nproc >/dev/null 2>&1; then
  emit ncpu "$(nproc)"
fi
ip_addr=""
if command -v hostname >/dev/null 2>&1; then
  ip_addr=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$ip_addr" ] && command -v ip >/dev/null 2>&1; then
  ip_addr=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
fi
emit ip "$ip_addr"

# Short memory exercise: allocate, write, and verify 512 MiB. This is not a
# substitute for an overnight memtest, but catches immediate allocation faults.
memory_test="SKIP:python3 unavailable"
if command -v python3 >/dev/null 2>&1; then
  memory_test=$(python3 - <<'PY' 2>/dev/null || true
import sys
size = 512 * 1024 * 1024
try:
    block = bytearray(size)
    for offset in range(0, size, 4096):
        block[offset] = (offset // 4096) & 0xff
    for offset in range(0, size, 4096):
        if block[offset] != ((offset // 4096) & 0xff):
            print("FAIL:data mismatch")
            sys.exit(0)
    print("PASS:512 MiB allocated and verified")
except Exception as exc:
    print("FAIL:" + type(exc).__name__)
PY
)
  [ -n "$memory_test" ] || memory_test="FAIL:no result"
fi
emit memory_test "$memory_test"

# Temporary sequential I/O check. The file is removed even if the test fails.
disk_test="SKIP:no writable home"
disk_write=""
disk_read=""
test_file="${HOME:-/tmp}/.dgx-health-$$.tmp"
cleanup_test_file() { rm -f "$test_file"; }
trap cleanup_test_file EXIT HUP INT TERM
if [ -d "${HOME:-}" ] && [ -w "${HOME:-}" ] && command -v dd >/dev/null 2>&1; then
  start_ns=$(date +%s%N 2>/dev/null || true)
  if [ "${#start_ns}" -ge 16 ] &&
     dd if=/dev/zero of="$test_file" bs=8M count=32 conv=fsync status=none 2>/dev/null; then
    end_ns=$(date +%s%N 2>/dev/null || true)
    elapsed_ns=$((end_ns - start_ns))
    if [ "$elapsed_ns" -gt 0 ]; then
      disk_write=$(awk -v n="$elapsed_ns" 'BEGIN{printf "%.0f", 268435456000/n}')
    fi
    start_ns=$(date +%s%N 2>/dev/null || true)
    if dd if="$test_file" of=/dev/null bs=8M iflag=direct status=none 2>/dev/null ||
       dd if="$test_file" of=/dev/null bs=8M status=none 2>/dev/null; then
      end_ns=$(date +%s%N 2>/dev/null || true)
      elapsed_ns=$((end_ns - start_ns))
      if [ "$elapsed_ns" -gt 0 ]; then
        disk_read=$(awk -v n="$elapsed_ns" 'BEGIN{printf "%.0f", 268435456000/n}')
      fi
      disk_test="PASS:256 MiB write/read completed"
    else
      disk_test="FAIL:read failed"
    fi
  else
    disk_test="FAIL:write failed"
  fi
fi
cleanup_test_file
trap - EXIT HUP INT TERM
emit disk_test "$disk_test"
emit disk_write_mbps "$disk_write"
emit disk_read_mbps "$disk_read"

if command -v nvidia-smi >/dev/null 2>&1; then
  if command -v timeout >/dev/null 2>&1; then
    csv=$(timeout 10 nvidia-smi --query-gpu=name,driver_version,temperature.gpu,utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -n 1 || true)
    cuda=$(timeout 10 nvidia-smi 2>/dev/null | awk -F'CUDA Version: ' 'NF>1{split($2,a," "); print a[1]; exit}' || true)
    listed=$(timeout 10 nvidia-smi -L 2>/dev/null | head -n 1 || true)
  else
    csv=$(nvidia-smi --query-gpu=name,driver_version,temperature.gpu,utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -n 1 || true)
    cuda=$(nvidia-smi 2>/dev/null | awk -F'CUDA Version: ' 'NF>1{split($2,a," "); print a[1]; exit}' || true)
    listed=$(nvidia-smi -L 2>/dev/null | head -n 1 || true)
  fi
  listed=$(printf '%s' "$listed" | sed 's/ (UUID:.*//')
  emit gpu_csv "$csv"
  emit cuda "$cuda"
  emit gpu_list "$listed"
fi

# Exercise CUDA using an existing PyTorch environment, or a tiny native CUDA
# kernel when nvcc is available.
gpu_test="SKIP:PyTorch unavailable"
gpu_test_detail=""
gpu_python=""
for candidate in \
  "$HOME/.local/share/dgx-health-check/venv/bin/python" \
  "$HOME/.local/share/mydgx/comfyui/venv/bin/python" \
  "$HOME/.local/share/mydgx/whisper/venv/bin/python" \
  "$(command -v python3 2>/dev/null || true)"; do
  [ -n "$candidate" ] && [ -x "$candidate" ] || continue
  if "$candidate" -c 'import torch' >/dev/null 2>&1; then
    gpu_python=$candidate
    break
  fi
done
if [ -n "$gpu_python" ]; then
  gpu_result=$("$gpu_python" - <<'PY' 2>/dev/null || true
try:
    import torch
except Exception:
    print("SKIP:PyTorch unavailable")
    raise SystemExit
try:
    if not torch.cuda.is_available():
        print("FAIL:CUDA unavailable")
        raise SystemExit
    a = torch.randn((2048, 2048), device="cuda")
    b = torch.randn((2048, 2048), device="cuda")
    c = a @ b
    torch.cuda.synchronize()
    if not bool(torch.isfinite(c).all().item()):
        print("FAIL:non-finite matrix result")
    else:
        print("PASS:" + torch.cuda.get_device_name(0))
except Exception as exc:
    print("FAIL:" + type(exc).__name__)
PY
)
  [ -n "$gpu_result" ] && gpu_test=$gpu_result
elif command -v nvcc >/dev/null 2>&1; then
  cuda_tmp=$(mktemp -d 2>/dev/null || true)
  if [ -n "$cuda_tmp" ]; then
    cat >"$cuda_tmp/test.cu" <<'CUDA'
#include <cuda_runtime.h>
#include <cstdio>
__global__ void add(const float *a, const float *b, float *c) {
  if (threadIdx.x == 0) *c = *a + *b;
}
int main() {
  float a = 1.0f, b = 2.0f, c = 0.0f;
  float *da = nullptr, *db = nullptr, *dc = nullptr;
  if (cudaMalloc(&da, sizeof(float)) != cudaSuccess ||
      cudaMalloc(&db, sizeof(float)) != cudaSuccess ||
      cudaMalloc(&dc, sizeof(float)) != cudaSuccess) return 2;
  if (cudaMemcpy(da, &a, sizeof(float), cudaMemcpyHostToDevice) != cudaSuccess ||
      cudaMemcpy(db, &b, sizeof(float), cudaMemcpyHostToDevice) != cudaSuccess) return 3;
  add<<<1, 1>>>(da, db, dc);
  if (cudaDeviceSynchronize() != cudaSuccess ||
      cudaMemcpy(&c, dc, sizeof(float), cudaMemcpyDeviceToHost) != cudaSuccess) return 4;
  cudaFree(da); cudaFree(db); cudaFree(dc);
  return c == 3.0f ? 0 : 5;
}
CUDA
    if nvcc -O2 "$cuda_tmp/test.cu" -o "$cuda_tmp/test" >/dev/null 2>&1 &&
       "$cuda_tmp/test" >/dev/null 2>&1; then
      gpu_test="PASS:native CUDA kernel"
    else
      gpu_test="FAIL:native CUDA kernel"
    fi
    rm -rf "$cuda_tmp"
  fi
fi
gpu_test_detail=${gpu_test#*:}
emit gpu_test "$gpu_test"
emit gpu_test_detail "$gpu_test_detail"

# Kernel/driver errors since boot. Reading the journal may be restricted.
xid_errors="unknown"
system_errors="unknown"
if command -v journalctl >/dev/null 2>&1; then
  if kernel_log=$(journalctl -k -b --no-pager -q 2>/dev/null) ||
     kernel_log=$(sudo -n journalctl -k -b --no-pager -q 2>/dev/null); then
    xid_errors=$(printf '%s\n' "$kernel_log" |
      grep -Eic 'NVRM:.*Xid|NVIDIA.*Xid' || true)
  fi
  if error_log=$(journalctl -b -p 0..3 --no-pager -q 2>/dev/null) ||
     error_log=$(sudo -n journalctl -b -p 0..3 --no-pager -q 2>/dev/null); then
    system_errors=$(printf '%s\n' "$error_log" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')
  fi
fi
emit xid_errors "$xid_errors"
emit system_errors "$system_errors"

# Highest readable thermal-zone temperature.
max_temp=""
max_label=""
for zone in /sys/class/thermal/thermal_zone*; do
  [ -r "$zone/temp" ] || continue
  value=$(cat "$zone/temp" 2>/dev/null || true)
  case "$value" in ''|*[!0-9]*) continue ;; esac
  c=$(awk -v v="$value" 'BEGIN{if(v>1000)v/=1000; printf "%.0f",v}')
  if [ -z "$max_temp" ] || [ "$c" -gt "$max_temp" ]; then
    max_temp=$c
    max_label=$(cat "$zone/type" 2>/dev/null || echo thermal)
  fi
done
emit max_temp "$max_temp"
emit max_temp_label "$max_label"

# NVMe health is reported when nvme-cli is installed and readable without sudo.
nvme_health="SKIP:nvme-cli unavailable"
nvme_critical=""
nvme_media_errors=""
nvme_temp=""
nvme_model=""
nvme_serial=""
nvme_firmware=""
nvme_spare=""
nvme_spare_threshold=""
nvme_percent_used=""
nvme_data_read=""
nvme_data_written=""
nvme_busy_minutes=""
nvme_power_cycles=""
nvme_power_hours=""
nvme_unsafe_shutdowns=""
nvme_error_entries=""
if command -v nvme >/dev/null 2>&1; then
  nvme_health="SKIP:SMART requires elevated NVMe permission"
  nvme_dev=$(ls /dev/nvme[0-9] 2>/dev/null | head -n 1 || true)
  if [ -n "$nvme_dev" ]; then
    smart=$(nvme smart-log "$nvme_dev" 2>/dev/null || true)
    nvme_sudo=0
    if [ -z "$smart" ] && command -v sudo >/dev/null 2>&1; then
      smart=$(sudo -n nvme smart-log "$nvme_dev" 2>/dev/null || true)
      [ -z "$smart" ] || nvme_sudo=1
    fi
    if [ -n "$smart" ]; then
      nvme_critical=$(printf '%s\n' "$smart" | awk -F: '/^critical_warning/{gsub(/[[:space:]]/,"",$2); print $2; exit}')
      nvme_media_errors=$(printf '%s\n' "$smart" | awk -F: '/^media_errors/{gsub(/[,.[:space:]]/,"",$2); print $2; exit}')
      nvme_temp=$(printf '%s\n' "$smart" | awk -F: '/^temperature/{if(match($2,/[0-9]+/)) print substr($2,RSTART,RLENGTH); exit}')
      nvme_spare=$(printf '%s\n' "$smart" | awk -F: '/^available_spare[[:space:]]/{if(match($2,/[0-9]+/)) print substr($2,RSTART,RLENGTH); exit}')
      nvme_spare_threshold=$(printf '%s\n' "$smart" | awk -F: '/^available_spare_threshold/{if(match($2,/[0-9]+/)) print substr($2,RSTART,RLENGTH); exit}')
      nvme_percent_used=$(printf '%s\n' "$smart" | awk -F: '/^percentage_used/{if(match($2,/[0-9]+/)) print substr($2,RSTART,RLENGTH); exit}')
      nvme_data_read=$(printf '%s\n' "$smart" | awk -F: '/^Data Units Read/{value=$2; sub(/^[^(]*\\(/,"",value); sub(/\\).*/,"",value); gsub(/^[[:space:]]+|[[:space:]]+$/,"",value); print value; exit}')
      nvme_data_written=$(printf '%s\n' "$smart" | awk -F: '/^Data Units Written/{value=$2; sub(/^[^(]*\\(/,"",value); sub(/\\).*/,"",value); gsub(/^[[:space:]]+|[[:space:]]+$/,"",value); print value; exit}')
      nvme_busy_minutes=$(printf '%s\n' "$smart" | awk -F: '/^controller_busy_time/{gsub(/[,.[:space:]]/,"",$2); print $2; exit}')
      nvme_power_cycles=$(printf '%s\n' "$smart" | awk -F: '/^power_cycles/{gsub(/[,.[:space:]]/,"",$2); print $2; exit}')
      nvme_power_hours=$(printf '%s\n' "$smart" | awk -F: '/^power_on_hours/{gsub(/[,.[:space:]]/,"",$2); print $2; exit}')
      nvme_unsafe_shutdowns=$(printf '%s\n' "$smart" | awk -F: '/^unsafe_shutdowns/{gsub(/[,.[:space:]]/,"",$2); print $2; exit}')
      nvme_error_entries=$(printf '%s\n' "$smart" | awk -F: '/^num_err_log_entries/{gsub(/[,.[:space:]]/,"",$2); print $2; exit}')
      if [ "$nvme_sudo" -eq 1 ]; then
        identity=$(sudo -n nvme id-ctrl "$nvme_dev" 2>/dev/null || true)
      else
        identity=$(nvme id-ctrl "$nvme_dev" 2>/dev/null || true)
      fi
      nvme_model=$(printf '%s\n' "$identity" | awk -F: '/^mn[[:space:]]*:/{sub(/^[[:space:]]+/,"",$2); print $2; exit}')
      nvme_serial=$(printf '%s\n' "$identity" | awk -F: '/^sn[[:space:]]*:/{sub(/^[[:space:]]+/,"",$2); print $2; exit}')
      nvme_firmware=$(printf '%s\n' "$identity" | awk -F: '/^fr[[:space:]]*:/{sub(/^[[:space:]]+/,"",$2); print $2; exit}')
      nvme_health="PASS:SMART log readable"
      [ "$nvme_sudo" -eq 0 ] || nvme_health="PASS:SMART log readable via sudo -n"
      case "$nvme_critical" in 0|0x0|0x00|'') ;; *) nvme_health="FAIL:critical warning $nvme_critical" ;; esac
      case "$nvme_media_errors" in 0|'') ;; *) nvme_health="FAIL:$nvme_media_errors media errors" ;; esac
    fi
  else
    nvme_health="SKIP:no NVMe controller device found"
  fi
fi
emit nvme_health "$nvme_health"
emit nvme_critical "$nvme_critical"
emit nvme_media_errors "$nvme_media_errors"
emit nvme_temp "$nvme_temp"
emit nvme_model "$nvme_model"
emit nvme_serial "$nvme_serial"
emit nvme_firmware "$nvme_firmware"
emit nvme_spare "$nvme_spare"
emit nvme_spare_threshold "$nvme_spare_threshold"
emit nvme_percent_used "$nvme_percent_used"
emit nvme_data_read "$nvme_data_read"
emit nvme_data_written "$nvme_data_written"
emit nvme_busy_minutes "$nvme_busy_minutes"
emit nvme_power_cycles "$nvme_power_cycles"
emit nvme_power_hours "$nvme_power_hours"
emit nvme_unsafe_shutdowns "$nvme_unsafe_shutdowns"
emit nvme_error_entries "$nvme_error_entries"
REMOTE
}

parse_remote() {
  file=$1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      DGXTEST\|*) ;;
      *) continue ;;
    esac
    rest=${line#DGXTEST|}
    key=${rest%%|*}
    val=${rest#*|}
    case "$key" in
      hostname) R_HOSTNAME=$val ;;
      fqdn) R_FQDN=$val ;;
      kernel) R_KERNEL=$val ;;
      arch) R_ARCH=$val ;;
      os) R_OS=$val ;;
      dgx_name) R_DGX_NAME=$val ;;
      dgx_version) R_DGX_VERSION=$val ;;
      uptime_s) R_UPTIME=$val ;;
      load) R_LOAD=$val ;;
      mem_total_kb) R_MEM_TOTAL=$val ;;
      mem_avail_kb) R_MEM_AVAIL=$val ;;
      disk) R_DISK=$val ;;
      cpu) R_CPU=$val ;;
      ncpu) R_NCPU=$val ;;
      ip) R_IP=$val ;;
      gpu_csv) R_GPU_CSV=$val ;;
      cuda) R_CUDA=$val ;;
      gpu_list) R_GPU_LIST=$val ;;
      disks) R_DISKS=$val ;;
      root_device) R_ROOT_DEVICE=$val ;;
      nvme_health) R_NVME_HEALTH=$val ;;
      nvme_critical) R_NVME_CRITICAL=$val ;;
      nvme_media_errors) R_NVME_MEDIA_ERRORS=$val ;;
      nvme_temp) R_NVME_TEMP=$val ;;
      nvme_model) R_NVME_MODEL=$val ;;
      nvme_serial) R_NVME_SERIAL=$val ;;
      nvme_firmware) R_NVME_FIRMWARE=$val ;;
      nvme_spare) R_NVME_SPARE=$val ;;
      nvme_spare_threshold) R_NVME_SPARE_THRESHOLD=$val ;;
      nvme_percent_used) R_NVME_PERCENT_USED=$val ;;
      nvme_data_read) R_NVME_DATA_READ=$val ;;
      nvme_data_written) R_NVME_DATA_WRITTEN=$val ;;
      nvme_busy_minutes) R_NVME_BUSY_MINUTES=$val ;;
      nvme_power_cycles) R_NVME_POWER_CYCLES=$val ;;
      nvme_power_hours) R_NVME_POWER_HOURS=$val ;;
      nvme_unsafe_shutdowns) R_NVME_UNSAFE_SHUTDOWNS=$val ;;
      nvme_error_entries) R_NVME_ERROR_ENTRIES=$val ;;
      disk_write_mbps) R_DISK_WRITE_MBPS=$val ;;
      disk_read_mbps) R_DISK_READ_MBPS=$val ;;
      disk_test) R_DISK_TEST=$val ;;
      memory_test) R_MEMORY_TEST=$val ;;
      gpu_test) R_GPU_TEST=$val ;;
      gpu_test_detail) R_GPU_TEST_DETAIL=$val ;;
      xid_errors) R_XID_ERRORS=$val ;;
      system_errors) R_SYSTEM_ERRORS=$val ;;
      max_temp) R_MAX_TEMP=$val ;;
      max_temp_label) R_MAX_TEMP_LABEL=$val ;;
      system_vendor) R_SYSTEM_VENDOR=$val ;;
      product_name) R_PRODUCT_NAME=$val ;;
      product_version) R_PRODUCT_VERSION=$val ;;
      board_vendor) R_BOARD_VENDOR=$val ;;
      board_name) R_BOARD_NAME=$val ;;
    esac
  done < "$file"
}

gpu_name() {
  if [ -n "$R_GPU_CSV" ]; then
    printf '%s' "$R_GPU_CSV" | awk -F, '{gsub(/^[ \t]+|[ \t]+$/, "", $1); print $1}'
    return
  fi
  if [ -n "$R_GPU_LIST" ]; then
    printf '%s' "$R_GPU_LIST" | sed 's/^GPU [0-9]*: //'
    return
  fi
  printf '%s' ""
}

HW_FAILS=0
HW_WARNS=0

hardware_fail() {
  HW_FAILS=$((HW_FAILS + 1))
  add_note "FAIL: $1"
}

hardware_warn() {
  HW_WARNS=$((HW_WARNS + 1))
  add_note "WARN: $1"
}

is_number() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  return 0
}

assess_spark() {
  name=$(gpu_name)
  identity="$(trim "$R_SYSTEM_VENDOR") $(trim "$R_PRODUCT_NAME")"
  case "$identity" in
    *NVIDIA*DGX*Spark*|*Nvidia*DGX*Spark*|*nvidia*DGX*Spark*|\
    *ASUSTeK*GX10*|*ASUS*GX10*|\
    *HP*ZGX*Nano*|*HP*ZGX*|\
    *LENOVO*ThinkStation*PGX*|*Lenovo*ThinkStation*PGX*)
      ;;
    ' ')
      hardware_warn "DMI manufacturer/model are unavailable; the GB10 system model cannot be verified."
      ;;
    *)
      case "$name" in
        *GB10*)
          hardware_warn "System identity '${identity}' is not in the known DGX Spark-class OEM model list."
          ;;
        *)
          hardware_fail "System identity '${identity}' is not a recognized DGX Spark-class system."
          SPARK_MISMATCH=1
          ;;
      esac
  esac
  if [ "$R_ARCH" != "aarch64" ]; then
    hardware_fail "CPU architecture is ${R_ARCH:-unknown}; DGX Spark must be aarch64."
    SPARK_MISMATCH=1
  fi
  dgx_blob="${R_DGX_NAME} ${R_DGX_VERSION} ${R_OS}"
  case "$dgx_blob" in
    *[Ss]park*|*[Dd][Gg][Xx]*) ;;
    *)
      hardware_warn "DGX Spark release was not found in /etc/dgx-release."
      SPARK_MISMATCH=1
      ;;
  esac
  case "$name" in
    *GB10*) ;;
    '')
      hardware_fail "nvidia-smi did not report the GPU."
      SPARK_MISMATCH=1
      ;;
    *)
      hardware_fail "GPU is ${name}; a DGX Spark must report NVIDIA GB10."
      SPARK_MISMATCH=1
      ;;
  esac

  # 128 GB unified memory appears somewhat smaller as Linux MemTotal.
  if ! is_number "$R_MEM_TOTAL"; then
    hardware_fail "Total memory could not be read."
  elif [ "$R_MEM_TOTAL" -lt 120000000 ]; then
    hardware_fail "Only $(fmt_kib "$R_MEM_TOTAL") RAM is visible; expected about 128 GB unified memory."
  fi

  if [ -n "$R_DISK" ]; then
    set -- $R_DISK
    disk_total=${1:-0}
    disk_used_pct=${3:-0}
    disk_used_pct=${disk_used_pct%\%}
    expected_floor=$((EXPECT_DISK_TB * 800000000000))
    if is_number "$disk_total" && [ "$disk_total" -lt "$expected_floor" ]; then
      hardware_fail "Root storage is $(fmt_bytes "$disk_total"); expected the purchased ${EXPECT_DISK_TB} TB-class SSD."
    fi
    if is_number "$disk_used_pct"; then
      if [ "$disk_used_pct" -ge 90 ]; then
        hardware_fail "Root filesystem is ${disk_used_pct}% full."
      elif [ "$disk_used_pct" -ge 80 ]; then
        hardware_warn "Root filesystem is ${disk_used_pct}% full."
      fi
    fi
  else
    hardware_fail "Root filesystem capacity could not be read."
  fi

  case "$R_MEMORY_TEST" in
    PASS:*) ;;
    FAIL:*) hardware_fail "Memory exercise: ${R_MEMORY_TEST#FAIL:}" ;;
    *) hardware_warn "Memory exercise was not completed (${R_MEMORY_TEST:-no result})." ;;
  esac
  case "$R_DISK_TEST" in
    PASS:*) ;;
    FAIL:*) hardware_fail "Disk exercise: ${R_DISK_TEST#FAIL:}" ;;
    *) hardware_warn "Disk exercise was not completed (${R_DISK_TEST:-no result})." ;;
  esac
  if is_number "$R_DISK_WRITE_MBPS" && [ "$R_DISK_WRITE_MBPS" -lt 100 ]; then
    hardware_warn "Sequential write result is low (${R_DISK_WRITE_MBPS} MB/s); retest while the system is idle."
  fi
  if is_number "$R_DISK_READ_MBPS" && [ "$R_DISK_READ_MBPS" -lt 100 ]; then
    hardware_warn "Sequential read result is low (${R_DISK_READ_MBPS} MB/s); retest while the system is idle."
  fi

  case "$R_GPU_TEST" in
    PASS:*) ;;
    FAIL:*) hardware_fail "CUDA compute exercise: ${R_GPU_TEST#FAIL:}" ;;
    *) hardware_warn "CUDA compute was not exercised because neither PyTorch nor nvcc is available." ;;
  esac

  temp=$(printf '%s' "$R_GPU_CSV" | awk -F, '{gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3}')
  if is_number "$temp"; then
    if [ "$temp" -ge 90 ]; then
      hardware_fail "GPU temperature is ${temp} C."
    elif [ "$temp" -ge 80 ]; then
      hardware_warn "GPU temperature is high (${temp} C)."
    fi
  fi
  if is_number "$R_MAX_TEMP"; then
    if [ "$R_MAX_TEMP" -ge 95 ]; then
      hardware_fail "Maximum system temperature is ${R_MAX_TEMP} C (${R_MAX_TEMP_LABEL})."
    elif [ "$R_MAX_TEMP" -ge 85 ]; then
      hardware_warn "Maximum system temperature is ${R_MAX_TEMP} C (${R_MAX_TEMP_LABEL})."
    fi
  fi
  if is_number "$R_XID_ERRORS" && [ "$R_XID_ERRORS" -gt 0 ]; then
    hardware_fail "The kernel journal contains ${R_XID_ERRORS} NVIDIA Xid GPU error(s)."
  elif [ "$R_XID_ERRORS" = "unknown" ]; then
    hardware_warn "The kernel journal was not readable, so NVIDIA Xid errors were not checked."
  fi
  if is_number "$R_SYSTEM_ERRORS" && [ "$R_SYSTEM_ERRORS" -gt 0 ]; then
    hardware_warn "The current boot journal contains ${R_SYSTEM_ERRORS} error-level message(s); inspect them with journalctl -b -p 0..3."
  fi
  case "$R_NVME_HEALTH" in
    PASS:*) ;;
    FAIL:*) hardware_fail "NVMe health: ${R_NVME_HEALTH#FAIL:}" ;;
    SKIP:*) hardware_warn "NVMe SMART was not checked: ${R_NVME_HEALTH#SKIP:}." ;;
    *) hardware_warn "NVMe SMART was not checked." ;;
  esac
  if is_number "$R_NVME_PERCENT_USED" && [ "$R_NVME_PERCENT_USED" -ge 90 ]; then
    hardware_warn "NVMe endurance is ${R_NVME_PERCENT_USED}% used."
  fi
  if is_number "$R_NVME_TEMP" && [ "$R_NVME_TEMP" -ge 70 ]; then
    hardware_warn "NVMe temperature is high at ${R_NVME_TEMP} C."
  fi
  if is_number "$R_NVME_ERROR_ENTRIES" && [ "$R_NVME_ERROR_ENTRIES" -gt 0 ]; then
    hardware_warn "NVMe reports ${R_NVME_ERROR_ENTRIES} controller error-log entries."
  fi
  if is_number "$R_NVME_UNSAFE_SHUTDOWNS" &&
     is_number "$R_NVME_POWER_CYCLES" &&
     [ "$R_NVME_UNSAFE_SHUTDOWNS" -ge 10 ] &&
     [ $((R_NVME_UNSAFE_SHUTDOWNS * 4)) -gt "$R_NVME_POWER_CYCLES" ]; then
    hardware_warn "NVMe has ${R_NVME_UNSAFE_SHUTDOWNS} unsafe shutdowns across ${R_NVME_POWER_CYCLES} power cycles."
  elif is_number "$R_NVME_UNSAFE_SHUTDOWNS" && [ "$R_NVME_UNSAFE_SHUTDOWNS" -gt 0 ]; then
    add_note "NVMe lifetime records ${R_NVME_UNSAFE_SHUTDOWNS} unsafe shutdown(s); monitor whether this increases."
  fi
}

format_hours() {
  value=$1
  if ! is_number "$value"; then
    printf '%s' "$value"
    return
  fi
  days=$((value / 24))
  hours=$((value % 24))
  if [ "$days" -gt 0 ]; then
    printf '%sd %sh (%sh total)' "$days" "$hours" "$value"
  else
    printf '%sh' "$hours"
  fi
}

format_minutes() {
  value=$1
  if ! is_number "$value"; then
    printf '%s' "$value"
    return
  fi
  hours=$((value / 60))
  minutes=$((value % 60))
  printf '%sh %sm (%sm total)' "$hours" "$minutes" "$value"
}

print_system() {
  print_section "System"
  print_field "Manufacturer" "$(trim "$R_SYSTEM_VENDOR")"
  print_field "Product" "$(trim "$R_PRODUCT_NAME")"
  print_field "Product version" "$(trim "$R_PRODUCT_VERSION")"
  if [ -n "$R_BOARD_VENDOR" ] || [ -n "$R_BOARD_NAME" ]; then
    print_field "Mainboard" "$(trim "$R_BOARD_VENDOR") $(trim "$R_BOARD_NAME")"
  fi
  print_field "Hostname" "${R_FQDN:-$R_HOSTNAME}"
  if [ -n "$R_DGX_NAME" ] || [ -n "$R_DGX_VERSION" ]; then
    print_field "DGX OS" "$(trim "${R_DGX_NAME} ${R_DGX_VERSION}")"
  fi
  print_field "OS" "$R_OS"
  print_field "Kernel" "$R_KERNEL"
  print_field "Arch" "$R_ARCH"
  if [ -n "$R_CPU" ] || [ -n "$R_NCPU" ]; then
    cpu_line=$R_CPU
    if [ -n "$R_NCPU" ]; then
      if [ -n "$cpu_line" ]; then
        cpu_line="$cpu_line · ${R_NCPU} threads"
      else
        cpu_line="${R_NCPU} threads"
      fi
    fi
    print_field "CPU" "$cpu_line"
  fi
  if [ -n "$R_MEM_TOTAL" ]; then
    mem_line=$(fmt_kib "$R_MEM_TOTAL")
    case "$(gpu_name) ${R_DGX_NAME}" in
      *GB10*|*Spark*|*spark*) mem_line="$mem_line unified" ;;
    esac
    if [ -n "$R_MEM_AVAIL" ]; then
      mem_line="$(fmt_kib "$R_MEM_AVAIL") free of $mem_line"
    fi
    print_field "Memory" "$mem_line"
  fi
  if [ -n "$R_DISK" ]; then
    set -- $R_DISK
    if [ $# -ge 3 ]; then
      print_field "Disk /" "$(fmt_bytes "$2") used of $(fmt_bytes "$1") ($3)"
    fi
  fi
  print_field "Load" "$R_LOAD"
  if [ -n "$R_UPTIME" ]; then
    print_field "Uptime" "$(fmt_uptime "$R_UPTIME")"
  fi
  print_field "Address" "$R_IP"
  if [ -n "$HOST_FP" ]; then
    print_field "Host key" "${HOST_FP}  ${HOST_FP_TYPE}"
  fi

  print_section "GPU"
  name=$(gpu_name)
  print_field "Name" "${name:-not reported}"
  if [ -n "$R_GPU_CSV" ]; then
    driver=$(printf '%s' "$R_GPU_CSV" | awk -F, '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}')
    temp=$(printf '%s' "$R_GPU_CSV" | awk -F, '{gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3}')
    util=$(printf '%s' "$R_GPU_CSV" | awk -F, '{gsub(/^[ \t]+|[ \t]+$/, "", $4); print $4}')
    print_field "Driver" "$driver"
    if [ -n "$temp" ] && [ "$temp" != "[N/A]" ] && [ "$temp" != "N/A" ]; then
      print_field "Temperature" "${temp} C"
    fi
    if [ -n "$util" ] && [ "$util" != "[N/A]" ] && [ "$util" != "N/A" ]; then
      print_field "Utilization" "${util}%"
    fi
  elif [ -n "$R_GPU_LIST" ]; then
    print_field "Probe" "$R_GPU_LIST"
  fi
  print_field "CUDA" "$R_CUDA"
  case "$name" in
    *GB10*) print_field "Memory" "unified Grace pool (nvidia-smi shows N/A)" ;;
  esac

  print_section "Storage"
  print_field "Root device" "$R_ROOT_DEVICE"
  print_field "Physical disks" "$R_DISKS"
  if [ -n "$R_DISK_WRITE_MBPS" ]; then
    print_field "Write test" "${R_DISK_WRITE_MBPS} MB/s (256 MiB, synced)"
  fi
  if [ -n "$R_DISK_READ_MBPS" ]; then
    print_field "Read test" "${R_DISK_READ_MBPS} MB/s (256 MiB)"
  fi
  print_field "NVMe SMART" "$R_NVME_HEALTH"
  if [ -n "$R_NVME_MODEL" ]; then
    print_field "NVMe model" "$R_NVME_MODEL"
  fi
  if [ -n "$R_NVME_SERIAL" ] || [ -n "$R_NVME_FIRMWARE" ]; then
    print_field "Serial / firmware" "${R_NVME_SERIAL:-unknown} / ${R_NVME_FIRMWARE:-unknown}"
  fi
  if [ -n "$R_NVME_TEMP" ]; then
    print_field "NVMe temp" "${R_NVME_TEMP} C"
  fi
  if [ -n "$R_NVME_PERCENT_USED" ] || [ -n "$R_NVME_SPARE" ]; then
    print_field "Wear / spare" "${R_NVME_PERCENT_USED:-unknown}% used / ${R_NVME_SPARE:-unknown}% spare (threshold ${R_NVME_SPARE_THRESHOLD:-unknown}%)"
  fi
  if [ -n "$R_NVME_POWER_HOURS" ]; then
    print_field "Power-on time" "$(format_hours "$R_NVME_POWER_HOURS")"
  fi
  if [ -n "$R_NVME_BUSY_MINUTES" ]; then
    print_field "Controller busy" "$(format_minutes "$R_NVME_BUSY_MINUTES")"
  fi
  if [ -n "$R_NVME_POWER_CYCLES" ] || [ -n "$R_NVME_UNSAFE_SHUTDOWNS" ]; then
    print_field "Power cycles" "${R_NVME_POWER_CYCLES:-unknown} (${R_NVME_UNSAFE_SHUTDOWNS:-unknown} unsafe shutdowns)"
  fi
  if [ -n "$R_NVME_DATA_READ" ] || [ -n "$R_NVME_DATA_WRITTEN" ]; then
    print_field "Lifetime I/O" "${R_NVME_DATA_READ:-unknown} read / ${R_NVME_DATA_WRITTEN:-unknown} written"
  fi
  if [ -n "$R_NVME_MEDIA_ERRORS" ]; then
    print_field "Media errors" "$R_NVME_MEDIA_ERRORS"
  fi
  if [ -n "$R_NVME_ERROR_ENTRIES" ]; then
    print_field "Error log entries" "$R_NVME_ERROR_ENTRIES"
  fi

  print_section "Exercises & errors"
  print_field "Memory" "$R_MEMORY_TEST"
  print_field "Disk I/O" "$R_DISK_TEST"
  print_field "CUDA compute" "$R_GPU_TEST"
  if [ -n "$R_MAX_TEMP" ]; then
    print_field "Max system temp" "${R_MAX_TEMP} C (${R_MAX_TEMP_LABEL})"
  fi
  print_field "NVIDIA Xid" "$R_XID_ERRORS"
  print_field "Boot errors" "$R_SYSTEM_ERRORS"
}

run_client() {
  start=$(now_ms)
  if ! command -v ssh >/dev/null 2>&1; then
    record_check "OpenSSH client" "not installed" "$(elapsed_since "$start")" "FAIL"
    VERDICT="FAILED"
    VERDICT_HINT="Install OpenSSH (ssh) on this machine and run the test again."
    return 1
  fi
  ver=$(ssh -V 2>&1 || true)
  short=$(printf '%s\n' "$ver" | awk -F, '{print $1}')
  record_check "OpenSSH client" "${short:-present}" "$(elapsed_since "$start")" "PASS"
  return 0
}

run_resolve() {
  start=$(now_ms)
  if ! RESOLVED_IP=$(resolve_host "$HOST"); then
    record_check "Name resolution" "no address" "$(elapsed_since "$start")" "FAIL"
    VERDICT="UNREACHABLE"
    VERDICT_HINT="Use the spark-xxxx.local name from the display, or pass the Spark IP."
    return 1
  fi
  record_check "Name resolution" "$RESOLVED_IP" "$(elapsed_since "$start")" "PASS"
  return 0
}

run_ping() {
  if ! command -v ping >/dev/null 2>&1; then
    return 0
  fi
  start=$(now_ms)
  if [ "$(uname -s)" = "Darwin" ]; then
    ping_out=$(ping -c 1 -W 1000 "$HOST" 2>/dev/null || true)
  else
    ping_out=$(ping -c 1 -W 1 "$HOST" 2>/dev/null || true)
  fi
  ms=$(elapsed_since "$start")
  if printf '%s' "$ping_out" | grep -q '1 packets received\|1 received'; then
    rtt=$(printf '%s\n' "$ping_out" | sed -n 's/.*time=\([0-9.][0-9.]*\).*/\1/p' | head -n 1)
    if [ -n "$rtt" ]; then
      record_check "ICMP echo" "reply ${rtt} ms" "$ms" "PASS"
    else
      record_check "ICMP echo" "reply" "$ms" "PASS"
    fi
  else
    record_check "ICMP echo" "no reply" "$ms" "NOTE"
    add_note "ICMP did not answer. SSH can still work when echo is filtered."
  fi
  return 0
}

run_tcp() {
  start=$(now_ms)
  tcp_open "$HOST" "$PORT" "$TIMEOUT"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    record_check "TCP port $PORT" "open" "$(elapsed_since "$start")" "PASS"
    return 0
  fi
  if [ "$rc" -eq 2 ]; then
    record_check "TCP port $PORT" "no python3 or nc" "$(elapsed_since "$start")" "FAIL"
    VERDICT="FAILED"
    VERDICT_HINT="Install python3 or nc so the port check can run."
    return 1
  fi
  record_check "TCP port $PORT" "closed" "$(elapsed_since "$start")" "FAIL"
  VERDICT="UNREACHABLE"
  VERDICT_HINT="Confirm the Spark is on this network and sshd is listening."
  return 1
}

run_hostkey() {
  start=$(now_ms)
  if ! scan_fingerprint; then
    record_check "Host key" "not presented" "$(elapsed_since "$start")" "FAIL"
    VERDICT="FAILED"
    VERDICT_HINT="The port opened but no SSH host key was read. Confirm this is sshd."
    return 1
  fi
  if [ -n "$EXPECT_FP" ] && ! fingerprint_matches "$EXPECT_FP" "$HOST_FP"; then
    record_check "Host key" "fingerprint mismatch" "$(elapsed_since "$start")" "FAIL"
    printf '  %b  seen  %s  %s%b\n' "$C_DIM" "$HOST_FP" "$HOST_FP_TYPE" "$C_RESET"
    VERDICT="HOST KEY MISMATCH"
    VERDICT_HINT="Do not log in. The live key does not match --expect-fingerprint."
    return 1
  fi
  trusted=0
  key_status=0
  host_key_status || key_status=$?
  if [ "$key_status" -eq 0 ]; then
    trusted=1
    detail="trusted ${HOST_FP_TYPE:-key}"
    record_check "Host key" "$detail" "$(elapsed_since "$start")" "PASS"
  elif [ "$key_status" -eq 2 ]; then
    # A changed key is only replaced when it matches a fingerprint verified out of band;
    # DGX_ACCEPT_NEW covers first contact, never a key that changed.
    if [ -n "$EXPECT_FP" ]; then
      if ! replace_known_host_with_scanned_key; then
        record_check "Host key" "safe replacement failed" "$(elapsed_since "$start")" "FAIL"
        VERDICT="HOST KEY UPDATE FAILED"
        VERDICT_HINT="The current key could not be written to known_hosts; check ~/.ssh permissions."
        return 1
      fi
      trusted=1
      record_check "Host key" "verified key replaced" "$(elapsed_since "$start")" "WARN"
      add_note "The stale key for $KNOWN_HOST_NAME was replaced after DGX_EXPECT_FINGERPRINT matched."
    else
      record_check "Host key" "known key mismatch" "$(elapsed_since "$start")" "FAIL"
      printf '  %b  seen  %s  %s%b\n' "$C_DIM" "$HOST_FP" "${HOST_FP_TYPE}" "$C_RESET"
      VERDICT="HOST KEY MISMATCH"
      VERDICT_HINT="Do not log in. Verify the new key on the Spark console and pin it with DGX_EXPECT_FINGERPRINT."
      return 1
    fi
  elif [ "$ACCEPT_NEW" -eq 1 ]; then
    record_check "Host key" "new ${HOST_FP_TYPE:-key}" "$(elapsed_since "$start")" "WARN"
    add_note "A new host key will be stored because DGX_ACCEPT_NEW or --accept-new was set."
  else
    record_check "Host key" "not trusted yet" "$(elapsed_since "$start")" "FAIL"
  fi
  printf '  %b  %s  %s%b\n' "$C_DIM" "$HOST_FP" "${HOST_FP_TYPE}" "$C_RESET"
  if [ "$trusted" -eq 0 ] && [ "$ACCEPT_NEW" -eq 0 ]; then
    VERDICT="HOST KEY UNTRUSTED"
    VERDICT_HINT="Compare it with the Spark, set DGX_ACCEPT_NEW=1 in config, and retry."
    return 1
  fi
  return 0
}

run_ssh() {
  start=$(now_ms)
  out=$(mktemp "${TMPDIR:-/tmp}/dgx-spark-ssh.XXXXXX" 2>/dev/null || true)
  err=$(mktemp "${TMPDIR:-/tmp}/dgx-spark-ssh.XXXXXX" 2>/dev/null || true)
  if [ -z "$out" ] || [ -z "$err" ]; then
    record_check "SSH session" "temp file failed" "$(elapsed_since "$start")" "FAIL"
    VERDICT="FAILED"
    VERDICT_HINT="Could not create a temporary file for the SSH result."
    return 1
  fi
  trap 'rm -f "$out" "$err"' EXIT
  rc=0
  run_remote "$out" "$err" || rc=$?
  ms=$(elapsed_since "$start")
  if [ "$rc" -ne 0 ]; then
    reason=$(classify_ssh_error "$(cat "$err" 2>/dev/null || true)")
    record_check "SSH session" "$reason" "$ms" "FAIL"
    if printf '%s' "$reason" | grep -q 'authentication'; then
      VERDICT="AUTH FAILED"
      ssh_error=$(cat "$err" 2>/dev/null || true)
      if printf '%s' "$ssh_error" | grep -Eqi 'permission denied[[:space:]]*\(publickey\)|authentications that can continue:[[:space:]]*publickey'; then
        if [ -n "$IDENTITY" ]; then
          VERDICT_HINT="Server accepts public keys only; verify the username and that DGX_IDENTITY is the provider key."
        else
          VERDICT_HINT="Server accepts public keys only; set DGX_IDENTITY to the provider private-key path."
        fi
      elif [ "$INTERACTIVE" -eq 1 ]; then
        VERDICT_HINT="Check the username and the authentication method enabled by the server."
      else
        VERDICT_HINT="Pass --identity, or --interactive to type the password in ssh."
      fi
    else
      VERDICT="FAILED"
      VERDICT_HINT="SSH did not open a session. The detail above is the reason."
    fi
    return 1
  fi
  parse_remote "$out"
  if [ -z "$R_HOSTNAME" ] && [ -z "$R_KERNEL" ]; then
    record_check "SSH session" "empty reply" "$ms" "FAIL"
    VERDICT="FAILED"
    VERDICT_HINT="The session opened but the read-only probe returned nothing."
    return 1
  fi
  record_check "SSH session" "authenticated" "$ms" "PASS"
  SYSTEM_READY=1
  return 0
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help) SHOW_HELP=1; shift ;;
      --host)
        [ $# -ge 2 ] || die_usage "--host needs a value"
        CLI_HOST=$2
        shift 2
        ;;
      --user)
        [ $# -ge 2 ] || die_usage "--user needs a value"
        CLI_USER=$2
        shift 2
        ;;
      --port)
        [ $# -ge 2 ] || die_usage "--port needs a value"
        CLI_PORT=$2
        shift 2
        ;;
      --identity)
        [ $# -ge 2 ] || die_usage "--identity needs a path"
        CLI_IDENTITY=$2
        shift 2
        ;;
      --timeout)
        [ $# -ge 2 ] || die_usage "--timeout needs a number of seconds"
        CLI_TIMEOUT=$2
        shift 2
        ;;
      --expect-fingerprint)
        [ $# -ge 2 ] || die_usage "--expect-fingerprint needs a SHA256 value"
        CLI_FINGERPRINT=$2
        shift 2
        ;;
      --expect-disk-tb)
        [ $# -ge 2 ] || die_usage "--expect-disk-tb needs 1 or 4"
        CLI_EXPECT_DISK_TB=$2
        shift 2
        ;;
      --host-key-alias)
        [ $# -ge 2 ] || die_usage "--host-key-alias needs a name"
        CLI_HOST_KEY_ALIAS=$2
        shift 2
        ;;
      --config)
        [ $# -ge 2 ] || die_usage "--config needs a path"
        CLI_CONFIG=$2
        shift 2
        ;;
      --accept-new) CLI_ACCEPT_NEW=1; shift ;;
      --strict) CLI_STRICT=1; shift ;;
      --interactive) CLI_INTERACTIVE=1; shift ;;
      --interactive-if-no-key) CLI_AUTO_INTERACTIVE=1; shift ;;
      --prepare) CLI_PREPARE=1; shift ;;
      --color) CLI_COLOR=1; shift ;;
      --no-color) CLI_COLOR=0; shift ;;
      --password|--pass)
        die_usage "passwords on the command line are refused"
        ;;
      --)
        shift
        break
        ;;
      -*)
        die_usage "unknown option $1"
        ;;
      *)
        die_usage "unexpected argument $1"
        ;;
    esac
  done
  if [ $# -gt 0 ]; then
    die_usage "unexpected argument $1"
  fi
}

apply_settings() {
  if [ -n "$CLI_CONFIG" ]; then
    load_config "$CLI_CONFIG"
  elif [ -f "$DEFAULT_CONFIG" ]; then
    load_config "$DEFAULT_CONFIG"
  fi

  HOST=${CLI_HOST:-${ORIG_HOST:-$FILE_HOST}}
  USER_NAME=${CLI_USER:-${ORIG_USER:-${FILE_USER:-nvidia}}}
  PORT=${CLI_PORT:-${ORIG_PORT:-${FILE_PORT:-22}}}
  IDENTITY=${CLI_IDENTITY:-${ORIG_IDENTITY:-$FILE_IDENTITY}}
  TIMEOUT=${CLI_TIMEOUT:-${ORIG_TIMEOUT:-${FILE_TIMEOUT:-5}}}
  EXPECT_FP=${CLI_FINGERPRINT:-${ORIG_FINGERPRINT:-$FILE_FINGERPRINT}}
  EXPECT_DISK_TB=${CLI_EXPECT_DISK_TB:-${ORIG_EXPECT_DISK_TB:-${FILE_EXPECT_DISK_TB:-1}}}
  HOST_KEY_ALIAS=${CLI_HOST_KEY_ALIAS:-${ORIG_HOST_KEY_ALIAS:-$FILE_HOST_KEY_ALIAS}}
  IDENTITY=$(expand_home "$IDENTITY")

  accept_raw=${CLI_ACCEPT_NEW:-${ORIG_ACCEPT_NEW:-${FILE_ACCEPT_NEW:-0}}}
  strict_raw=${CLI_STRICT:-${ORIG_STRICT:-${FILE_STRICT:-0}}}
  interactive_raw=${CLI_INTERACTIVE:-${ORIG_INTERACTIVE:-${FILE_INTERACTIVE:-0}}}
  ACCEPT_NEW=$(parse_bool "$accept_raw")
  STRICT=$(parse_bool "$strict_raw")
  INTERACTIVE=$(parse_bool "$interactive_raw")
  if [ "$CLI_AUTO_INTERACTIVE" -eq 1 ] && [ -z "$IDENTITY" ]; then
    INTERACTIVE=1
  fi
  if [ "$ACCEPT_NEW" = "invalid" ] || [ "$STRICT" = "invalid" ] || [ "$INTERACTIVE" = "invalid" ]; then
    die_usage "boolean settings accept 1/0, yes/no, or true/false"
  fi

  if [ -z "$HOST" ]; then
    die_usage "set --host or DGX_HOST (example: spark-xxxx.local)"
  fi
  validate_host "$HOST"
  if [ -n "$HOST_KEY_ALIAS" ]; then
    validate_host "$HOST_KEY_ALIAS"
  fi
  validate_user "$USER_NAME"
  if ! is_uint "$PORT" || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    die_usage "port must be 1-65535"
  fi
  if ! is_uint "$TIMEOUT" || [ "$TIMEOUT" -lt 1 ] || [ "$TIMEOUT" -gt 30 ]; then
    die_usage "timeout must be 1-30 seconds"
  fi
  if [ -n "$IDENTITY" ]; then
    if [ ! -f "$IDENTITY" ]; then
      die_usage "identity file not found"
    fi
    if [ ! -r "$IDENTITY" ]; then
      die_usage "identity file is not readable"
    fi
  fi
  if [ -n "$EXPECT_FP" ]; then
    case "$EXPECT_FP" in
      *[!A-Za-z0-9:+/=_-]*) die_usage "fingerprint contains unsupported characters" ;;
    esac
  fi
  case "$EXPECT_DISK_TB" in
    1|4) ;;
    *) die_usage "expected disk size must be 1 or 4 TB" ;;
  esac
  if [ -n "${DGX_PASSWORD:-}${SSH_PASSWORD:-}" ]; then
    die_usage "DGX_PASSWORD and SSH_PASSWORD are refused; use a key or --interactive"
  fi
  if [ "$INTERACTIVE" -eq 1 ] && [ ! -t 0 ]; then
    die_usage "--interactive needs a terminal; use --identity for a key"
  fi

  if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
    USE_COLOR=0
  fi
  if [ -n "$CLI_COLOR" ]; then
    USE_COLOR=$CLI_COLOR
  fi
  enable_color
}

main() {
  parse_args "$@"
  if [ "$SHOW_HELP" -eq 1 ]; then
    usage
    exit 0
  fi
  apply_settings
  STARTED_MS=$(now_ms)
  print_header
  if [ "${CONFIG_MODE_WARN:-0}" -eq 1 ]; then
    add_note "Config file is readable by other accounts. Run chmod 600 on it."
  fi
  if [ -n "$IDENTITY" ]; then
    id_mode=$(stat -f '%OLp' "$IDENTITY" 2>/dev/null || stat -c '%a' "$IDENTITY" 2>/dev/null || true)
    if mode_is_shared "$id_mode"; then
      add_note "Identity file is readable by other accounts. Restrict it with chmod 600."
    fi
  fi

  run_client || finish 1
  run_resolve || finish 1
  run_ping
  run_tcp || finish 1
  run_hostkey || finish 1
  build_ssh_opts
  if [ "$CLI_PREPARE" -eq 1 ]; then
    prepare_remote || finish 1
  fi
  run_ssh || finish 1

  SPARK_MISMATCH=0
  if [ "$SYSTEM_READY" -eq 1 ]; then
    print_system
    assess_spark
  fi
  if [ "$HW_FAILS" -gt 0 ]; then
    VERDICT="HARDWARE CHECK FAILED"
    VERDICT_HINT="Review each FAIL above before accepting or keeping this unit."
    EXIT_CODE=3
  elif [ "$HW_WARNS" -gt 0 ]; then
    VERDICT="ATTENTION"
    VERDICT_HINT="Core checks passed, but review the warnings above."
    if [ "$STRICT" -eq 1 ]; then
      EXIT_CODE=3
    else
      EXIT_CODE=0
    fi
  else
    VERDICT="HEALTHY"
    VERDICT_HINT=""
    EXIT_CODE=0
  fi
  finish "$EXIT_CODE"
}

main "$@"
