#!/usr/bin/env bash
# Instala, configura y ejecuta OpenCode contra el gateway de MyDGX.
#
# SECURITY NOTES:
# - La configuración se escribe exclusivamente en ~/opencode.
# - Las claves se leen del entorno y nunca se copian al JSON.
# - Sin --active, OpenCode funciona en modo plan y solo lectura.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${MYDGX_OPENCODE_HOME:-$HOME/opencode}"
CONFIG_WRITER="$ROOT/scripts/opencode_workspace.py"
# shellcheck source=scripts/mydgx_gateway.sh
source "$ROOT/scripts/mydgx_gateway.sh"
COMMAND="run"
ACTIVE=false
MODEL=""
SLUG=""
GATEWAY=""
OPENCODE_ARGS=()

usage() {
  cat <<EOF
Uso: $ROOT/start.sh install-opencode [nombre]
     $ROOT/start.sh opencode setup [--active] [--model ALIAS]
     $ROOT/start.sh opencode [ALIAS|--model ALIAS] [--active] [-- args de opencode]

  install-opencode  Instala el CLI si falta y prepara $WORKSPACE.
  opencode setup    Refresca la configuración sin abrir la TUI.
  opencode          Descubre los modelos compatibles del gateway, refresca la
                    configuración y abre OpenCode con el alias indicado.
  --active          Activa edición, bash con confirmación y MCP Playwright,
                    Shodan y NVD. Sin la opción, usa plan/solo lectura.

Variables opcionales:
  MYDGX_GATEWAY_URL       Base OpenAI; por defecto, gateway local de MyDGX.
  MYDGX_GATEWAY_API_KEY   Clave del gateway, solo mediante el entorno.
  MYDGX_OPENCODE_HOME     Workspace; por defecto, $HOME/opencode.
  MYDGX_OPENCODE_MAX_STEPS
  MYDGX_OPENCODE_MAX_OUTPUT_TOKENS  Límite de salida; por defecto, contexto/8.
EOF
}

ensure_cli() {
  command -v opencode >/dev/null 2>&1 && return
  "$ROOT/install_opencode.sh"
  hash -r || true
  command -v opencode >/dev/null 2>&1 || {
    printf 'ERROR: OpenCode no está disponible en PATH.\n' >&2
    exit 1
  }
}

# Resuelve la URL y la clave en la shell principal: write_config se ejecuta en
# una subshell y OpenCode necesita MYDGX_GATEWAY_API_KEY exportada.
prepare_gateway() {
  local key
  GATEWAY="$(gateway_url)"
  key="$(gateway_client_key "$GATEWAY")" || return 2
  export MYDGX_GATEWAY_API_KEY="$key"
}

write_config() {
  local url="$GATEWAY" version output
  version="$(opencode --version 2>&1 | awk 'NR == 1 { print; exit }')"
  local -a args=(
    --workspace "$WORKSPACE"
    --base-url "$url"
    --version "$version"
    --model "$MODEL"
  )
  "$ACTIVE" && args+=(--active)
  [[ -n "$SLUG" ]] && args+=(--slug "$SLUG")
  output="$(python3 "$CONFIG_WRITER" "${args[@]}")" || return $?
  printf '%s\t%s\t%s\n' "$url" "${output%%$'\t'*}" "${output#*$'\t'}"
}

