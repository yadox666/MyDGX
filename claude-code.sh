#!/usr/bin/env bash
# Instala, configura y ejecuta Claude Code contra el gateway Anthropic de MyDGX.
#
# SECURITY NOTES:
# - La configuración se escribe exclusivamente en ~/claude-code.
# - Las claves se leen del entorno y nunca se copian a mydgx-settings.json.
# - ANTHROPIC_API_KEY se elimina del entorno para no reenviar una clave real de
#   Anthropic al gateway.
# - Sin --active, Claude Code funciona en modo plan y solo lectura.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${MYDGX_CLAUDE_HOME:-$HOME/claude-code}"
CONFIG_WRITER="$ROOT/scripts/claude_code_workspace.py"
# shellcheck source=scripts/mydgx_gateway.sh
source "$ROOT/scripts/mydgx_gateway.sh"
COMMAND="run"
ACTIVE=false
MODEL=""
GATEWAY=""
CLAUDE_ARGS=()

usage() {
  cat <<EOF
Uso: $ROOT/start.sh install-claude-code
     $ROOT/start.sh claude setup [--active] [--model ALIAS]
     $ROOT/start.sh claude [ALIAS|--model ALIAS] [--active] [-- args de claude]

  install-claude-code  Instala el CLI si falta y prepara $WORKSPACE.
  claude setup         Refresca la configuración sin abrir la sesión.
  claude               Descubre los modelos compatibles del gateway, refresca
                       la configuración y abre Claude Code con el alias indicado.
  --active             Acepta ediciones, pide confirmación para bash y activa
                       los MCP Playwright, Shodan y NVD. Sin la opción, usa
                       plan/solo lectura.

Variables opcionales:
  MYDGX_GATEWAY_URL               Base OpenAI; por defecto, gateway local de MyDGX.
  MYDGX_GATEWAY_API_KEY           Clave del gateway, solo mediante el entorno.
  MYDGX_CLAUDE_HOME               Workspace; por defecto, $HOME/claude-code.
  MYDGX_CLAUDE_MAX_OUTPUT_TOKENS  Límite de salida; por defecto, contexto/8.
EOF
}

ensure_cli() {
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) export PATH="$PATH:$HOME/.local/bin" ;;
  esac
  command -v claude >/dev/null 2>&1 && return
  "$ROOT/install_claude_code.sh"
  hash -r || true
  command -v claude >/dev/null 2>&1 || {
    printf 'ERROR: Claude Code no está disponible en PATH.\n' >&2
    exit 1
  }
}

# Resuelve la URL y la clave en la shell principal: write_config se ejecuta en
# una subshell y Claude Code necesita el token exportado.
prepare_gateway() {
  local key
  GATEWAY="$(gateway_url)"
  key="$(gateway_client_key "$GATEWAY")" || return 2
  export MYDGX_GATEWAY_API_KEY="$key"
}

write_config() {
  local url="$GATEWAY" output
  local -a args=(--workspace "$WORKSPACE" --base-url "$url" --model "$MODEL")
  "$ACTIVE" && args+=(--active)
  output="$(python3 "$CONFIG_WRITER" "${args[@]}")" || return $?
  printf '%s\t%s\n' "$url" "$output"
}

install_workspace() {
  ensure_cli
  mkdir -p "$WORKSPACE"
  local result
  ACTIVE=true
  python3 "$CONFIG_WRITER" --workspace "$WORKSPACE" --base-url "${GATEWAY:-http://127.0.0.1:4000/v1}" --assets-only >/dev/null
  printf 'Claude Code configurado en %s\n' "$WORKSPACE"
  printf 'Skills instalados en %s/.claude/skills\n' "$WORKSPACE"
  if ! prepare_gateway; then
    printf 'AVISO: assets instalados; mydgx-settings.json se generará al definir la clave.\n' >&2
  elif result="$(write_config)"; then
    printf 'Gateway: %s\n' "${result%%$'\t'*}"
  else
    printf 'AVISO: assets instalados, pero falta un modelo de chat/visión cargado para generar mydgx-settings.json.\n' >&2
  fi
  printf 'Siguiente: cd "%s" && %s/start.sh claude\n' "$WORKSPACE" "$ROOT"
}

resolve_project() {
  mkdir -p "$WORKSPACE"
  if [[ "$PWD" == "$ROOT" ]]; then
    cd "$WORKSPACE"
  elif [[ "$PWD" != "$WORKSPACE" && "$PWD" != "$WORKSPACE"/* ]]; then
    printf 'ERROR: ejecuta Claude Code desde %s o uno de sus subdirectorios.\n' "$WORKSPACE" >&2
    exit 2
  fi
}

run_claude() {
  ensure_cli
  resolve_project
  "$ACTIVE" && ensure_node_for_mcp
  if [[ "$ACTIVE" == true && -z "${SHODAN_API_KEY:-}" ]]; then
    printf 'AVISO: SHODAN_API_KEY no está definida; Shodan MCP queda desactivado.\n' >&2
  fi

  local result url selected settings mcp
  prepare_gateway || exit $?
  result="$(write_config)" || exit $?
  [[ -n "$result" ]] || {
    printf 'ERROR: no se recibió configuración de Claude Code.\n' >&2
    exit 1
  }
  IFS=$'\t' read -r url selected settings mcp <<<"$result"

  unset ANTHROPIC_API_KEY
  export ANTHROPIC_BASE_URL="${url%/v1}"
  export ANTHROPIC_AUTH_TOKEN="$MYDGX_GATEWAY_API_KEY"

  local -a args=(
    --settings "$settings"
    --model "$selected"
    --permission-mode "$([[ "$ACTIVE" == true ]] && printf acceptEdits || printf plan)"
    --strict-mcp-config
  )
  [[ -n "$mcp" ]] && args+=(--mcp-config "$mcp")

  # A stderr: stdout queda limpio para `-p --output-format json`.
  printf 'Claude Code: %s mediante %s, modo %s.\n' \
    "$selected" "$ANTHROPIC_BASE_URL" "$([[ "$ACTIVE" == true ]] && printf active || printf plan)" >&2
  printf 'Workspace: %s\nConfig: %s\n' "$PWD" "$settings" >&2
  ((${#CLAUDE_ARGS[@]})) && exec claude "${args[@]}" "${CLAUDE_ARGS[@]}"
  exec claude "${args[@]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    install)
      COMMAND=install
      shift
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
      CLAUDE_ARGS+=("$@")
      break
      ;;
    --*)
      CLAUDE_ARGS+=("$1")
      shift
      ;;
    *)
      if [[ -z "$MODEL" ]]; then
        MODEL="$1"
      else
        CLAUDE_ARGS+=("$1")
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
    IFS=$'\t' read -r _ _ settings _ <<<"$result"
    printf 'Configuración actualizada: %s\n' "$settings"
    ;;
  run)
    run_claude
    ;;
esac
