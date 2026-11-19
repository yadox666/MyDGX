#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib/language.sh
if [[ -f "$(dirname "${BASH_SOURCE[0]}")/lib/language.sh" ]]; then
  source "$(dirname "${BASH_SOURCE[0]}")/lib/language.sh"
else
  pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
  say() { pick "$@"; printf '\n'; }
fi

ROOT="${1:?$(pick "Uso: install-whisper.sh APP_ROOT [BASE_IMAGE] [MODELO] [HF_HUB_DIR]" "Usage: install-whisper.sh APP_ROOT [BASE_IMAGE] [MODEL] [HF_HUB_DIR]")}"
BASE_IMAGE="${2:-nvcr.io/nvidia/pytorch:25.09-py3}"
DEFAULT_MODEL="${3:-turbo}"
HF_HUB_DIR="${4:-$(cd "$ROOT" && ./.venv/bin/python -c 'from backend.main import huggingface_cache_dir; print(huggingface_cache_dir().resolve())' 2>/dev/null || true)}"
IMAGE="mydgx-whisper:20250625"
UNIT="/etc/systemd/system/mydgx-whisper.service"

[[ -d "$ROOT/services/whisper" && -f "$ROOT/services/whisper/Dockerfile" ]] ||
  { say "No se encontró el servicio Whisper de MyDGX." "The MyDGX Whisper service was not found." >&2; exit 1; }
[[ "$BASE_IMAGE" =~ ^[A-Za-z0-9._/:@+-]+$ ]] ||
  { say "La imagen base de Whisper no es válida." "The Whisper base image is not valid." >&2; exit 1; }
[[ "$DEFAULT_MODEL" =~ ^[A-Za-z0-9._/-]+$ ]] ||
  { say "El modelo Whisper no es válido." "The Whisper model is not valid." >&2; exit 1; }
case "$DEFAULT_MODEL" in
  tiny|tiny.en|base|base.en|small|small.en|medium|medium.en|large|large-v1|large-v2|large-v3|turbo) ;;
  *) say "Modelo Whisper no soportado: $DEFAULT_MODEL" "Unsupported Whisper model: $DEFAULT_MODEL" >&2; exit 1 ;;
esac
hf_mount=""
if [[ -n "$HF_HUB_DIR" ]]; then
  [[ "$HF_HUB_DIR" =~ ^/[A-Za-z0-9._/-]+$ && -d "$HF_HUB_DIR" ]] ||
    { say "La caché de Hugging Face no es válida: $HF_HUB_DIR" "The Hugging Face cache is not valid: $HF_HUB_DIR" >&2; exit 1; }
  hf_mount="-v $HF_HUB_DIR:/hf/hub:ro -e WHISPER_HF_HUB=/hf/hub -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 -e HF_HUB_DISABLE_TELEMETRY=1"
fi
command -v docker >/dev/null 2>&1 ||
  { say "Whisper necesita Docker." "Whisper requires Docker." >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 ||
  { say "Whisper necesita systemd." "Whisper requires systemd." >&2; exit 1; }
sudo -n docker info >/dev/null 2>&1 ||
  { say "El daemon Docker no está disponible." "The Docker daemon is not available." >&2; exit 1; }

force_install="${MYDGX_FORCE_INSTALL:-0}"
[[ "$force_install" =~ ^[01]$ ]] ||
  { say "MYDGX_FORCE_INSTALL debe valer 0 o 1." "MYDGX_FORCE_INSTALL must be 0 or 1." >&2; exit 1; }
fingerprint="$(
  {
    printf 'base=%s\n' "$BASE_IMAGE"
    find "$ROOT/services/whisper" -maxdepth 1 -type f -print0 |
      sort -z | xargs -0 sha256sum
  } | sha256sum | cut -d' ' -f1
)"
installed_fingerprint="$(
  sudo -n docker image inspect \
    --format '{{ index .Config.Labels "org.mydgx.fingerprint" }}' \
    "$IMAGE" 2>/dev/null || true
)"
if [[ "$force_install" == "1" || "$fingerprint" != "$installed_fingerprint" ]]; then
  say "Construyendo Whisper sobre la imagen oficial NVIDIA PyTorch $BASE_IMAGE..." "Building Whisper on the official NVIDIA PyTorch image $BASE_IMAGE..."
  sudo -n docker build \
    --build-arg "BASE_IMAGE=$BASE_IMAGE" \
    --label "org.mydgx.component=whisper" \
    --label "org.mydgx.whisper.version=20250625" \
    --label "org.mydgx.fingerprint=$fingerprint" \
    -t "$IMAGE" \
    "$ROOT/services/whisper"
else
  say "Imagen Whisper sin cambios; se omite docker build." "Whisper image unchanged; skipping docker build."
fi

docker_path="$(command -v docker)"
unit_tmp="$(mktemp)"
trap 'rm -f "$unit_tmp"' EXIT
cat >"$unit_tmp" <<EOF
[Unit]
Description=MyDGX Whisper OpenAI-compatible audio service
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
Restart=on-failure
RestartSec=5
TimeoutStartSec=180
ExecStartPre=-$docker_path rm -f mydgx-whisper
ExecStart=$docker_path run --rm --name mydgx-whisper --gpus all --ipc=host --read-only --cap-drop=ALL --security-opt=no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=256m -p 127.0.0.1:9000:9000 -v mydgx-whisper-models:/models $hf_mount -e HOME=/models -e XDG_CACHE_HOME=/models/.cache -e WHISPER_MODEL_DIR=/models -e WHISPER_DEFAULT_MODEL=$DEFAULT_MODEL -e WHISPER_MAX_UPLOAD_MB=64 $IMAGE
ExecStop=$docker_path stop -t 30 mydgx-whisper

[Install]
WantedBy=multi-user.target
EOF

sudo -n install -o root -g root -m 0644 "$unit_tmp" "$UNIT"
sudo -n systemctl daemon-reload
sudo -n systemctl enable mydgx-whisper.service
sudo -n systemctl restart mydgx-whisper.service

ready=0
for _ in {1..180}; do
  if payload="$(curl -fsS http://127.0.0.1:9000/health 2>/dev/null)" &&
     printf '%s' "$payload" | jq -e '.status == "ok" and .cuda == true' >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  sudo -n journalctl -u mydgx-whisper.service -n 30 --no-pager >&2 || true
  say "Whisper no confirmó acceso CUDA en el puerto local 9000." "Whisper did not confirm CUDA access on local port 9000." >&2
  exit 1
fi

say "Whisper disponible en http://127.0.0.1:9000 con CUDA." "Whisper available at http://127.0.0.1:9000 with CUDA."