#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib/language.sh
if [[ -f "$(dirname "${BASH_SOURCE[0]}")/lib/language.sh" ]]; then
  source "$(dirname "${BASH_SOURCE[0]}")/lib/language.sh"
else
  pick() { if [[ "${MYDGX_LANGUAGE:-en}" == "es" ]]; then printf '%s' "$1"; else printf '%s' "${2:-$1}"; fi; }
  say() { pick "$@"; printf '\n'; }
fi

ROOT="${1:-}"
SERVICE_USER="${2:-}"
LLAMA_REF="${3:-b12669}"
ENABLE_SEARXNG="${4:-1}"
ENABLE_COMFYUI="${5:-1}"
ENABLE_DUCKDNS="${6:-0}"

fail() {
  printf 'ERROR: %s\n' "$(pick "$@")" >&2
  exit 1
}

[[ "$EUID" -eq 0 ]] || fail "La instalación de systemd requiere root." "systemd installation requires root."
[[ -n "$ROOT" && "$ROOT" == /* && "$ROOT" != *$'\n'* ]] || fail "Ruta de MyDGX inválida." "Invalid MyDGX path."
[[ "$SERVICE_USER" =~ ^[A-Za-z0-9._-]+$ ]] || fail "Usuario de servicio inválido." "Invalid service user."
[[ "$LLAMA_REF" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "Revisión llama.cpp inválida." "Invalid llama.cpp revision."
[[ "$ENABLE_SEARXNG" =~ ^[01]$ ]] || fail "Estado de SearXNG inválido." "Invalid SearXNG state."
[[ "$ENABLE_COMFYUI" =~ ^[01]$ ]] || fail "Estado de ComfyUI inválido." "Invalid ComfyUI state."
[[ "$ENABLE_DUCKDNS" =~ ^[01]$ ]] || fail "Estado de DuckDNS inválido." "Invalid DuckDNS state."
[[ -x "$ROOT/start.sh" && -x "$ROOT/scripts/system-repair.sh" ]] ||
  fail "La instalación de MyDGX está incompleta." "The MyDGX installation is incomplete."
id "$SERVICE_USER" >/dev/null 2>&1 || fail "El usuario de servicio no existe." "The service user does not exist."
[[ -d /run/systemd/system ]] || fail "Este equipo Linux no está ejecutando systemd." "This Linux system is not running systemd."
SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
[[ -n "$SERVICE_HOME" && "$SERVICE_HOME" == /* ]] || fail "No se pudo resolver el home del usuario." "Could not resolve the user home directory."
OPENWEBUI_ROOT="$SERVICE_HOME/.local/share/mydgx/open-webui"
SEARXNG_ROOT="$SERVICE_HOME/.local/share/mydgx/searxng"
SEARXNG_RUNNER="$ROOT/scripts/searxng-container.sh"
COMFYUI_ROOT="$SERVICE_HOME/.local/share/mydgx/comfyui"
NVME_SMART_READER="$ROOT/scripts/nvme-smart-reader.sh"
DUCKDNS_UPDATER="$ROOT/scripts/duckdns-update.sh"
[[ -f "$NVME_SMART_READER" && ! -L "$NVME_SMART_READER" ]] ||
  fail "No se encontró el lector SMART seguro." "The safe SMART reader was not found."
if [[ "$ENABLE_DUCKDNS" == "1" ]]; then
  [[ -f "$DUCKDNS_UPDATER" && ! -L "$DUCKDNS_UPDATER" ]] ||
    fail "No se encontró el actualizador DuckDNS seguro." "The safe DuckDNS updater was not found."
fi
comfyui_unit_existed=0
comfyui_unit_was_enabled=0
if [[ -f /etc/systemd/system/mydgx-comfyui.service ]]; then
  comfyui_unit_existed=1
  systemctl is-enabled mydgx-comfyui.service >/dev/null 2>&1 &&
    comfyui_unit_was_enabled=1
fi
searxng_unit_existed=0
searxng_unit_was_enabled=0
if [[ -f /etc/systemd/system/mydgx-searxng.service ]]; then
  searxng_unit_existed=1
  systemctl is-enabled mydgx-searxng.service >/dev/null 2>&1 &&
    searxng_unit_was_enabled=1
fi

install -d -m 0755 /etc/mydgx
SYSTEMD_STATE=/etc/mydgx/systemd-install.sha256
systemd_fingerprint="$(
  {
    for fingerprint_file in \
      "$ROOT/scripts/install-systemd.sh" \
      "$ROOT/scripts/system-repair.sh" \
      "$NVME_SMART_READER" \
      "$DUCKDNS_UPDATER"; do
      sha256sum "$fingerprint_file" | awk '{print $1}'
    done
    printf 'root=%s\nuser=%s\nllama=%s\nsearxng=%s\ncomfyui=%s\nduckdns=%s\n' \
      "$ROOT" "$SERVICE_USER" "$LLAMA_REF" "$ENABLE_SEARXNG" "$ENABLE_COMFYUI" "$ENABLE_DUCKDNS"
  } | sha256sum | awk '{print $1}'
)"
installed_fingerprint=""
[[ -r "$SYSTEMD_STATE" ]] && installed_fingerprint="$(cat "$SYSTEMD_STATE")"
core_units_present=1
for unit in \
  /etc/systemd/system/mydgx.service \
  /etc/systemd/system/mydgx-gateway.service \
  /etc/systemd/system/mydgx-repair.service \
  /etc/systemd/system/mydgx-nvme-smart.service \
  /etc/systemd/system/mydgx-nvme-smart.timer; do
  [[ -f "$unit" ]] || core_units_present=0
done
if [[ "$ENABLE_DUCKDNS" == "1" ]]; then
  [[ -f /etc/systemd/system/mydgx-duckdns.service &&
     -f /etc/systemd/system/mydgx-duckdns.timer ]] || core_units_present=0
fi
if [[ "$ENABLE_SEARXNG" == "1" &&
      -x "$SEARXNG_RUNNER" &&
      -f "$SEARXNG_ROOT/enabled" &&
      ! -f /etc/systemd/system/mydgx-searxng.service ]]; then
  core_units_present=0
fi
if [[ "$ENABLE_COMFYUI" == "1" &&
      -x "$COMFYUI_ROOT/venv/bin/python" &&
      -f "$COMFYUI_ROOT/enabled" &&
      ! -f /etc/systemd/system/mydgx-comfyui.service ]]; then
  core_units_present=0
fi
if [[ -x "$OPENWEBUI_ROOT/venv/bin/open-webui" &&
      ! -f /etc/systemd/system/open-webui.service ]]; then
  core_units_present=0
fi
if [[ "$systemd_fingerprint" == "$installed_fingerprint" &&
      "$core_units_present" == "1" ]] &&
   systemctl is-enabled mydgx.service mydgx-gateway.service mydgx-nvme-smart.timer \
     >/dev/null 2>&1 &&
   { [[ "$ENABLE_DUCKDNS" == "0" ]] ||
     systemctl is-enabled mydgx-duckdns.timer >/dev/null 2>&1; }; then
  say "Servicios systemd sin cambios; se omite su reinstalación." "systemd services unchanged; skipping reinstall."
  exit 0
fi

printf 'MYDGX_LLAMA_CPP_REF=%s\n' "$LLAMA_REF" >/etc/mydgx/repair.env
chmod 0644 /etc/mydgx/repair.env
install -d -m 0755 /usr/local/libexec
install -o root -g root -m 0755 "$ROOT/scripts/system-repair.sh" /usr/local/libexec/mydgx-system-repair
install -o root -g root -m 0755 "$NVME_SMART_READER" /usr/local/libexec/mydgx-nvme-smart
install -o root -g root -m 0755 "$DUCKDNS_UPDATER" /usr/local/libexec/mydgx-duckdns-update

apt_get="$(command -v apt-get || true)"
systemctl_bin="$(command -v systemctl || true)"
env_bin="$(command -v env || true)"
[[ -n "$apt_get" && -n "$systemctl_bin" && -n "$env_bin" ]] || fail "APT, env o systemctl no están disponibles." "APT, env, or systemctl is not available."
fwupdmgr_bin="$(command -v fwupdmgr || true)"
firmware_alias=""
firmware_grant=""
if [[ -n "$fwupdmgr_bin" ]]; then
  firmware_alias="Cmnd_Alias MYDGX_FIRMWARE = $fwupdmgr_bin update -y --no-reboot-check"
  firmware_grant=", MYDGX_FIRMWARE"
fi
cat >/etc/sudoers.d/mydgx <<EOF
Cmnd_Alias MYDGX_APT = $apt_get check, $apt_get update, $env_bin DEBIAN_FRONTEND=noninteractive $apt_get upgrade --with-new-pkgs -y
Cmnd_Alias MYDGX_REPAIR = /usr/local/libexec/mydgx-system-repair --repair, /usr/local/libexec/mydgx-system-repair --drop-caches
Cmnd_Alias MYDGX_SERVICES = $systemctl_bin start mydgx, $systemctl_bin stop mydgx, $systemctl_bin restart mydgx, $systemctl_bin start mydgx-gateway, $systemctl_bin stop mydgx-gateway, $systemctl_bin restart mydgx-gateway, $systemctl_bin start mydgx-repair, $systemctl_bin stop mydgx-repair, $systemctl_bin restart mydgx-repair, $systemctl_bin start mydgx-searxng, $systemctl_bin stop mydgx-searxng, $systemctl_bin restart mydgx-searxng, $systemctl_bin enable --now mydgx-searxng, $systemctl_bin disable --now mydgx-searxng, $systemctl_bin start mydgx-comfyui, $systemctl_bin stop mydgx-comfyui, $systemctl_bin restart mydgx-comfyui, $systemctl_bin enable --now mydgx-comfyui, $systemctl_bin disable --now mydgx-comfyui, $systemctl_bin start mydgx-whisper, $systemctl_bin stop mydgx-whisper, $systemctl_bin restart mydgx-whisper, $systemctl_bin enable --now mydgx-whisper, $systemctl_bin disable --now mydgx-whisper, $systemctl_bin start mydgx-tts, $systemctl_bin stop mydgx-tts, $systemctl_bin start open-webui, $systemctl_bin stop open-webui, $systemctl_bin restart open-webui, $systemctl_bin start ollama, $systemctl_bin stop ollama, $systemctl_bin restart ollama, $systemctl_bin start docker, $systemctl_bin stop docker, $systemctl_bin restart docker
Cmnd_Alias MYDGX_POWER = /usr/sbin/shutdown -h now
$firmware_alias
$SERVICE_USER ALL=(root) NOPASSWD: MYDGX_APT, MYDGX_REPAIR, MYDGX_SERVICES, MYDGX_POWER$firmware_grant
EOF
chmod 0440 /etc/sudoers.d/mydgx
visudo -cf /etc/sudoers.d/mydgx >/dev/null || {
  rm -f /etc/sudoers.d/mydgx
  fail "La regla sudoers generada no es válida." "The generated sudoers rule is not valid."
}

cat >/etc/systemd/system/mydgx-repair.service <<EOF
[Unit]
Description=MyDGX integrity and runtime repair
Wants=network-online.target
After=local-fs.target network-online.target
Before=mydgx.service

[Service]
Type=oneshot
EnvironmentFile=/etc/mydgx/repair.env
ExecStart=/usr/local/libexec/mydgx-system-repair --boot
RemainAfterExit=yes
TimeoutStartSec=0
EOF

cat >/etc/systemd/system/mydgx-nvme-smart.service <<EOF
[Unit]
Description=MyDGX read-only NVMe SMART collector

[Service]
Type=oneshot
ExecStart=/usr/local/libexec/mydgx-nvme-smart
RuntimeDirectory=mydgx
RuntimeDirectoryMode=0755
RuntimeDirectoryPreserve=yes
StandardError=journal
UMask=0022
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
EOF

cat >/etc/systemd/system/mydgx-nvme-smart.timer <<EOF
[Unit]
Description=Refresh MyDGX NVMe SMART telemetry

[Timer]
OnBootSec=5s
OnUnitActiveSec=60s
AccuracySec=5s
Unit=mydgx-nvme-smart.service

[Install]
WantedBy=timers.target
EOF

cat >/etc/systemd/system/mydgx.service <<EOF
[Unit]
Description=MyDGX dashboard and profile manager
Wants=network-online.target ollama.service docker.service mydgx-nvme-smart.service mydgx-repair.service
After=network-online.target ollama.service docker.service mydgx-repair.service mydgx-nvme-smart.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$ROOT
ExecStart=$ROOT/start.sh serve
ExecStartPost=$ROOT/start.sh wait-ready
Restart=on-failure
RestartSec=5
TimeoutStartSec=600
TimeoutStopSec=90
KillMode=mixed
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$ROOT/data $ROOT/logs

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/mydgx-gateway.service <<EOF
[Unit]
Description=MyDGX OpenAI-compatible gateway
After=mydgx.service
Requires=mydgx.service
PartOf=mydgx.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$ROOT
ExecStart=$ROOT/start.sh serve-gateway
Restart=on-failure
RestartSec=5
TimeoutStartSec=60
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$ROOT/data $ROOT/logs

[Install]
WantedBy=multi-user.target
EOF

if [[ "$ENABLE_SEARXNG" == "1" &&
      -x "$SEARXNG_RUNNER" &&
      -f "$SEARXNG_ROOT/enabled" &&
      -f "$SEARXNG_ROOT/settings.yml" &&
      -f "$SEARXNG_ROOT/image" ]]; then
  searxng_mode="container"
  [[ ! -f "$SEARXNG_ROOT/mode" ]] ||
    searxng_mode="$(tr -d '\r\n' <"$SEARXNG_ROOT/mode")"
  searxng_dependencies="After=docker.service network-online.target
Requires=docker.service"
  searxng_user="User=$SERVICE_USER
SupplementaryGroups=docker"
  if [[ "$searxng_mode" == "native" ]]; then
    searxng_dependencies="After=network-online.target"
    searxng_user="User=$SERVICE_USER"
  fi
  cat >/etc/systemd/system/mydgx-searxng.service <<EOF
[Unit]
Description=Private SearXNG search for Open WebUI
$searxng_dependencies
PartOf=mydgx.service

[Service]
Type=simple
$searxng_user
ExecStart=$SEARXNG_RUNNER run "$SEARXNG_ROOT"
ExecStop=-$SEARXNG_RUNNER stop "$SEARXNG_ROOT"
Restart=on-failure
RestartSec=5
TimeoutStartSec=180
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF
else
  systemctl disable --now mydgx-searxng.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/mydgx-searxng.service
fi

if [[ "$ENABLE_COMFYUI" == "1" &&
      -x "$COMFYUI_ROOT/venv/bin/python" &&
      -f "$COMFYUI_ROOT/enabled" &&
      -f "$COMFYUI_ROOT/comfyui.env" ]]; then
  cat >/etc/systemd/system/mydgx-comfyui.service <<EOF
[Unit]
Description=ComfyUI image and video engine for MyDGX
After=network-online.target mydgx.service
Requires=mydgx.service
PartOf=mydgx.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$ROOT
ExecStart=$ROOT/start.sh serve-comfyui
Restart=on-failure
RestartSec=5
TimeoutStartSec=600
TimeoutStopSec=90
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF
else
  systemctl disable --now mydgx-comfyui.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/mydgx-comfyui.service
fi

if [[ -x "$OPENWEBUI_ROOT/venv/bin/open-webui" && -f "$OPENWEBUI_ROOT/open-webui.env" ]]; then
  openwebui_search_dependencies=""
  if [[ -f /etc/systemd/system/mydgx-searxng.service ]]; then
    openwebui_search_dependencies=$'Wants=mydgx-searxng.service\nAfter=mydgx-searxng.service'
  fi
  openwebui_comfyui_dependencies=""
  if [[ -f /etc/systemd/system/mydgx-comfyui.service ]]; then
    openwebui_comfyui_dependencies=$'Wants=mydgx-comfyui.service\nAfter=mydgx-comfyui.service'
  fi
  cat >/etc/systemd/system/open-webui.service <<EOF
[Unit]
Description=Open WebUI for MyDGX
After=mydgx-gateway.service
Requires=mydgx-gateway.service
PartOf=mydgx.service
$openwebui_search_dependencies
$openwebui_comfyui_dependencies

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$OPENWEBUI_ROOT
EnvironmentFile=$OPENWEBUI_ROOT/open-webui.env
ExecStart=$OPENWEBUI_ROOT/venv/bin/open-webui serve --host 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=5
TimeoutStartSec=300
TimeoutStopSec=60
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$OPENWEBUI_ROOT

[Install]
WantedBy=multi-user.target
EOF
fi

if [[ "$ENABLE_DUCKDNS" == "1" ]]; then
cat >/etc/systemd/system/mydgx-duckdns.service <<EOF
[Unit]
Description=Update MyDGX public address in DuckDNS
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$SERVICE_USER
EnvironmentFile=$ROOT/.env
ExecStart=/usr/local/libexec/mydgx-duckdns-update
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
EOF

cat >/etc/systemd/system/mydgx-duckdns.timer <<EOF
[Unit]
Description=Update MyDGX DuckDNS address hourly

[Timer]
OnBootSec=2min
OnUnitActiveSec=1h
Persistent=true
RandomizedDelaySec=2min
Unit=mydgx-duckdns.service

[Install]
WantedBy=timers.target
EOF
fi

systemctl daemon-reload
systemctl enable --now mydgx-nvme-smart.timer
systemctl start mydgx-nvme-smart.service
systemctl enable --now mydgx.service mydgx-gateway.service
if [[ "$ENABLE_DUCKDNS" == "1" ]]; then
  systemctl enable --now mydgx-duckdns.timer
  systemctl start mydgx-duckdns.service
fi
if [[ -f /etc/systemd/system/mydgx-searxng.service ]]; then
  if [[ "$searxng_unit_existed" == "0" || "$searxng_unit_was_enabled" == "1" ]]; then
    systemctl enable mydgx-searxng.service
  else
    systemctl disable mydgx-searxng.service
  fi
fi
if [[ -f /etc/systemd/system/mydgx-comfyui.service ]]; then
  if [[ "$comfyui_unit_existed" == "0" || "$comfyui_unit_was_enabled" == "1" ]]; then
    systemctl enable mydgx-comfyui.service
  else
    systemctl disable mydgx-comfyui.service
  fi
fi
if [[ -f /etc/systemd/system/open-webui.service ]]; then
  systemctl enable open-webui.service
fi
printf '%s\n' "$systemd_fingerprint" >"$SYSTEMD_STATE.new"
chmod 0644 "$SYSTEMD_STATE.new"
mv -f "$SYSTEMD_STATE.new" "$SYSTEMD_STATE"
say "Servicios systemd instalados para $SERVICE_USER en $ROOT." "systemd services installed for $SERVICE_USER at $ROOT."
