#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/language.sh
source "$ROOT/scripts/lib/language.sh"
ARTIFEX_ROOT="${ARTIFEX_ROOT:-$(dirname "$ROOT")/ARTIFEX}"
CONNECTION_HELPER="$ARTIFEX_ROOT/gpu/scripts/gpu_connection.py"
AXFORGE_ENV="${MYDGX_AXFORGE_ENV:-$ARTIFEX_ROOT/.env}"
REMOTE_DIR="${MYDGX_REMOTE_DIR:-MyDGX-Dashboard}"
LLAMA_CPP_REF="${MYDGX_LLAMA_CPP_REF:-v1.0.0}"
FORCE_LLAMA_BUILD="${MYDGX_FORCE_LLAMA_CPP_BUILD:-0}"
INSTALL_OLLAMA="${MYDGX_INSTALL_OLLAMA:-1}"
OLLAMA_VERSION="${MYDGX_OLLAMA_VERSION:-}"
INSTALL_CONTAINERS="${MYDGX_INSTALL_CONTAINERS:-1}"
INSTALL_OPENWEBUI="${MYDGX_INSTALL_OPENWEBUI:-1}"
OPENWEBUI_VERSION="${MYDGX_OPENWEBUI_VERSION:-0.13.4}"
INSTALL_SEARXNG="${MYDGX_INSTALL_SEARXNG:-1}"
SEARXNG_IMAGE="${MYDGX_SEARXNG_IMAGE:-searxng/searxng@sha256:048e613ce4a7ddc35dfb05a0b8ede795a054187b3c3b89518adc37d5e03a8297}"
INSTALL_COMFYUI="${MYDGX_INSTALL_COMFYUI:-1}"
COMFYUI_REF="${MYDGX_COMFYUI_REF:-46659e65e95920e5d29cae011b43b02699c0bfd3}"
INSTALL_COMFYUI_MODELS="${MYDGX_INSTALL_COMFYUI_MODELS:-1}"
INSTALL_HASHCAT="${MYDGX_INSTALL_HASHCAT:-1}"
INSTALL_WHISPER="${MYDGX_INSTALL_WHISPER:-1}"
WHISPER_BASE_IMAGE="${MYDGX_WHISPER_BASE_IMAGE:-nvcr.io/nvidia/pytorch:25.09-py3}"
WHISPER_MODEL="${MYDGX_WHISPER_MODEL:-turbo}"
OPENWEBUI_PUBLIC_URL="${MYDGX_OPENWEBUI_PUBLIC_URL:-}"
COMFYUI_PUBLIC_URL="${MYDGX_COMFYUI_PUBLIC_URL:-}"
DEFAULT_PROFILE_ID=""
DATABASE_RESTORE=""
CLI_SSH_HOST=""
CLI_SSH_PORT=""
CLI_SSH_USER=""
CLI_SSH_IDENTITY=""
INTERACTIVE=0
SUDO_PASSWORD_STDIN=0
INSTALL_DUCKDNS=0
DEPLOY_MODE="incremental"

die() {
  printf 'ERROR: %s\n' "$(pick "$@")" >&2
  exit 1
}

set_deploy_mode() {
  [[ "$DEPLOY_MODE" == "incremental" ]] ||
    die "Solo se puede indicar uno de --frontend, --full o --repair." "Only one of --frontend, --full, or --repair may be specified."
  DEPLOY_MODE="$1"
}

# --github [RAMA|TAG]: deploy a pushed commit instead of this working tree. The commit is
# exported with `git archive` (no uncommitted or ignored files, so no .env) to a temporary
# directory and this same script runs from there; the DGX never needs GitHub access.
deploy_from_github() {
  local ref="$1"
  shift
  command -v git >/dev/null 2>&1 || die "Falta git." "git is missing."
  git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 ||
    die "--github necesita ejecutarse desde el repositorio git de MyDGX." "--github must be run from the MyDGX git repository."
  [[ "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ && "$ref" != *..* ]] ||
    die "Rama o tag no válido: $ref" "Invalid branch or tag: $ref"
  local origin
  origin="$(git -C "$ROOT" remote get-url origin 2>/dev/null)" ||
    die "El repositorio no tiene remoto origin." "The repository has no origin remote."
  say "Descargando $ref desde $origin…" "Downloading $ref from $origin…"
  git -C "$ROOT" fetch --quiet --prune --tags origin ||
    die "No se pudo descargar origin." "Could not fetch origin."
  local commit kind
  if commit="$(git -C "$ROOT" rev-parse --verify --quiet "refs/tags/$ref^{commit}")"; then
    kind="tag"
    if [[ "${MYDGX_REQUIRE_SIGNED_TAG:-0}" == "1" ]]; then
      git -C "$ROOT" verify-tag "$ref" >/dev/null 2>&1 ||
        die "El tag $ref no tiene una firma válida." "Tag $ref does not have a valid signature."
    fi
  elif commit="$(git -C "$ROOT" rev-parse --verify --quiet "refs/remotes/origin/$ref^{commit}")"; then
    kind="rama"
    [[ "${MYDGX_REQUIRE_SIGNED_TAG:-0}" != "1" ]] ||
      die "MYDGX_REQUIRE_SIGNED_TAG=1 solo admite tags firmados." "MYDGX_REQUIRE_SIGNED_TAG=1 only accepts signed tags."
  else
    die "No existe la rama o el tag $ref en origin." "Branch or tag $ref does not exist on origin."
  fi
  local stage status
  stage="$(mktemp -d "${TMPDIR:-/tmp}/mydgx-github.XXXXXX")"
  trap 'rm -rf "$stage"' EXIT
  git -C "$ROOT" archive --format=tar "$commit" | tar -x -C "$stage"
  printf '%s\n' "$commit" > "$stage/.mydgx-source-commit"
  say "Desplegando $kind $ref · commit ${commit:0:12}" "Deploying $kind $ref · commit ${commit:0:12}"
  set +e
  MYDGX_GITHUB_STAGED=1 \
    MYDGX_DEPLOY_ENV_FILE="$ROOT/.env" \
    ARTIFEX_ROOT="$ARTIFEX_ROOT" \
    MYDGX_AXFORGE_ENV="$AXFORGE_ENV" \
    bash "$stage/deploy.sh" "$@"
  status=$?
  set -e
  ((status == 0)) && say "Desplegado $kind $ref · commit ${commit:0:12}" "Deployed $kind $ref · commit ${commit:0:12}"
  exit "$status"
}

if [[ "${MYDGX_GITHUB_STAGED:-0}" != "1" ]]; then
  github_ref=""
  passthrough=()
  while (($#)); do
    if [[ "$1" == "--github" ]]; then
      github_ref="main"
      if (($# >= 2)) && [[ "$2" != -* && "$2" != *@* ]]; then
        github_ref="$2"
        shift
      fi
    else
      passthrough+=("$1")
    fi
    shift
  done
  set -- ${passthrough[@]+"${passthrough[@]}"}
  [[ -z "$github_ref" ]] || deploy_from_github "$github_ref" "$@"
fi

while (($#)); do
  case "$1" in
    -p)
      (($# >= 2)) || die "Falta el puerto después de -p." "Missing port after -p."
      CLI_SSH_PORT="$2"
      shift 2
      ;;
    -p?*)
      CLI_SSH_PORT="${1#-p}"
      shift
      ;;
    -i)
      (($# >= 2)) || die "Falta la ruta de la identidad SSH después de -i." "Missing SSH identity path after -i."
      CLI_SSH_IDENTITY="$2"
      shift 2
      ;;
    -i?*)
      CLI_SSH_IDENTITY="${1#-i}"
      shift
      ;;
    --database)
      (($# >= 2)) || die "Falta la ruta después de --database." "Missing path after --database."
      DATABASE_RESTORE="$2"
      shift 2
      ;;
    --full)
      set_deploy_mode "full"
      shift
      ;;
    --repair)
      set_deploy_mode "repair"
      shift
      ;;
    --frontend)
      set_deploy_mode "frontend"
      shift
      ;;
    --interactive)
      INTERACTIVE=1
      shift
      ;;
    --sudo-password-stdin)
      SUDO_PASSWORD_STDIN=1
      shift
      ;;
    --duckdns)
      INSTALL_DUCKDNS=1
      shift
      ;;
    -h|--help)
      say "Uso: ./start.sh deploy [USUARIO@HOST [-p PUERTO] [-i RUTA_CLAVE] [--interactive|--sudo-password-stdin]] [--database RUTA] [--duckdns] [--frontend|--full|--repair] [--github [RAMA|TAG]]" "Usage: ./start.sh deploy [USER@HOST [-p PORT] [-i KEY_PATH] [--interactive|--sudo-password-stdin]] [--database PATH] [--duckdns] [--frontend|--full|--repair] [--github [BRANCH|TAG]]"
      exit 0
      ;;
    *@*)
      [[ -z "$CLI_SSH_HOST" && -z "$CLI_SSH_USER" ]] ||
        die "Solo se admite un destino USUARIO@HOST." "Only one USER@HOST destination is allowed."
      CLI_SSH_USER="${1%%@*}"
      CLI_SSH_HOST="${1#*@}"
      [[ -n "$CLI_SSH_USER" && -n "$CLI_SSH_HOST" && "$CLI_SSH_HOST" != "$1" ]] ||
        die "Destino inválido. Usa USUARIO@HOST." "Invalid destination. Use USER@HOST."
      shift
      ;;
    *)
      die "Opción de despliegue desconocida: $1" "Unknown deploy option: $1"
      ;;
  esac
done

if [[ "$DEPLOY_MODE" == "frontend" && -n "$DATABASE_RESTORE" ]]; then
  die "--frontend no se puede combinar con --database." "--frontend cannot be combined with --database."
fi

sudo_password=""
if [[ "$SUDO_PASSWORD_STDIN" == "1" ]]; then
  [[ "$INTERACTIVE" != "1" ]] ||
    die "--sudo-password-stdin no se puede combinar con --interactive." "--sudo-password-stdin cannot be combined with --interactive."
  [[ ! -t 0 ]] || die "--sudo-password-stdin espera la contraseña por una tubería." "--sudo-password-stdin expects the password on stdin."
  IFS= read -r sudo_password || [[ -n "$sudo_password" ]] ||
    die "No se recibió la contraseña de sudo." "No sudo password was received."
  # SSH and rsync below would otherwise consume the rest of stdin.
  exec </dev/null
fi

command -v python3 >/dev/null 2>&1 || die "Falta python3." "python3 is missing."
command -v rsync >/dev/null 2>&1 || die "Falta rsync." "rsync is missing."

local_env="${MYDGX_DEPLOY_ENV_FILE:-$ROOT/.env}"
if [[ -f "$local_env" && ! -L "$local_env" ]]; then
  DEFAULT_PROFILE_ID="$(
    python3 - "$local_env" <<'PY'
import pathlib
import sys

value = ""
for raw_line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, candidate = line.split("=", 1)
    if key.strip() == "DEFAULT_PROFILE_ID":
        value = candidate.strip().strip("'\"")
print(value)
PY
  )"
fi
[[ -z "$DEFAULT_PROFILE_ID" || "$DEFAULT_PROFILE_ID" =~ ^[A-Za-z0-9._-]{1,100}$ ]] ||
  die "DEFAULT_PROFILE_ID no es un identificador de perfil válido." "DEFAULT_PROFILE_ID is not a valid profile identifier."

if [[ -n "$DATABASE_RESTORE" ]]; then
  DATABASE_RESTORE="$(
    python3 - "$DATABASE_RESTORE" <<'PY'
import os
import pathlib
import sqlite3
import sys

es = os.environ.get("MYDGX_LANGUAGE") == "es"
path = pathlib.Path(sys.argv[1]).expanduser()
if path.is_symlink() or not path.is_file():
    raise SystemExit(
        "La base indicada no existe, no es regular o es un enlace simbólico."
        if es
        else "The specified database does not exist, is not a regular file, or is a symbolic link."
    )
path = path.resolve()
try:
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
        result = connection.execute("PRAGMA quick_check").fetchone()
