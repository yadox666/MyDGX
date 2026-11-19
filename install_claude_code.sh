#!/usr/bin/env bash
# Instala únicamente el CLI de Claude Code. La configuración del gateway la
# gestiona claude-code.sh.
#
# SECURITY NOTES:
# - No escribe claves ni lee archivos de credenciales.
# - Prefiere Homebrew o npm. El instalador nativo solo se ejecuta si
#   MYDGX_CLAUDE_INSTALLER_SHA256 fija el SHA-256 del script descargado.
# - Los secretos del gateway, si hacen falta, se pasan mediante el entorno.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/language.sh
if [[ -f "$ROOT/scripts/lib/language.sh" ]]; then
  source "$ROOT/scripts/lib/language.sh"
else
  pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
  say() { pick "$@"; printf '\n'; }
fi

NATIVE_INSTALLER_URL="https://claude.ai/install.sh"

claude_version() {
  claude --version 2>&1 | awk 'NR == 1 { print; exit }'
}

if command -v claude >/dev/null 2>&1; then
  printf "$(pick 'Claude Code ya está instalado: %s\n' 'Claude Code is already installed: %s\n')" "$(claude_version)"
  exit 0
fi

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ENV_HINTS=1

install_native() {
  local installer expected="${MYDGX_CLAUDE_INSTALLER_SHA256:-}" actual
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || return 1
  command -v curl >/dev/null 2>&1 || return 1
  installer="$(mktemp "${TMPDIR:-/tmp}/claude-install.XXXXXX")"
  trap 'rm -f "$installer"' RETURN
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "$NATIVE_INSTALLER_URL" -o "$installer" || return 1
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$installer" | cut -d' ' -f1)"
  else
    actual="$(shasum -a 256 "$installer" | cut -d' ' -f1)"
  fi
  if [[ "$actual" != "$expected" ]]; then
    say "ERROR: el instalador nativo no coincide con MYDGX_CLAUDE_INSTALLER_SHA256." \
      "ERROR: native installer does not match MYDGX_CLAUDE_INSTALLER_SHA256." >&2
    return 1
  fi
  bash "$installer"
}

# Without sudo, a root-owned npm prefix (e.g. /usr/lib/node_modules) fails with EACCES.
npm_install_user() {
  local prefix
  prefix="$(npm config get prefix 2>/dev/null || true)"
  if [[ -n "$prefix" && -w "$prefix/lib" ]] || [[ -n "$prefix" && ! -e "$prefix/lib" && -w "$prefix" ]]; then
    npm install -g "$@"
  else
    mkdir -p "$HOME/.local"
    npm install -g --prefix "$HOME/.local" "$@"
  fi
}

if [[ "$(uname -s)" == Darwin ]] && command -v brew >/dev/null 2>&1; then
  brew install --cask claude-code
elif command -v npm >/dev/null 2>&1; then
  npm_install_user @anthropic-ai/claude-code
elif install_native; then
  :
else
  say "ERROR: no se pudo instalar Claude Code. Instala Homebrew o Node.js/npm, o fija MYDGX_CLAUDE_INSTALLER_SHA256." \
    "ERROR: could not install Claude Code. Install Homebrew or Node.js/npm, or set MYDGX_CLAUDE_INSTALLER_SHA256." >&2
  exit 1
fi

# El instalador nativo deja el binario en ~/.local/bin.
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
hash -r || true
command -v claude >/dev/null 2>&1 || {
  say "ERROR: Claude Code no quedó disponible en PATH. Añade ~/.local/bin y abre una terminal nueva." \
    "ERROR: Claude Code is not available on PATH. Add ~/.local/bin and open a new terminal." >&2
  exit 1
}
printf "$(pick 'Claude Code instalado: %s\n' 'Claude Code installed: %s\n')" "$(claude_version)"