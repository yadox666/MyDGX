#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
PYTHON="$VENV/bin/python"
PID_DIR="$ROOT/data"
LOG_DIR="$ROOT/logs"
PID_FILE="$PID_DIR/mydgx.pid"
GATEWAY_PID="$PID_DIR/mydgx-gateway.pid"
OPENWEBUI_PID="$PID_DIR/open-webui.pid"
COMFYUI_PID="$PID_DIR/comfyui.pid"
WHISPER_PID="$PID_DIR/mydgx-whisper.pid"
OLLAMA_PID="$PID_DIR/ollama.pid"
DEV_WEB_PID="$PID_DIR/mydgx-web.pid"
LOG_FILE="$LOG_DIR/mydgx.log"
GATEWAY_LOG_FILE="$LOG_DIR/gateway.log"
OPENWEBUI_LOG_FILE="$LOG_DIR/open-webui.log"
COMFYUI_LOG_FILE="$LOG_DIR/comfyui.log"
WHISPER_LOG_FILE="$LOG_DIR/whisper.log"
OLLAMA_LOG_FILE="$LOG_DIR/ollama.log"
SEARXNG_ROOT="$HOME/.local/share/mydgx/searxng"
SEARXNG_RUNNER="$ROOT/scripts/searxng-container.sh"
DGX_TEST_SCRIPT="$ROOT/scripts/dgx-spark-health-check.sh"
DGX_TEST_CONFIG_DIR="$ROOT/config/dgx-health-check"
DGX_TEST_CONFIG_EXAMPLE="$DGX_TEST_CONFIG_DIR/dgx-spark.env.example"
DGX_TEST_CONFIG="$DGX_TEST_CONFIG_DIR/dgx-spark.env"
DGX_DISCOVERY_SCRIPT="$ROOT/scripts/discover-dgx.py"
DGX_TRAY_ADD_SCRIPT="$ROOT/scripts/add-dgx-to-tray.py"
SERVERIZE_SCRIPT="$ROOT/scripts/serverize-os.sh"

# shellcheck source=scripts/lib/language.sh
source "$ROOT/scripts/lib/language.sh"

mkdir -p "$PID_DIR" "$LOG_DIR"

deploy() {
  [[ -f "$ROOT/deploy.sh" ]] || {
    say "No se encontró deploy.sh." "deploy.sh not found." >&2
    exit 1
  }
  exec bash "$ROOT/deploy.sh" "$@"
}

is_running() {
  [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null
}

ensure_env() {
  if [[ ! -f "$ROOT/.env" ]]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    say "Creado .env. Revisa sus valores antes de exponer MyDGX en la red." "Created .env. Review its values before exposing MyDGX on the network."
  fi
}

setup() {
  ensure_env
  local force_setup="${MYDGX_FORCE_SETUP:-0}"
  [[ "$force_setup" =~ ^[01]$ ]] || {
    say "MYDGX_FORCE_SETUP debe valer 0 o 1." "MYDGX_FORCE_SETUP must be 0 or 1." >&2
    exit 2
  }
  command -v python3 >/dev/null 2>&1 || {
    say "MyDGX necesita Python 3.10 o posterior." "MyDGX requires Python 3.10 or later." >&2
    exit 1
  }
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
  local frontend_fingerprint current_frontend_fingerprint frontend_rebuild
  frontend_fingerprint="$(
    python3 - "$ROOT/frontend" <<'PY'
import hashlib
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
digest = hashlib.sha256()
for relative in ("package.json", "package-lock.json", "tsconfig.json", "tsconfig.app.json", "vite.config.ts"):
    path = root / relative
    if path.is_file():
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
for path in sorted((root / "src").rglob("*")):
    if path.is_file():
        digest.update(str(path.relative_to(root)).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
print(digest.hexdigest())
PY
  )"
  current_frontend_fingerprint=""
  [[ -f "$ROOT/frontend/dist/.mydgx-fingerprint" ]] &&
    current_frontend_fingerprint="$(cat "$ROOT/frontend/dist/.mydgx-fingerprint")"
  frontend_rebuild=0
  if [[ "$force_setup" == "1" ||
        ! -f "$ROOT/frontend/dist/index.html" ||
        "$frontend_fingerprint" != "$current_frontend_fingerprint" ]]; then
    frontend_rebuild=1
  fi
  if [[ "${MYDGX_USE_PREBUILT_FRONTEND:-0}" == "1" ]]; then
    [[ -f "$ROOT/frontend/dist/index.html" ]] || {
      say "No se encontró el frontend precompilado en frontend/dist." "Prebuilt frontend not found in frontend/dist." >&2
      exit 1
    }
    say "Usando frontend precompilado." "Using prebuilt frontend."
    frontend_rebuild=0
  elif [[ "$frontend_rebuild" == "1" ]]; then
    command -v npm >/dev/null 2>&1 || {
      say "MyDGX necesita Node.js 20 o posterior y npm." "MyDGX requires Node.js 20 or later and npm." >&2
      exit 1
    }
    node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
    if ((node_major < 20)); then
      local node_ver; node_ver="$(node --version)"
      say "MyDGX necesita Node.js 20 o posterior; detectado $node_ver." "MyDGX requires Node.js 20 or later; detected $node_ver." >&2
      exit 1
    fi

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
    if [[ "$force_setup" == "1" ||
          ! -d "$ROOT/frontend/node_modules" ||
          "$dependency_fingerprint" != "$installed_dependency_fingerprint" ]]; then
      say "Dependencias frontend modificadas; ejecutando npm ci." "Frontend dependencies changed; running npm ci."
      npm --prefix "$ROOT/frontend" ci
      printf '%s\n' "$dependency_fingerprint" >"$ROOT/frontend/node_modules/.mydgx-fingerprint"
    else
      say "Dependencias frontend sin cambios; omitiendo npm ci." "Frontend dependencies unchanged; skipping npm ci."
    fi
    rm -rf -- "$ROOT/frontend/dist.new"
    npm --prefix "$ROOT/frontend" run build -- --outDir dist.new
    printf '%s\n' "$frontend_fingerprint" >"$ROOT/frontend/dist.new/.mydgx-fingerprint"
  else
    say "Frontend sin cambios; se omiten npm ci y compilación." "Frontend unchanged; skipping npm ci and build."
  fi

  local fingerprint current_fingerprint candidate previous rebuild
  fingerprint="$(
    python3 - "$ROOT/backend/requirements.txt" <<'PY'
import hashlib
import pathlib
import sys

requirements = pathlib.Path(sys.argv[1]).read_bytes()
runtime = f"{sys.version_info.major}.{sys.version_info.minor}".encode()
print(hashlib.sha256(requirements + b"\0" + runtime).hexdigest())
PY
  )"
  current_fingerprint=""
  [[ -f "$VENV/.mydgx-fingerprint" ]] && current_fingerprint="$(cat "$VENV/.mydgx-fingerprint")"
  rebuild=0
  if [[ "$force_setup" == "1" ||
        ! -x "$PYTHON" ||
        "$fingerprint" != "$current_fingerprint" ]]; then
    rebuild=1
  elif ! "$PYTHON" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' ||
       ! "$PYTHON" -m pip check >/dev/null 2>&1; then
    rebuild=1
  fi

  if [[ "$rebuild" == "1" ]]; then
    [[ ! -L "$VENV" && "$VENV" == "$ROOT/.venv" ]] || {
      say "No se reemplazará un entorno virtual enlazado o externo." "Will not replace a linked or external virtual environment." >&2
      exit 1
    }
    candidate="$ROOT/.venv.new"
    previous="$ROOT/.venv.previous"
    rm -rf -- "$candidate"
    python3 -m venv "$candidate"
    "$candidate/bin/python" -m pip install --upgrade pip
    "$candidate/bin/python" -m pip install -r "$ROOT/backend/requirements.txt"
    "$candidate/bin/python" -m pip check
    printf '%s\n' "$fingerprint" >"$candidate/.mydgx-fingerprint"
    rm -rf -- "$previous"
    if [[ -d "$VENV" ]]; then
      mv "$VENV" "$previous"
    fi
    mv "$candidate" "$VENV"
  fi
  # Console scripts installed while the atomic candidate environment is named
  # .venv.new retain that absolute interpreter in their shebang after mv.
  # Repair only that exact internal prefix; Python virtualenvs are otherwise
  # not safely relocatable and broken entrypoints fail later with ENOENT.
  "$PYTHON" - "$VENV/bin" "$ROOT/.venv.new" "$VENV" <<'PY'
import pathlib
import sys

bin_dir = pathlib.Path(sys.argv[1])
old = sys.argv[2].encode()
new = sys.argv[3].encode()
for path in bin_dir.iterdir():
    if path.is_symlink() or not path.is_file():
        continue
    try:
        content = path.read_bytes()
    except OSError:
        continue
    first, separator, rest = content.partition(b"\n")
    if separator and first.startswith(b"#!") and old in first:
        temporary = path.with_name(f".{path.name}.mydgx-new")
        temporary.write_bytes(first.replace(old, new, 1) + separator + rest)
        temporary.chmod(path.stat().st_mode)
        temporary.replace(path)
PY
  if [[ "${MYDGX_USE_PREBUILT_FRONTEND:-0}" != "1" && "$frontend_rebuild" == "1" ]]; then
    rm -rf -- "$ROOT/frontend/dist.previous"
    if [[ -d "$ROOT/frontend/dist" ]]; then
      mv "$ROOT/frontend/dist" "$ROOT/frontend/dist.previous"
    fi
    mv "$ROOT/frontend/dist.new" "$ROOT/frontend/dist"
    rm -rf -- "$ROOT/frontend/dist.previous"
  fi
  [[ -z "${previous:-}" ]] || rm -rf -- "$previous"
  [[ -x "$VENV/bin/litellm" ]] &&
    "$PYTHON" -c 'import litellm' ||
    { say "No se pudo verificar el adaptador LiteLLM." "Could not verify the LiteLLM adapter." >&2; exit 1; }
  say "MyDGX preparado." "MyDGX ready."
}

