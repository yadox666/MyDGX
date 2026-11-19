#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ -f "$ROOT/scripts/lib/language.sh" ]]; then
  # shellcheck source=lib/language.sh
  source "$ROOT/scripts/lib/language.sh"
else
  pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
  say() { pick "$@"; printf '\n'; }
fi
OPENWEBUI_PUBLIC_URL="${MYDGX_OPENWEBUI_PUBLIC_URL:-http://127.0.0.1:13000}"
[[ "$OPENWEBUI_PUBLIC_URL" =~ ^https?://(127\.0\.0\.1|localhost):[0-9]{1,5}/?$ ]] || {
  say "MYDGX_OPENWEBUI_PUBLIC_URL no es una URL loopback válida." "MYDGX_OPENWEBUI_PUBLIC_URL is not a valid loopback URL." >&2
  exit 2
}
openwebui_public_port="${OPENWEBUI_PUBLIC_URL%/}"
openwebui_public_port="${openwebui_public_port##*:}"
((openwebui_public_port >= 1 && openwebui_public_port <= 65535)) || {
  say "El puerto público de Open WebUI no es válido." "The Open WebUI public port is not valid." >&2
  exit 2
}

chmod +x \
  start.sh \
  scripts/install-comfyui.sh \
  scripts/install-openwebui.sh \
  scripts/install-searxng.sh \
  scripts/searxng-container.sh \
  scripts/install-systemd.sh \
  scripts/system-repair.sh
if ! command -v node >/dev/null 2>&1 ||
   ! command -v npm >/dev/null 2>&1 ||
   (( "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" < 20 )); then
  export MYDGX_USE_PREBUILT_FRONTEND=1
  say "Node.js 20 no está disponible; se usará el frontend precompilado." "Node.js 20 is not available; the prebuilt frontend will be used."
fi
systemd_active=0
if [[ -d /run/systemd/system ]] && systemctl show-environment >/dev/null 2>&1; then
  systemd_active=1
  for unit in mydgx-repair mydgx mydgx-gateway open-webui; do
    systemctl cat "$unit" >/dev/null 2>&1 || {
      say "Falta el servicio $unit. Ejecuta primero ./start.sh deploy --interactive." "The $unit service is missing. Run ./start.sh deploy --interactive first." >&2
      exit 1
    }
  done
fi
./start.sh setup

./.venv/bin/python - "$ROOT/.env" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
output = []
found = False
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
    if key == "GATEWAY_ENABLED":
        output.append("GATEWAY_ENABLED=true")
        found = True
    else:
        output.append(line)
if not found:
    output.append("GATEWAY_ENABLED=true")
temporary = path.with_suffix(".new")
temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
temporary.chmod(0o600)
temporary.replace(path)
PY

gateway_port="$(
  ./.venv/bin/python - <<'PY'
import json

from backend.main import db, gateway_runtime_config, utc_now

db.initialize()
config = gateway_runtime_config()
config["enabled"] = True
db.execute(
    """
    INSERT INTO preferences(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
    """,
    ("gateway.config", json.dumps(config), utc_now()),
)
print(config["port"])
PY
)"
searxng_enabled=0
searxng_query_url=""
if [[ -f "$HOME/.local/share/mydgx/searxng/enabled" &&
      -f "$HOME/.local/share/mydgx/searxng/settings.yml" &&
      -f "$HOME/.local/share/mydgx/searxng/image" ]]; then
  searxng_enabled=1
  searxng_query_url="http://127.0.0.1:8888/search"
fi
comfyui_enabled=0
comfyui_workflow=""
comfyui_nodes=""
if [[ -f "$HOME/.local/share/mydgx/comfyui/enabled" &&
      -f "$HOME/.local/share/mydgx/comfyui/comfyui.env" ]]; then
  comfyui_enabled=1
  comfyui_workflow="$ROOT/config/comfyui/image-workflow-api.json"
  comfyui_nodes="$ROOT/config/comfyui/image-workflow-nodes.json"
fi
tool_api_key="$(
  ./.venv/bin/python - "$ROOT/.env" <<'PY'
import pathlib
import re
import secrets
import sys

path = pathlib.Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
key = ""
for line in lines:
    if line.startswith("OPENWEBUI_TOOL_API_KEY="):
        key = line.split("=", 1)[1].strip().strip("'\"")
        break
if not re.fullmatch(r"[A-Za-z0-9_-]{32,}", key):
    key = secrets.token_urlsafe(48)
output = [
    line for line in lines
    if not line.startswith("OPENWEBUI_TOOL_API_KEY=")
]
output.append(f"OPENWEBUI_TOOL_API_KEY={key}")
temporary = path.with_suffix(".new")
temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
temporary.chmod(0o600)
temporary.replace(path)
print(key)
PY
)"
mydgx_port="$(./.venv/bin/python -c 'from backend.main import settings; print(settings.port)')"
./scripts/install-openwebui.sh \
  "$ROOT" \
  "$gateway_port" \
  "${MYDGX_OPENWEBUI_VERSION:-0.13.4}" \
  "$searxng_query_url" \
  "$comfyui_workflow" \
  "$comfyui_nodes" \
  "$tool_api_key" \
  "$mydgx_port"

./.venv/bin/python - "$ROOT/.env" "$OPENWEBUI_PUBLIC_URL" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
public_url = sys.argv[2].rstrip("/")
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
updates = {
    "GATEWAY_ENABLED": "true",
    "OPENWEBUI_URL": "http://127.0.0.1:3000",
    "OPENWEBUI_PUBLIC_URL": public_url,
}
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
path.write_text("\n".join(output) + "\n", encoding="utf-8")
PY
chmod 0600 "$ROOT/.env"

if [[ "$systemd_active" == "1" ]]; then
  units=(mydgx-repair mydgx mydgx-gateway open-webui)
  [[ "$searxng_enabled" == "1" ]] && systemctl is-enabled --quiet mydgx-searxng.service && units+=(mydgx-searxng)
  [[ "$comfyui_enabled" == "1" ]] && systemctl is-enabled --quiet mydgx-comfyui.service && units+=(mydgx-comfyui)
  for unit in "${units[@]}"; do
    sudo -n systemctl restart "$unit"
  done
  for _ in {1..300}; do
    curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1 ||
    { say "Open WebUI no respondió en el puerto 3000." "Open WebUI did not respond on port 3000." >&2; exit 1; }
else
  ./start.sh restart
  for _ in {1..300}; do
    curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1 ||
    { say "Open WebUI no respondió en el puerto 3000." "Open WebUI did not respond on port 3000." >&2; exit 1; }
fi

./start.sh status
