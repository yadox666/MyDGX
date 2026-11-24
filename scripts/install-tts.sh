#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib/language.sh
if [[ -f "$(dirname "${BASH_SOURCE[0]}")/lib/language.sh" ]]; then
  source "$(dirname "${BASH_SOURCE[0]}")/lib/language.sh"
else
  pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
  say() { pick "$@"; printf '\n'; }
fi

ROOT="${1:?$(pick "Uso: install-tts.sh APP_ROOT HF_HUB_DIR [BASE_IMAGE]" "Usage: install-tts.sh APP_ROOT HF_HUB_DIR [BASE_IMAGE]")}"
HF_HUB_DIR="${2:?$(pick "Uso: install-tts.sh APP_ROOT HF_HUB_DIR [BASE_IMAGE]" "Usage: install-tts.sh APP_ROOT HF_HUB_DIR [BASE_IMAGE]")}"
BASE_IMAGE="${3:-ubuntu:24.04}"
IMAGE="mydgx-tts:1"
UNIT="/etc/systemd/system/mydgx-tts.service"
REFERENCE_DIR="$ROOT/backend/fixtures/tts"

[[ -f "$ROOT/services/tts/Dockerfile" && -f "$REFERENCE_DIR/manifest.json" ]] ||
  { say "No se encontró el servicio TTS de MyDGX o su voz de referencia." "The MyDGX TTS service or its reference voice was not found." >&2; exit 1; }
[[ "$BASE_IMAGE" =~ ^[A-Za-z0-9._/:@+-]+$ ]] ||
  { say "La imagen base de TTS no es válida." "The TTS base image is not valid." >&2; exit 1; }
[[ -d "$HF_HUB_DIR" && "$HF_HUB_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
  { say "La caché de Hugging Face no es válida." "The Hugging Face cache is not valid." >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { say "TTS necesita systemd." "TTS requires systemd." >&2; exit 1; }
sudo -n docker info >/dev/null 2>&1 || { say "El daemon Docker no está disponible." "The Docker daemon is not available." >&2; exit 1; }

force_install="${MYDGX_FORCE_INSTALL:-0}"
[[ "$force_install" =~ ^[01]$ ]] || { say "MYDGX_FORCE_INSTALL debe valer 0 o 1." "MYDGX_FORCE_INSTALL must be 0 or 1." >&2; exit 1; }
fingerprint="$(
  {
    printf 'base=%s\n' "$BASE_IMAGE"
    find "$ROOT/services/tts" -type f -print0 | sort -z | xargs -0 sha256sum |
      sed "s#$ROOT/##"
  } | sha256sum | cut -d' ' -f1
)"
installed_fingerprint="$(
  sudo -n docker image inspect --format '{{ index .Config.Labels "org.mydgx.fingerprint" }}' \
    "$IMAGE" 2>/dev/null || true
)"
image_rebuilt=0
if [[ "$force_install" == "1" || "$fingerprint" != "$installed_fingerprint" ]]; then
  image_rebuilt=1
  say "Construyendo el runtime TTS CUDA (PyTorch cu130, un entorno por motor)..." "Building the CUDA TTS runtime (PyTorch cu130, one environment per engine)..."
  sudo -n docker build \
    --build-arg "BASE_IMAGE=$BASE_IMAGE" \
    --label "org.mydgx.component=tts" \
    --label "org.mydgx.fingerprint=$fingerprint" \
    -t "$IMAGE" \
    "$ROOT/services/tts"
else
  say "Imagen TTS sin cambios; se omite docker build." "TTS image unchanged; skipping docker build."
fi

docker_path="$(command -v docker)"
unit_tmp="$(mktemp)"
trap 'rm -f "$unit_tmp"' EXIT
cat >"$unit_tmp" <<EOF
[Unit]
Description=MyDGX managed CUDA TTS runtime
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
Restart=on-failure
RestartSec=5
TimeoutStartSec=120
ExecStartPre=-$docker_path rm -f mydgx-tts
ExecStart=$docker_path run --rm --name mydgx-tts --gpus all --ipc=host --read-only --cap-drop=ALL --security-opt=no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=4g -p 127.0.0.1:9010:9010 -v $HF_HUB_DIR:/hf/hub:ro -v $REFERENCE_DIR:/reference:ro -e HF_HUB_CACHE=/hf/hub -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 -e HOME=/tmp -e XDG_CACHE_HOME=/tmp/cache -e NUMBA_CACHE_DIR=/tmp/numba -e MPLCONFIGDIR=/tmp/mpl -e TORCHINDUCTOR_CACHE_DIR=/tmp/inductor $IMAGE
ExecStop=$docker_path stop -t 30 mydgx-tts

[Install]
WantedBy=multi-user.target
EOF

unit_changed=0
if ! cmp -s "$unit_tmp" "$UNIT"; then
  unit_changed=1
  sudo -n install -o root -g root -m 0644 "$unit_tmp" "$UNIT"
  sudo -n systemctl daemon-reload
fi
sudo -n systemctl enable mydgx-tts.service
# A restart drops the model loaded in the GPU worker; the next request would pay a cold load.
if [[ "$image_rebuilt" == "1" || "$unit_changed" == "1" ]] || ! systemctl is-active --quiet mydgx-tts.service; then
  sudo -n systemctl restart mydgx-tts.service
else
  say "Runtime TTS sin cambios; se conserva el modelo cargado." "TTS runtime unchanged; keeping the loaded model."
fi

for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:9010/health 2>/dev/null | jq -e '.status == "ok"' >/dev/null; then
    say "TTS CUDA disponible en http://127.0.0.1:9010" "CUDA TTS available at http://127.0.0.1:9010"
    exit 0
  fi
  sleep 1
done
sudo -n journalctl -u mydgx-tts.service -n 30 --no-pager >&2 || true
say "El runtime TTS no respondió en el puerto local 9010." "The TTS runtime did not respond on local port 9010." >&2
exit 1