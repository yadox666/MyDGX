# Descubrimiento compartido del gateway de MyDGX para los clientes CLI.
# Se carga con `source` desde opencode.sh y claude-code.sh; requiere $ROOT.
#
# SECURITY NOTES:
# - Solo lee la configuración pública del gateway y del Tray; nunca claves.
# - Los sondeos de salud se limitan a 127.0.0.1 salvo MYDGX_GATEWAY_URL explícita.

# Imprime la base OpenAI (terminada en /v1) del gateway alcanzable.
gateway_url() {
  local configured tray_configured
  if [[ -n "${MYDGX_GATEWAY_URL:-}" ]]; then
    printf '%s' "${MYDGX_GATEWAY_URL%/}"
    return
  fi
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    configured="$(
      cd "$ROOT"
      "$ROOT/.venv/bin/python" - <<'PY'
from backend.main import db, gateway_runtime_config
db.initialize()
config = gateway_runtime_config()
host = config["host"]
if host in {"0.0.0.0", "::", "::1", "localhost"}:
    host = "127.0.0.1"
print(f"http://{host}:{config['port']}/v1", end="")
PY
    )"
  else
    configured="http://127.0.0.1:4000/v1"
  fi
  if curl --silent --fail --max-time 2 "${configured%/v1}/health" >/dev/null 2>&1; then
    printf '%s' "$configured"
    return
  fi
  tray_configured="$(
    python3 - <<'PY'
import json
from pathlib import Path

path = Path.home() / ".MyDGX" / "config"
try:
    config = json.loads(path.read_text(encoding="utf-8"))
    active_id = config.get("activeConnectionID")
    profiles = config.get("connections") or config.get("profiles") or []
    profile = next((item for item in profiles if item.get("id") == active_id), None)
    tunnel = profile.get("tunnel", {}) if profile else {}
    port = int(tunnel.get("localGatewayPort", 0))
    if tunnel.get("enabled") is True and 1 <= port <= 65535:
        print(f"http://127.0.0.1:{port}/v1", end="")
except (OSError, ValueError, TypeError, json.JSONDecodeError):
    pass
PY
  )"
  if [[ -n "$tray_configured" ]] &&
     curl --silent --fail --max-time 2 "${tray_configured%/v1}/health" >/dev/null 2>&1; then
    printf '%s' "$tray_configured"
  elif curl --silent --fail --max-time 2 "http://127.0.0.1:14000/health" >/dev/null 2>&1; then
    printf 'http://127.0.0.1:14000/v1'
  else
    printf '%s' "$configured"
  fi
}

# El gateway no exige clave a clientes de localhost, incluidos los túneles SSH
# del Tray; cualquier otra URL necesita MYDGX_GATEWAY_API_KEY.
gateway_is_local() {
  [[ "$1" =~ ^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?(/|$) ]]
}

# Imprime la clave del gateway para el cliente o termina si falta en remoto.
# El placeholder local es un valor de compatibilidad, no una credencial.
gateway_client_key() {
  local url="$1"
  if [[ -n "${MYDGX_GATEWAY_API_KEY:-}" ]]; then
    printf '%s' "$MYDGX_GATEWAY_API_KEY"
  elif gateway_is_local "$url"; then
    printf 'local-mydgx-gateway'
  else
    printf 'ERROR: el gateway %s no es local y requiere clave.\n' "$url" >&2
    printf '       Exporta MYDGX_GATEWAY_API_KEY con el valor de GATEWAY_API_KEY del DGX\n' >&2
    printf '       o usa el túnel SSH del Tray (http://127.0.0.1:14000/v1).\n' >&2
    return 2
  fi
}

# Exporta PLAYWRIGHT_BROWSERS_PATH e instala Chromium si falta (perfil activo).
ensure_node_for_mcp() {
  command -v npx >/dev/null 2>&1 || {
    printf 'ERROR: --active requiere Node.js y npx para los servidores MCP.\n' >&2
    exit 1
  }
  if [[ "$(uname -s)" == Darwin ]]; then
    export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"
  else
    export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
  fi
  mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
  if [[ "${MYDGX_PLAYWRIGHT_BROWSER:-}" != "chrome" ]] &&
     ! compgen -G "$PLAYWRIGHT_BROWSERS_PATH/chromium-"* >/dev/null; then
    printf 'Instalando Chromium para Playwright MCP (solo la primera vez)...\n' >&2
    npx -y playwright@1.49.1 install chromium >&2 ||
      printf 'AVISO: Chromium no se pudo instalar; Playwright puede no iniciar.\n' >&2
  fi
}