runtime_value() {
  "$PYTHON" - "$1" <<'PY'
import sys
from backend.main import settings
print(getattr(settings, sys.argv[1]))
PY
}

gateway_value() {
  "$PYTHON" - "$1" <<'PY'
import sys
from backend.main import db, gateway_runtime_config
db.initialize()
print(gateway_runtime_config()[sys.argv[1]])
PY
}

serve() {
  ensure_env
  [[ -x "$PYTHON" && -f "$ROOT/frontend/dist/index.html" ]] || {
    say "MyDGX no está preparado. Ejecuta ./start.sh setup." "MyDGX is not set up. Run ./start.sh setup." >&2
    exit 1
  }
  local host port
  host="$(cd "$ROOT" && runtime_value host)"
  port="$(cd "$ROOT" && runtime_value port)"
  cd "$ROOT"
  exec "$PYTHON" -m uvicorn backend.main:app --host "$host" --port "$port"
}

serve_gateway() {
  ensure_env
  [[ -x "$PYTHON" ]] || {
    say "MyDGX no está preparado. Ejecuta ./start.sh setup." "MyDGX is not set up. Run ./start.sh setup." >&2
    exit 1
  }
  if [[ "$(cd "$ROOT" && gateway_value enabled)" != "True" ]]; then
    say "Gateway OpenAI desactivado." "OpenAI Gateway disabled."
    return
  fi
  local gateway_host gateway_port
  gateway_host="$(cd "$ROOT" && gateway_value host)"
  gateway_port="$(cd "$ROOT" && gateway_value port)"
  cd "$ROOT"
  exec "$PYTHON" -m uvicorn backend.gateway:app --host "$gateway_host" --port "$gateway_port"
}

serve_comfyui() {
  local root="$HOME/.local/share/mydgx/comfyui"
  local env_file="$root/comfyui.env"
  local python="$root/venv/bin/python"
  [[ -x "$python" && -f "$env_file" && -f "$root/enabled" ]] || {
    say "ComfyUI no está instalado." "ComfyUI is not installed." >&2
    exit 1
  }
  set -a
  source "$env_file"
  set +a
  exec "$python" "$COMFYUI_ROOT/main.py" \
    --listen "$COMFYUI_HOST" \
    --port "$COMFYUI_PORT" \
    --disable-auto-launch \
    --disable-pinned-memory \
    --disable-cuda-malloc
}

wait_ready() {
  local host port
  host="$(cd "$ROOT" && runtime_value host)"
  port="$(cd "$ROOT" && runtime_value port)"
  "$PYTHON" - "$host" "$port" <<'PY'
import os
import sys
import time
import urllib.error
import urllib.request

es = os.environ.get("MYDGX_LANGUAGE") == "es"
host = sys.argv[1]
if host == "0.0.0.0":
    host = "127.0.0.1"
elif host == "::":
    host = "::1"
if ":" in host:
    host = f"[{host}]"
url = f"http://{host}:{int(sys.argv[2])}/"
for _ in range(600):
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            if response.status < 500:
                raise SystemExit(0)
    except (OSError, urllib.error.URLError):
        time.sleep(1)
raise SystemExit(
    "MyDGX no respondió durante el arranque."
    if es
    else "MyDGX did not respond during startup."
)
PY
}

