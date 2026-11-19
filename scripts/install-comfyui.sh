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
COMFYUI_REF="${2:-46659e65e95920e5d29cae011b43b02699c0bfd3}"
INSTALL_MODELS="${3:-1}"
ROOT="$HOME/.local/share/mydgx/comfyui"
SOURCE="$ROOT/ComfyUI"
VENV="$ROOT/venv"
ENV_FILE="$ROOT/comfyui.env"

fail() {
  printf 'ERROR: %s\n' "$(pick "$@")" >&2
  exit 1
}

[[ -n "$APP_ROOT" && "$APP_ROOT" == /* && -x "$APP_ROOT/.venv/bin/python" ]] ||
  fail "La instalación principal de MyDGX no está preparada." "The main MyDGX installation is not ready."
[[ "$COMFYUI_REF" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "Revisión de ComfyUI inválida." "Invalid ComfyUI revision."
[[ "$INSTALL_MODELS" =~ ^[01]$ ]] || fail "Estado de modelos ComfyUI inválido." "Invalid ComfyUI models state."
command -v git >/dev/null 2>&1 || fail "git no está instalado." "git is not installed."
command -v python3 >/dev/null 2>&1 || fail "python3 no está instalado." "python3 is not installed."

mkdir -p "$ROOT"
chmod 0700 "$ROOT"
force_install="${MYDGX_FORCE_INSTALL:-0}"
[[ "$force_install" =~ ^[01]$ ]] || fail "MYDGX_FORCE_INSTALL debe valer 0 o 1." "MYDGX_FORCE_INSTALL must be 0 or 1."
prepared=0
if [[ "$force_install" == "0" &&
      -d "$SOURCE/.git" &&
      -x "$VENV/bin/python" &&
      -f "$ROOT/.requested-ref" &&
      "$(cat "$ROOT/.requested-ref")" == "$COMFYUI_REF" ]]; then
  prepared=1
  if [[ "$INSTALL_MODELS" == "1" ]]; then
    for model in \
      "$SOURCE/models/checkpoints/flux1-schnell-fp8.safetensors" \
      "$SOURCE/models/diffusion_models/wan2.1_t2v_1.3B_bf16.safetensors" \
      "$SOURCE/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" \
      "$SOURCE/models/vae/wan_2.1_vae.safetensors"; do
      [[ -f "$model" ]] || prepared=0
    done
  fi
  (
    cd "$SOURCE"
    "$VENV/bin/python" -c 'import aiohttp, comfy, torch, transformers' >/dev/null 2>&1
  ) || prepared=0
fi
if [[ "$prepared" == "1" ]]; then
  say "ComfyUI, su revisión y modelos solicitados ya están preparados; se omiten fetch e instalación." "ComfyUI, its revision, and requested models are already prepared; skipping fetch and install."
else
if [[ ! -d "$SOURCE/.git" ]]; then
  rm -rf -- "$SOURCE"
  git clone https://github.com/Comfy-Org/ComfyUI.git "$SOURCE"
fi
git -C "$SOURCE" fetch --tags origin
revision="$COMFYUI_REF"
if git -C "$SOURCE" rev-parse --verify --quiet "origin/$COMFYUI_REF^{commit}" >/dev/null; then
  revision="origin/$COMFYUI_REF"
fi
git -C "$SOURCE" checkout --detach "$revision"

fingerprint="$(
  {
    git -C "$SOURCE" rev-parse HEAD
    sha256sum "$SOURCE/requirements.txt"
    python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
  } | sha256sum | cut -d' ' -f1
)"
if [[ ! -x "$VENV/bin/python" ||
      ! -f "$VENV/.mydgx-fingerprint" ||
      "$(cat "$VENV/.mydgx-fingerprint")" != "$fingerprint" ]]; then
  rm -rf -- "$VENV.new"
  python3 -m venv "$VENV.new"
  "$VENV.new/bin/python" -m pip install --upgrade pip
  "$VENV.new/bin/python" -m pip install \
    torch torchvision torchaudio \
    --extra-index-url https://download.pytorch.org/whl/cu130
  "$VENV.new/bin/python" -m pip install -r "$SOURCE/requirements.txt"
  # PyTorch CUDA 13 publishes nvidia-cusparselt-cu13 as a dependency even
  # though that auxiliary wheel is marked unsupported on Linux ARM64. The
  # actual GB10 build and CUDA runtime work, so validate the imports/device
  # used by ComfyUI instead of rejecting the environment on package metadata.
  (
    cd "$SOURCE"
    "$VENV.new/bin/python" - <<'PY'
import os

import aiohttp
import comfy
import torch
import transformers

if not torch.cuda.is_available():
    raise SystemExit(
        "PyTorch no detecta CUDA para ComfyUI"
        if os.environ.get("MYDGX_LANGUAGE") == "es"
        else "PyTorch does not detect CUDA for ComfyUI"
    )
print(f"PyTorch {torch.__version__}: {torch.cuda.get_device_name(0)}")
PY
  )
  printf '%s\n' "$fingerprint" >"$VENV.new/.mydgx-fingerprint"
  rm -rf -- "$VENV"
  mv "$VENV.new" "$VENV"
fi

if [[ "$INSTALL_MODELS" == "1" ]]; then
  "$APP_ROOT/.venv/bin/python" - "$SOURCE/models" <<'PY'
import hashlib
import os
import pathlib
import shutil
import sys

from huggingface_hub import hf_hub_download

models = pathlib.Path(sys.argv[1])
downloads = [
    (
        "Comfy-Org/Flux-1-Schnell",
        "flux1-schnell-fp8.safetensors",
        models / "checkpoints" / "flux1-schnell-fp8.safetensors",
        "ead426278b49030e9da5df862994f25ce94ab2ee4df38b556ddddb3db093bf72",
    ),
    (
        "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        "split_files/diffusion_models/wan2.1_t2v_1.3B_bf16.safetensors",
        models / "diffusion_models" / "wan2.1_t2v_1.3B_bf16.safetensors",
        "6f999b0d6cb9a72b3d98ac386ed96f57f8cecae13994a69232514ea4974ad5fd",
    ),
    (
        "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        "split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
        models / "text_encoders" / "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
        "c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68",
    ),
    (
        "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        "split_files/vae/wan_2.1_vae.safetensors",
        models / "vae" / "wan_2.1_vae.safetensors",
        "2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b",
    ),
]

def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

for repo_id, filename, destination, expected in downloads:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and sha256(destination) == expected:
        continue
    # Hugging Face may return a relative symlink inside its snapshot cache.
    # Linking that symlink into ComfyUI would make it point at a non-existent
    # relative target, so always link/copy the resolved immutable blob.
    cached = pathlib.Path(
        hf_hub_download(repo_id=repo_id, filename=filename)
    ).resolve(strict=True)
    temporary = destination.with_suffix(destination.suffix + ".new")
    temporary.unlink(missing_ok=True)
    try:
        os.link(cached, temporary)
    except OSError:
        shutil.copy2(cached, temporary)
    if sha256(temporary) != expected:
        temporary.unlink(missing_ok=True)
        raise SystemExit(
            f"Checksum inválido para {filename}"
            if os.environ.get("MYDGX_LANGUAGE") == "es"
            else f"Invalid checksum for {filename}"
        )
    temporary.replace(destination)
PY
fi
printf '%s\n' "$COMFYUI_REF" >"$ROOT/.requested-ref"
fi

cat >"$ENV_FILE" <<EOF
COMFYUI_ROOT=$SOURCE
COMFYUI_HOST=127.0.0.1
COMFYUI_PORT=8188
EOF
chmod 0600 "$ENV_FILE"
touch "$ROOT/enabled"
chmod 0600 "$ROOT/enabled"
workflow_dir="$SOURCE/user/default/workflows"
mkdir -p "$workflow_dir"
install -m 0600 \
  "$APP_ROOT/config/comfyui/MyDGX-Flux-Image.json" \
  "$workflow_dir/MyDGX - Imagen Flux.json"
install -m 0600 \
  "$APP_ROOT/config/comfyui/MyDGX-Wan-Video.json" \
  "$workflow_dir/MyDGX - Video Wan.json"
"$VENV/bin/python" -c 'import torch; raise SystemExit(not torch.cuda.is_available())'
say "ComfyUI preparado en $ROOT para CUDA y GB10." "ComfyUI ready at $ROOT for CUDA and GB10."
