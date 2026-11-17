#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/cuda-13.0/bin:/usr/local/cuda-13/bin:/usr/local/cuda/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

MODE="${1:---check}"
CONFIG_FILE="/etc/mydgx/repair.env"
configured_ref=""
if [[ -r "$CONFIG_FILE" ]]; then
  configured_ref="$(sed -nE 's/^MYDGX_LLAMA_CPP_REF=([A-Za-z0-9._\/-]+)$/\1/p' "$CONFIG_FILE")"
fi
LLAMA_REF="${MYDGX_LLAMA_CPP_REF:-${configured_ref:-b10679}}"
FORCE_LLAMA_BUILD="${MYDGX_FORCE_LLAMA_CPP_BUILD:-0}"
CUDA_ARCH="${MYDGX_CUDA_ARCH:-121}"
STATE_DIR="/var/lib/mydgx"
BUILD_STATE="$STATE_DIR/llama-build.fingerprint"
REPORT_FILE="$STATE_DIR/integrity.env"
LLAMA_SRC="/var/cache/mydgx/llama.cpp"
LLAMA_BUILD="/var/cache/mydgx/llama-build"
LLAMA_REF_STATE="/var/cache/mydgx/llama-ref"
LLAMA_TOOLS=(llama-server llama-cli llama-quantize llama-gguf-split)

log() {
  printf 'mydgx-repair: %s\n' "$*"
}