systemd_installed() {
  [[ -d /run/systemd/system && -f /etc/systemd/system/mydgx.service ]]
}

# Standalone audio runtimes (Whisper ASR on :9000, CUDA TTS on :9010) each hold a
# model in memory (~2-4 GB) but are only needed for voice features (Open WebUI
# voice, assistant speech). They are NOT required by the gateway, the LLM
# profiles, or the cyber harness, yet a default install enables them at boot, so
# they silently eat memory on machines that never use voice. Keep them opt-in:
# unless MYDGX_AUDIO=1 or the opt-in marker exists, make sure they stay off.
AUDIO_OPTIN_MARKER="$HOME/.local/share/mydgx/audio-services.enabled"

audio_services_wanted() {
  [[ "${MYDGX_AUDIO:-0}" == "1" || -f "$AUDIO_OPTIN_MARKER" ]]
}

disable_idle_audio_services() {
  audio_services_wanted && return 0
  local unit
  for unit in mydgx-tts mydgx-whisper; do
    [[ -f "/etc/systemd/system/$unit.service" ]] || continue
    if systemctl is-enabled --quiet "$unit.service" 2>/dev/null ||
       systemctl is-active --quiet "$unit.service" 2>/dev/null; then
      say "Runtime de audio $unit desactivado para ahorrar memoria (actívalo con MYDGX_AUDIO=1 o crea $AUDIO_OPTIN_MARKER)." \
          "Audio runtime $unit disabled to save memory (opt in with MYDGX_AUDIO=1 or create $AUDIO_OPTIN_MARKER)."
      sudo -n systemctl disable --now "$unit" 2>/dev/null || true
    fi
  done
}

systemd_action() {
  local action="$1"
  if [[ "$action" == start || "$action" == restart ]]; then
    disable_idle_audio_services
  fi
  local units=(mydgx mydgx-gateway)
  if [[ -f /etc/systemd/system/mydgx-searxng.service ]]; then
    units+=(mydgx-searxng)
  fi
  if [[ -f /etc/systemd/system/mydgx-comfyui.service ]]; then
    units+=(mydgx-comfyui)
  fi
  if [[ -f /etc/systemd/system/open-webui.service ]]; then
    units+=(open-webui)
  fi
  if [[ -f /etc/systemd/system/mydgx-whisper.service ]]; then
    units+=(mydgx-whisper)
  fi
  local unit
  for unit in "${units[@]}"; do
    if [[ "$action" != "stop" && "$unit" != mydgx && "$unit" != mydgx-gateway ]] &&
       ! systemctl is-enabled --quiet "$unit.service"; then
      say "$unit está desactivado; se deja detenido." "$unit is disabled; leaving stopped."
      continue
    fi
    sudo -n systemctl "$action" "$unit"
  done
}

start_searxng() {
  if [[ ! -x "$SEARXNG_RUNNER" ||
        ! -f "$SEARXNG_ROOT/enabled" ||
        ! -f "$SEARXNG_ROOT/settings.yml" ]]; then
    say "SearXNG no está instalado." "SearXNG is not installed."
    return
  fi
  "$SEARXNG_RUNNER" start "$SEARXNG_ROOT"
  for _ in {1..60}; do
    if curl -fsS "http://127.0.0.1:8888/search?q=DGX&format=json" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  say "SearXNG no respondió en el puerto 8888." "SearXNG did not respond on port 8888." >&2
  exit 1
}

start_gateway() {
  if [[ "$(cd "$ROOT" && gateway_value enabled)" != "True" ]]; then
    stop_process "$GATEWAY_PID" "Gateway OpenAI"
    say "Gateway OpenAI desactivado." "OpenAI Gateway disabled."
    return
  fi
  if is_running "$GATEWAY_PID"; then
    local gw_pid; gw_pid="$(cat "$GATEWAY_PID")"
    say "Gateway OpenAI ya está ejecutándose (PID $gw_pid)." "OpenAI Gateway is already running (PID $gw_pid)."
    return
  fi
  local gateway_host gateway_port
  gateway_host="$(cd "$ROOT" && gateway_value host)"
  gateway_port="$(cd "$ROOT" && gateway_value port)"
  (
    cd "$ROOT"
    nohup "$PYTHON" -m uvicorn backend.gateway:app --host "$gateway_host" --port "$gateway_port" >>"$GATEWAY_LOG_FILE" 2>&1 &
    echo $! >"$GATEWAY_PID"
  )
  sleep 1
  if is_running "$GATEWAY_PID"; then
    say "Gateway OpenAI iniciado en http://$gateway_host:$gateway_port/v1" "OpenAI Gateway started at http://$gateway_host:$gateway_port/v1"
  else
    say "El gateway OpenAI no pudo arrancar. Consulta $GATEWAY_LOG_FILE" "OpenAI Gateway failed to start. See $GATEWAY_LOG_FILE" >&2
    exit 1
  fi
}

start_openwebui() {
  local root="$HOME/.local/share/mydgx/open-webui"
  local executable="$root/venv/bin/open-webui"
  local env_file="$root/open-webui.env"
  if [[ ! -x "$executable" || ! -f "$env_file" ]]; then
    stop_process "$OPENWEBUI_PID" "Open WebUI"
    say "Open WebUI no está instalado." "Open WebUI is not installed."
    return
  fi
  if is_running "$OPENWEBUI_PID"; then
    local ow_pid; ow_pid="$(cat "$OPENWEBUI_PID")"
    say "Open WebUI ya está ejecutándose (PID $ow_pid)." "Open WebUI is already running (PID $ow_pid)."
    return
  fi
  (
    set -a
    # El archivo es generado localmente por install-openwebui.sh con permisos 0600.
    source "$env_file"
    set +a
    cd "$root"
    nohup "$executable" serve --host 127.0.0.1 --port 3000 >>"$OPENWEBUI_LOG_FILE" 2>&1 &
    echo $! >"$OPENWEBUI_PID"
  )
  sleep 1
  if is_running "$OPENWEBUI_PID"; then
    say "Open WebUI iniciado en http://127.0.0.1:3000" "Open WebUI started at http://127.0.0.1:3000"
  else
    say "Open WebUI no pudo arrancar. Consulta $OPENWEBUI_LOG_FILE" "Open WebUI failed to start. See $OPENWEBUI_LOG_FILE" >&2
    exit 1
  fi
}

