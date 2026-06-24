#!/usr/bin/env bash
#
# Fetch the official Node runtime that the Tauri shell bundles as its sidecar
# (externalBin). The official nodejs.org build is self-contained (bundles ICU,
# links only system libraries), so it runs from inside the app on a clean
# machine — unlike a Homebrew/apt node that links package-manager libs.
#
# Cross-platform: pass TARGET to fetch for another OS/arch, else the host is
# auto-detected. The binary lands at src-tauri/binaries/node-<triple>[.exe],
# exactly where Tauri's externalBin ("binaries/node") looks per target.
#
#   TARGET=win-x64    ./fetch-node-sidecar.sh   # on a Windows build host (git-bash)
#   TARGET=linux-x64  ./fetch-node-sidecar.sh   # on a Linux build host
#   ./fetch-node-sidecar.sh                     # auto-detect the host
#
# The binary is large (~110 MB) and intentionally gitignored; run once per
# target before `tauri build` / `tauri dev`.
set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-22}" # node:sqlite is stable on 22 LTS

# Auto-detect the host target when TARGET isn't given.
TARGET="${TARGET:-}"
if [ -z "$TARGET" ]; then
  os="$(uname -s)"; arch="$(uname -m)"
  case "$os" in
    Darwin) [ "$arch" = "arm64" ] && TARGET="darwin-arm64" || TARGET="darwin-x64" ;;
    Linux)  [ "$arch" = "aarch64" ] && TARGET="linux-arm64" || TARGET="linux-x64" ;;
    MINGW*|MSYS*|CYGWIN*) TARGET="win-x64" ;;
    *) echo "✗ unknown host OS '$os'; set TARGET= explicitly"; exit 1 ;;
  esac
fi

# Map TARGET → Tauri triple · nodejs.org arch slug · archive ext · binary path
# inside the archive · output filename suffix.
case "$TARGET" in
  darwin-arm64) TRIPLE="aarch64-apple-darwin";       SLUG="darwin-arm64"; EXT="tar.gz"; BINREL="bin/node";  OUTEXT="" ;;
  darwin-x64)   TRIPLE="x86_64-apple-darwin";        SLUG="darwin-x64";   EXT="tar.gz"; BINREL="bin/node";  OUTEXT="" ;;
  linux-x64)    TRIPLE="x86_64-unknown-linux-gnu";   SLUG="linux-x64";    EXT="tar.xz"; BINREL="bin/node";  OUTEXT="" ;;
  linux-arm64)  TRIPLE="aarch64-unknown-linux-gnu";  SLUG="linux-arm64";  EXT="tar.xz"; BINREL="bin/node";  OUTEXT="" ;;
  win-x64)      TRIPLE="x86_64-pc-windows-msvc";     SLUG="win-x64";      EXT="zip";    BINREL="node.exe"; OUTEXT=".exe" ;;
  *) echo "✗ unknown TARGET '$TARGET' (darwin-arm64|darwin-x64|linux-x64|linux-arm64|win-x64)"; exit 1 ;;
esac

DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries"
DEST="$DEST_DIR/node-${TRIPLE}${OUTEXT}"
BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 -c -
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum -c -
  else echo "✗ need shasum or sha256sum"; exit 1; fi
}

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

echo "→ target=$TARGET  resolving latest v${NODE_MAJOR} (${SLUG})…"
curl -fsSL "$BASE/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
# Match the exact arch slug + ext (escape the dot in the ext for grep).
file="$(grep "${SLUG}\.${EXT//./\\.}\$" "$tmp/SHASUMS256.txt" | awk '{print $2}' | head -1)"
[ -n "$file" ] || { echo "✗ no ${SLUG}.${EXT} in $BASE/SHASUMS256.txt"; exit 1; }

echo "→ downloading $file"
curl -fsSL "$BASE/$file" -o "$tmp/$file"

echo "→ verifying checksum"
( cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256 )

echo "→ extracting $BINREL → $(basename "$DEST")"
mkdir -p "$DEST_DIR"
inner="${file%.$EXT}" # the top-level dir inside the archive (node-vX.Y.Z-<slug>)
case "$EXT" in
  tar.gz) tar -xzf "$tmp/$file" -C "$tmp" ;;
  tar.xz) tar -xJf "$tmp/$file" -C "$tmp" ;;
  zip)    # bsdtar (macOS + Windows tar) extracts zip; fall back to unzip
          tar -xf "$tmp/$file" -C "$tmp" 2>/dev/null || ( cd "$tmp" && unzip -q "$file" ) ;;
esac
cp "$tmp/$inner/$BINREL" "$DEST"
chmod +x "$DEST" 2>/dev/null || true

echo "✓ $(basename "$DEST")"