fail() {
  printf 'mydgx-repair: ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "$MODE" == "--drop-caches" ]]; then
  [[ "$EUID" -eq 0 ]] || fail "Vaciar la caché de páginas requiere root."
  sync
  echo 3 > /proc/sys/vm/drop_caches
  exit 0
fi

[[ "$MODE" == "--check" || "$MODE" == "--repair" || "$MODE" == "--boot" ]] ||
  fail "Modo no permitido: $MODE"
[[ "$LLAMA_REF" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "Revisión llama.cpp inválida."
[[ "$FORCE_LLAMA_BUILD" =~ ^[01]$ ]] || fail "MYDGX_FORCE_LLAMA_CPP_BUILD debe valer 0 o 1."
[[ "$CUDA_ARCH" =~ ^[0-9]+$ ]] || fail "Arquitectura CUDA inválida."

if [[ "$MODE" != "--check" && "$EUID" -ne 0 ]]; then
  fail "Los modos de reparación requieren root."
fi

export PATH="/usr/local/cuda-13.0/bin:/usr/local/cuda/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

current_kernel="$(uname -r)"
latest_kernel="$current_kernel"
if [[ -d /lib/modules ]]; then
  # Ignore non-version directories such as /lib/modules/kernel, left behind by DKMS.
  latest_kernel="$(
    find /lib/modules -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null |
      grep -E '^[0-9]+\.[0-9]+' |
      sort -V |
      tail -n1
  )"
  latest_kernel="${latest_kernel:-$current_kernel}"
fi
reboot_required=0
[[ -f /var/run/reboot-required || "$latest_kernel" != "$current_kernel" ]] && reboot_required=1

apt_ok=1
dpkg_ok=1
if command -v apt-get >/dev/null 2>&1; then
  if [[ "$MODE" == "--check" && "$EUID" -ne 0 ]]; then
    apt-get -s check >/dev/null 2>&1 || apt_ok=0
  else
    apt-get check >/dev/null 2>&1 || apt_ok=0
  fi
fi
if command -v dpkg >/dev/null 2>&1; then
  [[ -z "$(dpkg --audit 2>/dev/null)" ]] || dpkg_ok=0
fi

if [[ "$MODE" == "--repair" && ("$apt_ok" == "0" || "$dpkg_ok" == "0") ]]; then
  log "Reparando configuración de paquetes interrumpida"
  dpkg --configure -a
  DEBIAN_FRONTEND=noninteractive apt-get -f install -y
  apt-get check
  apt_ok=1
  dpkg_ok=1
fi

dkms_ok=1
if command -v dkms >/dev/null 2>&1; then
  if [[ "$MODE" != "--check" ]]; then
    log "Verificando módulos DKMS para los kernels instalados ($current_kernel → $latest_kernel)"
    dkms autoinstall || dkms_ok=0
  elif dkms status 2>/dev/null | grep -qiE 'added|built'; then
    dkms_ok=0
  fi
fi

nvidia_ok=0
driver_version="not-detected"
if command -v nvidia-smi >/dev/null 2>&1; then
  driver_version="$(
    nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null |
      sort -u | paste -sd, - || true
  )"
  driver_version="${driver_version:-not-detected}"
  [[ -n "$driver_version" ]] && nvidia_ok=1
  [[ "$driver_version" == "not-detected" ]] && nvidia_ok=0
fi

container_runtime_ok=1
if command -v docker >/dev/null 2>&1; then
  if ! command -v nvidia-ctk >/dev/null 2>&1; then
    container_runtime_ok=0
  elif [[ "$MODE" != "--check" ]]; then
    log "Verificando runtime NVIDIA para Docker"
    docker_config_before="$(sha256sum /etc/docker/daemon.json 2>/dev/null || true)"
    nvidia-ctk runtime configure --runtime=docker >/dev/null || container_runtime_ok=0
    docker_config_after="$(sha256sum /etc/docker/daemon.json 2>/dev/null || true)"
    if [[ "$docker_config_before" != "$docker_config_after" && -d /run/systemd/system ]] &&
       systemctl is-active docker >/dev/null 2>&1; then
      systemctl try-restart docker || container_runtime_ok=0
    fi
  fi
fi

nvcc_version="not-detected"
if command -v nvcc >/dev/null 2>&1; then
  nvcc_version="$(nvcc --version | sed -nE 's/.*release ([0-9.]+).*/\1/p')"
  nvcc_version="${nvcc_version:-unknown}"
fi

llama_ok=1
for tool in "${LLAMA_TOOLS[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    llama_ok=0
  elif [[ "$tool" != "llama-quantize" ]] && ! "$tool" --version >/dev/null 2>&1; then
    llama_ok=0
  fi
done

fingerprint="$(
  printf '%s\n' \
    "kernel=$current_kernel" \
    "driver=$driver_version" \
    "cuda=$nvcc_version" \
    "cuda_arch=$CUDA_ARCH" \
    "llama_ref=$LLAMA_REF" |
    sha256sum | awk '{print $1}'
)"
installed_fingerprint=""
[[ -f "$BUILD_STATE" ]] && installed_fingerprint="$(cat "$BUILD_STATE")"
llama_repair_required=0
[[ "$llama_ok" == "1" && "$fingerprint" == "$installed_fingerprint" ]] ||
  llama_repair_required=1
llama_rebuilt=0

