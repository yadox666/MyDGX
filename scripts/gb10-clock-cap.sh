#!/usr/bin/env bash
# Apply or remove the GB10 clock cap. Fixed limits only: GPU 2200 MHz, CPU 2808 MHz.
# The dashboard may call "apply" and "clear". systemd calls "boot" and "restore".
# No reboot, no kernel change, no package install.
set -euo pipefail

export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
unset LD_LIBRARY_PATH LD_PRELOAD

# Ceiling, not a pinned clock: the GPU may idle below 2200 MHz.
GPU_LOCK_RANGE="0,2200"
CPU_CAP_KHZ="2808000"
UNIT_NAME="mydgx-gb10-clock-cap.service"
UNIT_PATH="/etc/systemd/system/${UNIT_NAME}"
SELF="/usr/local/libexec/mydgx-gb10-clock-cap"
LOCK_PATH="/run/lock/mydgx-gb10-clock-cap.lock"
CPU_BASE="/sys/devices/system/cpu/cpufreq"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [[ "$#" -ne 1 ]]; then
  echo "Uso: mydgx-gb10-clock-cap apply|boot|restore|clear" >&2
  exit 2
fi
ACTION="$1"
case "$ACTION" in
  apply|boot|restore|clear) ;;
  *)
    echo "Acción no permitida" >&2
    exit 2
    ;;
esac

[[ "$(id -u)" -eq 0 ]] || fail "Este ajuste se aplica como root"

here="$(readlink -f -- "$0")"
expected="$(readlink -f -- "$SELF")"
[[ -n "$here" && "$here" == "$expected" && -f "$SELF" && ! -L "$SELF" ]] ||
  fail "Solo se ejecuta la copia instalada"

command -v nvidia-smi >/dev/null 2>&1 || fail "nvidia-smi no está disponible"
nvidia_smi="$(command -v nvidia-smi)"
[[ "$nvidia_smi" == /usr/bin/nvidia-smi || "$nvidia_smi" == /usr/sbin/nvidia-smi ]] ||
  fail "nvidia-smi no está en una ruta del sistema"
resolved="$(readlink -f -- "$nvidia_smi")"
[[ "$resolved" == /usr/* ]] || fail "nvidia-smi no está en una ruta del sistema"
gpu_list="$("$nvidia_smi" -L 2>/dev/null || true)"
grep -qi "GB10" <<<"$gpu_list" || fail "Este límite solo se aplica en una GPU GB10"

lock_held=0
hold_lock() {
  [[ "$lock_held" -eq 1 ]] && return 0
  mkdir -p /run/lock
  exec 9>"$LOCK_PATH"
  /usr/bin/flock -w 45 9 || fail "Ya hay un cambio de reloj en curso"
  lock_held=1
}

release_lock() {
  [[ "$lock_held" -eq 1 ]] || return 0
  /usr/bin/flock -u 9 || true
  lock_held=0
}

each_policy() {
  local policy="$1" mode="$2" max target
  [[ "$policy" =~ ^/sys/devices/system/cpu/cpufreq/policy[0-9]+$ ]] || return 1
  [[ -f "$policy/scaling_max_freq" && -f "$policy/cpuinfo_max_freq" ]] || return 1
  max="$(tr -cd '0-9' <"$policy/cpuinfo_max_freq")"
  [[ "$max" =~ ^[0-9]+$ ]] || return 1
  if [[ "$mode" == "cap" ]]; then
    target="$CPU_CAP_KHZ"
    if (( target > max )); then
      target="$max"
    fi
    if [[ -f "$policy/auto_select" ]]; then
      printf '0\n' >"$policy/auto_select" || return 1
    fi
    printf '%s\n' "$target" >"$policy/scaling_max_freq"
  else
    printf '%s\n' "$max" >"$policy/scaling_max_freq" || return 1
    if [[ -f "$policy/auto_select" ]]; then
      printf '1\n' >"$policy/auto_select" || return 1
    fi
  fi
}

cap_cpu() {
  local policy found=0
  shopt -s nullglob
  for policy in "$CPU_BASE"/policy[0-9]*; do
    [[ "$policy" =~ ^/sys/devices/system/cpu/cpufreq/policy[0-9]+$ ]] || continue
    each_policy "$policy" cap || return 1
    found=1
  done
  shopt -u nullglob
  [[ "$found" -eq 1 ]]
}

restore_cpu() {
  local policy failed=0
  shopt -s nullglob
  for policy in "$CPU_BASE"/policy[0-9]*; do
    [[ "$policy" =~ ^/sys/devices/system/cpu/cpufreq/policy[0-9]+$ ]] || continue
    each_policy "$policy" restore || failed=1
  done
  shopt -u nullglob
  return "$failed"
}

lock_gpu() {
  "$nvidia_smi" -lgc "$GPU_LOCK_RANGE"
}

reset_gpu() {
  "$nvidia_smi" -rgc
}

apply_clocks() {
  lock_gpu
  if ! cap_cpu; then
    reset_gpu || true
    restore_cpu || true
    fail "No se pudo limitar la CPU; la GPU quedó en su reloj de fábrica"
  fi
}

restore_clocks() {
  local failed=0
  reset_gpu || failed=1
  restore_cpu || failed=1
  return "$failed"
}

tmp=""
cleanup() {
  [[ -n "$tmp" && -f "$tmp" ]] && rm -f -- "$tmp"
}
trap cleanup EXIT

write_unit() {
  tmp="$(mktemp "${UNIT_PATH}.XXXXXX")"
  cat >"$tmp" <<'EOF'
[Unit]
Description=MyDGX GB10 clock cap (GPU max 2200 MHz, CPU 2808 MHz)
After=nvidia-persistenced.service
Wants=nvidia-persistenced.service
Before=mydgx.service
StartLimitIntervalSec=300
StartLimitBurst=10

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/libexec/mydgx-gb10-clock-cap boot
ExecStop=/usr/local/libexec/mydgx-gb10-clock-cap restore
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "$tmp"
  mv -f "$tmp" "$UNIT_PATH"
  tmp=""
}

case "$ACTION" in
  boot)
    hold_lock
    apply_clocks
    ;;
  restore)
    hold_lock
    restore_clocks
    ;;
  apply)
    hold_lock
    write_unit
    systemctl daemon-reload
    if ! systemctl enable "$UNIT_NAME"; then
      rm -f -- "$UNIT_PATH"
      systemctl daemon-reload || true
      fail "No se pudo guardar el límite para el próximo arranque"
    fi
    release_lock
    if ! systemctl start "$UNIT_NAME"; then
      systemctl disable "$UNIT_NAME" || true
      systemctl stop "$UNIT_NAME" || true
      hold_lock
      rm -f -- "$UNIT_PATH"
      systemctl daemon-reload || true
      restore_clocks
      fail "No se pudo aplicar el límite; los relojes quedan como estaban"
    fi
    echo "Límite aplicado"
    ;;
  clear)
    systemctl disable "$UNIT_NAME" >/dev/null 2>&1 || true
    systemctl stop "$UNIT_NAME" >/dev/null 2>&1 || true
    hold_lock
    rm -f -- "$UNIT_PATH"
    systemctl daemon-reload || true
    restore_clocks || fail "No se pudo devolver los relojes de fábrica. El límite no volverá a aplicarse al arrancar."
    echo "Límite quitado"
    ;;
esac
