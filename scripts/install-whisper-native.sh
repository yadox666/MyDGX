#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${1:?Uso: install-whisper-native.sh APP_ROOT [MODELO]}"
DEFAULT_MODEL="${2:-turbo}"
SERVICE_ROOT="$HOME/.local/share/mydgx/whisper"
VENV="$SERVICE_ROOT/venv"

case "$DEFAULT_MODEL" in
  tiny|tiny.en|base|base.en|small|small.en|medium|medium.en|large|large-v1|large-v2|large-v3|turbo) ;;
  *) echo "Modelo Whisper no soportado: $DEFAULT_MODEL" >&2; exit 1 ;;
esac
[[ -f "$APP_ROOT/services/whisper/server.py" ]] ||
  { echo "No se encontró el servidor Whisper." >&2; exit 1; }

mkdir -p "$SERVICE_ROOT/models"
force_install="${MYDGX_FORCE_INSTALL:-0}"
[[ "$force_install" =~ ^[01]$ ]] ||
  { echo "MYDGX_FORCE_INSTALL debe valer 0 o 1." >&2; exit 1; }
fingerprint="$(
  {
    printf '%s\n' \
      'openai-whisper==20250625' \
      'fastapi==0.124.4' \
      'uvicorn[standard]==0.33.0' \
      'python-multipart==0.0.20'
    python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
  } | sha256sum | cut -d' ' -f1
)"
installed_fingerprint=""
[[ -f "$SERVICE_ROOT/.install-fingerprint" ]] &&
  installed_fingerprint="$(cat "$SERVICE_ROOT/.install-fingerprint")"
install_required=0
if [[ "$force_install" == "1" ||
      ! -x "$VENV/bin/python" ||
      "$fingerprint" != "$installed_fingerprint" ]]; then
  install_required=1
fi
if [[ "$install_required" == "0" ]] &&
   ! "$VENV/bin/python" -c 'import fastapi, torch, uvicorn, whisper' >/dev/null 2>&1; then
  install_required=1
fi
if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv --system-site-packages "$VENV"
fi
if [[ "$install_required" == "1" ]]; then
  "$VENV/bin/python" -m pip install --upgrade pip
  "$VENV/bin/python" -m pip install \
    openai-whisper==20250625 \
    fastapi==0.124.4 \
    "uvicorn[standard]==0.33.0" \
    python-multipart==0.0.20
  printf '%s\n' "$fingerprint" >"$SERVICE_ROOT/.install-fingerprint"
else
  echo "Whisper nativo ya está preparado; se omite la instalación pip."
fi
cp "$APP_ROOT/services/whisper/server.py" "$SERVICE_ROOT/server.py"
cat >"$SERVICE_ROOT/whisper.env" <<EOF
HOME=$SERVICE_ROOT
XDG_CACHE_HOME=$SERVICE_ROOT/.cache
WHISPER_MODEL_DIR=$SERVICE_ROOT/models
WHISPER_DEFAULT_MODEL=$DEFAULT_MODEL
WHISPER_MAX_UPLOAD_MB=64
EOF
chmod 0600 "$SERVICE_ROOT/whisper.env"

"$VENV/bin/python" - <<'PY'
import torch
import whisper

if not torch.cuda.is_available():
    raise SystemExit("El PyTorch del host no expone CUDA; Whisper nativo no puede usar GB10.")
print(f"Whisper nativo preparado con CUDA: {torch.cuda.get_device_name(0)}")
PY
