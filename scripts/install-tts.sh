#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:?Uso: install-tts.sh APP_ROOT HF_HUB_DIR [BASE_IMAGE]}"
HF_HUB_DIR="${2:?Uso: install-tts.sh APP_ROOT HF_HUB_DIR [BASE_IMAGE]}"
BASE_IMAGE="${3:-ubuntu:24.04}"
IMAGE="mydgx-tts:1"
UNIT="/etc/systemd/system/mydgx-tts.service"
REFERENCE_DIR="$ROOT/backend/fixtures/tts"

[[ -f "$ROOT/services/tts/Dockerfile" && -f "$REFERENCE_DIR/manifest.json" ]] ||
  { echo "No se encontró el servicio TTS de MyDGX o su voz de referencia." >&2; exit 1; }
[[ "$BASE_IMAGE" =~ ^[A-Za-z0-9._/:@+-]+$ ]] ||
  { echo "La imagen base de TTS no es válida." >&2; exit 1; }
[[ -d "$HF_HUB_DIR" && "$HF_HUB_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
  { echo "La caché de Hugging Face no es válida." >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "TTS necesita systemd." >&2; exit 1; }
sudo -n docker info >/dev/null 2>&1 || { echo "El daemon Docker no está disponible." >&2; exit 1; }

force_install="${MYDGX_FORCE_INSTALL:-0}"
[[ "$force_install" =~ ^[01]$ ]] || { echo "MYDGX_FORCE_INSTALL debe valer 0 o 1." >&2; exit 1; }
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
if [[ "$force_install" == "1" || "$fingerprint" != "$installed_fingerprint" ]]; then
  echo "Construyendo el runtime TTS CUDA (PyTorch cu130, un entorno por motor)..."
  sudo -n docker build \
    --build-arg "BASE_IMAGE=$BASE_IMAGE" \
    --label "org.mydgx.component=tts" \
    --label "org.mydgx.fingerprint=$fingerprint" \
    -t "$IMAGE" \
    "$ROOT/services/tts"
else
  echo "Imagen TTS sin cambios; se omite docker build."
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

sudo -n install -o root -g root -m 0644 "$unit_tmp" "$UNIT"
sudo -n systemctl daemon-reload
sudo -n systemctl enable mydgx-tts.service
sudo -n systemctl restart mydgx-tts.service

for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:9010/health 2>/dev/null | jq -e '.status == "ok"' >/dev/null; then
    echo "TTS CUDA disponible en http://127.0.0.1:9010"
    exit 0
  fi
  sleep 1
done
sudo -n journalctl -u mydgx-tts.service -n 30 --no-pager >&2 || true
echo "El runtime TTS no respondió en el puerto local 9010." >&2
exit 1
