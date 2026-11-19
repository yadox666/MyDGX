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
    say "ERROR: el gateway $url no es local y requiere clave." \
      "ERROR: the gateway $url is not local and requires a key." >&2
    say "       Exporta MYDGX_GATEWAY_API_KEY con el valor de GATEWAY_API_KEY del DGX" \
      "       Export MYDGX_GATEWAY_API_KEY with the DGX's GATEWAY_API_KEY value" >&2
    say "       o usa el túnel SSH del Tray (http://127.0.0.1:14000/v1)." \
      "       or use the Tray SSH tunnel (http://127.0.0.1:14000/v1)." >&2
    return 2
  fi
}

# Lanzado desde el Tray, la ventana se cierra al salir y el error no se ve.
# Solo en terminal interactiva; los scripts y CI siguen saliendo sin esperar.
pause_on_error() {
  local status="$1"
  if [[ "$status" -ne 0 && -t 0 && -t 1 ]]; then
    printf '\n%s' "$(pick "Pulsa Enter para cerrar esta ventana." "Press Enter to close this window.")" >&2
    read -r _ || true
  fi
  return "$status"
}

# Exporta PLAYWRIGHT_BROWSERS_PATH e instala Chromium si falta (perfil activo).
ensure_node_for_mcp() {
  command -v npx >/dev/null 2>&1 || {
    say "ERROR: --active requiere Node.js y npx para los servidores MCP." \
      "ERROR: --active requires Node.js and npx for the MCP servers." >&2
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
    say "Instalando Chromium para Playwright MCP (solo la primera vez)..." \
      "Installing Chromium for Playwright MCP (first time only)..." >&2
    npx -y playwright@1.49.1 install chromium >&2 ||
      say "AVISO: Chromium no se pudo instalar; Playwright puede no iniciar." \
        "NOTE: Chromium could not be installed; Playwright may not start." >&2
  fi
}