except sqlite3.Error as exc:
    raise SystemExit(
        f"La base indicada no es SQLite válida: {exc}"
        if es
        else f"The specified database is not valid SQLite: {exc}"
    ) from None
if not result or result[0] != "ok":
    raise SystemExit(
        "La base indicada no superó PRAGMA quick_check."
        if es
        else "The specified database failed PRAGMA quick_check."
    )
print(path)
PY
  )" || die "La base de datos indicada no es válida." "The specified database is not valid."
fi

[[ "$REMOTE_DIR" =~ ^[A-Za-z0-9._/-]+$ && "$REMOTE_DIR" != /* && "$REMOTE_DIR" != *".."* ]] ||
  die "MYDGX_REMOTE_DIR contiene caracteres o segmentos no permitidos." "MYDGX_REMOTE_DIR contains disallowed characters or path segments."
[[ "$LLAMA_CPP_REF" =~ ^[A-Za-z0-9._/-]+$ ]] ||
  die "MYDGX_LLAMA_CPP_REF no es una revisión válida." "MYDGX_LLAMA_CPP_REF is not a valid revision."
[[ "$FORCE_LLAMA_BUILD" =~ ^[01]$ &&
   "$INSTALL_OLLAMA" =~ ^[01]$ &&
   "$INSTALL_CONTAINERS" =~ ^[01]$ &&
   "$INSTALL_OPENWEBUI" =~ ^[01]$ &&
   "$INSTALL_SEARXNG" =~ ^[01]$ &&
   "$INSTALL_COMFYUI" =~ ^[01]$ &&
   "$INSTALL_COMFYUI_MODELS" =~ ^[01]$ &&
   "$INSTALL_HASHCAT" =~ ^[01]$ &&
   "$INSTALL_WHISPER" =~ ^[01]$ ]] ||
  die "Las opciones MYDGX_INSTALL_* y MYDGX_FORCE_LLAMA_CPP_BUILD deben valer 0 o 1." "MYDGX_INSTALL_* and MYDGX_FORCE_LLAMA_CPP_BUILD options must be 0 or 1."
[[ -z "$OLLAMA_VERSION" || "$OLLAMA_VERSION" =~ ^[A-Za-z0-9._+-]+$ ]] ||
  die "MYDGX_OLLAMA_VERSION no es válida." "MYDGX_OLLAMA_VERSION is not valid."
[[ -z "$OPENWEBUI_VERSION" || "$OPENWEBUI_VERSION" =~ ^[A-Za-z0-9._+-]+$ ]] ||
  die "MYDGX_OPENWEBUI_VERSION no es válida." "MYDGX_OPENWEBUI_VERSION is not valid."
[[ "$SEARXNG_IMAGE" =~ ^[A-Za-z0-9._/:@+-]+$ ]] ||
  die "MYDGX_SEARXNG_IMAGE no es válida." "MYDGX_SEARXNG_IMAGE is not valid."
[[ "$COMFYUI_REF" =~ ^[A-Za-z0-9._/-]+$ ]] ||
  die "MYDGX_COMFYUI_REF no es válida." "MYDGX_COMFYUI_REF is not valid."
if [[ "$INSTALL_SEARXNG" == "1" && "$INSTALL_OPENWEBUI" != "1" ]]; then
  die "SearXNG requiere MYDGX_INSTALL_OPENWEBUI=1." "SearXNG requires MYDGX_INSTALL_OPENWEBUI=1."
fi
if [[ "$INSTALL_COMFYUI_MODELS" == "1" && "$INSTALL_COMFYUI" != "1" ]]; then
  die "MYDGX_INSTALL_COMFYUI_MODELS=1 requiere MYDGX_INSTALL_COMFYUI=1." "MYDGX_INSTALL_COMFYUI_MODELS=1 requires MYDGX_INSTALL_COMFYUI=1."
fi
[[ "$WHISPER_BASE_IMAGE" =~ ^[A-Za-z0-9._/:@+-]+$ ]] ||
  die "MYDGX_WHISPER_BASE_IMAGE no es válida." "MYDGX_WHISPER_BASE_IMAGE is not valid."
[[ "$WHISPER_MODEL" =~ ^[A-Za-z0-9._/-]+$ ]] ||
  die "MYDGX_WHISPER_MODEL no es válido." "MYDGX_WHISPER_MODEL is not valid."
if [[ -n "$OPENWEBUI_PUBLIC_URL" ]]; then
  [[ "$OPENWEBUI_PUBLIC_URL" =~ ^https?://(127\.0\.0\.1|localhost):([0-9]{1,5})/?$ ]] ||
    die "MYDGX_OPENWEBUI_PUBLIC_URL debe ser una URL loopback con puerto." "MYDGX_OPENWEBUI_PUBLIC_URL must be a loopback URL with a port."
  ((10#${BASH_REMATCH[2]} >= 1 && 10#${BASH_REMATCH[2]} <= 65535)) ||
    die "El puerto de MYDGX_OPENWEBUI_PUBLIC_URL no es válido." "MYDGX_OPENWEBUI_PUBLIC_URL port is not valid."
  OPENWEBUI_PUBLIC_URL="${OPENWEBUI_PUBLIC_URL%/}"
fi
if [[ -n "$COMFYUI_PUBLIC_URL" ]]; then
  [[ "$COMFYUI_PUBLIC_URL" =~ ^https?://(127\.0\.0\.1|localhost):([0-9]{1,5})/?$ ]] ||
    die "MYDGX_COMFYUI_PUBLIC_URL debe ser una URL loopback con puerto." "MYDGX_COMFYUI_PUBLIC_URL must be a loopback URL with a port."
  ((10#${BASH_REMATCH[2]} >= 1 && 10#${BASH_REMATCH[2]} <= 65535)) ||
    die "El puerto de MYDGX_COMFYUI_PUBLIC_URL no es válido." "MYDGX_COMFYUI_PUBLIC_URL port is not valid."
  COMFYUI_PUBLIC_URL="${COMFYUI_PUBLIC_URL%/}"
fi

host="${CLI_SSH_HOST:-${MYDGX_SSH_HOST:-}}"
ssh_port="${CLI_SSH_PORT:-${MYDGX_SSH_PORT:-}}"
ssh_user="${CLI_SSH_USER:-${MYDGX_SSH_USER:-}}"
identity="${CLI_SSH_IDENTITY:-${MYDGX_SSH_IDENTITY:-}}"
if [[ "$identity" == "~/"* ]]; then
  identity="$HOME/${identity#\~/}"
fi

tray_config="$HOME/.MyDGX/config"
if [[ ( -z "$host" || -z "$ssh_port" || -z "$ssh_user" ||
        ( -z "$identity" && "$INTERACTIVE" != "1" ) ) &&
      -f "$tray_config" && ! -L "$tray_config" ]]; then
  tray_connection="$(
    python3 - "$tray_config" <<'PY'
import json
import pathlib
import sys

try:
    configuration = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    active_id = configuration.get("activeConnectionID")
    profiles = configuration.get("connections") or []
    profile = next((item for item in profiles if item.get("id") == active_id), profiles[0] if profiles else {})
    ssh = profile.get("ssh") or {}
    values = (
        ssh.get("host") or "",
        str(ssh.get("port") or ""),
        ssh.get("user") or "",
        ssh.get("identityFile") or "",
    )
    print("\x1f".join(values))
except (OSError, ValueError, TypeError):
    print("\x1f\x1f\x1f")
PY
  )"
  IFS=$'\x1f' read -r tray_host tray_port tray_user tray_identity <<<"$tray_connection"
  host="${host:-$tray_host}"
  ssh_port="${ssh_port:-$tray_port}"
  ssh_user="${ssh_user:-$tray_user}"
  identity="${identity:-$tray_identity}"
  if [[ "$identity" == "~/"* ]]; then
    identity="$HOME/${identity#\~/}"
  fi
fi

if [[ -z "$host" || -z "$ssh_port" || -z "$ssh_user" ||
      ( -z "$identity" && "$INTERACTIVE" != "1" ) ]]; then
  [[ -f "$CONNECTION_HELPER" ]] ||
    die "Define MYDGX_SSH_HOST, MYDGX_SSH_PORT, MYDGX_SSH_USER y MYDGX_SSH_IDENTITY." "Set MYDGX_SSH_HOST, MYDGX_SSH_PORT, MYDGX_SSH_USER, and MYDGX_SSH_IDENTITY."
  [[ -f "$AXFORGE_ENV" && ! -L "$AXFORGE_ENV" ]] ||
    die "No se encontró la configuración segura de AxForge." "AxForge secure configuration was not found."
  connection="$(
    python3 "$CONNECTION_HELPER" connection \
      --env-file "$AXFORGE_ENV" --provider axforge
  )"
  IFS=$'\t' read -r configured_host configured_port configured_user configured_identity <<<"$connection"
  host="${host:-$configured_host}"
  ssh_port="${ssh_port:-$configured_port}"
  ssh_user="${ssh_user:-$configured_user}"
  identity="${identity:-$configured_identity}"
fi

[[ -n "$host" && "$ssh_port" =~ ^[0-9]+$ && -n "$ssh_user" ]] ||
  die "La configuración SSH de AxForge no es válida." "AxForge SSH configuration is not valid."
[[ "$host" =~ ^[A-Za-z0-9.:-]+$ && "$ssh_user" =~ ^[A-Za-z0-9._-]+$ ]] ||
  die "El host o usuario SSH contiene caracteres no permitidos." "SSH host or user contains disallowed characters."
if [[ -n "$identity" ]]; then
  [[ -f "$identity" && ! -L "$identity" ]] ||
    die "No se encontró la identidad SSH configurada." "Configured SSH identity was not found."
elif [[ "$INTERACTIVE" != "1" ]]; then
  die "Se necesita una identidad SSH o --interactive." "An SSH identity or --interactive is required."
fi

selected_port=""
seen_ports=""
deploy_known_hosts="$(mktemp)"
control_dir=""
chmod 0600 "$deploy_known_hosts"
cleanup_local() {
  local status=$?
  if [[ -n "$control_dir" && -S "$control_dir/ssh.sock" ]]; then
    ssh -S "$control_dir/ssh.sock" -O exit "$ssh_user@$host" >/dev/null 2>&1 || true
  fi
  [[ -z "$control_dir" ]] || rm -rf -- "$control_dir"
  rm -f -- "$deploy_known_hosts"
  return "$status"
}
trap cleanup_local EXIT HUP INT TERM

known_hosts_store="${MYDGX_KNOWN_HOSTS:-$HOME/.MyDGX/known_hosts}"
accept_new_host_key="${MYDGX_SSH_ACCEPT_NEW:-0}"
expected_host_fingerprint="${MYDGX_SSH_HOST_FINGERPRINT:-}"
[[ "$accept_new_host_key" =~ ^[01]$ ]] || die "MYDGX_SSH_ACCEPT_NEW debe valer 0 o 1." "MYDGX_SSH_ACCEPT_NEW must be 0 or 1."
[[ -z "$expected_host_fingerprint" || "$expected_host_fingerprint" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] ||
  die "MYDGX_SSH_HOST_FINGERPRINT debe tener el formato SHA256:... de ssh-keygen -lf." "MYDGX_SSH_HOST_FINGERPRINT must use the SHA256:... format from ssh-keygen -lf."
[[ "$known_hosts_store" == /* && ! -L "$known_hosts_store" ]] ||
  die "MYDGX_KNOWN_HOSTS debe ser una ruta absoluta y no un enlace simbólico." "MYDGX_KNOWN_HOSTS must be an absolute path and not a symbolic link."
mkdir -p "$(dirname "$known_hosts_store")"
[[ -f "$known_hosts_store" ]] || (umask 077 && : >"$known_hosts_store")

host_key_name() {
  if [[ "$2" == "22" ]]; then
    printf '%s' "$1"
  else
    printf '[%s]:%s' "$1" "$2"
  fi
}

# Copies already trusted keys for host:port into the ephemeral known_hosts file.
load_trusted_host_key() {
  local name file
  name="$(host_key_name "$1" "$2")"
  : >"$deploy_known_hosts"
  for file in "$known_hosts_store" "$HOME/.ssh/known_hosts"; do
    [[ -f "$file" ]] || continue
    ssh-keygen -F "$name" -f "$file" 2>/dev/null | awk '!/^#/ && NF' >>"$deploy_known_hosts" || true
  done
  [[ -s "$deploy_known_hosts" ]]
}

host_key_source=""
untrusted_ports=""
mismatched_ports=""
port_candidates=("$ssh_port")
[[ "$INTERACTIVE" == "1" ]] || port_candidates+=(22080 22081 22082 22083)
for candidate in "${port_candidates[@]}"; do
  [[ "$candidate" =~ ^[0-9]+$ ]] || continue
  [[ "$seen_ports" == *" $candidate "* ]] && continue
  seen_ports+=" $candidate "
  if load_trusted_host_key "$host" "$candidate"; then
    host_key_source="trusted"
  else
    ssh-keyscan -T 5 -p "$candidate" "$host" >"$deploy_known_hosts" 2>/dev/null || continue
    [[ -s "$deploy_known_hosts" ]] || continue
    if [[ -n "$expected_host_fingerprint" ]]; then
      if ! ssh-keygen -lf "$deploy_known_hosts" 2>/dev/null |
           awk '{print $2}' | grep -Fxq "$expected_host_fingerprint"; then
        mismatched_ports+=" $candidate"
        continue
      fi
      host_key_source="pinned"
    elif [[ "$INTERACTIVE" == "1" ]]; then
      host_key_source="confirm"
    elif [[ "$accept_new_host_key" == "1" ]]; then
      host_key_source="accepted"
    else
      untrusted_ports+=" $candidate"
      continue
    fi
  fi
  if [[ "$INTERACTIVE" == "1" ]]; then
    selected_port="$candidate"
    break
  elif ssh \
      -o BatchMode=yes \
      -o IdentitiesOnly=yes \
      -o ConnectTimeout=5 \
      -o ConnectionAttempts=1 \
      -o StrictHostKeyChecking=yes \
      -o "UserKnownHostsFile=$deploy_known_hosts" \
      -o GlobalKnownHostsFile=/dev/null \
      -i "$identity" \
      -p "$candidate" \
      "$ssh_user@$host" true 2>/dev/null; then
    selected_port="$candidate"
    break
  fi
done
if [[ -z "$selected_port" ]]; then
  [[ -z "$mismatched_ports" ]] ||
    die "La clave SSH de $host (puertos:$mismatched_ports) no coincide con MYDGX_SSH_HOST_FINGERPRINT. No continúes sin verificarla en el DGX." "SSH key for $host (ports:$mismatched_ports) does not match MYDGX_SSH_HOST_FINGERPRINT. Do not continue without verifying it on the DGX."
  [[ -z "$untrusted_ports" ]] ||
    die "La clave SSH de $host (puertos:$untrusted_ports) aún no es de confianza. Usa --interactive para confirmarla, fija MYDGX_SSH_HOST_FINGERPRINT=SHA256:... o, solo para alquileres efímeros, MYDGX_SSH_ACCEPT_NEW=1." "SSH key for $host (ports:$untrusted_ports) is not trusted yet. Use --interactive to confirm it, set MYDGX_SSH_HOST_FINGERPRINT=SHA256:..., or for ephemeral rentals only, MYDGX_SSH_ACCEPT_NEW=1."
  if [[ "$INTERACTIVE" == "1" ]]; then
    die "No se encontró SSH en $host:$ssh_port." "SSH not found on $host:$ssh_port."
  fi
  die "AxForge no acepta la identidad SSH en el puerto configurado ni en 22080-22083 (si la clave del host cambió, verifica y revisa $known_hosts_store)." "AxForge rejected the SSH identity on the configured port and on 22080-22083 (if the host key changed, verify it and review $known_hosts_store)."
fi

ssh_port="$selected_port"
ssh_args=(
  -o ConnectTimeout=20
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$deploy_known_hosts"
  -o GlobalKnownHostsFile=/dev/null
  -p "$ssh_port"
)
if [[ -n "$identity" ]]; then
  ssh_args+=(-o IdentitiesOnly=yes -i "$identity")
fi
if [[ "$INTERACTIVE" == "1" ]]; then
  [[ -t 0 && -t 1 ]] || die "--interactive requiere una terminal." "--interactive requires a terminal."
  if [[ "$host_key_source" == "confirm" ]]; then
    say "Huella(s) SSH recibida(s) de $host:$ssh_port:" "SSH fingerprint(s) received from $host:$ssh_port:"
    ssh-keygen -lf "$deploy_known_hosts"
    pick "Confirma esta huella desde la consola del DGX. Escribe yes para continuar: " "Confirm this fingerprint from the DGX console. Type yes to continue: "
    read -r host_key_confirmation
    [[ "$host_key_confirmation" == "yes" ]] || die "Huella SSH no confirmada." "SSH fingerprint not confirmed."
  fi
  control_dir="$(mktemp -d)"
  ssh_args+=(
    -o BatchMode=no
    -o NumberOfPasswordPrompts=1
    -o ControlMaster=auto
    -o ControlPersist=15m
    -o "ControlPath=$control_dir/ssh.sock"
  )
else
  ssh_args+=(-o BatchMode=yes)
fi
ssh "${ssh_args[@]}" "$ssh_user@$host" true ||
  die "No se pudo autenticar la conexión SSH." "Could not authenticate the SSH connection."
if [[ "$host_key_source" == "confirm" || "$host_key_source" == "pinned" ]]; then
  cat "$deploy_known_hosts" >>"$known_hosts_store"
  chmod 0600 "$known_hosts_store"
fi
rsync_ssh=""
for part in ssh "${ssh_args[@]}"; do
  printf -v quoted '%q' "$part"
  rsync_ssh+="${rsync_ssh:+ }$quoted"
done

say "SSH disponible en $host:$ssh_port." "SSH available on $host:$ssh_port."
case "$host_key_source" in
  trusted) pick "Clave de host ya conocida y verificada: " "Host key already known and verified: " ;;
  pinned) pick "Clave de host verificada con MYDGX_SSH_HOST_FINGERPRINT: " "Host key verified with MYDGX_SSH_HOST_FINGERPRINT: " ;;
  confirm) pick "Clave de host confirmada y guardada en $known_hosts_store: " "Host key confirmed and saved in $known_hosts_store: " ;;
  *) pick "AVISO: clave de host aceptada sin verificar (MYDGX_SSH_ACCEPT_NEW=1): " "WARNING: host key accepted without verification (MYDGX_SSH_ACCEPT_NEW=1): " ;;
esac
ssh-keygen -lf "$deploy_known_hosts" 2>/dev/null | awk 'NR==1 {print $2, $4}'

if [[ "$DEPLOY_MODE" == "frontend" ]]; then
  command -v npm >/dev/null 2>&1 || die "Falta npm para compilar el frontend." "npm is required to build the frontend."
  command -v node >/dev/null 2>&1 || die "Falta Node.js 20 o posterior." "Node.js 20 or later is required."
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  node_version="$(node --version)"
  ((node_major >= 20)) ||
    die "MyDGX necesita Node.js 20 o posterior; detectado $node_version." "MyDGX requires Node.js 20 or later; detected $node_version."

  dependency_fingerprint="$(
    python3 - "$ROOT/frontend/package.json" "$ROOT/frontend/package-lock.json" <<'PY'
import hashlib
import pathlib
import sys

digest = hashlib.sha256()
for value in sys.argv[1:]:
    path = pathlib.Path(value)
    if path.is_file():
        digest.update(path.read_bytes())
        digest.update(b"\0")
print(digest.hexdigest())
PY
  )"
  installed_dependency_fingerprint=""
  [[ -f "$ROOT/frontend/node_modules/.mydgx-fingerprint" ]] &&
    installed_dependency_fingerprint="$(cat "$ROOT/frontend/node_modules/.mydgx-fingerprint")"
  if [[ ! -d "$ROOT/frontend/node_modules" ||
        "$dependency_fingerprint" != "$installed_dependency_fingerprint" ]]; then
    say "Instalando dependencias reproducibles del frontend..." "Installing reproducible frontend dependencies..."
    npm --prefix "$ROOT/frontend" ci
    printf '%s\n' "$dependency_fingerprint" >"$ROOT/frontend/node_modules/.mydgx-fingerprint"
  else
    say "Dependencias frontend sin cambios; omitiendo npm ci." "Frontend dependencies unchanged; skipping npm ci."
  fi
  say "Compilando el frontend..." "Building the frontend..."
  npm --prefix "$ROOT/frontend" run build
  [[ -f "$ROOT/frontend/dist/index.html" ]] ||
    die "La compilación no generó frontend/dist/index.html." "Build did not produce frontend/dist/index.html."

  frontend_stage="$REMOTE_DIR/frontend/.dist-stage-$(date +%Y%m%d%H%M%S)-$$"
  ssh "${ssh_args[@]}" "$ssh_user@$host" env MYDGX_LANGUAGE="$MYDGX_LANGUAGE" bash -s -- "$REMOTE_DIR" "$frontend_stage" <<'PREPARE_FRONTEND'
set -euo pipefail
pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
say() { pick "$@"; printf '\n'; }
remote_dir="$1"
stage="$2"
[[ "$remote_dir" =~ ^[A-Za-z0-9._/-]+$ && "$remote_dir" != /* && "$remote_dir" != *".."* ]] || exit 2
[[ "$stage" =~ ^[A-Za-z0-9._/-]+$ && "$stage" != /* && "$stage" != *".."* ]] || exit 2
[[ -d "$HOME/$remote_dir/frontend" ]] || {
  say "MyDGX no está desplegado en $HOME/$remote_dir." "MyDGX is not deployed in $HOME/$remote_dir." >&2
  exit 1
}
rm -rf -- "$HOME/$stage"
mkdir -p "$HOME/$stage"
PREPARE_FRONTEND
  rsync -az --delete \
    -e "$rsync_ssh" \
    "$ROOT/frontend/dist/" "$ssh_user@$host:$frontend_stage/"
  ssh "${ssh_args[@]}" "$ssh_user@$host" env MYDGX_LANGUAGE="$MYDGX_LANGUAGE" bash -s -- "$REMOTE_DIR" "$frontend_stage" <<'ACTIVATE_FRONTEND'
set -euo pipefail
pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
say() { pick "$@"; printf '\n'; }
remote_dir="$1"
stage="$2"
app="$HOME/$remote_dir"
incoming="$HOME/$stage"
current="$app/frontend/dist"
backup="$app/frontend/dist.backup.$(date +%Y%m%d%H%M%S)"
[[ -f "$incoming/index.html" && -d "$incoming/assets" ]] || {
  say "El frontend transferido está incompleto." "Transferred frontend is incomplete." >&2
  exit 1
}
if [[ -d "$current" ]]; then
  mv "$current" "$backup"
fi
if ! mv "$incoming" "$current"; then
  [[ ! -d "$backup" ]] || mv "$backup" "$current"
  exit 1
fi
[[ -f "$current/index.html" ]] || {
  mv "$current" "${current}.failed"
  [[ ! -d "$backup" ]] || mv "$backup" "$current"
  exit 1
}
say "Frontend activado sin reiniciar servicios. Respaldo: $backup" "Frontend activated without restarting services. Backup: $backup"
ACTIVATE_FRONTEND
  say "Despliegue frontend completado en $host:$ssh_port." "Frontend deploy completed on $host:$ssh_port."
  exit 0
fi

REMOTE_STAGE="${REMOTE_DIR}.deploy-stage"
say "Sincronizando MyDGX a un área temporal sin secretos ni dependencias locales..." "Syncing MyDGX to a staging area without secrets or local dependencies..."
ssh "${ssh_args[@]}" "$ssh_user@$host" env MYDGX_LANGUAGE="$MYDGX_LANGUAGE" bash -s -- "$REMOTE_STAGE" <<'PREPARE'
set -euo pipefail
pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
say() { pick "$@"; printf '\n'; }
stage="$1"
[[ "$stage" =~ ^[A-Za-z0-9._/-]+$ && "$stage" != /* && "$stage" != *".."* ]] || exit 2
rm -rf -- "$HOME/$stage"
mkdir -p "$HOME/$stage"
PREPARE
rsync -az --delete \
  --include='.env.example' \
  --include='*.env.example' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='*.env' \
  --exclude='*.pem' \
  --exclude='*.key' \
  --exclude='.git/' \
  --exclude='.cursor/' \
  --exclude='.DS_Store' \
  --exclude='.venv/' \
  --exclude='frontend/node_modules/' \
  --exclude='frontend/dist/' \
  --exclude='.pycache/' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='data/' \
  --exclude='logs/' \
  --exclude='macos/MyDGXTray/.build/' \
  --exclude='macos/MyDGXTray/dist/' \
  -e "$rsync_ssh" \
  "$ROOT/" "$ssh_user@$host:$REMOTE_STAGE/"

restore_database=0
if [[ -n "$DATABASE_RESTORE" ]]; then
  say "Se sobrescribirá la base MyDGX remota con una copia verificada de $DATABASE_RESTORE." "Remote MyDGX database will be overwritten with a verified copy of $DATABASE_RESTORE."
  rsync -a --chmod=F600 \
    -e "$rsync_ssh" \
    "$DATABASE_RESTORE" "$ssh_user@$host:$REMOTE_STAGE/.mydgx-restore.db"
  restore_database=1
fi

ollama_version_arg="${OLLAMA_VERSION:-__MYDGX_EMPTY__}"
remote_ssh_args=("${ssh_args[@]}")
[[ "$INTERACTIVE" == "1" ]] && remote_ssh_args+=(-tt)
remote_runtime="$REMOTE_STAGE/.mydgx-deploy-runtime.sh"
ssh "${ssh_args[@]}" "$ssh_user@$host" \
  "umask 077; cat > \"\$HOME/$remote_runtime\"" <<'REMOTE'
set -euo pipefail
pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
say() { pick "$@"; printf '\n'; }
export MYDGX_LANGUAGE="${MYDGX_LANGUAGE:-en}"

remote_dir="$1"
stage_dir="$2"
llama_ref="$3"
force_llama_build="$4"
install_ollama="$5"
ollama_version="$6"
[[ "$ollama_version" == "__MYDGX_EMPTY__" ]] && ollama_version=""
install_containers="$7"
install_openwebui="$8"
openwebui_version="$9"
[[ "$openwebui_version" == "__MYDGX_EMPTY__" ]] && openwebui_version=""
install_searxng="${10}"
searxng_image="${11}"
install_comfyui="${12}"
comfyui_ref="${13}"
install_comfyui_models="${14}"
install_hashcat="${15}"
install_whisper="${16}"
whisper_base_image="${17}"
whisper_model="${18}"
restore_database="${19}"
default_profile_id="${20}"
[[ "$default_profile_id" == "__MYDGX_EMPTY__" ]] && default_profile_id=""
deploy_mode="${21}"
interactive_mode="${22}"
openwebui_public_url="${23}"
[[ "$openwebui_public_url" == "__MYDGX_EMPTY__" ]] && openwebui_public_url=""
comfyui_public_url="${24}"
[[ "$comfyui_public_url" == "__MYDGX_EMPTY__" ]] && comfyui_public_url=""
install_duckdns="${25}"
sudo_password_stdin="${26:-0}"
if [[ "$install_duckdns" == "0" &&
      -f /etc/systemd/system/mydgx-duckdns.timer ]]; then
  install_duckdns=1
fi
[[ "$deploy_mode" == "incremental" || "$deploy_mode" == "full" || "$deploy_mode" == "repair" ]] ||
  { say "Modo de despliegue remoto no válido." "Remote deploy mode is not valid." >&2; exit 1; }

# Update after reviewing the new upstream installer/key.
NODESOURCE_KEY_FINGERPRINT="6F71F525282841EEDAF851B42F59B5F99B1BE0B4" # gitleaks:allow — public signing-key fingerprint
OLLAMA_INSTALLER_SHA256="25f64b810b947145095956533e1bdf56eacea2673c55a7e586be4515fc882c9f"
OLLAMA_DEFAULT_VERSION="0.40.16"

log() {
  printf '\n==> %s\n' "$(pick "$@")"
}

valid_switch() {
  [[ "$1" == "0" || "$1" == "1" ]]
}

valid_switch "$force_llama_build" &&
  valid_switch "$install_ollama" &&
  valid_switch "$install_containers" &&
  valid_switch "$install_openwebui" &&
  valid_switch "$install_searxng" &&
  valid_switch "$install_comfyui" &&
  valid_switch "$install_comfyui_models" &&
  valid_switch "$install_hashcat" &&
  valid_switch "$install_whisper" &&
  valid_switch "$install_duckdns" &&
  valid_switch "$restore_database" &&
  valid_switch "$interactive_mode" &&
  valid_switch "$sudo_password_stdin" ||
  { say "Los interruptores de despliegue deben valer 0 o 1." "Deploy switches must be 0 or 1." >&2; exit 1; }
[[ -z "$default_profile_id" || "$default_profile_id" =~ ^[A-Za-z0-9._-]{1,100}$ ]] ||
  { say "DEFAULT_PROFILE_ID remoto no es válido." "Remote DEFAULT_PROFILE_ID is not valid." >&2; exit 1; }
if [[ -n "$openwebui_public_url" ]]; then
  [[ "$openwebui_public_url" =~ ^https?://(127\.0\.0\.1|localhost):([0-9]{1,5})$ ]] ||
    { say "La URL pública remota de Open WebUI no es válida." "Remote Open WebUI public URL is not valid." >&2; exit 1; }
  ((10#${BASH_REMATCH[2]} >= 1 && 10#${BASH_REMATCH[2]} <= 65535)) ||
    { say "El puerto público remoto de Open WebUI no es válido." "Remote Open WebUI public port is not valid." >&2; exit 1; }
fi
if [[ -n "$comfyui_public_url" ]]; then
  [[ "$comfyui_public_url" =~ ^https?://(127\.0\.0\.1|localhost):([0-9]{1,5})$ ]] ||
    { say "La URL pública remota de ComfyUI no es válida." "Remote ComfyUI public URL is not valid." >&2; exit 1; }
  ((10#${BASH_REMATCH[2]} >= 1 && 10#${BASH_REMATCH[2]} <= 65535)) ||
    { say "El puerto público remoto de ComfyUI no es válido." "Remote ComfyUI public port is not valid." >&2; exit 1; }
fi
[[ "$searxng_image" =~ ^[A-Za-z0-9._/:@+-]+$ ]] ||
  { say "La imagen remota de SearXNG no es válida." "Remote SearXNG image is not valid." >&2; exit 1; }
[[ "$comfyui_ref" =~ ^[A-Za-z0-9._/-]+$ ]] ||
  { say "La revisión remota de ComfyUI no es válida." "Remote ComfyUI revision is not valid." >&2; exit 1; }
if [[ "$install_searxng" == "1" &&
      ( "$install_openwebui" != "1" || "$install_containers" != "1" ) ]]; then
  say "SearXNG requiere Open WebUI y contenedores." "SearXNG requires Open WebUI and containers." >&2
  exit 1
fi
if [[ "$install_comfyui_models" == "1" && "$install_comfyui" != "1" ]]; then
  say "Los modelos ComfyUI requieren instalar ComfyUI." "ComfyUI models require ComfyUI to be installed." >&2
  exit 1
fi
sudo_keepalive_pid=""
privileged_deploy=0
[[ "$deploy_mode" == "full" || "$deploy_mode" == "repair" ]] &&
  privileged_deploy=1
if [[ "$install_duckdns" == "1" &&
      ! -f /etc/systemd/system/mydgx-duckdns.timer &&
      "$privileged_deploy" != "1" ]]; then
  say "La primera instalación de DuckDNS requiere --repair --interactive." "First DuckDNS install requires --repair --interactive." >&2
  exit 1
fi
sudo_secret_dir=""
stop_sudo_keepalive() {
  if [[ -n "$sudo_keepalive_pid" ]]; then
    kill "$sudo_keepalive_pid" 2>/dev/null || true
    wait "$sudo_keepalive_pid" 2>/dev/null || true
    sudo_keepalive_pid=""
  fi
  if [[ -n "$sudo_secret_dir" ]]; then
    rm -rf -- "$sudo_secret_dir"
    sudo_secret_dir=""
  fi
}
if [[ "$sudo_password_stdin" == "1" ]]; then
  IFS= read -r sudo_password || [[ -n "$sudo_password" ]] ||
    { say "No se recibió la contraseña de sudo." "No sudo password was received." >&2; exit 1; }
  if [[ "$privileged_deploy" == "1" ]] && ! sudo -n true 2>/dev/null; then
    secret_parent=/dev/shm
    [[ -d "$secret_parent" && -w "$secret_parent" ]] || secret_parent="${TMPDIR:-/tmp}"
    sudo_secret_dir="$(mktemp -d "$secret_parent/mydgx-sudo.XXXXXX")"
    trap stop_sudo_keepalive EXIT
    printf '%s\n' "$sudo_password" >"$sudo_secret_dir/secret"
    printf '#!/bin/sh\nexec cat %q\n' "$sudo_secret_dir/secret" >"$sudo_secret_dir/askpass"
    chmod 0600 "$sudo_secret_dir/secret"
    chmod 0700 "$sudo_secret_dir/askpass"
    export SUDO_ASKPASS="$sudo_secret_dir/askpass"
    # Without a TTY sudo caches credentials per parent process, so pipelines and
    # child scripts would miss the cache; every call reads the private askpass instead.
    sudo() {
      [[ "${1:-}" == "-n" ]] && shift
      command sudo -A "$@"
    }
    export -f sudo
    command sudo -A -v 2>/dev/null ||
      { say "La contraseña de sudo no es correcta." "Sudo password is incorrect." >&2; exit 1; }
  fi
  unset sudo_password
fi
if [[ "$privileged_deploy" == "1" && "$interactive_mode" == "1" ]]; then
  sudo -v ||
    { say "No se pudo validar sudo de forma interactiva." "Could not validate sudo interactively." >&2; exit 1; }
  (
    while true; do
      sleep 60
      sudo -n -v || exit
    done
  ) &
  sudo_keepalive_pid=$!
elif [[ "$privileged_deploy" == "1" ]]; then
  sudo -n true 2>/dev/null ||
    { say "Este --full/--repair necesita sudo: usa también --interactive o --sudo-password-stdin." "This --full/--repair needs sudo: also use --interactive or --sudo-password-stdin." >&2; exit 1; }
else
  log "Deploy incremental sin privilegios de instalación" "Incremental deploy without install privileges"
fi
trap stop_sudo_keepalive EXIT
docker_command=(docker)
if command -v docker >/dev/null 2>&1 &&
   ! docker info >/dev/null 2>&1 &&
   sudo -n docker info >/dev/null 2>&1; then
  docker_command=(sudo -n docker)
fi

glib_runtime_package="libglib2.0-0"
apt-cache show libglib2.0-0t64 >/dev/null 2>&1 &&
  glib_runtime_package="libglib2.0-0t64"
base_packages=(
  build-essential \
  ca-certificates \
  ccache \
  cmake \
  curl \
  ffmpeg \
  git \
  jq \
  libavcodec-dev \
  libavformat-dev \
  libcurl4-openssl-dev \
  libgl1 \
  "$glib_runtime_package" \
  libjpeg-dev \
  libgmp-dev \
  libpcap-dev \
  libopenblas-dev \
  libpng-dev \
  libsndfile1 \
  libsndfile1-dev \
  libsqlite3-dev \
  libssl-dev \
  libswresample-dev \
  libswscale-dev \
  libtiff-dev \
  libwebp-dev \
  ninja-build \
  nvme-cli \
  ocl-icd-opencl-dev \
  p7zip-full \
  pciutils \
  pkg-config \
  python3 \
  python3-dev \
  python3-pip \
  python3-venv \
  rsync \
  smartmontools \
  sqlite3 \
  unzip \
  zlib1g-dev
)
missing_packages=()
for package in "${base_packages[@]}"; do
  dpkg-query -W -f='${db:Status-Status}\n' "$package" 2>/dev/null |
    grep -qx 'installed' || missing_packages+=("$package")
done
if [[ "$deploy_mode" == "full" ]]; then
  log "Modo completo: comprobando e instalando dependencias base" "Full mode: checking and installing base dependencies"
  sudo -n apt-get update
  sudo -n apt-get install -y "${base_packages[@]}"
elif ((${#missing_packages[@]})); then
  if [[ "$privileged_deploy" != "1" ]]; then
    say "Faltan dependencias del sistema: ${missing_packages[*]}" "Missing system dependencies: ${missing_packages[*]}" >&2
    say "Ejecuta de nuevo con --repair --interactive." "Run again with --repair --interactive." >&2
    exit 1
  fi
  log "Instalando únicamente ${#missing_packages[@]} dependencias base ausentes" "Installing only ${#missing_packages[@]} missing base dependencies"
  sudo -n apt-get update
  sudo -n apt-get install -y "${missing_packages[@]}"
else
  log "Dependencias base ya instaladas; se omiten apt update e instalación" "Base dependencies already installed; skipping apt update and install"
fi

python3 - <<'PY'
import os
import sys

es = os.environ.get("MYDGX_LANGUAGE") == "es"
if sys.version_info < (3, 10):
    raise SystemExit(
        "MyDGX necesita Python 3.10 o posterior."
        if es
        else "MyDGX requires Python 3.10 or later."
    )
PY

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
fi
if ((node_major < 20)); then
  [[ "$privileged_deploy" == "1" ]] || {
    say "Node.js 20+ no está instalado; usa --repair --interactive." "Node.js 20+ is not installed; use --repair --interactive." >&2
    exit 1
  }
  log "Instalando Node.js 22 desde el repositorio firmado de NodeSource" "Installing Node.js 22 from the signed NodeSource repository"
  nodesource_key="$(mktemp)"
  nodesource_keyring="$(mktemp)"
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$nodesource_key"
  nodesource_fpr="$(gpg --show-keys --with-colons "$nodesource_key" | awk -F: '$1 == "fpr" { print $10; exit }')"
  if [[ "$nodesource_fpr" != "$NODESOURCE_KEY_FINGERPRINT" ]]; then
    rm -f "$nodesource_key" "$nodesource_keyring"
    say "La clave de NodeSource no coincide con la huella fijada ($nodesource_fpr)." "NodeSource key does not match the pinned fingerprint ($nodesource_fpr)." >&2
    exit 1
  fi
  gpg --dearmor --yes -o "$nodesource_keyring" "$nodesource_key"
  sudo -n install -m 0644 "$nodesource_keyring" /usr/share/keyrings/nodesource.gpg
  printf '%s\n' \
    "Types: deb" \
    "URIs: https://deb.nodesource.com/node_22.x" \
    "Suites: nodistro" \
    "Components: main" \
    "Architectures: $(dpkg --print-architecture)" \
    "Signed-By: /usr/share/keyrings/nodesource.gpg" |
    sudo -n tee /etc/apt/sources.list.d/nodesource.sources >/dev/null
  rm -f "$nodesource_key" "$nodesource_keyring"
  sudo -n apt-get update
  sudo -n apt-get install -y nodejs
fi

export PATH="/usr/local/cuda-13.0/bin:/usr/local/cuda/bin:$PATH"
cuda_major=0
if command -v nvcc >/dev/null 2>&1; then
  cuda_major="$(nvcc --version | sed -nE 's/.*release ([0-9]+).*/\1/p')"
  cuda_major="${cuda_major:-0}"
fi
if ((cuda_major < 13)); then
  [[ "$privileged_deploy" == "1" ]] || {
    say "CUDA Toolkit 13 no está instalado; usa --repair --interactive." "CUDA Toolkit 13 is not installed; use --repair --interactive." >&2
    exit 1
  }
  log "Instalando CUDA Toolkit 13 para GB10/sm_121" "Installing CUDA Toolkit 13 for GB10/sm_121"
  if apt-cache show cuda-toolkit-13-0 >/dev/null 2>&1; then
    sudo -n apt-get install -y cuda-toolkit-13-0
  else
    say "No está disponible cuda-toolkit-13-0 en los repositorios de este DGX OS." "cuda-toolkit-13-0 is not available in this DGX OS repositories." >&2
    say "Configura primero el repositorio CUDA oficial compatible con tu versión de DGX OS." "Configure the official CUDA repository compatible with your DGX OS version first." >&2
    exit 1
  fi
fi
command -v nvcc >/dev/null 2>&1 ||
  { say "CUDA Toolkit 13 no dejó nvcc disponible; no se puede compilar llama.cpp para GB10." "CUDA Toolkit 13 did not make nvcc available; cannot build llama.cpp for GB10." >&2; exit 1; }

app_root="$HOME/$remote_dir"
stage_root="$HOME/$stage_dir"
backup_root="$HOME/${remote_dir}.deploy-backup"
deployment_switched=0
deploy_committed=0
database_replaced=0
database_had_previous=0
database_target=""
database_backup="$backup_root/database/mydgx.db"
code_changed=0
if [[ ! -d "$app_root" ]]; then
  code_changed=1
elif [[ -n "$(
  rsync -ani --delete --no-perms --omit-dir-times \
    --exclude='.env' \
    --exclude='.venv/' \
    --exclude='frontend/node_modules/' \
    --exclude='frontend/dist/' \
    --exclude='.pycache/' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    --exclude='data/' \
    --exclude='logs/' \
    "$stage_root/" "$app_root/"
)" ]]; then
  code_changed=1
fi
if [[ "$code_changed" == "1" ]]; then
  log "Se detectaron cambios en el código; se actualizará y reiniciará MyDGX" "Code changes detected; MyDGX will be updated and restarted"
else
  log "Código sin cambios; se conservarán compilación y procesos activos" "Code unchanged; build and running processes will be kept"
fi

rollback_deploy() {
  local exit_code=$?
  rm -f "${setup_script:-}" "${ollama_installer:-}"
  if [[ "$deploy_committed" != "1" && "$deployment_switched" == "1" && -d "$backup_root" ]]; then
    say "El despliegue no terminó; restaurando la versión anterior." "Deploy did not finish; restoring the previous version." >&2
    rsync -a --delete \
      --exclude='.env' \
      --exclude='.venv/' \
      --exclude='frontend/node_modules/' \
      --exclude='.pycache/' \
      --exclude='__pycache__/' \
      --exclude='*.pyc' \
      --exclude='data/' \
      --exclude='logs/' \
      "$backup_root/" "$app_root/" || true
  fi
  if [[ "$database_replaced" == "1" && -n "$database_target" ]]; then
    say "Restaurando la base de datos anterior." "Restoring the previous database." >&2
    if [[ "$database_had_previous" == "1" && -f "$database_backup" ]]; then
      cp -f -- "$database_backup" "${database_target}.rollback"
      chmod 0600 "${database_target}.rollback"
      mv -f -- "${database_target}.rollback" "$database_target"
    else
      rm -f -- "$database_target"
    fi
    rm -f -- "${database_target}-wal" "${database_target}-shm"
  fi
  if [[ "$deploy_committed" != "1" && "$deployment_switched" == "1" ]]; then
    if [[ -f /etc/systemd/system/mydgx.service ]]; then
      sudo -n systemctl restart mydgx || true
      sudo -n systemctl restart mydgx-gateway || true
    elif [[ -x "$app_root/start.sh" ]]; then
      "$app_root/start.sh" start || true
    fi
  fi
  stop_sudo_keepalive
  exit "$exit_code"
}
trap rollback_deploy EXIT

rm -rf -- "$backup_root"
if [[ -d "$app_root" ]]; then
  mkdir -p "$backup_root"
  rsync -a --delete \
    --exclude='.env' \
    --exclude='.venv/' \
    --exclude='frontend/node_modules/' \
    --exclude='.pycache/' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    --exclude='data/' \
    --exclude='logs/' \
    "$app_root/" "$backup_root/"
fi
mkdir -p "$app_root"
rsync -a --delete \
  --exclude='.env' \
  --exclude='.venv/' \
  --exclude='frontend/node_modules/' \
  --exclude='frontend/dist/' \
  --exclude='.pycache/' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='data/' \
  --exclude='logs/' \
  "$stage_root/" "$app_root/"
deployment_switched=1

chmod +x \
  "$app_root/start.sh" \
  "$app_root/deploy.sh" \
  "$app_root/scripts/deploy-from-tray.sh" \
  "$app_root/scripts/install-hashcat.sh" \
  "$app_root/scripts/install-comfyui.sh" \
  "$app_root/scripts/install-openwebui.sh" \
  "$app_root/scripts/install-searxng.sh" \
  "$app_root/scripts/searxng-container.sh" \
  "$app_root/scripts/install-whisper.sh" \
  "$app_root/scripts/install-whisper-native.sh" \
  "$app_root/scripts/install-tts.sh" \
  "$app_root/scripts/system-repair.sh" \
  "$app_root/scripts/install-systemd.sh" \
  "$app_root/scripts/deploy-summary.py"
llama_tools=(llama-server llama-cli llama-quantize llama-gguf-split)
log "Comprobando integridad de kernel, CUDA, driver y llama.cpp" "Checking kernel, CUDA, driver, and llama.cpp integrity"
repair_required=0
repair_check="$(
  env MYDGX_LLAMA_CPP_REF="$llama_ref" \
    "$app_root/scripts/system-repair.sh" --check
)"
printf '%s\n' "$repair_check"
if [[ "$deploy_mode" == "full" || "$deploy_mode" == "repair" ]]; then
  repair_required=1
elif printf '%s\n' "$repair_check" |
  grep -qE '^(apt_ok|dpkg_ok|dkms_ok|container_runtime_ok|nvidia_ok|llama_ok)=0$|^llama_repair_required=1$'; then
  repair_required=1
fi
if [[ "$repair_required" == "1" ]]; then
  [[ "$privileged_deploy" == "1" ]] || {
    say "La comprobación detectó una reparación del sistema pendiente." "Check detected a pending system repair." >&2
    say "Ejecuta de nuevo con --repair --interactive." "Run again with --repair --interactive." >&2
    exit 1
  }
  effective_force_llama="$force_llama_build"
  [[ "$deploy_mode" == "full" ]] && effective_force_llama=1
  sudo -n env \
    MYDGX_LLAMA_CPP_REF="$llama_ref" \
    MYDGX_FORCE_LLAMA_CPP_BUILD="$effective_force_llama" \
    "$app_root/scripts/system-repair.sh" --repair
else
  log "Integridad sin cambios reparables; se omiten DKMS, runtime y recompilación" "No repairable integrity changes; skipping DKMS, runtime, and rebuild"
fi
llama-server --version

if [[ "$install_hashcat" == "1" ]]; then
  log "Instalando Hashcat con soporte CUDA" "Installing Hashcat with CUDA support"
  "$app_root/scripts/install-hashcat.sh"
fi

if [[ "$install_ollama" == "1" ]]; then
  if ! command -v ollama >/dev/null 2>&1 || [[ -n "$ollama_version" ]]; then
    [[ "$privileged_deploy" == "1" ]] || {
      say "Ollama requiere instalación o cambio de versión; usa --repair --interactive." "Ollama requires install or version change; use --repair --interactive." >&2
      exit 1
    }
    log "Instalando Ollama${ollama_version:+ $ollama_version}" "Installing Ollama${ollama_version:+ $ollama_version}"
    ollama_installer="$(mktemp)"
    curl -fsSL https://ollama.com/install.sh -o "$ollama_installer"
    if ! printf '%s  %s\n' "$OLLAMA_INSTALLER_SHA256" "$ollama_installer" | sha256sum --check --status; then
      rm -f "$ollama_installer"
      say "El instalador de Ollama cambió y no coincide con el SHA-256 fijado." "Ollama installer changed and does not match the pinned SHA-256." >&2
      say "Revísalo y actualiza OLLAMA_INSTALLER_SHA256 en deploy.sh si es legítimo." "Review it and update OLLAMA_INSTALLER_SHA256 in deploy.sh if legitimate." >&2
      exit 1
    fi
    sudo -n env OLLAMA_VERSION="${ollama_version:-$OLLAMA_DEFAULT_VERSION}" sh "$ollama_installer"
    rm -f "$ollama_installer"
  fi
  if systemctl list-unit-files ollama.service >/dev/null 2>&1; then
    if [[ "$privileged_deploy" == "1" ]]; then
      sudo -n systemctl enable --now ollama
    else
      sudo -n systemctl start ollama
    fi
  fi
  ollama --version
fi

docker_ready=0
if [[ "$install_containers" == "1" ]]; then
  log "Preparando Docker y NVIDIA Container Toolkit" "Preparing Docker and NVIDIA Container Toolkit"
  if ! command -v docker >/dev/null 2>&1; then
    [[ "$privileged_deploy" == "1" ]] || {
      say "Docker no está instalado; usa --repair --interactive." "Docker is not installed; use --repair --interactive." >&2
      exit 1
    }
    sudo -n apt-get install -y docker.io
  fi
  if [[ -d /run/systemd/system ]] && systemctl show-environment >/dev/null 2>&1; then
    if [[ "$privileged_deploy" == "1" ]]; then
      sudo -n systemctl enable --now docker
    else
      sudo -n systemctl start docker
    fi
  elif "${docker_command[@]}" info >/dev/null 2>&1; then
    docker_ready=1
  else
    say "Docker está instalado, pero este entorno no usa systemd y no expone un daemon activo." "Docker is installed, but this environment does not use systemd and has no active daemon." >&2
  fi
  if ! command -v nvidia-ctk >/dev/null 2>&1; then
    [[ "$privileged_deploy" == "1" ]] || {
      say "NVIDIA Container Toolkit no está instalado; usa --repair --interactive." "NVIDIA Container Toolkit is not installed; use --repair --interactive." >&2
      exit 1
    }
    if apt-cache show nvidia-container-toolkit >/dev/null 2>&1; then
      sudo -n apt-get install -y nvidia-container-toolkit
    else
      say "AVISO: nvidia-container-toolkit no está en los repositorios configurados." "WARNING: nvidia-container-toolkit is not in the configured repositories." >&2
      say "Los contenedores NIM, Riva, ComfyUI o vLLM con GPU requerirán instalarlo después." "NIM, Riva, ComfyUI, or vLLM GPU containers will require installing it later." >&2
    fi
  fi
  if command -v nvidia-ctk >/dev/null 2>&1; then
    nvidia_runtime_configured=0
    if "${docker_command[@]}" info --format '{{json .Runtimes}}' 2>/dev/null | grep -qi nvidia ||
       jq -e '.runtimes.nvidia' /etc/docker/daemon.json >/dev/null 2>&1; then
      nvidia_runtime_configured=1
    fi
    if [[ "$nvidia_runtime_configured" == "0" ||
          "$deploy_mode" == "full" ||
          "$deploy_mode" == "repair" ]]; then
      [[ "$privileged_deploy" == "1" ]] || {
        say "El runtime NVIDIA de Docker necesita configuración; usa --repair --interactive." "Docker NVIDIA runtime needs configuration; use --repair --interactive." >&2
        exit 1
      }
      sudo -n nvidia-ctk runtime configure --runtime=docker
      if [[ -d /run/systemd/system ]] && systemctl show-environment >/dev/null 2>&1; then
        sudo -n systemctl restart docker
      fi
    else
      log "Runtime NVIDIA de Docker ya configurado; se omite su reconfiguración" "Docker NVIDIA runtime already configured; skipping reconfiguration"
    fi
  fi
  if "${docker_command[@]}" info >/dev/null 2>&1; then
    docker_ready=1
    "${docker_command[@]}" version --format 'Docker {{.Server.Version}}'
  fi
fi
if "${docker_command[@]}" info >/dev/null 2>&1 &&
   { command -v nvidia-ctk >/dev/null 2>&1 ||
     "${docker_command[@]}" info --format '{{json .Runtimes}}' | grep -qi nvidia; }; then
  docker_ready=1
fi

cd "$app_root"
log "Instalando MyDGX" "Installing MyDGX"
MYDGX_FORCE_SETUP="$([[ "$deploy_mode" == "full" ]] && printf 1 || printf 0)" \
  ./start.sh setup

if [[ "$install_duckdns" == "1" ]]; then
  ./.venv/bin/python - "$app_root/.env" <<'PY'
import os
import pathlib
import re
import sys

es = os.environ.get("MYDGX_LANGUAGE") == "es"
path = pathlib.Path(sys.argv[1])
values = {}
for line in path.read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
domain_pattern = r"[A-Za-z0-9-]+(?:\.duckdns\.org)?"
if not re.fullmatch(rf"{domain_pattern}(?:,{domain_pattern})*", values.get("DUCKDNS_DOMAIN", ""), re.IGNORECASE):
    raise SystemExit(
        "DUCKDNS_DOMAIN falta o no es válido en el .env remoto."
        if es
        else "DUCKDNS_DOMAIN is missing or invalid in the remote .env."
    )
if not re.fullmatch(r"[A-Za-z0-9-]{20,128}", values.get("DUCKDNS_TOKEN", "")):
    raise SystemExit(
        "DUCKDNS_TOKEN falta o no es válido en el .env remoto."
        if es
        else "DUCKDNS_TOKEN is missing or invalid in the remote .env."
    )
PY
fi

dashboard_api_key_status="$(
  ./.venv/bin/python - "$app_root/.env" <<'PY'
import pathlib
import secrets
import sys

path = pathlib.Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
key = "MYDGX_API_KEY"
value = ""
for line in lines:
    if line.startswith(f"{key}="):
        value = line.split("=", 1)[1].strip().strip("'\"")
        break
if value:
    print("existing")
    raise SystemExit(0)
value = secrets.token_urlsafe(48)
output = []
updated = False
for line in lines:
    current = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
    if current == key:
        output.append(f"{key}={value}")
        updated = True
    else:
        output.append(line)
if not updated:
    output.append(f"{key}={value}")
temporary = path.with_suffix(".new")
temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
temporary.chmod(0o600)
temporary.replace(path)
print("generated")
PY
)"
if [[ "$dashboard_api_key_status" == "generated" ]]; then
  log "Clave API del dashboard generada y guardada de forma privada" "Dashboard API key generated and saved privately"
else
  log "Clave API del dashboard ya configurada; se conserva" "Dashboard API key already configured; keeping it"
fi

if [[ -n "$default_profile_id" ]]; then
  log "Configurando perfil predeterminado $default_profile_id" "Setting default profile $default_profile_id"
  ./.venv/bin/python - "$app_root/.env" "$default_profile_id" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
value = sys.argv[2]
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
output = []
updated = False
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
    if key == "DEFAULT_PROFILE_ID":
        output.append(f"DEFAULT_PROFILE_ID={value}")
        updated = True
    else:
        output.append(line)
if not updated:
    output.append(f"DEFAULT_PROFILE_ID={value}")
temporary = path.with_suffix(".new")
temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
temporary.chmod(0o600)
temporary.replace(path)
PY
fi

component_state() {
  {
    for state_file in \
      "$HOME/.local/share/mydgx/open-webui/.install-fingerprint" \
      "$HOME/.local/share/mydgx/open-webui/open-webui.env" \
      "$HOME/.local/share/mydgx/whisper/.install-fingerprint" \
      "$HOME/.local/share/mydgx/whisper/whisper.env" \
      "$HOME/.local/share/mydgx/comfyui/.requested-ref" \
      "$HOME/.local/share/mydgx/comfyui/comfyui.env" \
      "$HOME/.local/share/mydgx/searxng/.install-fingerprint" \
      "$HOME/.local/share/mydgx/searxng/settings.yml"; do
      [[ -f "$state_file" ]] && sha256sum "$state_file"
    done
    "${docker_command[@]}" image inspect --format '{{.Id}}' mydgx-whisper:20250625 2>/dev/null || true
  } | sha256sum | cut -d' ' -f1
}
component_state_before="$(component_state)"

if [[ "$install_whisper" == "1" ]]; then
  if [[ "${docker_ready:-0}" == "1" &&
        -d /run/systemd/system ]] &&
       systemctl show-environment >/dev/null 2>&1; then
    if [[ "$privileged_deploy" == "1" ]]; then
      log "Instalando Whisper OpenAI-compatible en contenedor NVIDIA para GB10" "Installing OpenAI-compatible Whisper in NVIDIA container for GB10"
      MYDGX_FORCE_INSTALL="$([[ "$deploy_mode" == "full" ]] && printf 1 || printf 0)" \
        ./scripts/install-whisper.sh "$app_root" "$whisper_base_image" "$whisper_model"
    elif [[ ! -f /etc/systemd/system/mydgx-whisper.service ]] ||
         ! "${docker_command[@]}" image inspect mydgx-whisper:20250625 >/dev/null 2>&1; then
      say "Whisper necesita bootstrap; usa --repair --interactive." "Whisper needs bootstrap; use --repair --interactive." >&2
      exit 1
    else
      whisper_source_fingerprint="$(
        {
          printf 'base=%s\n' "$whisper_base_image"
          find "$app_root/services/whisper" -maxdepth 1 -type f -print0 |
            sort -z | xargs -0 sha256sum
        } | sha256sum | cut -d' ' -f1
      )"
      whisper_image_fingerprint="$(
        "${docker_command[@]}" image inspect \
          --format '{{ index .Config.Labels "org.mydgx.fingerprint" }}' \
          mydgx-whisper:20250625 2>/dev/null || true
      )"
      if [[ "$whisper_source_fingerprint" != "$whisper_image_fingerprint" ]]; then
        if sudo -n docker info >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
          log "Servicio Whisper modificado; reconstruyendo la imagen" "Whisper service changed; rebuilding image"
          MYDGX_FORCE_INSTALL=0 \
            ./scripts/install-whisper.sh "$app_root" "$whisper_base_image" "$whisper_model"
        else
          say "AVISO: el servicio Whisper cambió, pero no hay sudo sin contraseña para reconstruirlo; usa --repair." "WARNING: Whisper service changed, but passwordless sudo is unavailable to rebuild it; use --repair." >&2
        fi
      else
        log "Whisper ya instalado y actualizado; se conserva en el deploy incremental" "Whisper already installed and up to date; kept on incremental deploy"
      fi
    fi
  else
    log "Docker/systemd no disponible; instalando Whisper nativo sobre PyTorch CUDA" "Docker/systemd unavailable; installing native Whisper on PyTorch CUDA"
    MYDGX_FORCE_INSTALL="$([[ "$deploy_mode" == "full" ]] && printf 1 || printf 0)" \
      ./scripts/install-whisper-native.sh "$app_root" "$whisper_model"
  fi
  ./.venv/bin/python - "$app_root/.env" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
