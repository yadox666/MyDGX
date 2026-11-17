#!/usr/bin/env bash
# Instala únicamente el CLI. La configuración del gateway la gestiona opencode.sh.
#
# SECURITY NOTES:
# - No escribe claves ni lee archivos de credenciales.
# - Los secretos del gateway, si hacen falta, se pasan mediante el entorno.
set -Eeuo pipefail

if command -v opencode >/dev/null 2>&1; then
  printf 'OpenCode ya está instalado: %s\n' "$(opencode --version 2>&1 | awk 'NR == 1 { print; exit }')"
  exit 0
fi

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ENV_HINTS=1

if command -v brew >/dev/null 2>&1; then
  brew install anomalyco/tap/opencode
elif command -v npm >/dev/null 2>&1; then
  npm install -g opencode-ai
elif command -v bun >/dev/null 2>&1; then
  bun install -g opencode-ai
else
  printf 'ERROR: instala Homebrew, Node.js/npm o Bun para instalar OpenCode.\n' >&2
  exit 1
fi

hash -r || true
command -v opencode >/dev/null 2>&1 || {
  printf 'ERROR: OpenCode no quedó disponible en PATH. Abre una terminal nueva.\n' >&2
  exit 1
}
printf 'OpenCode instalado: %s\n' "$(opencode --version 2>&1 | awk 'NR == 1 { print; exit }')"
