#!/bin/sh
# Build the Chrome Web Store upload: dist/stickstack-extension-<version>.zip
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')).version")
mkdir -p dist
OUT="dist/stickstack-extension-$VERSION.zip"
rm -f "$OUT"
(cd extension && zip -qr -X "../$OUT" . -x '*.DS_Store')
echo "Built $OUT"
