#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib/language.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/language.sh"

MODE="--audit"
CONFIRMATION=""
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_ROOT="/var/lib/mydgx/serverize"
REPORT_DIR="$ROOT/data"
DEPLOY_SCRIPT="$ROOT/deploy.sh"
MYDGX_EXTRA_PACKAGES=(
  nodejs avahi-utils avahi-daemon libglib2.0-0t64 libglib2.0-0
  docker.io containerd nvidia-container-toolkit openssh-server
)
USER_APP_ROOTS=(/home /root /opt /usr/local /srv)
KEEP_PACKAGES=()
declare -A USER_APP_PACKAGES=()
DESKTOP_SNAPS=(firefox thunderbird snap-store snapd-desktop-integration firmware-updater)
SERVICE_CANDIDATES=(
  display-manager.service gdm.service gdm3.service
  bluetooth.service cups.service cups-browsed.service
  ModemManager.service switcheroo-control.service colord.service
  whoopsie.service
)
PRESERVED_SERVICES=(
  ssh.service NetworkManager.service avahi-daemon.service
  docker.service containerd.service ollama.service
  mydgx.service mydgx-gateway.service
)

usage() {
  if [[ "$MYDGX_LANGUAGE" == es ]]; then
    cat <<'EOF'
Uso:
  ./start.sh serverize [--audit]
  sudo ./start.sh serverize --disable --confirm DISABLE-DESKTOP-SERVICES
  sudo ./start.sh serverize --apply --confirm CONVERT-TO-HEADLESS-SERVER

--audit  Solo inventaría paquetes/servicios y simula APT. Es el modo predeterminado.
--disable Desactiva el escritorio y servicios prescindibles sin borrar paquetes.
--apply  Aplica el plan verificado, cambia a multi-user.target y elimina el escritorio.
--keep PAQUETE  Conserva además ese paquete APT. Se puede repetir.

El modo --apply conserva red, SSH, Avahi/mDNS, NVIDIA, CUDA, Docker, Ollama,
MyDGX y firmware, y los paquetes de los que dependen las aplicaciones
instaladas fuera de APT en /home, /root, /opt, /usr/local y /srv. De los kernels deja los dos más recientes y, si es más
antiguo, también el que está en ejecución. Guarda el estado previo en
/var/lib/mydgx/serverize/.
EOF
  else
    cat <<'EOF'
Usage:
  ./start.sh serverize [--audit]
  sudo ./start.sh serverize --disable --confirm DISABLE-DESKTOP-SERVICES
  sudo ./start.sh serverize --apply --confirm CONVERT-TO-HEADLESS-SERVER

--audit  Only inventories packages/services and simulates APT. This is the default mode.
--disable Disables the desktop and dispensable services without removing packages.
--apply  Applies the verified plan, switches to multi-user.target, and removes the desktop.
--keep PACKAGE  Also keeps this APT package. Can be repeated.

--apply mode preserves network, SSH, Avahi/mDNS, NVIDIA, CUDA, Docker, Ollama,
MyDGX and firmware, and packages that apps installed outside APT depend on
in /home, /root, /opt, /usr/local and /srv. Of the kernels it keeps the two most recent and, if older,
also the one that is running. Saves prior state in
/var/lib/mydgx/serverize/.
EOF
  fi
}

fail() {
  printf 'ERROR: %s\n' "$(pick "$@")" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --audit|--plan)
      MODE="--audit"
      shift
      ;;
    --apply)
      MODE="--apply"
      shift
      ;;
    --disable|--disable-only)
      MODE="--disable"
      shift
      ;;
    --confirm)
      (($# >= 2)) || fail "--confirm necesita un valor." "--confirm requires a value."
      CONFIRMATION="$2"
      shift 2
      ;;
    --keep)
      (($# >= 2)) || fail "--keep necesita un nombre de paquete." "--keep requires a package name."
      [[ "$2" =~ ^[a-z0-9][a-z0-9+.-]+(:[a-z0-9]+)?$ ]] ||
        fail "Nombre de paquete no válido: $2" "Invalid package name: $2"
      KEEP_PACKAGES+=("${2%%:*}")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Opción no permitida: $1" "Option not allowed: $1"
      ;;
  esac
done

[[ "$(uname -s)" == "Linux" ]] ||
  fail "Esta operación solo está disponible en Linux." "This operation is only available on Linux."
for command in apt-get apt-mark dpkg dpkg-query systemctl awk grep sed sort find xargs \
    readelf ldconfig df python3; do
  command -v "$command" >/dev/null 2>&1 ||
    fail "Falta el comando requerido: $command" "Required command not found: $command"
done
[[ -r /etc/os-release ]] ||
  fail "No se pudo identificar el sistema operativo." "Could not identify the operating system."
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == "ubuntu" || "${ID_LIKE:-}" == *debian* ]] ||
  fail "Solo se admiten sistemas Ubuntu/Debian administrados por APT." \
    "Only Ubuntu/Debian systems managed by APT are supported."
[[ -d /run/systemd/system ]] || fail "systemd no está activo." "systemd is not active."

installed_packages() {
  dpkg-query -W -f='${binary:Package}\t${db:Status-Abbrev}\n' 2>/dev/null |
    awk -F '\t' '$2 ~ /^ii/ {print $1}'
}

is_desktop_package() {
  local package="${1%%:*}"
  case "$package" in
    ubuntu-desktop|ubuntu-desktop-*|ubuntu-session|gdm3|xorg|xorg-docs-core|xorg-sgml-doctools|\
    xserver-xorg-input-all|xinit|x11-apps|x11-session-utils|\
    x11-xserver-utils|xdg-desktop-portal|xdg-desktop-portal-*|network-manager-gnome|\
    language-pack-gnome-*|ubuntu-wallpapers|ubuntu-wallpapers-*|yaru-theme-*|\
    gnome-accessibility-themes|gnome-backgrounds|gnome-bluetooth-*|gnome-calculator|\
    gnome-calendar|gnome-characters|gnome-control-center|gnome-control-center-*|\
    gnome-desktop3-data|gnome-disk-utility|gnome-font-viewer|gnome-initial-setup|\
    gnome-logs|gnome-mahjongg|gnome-menus|gnome-mines|gnome-online-accounts|\
    gnome-power-manager|gnome-remote-desktop|gnome-screenshot|gnome-session|\
    gnome-session-*|gnome-settings-daemon|gnome-settings-daemon-*|gnome-shell|\
    gnome-shell-*|gnome-startup-applications|gnome-sudoku|gnome-sushi|\
    gnome-system-monitor|gnome-terminal|gnome-terminal-*|gnome-text-editor|\
    gnome-themes-extra|gnome-themes-extra-*|gnome-tweaks|gnome-user-docs|\
    gnome-user-docs-*|gnome-user-share|gnome-video-effects|\
    libreoffice|libreoffice-*|firefox|firefox-*|thunderbird|thunderbird-*|\
    baobab|cheese|cheese-*|deja-dup|eog|evince|evince-*|file-roller|\
    nautilus|nautilus-*|remmina|remmina-*|rhythmbox|rhythmbox-*|shotwell|\
    shotwell-*|simple-scan|totem|totem-*|transmission-gtk|transmission-common|\
    seahorse|software-properties-gtk|update-manager|usb-creator-gtk|yelp|yelp-*|\
    cups|cups-browsed|cups-client|cups-common|cups-daemon|cups-ipp-utils|cups-ppdc|\
    printer-driver-*|system-config-printer|system-config-printer-*|ipp-usb|\
    bluez|bluez-cups|blueman|modemmanager|switcheroo-control|colord|\
    whoopsie|ubuntu-report|dgx-dashboard|dgx-oobe|dgx-oobe-desktop|\
    dgx-spark-oobe-customize|dgxstation-desktop)
      return 0
      ;;
  esac
  return 1
}

