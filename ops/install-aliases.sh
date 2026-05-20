#!/usr/bin/env bash
# Install Ariadne shell aliases into ~/.zshrc (idempotent).
# Re-running this script replaces the managed block in place.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARIADNE_SH="${SCRIPT_DIR}/ariadne.sh"
ZSHRC="${HOME}/.zshrc"

MARKER_START="# >>> ariadne >>>"
MARKER_END="# <<< ariadne <<<"

# Build the managed block
read -r -d '' BLOCK << ENDOFBLOCK || true
${MARKER_START}
# Ariadne aliases — managed by ops/install-aliases.sh (do not edit manually)
alias ariadne="${ARIADNE_SH}"
alias ariadne-admin="${ARIADNE_SH} admin"
alias ariadne-logs="${ARIADNE_SH} logs"
${MARKER_END}
ENDOFBLOCK

# ── Ensure ~/.zshrc exists ─────────────────────────────────────────────────
if [[ ! -f "$ZSHRC" ]]; then
  touch "$ZSHRC"
  echo "Created ${ZSHRC}"
fi

# ── Check if markers are already present ──────────────────────────────────
if grep -qF "${MARKER_START}" "$ZSHRC" 2>/dev/null; then
  # Replace the existing managed block using awk (no temp-file race)
  awk -v new_block="${BLOCK}" '
    BEGIN { in_block=0; printed=0 }
    $0 ~ /^# >>> ariadne >>>/ {
      if (!printed) { print new_block; printed=1 }
      in_block=1; next
    }
    $0 ~ /^# <<< ariadne <<</ { in_block=0; next }
    !in_block { print }
  ' "$ZSHRC" > "${ZSHRC}.ariadne_tmp" && mv "${ZSHRC}.ariadne_tmp" "$ZSHRC"
  echo "Updated Ariadne aliases in ${ZSHRC}"
else
  # Append the block with a blank line separator
  printf '\n%s\n' "${BLOCK}" >> "$ZSHRC"
  echo "Appended Ariadne aliases to ${ZSHRC}"
fi

echo ""
echo "To activate now, run:"
echo "  source ${ZSHRC}"
echo ""
echo "Available aliases:"
echo "  ariadne          — start | stop | restart | status | logs | admin"
echo "  ariadne-admin    — open the admin dashboard in the browser"
echo "  ariadne-logs     — tail the server log"
