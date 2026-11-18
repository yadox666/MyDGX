#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-}"
GATEWAY_PORT="${2:-4000}"
OPENWEBUI_VERSION="${3:-0.13.4}"
SEARXNG_QUERY_URL="${4:-}"
COMFYUI_WORKFLOW_FILE="${5:-}"
COMFYUI_NODES_FILE="${6:-}"
MYDGX_TOOL_API_KEY="${7:-}"
MYDGX_PORT="${8:-8088}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -n "$ROOT" && "$ROOT" == /* && -x "$ROOT/.venv/bin/python" ]] ||
  fail "La instalación de MyDGX no está preparada."
[[ "$GATEWAY_PORT" =~ ^[0-9]+$ ]] && ((GATEWAY_PORT >= 1 && GATEWAY_PORT <= 65535)) ||
  fail "El puerto del gateway no es válido."
[[ -z "$OPENWEBUI_VERSION" || "$OPENWEBUI_VERSION" =~ ^[A-Za-z0-9._+-]+$ ]] ||
  fail "La versión de Open WebUI no es válida."
[[ -z "$SEARXNG_QUERY_URL" || "$SEARXNG_QUERY_URL" =~ ^http://127\.0\.0\.1:[0-9]+/search$ ]] ||
  fail "La URL local de SearXNG no es válida."
[[ -z "$COMFYUI_WORKFLOW_FILE" ||
   ( "$COMFYUI_WORKFLOW_FILE" == /* && -f "$COMFYUI_WORKFLOW_FILE" && ! -L "$COMFYUI_WORKFLOW_FILE" ) ]] ||
  fail "El workflow de ComfyUI no es válido."
[[ -z "$COMFYUI_NODES_FILE" ||
   ( "$COMFYUI_NODES_FILE" == /* && -f "$COMFYUI_NODES_FILE" && ! -L "$COMFYUI_NODES_FILE" ) ]] ||
  fail "El mapa de nodos de ComfyUI no es válido."
[[ -z "$MYDGX_TOOL_API_KEY" || "$MYDGX_TOOL_API_KEY" =~ ^[A-Za-z0-9_-]{32,}$ ]] ||
  fail "La credencial de herramientas no es válida."
[[ "$MYDGX_PORT" =~ ^[0-9]+$ ]] && ((MYDGX_PORT >= 1 && MYDGX_PORT <= 65535)) ||
  fail "El puerto de MyDGX no es válido."

OPENWEBUI_ROOT="$HOME/.local/share/mydgx/open-webui"
VENV="$OPENWEBUI_ROOT/venv"
DATA_DIR="$OPENWEBUI_ROOT/data"
ENV_FILE="$OPENWEBUI_ROOT/open-webui.env"
mkdir -p "$OPENWEBUI_ROOT" "$DATA_DIR"
chmod 0700 "$OPENWEBUI_ROOT" "$DATA_DIR"

force_install="${MYDGX_FORCE_INSTALL:-0}"
[[ "$force_install" =~ ^[01]$ ]] || fail "MYDGX_FORCE_INSTALL debe valer 0 o 1."
fingerprint="$(
  {
    printf 'open-webui=%s\n' "${OPENWEBUI_VERSION:-latest-installed}"
    python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
  } | sha256sum | cut -d' ' -f1
)"
installed_fingerprint=""
[[ -f "$OPENWEBUI_ROOT/.install-fingerprint" ]] &&
  installed_fingerprint="$(cat "$OPENWEBUI_ROOT/.install-fingerprint")"
install_required=0
if [[ "$force_install" == "1" ||
      ! -x "$VENV/bin/python" ||
      ! -x "$VENV/bin/open-webui" ||
      "$fingerprint" != "$installed_fingerprint" ]]; then
  install_required=1
fi
if [[ "$install_required" == "0" ]] &&
   ! "$VENV/bin/python" -c 'import open_webui' >/dev/null 2>&1; then
  install_required=1
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
fi
if [[ "$install_required" == "1" ]]; then
  "$VENV/bin/python" -m pip install --upgrade pip
  package="open-webui"
  [[ -z "$OPENWEBUI_VERSION" ]] || package="open-webui==$OPENWEBUI_VERSION"
  "$VENV/bin/python" -m pip install "$package"
  printf '%s\n' "$fingerprint" >"$OPENWEBUI_ROOT/.install-fingerprint"
else
  echo "Open WebUI ya está preparado; se omite la instalación pip."
fi
[[ -x "$VENV/bin/open-webui" ]] ||
  fail "La instalación no creó el ejecutable open-webui."
"$VENV/bin/python" -c 'import open_webui'

"$ROOT/.venv/bin/python" - \
  "$ENV_FILE" \
  "$DATA_DIR" \
  "$GATEWAY_PORT" \
  "$SEARXNG_QUERY_URL" \
  "$COMFYUI_WORKFLOW_FILE" \
  "$COMFYUI_NODES_FILE" \
  "$MYDGX_TOOL_API_KEY" \
  "$MYDGX_PORT" <<'PY'
import json
import pathlib
import secrets
import shlex
import sys

env_path = pathlib.Path(sys.argv[1])
data_dir = pathlib.Path(sys.argv[2])
gateway_port = int(sys.argv[3])
searxng_query_url = sys.argv[4]
comfyui_workflow_file = sys.argv[5]
comfyui_nodes_file = sys.argv[6]
tool_api_key = sys.argv[7]
mydgx_port = int(sys.argv[8])
existing: dict[str, str] = {}
if env_path.is_file():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        try:
            parsed = shlex.split(line, comments=True, posix=True)
        except ValueError:
            continue
        if len(parsed) == 1 and "=" in parsed[0]:
            key, value = parsed[0].split("=", 1)
            existing[key.strip()] = value
secret = existing.get("WEBUI_SECRET_KEY", "").strip()
if not secret:
    secret = secrets.token_urlsafe(48)
values = {**existing, **{
    "HOST": "127.0.0.1",
    "PORT": "3000",
    "DATA_DIR": str(data_dir),
    "ENABLE_OLLAMA_API": "False",
    "ENABLE_OPENAI_API": "True",
    "OPENAI_API_BASE_URL": f"http://127.0.0.1:{gateway_port}/v1",
    "OPENAI_API_KEY": "",
    "ENABLE_OPENAI_API_PASSTHROUGH": "False",
    "ANONYMIZED_TELEMETRY": "False",
    "DO_NOT_TRACK": "True",
    "SCARF_NO_ANALYTICS": "True",
    "WEBUI_SECRET_KEY": secret,
}}
search_keys = {
    "ENABLE_WEB_SEARCH",
    "WEB_SEARCH_ENGINE",
    "SEARXNG_QUERY_URL",
    "WEB_SEARCH_RESULT_COUNT",
    "WEB_SEARCH_CONCURRENT_REQUESTS",
    "WEB_LOADER_CONCURRENT_REQUESTS",
}
if searxng_query_url:
    values.update({
        "ENABLE_WEB_SEARCH": "True",
        "WEB_SEARCH_ENGINE": "searxng",
        "SEARXNG_QUERY_URL": searxng_query_url,
        "WEB_SEARCH_RESULT_COUNT": "5",
        "WEB_SEARCH_CONCURRENT_REQUESTS": "5",
        "WEB_LOADER_CONCURRENT_REQUESTS": "5",
    })
else:
    for key in search_keys:
        values.pop(key, None)
image_keys = {
    "ENABLE_IMAGE_GENERATION",
    "IMAGE_GENERATION_ENGINE",
    "IMAGE_GENERATION_MODEL",
    "IMAGE_SIZE",
    "IMAGE_STEPS",
    "COMFYUI_BASE_URL",
    "COMFYUI_API_KEY",
    "COMFYUI_WORKFLOW",
    "COMFYUI_WORKFLOW_NODES",
}
if comfyui_workflow_file and comfyui_nodes_file:
    workflow = json.loads(pathlib.Path(comfyui_workflow_file).read_text(encoding="utf-8"))
    nodes = json.loads(pathlib.Path(comfyui_nodes_file).read_text(encoding="utf-8"))
    if not isinstance(workflow, dict) or not isinstance(nodes, list):
        raise SystemExit("La configuración ComfyUI no tiene el formato esperado.")
    values.update({
        "ENABLE_IMAGE_GENERATION": "True",
        "IMAGE_GENERATION_ENGINE": "comfyui",
        "IMAGE_GENERATION_MODEL": "flux1-schnell-fp8.safetensors",
        "IMAGE_SIZE": "1024x1024",
        "IMAGE_STEPS": "4",
        "COMFYUI_BASE_URL": "http://127.0.0.1:8188",
        "COMFYUI_API_KEY": "",
        "COMFYUI_WORKFLOW": json.dumps(workflow, separators=(",", ":")),
        "COMFYUI_WORKFLOW_NODES": json.dumps(nodes, separators=(",", ":")),
    })
else:
    for key in image_keys:
        values.pop(key, None)
if tool_api_key:
    connections = [{
        "url": f"http://127.0.0.1:{mydgx_port}",
        "path": "/api/openwebui/tools/openapi.json",
        "auth_type": "bearer",
        "key": tool_api_key,
        "config": {"enable": True},
        "info": {
            "name": "MyDGX Laboratorio IA",
            "description": "Modelos y trabajos multimedia locales del perfil activo",
        },
    }]
    values["ENABLE_DIRECT_CONNECTIONS"] = "True"
    values["TOOL_SERVER_CONNECTIONS"] = json.dumps(connections, separators=(",", ":"))
else:
    values.pop("ENABLE_DIRECT_CONNECTIONS", None)
    values.pop("TOOL_SERVER_CONNECTIONS", None)
env_path.write_text(
    "".join(f"{key}={shlex.quote(str(value))}\n" for key, value in values.items()),
    encoding="utf-8",
)
PY
chmod 0600 "$ENV_FILE"
printf 'Open WebUI preparado en %s para el gateway local :%s.\n' "$OPENWEBUI_ROOT" "$GATEWAY_PORT"