load_mydgx_packages() {
  local package count=0
  declare -gA MYDGX_PACKAGES=()
  for package in "${MYDGX_EXTRA_PACKAGES[@]}"; do
    MYDGX_PACKAGES[$package]=1
  done
  [[ -r "$DEPLOY_SCRIPT" ]] || return 0
  while read -r package; do
    MYDGX_PACKAGES[$package]=1
    count=$((count + 1))
  done < <(
    awk '
      /^base_packages=\(/ { inside = 1; next }
      inside && /^\)/ { exit }
      inside {
        gsub(/[\\"]/, "")
        for (i = 1; i <= NF; i++) if ($i ~ /^[a-z0-9][a-z0-9+.-]+$/) print $i
      }
    ' "$DEPLOY_SCRIPT"
  )
  ((count >= 10)) ||
    fail "No se pudo leer la lista de dependencias de MyDGX en deploy.sh." \
      "Could not read MyDGX dependency list from deploy.sh."
}

paths_to_packages() {
  sort -u |
    while IFS= read -r path; do
      printf '%s\n' "$path"
      readlink -f "$path" 2>/dev/null || true
    done |
    sort -u |
    { xargs -r -d '\n' dpkg -S 2>/dev/null || true; } |
    awk -F': ' '{
      n = split($1, owners, ", ")
      for (i = 1; i <= n; i++) {
        sub(/:.*/, "", owners[i])
        if (owners[i] ~ /^[a-z0-9][a-z0-9+.-]+$/) print owners[i]
      }
    }' |
    sort -u
}

interpreter_path() {
  local file="$1" line interpreter argument
  line="$(head -c 256 "$file" 2>/dev/null | head -n 1 | tr -d '\0')" || return 0
  [[ "$line" == '#!'* ]] || return 0
  read -r interpreter argument _ <<<"${line#\#!}"
  if [[ "$interpreter" == */env && -n "${argument:-}" && "$argument" != -* ]]; then
    interpreter="$(command -v "$argument" 2>/dev/null || true)"
  fi
  [[ "$interpreter" == /* ]] && printf '%s\n' "$interpreter"
  return 0
}

collect_user_app_packages() {
  local root package scan file cfg unit command
  local -a roots=()
  USER_APP_PACKAGES=()
  for package in "${KEEP_PACKAGES[@]}"; do
    USER_APP_PACKAGES[$package]=1
  done
  for root in "${USER_APP_ROOTS[@]}"; do
    if [[ -d "$root" && ! -L "$root" ]]; then
      roots+=("$root")
    fi
  done
  ((${#roots[@]})) || return 0

  scan="$(mktemp -d)"
  find "${roots[@]}" -xdev \
    \( -name .git -o -name __pycache__ -o -path '*/.local/share/Trash' \) -prune -o \
    -type f -name pyvenv.cfg -fprint "$scan/venvs" -o \
    -type f \( -name '*.so' -o -name '*.so.*' -o -name '*.node' -o -perm -u+x \) \
    -size -2G -fprint0 "$scan/files" 2>/dev/null || true
  touch "$scan/venvs" "$scan/files"

  {
    { xargs -0 -r -n 256 readelf -d <"$scan/files" 2>/dev/null || true; } |
      sed -n 's/.*Shared library: \[\(.*\)\]$/\1/p' | sort -u |
      awk 'NR == FNR {wanted[$1] = 1; next} / => / && ($1 in wanted) {print $NF}' \
        - <(ldconfig -p)
    while IFS= read -r cfg; do
      readlink -f "$(dirname "$cfg")/bin/python" 2>/dev/null || true
    done <"$scan/venvs"
    while IFS= read -r -d '' file; do
      if [[ "$file" == */bin/* ]]; then
        interpreter_path "$file"
      fi
    done <"$scan/files"
    for unit in /home/*/.config/systemd/user/*.service /root/.config/systemd/user/*.service; do
      [[ -f "$unit" ]] || continue
      sed -n 's/^ExecStart=[-@+!:]*\([^ ]*\).*/\1/p' "$unit" 2>/dev/null || true
    done
  } | while IFS= read -r command; do
    if [[ "$command" == /* && -e "$command" ]]; then
      printf '%s\n' "$command"
    fi
  done | paths_to_packages >"$scan/packages"

  while IFS= read -r package; do
    USER_APP_PACKAGES[$package]=1
  done <"$scan/packages"
  rm -rf "$scan"
}

is_protected_package() {
  local package="${1%%:*}"
  [[ -n "${MYDGX_PACKAGES[$package]:-}" ]] && return 0
  [[ -n "${USER_APP_PACKAGES[$package]:-}" ]] && return 0
  # Estos son exclusivamente metapaquetes del escritorio DGX, no drivers.
  case "$package" in
    nvidia-system-station|nvidia-system-station-*|network-manager-gnome|\
    network-manager-*-gnome|dgx-dashboard|dgx-oobe|dgx-oobe-desktop|\
    dgx-spark-oobe-customize|dgxstation-desktop)
      return 1
      ;;
  esac
  case "$package" in
    nvidia-driver-*|nvidia-headless-*|nvidia-kernel-*|nvidia-dkms-*|\
    nvidia-utils-*|nvidia-compute-utils-*|nvidia-container-*|nvidia-firmware-*|\
    nvidia-modprobe|nvidia-persistenced|nvidia-settings|nvidia-prime|\
    nvidia-system-extra|nvidia-spark-*|nvidia-lvfs-*|libnvidia-*|\
    xserver-xorg-video-nvidia-*|nv-docker-options|dgx-*|dgxstation-grub|\
    *cuda*|*cudnn*|*tensorrt*|linux-*|linux-firmware|\
    systemd|systemd-*|init|udev|dbus|dbus-*|network-manager|network-manager-*|\
    libnm0|netplan.io|openssh-*|ssh|sudo|apt|apt-*|dpkg|grub-*|shim-*|\
    cloud-init|docker-*|docker.io|containerd|containerd.io|runc|ollama|\
    python3|python3-minimal|ca-certificates|curl|git|bash|coreutils|util-linux|\
    mount|libc6|iproute2|iputils-*|ethtool|pciutils|ubuntu-minimal|\
    ubuntu-standard|ubuntu-server|ubuntu-server-minimal|avahi-daemon)
      return 0
      ;;
  esac
  return 1
}

release_abi() {
  local release="$1"
  [[ "$release" =~ ^([0-9]+\.[0-9]+\.[0-9]+-[0-9]+) ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}

package_matches_abi() {
  local package="$1" abi="$2" escaped
  [[ "$package" == linux-* ]] || return 1
  escaped="${abi//./\\.}"
  [[ "$package" =~ (^|[^0-9])${escaped}([^0-9]|$) ]]
}

collect_kernel_cleanup() {
  local image release package abi keep_abi remove_abi running kept
  local -a remove_abis=()
  KERNEL_RELEASES=()
  KERNEL_KEEP_RELEASES=()
  KERNEL_REMOVE_RELEASES=()
  KERNEL_REMOVE_PACKAGES=()
  running="$(uname -r)"

  while read -r image; do
    [[ "$image" =~ ^linux-image-(unsigned-)?([0-9]+\.[0-9]+\.[0-9]+-[0-9]+-.+)$ ]] || continue
    KERNEL_RELEASES+=("${BASH_REMATCH[2]}")
  done < <(
    dpkg-query -W -f='${binary:Package}\t${db:Status-Abbrev}\n' 'linux-image-*' 2>/dev/null |
      awk -F '\t' '$2 ~ /^ii/ {print $1}'
  )
  if ((${#KERNEL_RELEASES[@]})); then
    mapfile -t KERNEL_RELEASES < <(printf '%s\n' "${KERNEL_RELEASES[@]}" | sort -uV)
  fi

  local count="${#KERNEL_RELEASES[@]}"
  if ((count > 2)); then
    KERNEL_KEEP_RELEASES=("${KERNEL_RELEASES[@]:count-2}")
  elif ((count > 0)); then
    KERNEL_KEEP_RELEASES=("${KERNEL_RELEASES[@]}")
  fi
  if [[ "$running" =~ ^[0-9]+\.[0-9]+\.[0-9]+-[0-9]+- ]]; then
    kept=0
    for release in "${KERNEL_KEEP_RELEASES[@]}"; do
      [[ "$release" == "$running" ]] && kept=1
    done
    if [[ "$kept" == "0" ]]; then
      for release in "${KERNEL_RELEASES[@]}"; do
        [[ "$release" == "$running" ]] && KERNEL_KEEP_RELEASES+=("$running")
      done
    fi
  fi

  for release in "${KERNEL_RELEASES[@]}"; do
    keep_abi="$(release_abi "$release")" || continue
    kept=0
    for image in "${KERNEL_KEEP_RELEASES[@]}"; do
      abi="$(release_abi "$image" 2>/dev/null || true)"
      [[ "$abi" == "$keep_abi" ]] && kept=1
    done
    if [[ "$kept" == "0" ]]; then
      KERNEL_REMOVE_RELEASES+=("$release")
      remove_abis+=("$keep_abi")
    fi
  done

  if ((${#remove_abis[@]} == 0)); then
    return 0
  fi

  while read -r package; do
    package="${package%%:*}"
    [[ "$package" == *"$running"* ]] && continue
    remove_abi=""
    for abi in "${remove_abis[@]}"; do
      package_matches_abi "$package" "$abi" && remove_abi="$abi"
    done
    [[ -n "$remove_abi" ]] || continue
    for image in "${KERNEL_KEEP_RELEASES[@]}"; do
      abi="$(release_abi "$image" 2>/dev/null || true)"
      [[ -n "$abi" ]] && package_matches_abi "$package" "$abi" && continue 2
    done
    KERNEL_REMOVE_PACKAGES+=("$package")
  done < <(installed_packages)

  if ((${#KERNEL_REMOVE_PACKAGES[@]})); then
    mapfile -t KERNEL_REMOVE_PACKAGES < <(printf '%s\n' "${KERNEL_REMOVE_PACKAGES[@]}" | sort -u)
  fi
}

print_kernel_plan() {
  local release marker kept
  printf "$(pick $'\\nKernels instalados (%d). Se conservan los dos más recientes' \
    $'\\nInstalled kernels (%d). Keeping the two most recent')" \
    "${#KERNEL_RELEASES[@]}"
  printf "$(pick $' y el kernel en ejecución:\\n' $' and the running kernel:\\n')"
  if ((${#KERNEL_RELEASES[@]} == 0)); then
    printf "$(pick '  no hay imágenes de kernel empaquetadas\n' \
      '  no packaged kernel images\n')"
    return 0
  fi
  for release in "${KERNEL_RELEASES[@]}"; do
    marker="$(pick "se eliminará" "will remove")"
    for kept in "${KERNEL_KEEP_RELEASES[@]}"; do
      [[ "$release" == "$kept" ]] && marker="$(pick "se conserva" "kept")"
    done
    if [[ "$release" == "$(uname -r)" ]]; then
      marker="${marker}$(pick ", en ejecución" ", running")"
    fi
    printf '  %s (%s)\n' "$release" "$marker"
  done
  if ((${#KERNEL_REMOVE_PACKAGES[@]})); then
    printf "$(pick 'Paquetes de kernels antiguos y sus dependencias de esa versión (%d):\n' \
      'Old kernel packages and dependencies for that version (%d):\n')" \
      "${#KERNEL_REMOVE_PACKAGES[@]}"
    printf '  %s\n' "${KERNEL_REMOVE_PACKAGES[@]}"
  else
    printf "$(pick 'No hay kernels anteriores a los que se conservan.\n' \
      'No kernels older than those being kept.\n')"
  fi
}

guard_kernel_plan() {
  local plan_file="$1" package allowed candidate
  while read -r package; do
    [[ -n "$package" ]] || continue
    package="${package%%:*}"
    allowed=0
    for candidate in "${KERNEL_REMOVE_PACKAGES[@]}"; do
      [[ "$package" == "$candidate" ]] && allowed=1
    done
    if [[ "$allowed" == "0" ]]; then
      printf "$(pick 'APT intentaría retirar un paquete ajeno a los kernels antiguos: %s\n' \
        'APT would remove a package unrelated to old kernels: %s\n')" \
        "$package" >&2
      fail "Plan de kernels rechazado." "Kernel plan rejected."
    fi
  done < <(planned_removals "$plan_file")
}

simulate_kernel_plan() {
  local output_file="$1"
  apt-get -s purge "${KERNEL_REMOVE_PACKAGES[@]}" >"$output_file"
}

kernel_image_installed() {
  local release="$1" status
  status="$(dpkg-query -W -f='${db:Status-Abbrev}' "linux-image-$release" 2>/dev/null || true)"
  [[ "$status" == ii* ]] && return 0
  status="$(dpkg-query -W -f='${db:Status-Abbrev}' "linux-image-unsigned-$release" 2>/dev/null || true)"
  [[ "$status" == ii* ]]
}

verify_kept_kernels() {
  local release running
  running="$(uname -r)"
  [[ -d "/lib/modules/$running" ]] ||
    fail "Faltan los módulos del kernel en ejecución." "Running kernel modules are missing."
  [[ -f "/boot/vmlinuz-$running" && -f "/boot/initrd.img-$running" ]] ||
    fail "Faltan vmlinuz o initrd del kernel en ejecución." \
      "Running kernel vmlinuz or initrd is missing."
  kernel_image_installed "$running" ||
    fail "El paquete del kernel en ejecución ya no está instalado." \
      "The running kernel package is no longer installed."
  for release in "${KERNEL_KEEP_RELEASES[@]}"; do
    kernel_image_installed "$release" ||
      fail "Se retiró un kernel que debía conservarse: $release" \
        "A kernel that should have been kept was removed: $release"
  done
}

kernel_report_fields() {
  local include_removals="$1"
  KERNEL_RUNNING="$(uname -r)"
  KERNEL_KEPT_TEXT=""
  KERNEL_REMOVED_RELEASES_TEXT=""
  KERNEL_REMOVED_PACKAGES_TEXT=""
  if ((${#KERNEL_KEEP_RELEASES[@]})); then
    KERNEL_KEPT_TEXT="$(printf '%s\n' "${KERNEL_KEEP_RELEASES[@]}")"
  fi
  if [[ "$include_removals" == "1" ]]; then
    if ((${#KERNEL_REMOVE_RELEASES[@]})); then
      KERNEL_REMOVED_RELEASES_TEXT="$(printf '%s\n' "${KERNEL_REMOVE_RELEASES[@]}")"
    fi
    if ((${#KERNEL_REMOVE_PACKAGES[@]})); then
      KERNEL_REMOVED_PACKAGES_TEXT="$(printf '%s\n' "${KERNEL_REMOVE_PACKAGES[@]}")"
    fi
  fi
}

snap_is_installed() {
  command -v snap >/dev/null 2>&1 && snap list "$1" >/dev/null 2>&1
}

has_workload_snaps() {
  command -v snap >/dev/null 2>&1 || return 1
  local snap_name desktop_snap known
  while read -r snap_name; do
    [[ -n "$snap_name" ]] || continue
    known=0
    case "$snap_name" in
      bare|core[0-9]*|gnome-[0-9]*|gtk-common-themes|mesa-[0-9]*|snapd)
        known=1
        ;;
    esac
    for desktop_snap in "${DESKTOP_SNAPS[@]}"; do
      [[ "$snap_name" == "$desktop_snap" ]] && known=1
    done
    [[ "$known" == "1" ]] || return 0
  done < <(snap list 2>/dev/null | awk 'NR > 1 {print $1}')
  return 1
}

snap_base() {
  awk '/^base:/ {print $2; exit}' "/snap/$1/current/meta/snap.yaml" 2>/dev/null || true
}

unused_snap_dependencies() {
  command -v snap >/dev/null 2>&1 || return 0
  local name consumer provider base changed used
  local -A remaining=() consumers=()
  while read -r name; do
    [[ -n "$name" ]] && remaining[$name]=1
  done < <(snap list 2>/dev/null | awk 'NR > 1 {print $1}')
  for name in "${DESKTOP_SNAPS[@]}"; do
    unset "remaining[$name]"
  done

  while read -r consumer provider; do
    consumers[$provider]+=" $consumer"
  done < <(
    snap connections --all 2>/dev/null |
      awk 'NR > 1 && $1 ~ /^content/ && $3 != "-" {split($2, p, ":"); split($3, s, ":"); print p[1], s[1]}'
    for name in "${!remaining[@]}"; do
      base="$(snap_base "$name")"
      if [[ -n "$base" ]]; then
        printf '%s %s\n' "$name" "$base"
      fi
    done
  )

  # Se retira primero lo que usaba cada base, así que el orden de salida es seguro.
  changed=1
  while ((changed)); do
    changed=0
    for name in "${!remaining[@]}"; do
      case "$name" in
        bare|core[0-9]*|gnome-[0-9]*|gtk-common-themes|mesa-[0-9]*) ;;
        *) continue ;;
      esac
      used=0
      for consumer in ${consumers[$name]:-}; do
        if [[ "$consumer" != "$name" && -n "${remaining[$consumer]:-}" ]]; then
          used=1
        fi
      done
      if ((used == 0)); then
        printf '%s\n' "$name"
        unset "remaining[$name]"
        changed=1
      fi
    done
  done
}

remove_orphan_snap_cache() {
  [[ -d /var/lib/snapd/cache ]] || return 0
  find /var/lib/snapd/cache -maxdepth 1 -type f -links 1 -delete 2>/dev/null || true
}

collect_candidates() {
  local package
  APT_CANDIDATES=()
  while read -r package; do
    is_desktop_package "$package" && ! is_protected_package "$package" &&
      APT_CANDIDATES+=("$package")
  done < <(installed_packages)

  if ((${#APT_CANDIDATES[@]})); then
    mapfile -t APT_CANDIDATES < <(printf '%s\n' "${APT_CANDIDATES[@]}" | sort -u)
  fi
}

build_removal_arguments() {
  local package
  REMOVAL_ARGUMENTS=("${APT_CANDIDATES[@]}")
  while read -r package; do
    is_protected_package "$package" && REMOVAL_ARGUMENTS+=("${package}+")
  done < <(installed_packages)
  return 0
}

simulate_removal_plan() {
  build_removal_arguments
  apt-get -s --no-upgrade autoremove --purge "${REMOVAL_ARGUMENTS[@]}" >"$1"
}

guard_removal_only() {
  local plan_file="$1" changes
  changes="$(awk '/^(Inst|Conf) / {print "  " $2}' "$plan_file" | sort -u)"
  if [[ -n "$changes" ]]; then
    printf "$(pick 'APT intentaría instalar o actualizar paquetes:\n%s\n' \
      'APT would install or upgrade packages:\n%s\n')" "$changes" >&2
    fail "Plan rechazado: la conversión solo puede retirar paquetes." \
      "Plan rejected: conversion may only remove packages."
  fi
}

planned_removals() {
  awk '/^(Remv|Purg) / {print $2}' "$1" | sed 's/:.*//' | sort -u
}

guard_plan() {
  local plan_file="$1" package protected=()
  while read -r package; do
    [[ -n "$package" ]] || continue
    is_protected_package "$package" && protected+=("$package")
  done < <(planned_removals "$plan_file")
  if ((${#protected[@]})); then
    printf "$(pick 'APT intentaría retirar paquetes protegidos:\n' \
      'APT would remove protected packages:\n')" >&2
    printf '  %s\n' "${protected[@]}" >&2
    fail "Plan rechazado para preservar la funcionalidad actual." \
      "Plan rejected to preserve current functionality."
  fi
}

print_services() {
  local unit
  for unit in "${SERVICE_CANDIDATES[@]}"; do
    if systemctl cat "$unit" >/dev/null 2>&1; then
      printf "$(pick '  %-32s activo=%-8s habilitado=%s\n' \
        '  %-32s active=%-8s enabled=%s\n')" \
        "$unit" \
        "$(systemctl is-active "$unit" 2>/dev/null || true)" \
        "$(systemctl is-enabled "$unit" 2>/dev/null || true)"
    fi
  done
}

audit() {
  local plan_file="" kernel_plan_file="" snap_name found=0
  local -a snap_dependencies=()
  trap 'rm -f "${plan_file:-}" "${kernel_plan_file:-}"' EXIT
  collect_user_app_packages
  collect_candidates
  collect_kernel_cleanup
  printf "$(pick 'Sistema: %s %s · arquitectura %s\n' 'System: %s %s · architecture %s\n')" \
    "${PRETTY_NAME:-${ID:-$(pick "desconocido" "unknown")}}" "${VERSION_ID:-}" \
    "$(dpkg --print-architecture)"
  printf "$(pick 'Target de arranque: %s\n' 'Boot target: %s\n')" \
    "$(systemctl get-default 2>/dev/null || true)"
  printf "$(pick $'\\nServicios de escritorio detectados:\\n' \
    $'\\nDetected desktop services:\\n')"
  print_services

  printf "$(pick $'\\nPaquetes APT candidatos (%d):\\n' $'\\nAPT candidate packages (%d):\\n')" \
    "${#APT_CANDIDATES[@]}"
  if ((${#APT_CANDIDATES[@]})); then
    printf '  %s\n' "${APT_CANDIDATES[@]}"
  fi

  printf "$(pick $'\\nDependencias de MyDGX protegidas: %d (deploy.sh y servicios)\\n' \
    $'\\nProtected MyDGX dependencies: %d (deploy.sh and services)\\n')" \
    "${#MYDGX_PACKAGES[@]}"
  printf "$(pick 'Paquetes usados por aplicaciones fuera de APT y --keep: %d\n' \
    'Packages used by apps outside APT and --keep: %d\n')" \
    "${#USER_APP_PACKAGES[@]}"
  if ((${#USER_APP_PACKAGES[@]})); then
    printf '%s\n' "${!USER_APP_PACKAGES[@]}" | sort | sed 's/^/  /'
  fi
  if [[ "$EUID" -ne 0 ]]; then
    printf "$(pick '  AVISO: sin sudo no se leen los homes de otros usuarios ni /root.\n' \
      '  WARNING: without sudo, other users'\'' homes and /root are not scanned.\n')"
  fi

  printf "$(pick $'\\nSnaps de escritorio candidatos:\\n' $'\\nCandidate desktop snaps:\\n')"
  for snap_name in "${DESKTOP_SNAPS[@]}"; do
    if snap_is_installed "$snap_name"; then
      printf '  %s\n' "$snap_name"
      found=1
    fi
  done
  [[ "$found" == "1" ]] || printf "$(pick '  ninguno\n' '  none\n')"
  printf "$(pick 'Bases y temas snap que quedarían sin uso:\n' \
    'Snap bases and themes that would be unused:\n')"
  mapfile -t snap_dependencies < <(unused_snap_dependencies)
  if ((${#snap_dependencies[@]})); then
    printf '  %s\n' "${snap_dependencies[@]}"
  else
    printf "$(pick '  ninguno\n' '  none\n')"
  fi
  if has_workload_snaps; then
    printf "$(pick '  AVISO: se conservarán snapd y los snaps no relacionados con el escritorio.\n' \
      '  WARNING: snapd and non-desktop snaps will be kept.\n')"
  fi

  print_kernel_plan
  if ((${#KERNEL_REMOVE_PACKAGES[@]})); then
    kernel_plan_file="$(mktemp)"
    simulate_kernel_plan "$kernel_plan_file"
    guard_kernel_plan "$kernel_plan_file"
    printf "$(pick $'\\nSimulación de kernels validada: %s paquetes quedarían retirados.\\n' \
      $'\\nKernel simulation validated: %s packages would be removed.\\n')" \
      "$(planned_removals "$kernel_plan_file" | wc -l | tr -d ' ')"
  fi

  if ((${#APT_CANDIDATES[@]})); then
    plan_file="$(mktemp)"
    simulate_removal_plan "$plan_file"
    guard_plan "$plan_file"
    guard_removal_only "$plan_file"
    printf "$(pick $'\\nSimulación APT validada: %s paquetes quedarían retirados.\\n' \
      $'\\nAPT simulation validated: %s packages would be removed.\\n')" \
      "$(planned_removals "$plan_file" | wc -l | tr -d ' ')"
    grep -E '^(Remv|Purg) |After this operation|Se liberarán|The following packages' \
      "$plan_file" || true
  fi
  printf "$(pick $'\\nAUDITORÍA SOLAMENTE: no se ha modificado el sistema.\\n' \
    $'\\nAUDIT ONLY: the system was not modified.\\n')"
  printf "$(pick 'Para aplicar en otro momento: sudo ./start.sh serverize --apply --confirm CONVERT-TO-HEADLESS-SERVER\n' \
    'To apply later: sudo ./start.sh serverize --apply --confirm CONVERT-TO-HEADLESS-SERVER\n')"
}

save_state() {
  local state_dir="$1"
  install -d -m 0700 "$state_dir"
  dpkg-query -W -f='${binary:Package}\t${Version}\t${db:Status-Abbrev}\n' \
    >"$state_dir/dpkg-before.tsv"
  apt-mark showmanual | sort >"$state_dir/apt-manual-before.txt"
  systemctl get-default >"$state_dir/default-target-before.txt"
  systemctl list-unit-files --type=service --state=enabled --no-legend \
    >"$state_dir/enabled-services-before.txt"
  systemctl list-units --type=service --state=running --no-legend \
    >"$state_dir/running-services-before.txt"
  if command -v snap >/dev/null 2>&1; then
    snap list >"$state_dir/snaps-before.txt" 2>/dev/null || true
  fi
  printf '%s\n' "${APT_CANDIDATES[@]}" >"$state_dir/apt-candidates.txt"
  chmod -R go-rwx "$state_dir"
}

record_mydgx_packages() {
  local package
  MYDGX_INSTALLED_BEFORE=()
  while read -r package; do
    if [[ -n "${MYDGX_PACKAGES[${package%%:*}]:-}" || -n "${USER_APP_PACKAGES[${package%%:*}]:-}" ]]; then
      MYDGX_INSTALLED_BEFORE+=("$package")
    fi
  done < <(installed_packages)
  return 0
}

verify_mydgx_packages() {
  local package status
  for package in "${MYDGX_INSTALLED_BEFORE[@]}"; do
    status="$(dpkg-query -W -f='${db:Status-Abbrev}' "$package" 2>/dev/null || true)"
    [[ "$status" == ii* ]] ||
      fail "Se retiró una dependencia de MyDGX o de una aplicación instalada: $package" \
        "A MyDGX or installed-app dependency was removed: $package"
  done
}

mark_protected_manual() {
  local package protected=()
  while read -r package; do
    is_protected_package "$package" && protected+=("$package")
  done < <(installed_packages)
  ((${#protected[@]})) && apt-mark manual "${protected[@]}" >/dev/null
}

verify_preserved_services() {
  local unit before_file="$1"
  while read -r unit; do
    [[ -n "$unit" ]] || continue
    systemctl is-active --quiet "$unit" ||
      fail "El servicio que estaba activo dejó de funcionar: $unit" \
        "A service that was active stopped working: $unit"
  done <"$before_file"
  verify_mydgx_packages
  command -v nvidia-smi >/dev/null 2>&1 ||
    fail "nvidia-smi dejó de estar disponible." "nvidia-smi is no longer available."
  nvidia-smi >/dev/null ||
    fail "El driver NVIDIA no responde tras la limpieza." \
      "The NVIDIA driver does not respond after cleanup."
  [[ "$(systemctl get-default)" == "multi-user.target" ]] ||
    fail "El target de arranque no quedó en modo servidor." \
      "The boot target is not in server mode."
}

require_text_session() {
  local session type=""
  # sudo descarta XDG_SESSION_TYPE; el id de sesión de auditoría sí se hereda.
  session="$(cat /proc/self/sessionid 2>/dev/null || true)"
  if [[ "$session" =~ ^[0-9]+$ && "$session" != "4294967295" ]] &&
      command -v loginctl >/dev/null 2>&1; then
    type="$(loginctl show-session "$session" -p Type --value 2>/dev/null || true)"
  fi
  [[ "$type" == "tty" ]] ||
    fail "Ejecuta esta operación desde SSH o una consola TTY, no desde el escritorio (sesión: ${type:-desconocida})." \
      "Run this operation from SSH or a TTY console, not from the desktop (session: ${type:-unknown})."
}

record_preserved_services() {
  local output_file="$1" unit
  {
    printf '%s\n' "${PRESERVED_SERVICES[@]}"
    systemctl list-units --type=service --state=running --plain --no-legend \
      'mydgx*' 'open-webui*' 2>/dev/null | awk '{print $1}'
    systemctl list-units --type=timer --state=active --plain --no-legend \
      'mydgx*' 2>/dev/null | awk '{print $1}'
  } | sort -u | while read -r unit; do
    [[ -n "$unit" ]] || continue
    if systemctl is-active --quiet "$unit"; then
      printf '%s\n' "$unit"
    fi
  done >"$output_file"
}

disable_desktop_services() {
  local unit
  systemctl set-default multi-user.target
  systemctl enable getty@tty1.service >/dev/null 2>&1 || true
  for unit in "${SERVICE_CANDIDATES[@]}"; do
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
  done
  systemctl daemon-reload
  systemctl reset-failed >/dev/null 2>&1 || true
}

memory_available_bytes() {
  awk '/^MemAvailable:/ {printf "%.0f\n", $2 * 1024; exit}' /proc/meminfo
}

memory_total_bytes() {
  awk '/^MemTotal:/ {printf "%.0f\n", $2 * 1024; exit}' /proc/meminfo
}

disk_used_bytes() {
  df -B1 --output=used "$ROOT" | awk 'NR == 2 {print $1}'
}

installed_package_count() {
  installed_packages | wc -l | tr -d ' '
}

installed_snap_count() {
  if command -v snap >/dev/null 2>&1; then
    local snap_output
    if snap_output="$(snap list 2>/dev/null)"; then
      awk 'NR > 1 {count++} END {print count + 0}' <<<"$snap_output"
    else
      printf '0\n'
    fi
  else
    printf '0\n'
  fi
}

active_candidate_services() {
  local unit
  for unit in "${SERVICE_CANDIDATES[@]}"; do
    if systemctl is-active --quiet "$unit"; then
      printf '%s\n' "$unit"
    fi
  done | sort -u
}

capture_before_metrics() {
  BEFORE_MEMORY_AVAILABLE="$(memory_available_bytes)"
  BEFORE_MEMORY_TOTAL="$(memory_total_bytes)"
  BEFORE_DISK_USED="$(disk_used_bytes)"
  BEFORE_PACKAGE_COUNT="$(installed_package_count)"
  BEFORE_SNAP_COUNT="$(installed_snap_count)"
  BEFORE_TARGET="$(systemctl get-default 2>/dev/null || true)"
  BEFORE_ACTIVE_SERVICES="$(active_candidate_services)"
}

capture_after_metrics() {
  AFTER_MEMORY_AVAILABLE="$(memory_available_bytes)"
  AFTER_MEMORY_TOTAL="$(memory_total_bytes)"
  AFTER_DISK_USED="$(disk_used_bytes)"
  AFTER_PACKAGE_COUNT="$(installed_package_count)"
  AFTER_SNAP_COUNT="$(installed_snap_count)"
  AFTER_TARGET="$(systemctl get-default 2>/dev/null || true)"
  AFTER_ACTIVE_SERVICES="$(active_candidate_services)"
}

write_change_report() {
  local operation="$1" timestamp="$2" state_dir="$3"
  local report_file temporary
  [[ ! -L "$REPORT_DIR" ]] ||
    fail "El directorio de informes no puede ser un enlace simbólico." \
      "The reports directory cannot be a symbolic link."
  install -d -m 0755 "$REPORT_DIR"
  report_file="$REPORT_DIR/serverize-$timestamp-$operation.json"
  temporary="$(mktemp "$REPORT_DIR/.serverize-report.XXXXXX")"
  python3 - \
    "$temporary" "$operation" "$timestamp" "$state_dir" "$ROOT" \
    "$BEFORE_DISK_USED" "$AFTER_DISK_USED" \
    "$BEFORE_MEMORY_AVAILABLE" "$AFTER_MEMORY_AVAILABLE" \
    "$BEFORE_MEMORY_TOTAL" "$AFTER_MEMORY_TOTAL" \
    "$BEFORE_PACKAGE_COUNT" "$AFTER_PACKAGE_COUNT" \
    "$BEFORE_SNAP_COUNT" "$AFTER_SNAP_COUNT" \
    "$BEFORE_TARGET" "$AFTER_TARGET" \
    "$BEFORE_ACTIVE_SERVICES" "$AFTER_ACTIVE_SERVICES" \
    "$KERNEL_RUNNING" "$KERNEL_KEPT_TEXT" \
    "$KERNEL_REMOVED_RELEASES_TEXT" "$KERNEL_REMOVED_PACKAGES_TEXT" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

(
    output,
    operation,
    timestamp,
    state_directory,
    filesystem_path,
    disk_before,
    disk_after,
    memory_before,
    memory_after,
    memory_total_before,
    memory_total_after,
    packages_before,
    packages_after,
    snaps_before,
    snaps_after,
    target_before,
    target_after,
    services_before,
    services_after,
    kernel_running,
    kernels_kept,
    kernels_removed,
    kernel_packages_removed,
) = sys.argv[1:]

before_services = sorted(filter(None, services_before.splitlines()))
after_services = sorted(filter(None, services_after.splitlines()))
kept_kernels = [item for item in kernels_kept.splitlines() if item]
removed_kernels = [item for item in kernels_removed.splitlines() if item]
removed_kernel_packages = [item for item in kernel_packages_removed.splitlines() if item]
disk_before_value = int(disk_before)
disk_after_value = int(disk_after)
memory_before_value = int(memory_before)
memory_after_value = int(memory_after)

report = {
    "schema_version": 2,
    "operation": operation,
    "result": "completed",
    "completed_at": datetime.now(timezone.utc).isoformat(),
    "operation_timestamp": timestamp,
    "state_directory": state_directory,
    "disk": {
        "filesystem_path": filesystem_path,
        "used_bytes_before": disk_before_value,
        "used_bytes_after": disk_after_value,
        "used_bytes_delta": disk_after_value - disk_before_value,
        "freed_bytes": max(disk_before_value - disk_after_value, 0),
    },
    "memory": {
        "available_bytes_before": memory_before_value,
        "available_bytes_after": memory_after_value,
        "available_bytes_delta": memory_after_value - memory_before_value,
        "total_bytes_before": int(memory_total_before),
        "total_bytes_after": int(memory_total_after),
    },
    "packages": {
        "installed_before": int(packages_before),
        "installed_after": int(packages_after),
        "installed_delta": int(packages_after) - int(packages_before),
    },
    "snaps": {
        "installed_before": int(snaps_before),
        "installed_after": int(snaps_after),
        "installed_delta": int(snaps_after) - int(snaps_before),
    },
    "systemd": {
        "default_target_before": target_before,
        "default_target_after": target_after,
        "selected_services_active_before": before_services,
        "selected_services_active_after": after_services,
        "selected_services_deactivated": sorted(
            set(before_services) - set(after_services)
        ),
    },
    "kernels": {
        "running": kernel_running,
        "kept": kept_kernels,
        "removed_releases": removed_kernels,
        "removed_packages": removed_kernel_packages,
    },
}

pathlib.Path(output).write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
PY
  chmod 0644 "$temporary"
  mv -f "$temporary" "$report_file"
  CHANGE_REPORT_FILE="$report_file"
}

format_bytes() {
  python3 - "$1" <<'PY'
import os
import sys

value = max(int(sys.argv[1]), 0)
units = ("B", "KiB", "MiB", "GiB", "TiB")
size = float(value)
unit = units[0]
for unit in units:
    if size < 1024 or unit == units[-1]:
        break
    size /= 1024
if unit == "B":
    print(f"{int(size)} {unit}")
else:
    formatted = f"{size:.2f} {unit}"
    if os.environ.get("MYDGX_LANGUAGE") == "es":
        formatted = formatted.replace(".", ",")
    print(formatted)
PY
}

print_change_summary() {
  local memory_released disk_released
  memory_released=$((AFTER_MEMORY_AVAILABLE - BEFORE_MEMORY_AVAILABLE))
  disk_released=$((BEFORE_DISK_USED - AFTER_DISK_USED))
  ((memory_released > 0)) || memory_released=0
  ((disk_released > 0)) || disk_released=0
  printf "$(pick 'Has liberado %s de memoria RAM y %s de espacio en disco.\n' \
    'You freed %s of RAM and %s of disk space.\n')" \
    "$(format_bytes "$memory_released")" \
    "$(format_bytes "$disk_released")"
}

disable_only() {
  [[ "$EUID" -eq 0 ]] ||
    fail "--disable requiere root; usa sudo." "--disable requires root; use sudo."
  [[ "$CONFIRMATION" == "DISABLE-DESKTOP-SERVICES" ]] ||
    fail "Falta la confirmación literal: --confirm DISABLE-DESKTOP-SERVICES" \
      "Missing literal confirmation: --confirm DISABLE-DESKTOP-SERVICES"
  require_text_session
  collect_candidates
  collect_kernel_cleanup
  capture_before_metrics

  local timestamp state_dir
  timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
  state_dir="$STATE_ROOT/$timestamp-disable"
  save_state "$state_dir"
  record_preserved_services "$state_dir/preserved-active-services.txt"
  record_mydgx_packages
  printf '%s\n' "disable-only" >"$state_dir/mode.txt"

  disable_desktop_services
  verify_preserved_services "$state_dir/preserved-active-services.txt"
  capture_after_metrics
  kernel_report_fields 0
  write_change_report "disable" "$timestamp" "$state_dir"
  printf "$(pick 'Escritorio y servicios seleccionados desactivados sin desinstalar paquetes.\n' \
    'Desktop and selected services disabled without uninstalling packages.\n')"
  print_change_summary
  printf "$(pick 'Estado previo guardado en %s\n' 'Prior state saved in %s\n')" "$state_dir"
  printf "$(pick 'Cambios de disco y memoria guardados en %s\n' \
    'Disk and memory changes saved in %s\n')" "$CHANGE_REPORT_FILE"
  printf "$(pick 'No es necesario reiniciar: la memoria de los servicios detenidos ya queda libre.\n' \
    'No reboot needed: memory from stopped services is already free.\n')"
}

apply_plan() {
  [[ "$EUID" -eq 0 ]] ||
    fail "--apply requiere root; usa sudo." "--apply requires root; use sudo."
  [[ "$CONFIRMATION" == "CONVERT-TO-HEADLESS-SERVER" ]] ||
    fail "Falta la confirmación literal: --confirm CONVERT-TO-HEADLESS-SERVER" \
      "Missing literal confirmation: --confirm CONVERT-TO-HEADLESS-SERVER"
  require_text_session
  [[ -z "$(dpkg --audit 2>/dev/null)" ]] ||
    fail "dpkg informa de paquetes incompletos." "dpkg reports broken packages."
  apt-get check >/dev/null ||
    fail "APT no está en un estado consistente." "APT is not in a consistent state."

  collect_user_app_packages
  collect_candidates
  collect_kernel_cleanup
  if ((${#APT_CANDIDATES[@]} == 0 && ${#KERNEL_REMOVE_PACKAGES[@]} == 0)); then
    fail "No hay paquetes de escritorio ni kernels antiguos que retirar." \
      "There are no desktop packages or old kernels to remove."
  fi
  capture_before_metrics

  local timestamp state_dir plan_file="" kernel_plan_file="" snap_name
  local -a snap_dependencies=()
  timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
  state_dir="$STATE_ROOT/$timestamp"
  trap 'rm -f "${plan_file:-}" "${kernel_plan_file:-}"' EXIT

  if ((${#APT_CANDIDATES[@]})); then
    plan_file="$(mktemp)"
    simulate_removal_plan "$plan_file"
    guard_plan "$plan_file"
    guard_removal_only "$plan_file"
  fi
  if ((${#KERNEL_REMOVE_PACKAGES[@]})); then
    kernel_plan_file="$(mktemp)"
    simulate_kernel_plan "$kernel_plan_file"
    guard_kernel_plan "$kernel_plan_file"
  fi
  save_state "$state_dir"
  if [[ -n "$plan_file" ]]; then
    cp "$plan_file" "$state_dir/apt-purge-plan.txt"
  fi
  if [[ -n "$kernel_plan_file" ]]; then
    cp "$kernel_plan_file" "$state_dir/kernel-purge-plan.txt"
    printf '%s\n' "${KERNEL_REMOVE_RELEASES[@]}" >"$state_dir/kernel-releases.txt"
    printf '%s\n' "${KERNEL_REMOVE_PACKAGES[@]}" >"$state_dir/kernel-packages.txt"
  fi

  record_preserved_services "$state_dir/preserved-active-services.txt"
  record_mydgx_packages

  mark_protected_manual
  systemctl set-default multi-user.target
  systemctl enable getty@tty1.service >/dev/null 2>&1 || true
  if command -v snap >/dev/null 2>&1; then
    mapfile -t snap_dependencies < <(unused_snap_dependencies)
    for snap_name in "${DESKTOP_SNAPS[@]}"; do
      if snap_is_installed "$snap_name"; then
        snap remove "$snap_name"
      fi
    done
    for snap_name in "${snap_dependencies[@]}"; do
      if snap_is_installed "$snap_name"; then
        snap remove "$snap_name" ||
          printf "$(pick 'AVISO: snapd no permitió retirar %s; se conserva.\n' \
            'WARNING: snapd could not remove %s; keeping it.\n')" "$snap_name" >&2
      fi
    done
    remove_orphan_snap_cache
  fi

  if ((${#APT_CANDIDATES[@]})); then
    DEBIAN_FRONTEND=noninteractive apt-get --no-upgrade autoremove --purge -y "${REMOVAL_ARGUMENTS[@]}"
  fi
  if ((${#KERNEL_REMOVE_PACKAGES[@]})); then
    DEBIAN_FRONTEND=noninteractive apt-get purge -y "${KERNEL_REMOVE_PACKAGES[@]}"
  fi
  apt-get clean

  disable_desktop_services

  verify_preserved_services "$state_dir/preserved-active-services.txt"
  verify_kept_kernels
  capture_after_metrics
  kernel_report_fields 1
  write_change_report "apply" "$timestamp" "$state_dir"
  printf "$(pick 'Conversión terminada. Estado previo guardado en %s\n' \
    'Conversion finished. Prior state saved in %s\n')" "$state_dir"
  print_change_summary
  if ((${#KERNEL_REMOVE_RELEASES[@]})); then
    local release release_list="" kept_list=""
    for release in "${KERNEL_REMOVE_RELEASES[@]}"; do
      release_list="${release_list:+$release_list, }$release"
    done
    for release in "${KERNEL_KEEP_RELEASES[@]}"; do
      kept_list="${kept_list:+$kept_list, }$release"
    done
    printf "$(pick 'Kernels retirados: %s\n' 'Kernels removed: %s\n')" "$release_list"
    printf "$(pick 'Se conservan: %s\n' 'Kept: %s\n')" "$kept_list"
  else
    printf "$(pick 'No se retiró ningún kernel.\n' 'No kernel was removed.\n')"
  fi
  printf "$(pick 'Cambios de disco y memoria guardados en %s\n' \
    'Disk and memory changes saved in %s\n')" "$CHANGE_REPORT_FILE"
  printf "$(pick 'Reinicia cuando decidas verificar el arranque HDMI en consola.\n' \
    'Reboot when you want to verify HDMI boot on the console.\n')"
}

load_mydgx_packages

case "$MODE" in
  --audit) audit ;;
  --disable) disable_only ;;
  --apply) apply_plan ;;
esac