key = "WHISPER_URL"
value = "http://127.0.0.1:9000"
updated = False
output = []
for line in lines:
    current = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
    if current == key:
        output.append(f"{key}={value}")
        updated = True
    else:
        output.append(line)
if not updated:
    output.append(f"{key}={value}")
path.write_text("\n".join(output) + "\n", encoding="utf-8")
PY
  chmod 0600 "$app_root/.env"
fi

if [[ "${docker_ready:-0}" == "1" && -d /run/systemd/system ]] &&
   sudo -n docker info >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  hf_hub_dir="$(./.venv/bin/python -c 'from backend.main import huggingface_cache_dir; print(huggingface_cache_dir().resolve())' 2>/dev/null)"
  log "Comprobando el runtime TTS CUDA gestionado" "Checking managed CUDA TTS runtime"
  MYDGX_FORCE_INSTALL=0 ./scripts/install-tts.sh "$app_root" "$hf_hub_dir" ||
    say "AVISO: el runtime TTS CUDA no se pudo instalar; los modelos TTS quedarán bloqueados en el benchmark." "WARNING: CUDA TTS runtime could not be installed; TTS models will be blocked in the benchmark." >&2
else
  say "AVISO: sin Docker y sudo no interactivo no se instala el runtime TTS CUDA." "WARNING: without Docker and non-interactive sudo, CUDA TTS runtime is not installed." >&2
