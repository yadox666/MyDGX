#!/usr/bin/env bash
set -euo pipefail

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

[[ $# -eq 0 ]] || {
  echo "Este lector no acepta argumentos." >&2
  exit 2
}

nvme_bin="$(command -v nvme || true)"
[[ -n "$nvme_bin" ]] || {
  echo "nvme-cli no está instalado." >&2
  exit 1
}

runtime_directory=/run/mydgx
install -d -o root -g root -m 0755 "$runtime_directory"
temporary="$(mktemp "$runtime_directory/.nvme-smart.XXXXXX")"
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM

{
  printf '{"devices":['
  first=1
  shopt -s nullglob
  for device in /dev/nvme*; do
    [[ "$device" =~ ^/dev/nvme[0-9]+$ ]] || continue
    payload="$("$nvme_bin" smart-log -o json "$device" 2>/dev/null)" || continue
    [[ "$first" -eq 1 ]] || printf ','
    first=0
    printf '{"name":"%s","smart":%s}' "${device#/dev/}" "$payload"
  done
  printf ']}\n'
} >"$temporary"

chmod 0644 "$temporary"
mv -f -- "$temporary" "$runtime_directory/nvme-smart.json"
trap - EXIT HUP INT TERM
