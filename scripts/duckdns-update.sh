#!/usr/bin/env bash
set -euo pipefail

domain="${DUCKDNS_DOMAIN:-}"
token="${DUCKDNS_TOKEN:-}"

[[ "$domain" =~ ^[A-Za-z0-9.-]+([,][A-Za-z0-9.-]+)*$ ]] || {
  echo "DUCKDNS_DOMAIN no es válido." >&2
  exit 2
}
[[ "$token" =~ ^[A-Za-z0-9-]{20,128}$ ]] || {
  echo "DUCKDNS_TOKEN no es válido." >&2
  exit 2
}

normalized_domains=()
IFS=',' read -r -a requested_domains <<<"$domain"
for requested_domain in "${requested_domains[@]}"; do
  requested_domain="${requested_domain,,}"
  requested_domain="${requested_domain%.duckdns.org}"
  [[ "$requested_domain" =~ ^[A-Za-z0-9-]+$ ]] || {
    echo "DUCKDNS_DOMAIN no es válido." >&2
    exit 2
  }
  normalized_domains+=("$requested_domain")
done
domain="$(IFS=,; echo "${normalized_domains[*]}")"

response="$(
  printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' \
    "$domain" "$token" |
    curl --silent --show-error --fail \
      --connect-timeout 15 --max-time 45 \
      --proto '=https' --tlsv1.2 \
      --config -
)"
[[ "$response" == "OK" ]] || {
  echo "DuckDNS rechazó la actualización." >&2
  exit 1
}
echo "DuckDNS actualizado correctamente."