fi

if [[ "$restore_database" == "1" ]]; then
  log "Restaurando la base de datos MyDGX indicada" "Restoring the specified MyDGX database"
  incoming_database="$stage_root/.mydgx-restore.db"
  [[ -f "$incoming_database" && ! -L "$incoming_database" ]] ||
    { say "No se recibió la base de datos solicitada." "Requested database was not received." >&2; exit 1; }
  database_target="$(
    ./.venv/bin/python - <<'PY'
import pathlib
from backend.main import settings

path = pathlib.Path(settings.database_path).expanduser()
if not path.is_absolute():
    path = pathlib.Path.cwd() / path
print(path.resolve())
PY
  )"
  ./.venv/bin/python - "$incoming_database" <<'PY'
import os
import pathlib
import sqlite3
import sys

es = os.environ.get("MYDGX_LANGUAGE") == "es"
path = pathlib.Path(sys.argv[1])
with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
    result = connection.execute("PRAGMA quick_check").fetchone()
if not result or result[0] != "ok":
    raise SystemExit(
        "La base recibida no superó PRAGMA quick_check."
        if es
        else "Received database failed PRAGMA quick_check."
    )
PY
  mkdir -p -- "$(dirname "$database_target")" "$(dirname "$database_backup")"
  if [[ -f "$database_target" ]]; then
    ./.venv/bin/python - "$database_target" "$database_backup" <<'PY'