start_comfyui() {
  local root="$HOME/.local/share/mydgx/comfyui"
  if [[ ! -x "$root/venv/bin/python" ||
        ! -f "$root/comfyui.env" ||
        ! -f "$root/enabled" ]]; then
    stop_process "$COMFYUI_PID" "ComfyUI"
    say "ComfyUI no está instalado." "ComfyUI is not installed."
    return
  fi
  if curl -fsS http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
    say "ComfyUI ya está disponible en http://127.0.0.1:8188" "ComfyUI is already available at http://127.0.0.1:8188"
    return
  fi
  if is_running "$COMFYUI_PID"; then
    local cf_pid; cf_pid="$(cat "$COMFYUI_PID")"
    say "ComfyUI ya está ejecutándose (PID $cf_pid)." "ComfyUI is already running (PID $cf_pid)."
    return
  fi
  (
    cd "$ROOT"
    nohup "$ROOT/start.sh" serve-comfyui >>"$COMFYUI_LOG_FILE" 2>&1 &
    echo $! >"$COMFYUI_PID"
  )
  for _ in {1..180}; do
    curl -fsS http://127.0.0.1:8188/system_stats >/dev/null 2>&1 && {
      say "ComfyUI iniciado en http://127.0.0.1:8188" "ComfyUI started at http://127.0.0.1:8188"
      return
    }
    sleep 1
  done
  say "ComfyUI no pudo arrancar. Consulta $COMFYUI_LOG_FILE" "ComfyUI failed to start. See $COMFYUI_LOG_FILE" >&2
  exit 1
}

start_ollama() {
  command -v ollama >/dev/null 2>&1 || {
    stop_process "$OLLAMA_PID" "Ollama"
    say "Ollama no está instalado." "Ollama is not installed."
    return
  }
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    say "Ollama ya está disponible en http://127.0.0.1:11434" "Ollama is already available at http://127.0.0.1:11434"
    return
  fi
  if is_running "$OLLAMA_PID"; then
    local ol_pid; ol_pid="$(cat "$OLLAMA_PID")"
    say "Ollama ya está ejecutándose (PID $ol_pid)." "Ollama is already running (PID $ol_pid)."
    return
  fi
  (
    cd "$ROOT"
    OLLAMA_HOST=127.0.0.1:11434 nohup ollama serve >>"$OLLAMA_LOG_FILE" 2>&1 &
    echo $! >"$OLLAMA_PID"
  )
  sleep 2
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    say "Ollama iniciado en http://127.0.0.1:11434" "Ollama started at http://127.0.0.1:11434"
  else
    say "Ollama no pudo arrancar. Consulta $OLLAMA_LOG_FILE" "Ollama failed to start. See $OLLAMA_LOG_FILE" >&2
    exit 1
  fi
}

start_whisper() {
  [[ ! -f /etc/systemd/system/mydgx-whisper.service ]] || return
  local root="$HOME/.local/share/mydgx/whisper"
  local executable="$root/venv/bin/uvicorn"
  local env_file="$root/whisper.env"
  if [[ ! -x "$executable" || ! -f "$env_file" || ! -f "$root/server.py" ]]; then
    stop_process "$WHISPER_PID" "Whisper"
    say "Whisper nativo no está instalado." "Native Whisper is not installed."
    return
  fi
  if is_running "$WHISPER_PID"; then
    local wh_pid; wh_pid="$(cat "$WHISPER_PID")"
    say "Whisper ya está ejecutándose (PID $wh_pid)." "Whisper is already running (PID $wh_pid)."
    return
  fi
  (
    set -a
    source "$env_file"
    set +a
    cd "$root"
    nohup "$executable" server:app --host 127.0.0.1 --port 9000 >>"$WHISPER_LOG_FILE" 2>&1 &
    echo $! >"$WHISPER_PID"
  )
  sleep 2
  if is_running "$WHISPER_PID"; then
    say "Whisper iniciado en http://127.0.0.1:9000" "Whisper started at http://127.0.0.1:9000"
  else
    say "Whisper no pudo arrancar. Consulta $WHISPER_LOG_FILE" "Whisper failed to start. See $WHISPER_LOG_FILE" >&2
    exit 1
  fi
}

engine_action() {
  local engine="${1:-}" action="${2:-}"
  [[ "$engine" == "comfyui" || "$engine" == "whisper" || "$engine" == "searxng" ]] || {
    say "Motor opcional no gestionable: $engine" "Unmanageable optional engine: $engine" >&2
    exit 2
  }
  [[ "$action" == "start" || "$action" == "stop" ]] || {
    say "Acción de motor no permitida: $action" "Engine action not allowed: $action" >&2
    exit 2
  }
  local unit=""
  [[ "$engine" == "comfyui" ]] && unit="mydgx-comfyui"
  [[ "$engine" == "whisper" ]] && unit="mydgx-whisper"
  [[ "$engine" == "searxng" ]] && unit="mydgx-searxng"
  if [[ -d /run/systemd/system && -f "/etc/systemd/system/$unit.service" ]]; then
    if [[ "$action" == "start" ]]; then
      sudo -n systemctl enable --now "$unit"
    else
      sudo -n systemctl disable --now "$unit"
    fi
    return
  fi
  case "$engine:$action" in
    comfyui:start) start_comfyui ;;
    comfyui:stop) stop_process "$COMFYUI_PID" "ComfyUI" ;;
    whisper:start) start_whisper ;;
    whisper:stop) stop_process "$WHISPER_PID" "Whisper" ;;
    searxng:start) start_searxng ;;
    searxng:stop) [[ ! -x "$SEARXNG_RUNNER" ]] || "$SEARXNG_RUNNER" stop "$SEARXNG_ROOT" ;;
  esac
}

