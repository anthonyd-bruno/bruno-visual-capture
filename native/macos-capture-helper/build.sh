#!/usr/bin/env bash
# Build the ScreenCaptureKit helper as a minimal .app bundle (stable bundle id so the Screen
# Recording grant can stick) and optionally install it under Bruno Capture's Application Support.
# Usage: ./build.sh [--install] [--sign "<identity>"]   (default: ad-hoc signing; env BRU_CAPTURE_SIGN_IDENTITY)
set -euo pipefail
cd "$(dirname "$0")"
APP_NAME="Bruno Capture Helper"
BUNDLE_ID="com.usebruno.capture.helper"
OUT="build/$APP_NAME.app"
SIGN="${BRU_CAPTURE_SIGN_IDENTITY:--}"
INSTALL=0
while [ $# -gt 0 ]; do case "$1" in --install) INSTALL=1;; --sign) SIGN="$2"; shift;; esac; shift; done

mkdir -p "$OUT/Contents/MacOS"
swiftc -O -swift-version 5 \
  -framework ScreenCaptureKit -framework AVFoundation -framework CoreMedia -framework CoreGraphics -framework AppKit -framework ImageIO -framework UniformTypeIdentifiers \
  -o "$OUT/Contents/MacOS/bru-capture-helper" Sources/main.swift
cat > "$OUT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key><string>bru-capture-helper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign "$SIGN" --identifier "$BUNDLE_ID" --options runtime "$OUT" 2>/dev/null || codesign --force --sign "$SIGN" --identifier "$BUNDLE_ID" "$OUT"
echo "built $OUT (signed: $SIGN)"
if [ "$INSTALL" = 1 ]; then
  DEST="$HOME/Library/Application Support/Bruno Capture/bin"
  mkdir -p "$DEST"; rm -rf "$DEST/$APP_NAME.app"; cp -R "$OUT" "$DEST/"
  echo "installed to $DEST/$APP_NAME.app"
fi