import sqlite3
import sys

with sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True) as source:
    with sqlite3.connect(sys.argv[2]) as destination:
        source.backup(destination)
PY
    chmod 0600 "$database_backup"
    database_had_previous=1
  fi
  ./start.sh stop
  cp -- "$incoming_database" "${database_target}.new"
  chmod 0600 "${database_target}.new"
  mv -f -- "${database_target}.new" "$database_target"
  rm -f -- "${database_target}-wal" "${database_target}-shm"
  database_replaced=1
fi

if [[ "$install_searxng" == "0" ]]; then
  rm -f "$HOME/.local/share/mydgx/searxng/enabled"
fi
if [[ "$install_comfyui" == "0" ]]; then
  rm -f "$HOME/.local/share/mydgx/comfyui/enabled"
fi

if [[ "$install_comfyui" == "1" ]]; then
  log "Instalando ComfyUI con PyTorch CUDA 13" "Installing ComfyUI with PyTorch CUDA 13"
  MYDGX_FORCE_INSTALL="$([[ "$deploy_mode" == "full" ]] && printf 1 || printf 0)" \
    ./scripts/install-comfyui.sh \
    "$app_root" \
    "$comfyui_ref" \
    "$install_comfyui_models"
fi

if [[ "$install_openwebui" == "1" ]]; then
  log "Instalando Open WebUI como servicio local" "Installing Open WebUI as a local service"
  gateway_port="$(
    ./.venv/bin/python - <<'PY'