start() {
  ensure_env
  if [[ ! -x "$PYTHON" || ! -d "$ROOT/frontend/node_modules" ]]; then
    setup
  elif [[ ! -f "$ROOT/frontend/dist/index.html" ]]; then
    npm --prefix "$ROOT/frontend" run build
  fi
  if is_running "$PID_FILE"; then
    local mydgx_pid; mydgx_pid="$(cat "$PID_FILE")"
    say "MyDGX ya está ejecutándose (PID $mydgx_pid)." "MyDGX is already running (PID $mydgx_pid)."
    start_ollama
    start_gateway
    start_searxng
    start_comfyui
    start_openwebui
    start_whisper
    return
  fi
  local host port
  host="$(cd "$ROOT" && runtime_value host)"
  port="$(cd "$ROOT" && runtime_value port)"
  (
    cd "$ROOT"
    nohup "$PYTHON" -m uvicorn backend.main:app --host "$host" --port "$port" >>"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
  )
  sleep 1
  if is_running "$PID_FILE"; then
    say "MyDGX iniciado en http://$host:$port" "MyDGX started at http://$host:$port"
    start_ollama
    start_gateway
    start_searxng
    start_comfyui
    start_openwebui
    start_whisper
  else
    say "MyDGX no pudo arrancar. Consulta $LOG_FILE" "MyDGX failed to start. See $LOG_FILE" >&2
    exit 1
  fi
}

dev() {
  ensure_env
  if [[ ! -x "$PYTHON" || ! -d "$ROOT/frontend/node_modules" ]]; then
    setup
  fi
  if is_running "$PID_FILE" || is_running "$DEV_WEB_PID"; then
    say "Ya hay un proceso MyDGX activo. Ejecuta ./start.sh stop." "A MyDGX process is already active. Run ./start.sh stop." >&2
    exit 1
  fi
  (
    cd "$ROOT"
    nohup "$PYTHON" -m uvicorn backend.main:app --host 127.0.0.1 --port 8088 --reload >>"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
    nohup npm --prefix frontend run dev >>"$LOG_DIR/frontend.log" 2>&1 &
    echo $! >"$DEV_WEB_PID"
  )
  start_gateway
  say "Desarrollo: http://127.0.0.1:5173" "Development: http://127.0.0.1:5173"
}

stop_process() {
  local file="$1" label="$2"
  if is_running "$file"; then
    local pid
    pid="$(cat "$file")"
    kill "$pid"
    for _ in {1..20}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$pid" 2>/dev/null || true
    say "$label detenido." "$label stopped."
  fi
  rm -f "$file"
}

stop() {
  stop_process "$DEV_WEB_PID" "Frontend"
  stop_process "$WHISPER_PID" "Whisper"
  stop_process "$OPENWEBUI_PID" "Open WebUI"
  stop_process "$COMFYUI_PID" "ComfyUI"
  if [[ -x "$SEARXNG_RUNNER" && -f "$SEARXNG_ROOT/settings.yml" ]]; then
    "$SEARXNG_RUNNER" stop "$SEARXNG_ROOT"
  fi
  stop_process "$GATEWAY_PID" "Gateway OpenAI"
  stop_process "$OLLAMA_PID" "Ollama"
  stop_process "$PID_FILE" "MyDGX"
}

system_identity() {
  if [[ -x "$PYTHON" ]]; then
    (
      cd "$ROOT"
      "$PYTHON" - <<'PY'
import os
from backend.main import device_identity, os_information

es = os.environ.get("MYDGX_LANGUAGE") == "es"
device = device_identity()
system = os_information()
if device["is_dgx_spark"]:
    platform = f"DGX Spark / GB10 — {device['device_model']}"
else:
    platform = (
        f"No detectado como DGX Spark — {device['device_model']}"
        if es
        else f"Not detected as DGX Spark — {device['device_model']}"
    )
os_label = "NVIDIA DGX OS" if system["is_dgx_os"] else system["os_family"]
if es:
    print(f"Plataforma: {platform}")
    print(f"Sistema operativo: {os_label} — {system['os_name']}")
    print(f"Kernel/arquitectura: {system['kernel']} / {os.uname().machine}")
else:
    print(f"Platform: {platform}")
    print(f"Operating system: {os_label} — {system['os_name']}")
    print(f"Kernel/architecture: {system['kernel']} / {os.uname().machine}")
PY
    )
  else
    say "Plataforma: no disponible (MyDGX todavía no está instalado)." "Platform: unavailable (MyDGX is not installed yet)."
    local uname_s uname_r uname_m
    uname_s="$(uname -s)"
    uname_r="$(uname -r)"
    uname_m="$(uname -m)"
    say "Sistema operativo: $uname_s — kernel $uname_r / $uname_m" "Operating system: $uname_s — kernel $uname_r / $uname_m"
  fi
}

status() {
  local state pid
  system_identity
  if systemd_installed; then
    state="$(systemctl is-active mydgx.service 2>/dev/null || true) · $(systemctl is-enabled mydgx.service 2>/dev/null || true)"
    say "Servicio MyDGX: $state" "MyDGX service: $state"
    state="$(systemctl is-active mydgx-gateway.service 2>/dev/null || true) · $(systemctl is-enabled mydgx-gateway.service 2>/dev/null || true)"
    say "Servicio Gateway: $state" "Gateway service: $state"
    if [[ -f /etc/systemd/system/open-webui.service ]]; then
      state="$(systemctl is-active open-webui.service 2>/dev/null || true) · $(systemctl is-enabled open-webui.service 2>/dev/null || true)"
      say "Servicio Open WebUI: $state" "Open WebUI service: $state"
    fi
    if [[ -f /etc/systemd/system/mydgx-searxng.service ]]; then
      state="$(systemctl is-active mydgx-searxng.service 2>/dev/null || true) · $(systemctl is-enabled mydgx-searxng.service 2>/dev/null || true)"
      say "Servicio SearXNG: $state" "SearXNG service: $state"
    fi
    if [[ -f /etc/systemd/system/mydgx-comfyui.service ]]; then
      state="$(systemctl is-active mydgx-comfyui.service 2>/dev/null || true) · $(systemctl is-enabled mydgx-comfyui.service 2>/dev/null || true)"
      say "Servicio ComfyUI: $state" "ComfyUI service: $state"
    fi
    if [[ -f /etc/systemd/system/mydgx-whisper.service ]]; then
      state="$(systemctl is-active mydgx-whisper.service 2>/dev/null || true) · $(systemctl is-enabled mydgx-whisper.service 2>/dev/null || true)"
      say "Servicio Whisper: $state" "Whisper service: $state"
    fi
    state="$(systemctl is-active mydgx-repair.service 2>/dev/null || true)"
    say "Integridad de arranque: $state" "Boot integrity: $state"
    return
  fi
  if is_running "$PID_FILE"; then
    pid="$(cat "$PID_FILE")"
    say "MyDGX activo (PID $pid)." "MyDGX running (PID $pid)."
  else
    say "MyDGX detenido." "MyDGX stopped."
    rm -f "$PID_FILE"
  fi
  if is_running "$DEV_WEB_PID"; then
    pid="$(cat "$DEV_WEB_PID")"
    say "Frontend de desarrollo activo (PID $pid)." "Development frontend running (PID $pid)."
  fi
  if is_running "$GATEWAY_PID"; then
    pid="$(cat "$GATEWAY_PID")"
    say "Gateway OpenAI activo (PID $pid)." "OpenAI Gateway running (PID $pid)."
  else
    say "Gateway OpenAI detenido." "OpenAI Gateway stopped."
    rm -f "$GATEWAY_PID"
  fi
  if is_running "$OPENWEBUI_PID"; then
    pid="$(cat "$OPENWEBUI_PID")"
    say "Open WebUI activo (PID $pid)." "Open WebUI running (PID $pid)."
  else
    say "Open WebUI detenido." "Open WebUI stopped."
    rm -f "$OPENWEBUI_PID"
  fi
  if curl -fsS "http://127.0.0.1:8888/search?q=DGX&format=json" >/dev/null 2>&1; then
    say "SearXNG disponible." "SearXNG available."
  else
    say "SearXNG detenido." "SearXNG stopped."
  fi
  if curl -fsS http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
    say "ComfyUI disponible." "ComfyUI available."
  else
    say "ComfyUI detenido." "ComfyUI stopped."
    rm -f "$COMFYUI_PID"
  fi
  if is_running "$WHISPER_PID"; then
    pid="$(cat "$WHISPER_PID")"
    say "Whisper activo (PID $pid)." "Whisper running (PID $pid)."
  else
    say "Whisper detenido." "Whisper stopped."
    rm -f "$WHISPER_PID"
  fi
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    say "Ollama disponible." "Ollama available."
  else
    say "Ollama detenido." "Ollama stopped."
    rm -f "$OLLAMA_PID"
  fi
}

