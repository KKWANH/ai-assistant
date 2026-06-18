#!/usr/bin/env bash
#
# Fetch the official Node runtime that the Tauri shell bundles as its sidecar
# (externalBin). Homebrew's `node` dynamically links Homebrew dylibs
# (@rpath/libnode, /opt/homebrew/opt/*) and is NOT portable; the official
# nodejs.org build is self-contained — it bundles ICU and links only system
# libraries — so it runs from inside the .app on any Mac.
#
# The binary is large (~110 MB) and intentionally gitignored; run this once
# before `tauri build` / `tauri dev`. Override NODE_MAJOR / TRIPLE / NODE_ARCH
# to fetch for other targets (cross-platform is a later phase).
set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-22}"           # node:sqlite is stable on 22 LTS
TRIPLE="${TRIPLE:-aarch64-apple-darwin}" # Tauri sidecar target-triple suffix
NODE_ARCH="${NODE_ARCH:-darwin-arm64}"   # nodejs.org tarball arch slug

DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries"
DEST="$DEST_DIR/node-$TRIPLE"
BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

echo "→ resolving latest v${NODE_MAJOR} (${NODE_ARCH})…"
curl -fsSL "$BASE/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
file="$(grep "${NODE_ARCH}\.tar\.gz\$" "$tmp/SHASUMS256.txt" | awk '{print $2}' | head -1)"
[ -n "$file" ] || { echo "✗ no ${NODE_ARCH} tarball in $BASE/SHASUMS256.txt"; exit 1; }

echo "→ downloading $file"
curl -fsSL "$BASE/$file" -o "$tmp/$file"

echo "→ verifying checksum"
( cd "$tmp" && grep " $file\$" SHASUMS256.txt | shasum -a 256 -c - )

echo "→ extracting bin/node → $DEST"
mkdir -p "$DEST_DIR"
tar -xzf "$tmp/$file" -C "$tmp"
cp "$tmp/${file%.tar.gz}/bin/node" "$DEST"
chmod +x "$DEST"

echo "✓ $(basename "$DEST")  ($("$DEST" --version))"