from backend.main import db, gateway_runtime_config
db.initialize()
print(gateway_runtime_config()["port"])
PY
  )"
  tool_api_key="$(
    ./.venv/bin/python - "$app_root/.env" "$openwebui_public_url" "$comfyui_public_url" <<'PY'
import pathlib
import re
import secrets
import sys

path = pathlib.Path(sys.argv[1])
requested_public_url = sys.argv[2]
requested_comfyui_public_url = sys.argv[3]
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
openwebui_public_url = "http://127.0.0.1:13000"
comfyui_public_url = "http://127.0.0.1:18188"
for line in lines:
    if line.startswith("OPENWEBUI_PUBLIC_URL="):
        candidate = line.split("=", 1)[1].strip().strip("'\"").rstrip("/")
        match = re.fullmatch(r"https?://(?:127\.0\.0\.1|localhost):([0-9]{1,5})", candidate)
        if match and 1 <= int(match.group(1)) <= 65535:
            openwebui_public_url = candidate
    elif line.startswith("COMFYUI_PUBLIC_URL="):
        candidate = line.split("=", 1)[1].strip().strip("'\"").rstrip("/")
        match = re.fullmatch(r"https?://(?:127\.0\.0\.1|localhost):([0-9]{1,5})", candidate)
        if match and 1 <= int(match.group(1)) <= 65535:
            comfyui_public_url = candidate
