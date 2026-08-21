#!/usr/bin/env bash
#
# Build the archive to upload to the Chrome Web Store.
# Ships only what the extension loads: no tests, tooling or docs.

set -euo pipefail

cd "$(dirname "$0")/.."

version=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
out="dist/hangar-${version}.zip"

mkdir -p dist
rm -f "$out"

zip -r -q "$out" manifest.json icons src -x '*.DS_Store'

printf '%s (%s)\n' "$out" "$(du -h "$out" | cut -f1)"