logs() {
  if systemd_installed; then
    local units=(-u mydgx.service -u mydgx-gateway.service)
    [[ -f /etc/systemd/system/mydgx-searxng.service ]] && units+=(-u mydgx-searxng.service)
    [[ -f /etc/systemd/system/mydgx-comfyui.service ]] && units+=(-u mydgx-comfyui.service)
    [[ -f /etc/systemd/system/open-webui.service ]] && units+=(-u open-webui.service)
    [[ -f /etc/systemd/system/mydgx-whisper.service ]] && units+=(-u mydgx-whisper.service)
    exec sudo -n journalctl "${units[@]}" -n 100 -f
  fi
  touch "$LOG_FILE" "$GATEWAY_LOG_FILE" "$OPENWEBUI_LOG_FILE" "$COMFYUI_LOG_FILE" "$WHISPER_LOG_FILE" "$OLLAMA_LOG_FILE"
  tail -n 100 -f "$LOG_FILE" "$GATEWAY_LOG_FILE" "$OPENWEBUI_LOG_FILE" "$COMFYUI_LOG_FILE" "$WHISPER_LOG_FILE" "$OLLAMA_LOG_FILE"
}

autodiscover_health_config() {
  local config="$1" discovered host port identity="" known_hosts private pub fingerprint
  [[ -f "$DGX_DISCOVERY_SCRIPT" ]] || {
    say "No se encontró el descubridor DGX: $DGX_DISCOVERY_SCRIPT" "DGX discovery tool not found: $DGX_DISCOVERY_SCRIPT" >&2
    return 1
  }
  discovered="$(python3 "$DGX_DISCOVERY_SCRIPT")" || return
  IFS=$'\t' read -r host port <<<"$discovered"
  [[ "$host" =~ ^[A-Za-z0-9._:-]+$ && "$port" =~ ^[0-9]+$ ]] || {
    say "El descubrimiento devolvió un destino no válido." "Discovery returned an invalid target." >&2
    return 1
  }

  if [[ ! -f "$config" ]]; then
    [[ -f "$DGX_TEST_CONFIG_EXAMPLE" ]] || {
      say "No se encontró la plantilla: $DGX_TEST_CONFIG_EXAMPLE" "Template not found: $DGX_TEST_CONFIG_EXAMPLE" >&2
      return 1
    }
    umask 077
    mkdir -p "$(dirname "$config")"
    cp "$DGX_TEST_CONFIG_EXAMPLE" "$config"
  fi
  [[ ! -L "$config" && -f "$config" ]] || {
    say "La configuración debe ser un archivo regular, no un enlace simbólico." "Configuration must be a regular file, not a symbolic link." >&2
    return 1
  }

  known_hosts="$(mktemp)"
  chmod 600 "$known_hosts"
  if ssh-keyscan -T 5 -p "$port" "$host" >"$known_hosts" 2>/dev/null; then
    fingerprint="$(
      ssh-keygen -lf "$known_hosts" 2>/dev/null |
        awk '
          NR==1 { first=$2 " " $4 }
          $4=="(ED25519)" { print $2, $4; found=1; exit }
          END { if (!found) print first }
        '
    )"
    for pub in "$HOME"/.ssh/*.pub; do
      [[ -f "$pub" ]] || continue
      private="${pub%.pub}"
      [[ -f "$private" && ! -L "$private" ]] || continue
      if ssh \
        -F /dev/null \
        -o BatchMode=yes \
        -o IdentitiesOnly=yes \
        -o ConnectTimeout=3 \
        -o StrictHostKeyChecking=yes \
        -o "UserKnownHostsFile=$known_hosts" \
        -o GlobalKnownHostsFile=/dev/null \
        -i "$private" \
        -p "$port" \
        "nvidia@$host" true 2>/dev/null; then
        identity="$private"
        [[ "$identity" == "$HOME/"* ]] && identity="~/${identity#"$HOME/"}"
        break
      fi
    done
  fi
  rm -f "$known_hosts"

  python3 - "$config" "$host" "$port" "$identity" <<'PY'
import os
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
host, port, identity = sys.argv[2:]
lines = path.read_text(encoding="utf-8").splitlines()
updates = {"DGX_HOST": host, "DGX_PORT": port}
if identity:
    updates["DGX_IDENTITY"] = identity
seen = set()
output = []
for line in lines:
    match = re.match(r"^\s*#?\s*(DGX_[A-Z0-9_]+)\s*=", line)
    key = match.group(1) if match else ""
    if key in updates:
        if key not in seen:
            output.append(f"{key}={updates[key]}")
            seen.add(key)
    else:
        output.append(line)
for key, value in updates.items():
    if key not in seen:
        output.append(f"{key}={value}")
temporary = path.with_name(f".{path.name}.mydgx-new")
temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
temporary.chmod(0o600)
os.replace(temporary, path)
PY
  chmod 600 "$config"
  say "DGX encontrado: $host:$port" "DGX found: $host:$port"
  [[ -z "${fingerprint:-}" ]] || say "Huella SSH observada: $fingerprint" "SSH fingerprint observed: $fingerprint"
  if [[ -n "$identity" ]]; then
    say "Clave SSH verificada y configurada: $identity" "SSH key verified and configured: $identity"
  else
    say "No se encontró una clave SSH autorizada; usa --interactive o configura DGX_IDENTITY." "No authorized SSH key found; use --interactive or set DGX_IDENTITY."
  fi
  say "Configuración actualizada: $config" "Configuration updated: $config"
}

add_health_config_to_tray() {
  local config="$1" connection host port identity result status alias
  [[ "$(uname -s)" == "Darwin" ]] || {
    say "--add-to-tray solo está disponible en macOS." "--add-to-tray is only available on macOS." >&2
    return 2
  }
  [[ -f "$DGX_TRAY_ADD_SCRIPT" ]] || {
    say "No se encontró el configurador del Tray: $DGX_TRAY_ADD_SCRIPT" "Tray configurator not found: $DGX_TRAY_ADD_SCRIPT" >&2
    return 1
  }
  connection="$(
    python3 - "$config" <<'PY'
import pathlib
import re
import sys

values = {}
for raw_line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    match = re.match(r"^\s*(DGX_HOST|DGX_PORT|DGX_IDENTITY)\s*=\s*(.*?)\s*$", raw_line)
    if match:
        values[match.group(1)] = match.group(2).strip().strip("'\"")
print(
    values.get("DGX_HOST", "")
    + "\t"
    + values.get("DGX_PORT", "22")
    + "\t"
    + values.get("DGX_IDENTITY", "")
)
PY
  )"
  IFS=$'\t' read -r host port identity <<<"$connection"
  [[ -n "$host" && "$port" =~ ^[0-9]+$ ]] || {
    say "La configuración descubierta no contiene un destino SSH válido." "Discovered configuration does not contain a valid SSH target." >&2
    return 1
  }
  [[ -n "$identity" ]] || {
    say "No se añade al Tray: ninguna clave SSH existente pudo autenticar el equipo." "Not adding to Tray: no existing SSH key could authenticate to the host." >&2
    return 1
  }

  result="$(python3 "$DGX_TRAY_ADD_SCRIPT" "$host" "$port" "$identity" "$ROOT")" || return
  IFS=$'\t' read -r status alias _ <<<"$result"
  if [[ "$status" == "existing" ]]; then
    say "El equipo ya existe en MyDGX Tray: $alias" "Host already exists in MyDGX Tray: $alias"
    return
  fi
  [[ "$status" == "added" ]] || {
    say "El configurador del Tray devolvió un resultado inesperado." "Tray configurator returned an unexpected result." >&2
    return 1
  }
  say "Equipo añadido a MyDGX Tray: $alias" "Host added to MyDGX Tray: $alias"
  if command -v open >/dev/null 2>&1; then
    pkill -x MyDGXTray >/dev/null 2>&1 || true
    sleep 1
    open -a MyDGXTray >/dev/null 2>&1 ||
      say "Perfil guardado; abre MyDGXTray manualmente para cargarlo." "Profile saved; open MyDGXTray manually to load it." >&2
  fi
}

health_test() {
  [[ -x "$DGX_TEST_SCRIPT" ]] || {
    say "No se encontró el health check ejecutable: $DGX_TEST_SCRIPT" "Health check executable not found: $DGX_TEST_SCRIPT" >&2
    exit 1
  }

  local explicit_config=0 config_has_path=0 config_path=""
  local autodiscover=0 add_to_tray=0 show_help=0 shorthand=0 target user host
  local translated=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --host|--user|--port|--identity|--timeout|--expect-fingerprint|--expect-disk-tb|--host-key-alias)
        translated+=("$1")
        [[ $# -lt 2 ]] || translated+=("$2")
        shift $(( $# < 2 ? 1 : 2 ))
        ;;
      -i)
        [[ $# -ge 2 ]] || {
          say "-i necesita la ruta de una clave privada." "-i requires a private key path." >&2
          exit 2
        }
        translated+=(--identity "$2")
        shift 2
        ;;
      -i?*)
        translated+=(--identity "${1#-i}")
        shift
        ;;
      [!-]*@*)
        [[ "$shorthand" == "0" ]] || {
          say "Indica un solo destino USUARIO@HOST." "Give a single USER@HOST target." >&2
          exit 2
        }
        target="$1"
        user="${target%%@*}"
        host="${target#*@}"
        [[ -n "$user" && -n "$host" && "$host" != *@* ]] || {
          say "Destino inválido. Usa USUARIO@HOST, por ejemplo root@192.168.1.100." "Invalid target. Use USER@HOST, for example root@192.168.1.100." >&2
          exit 2
        }
        translated+=(--user "$user" --host "$host")
        shorthand=1
        shift
        ;;
      -p)
        [[ $# -ge 2 ]] || {
          say "-p necesita un puerto." "-p requires a port." >&2
          exit 2
        }
        translated+=(--port "$2")
        shift 2
        ;;
      -p?*)
        translated+=(--port "${1#-p}")
        shift
        ;;
      --config)
        explicit_config=1
        if [[ $# -ge 2 && "$2" != -* ]]; then
          config_has_path=1
          config_path="$2"
          translated+=("$1" "$2")
          shift 2
        else
          config_path="${MYDGX_DGX_TEST_CONFIG:-$DGX_TEST_CONFIG}"
          shift
        fi
        ;;
      --autodiscover)
        autodiscover=1
        shift
        ;;
      --add-to-tray)
        add_to_tray=1
        shift
        ;;
      -h|--help)
        show_help=1
        translated+=("$1")
        shift
        ;;
      *)
        translated+=("$1")
        shift
        ;;
    esac
  done

  # OpenSSH usa la identidad configurada; solo permite un prompt interactivo
  # cuando no hay ningún archivo de identidad definido.
  if [[ "$shorthand" == "1" ]]; then
    translated+=(--interactive-if-no-key)
  fi

  if [[ "$autodiscover" == "1" ]]; then
    config_path="${config_path:-${MYDGX_DGX_TEST_CONFIG:-$DGX_TEST_CONFIG}}"
    autodiscover_health_config "$config_path"
    [[ "$add_to_tray" == "0" ]] || add_health_config_to_tray "$config_path"
    say "Ejecuta ahora: ./start.sh test --config \"$config_path\"" "Run now: ./start.sh test --config \"$config_path\""
    exit 0
  fi
  if [[ "$add_to_tray" == "1" ]]; then
    say "--add-to-tray requiere --autodiscover." "--add-to-tray requires --autodiscover." >&2
    exit 2
  fi

  if [[ "$explicit_config" == "1" && "$config_has_path" == "0" ]]; then
    translated+=(--config "$config_path")
  fi

  if [[ "$show_help" == "1" || "$explicit_config" == "1" ]]; then
    exec "$DGX_TEST_SCRIPT" "${translated[@]}"
  fi

  local config="${MYDGX_DGX_TEST_CONFIG:-$DGX_TEST_CONFIG}"
  if [[ ! -f "$config" ]]; then
    if [[ -n "${MYDGX_DGX_TEST_CONFIG:-}" ]]; then
      say "No se encontró MYDGX_DGX_TEST_CONFIG: $config" "MYDGX_DGX_TEST_CONFIG not found: $config" >&2
      exit 2
    fi
    if [[ "$shorthand" == "1" ]]; then
      exec "$DGX_TEST_SCRIPT" "${translated[@]}"
    fi
    [[ -f "$DGX_TEST_CONFIG_EXAMPLE" ]] || {
      say "No se encontró la plantilla: $DGX_TEST_CONFIG_EXAMPLE" "Template not found: $DGX_TEST_CONFIG_EXAMPLE" >&2
      exit 1
    }
    umask 077
    mkdir -p "$DGX_TEST_CONFIG_DIR"
    cp "$DGX_TEST_CONFIG_EXAMPLE" "$config"
    chmod 600 "$config"
    say "Configuración creada en $config" "Configuration created at $config"
    say "Edita DGX_HOST y verifica la huella SSH antes de ejecutar de nuevo:" "Edit DGX_HOST and verify the SSH fingerprint before running again:"
    say "  ./start.sh test" "  ./start.sh test"
    exit 2
  fi

  exec "$DGX_TEST_SCRIPT" --config "$config" "${translated[@]}"
}

recover() {
  [[ $# -ge 1 ]] || {
    say "Uso: $0 --recover COPIA.tar.gz [--check] [--confirm RESTORE-MYDGX-BACKUP] [--passphrase-file RUTA] [--skip-secrets] [--no-start]" \
      "Usage: $0 --recover BACKUP.tar.gz [--check] [--confirm RESTORE-MYDGX-BACKUP] [--passphrase-file PATH] [--skip-secrets] [--no-start]" >&2
    exit 2
  }
  [[ "$(id -u)" != "0" ]] || {
    say "Ejecuta la recuperación con el usuario de MyDGX, no como root: los archivos restaurados deben ser suyos." \
      "Run the recovery as the MyDGX user, not as root: restored files must belong to it." >&2
    exit 2
  }
  if [[ ! -x "$PYTHON" ]]; then
    say "Preparando MyDGX antes de restaurar…" "Setting up MyDGX before restoring…"
    setup
  fi
  cd "$ROOT"
  exec "$PYTHON" -m backend.recovery "$@"
}

case "${1:-start}" in
  setup) setup ;;
  recover|--recover) shift; recover "$@" ;;
  install-opencode) shift; exec "$ROOT/opencode.sh" install "$@" ;;
  opencode) shift; exec "$ROOT/opencode.sh" "$@" ;;
  install-claude-code) shift; exec "$ROOT/claude-code.sh" install "$@" ;;
  claude|claude-code) shift; exec "$ROOT/claude-code.sh" "$@" ;;
  serve) serve ;;
  serve-gateway) serve_gateway ;;
  serve-comfyui) serve_comfyui ;;
  engine) shift; engine_action "$@" ;;
  wait-ready) wait_ready ;;
  start) if systemd_installed; then systemd_action start; else start; fi ;;
  dev) dev ;;
  stop) if systemd_installed; then systemd_action stop; else stop; fi ;;
  restart) if systemd_installed; then systemd_action restart; else stop; start; fi ;;
  status) status ;;
  logs) logs ;;
  test) shift; health_test "$@" ;;
  --autodiscover) shift; health_test --autodiscover "$@" ;;
  serverize)
    shift
    [[ -f "$SERVERIZE_SCRIPT" && ! -L "$SERVERIZE_SCRIPT" ]] || {
      say "No se encontró el script seguro de conversión a servidor." "Secure server conversion script not found." >&2
      exit 1
    }
    exec bash "$SERVERIZE_SCRIPT" "$@"
    ;;
  build) npm --prefix "$ROOT/frontend" run build ;;
  deploy) shift; deploy "$@" ;;
  *)
    say "Uso: $0 {setup|--recover COPIA.tar.gz [--check]|start|dev|stop|restart|status|logs|test [--autodiscover] [USUARIO@HOST [-pPUERTO] | OPCIONES]|--autodiscover [--add-to-tray] [--config [RUTA]]|serverize [--audit|--disable --confirm DISABLE-DESKTOP-SERVICES|--apply --confirm CONVERT-TO-HEADLESS-SERVER] [--keep PAQUETE]|build|deploy [--database RUTA] [--duckdns]|install-opencode [NOMBRE]|opencode [setup] [ALIAS|--model ALIAS] [--active] [-- ARGS]|install-claude-code|claude [setup] [ALIAS|--model ALIAS] [--active] [-- ARGS]}" "Usage: $0 {setup|--recover BACKUP.tar.gz [--check]|start|dev|stop|restart|status|logs|test [--autodiscover] [USER@HOST [-pPORT] | OPTIONS]|--autodiscover [--add-to-tray] [--config [PATH]]|serverize [--audit|--disable --confirm DISABLE-DESKTOP-SERVICES|--apply --confirm CONVERT-TO-HEADLESS-SERVER] [--keep PACKAGE]|build|deploy [--database PATH] [--duckdns]|install-opencode [NAME]|opencode [setup] [ALIAS|--model ALIAS] [--active] [-- ARGS]|install-claude-code|claude [setup] [ALIAS|--model ALIAS] [--active] [-- ARGS]}" >&2
    exit 2
    ;;
esac