if requested_public_url:
    openwebui_public_url = requested_public_url
if requested_comfyui_public_url:
    comfyui_public_url = requested_comfyui_public_url
updates = {
    "GATEWAY_ENABLED": "true",
    "OPENWEBUI_URL": "http://127.0.0.1:3000",
    "OPENWEBUI_PUBLIC_URL": openwebui_public_url,
    "COMFYUI_URL": "http://127.0.0.1:8188",
    "COMFYUI_PUBLIC_URL": comfyui_public_url,
}
existing_tool_key = ""
for line in lines:
    if line.startswith("OPENWEBUI_TOOL_API_KEY="):
        existing_tool_key = line.split("=", 1)[1].strip().strip("'\"")
        break
if not re.fullmatch(r"[A-Za-z0-9_-]{32,}", existing_tool_key):
    existing_tool_key = secrets.token_urlsafe(48)
updates["OPENWEBUI_TOOL_API_KEY"] = existing_tool_key
seen = set()
output = []
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
    if key in updates:
        output.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        output.append(line)
for key, value in updates.items():
    if key not in seen:
        output.append(f"{key}={value}")
temporary = path.with_suffix(".new")
temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
temporary.chmod(0o600)
temporary.replace(path)
print(existing_tool_key)
PY
  )"
  mydgx_port="$(
    ./.venv/bin/python - <<'PY'
from backend.main import settings
print(settings.port)
PY
  )"
  chmod +x ./scripts/install-openwebui.sh
  searxng_query_url=""
  if [[ "$install_searxng" == "1" ]]; then
    log "Instalando buscador privado SearXNG" "Installing private SearXNG search"
    MYDGX_FORCE_INSTALL="$([[ "$deploy_mode" == "full" ]] && printf 1 || printf 0)" \
      ./scripts/install-searxng.sh \
      "$HOME/.local/share/mydgx/searxng" \
      "$searxng_image" \
      "$([[ "${docker_ready:-0}" == "1" ]] && printf container || printf native)"
    searxng_query_url="http://127.0.0.1:8888/search"
  fi
  comfyui_workflow=""
  comfyui_nodes=""
  if [[ "$install_comfyui" == "1" ]]; then
    comfyui_workflow="$app_root/config/comfyui/image-workflow-api.json"
    comfyui_nodes="$app_root/config/comfyui/image-workflow-nodes.json"
  fi
  MYDGX_FORCE_INSTALL="$([[ "$deploy_mode" == "full" ]] && printf 1 || printf 0)" \
    ./scripts/install-openwebui.sh \
    "$app_root" \
    "$gateway_port" \
    "$openwebui_version" \
    "$searxng_query_url" \
    "$comfyui_workflow" \
    "$comfyui_nodes" \
    "$tool_api_key" \
    "$mydgx_port"
fi

component_state_after="$(component_state)"
component_changed=0
[[ "$component_state_before" == "$component_state_after" ]] || component_changed=1
restart_required=0
if [[ "$code_changed" == "1" ||
      "$component_changed" == "1" ||
      "$repair_required" == "1" ||
      "$restore_database" == "1" ||
      "$deploy_mode" != "incremental" ]]; then
  restart_required=1
fi
component_restart_required=0
if [[ "$component_changed" == "1" ||
      "$repair_required" == "1" ||
      "$deploy_mode" != "incremental" ]]; then
  component_restart_required=1
fi

if [[ "$deploy_mode" == "repair" ]]; then
  # Quick models survive plain deploys, but not a repair.
  mkdir -p "$app_root/data"
  : > "$app_root/data/.quick-reset"
fi

if [[ -d /run/systemd/system ]] &&
   command -v systemctl >/dev/null 2>&1 &&
   systemctl show-environment >/dev/null 2>&1; then
  if [[ "$privileged_deploy" == "1" ]]; then
    log "Instalando servicios systemd" "Installing systemd services"
    sudo -n env MYDGX_LANGUAGE="${MYDGX_LANGUAGE:-en}" ./scripts/install-systemd.sh \
      "$app_root" \
      "$(id -un)" \
      "$llama_ref" \
      "$install_searxng" \
      "$install_comfyui" \
      "$install_duckdns"
  else
    expected_systemd_fingerprint="$(
      {
        for fingerprint_file in \
          "$app_root/scripts/install-systemd.sh" \
          "$app_root/scripts/system-repair.sh" \
          "$app_root/scripts/nvme-smart-reader.sh" \
          "$app_root/scripts/duckdns-update.sh"; do
          sha256sum "$fingerprint_file" | awk '{print $1}'
        done
        printf 'root=%s\nuser=%s\nllama=%s\nsearxng=%s\ncomfyui=%s\nduckdns=%s\n' \
          "$app_root" "$(id -un)" "$llama_ref" "$install_searxng" "$install_comfyui" "$install_duckdns"
      } | sha256sum | awk '{print $1}'
    )"
    installed_systemd_fingerprint=""
    [[ -r /etc/mydgx/systemd-install.sha256 ]] &&
      installed_systemd_fingerprint="$(cat /etc/mydgx/systemd-install.sha256)"
    [[ "$expected_systemd_fingerprint" == "$installed_systemd_fingerprint" ]] || {
      say "La configuración privilegiada de systemd cambió." "Privileged systemd configuration changed." >&2
      say "Ejecuta una vez con --repair --interactive." "Run once with --repair --interactive." >&2
      exit 1
    }
    required_units=(
      /etc/systemd/system/mydgx.service
      /etc/systemd/system/mydgx-gateway.service
      /etc/systemd/system/mydgx-repair.service
    )
    for unit in "${required_units[@]}"; do
      [[ -f "$unit" ]] || {
        say "Falta el servicio $unit; usa --repair --interactive." "Missing service $unit; use --repair --interactive." >&2
        exit 1
      }
    done
    log "Servicios systemd existentes; se omite su reinstalación" "Existing systemd services; skipping reinstallation"
  fi
  if [[ "$restart_required" == "1" ]]; then
    sudo -n systemctl restart mydgx-repair
    sudo -n systemctl restart mydgx
    sudo -n systemctl restart mydgx-gateway
  else
    log "Código, configuración y componentes sin cambios; se omite reinicio de servicios" "Code, configuration, and components unchanged; skipping service restart"
  fi
  gateway_port="$(
    ./.venv/bin/python - <<'PY'
