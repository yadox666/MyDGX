#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib/language.sh
if [[ -f "$(dirname "${BASH_SOURCE[0]}")/lib/language.sh" ]]; then
  source "$(dirname "${BASH_SOURCE[0]}")/lib/language.sh"
else
  pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
  say() { pick "$@"; printf '\n'; }
fi

APP_ROOT="${1:-}"
ROOT="$HOME/.local/share/mydgx/privacy-filter"
VENV="$ROOT/venv"
OPF_REF="f7f00ca7fb869683eb732c010299d901457f19c3"
TORCH_VERSION="2.9.0"

fail() {
  printf 'ERROR: %s\n' "$(pick "$@")" >&2
  exit 1
}

[[ -n "$APP_ROOT" && "$APP_ROOT" == /* && -f "$APP_ROOT/services/privacy-filter/server.py" ]] ||
  fail "No se encontró el servicio Privacy Filter de MyDGX." "The MyDGX Privacy Filter service was not found."
command -v python3 >/dev/null 2>&1 || fail "python3 no está instalado." "python3 is not installed."
python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' ||
  fail "Privacy Filter necesita Python 3.10 o posterior." "Privacy Filter needs Python 3.10 or later."

mkdir -p "$ROOT"
chmod 0700 "$ROOT"
packages=(
  "opf @ git+https://github.com/openai/privacy-filter@$OPF_REF"
  "fastapi==0.124.4"
  "uvicorn[standard]==0.33.0"
)
fingerprint="$(
  {
    printf '%s\n' "torch==$TORCH_VERSION" "${packages[@]}"
    python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
  } | python3 -c 'import hashlib, sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'
)"
if [[ "${MYDGX_FORCE_INSTALL:-0}" != "1" &&
      -x "$VENV/bin/python" &&
      -f "$VENV/.mydgx-fingerprint" &&
      "$(cat "$VENV/.mydgx-fingerprint")" == "$fingerprint" ]] &&
   "$VENV/bin/python" -c 'import fastapi, opf, torch, uvicorn' >/dev/null 2>&1; then
  say "El entorno de Privacy Filter ya está preparado." "The Privacy Filter environment is already prepared."
else
  rm -rf -- "$VENV.new"
  python3 -m venv "$VENV.new"
  "$VENV.new/bin/python" -m pip install --upgrade pip
  if [[ "$(uname -s)" == "Linux" ]]; then
    "$VENV.new/bin/python" -m pip install "torch==$TORCH_VERSION" \
      --extra-index-url https://download.pytorch.org/whl/cu130
  else
    "$VENV.new/bin/python" -m pip install "torch==$TORCH_VERSION"
  fi
  "$VENV.new/bin/python" -m pip install "${packages[@]}"
  "$VENV.new/bin/python" -c 'import fastapi, opf, torch, uvicorn'
  printf '%s\n' "$fingerprint" >"$VENV.new/.mydgx-fingerprint"
  rm -rf -- "$VENV"
  mv "$VENV.new" "$VENV"
fi

# The model tokenizer comes from OpenAI's CDN on first use; cache it now so the service runs offline.
mkdir -p "$ROOT/tiktoken"
TIKTOKEN_CACHE_DIR="$ROOT/tiktoken" "$VENV/bin/python" -c 'import tiktoken; tiktoken.get_encoding("o200k_base")'
"$VENV/bin/python" - <<'PY'
import os

import torch

spanish = os.environ.get("MYDGX_LANGUAGE") == "es"
if torch.cuda.is_available():
    device = torch.cuda.get_device_name(0)
    print(f"Privacy Filter preparado con CUDA: {device}" if spanish else f"Privacy Filter ready with CUDA: {device}")
else:
    print(
        "AVISO: PyTorch no detecta CUDA; Privacy Filter funcionará en CPU."
        if spanish
        else "WARNING: PyTorch does not detect CUDA; Privacy Filter will run on the CPU."
    )
PY
# MyDGX compares this digest with the current script to know when the environment must be rebuilt.
python3 -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' \
  "${BASH_SOURCE[0]}" >"$ROOT/ready"
