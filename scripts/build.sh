#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/gameslop"
DIST="$ROOT/dist"

VERSION=$(grep -m1 '"version"' "$SRC/manifest.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')
BASE="gameslop-${VERSION}"

echo "Building $BASE from $SRC"

mkdir -p "$DIST"
rm -f "$DIST/${BASE}.zip" "$DIST/${BASE}.xpi"

if command -v web-ext >/dev/null 2>&1; then
  web-ext build --source-dir "$SRC" --artifacts-dir "$DIST" --overwrite-dest >/dev/null
else
  ( cd "$SRC" && zip -r "$DIST/${BASE}.zip" . \
      -x "*.DS_Store" "*.map" ".git*" "node_modules/*" >/dev/null )
fi

cp "$DIST/${BASE}.zip" "$DIST/${BASE}.xpi"

echo
echo "Output:"
ls -la "$DIST"
echo
echo "Install (Chrome / Edge / Brave):"
echo "  Option A - unpacked:"
echo "    1. Unzip ${BASE}.zip"
echo "    2. chrome://extensions -> Developer mode -> Load unpacked -> pick folder"
echo "  Option B - packed:"
echo "    1. chrome://extensions -> Developer mode"
echo "    2. Drag ${BASE}.zip onto the page"
echo
echo "Install (Firefox, temporary):"
echo "    1. about:debugging#/runtime/this-firefox"
echo "    2. Load Temporary Add-on -> pick ${BASE}.xpi"
echo "       (Temporary install survives until Firefox restart)"