from backend.main import db, gateway_runtime_config
db.initialize()
print(gateway_runtime_config()["port"])
PY
  )"
  for _ in {1..60}; do
    curl -fsS "http://127.0.0.1:${gateway_port}/health" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fsS "http://127.0.0.1:${gateway_port}/health" >/dev/null 2>&1 ||
    { say "El gateway MyDGX no respondió en el puerto ${gateway_port}." "MyDGX gateway did not respond on port ${gateway_port}." >&2; exit 1; }
  if [[ "$install_comfyui" == "1" &&
        -f /etc/systemd/system/mydgx-comfyui.service ]]; then
    if systemctl is-enabled --quiet mydgx-comfyui.service; then
      sudo -n systemctl start mydgx-comfyui
      [[ "$component_restart_required" == "0" ]] ||
        sudo -n systemctl restart mydgx-comfyui
      for _ in {1..300}; do
        curl -fsS http://127.0.0.1:8188/system_stats >/dev/null 2>&1 && break
        sleep 1
      done
      curl -fsS http://127.0.0.1:8188/system_stats >/dev/null 2>&1 ||
        { say "ComfyUI no respondió en el puerto 8188." "ComfyUI did not respond on port 8188." >&2; exit 1; }
    else
      log "ComfyUI permanece desactivado" "ComfyUI remains disabled"
    fi
  fi
  if [[ "$install_searxng" == "1" &&
        -f /etc/systemd/system/mydgx-searxng.service ]]; then
    if systemctl is-enabled --quiet mydgx-searxng.service; then
      sudo -n systemctl start mydgx-searxng
      [[ "$component_restart_required" == "0" ]] ||
        sudo -n systemctl restart mydgx-searxng
      for _ in {1..120}; do
        curl -fsS "http://127.0.0.1:8888/search?q=DGX&format=json" 2>/dev/null |
          jq -e '.results | type == "array"' >/dev/null 2>&1 && break
        sleep 1
      done
      curl -fsS "http://127.0.0.1:8888/search?q=DGX&format=json" 2>/dev/null |
        jq -e '.results | type == "array"' >/dev/null 2>&1 ||
        { say "SearXNG no respondió con resultados JSON." "SearXNG did not respond with JSON results." >&2; exit 1; }
    else
      log "SearXNG permanece desactivado" "SearXNG remains disabled"
    fi
  fi
  if [[ "$install_openwebui" == "1" ]]; then
    sudo -n systemctl start open-webui
    [[ "$component_restart_required" == "0" ]] ||
      sudo -n systemctl restart open-webui
    for _ in {1..300}; do
      curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1 && break
      sleep 1
    done
    curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1 ||
      { say "Open WebUI no respondió en el puerto 3000." "Open WebUI did not respond on port 3000." >&2; exit 1; }
  fi
  if [[ "$install_whisper" == "1" &&
        -f /etc/systemd/system/mydgx-whisper.service ]]; then
    if systemctl is-enabled --quiet mydgx-whisper.service; then
      sudo -n systemctl start mydgx-whisper
      [[ "$component_restart_required" == "0" ]] ||
        sudo -n systemctl restart mydgx-whisper
      payload=""
      for _ in {1..180}; do
        payload="$(curl -fsS http://127.0.0.1:9000/health 2>/dev/null || true)"
        printf '%s' "$payload" | jq -e '.status == "ok" and .cuda == true' >/dev/null 2>&1 && break
        sleep 1
      done
      printf '%s' "$payload" | jq -e '.status == "ok" and .cuda == true' >/dev/null ||
        { say "Whisper no respondió con CUDA en el puerto 9000." "Whisper did not respond with CUDA on port 9000." >&2; exit 1; }
    else
      log "Whisper permanece desactivado" "Whisper remains disabled"
    fi
  fi
else
  if [[ "$restart_required" == "1" ]]; then
    log "systemd no está activo; reiniciando el supervisor local por cambios" "systemd is not active; restarting local supervisor due to changes"
    ./start.sh restart
  else
    log "systemd no está activo y no hay cambios; se conservan los procesos locales" "systemd is not active and no changes; keeping local processes"
  fi
  gateway_port="$(
    ./.venv/bin/python - <<'PY'
from backend.main import db, gateway_runtime_config
db.initialize()
print(gateway_runtime_config()["port"])
PY
  )"
  curl -fsS "http://127.0.0.1:${gateway_port}/health" >/dev/null 2>&1 ||
    { say "El gateway MyDGX no respondió en el puerto ${gateway_port}." "MyDGX gateway did not respond on port ${gateway_port}." >&2; exit 1; }
  if [[ "$install_comfyui" == "1" ]]; then
    curl -fsS http://127.0.0.1:8188/system_stats >/dev/null 2>&1 ||
      { say "ComfyUI no respondió en el puerto 8188." "ComfyUI did not respond on port 8188." >&2; exit 1; }
  fi
  if [[ "$install_searxng" == "1" ]]; then
    curl -fsS "http://127.0.0.1:8888/search?q=DGX&format=json" 2>/dev/null |
      jq -e '.results | type == "array"' >/dev/null 2>&1 ||
      { say "SearXNG no respondió con resultados JSON." "SearXNG did not respond with JSON results." >&2; exit 1; }
  fi
  if [[ "$install_openwebui" == "1" ]]; then
    for _ in {1..300}; do
      curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1 && break
      sleep 1
    done
    curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1 ||
      { say "Open WebUI no respondió en el puerto 3000." "Open WebUI did not respond on port 3000." >&2; exit 1; }
  fi
  if [[ "$install_whisper" == "1" ]]; then
    for _ in {1..180}; do
      payload="$(curl -fsS http://127.0.0.1:9000/health 2>/dev/null || true)"
      printf '%s' "$payload" | jq -e '.status == "ok" and .cuda == true' >/dev/null 2>&1 && break
      sleep 1
    done
    printf '%s' "$payload" | jq -e '.status == "ok" and .cuda == true' >/dev/null ||
      { say "Whisper nativo no respondió con CUDA en el puerto 9000." "Native Whisper did not respond with CUDA on port 9000." >&2; exit 1; }
  fi
fi

if [[ "$install_ollama" == "1" ]]; then
  IFS=$'\t' read -r assistant_enabled assistant_model < <(
    ./.venv/bin/python - <<'PY'
from backend.main import settings

print(
    ("1" if settings.assistant_enabled else "0")
    + "\t"
    + settings.assistant_model.strip()
)
PY
  )
  if [[ "$assistant_enabled" == "1" &&
        -n "$assistant_model" &&
        "${assistant_model,,}" != "auto" &&
        "$assistant_model" != profile:* ]]; then
    [[ "$assistant_model" =~ ^[A-Za-z0-9._:/@-]{1,200}$ ]] ||
      { say "ASSISTANT_MODEL no es una referencia Ollama válida." "ASSISTANT_MODEL is not a valid Ollama reference." >&2; exit 1; }
    if ! ollama show "$assistant_model" >/dev/null 2>&1; then
      log "Descargando modelo local del chatbot: $assistant_model" "Downloading local chatbot model: $assistant_model"
      ollama pull "$assistant_model"
    fi
  fi
fi

./start.sh status

log "Comprobando preparación de MyDGX" "Checking MyDGX readiness"
./.venv/bin/python - <<'PY'
import asyncio
import os

from backend.main import system_readiness

es = os.environ.get("MYDGX_LANGUAGE") == "es"
result = asyncio.run(system_readiness())
warnings = [check for check in result["checks"] if check["status"] == "warning"]
if not warnings:
    if es:
        print(f"Sistema listo: {result['summary']['ok']} comprobaciones correctas.")
    else:
        print(f"System ready: {result['summary']['ok']} checks passed.")
else:
    if es:
        print(f"El sistema requiere atención: {len(warnings)} aviso(s).")
    else:
        print(f"System needs attention: {len(warnings)} warning(s).")
    for check in warnings:
        print(f"- {check['label']}: {check['detail']}")
        if check["remediation"]:
            if es:
                print(f"  Solución: {check['remediation']}")
            else:
                print(f"  Fix: {check['remediation']}")
PY

log "Versiones desplegadas" "Deployed versions"
python3 --version
node --version
ffmpeg -version | sed -n '1p'
nvcc --version | tail -n1
for tool in "${llama_tools[@]}"; do
  printf '%s: ' "$tool"
  "$tool" --version 2>&1 | sed -n '1p' || true
done
command -v ollama >/dev/null 2>&1 && ollama --version || true
command -v nvidia-ctk >/dev/null 2>&1 && nvidia-ctk --version || true
[[ -x "$HOME/.local/bin/hashcat" ]] && "$HOME/.local/bin/hashcat" --version || true

log "Resumen final del despliegue" "Final deploy summary"
./.venv/bin/python ./scripts/deploy-summary.py || \
  say "AVISO: no se pudo completar todo el resumen; MyDGX sigue desplegado." "WARNING: could not complete the full summary; MyDGX remains deployed." >&2

log "Apps instaladas" "Installed apps"
./.venv/bin/python - <<'PY' || say "AVISO: no se pudieron listar las apps instaladas." "WARNING: could not list installed apps." >&2
import os

from backend.main import ROOT, db, discover_profile_apps, profile_apps_root

es = os.environ.get("MYDGX_LANGUAGE") == "es"
root = profile_apps_root()
apps = discover_profile_apps()
db.initialize()
used: dict[str, list[str]] = {}
for row in db.rows("SELECT name, app FROM profiles WHERE COALESCE(app, '') != '' ORDER BY name"):
    used.setdefault(str(row["app"]), []).append(str(row["name"]))
if es:
    print(f"Carpeta de apps: {root}")
else:
    print(f"Apps folder: {root}")
if not apps:
    print(
        "No hay apps con un start.sh propio en esa carpeta."
        if es
        else "No apps with their own start.sh in that folder."
    )
for name in apps:
    profiles = used.get(name)
    if es:
        print(f"- {name}: " + (f"perfil {', '.join(profiles)}" if profiles else "sin perfil asignado"))
    else:
        print(f"- {name}: " + (f"profile {', '.join(profiles)}" if profiles else "no profile assigned"))
try:
    rejected = sorted(
        item.name for item in root.iterdir()
        if not item.name.startswith(".") and item.name not in apps
        and (item / "start.sh").exists() and item.resolve() != ROOT.resolve()
    )
except OSError:
    rejected = []
if rejected:
    if es:
        print(
            "Ignoradas (start.sh enlazado, de otro usuario, escribible por otros o fuera de PROFILE_APPS): "
            + ", ".join(rejected)
        )
    else:
        print(
            "Ignored (symlinked start.sh, other user, world-writable, or outside PROFILE_APPS): "
            + ", ".join(rejected)
        )
missing = sorted(set(used) - set(apps))
if missing:
    if es:
        print(
            "AVISO: perfiles que apuntan a apps no disponibles: "
            + ", ".join(f"{app} ({', '.join(used[app])})" for app in missing)
        )
    else:
        print(
            "WARNING: profiles pointing to unavailable apps: "
            + ", ".join(f"{app} ({', '.join(used[app])})" for app in missing)
        )
PY

./.venv/bin/python - <<'PY'
import os

from backend.main import db

es = os.environ.get("MYDGX_LANGUAGE") == "es"
db.initialize()
db.log(
    "info",
    "deployment",
    "application.deploy",
    "Despliegue de MyDGX completado" if es else "MyDGX deploy completed",
    entity_type="application",
    entity_id="MyDGX",
    detail={"source": "deploy.sh", "result": "completed"},
)
PY
deploy_committed=1
rm -rf -- "$backup_root" "$stage_root"
stop_sudo_keepalive
trap - EXIT
REMOTE
remote_args=(
  "$REMOTE_DIR"
  "$REMOTE_STAGE"
  "$LLAMA_CPP_REF"
  "$FORCE_LLAMA_BUILD"
  "$INSTALL_OLLAMA"
  "$ollama_version_arg"
  "$INSTALL_CONTAINERS"
  "$INSTALL_OPENWEBUI"
  "${OPENWEBUI_VERSION:-__MYDGX_EMPTY__}"
  "$INSTALL_SEARXNG"
  "$SEARXNG_IMAGE"
  "$INSTALL_COMFYUI"
  "$COMFYUI_REF"
  "$INSTALL_COMFYUI_MODELS"
  "$INSTALL_HASHCAT"
  "$INSTALL_WHISPER"
  "$WHISPER_BASE_IMAGE"
  "$WHISPER_MODEL"
  "$restore_database"
  "${DEFAULT_PROFILE_ID:-__MYDGX_EMPTY__}"
  "$DEPLOY_MODE"
  "$INTERACTIVE"
  "${OPENWEBUI_PUBLIC_URL:-__MYDGX_EMPTY__}"
  "${COMFYUI_PUBLIC_URL:-__MYDGX_EMPTY__}"
  "$INSTALL_DUCKDNS"
  "$SUDO_PASSWORD_STDIN"
)
if [[ "$SUDO_PASSWORD_STDIN" == "1" ]]; then
  printf '%s\n' "$sudo_password" |
    ssh "${remote_ssh_args[@]}" "$ssh_user@$host" env MYDGX_LANGUAGE="$MYDGX_LANGUAGE" bash "$remote_runtime" "${remote_args[@]}"
else
  ssh "${remote_ssh_args[@]}" "$ssh_user@$host" env MYDGX_LANGUAGE="$MYDGX_LANGUAGE" bash "$remote_runtime" "${remote_args[@]}"
fi
