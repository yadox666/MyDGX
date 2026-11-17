#!/bin/zsh
set -euo pipefail

# Builds a universal MyDGXTray.app and zips it for a GitHub Release.
# Optional: MYDGX_SIGN_IDENTITY="Developer ID Application: …" signs it, and
# MYDGX_NOTARY_PROFILE names a profile created with
# `xcrun notarytool store-credentials`, so no Apple credentials live here.

ROOT_DIR="${0:A:h:h}"
cd "$ROOT_DIR"

MYDGX_UNIVERSAL=1 "$ROOT_DIR/scripts/build-app.sh"

APP_DIR="$ROOT_DIR/dist/MyDGXTray.app"
VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP_DIR/Contents/Info.plist")"
ZIP="$ROOT_DIR/dist/MyDGXTray-$VERSION-macos-universal.zip"

rm -f "$ZIP"
ditto -c -k --keepParent "$APP_DIR" "$ZIP"

if [[ -n "${MYDGX_NOTARY_PROFILE:-}" ]]; then
    if [[ "${MYDGX_SIGN_IDENTITY:--}" == "-" ]]; then
        print -u2 "La notarización necesita MYDGX_SIGN_IDENTITY con un certificado Developer ID"
        exit 1
    fi
    xcrun notarytool submit "$ZIP" --keychain-profile "$MYDGX_NOTARY_PROFILE" --wait
    xcrun stapler staple "$APP_DIR"
    rm -f "$ZIP"
    ditto -c -k --keepParent "$APP_DIR" "$ZIP"
fi

(cd "${ZIP:h}" && shasum -a 256 "${ZIP:t}" | tee "${ZIP:t}.sha256")
print "Paquete creado en: $ZIP"