install_workspace() {
  ensure_cli
  mkdir -p "$WORKSPACE"
  local result version
  ACTIVE=true
  GATEWAY="$(gateway_url)"
  version="$(opencode --version 2>&1 | awk 'NR == 1 { print; exit }')"
  python3 "$CONFIG_WRITER" \
    --workspace "$WORKSPACE" \
    --base-url "$GATEWAY" \
    --version "$version" \
    --slug "$SLUG" \
    --assets-only >/dev/null
  printf 'OpenCode configurado en %s\n' "$WORKSPACE"
  printf 'Skills instalados en %s/.opencode/skills\n' "$WORKSPACE"
  [[ -z "$SLUG" ]] || printf 'Proyecto creado: %s/%s\n' "$WORKSPACE" "$SLUG"
  if ! prepare_gateway; then
    printf 'AVISO: assets instalados; opencode.json se generará al definir la clave.\n' >&2
  elif result="$(write_config)"; then
    printf 'Gateway: %s\n' "${result%%$'\t'*}"
  else
    printf 'AVISO: assets instalados, pero falta un modelo de chat/visión cargado para generar opencode.json.\n' >&2
  fi
  printf 'Siguiente: cd "%s" && %s/start.sh opencode\n' "$WORKSPACE" "$ROOT"
}

resolve_project() {
  mkdir -p "$WORKSPACE"
  if [[ "$PWD" == "$ROOT" ]]; then
    cd "$WORKSPACE"
  elif [[ "$PWD" != "$WORKSPACE" && "$PWD" != "$WORKSPACE"/* ]]; then
    printf 'ERROR: ejecuta OpenCode desde %s o uno de sus subdirectorios.\n' "$WORKSPACE" >&2
    exit 2
  fi
}

run_opencode() {
  ensure_cli
  resolve_project
  "$ACTIVE" && ensure_node_for_mcp
  if [[ "$ACTIVE" == true && -z "${SHODAN_API_KEY:-}" ]]; then
    printf 'AVISO: SHODAN_API_KEY no está definida; Shodan MCP queda desactivado.\n' >&2
  fi

  local result url selected config
  prepare_gateway || exit $?
  result="$(write_config)" || exit $?
  [[ -n "$result" ]] || {
    printf 'ERROR: no se recibió configuración de OpenCode.\n' >&2
    exit 1
  }
  IFS=$'\t' read -r url selected config <<<"$result"

  export OPENCODE_CONFIG="$config"
  export OPENCODE_CONFIG_CONTENT
  OPENCODE_CONFIG_CONTENT="$(cat "$config")"
  export OPENCODE_DISABLE_AUTOUPDATE=1
  export OPENCODE_AUTO_SHARE=false
  export OPENCODE_DISABLE_DEFAULT_PLUGINS=1

  # A stderr: stdout queda limpio para `opencode run --format json`.
  printf 'OpenCode: %s mediante %s, modo %s.\n' \
    "$selected" "$url" "$([[ "$ACTIVE" == true ]] && printf active || printf plan)" >&2
  printf 'Workspace: %s\nConfig: %s\n' "$PWD" "$config" >&2
  ((${#OPENCODE_ARGS[@]})) && exec opencode "${OPENCODE_ARGS[@]}"
  exec opencode
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    install)
      COMMAND=install
      shift
      [[ $# -gt 0 && "$1" != --* ]] && { SLUG="$1"; shift; }
      ;;
    setup)
      COMMAND=setup
      shift
      ;;
    --active)
      ACTIVE=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --model)
      [[ $# -ge 2 && -z "$MODEL" ]] || {
        printf 'ERROR: --model necesita un único alias.\n' >&2
        exit 2
      }
      MODEL="$2"
      shift 2
      ;;
    --)
      shift
      OPENCODE_ARGS+=("$@")
      break
      ;;
    --*)
      OPENCODE_ARGS+=("$1")
      shift
      ;;
    *)
      if [[ -z "$MODEL" ]]; then
        MODEL="$1"
      else
        OPENCODE_ARGS+=("$1")
      fi
      shift
      ;;
  esac
done

case "$COMMAND" in
  install)
    install_workspace
    ;;
  setup)
    ensure_cli
    "$ACTIVE" && ensure_node_for_mcp
    prepare_gateway || exit $?
    result="$(write_config)" || exit $?
    printf 'Configuración actualizada: %s\n' "${result##*$'\t'}"
    ;;
  run)
    run_opencode
    ;;
esac
