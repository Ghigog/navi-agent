#!/usr/bin/env bash
# Builds navi-helper (NAV-90) and drops it in bin/, alongside piper and whisper-cli — same
# convention, a checked-in binary rather than a compiler invoked at runtime. Re-run this after
# editing anything under helper/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER_DIR="$SCRIPT_DIR/helper"
BIN_DIR="$SCRIPT_DIR/bin"

echo "=== Building navi-helper ==="

if ! command -v swift &> /dev/null; then
    echo "❌ ERROR: swift was not found in your PATH. Install Xcode or the Swift toolchain." >&2
    exit 1
fi

cd "$HELPER_DIR"
swift build -c release

mkdir -p "$BIN_DIR"
cp ".build/release/navi-helper" "$BIN_DIR/navi-helper"
chmod +x "$BIN_DIR/navi-helper"

echo "✅ Built $BIN_DIR/navi-helper"
echo "   It still needs Accessibility granted to it in System Settings › Privacy & Security ›"
echo "   Accessibility before it can read or act on anything — there is no API to grant that."
