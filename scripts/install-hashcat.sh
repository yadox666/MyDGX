#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="${MYDGX_HASHCAT_VERSION:-7.1.2}"
INSTALL_ROOT="${MYDGX_HASHCAT_ROOT:-$HOME/.local/share/mydgx/hashcat}"
BIN_DIR="${MYDGX_LOCAL_BIN:-$HOME/.local/bin}"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "MYDGX_HASHCAT_VERSION no es válida." >&2
  exit 2
}
case "$VERSION" in
  7.1.2) default_sha256="80db0316387794ce9d14ed376da75b8a7742972485b45db790f5f8260307ff98" ;;
  *) default_sha256="" ;;
esac
ARCHIVE_SHA256="${MYDGX_HASHCAT_SHA256:-$default_sha256}"
[[ "$ARCHIVE_SHA256" =~ ^[0-9a-f]{64}$ ]] || {
  echo "Hashcat $VERSION necesita MYDGX_HASHCAT_SHA256 con el SHA-256 del .7z publicado." >&2
  exit 2
}
[[ "$INSTALL_ROOT" == "$HOME/"* && "$BIN_DIR" == "$HOME/"* ]] || {
  echo "Hashcat solo puede instalarse dentro del directorio del usuario." >&2
  exit 2
}

write_launcher() {
  local target
  printf -v target '%q' "$INSTALL_ROOT/hashcat"
  rm -f -- "$BIN_DIR/hashcat"
  printf '#!/usr/bin/env bash\nset -euo pipefail\nexec %s "$@"\n' "$target" >"$BIN_DIR/hashcat"
  chmod 0755 "$BIN_DIR/hashcat"
}

write_runtime_wrapper() {
  local root_dir="$1"
  cat >"$root_dir/hashcat" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$root"

# CUDA 13 puede publicar libnvrtc.so.13 sin el nombre genérico que busca Hashcat.
shopt -s nullglob
for libdir in \
  /usr/local/cuda/targets/sbsa-linux/lib \
  /usr/local/cuda/targets/aarch64-linux/lib \
  /usr/local/cuda/targets/x86_64-linux/lib \
  /usr/local/cuda/lib64; do
  [[ -d "$libdir" ]] || continue
  versions=("$libdir"/libnvrtc.so.[0-9]*)
  [[ -e "${versions[0]:-}" ]] || continue
  linkdir="$root/cuda-libs"
  mkdir -p "$linkdir"
  ln -sfn "${versions[0]}" "$linkdir/libnvrtc.so"
  ln -sfn "${versions[0]}" "$linkdir/libnvrtc.so.1"
  export LD_LIBRARY_PATH="$linkdir:$libdir${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  break
done

exec "$root/hashcat.bin" "$@"
EOF
  chmod 0755 "$root_dir/hashcat" "$root_dir/hashcat.bin"
}

if [[ -x "$INSTALL_ROOT/hashcat.bin" &&
      -f "$INSTALL_ROOT/VERSION" &&
      "$(cat "$INSTALL_ROOT/VERSION")" == "$VERSION" ]]; then
  mkdir -p "$BIN_DIR"
  write_runtime_wrapper "$INSTALL_ROOT"
  write_launcher
  "$BIN_DIR/hashcat" --version >/dev/null
  printf 'Hashcat %s ya está instalado en %s.\n' "$VERSION" "$INSTALL_ROOT"
  exit 0
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/mydgx-hashcat.XXXXXX")"
candidate="${INSTALL_ROOT}.new"
trap 'rm -rf -- "$work" "$candidate"' EXIT
rm -rf -- "$candidate"
mkdir -p "$candidate" "$BIN_DIR"

archive="$work/hashcat.7z"
curl --fail --location --retry 5 \
  "https://github.com/hashcat/hashcat/releases/download/v${VERSION}/hashcat-${VERSION}.7z" \
  --output "$archive"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$archive" | sha256sum --check --status || {
  echo "El archivo de Hashcat $VERSION no coincide con el SHA-256 fijado." >&2
  exit 1
}
7z x -y "-o$work/release" "$archive" >/dev/null
release_root="$work/release/hashcat-$VERSION"

if [[ -x "$release_root/hashcat.bin" ]] &&
   "$release_root/hashcat.bin" --version >/dev/null 2>&1; then
  cp -a "$release_root/." "$candidate/"
else
  echo "El binario publicado no funciona en $(uname -m); compilando Hashcat $VERSION."
  source_root="$work/source"
  git clone \
    --depth 1 \
    --branch "v$VERSION" \
    --recurse-submodules \
    --shallow-submodules \
    https://github.com/hashcat/hashcat.git \
    "$source_root"
  jobs="$(nproc)"
  ((jobs <= 8)) || jobs=8
  make -C "$source_root" -j"$jobs"
  rm -rf -- "$source_root/.git"
  cp -a "$source_root/." "$candidate/"
  cp -f "$source_root/hashcat" "$candidate/hashcat.bin"
fi

printf '%s\n' "$VERSION" >"$candidate/VERSION"
write_runtime_wrapper "$candidate"
"$candidate/hashcat" --version

rm -rf -- "$INSTALL_ROOT"
mv "$candidate" "$INSTALL_ROOT"
write_launcher
trap - EXIT
rm -rf -- "$work"

printf 'Hashcat %s instalado en %s.\n' "$VERSION" "$INSTALL_ROOT"
printf 'Añade %s a PATH si todavía no está incluido.\n' "$BIN_DIR"
