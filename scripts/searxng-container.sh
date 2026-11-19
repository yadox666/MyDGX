#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
ROOT="${2:-$HOME/.local/share/mydgx/searxng}"
NAME="mydgx-searxng"
PORT="${MYDGX_SEARXNG_PORT:-8888}"

LANGUAGE_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/language.sh"
if [[ -f "$LANGUAGE_LIB" ]]; then
  # shellcheck source=lib/language.sh
  source "$LANGUAGE_LIB"
else
  pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
  say() { pick "$@"; printf '\n'; }
fi

fail() {
  printf 'ERROR: %s\n' "$(pick "$@")" >&2
  exit 1
}

[[ "$ROOT" == /* && "$ROOT" != *$'\n'* ]] || fail "Ruta de SearXNG inválida." "Invalid SearXNG path."
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1024 && PORT <= 65535)) ||
  fail "Puerto de SearXNG inválido." "Invalid SearXNG port."
[[ -f "$ROOT/settings.yml" && -f "$ROOT/image" ]] ||
  fail "SearXNG no está instalado." "SearXNG is not installed."
IMAGE="$(tr -d '\r\n' <"$ROOT/image")"
[[ "$IMAGE" =~ ^[A-Za-z0-9._/:@+-]+$ ]] || fail "Imagen de SearXNG inválida." "Invalid SearXNG image."
MODE="container"
[[ ! -f "$ROOT/mode" ]] || MODE="$(tr -d '\r\n' <"$ROOT/mode")"
[[ "$MODE" =~ ^(container|native)$ ]] || fail "Modo de SearXNG inválido." "Invalid SearXNG mode."

if [[ "$MODE" == "native" ]]; then
  PYTHON="$ROOT/venv/bin/python"
  SOURCE="$ROOT/source"
  PID_FILE="$ROOT/searxng.pid"
  LOG_FILE="$ROOT/searxng.log"
  [[ -x "$PYTHON" && -d "$SOURCE/searx" ]] ||
    fail "La instalación nativa de SearXNG está incompleta." "The native SearXNG installation is incomplete."
  is_running() {
    [[ -f "$PID_FILE" ]] || return 1
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
  }
  case "$ACTION" in
    run)
      cd "$SOURCE"
      export SEARXNG_SETTINGS_PATH="$ROOT/settings.yml"
      exec "$PYTHON" -m searx.webapp
      ;;
    start)
      if is_running; then
        say "SearXNG ya está disponible en http://127.0.0.1:$PORT." "SearXNG is already available at http://127.0.0.1:$PORT."
        exit 0
      fi
      rm -f "$PID_FILE"
      (
        cd "$SOURCE"
        export SEARXNG_SETTINGS_PATH="$ROOT/settings.yml"
        nohup "$PYTHON" -m searx.webapp >>"$LOG_FILE" 2>&1 &
        printf '%s\n' "$!" >"$PID_FILE"
      )
      say "SearXNG iniciado en http://127.0.0.1:$PORT." "SearXNG started at http://127.0.0.1:$PORT."
      ;;
    stop)
      if is_running; then
        kill "$(cat "$PID_FILE")" 2>/dev/null || true
      fi
      rm -f "$PID_FILE"
      ;;
    status)
      if is_running; then printf 'running\n'; else printf 'detenido\n'; fi
      ;;
    *)
      fail "Uso: $0 {run|start|stop|status} [RUTA_CONFIG]" "Usage: $0 {run|start|stop|status} [CONFIG_PATH]"
      ;;
  esac
  exit 0
fi

command -v docker >/dev/null 2>&1 || fail "Docker no está instalado." "Docker is not installed."
docker_command=(docker)
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
    docker_command=(sudo -n docker)
  else
    fail "El daemon Docker no está disponible." "The Docker daemon is not available."
  fi
fi

container_args=(
  --name "$NAME"
  --cap-drop ALL
  --cap-add CHOWN
  --cap-add SETGID
  --cap-add SETUID
  --cap-add DAC_OVERRIDE
  --security-opt no-new-privileges
  -p "127.0.0.1:${PORT}:8080"
  -v "$ROOT/settings.yml:/etc/searxng/settings.yml:ro"
  "$IMAGE"
)

case "$ACTION" in
  run)
    "${docker_command[@]}" rm -f "$NAME" >/dev/null 2>&1 || true
    exec "${docker_command[@]}" run --rm "${container_args[@]}"
    ;;
  start)
    if "${docker_command[@]}" inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null | grep -qx true; then
      say "SearXNG ya está disponible en http://127.0.0.1:$PORT." "SearXNG is already available at http://127.0.0.1:$PORT."
      exit 0
    fi
    "${docker_command[@]}" rm -f "$NAME" >/dev/null 2>&1 || true
    "${docker_command[@]}" run -d --rm "${container_args[@]}" >/dev/null
    say "SearXNG iniciado en http://127.0.0.1:$PORT." "SearXNG started at http://127.0.0.1:$PORT."
    ;;
  stop)
    "${docker_command[@]}" stop -t 10 "$NAME" >/dev/null 2>&1 || true
    ;;
  status)
    "${docker_command[@]}" inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null || printf 'detenido\n'
    ;;
  *)
    fail "Uso: $0 {run|start|stop|status} [RUTA_CONFIG]" "Usage: $0 {run|start|stop|status} [CONFIG_PATH]"
    ;;
esac
