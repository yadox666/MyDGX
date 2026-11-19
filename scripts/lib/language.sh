# Sourced by the MyDGX shell scripts; sets MYDGX_LANGUAGE (es|en) and defines say().
# MYDGX_LANGUAGE wins; then the POSIX locale; C/POSIX falls back to the macOS language list.

mydgx_detect_language() {
  local value languages="${LANGUAGE:-}"
  for value in "${MYDGX_LANGUAGE:-}" "${LC_ALL:-}" "${LC_MESSAGES:-}" "${LANG:-}" "${languages%%:*}"; do
    case "$value" in
      es|es[_.-]*|ES|ES[_.-]*) echo es; return ;;
      en|en[_.-]*|EN|EN[_.-]*) echo en; return ;;
    esac
  done
  if [[ "$(uname -s)" == "Darwin" ]]; then
    value="$(defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n"(' | cut -d, -f1)"
    [[ "$value" == es* ]] && { echo es; return; }
  fi
  echo en
}

MYDGX_LANGUAGE="$(mydgx_detect_language)"
export MYDGX_LANGUAGE

# pick "texto en español" "English text" — writes the one matching MYDGX_LANGUAGE, without a newline.
pick() {
  if [[ "$MYDGX_LANGUAGE" == "es" ]]; then
    printf '%s' "$1"
  else
    printf '%s' "${2:-$1}"
  fi
}

# say "texto en español" "English text" — same as pick, plus a newline.
say() {
  pick "$@"
  printf '\n'
}