if [[ "$MODE" != "--check" &&
      ("$FORCE_LLAMA_BUILD" == "1" || "$llama_ok" == "0" || "$fingerprint" != "$installed_fingerprint") ]]; then
  command -v git >/dev/null 2>&1 || fail "Falta git para reparar llama.cpp."
  command -v cmake >/dev/null 2>&1 || fail "Falta cmake para reparar llama.cpp."
  command -v ninja >/dev/null 2>&1 || fail "Falta ninja para reparar llama.cpp."
  command -v nvcc >/dev/null 2>&1 || fail "Falta CUDA/nvcc para compilar llama.cpp."

  log "Recompilando llama.cpp por cambio de kernel/CUDA/driver/revisión"
  install -d -m 0755 "$STATE_DIR" "$(dirname "$LLAMA_SRC")"
  if [[ ! -d "$LLAMA_SRC/.git" ]]; then
    git clone --filter=blob:none https://github.com/ggml-org/llama.cpp.git "$LLAMA_SRC"
  fi
  installed_ref=""
  [[ -f "$LLAMA_REF_STATE" ]] && installed_ref="$(cat "$LLAMA_REF_STATE")"
  if [[ "$installed_ref" != "$LLAMA_REF" ]]; then
    case "$LLAMA_REF" in
      b10679) expected_commit="50f068ffffc3e0e4c9c2e4139281c6075224f429" ;;
      *) expected_commit="" ;;
    esac
    [[ "$LLAMA_REF" =~ ^[0-9a-f]{40}$ ]] && expected_commit="$LLAMA_REF"
    [[ -n "$expected_commit" ]] ||
      fail "La revisión $LLAMA_REF de llama.cpp no está fijada; usa el commit completo (40 hex) en MYDGX_LLAMA_CPP_REF."
    git -C "$LLAMA_SRC" fetch --depth 1 origin "$LLAMA_REF"
    [[ "$(git -C "$LLAMA_SRC" rev-parse FETCH_HEAD)" == "$expected_commit" ]] ||
      fail "La etiqueta $LLAMA_REF de llama.cpp ya no apunta al commit fijado $expected_commit."
    git -C "$LLAMA_SRC" checkout --detach FETCH_HEAD
    printf '%s\n' "$LLAMA_REF" >"$LLAMA_REF_STATE"
  fi
  rm -rf "$LLAMA_BUILD.new"
  cmake -S "$LLAMA_SRC" -B "$LLAMA_BUILD.new" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CUDA_ARCHITECTURES="$CUDA_ARCH" \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_CUDA=ON \
    -DGGML_BLAS=ON \
    -DGGML_BLAS_VENDOR=OpenBLAS \
    -DGGML_CCACHE=ON \
    -DGGML_NATIVE=OFF \
    -DLLAMA_CURL=ON \
    -G Ninja
  cmake --build "$LLAMA_BUILD.new" --target "${LLAMA_TOOLS[@]}" -j"$(nproc)"
  for tool in "${LLAMA_TOOLS[@]}"; do
    install -m 0755 "$LLAMA_BUILD.new/bin/$tool" "/usr/local/bin/$tool.new"
    mv -f "/usr/local/bin/$tool.new" "/usr/local/bin/$tool"
  done
  rm -rf "$LLAMA_BUILD"
  mv "$LLAMA_BUILD.new" "$LLAMA_BUILD"
  printf '%s\n' "$fingerprint" >"$BUILD_STATE.new"
  mv -f "$BUILD_STATE.new" "$BUILD_STATE"
  llama_ok=1
  llama_repair_required=0
  llama_rebuilt=1
fi

status="ok"
if [[ "$apt_ok" == "0" || "$dpkg_ok" == "0" || "$dkms_ok" == "0" || "$container_runtime_ok" == "0" ||
      "$nvidia_ok" == "0" || "$llama_ok" == "0" || "$llama_repair_required" == "1" ||
      "$reboot_required" == "1" ]]; then
  status="warning"
fi

checked_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
report="$(
  printf '%s\n' \
    "status=$status" \
    "checked_at=$checked_at" \
    "kernel_current=$current_kernel" \
    "kernel_latest=$latest_kernel" \
    "reboot_required=$reboot_required" \
    "apt_ok=$apt_ok" \
    "dpkg_ok=$dpkg_ok" \
    "dkms_ok=$dkms_ok" \
    "container_runtime_ok=$container_runtime_ok" \
    "nvidia_ok=$nvidia_ok" \
    "driver_version=$driver_version" \
    "cuda_version=$nvcc_version" \
    "llama_ok=$llama_ok" \
    "llama_repair_required=$llama_repair_required" \
    "llama_rebuilt=$llama_rebuilt"
)"
printf '%s\n' "$report"
if [[ "$EUID" -eq 0 ]]; then
  install -d -m 0755 "$STATE_DIR"
  printf '%s\n' "$report" >"$REPORT_FILE.new"
  chmod 0644 "$REPORT_FILE.new"
  mv -f "$REPORT_FILE.new" "$REPORT_FILE"
fi
