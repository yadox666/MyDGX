#!/bin/zsh
set -euo pipefail

# MYDGX_UNIVERSAL=1 builds arm64 + x86_64 and merges them with lipo.
# MYDGX_SIGN_IDENTITY selects a codesigning identity; ad hoc ("-") by default.
# MYDGX_BUNDLE_SOURCE=1 embeds the committed project (git archive HEAD) so the
# app can deploy without a separate checkout; untracked files such as .env never
# enter the bundle.

ROOT_DIR="${0:A:h:h}"
cd "$ROOT_DIR"

APP_DIR="$ROOT_DIR/dist/MyDGXTray.app"
SIGN_IDENTITY="${MYDGX_SIGN_IDENTITY:--}"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

if [[ "${MYDGX_UNIVERSAL:-0}" == "1" ]]; then
    binaries=()
    for arch in arm64 x86_64; do
        triple="$arch-apple-macosx13.0"
        swift build -c release --triple "$triple"
        binaries+=("$(swift build -c release --triple "$triple" --show-bin-path)/MyDGXTray")
    done
    lipo -create "${binaries[@]}" -output "$APP_DIR/Contents/MacOS/MyDGXTray"
else
    swift build -c release
    cp "$(swift build -c release --show-bin-path)/MyDGXTray" "$APP_DIR/Contents/MacOS/MyDGXTray"
fi

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

if [[ "${MYDGX_BUNDLE_SOURCE:-0}" == "1" ]]; then
    REPO_DIR="$(git -C "$ROOT_DIR" rev-parse --show-toplevel)"
    SOURCE_DIR="$APP_DIR/Contents/Resources/MyDGX-Dashboard"
    mkdir -p "$SOURCE_DIR"
    if [[ "${MYDGX_BUNDLE_WORKTREE:-0}" == "1" ]]; then
        # Local testing only: uncommitted changes, still without ignored files (.env).
        (
            cd "$REPO_DIR"
            git ls-files -z --cached --others --exclude-standard |
                while IFS= read -r -d '' file; do
                    [[ -f "$file" ]] && printf '%s\0' "$file"
                done |
                tar --null -cf - -T - | tar -x -C "$SOURCE_DIR"
        )
        print "worktree-$(git -C "$REPO_DIR" rev-parse --short HEAD)-dirty" > "$SOURCE_DIR/.mydgx-source-commit"
    else
        git -C "$REPO_DIR" archive --format=tar HEAD | tar -x -C "$SOURCE_DIR"
        git -C "$REPO_DIR" rev-parse HEAD > "$SOURCE_DIR/.mydgx-source-commit"
    fi
fi

if [[ "$SIGN_IDENTITY" == "-" ]]; then
    codesign --force --deep --sign - "$APP_DIR"
else
    codesign --force --deep --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP_DIR"
fi

print "Aplicación creada en: $APP_DIR"
