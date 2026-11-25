#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib/language.sh
if [[ -f "$(dirname "${BASH_SOURCE[0]}")/lib/language.sh" ]]; then
  source "$(dirname "${BASH_SOURCE[0]}")/lib/language.sh"
else
  pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
  say() { pick "$@"; printf '\n'; }
fi

ROOT="${1:-}"
GATEWAY_PORT="${2:-4000}"
OPENWEBUI_VERSION="${3:-0.13.4}"
SEARXNG_QUERY_URL="${4:-}"
COMFYUI_WORKFLOW_FILE="${5:-}"
COMFYUI_NODES_FILE="${6:-}"
MYDGX_TOOL_API_KEY="${7:-}"
MYDGX_PORT="${8:-8088}"

fail() {
  printf 'ERROR: %s\n' "$(pick "$@")" >&2
  exit 1
}

[[ -n "$ROOT" && "$ROOT" == /* && -x "$ROOT/.venv/bin/python" ]] ||
  fail "La instalación de MyDGX no está preparada." "The MyDGX installation is not ready."
[[ "$GATEWAY_PORT" =~ ^[0-9]+$ ]] && ((GATEWAY_PORT >= 1 && GATEWAY_PORT <= 65535)) ||
  fail "El puerto del gateway no es válido." "The gateway port is not valid."
[[ -z "$OPENWEBUI_VERSION" || "$OPENWEBUI_VERSION" =~ ^[A-Za-z0-9._+-]+$ ]] ||
  fail "La versión de Open WebUI no es válida." "The Open WebUI version is not valid."
[[ -z "$SEARXNG_QUERY_URL" || "$SEARXNG_QUERY_URL" =~ ^http://127\.0\.0\.1:[0-9]+/search$ ]] ||
  fail "La URL local de SearXNG no es válida." "The local SearXNG URL is not valid."
[[ -z "$COMFYUI_WORKFLOW_FILE" ||
   ( "$COMFYUI_WORKFLOW_FILE" == /* && -f "$COMFYUI_WORKFLOW_FILE" && ! -L "$COMFYUI_WORKFLOW_FILE" ) ]] ||
  fail "El workflow de ComfyUI no es válido." "The ComfyUI workflow is not valid."
[[ -z "$COMFYUI_NODES_FILE" ||
   ( "$COMFYUI_NODES_FILE" == /* && -f "$COMFYUI_NODES_FILE" && ! -L "$COMFYUI_NODES_FILE" ) ]] ||
  fail "El mapa de nodos de ComfyUI no es válido." "The ComfyUI node map is not valid."
[[ -z "$MYDGX_TOOL_API_KEY" || "$MYDGX_TOOL_API_KEY" =~ ^[A-Za-z0-9_-]{32,}$ ]] ||
  fail "La credencial de herramientas no es válida." "The tool credential is not valid."
[[ "$MYDGX_PORT" =~ ^[0-9]+$ ]] && ((MYDGX_PORT >= 1 && MYDGX_PORT <= 65535)) ||
  fail "El puerto de MyDGX no es válido." "The MyDGX port is not valid."

OPENWEBUI_ROOT="$HOME/.local/share/mydgx/open-webui"
VENV="$OPENWEBUI_ROOT/venv"
DATA_DIR="$OPENWEBUI_ROOT/data"
ENV_FILE="$OPENWEBUI_ROOT/open-webui.env"
mkdir -p "$OPENWEBUI_ROOT" "$DATA_DIR"
chmod 0700 "$OPENWEBUI_ROOT" "$DATA_DIR"

force_install="${MYDGX_FORCE_INSTALL:-0}"
[[ "$force_install" =~ ^[01]$ ]] || fail "MYDGX_FORCE_INSTALL debe valer 0 o 1." "MYDGX_FORCE_INSTALL must be 0 or 1."
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
  say "Open WebUI ya está preparado; se omite la instalación pip." "Open WebUI is already ready; skipping pip install."
fi
[[ -x "$VENV/bin/open-webui" ]] ||
  fail "La instalación no creó el ejecutable open-webui." "The installation did not create the open-webui executable."
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
import os
import pathlib
import secrets
import shlex
import sqlite3
import sys
from contextlib import closing

# Bump when the chat defaults below change, so existing installs receive them once.
CHAT_DEFAULTS_VERSION = "1"
# Bump when the image defaults below change.
IMAGE_DEFAULTS_VERSION = "1"
# Open WebUI generates through the gateway alias, so the model chosen in MyDGX → Engines applies here too.
IMAGE_CONNECTION_ID = "mydgx-gateway"
IMAGE_MODEL = "comfyui-image"
LEGACY_IMAGE_MODEL = "flux1-schnell-fp8.safetensors"


def json_object(raw: object) -> dict:
    try:
        value = json.loads(raw) if isinstance(raw, str) and raw else raw
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def with_tool_approval(settings: dict) -> dict:
    params = settings.get("params") if isinstance(settings.get("params"), dict) else {}
    return {**settings, "params": {"tool_approval_mode": "ask", **params}}


def with_web_search(metadata: dict) -> dict:
    features = metadata.get("defaultFeatureIds")
    features = [item for item in features if isinstance(item, str)] if isinstance(features, list) else []
    return {**metadata, "defaultFeatureIds": features if "web_search" in features else [*features, "web_search"]}


def apply_chat_defaults(database: pathlib.Path, web_search: bool) -> None:
    """Existing installs keep their saved Admin settings over the environment, so the defaults go into the database."""
    with closing(sqlite3.connect(database, timeout=30)) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "config" in tables and {"key", "value"} <= {row[1] for row in connection.execute("PRAGMA table_info(config)")}:
            def update(key: str, change) -> None:
                row = connection.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
                if row is not None:
                    connection.execute("UPDATE config SET value=? WHERE key=?", (json.dumps(change(row[0])), key))

            update("chat.tool_permissions.enable", lambda _value: True)
            update("ui.default_interface_settings", lambda value: with_tool_approval(json_object(value)))
            if web_search:
                update("models.default_metadata", lambda value: with_web_search(json_object(value)))
        if "user" in tables and "settings" in {row[1] for row in connection.execute("PRAGMA table_info(user)")}:
            for user_id, raw in connection.execute("SELECT id, settings FROM user").fetchall():
                settings = json_object(raw)
                ui = json_object(settings.get("ui"))
                settings["ui"] = with_tool_approval(ui)
                connection.execute("UPDATE user SET settings=? WHERE id=?", (json.dumps(settings), user_id))
        connection.commit()


def gateway_image_connection(gateway_url: str) -> dict:
    return {
        "id": IMAGE_CONNECTION_ID,
        "name": "MyDGX",
        "type": "openai",
        "url": gateway_url,
        "key": "",
        "config": {
            "enable": True,
            "capabilities": {"image_generation": True, "image_edit": False},
            "model_ids": [IMAGE_MODEL],
            "access_grants": [{"principal_type": "user", "principal_id": "*", "permission": "read"}],
            "auth_type": "none",
            "headers": {},
            "size": "1024x1024",
            "edit_size": "",
            "steps": None,
            "api_version": "",
            "params": {},
            "endpoint_method": "",
            "workflow": "",
            "nodes": [],
            "edit_workflow": "",
            "edit_nodes": [],
        },
    }


def apply_image_defaults(database: pathlib.Path, gateway_url: str) -> None:
    """Move MyDGX's own FLUX.1 ComfyUI connection to the gateway; connections an admin added stay as they are."""
    with closing(sqlite3.connect(database, timeout=30)) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "config" not in tables:
            return
        def read(key: str):
            row = connection.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
            try:
                return json.loads(row[0]) if row else None
            except ValueError:
                return None

        def write(key: str, value) -> None:
            connection.execute("UPDATE config SET value=? WHERE key=?", (json.dumps(value), key))

        connections = read("images.connections")
        if isinstance(connections, list):
            ours = [
                item for item in connections
                if isinstance(item, dict) and item.get("type") == "comfyui"
                and str(item.get("url") or "").rstrip("/") == "http://127.0.0.1:8188"
            ]
            for item in ours:
                item.setdefault("config", {})["enable"] = False
            connections = [item for item in connections if not (isinstance(item, dict) and item.get("id") == IMAGE_CONNECTION_ID)]
            connections.append(gateway_image_connection(gateway_url))
            write("images.connections", connections)
            default = str(read("image_generation.default_model") or "")
            if not default or default.endswith(f":{LEGACY_IMAGE_MODEL}") or default.split(":", 1)[0] in {item.get("id") for item in ours}:
                write("image_generation.default_model", f"{IMAGE_CONNECTION_ID}:{IMAGE_MODEL}")
        elif read("image_generation.model") in {LEGACY_IMAGE_MODEL, ""}:
            # Not migrated to connections yet: Open WebUI builds them from these keys on its next start.
            write("image_generation.engine", "openai")
            write("image_generation.model", IMAGE_MODEL)
            write("image_generation.openai.api_base_url", gateway_url)
            write("image_generation.openai.api_key", "")
        connection.commit()


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
    "IMAGES_OPENAI_API_BASE_URL",
    "IMAGES_OPENAI_API_KEY",
    "ENABLE_CHAT_RESPONSE_BASE64_IMAGE_URL_CONVERSION",
    "MYDGX_IMAGE_DEFAULTS",
}
if comfyui_workflow_file and comfyui_nodes_file:
    workflow = json.loads(pathlib.Path(comfyui_workflow_file).read_text(encoding="utf-8"))
    nodes = json.loads(pathlib.Path(comfyui_nodes_file).read_text(encoding="utf-8"))
    if not isinstance(workflow, dict) or not isinstance(nodes, list):
        raise SystemExit(
            "La configuración ComfyUI no tiene el formato esperado."
            if os.environ.get("MYDGX_LANGUAGE") == "es"
            else "The ComfyUI configuration does not have the expected format."
        )
    for key in ("COMFYUI_BASE_URL", "COMFYUI_API_KEY", "COMFYUI_WORKFLOW", "COMFYUI_WORKFLOW_NODES", "IMAGE_STEPS"):
        values.pop(key, None)
    values.update({
        "ENABLE_IMAGE_GENERATION": "True",
        "IMAGE_GENERATION_ENGINE": "openai",
        "IMAGE_GENERATION_MODEL": IMAGE_MODEL,
        "IMAGES_OPENAI_API_BASE_URL": f"http://127.0.0.1:{gateway_port}/v1",
        "IMAGES_OPENAI_API_KEY": "",
        "IMAGE_SIZE": "1024x1024",
        # Chatting with the image model returns the image inline; store it as a file, not in the chat JSON.
        "ENABLE_CHAT_RESPONSE_BASE64_IMAGE_URL_CONVERSION": "True",
    })
    database = data_dir / "webui.db"
    if existing.get("MYDGX_IMAGE_DEFAULTS") != IMAGE_DEFAULTS_VERSION and database.is_file():
        apply_image_defaults(database, f"http://127.0.0.1:{gateway_port}/v1")
    values["MYDGX_IMAGE_DEFAULTS"] = IMAGE_DEFAULTS_VERSION
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
values["ENABLE_TOOL_PERMISSIONS"] = "True"
values["DEFAULT_INTERFACE_SETTINGS"] = json.dumps(
    with_tool_approval(json_object(existing.get("DEFAULT_INTERFACE_SETTINGS"))), separators=(",", ":")
)
if searxng_query_url:
    values["DEFAULT_MODEL_METADATA"] = json.dumps(
        with_web_search(json_object(existing.get("DEFAULT_MODEL_METADATA"))), separators=(",", ":")
    )
database = data_dir / "webui.db"
if existing.get("MYDGX_CHAT_DEFAULTS") != CHAT_DEFAULTS_VERSION and database.is_file():
    apply_chat_defaults(database, bool(searxng_query_url))
values["MYDGX_CHAT_DEFAULTS"] = CHAT_DEFAULTS_VERSION
env_path.write_text(
    "".join(f"{key}={shlex.quote(str(value))}\n" for key, value in values.items()),
    encoding="utf-8",
)
PY
chmod 0600 "$ENV_FILE"
say "Open WebUI preparado en $OPENWEBUI_ROOT para el gateway local :$GATEWAY_PORT." "Open WebUI ready at $OPENWEBUI_ROOT for the local gateway :$GATEWAY_PORT."
