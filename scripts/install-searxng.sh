#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$HOME/.local/share/mydgx/searxng}"
IMAGE="${2:-searxng/searxng@sha256:048e613ce4a7ddc35dfb05a0b8ede795a054187b3c3b89518adc37d5e03a8297}"
MODE="${3:-auto}"
REF="${4:-626105eec11d776e2dbccff6cc93fd2cd85f4d0c}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "$ROOT" == /* && "$ROOT" != *$'\n'* ]] || fail "Ruta de SearXNG inválida."
[[ "$IMAGE" =~ ^[A-Za-z0-9._/:@+-]+$ ]] || fail "Imagen de SearXNG inválida."
[[ "$MODE" =~ ^(auto|container|native)$ ]] || fail "Modo de SearXNG inválido."
[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || fail "Revisión de SearXNG inválida."

docker_command=()
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker_command=(docker)
elif command -v docker >/dev/null 2>&1 &&
     command -v sudo >/dev/null 2>&1 &&
     sudo -n docker info >/dev/null 2>&1; then
  docker_command=(sudo -n docker)
fi
if [[ "$MODE" == "auto" ]]; then
  if ((${#docker_command[@]})); then
    MODE="container"
  else
    MODE="native"
  fi
fi
[[ "$MODE" != "container" || ${#docker_command[@]} -gt 0 ]] ||
  fail "El daemon Docker no está disponible."

mkdir -p "$ROOT"
chmod 0700 "$ROOT"
secret_file="$ROOT/.secret"
if [[ ! -s "$secret_file" ]]; then
  python3 - "$secret_file" <<'PY'
import pathlib
import secrets
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(secrets.token_urlsafe(48) + "\n", encoding="utf-8")
PY
  chmod 0600 "$secret_file"
fi
secret="$(tr -d '\r\n' <"$secret_file")"
[[ "$secret" =~ ^[A-Za-z0-9_-]{32,}$ ]] || fail "El secreto local de SearXNG no es válido."

cat >"$ROOT/settings.yml" <<EOF
# Administrado por MyDGX. Solo escucha en el puerto publicado por Docker.
use_default_settings: true

server:
  bind_address: "127.0.0.1"
  port: 8888
  secret_key: "$secret"
  limiter: false
  image_proxy: true

search:
  safe_search: 0
  autocomplete: ""
  formats:
    - html
    - json
EOF
chmod 0600 "$ROOT/settings.yml"
printf '%s\n' "$IMAGE" >"$ROOT/image"
chmod 0600 "$ROOT/image"
printf '%s\n' "$MODE" >"$ROOT/mode"
chmod 0600 "$ROOT/mode"
touch "$ROOT/enabled"
chmod 0600 "$ROOT/enabled"

force_install="${MYDGX_FORCE_INSTALL:-0}"
[[ "$force_install" =~ ^[01]$ ]] || fail "MYDGX_FORCE_INSTALL debe valer 0 o 1."
fingerprint="$(
  printf '%s\n' "mode=$MODE" "image=$IMAGE" "ref=$REF" |
    sha256sum | cut -d' ' -f1
)"
installed_fingerprint=""
[[ -f "$ROOT/.install-fingerprint" ]] &&
  installed_fingerprint="$(cat "$ROOT/.install-fingerprint")"
prepared=0
if [[ "$force_install" == "0" && "$fingerprint" == "$installed_fingerprint" ]]; then
  if [[ "$MODE" == "container" ]] &&
     "${docker_command[@]}" image inspect "$IMAGE" >/dev/null 2>&1; then
    prepared=1
  elif [[ "$MODE" == "native" &&
          -d "$ROOT/source/.git" &&
          -x "$ROOT/venv/bin/python" ]] &&
       (cd "$ROOT/source" &&
        SEARXNG_SETTINGS_PATH="$ROOT/settings.yml" \
          "$ROOT/venv/bin/python" -c 'import searx.webapp' >/dev/null 2>&1); then
    prepared=1
  fi
fi

if [[ "$prepared" == "1" ]]; then
  echo "SearXNG ya está preparado; se omiten descarga e instalación."
elif [[ "$MODE" == "container" ]]; then
  # The container listens on its own network namespace.
  python3 - "$ROOT/settings.yml" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
text = text.replace('bind_address: "127.0.0.1"', 'bind_address: "0.0.0.0"')
text = text.replace("port: 8888", "port: 8080")
path.write_text(text, encoding="utf-8")
PY
  "${docker_command[@]}" pull "$IMAGE"
  printf 'SearXNG preparado en %s con la imagen %s.\n' "$ROOT" "$IMAGE"
else
  SOURCE="$ROOT/source"
  VENV="$ROOT/venv"
  command -v git >/dev/null 2>&1 || fail "git no está instalado."
  command -v python3 >/dev/null 2>&1 || fail "python3 no está instalado."
  if [[ ! -d "$SOURCE/.git" ]]; then
    rm -rf -- "$SOURCE"
    git clone https://github.com/searxng/searxng.git "$SOURCE"
  fi
  git -C "$SOURCE" fetch origin "$REF"
  git -C "$SOURCE" checkout --detach "$REF"
  if [[ ! -x "$VENV/bin/python" ]]; then
    python3 -m venv "$VENV"
  fi
  "$VENV/bin/python" -m pip install --upgrade pip setuptools wheel
  "$VENV/bin/python" -m pip install --upgrade pyyaml msgspec typing-extensions pybind11
  (
    cd "$SOURCE"
    "$VENV/bin/python" -m pip install --use-pep517 --no-build-isolation -e .
    SEARXNG_SETTINGS_PATH="$ROOT/settings.yml" \
      "$VENV/bin/python" -c 'import searx.webapp'
  )
  printf 'SearXNG nativo preparado en %s (revisión %s).\n' "$ROOT" "$REF"
fi
printf '%s\n' "$fingerprint" >"$ROOT/.install-fingerprint"
