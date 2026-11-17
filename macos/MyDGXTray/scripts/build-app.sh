#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
cd "$ROOT_DIR"

swift build -c release
BIN_DIR="$(swift build -c release --show-bin-path)"
APP_DIR="$ROOT_DIR/dist/MyDGXTray.app"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$BIN_DIR/MyDGXTray" "$APP_DIR/Contents/MacOS/MyDGXTray"
cp "$ROOT_DIR/Resources/Info.plist" "$APP_DIR/Contents/Info.plist"
cp "$ROOT_DIR/Resources/NVIDIAIcon.png" "$APP_DIR/Contents/Resources/NVIDIAIcon.png"
cp "$ROOT_DIR/../../frontend/public/brand/dgx-spark.png" \
    "$APP_DIR/Contents/Resources/NVIDIADGXSpark.png"
cp "$ROOT_DIR/../../frontend/public/brand/asus-ascent-gx10.png" \
    "$APP_DIR/Contents/Resources/ASUSAscentGX10.png"
cp "$ROOT_DIR/../../frontend/public/brand/hp-zgx-nano.png" \
    "$APP_DIR/Contents/Resources/HPZGXNano.png"
cp "$ROOT_DIR/../../frontend/public/brand/lenovo-thinkstation-pgx.png" \
    "$APP_DIR/Contents/Resources/LenovoThinkStationPGX.png"
codesign --force --deep --sign - "$APP_DIR"

print "Aplicación creada en: $APP_DIR"
