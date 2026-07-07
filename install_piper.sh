#!/usr/bin/env bash

echo "=== Piper TTS Installation Script ==="

# 1. Find python3
PYTHON_CMD=""
for cmd in python3 python; do
    if command -v "$cmd" &> /dev/null; then
        PYTHON_CMD=$(command -v "$cmd")
        break
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo "❌ ERROR: python3 or python was not found in your PATH." >&2
    echo "Please install Python 3 and ensure it is in your PATH." >&2
    exit 1
fi

echo "Found Python at: $PYTHON_CMD"

# 2. Check if pip is available
PIP_CMD=""
if "$PYTHON_CMD" -m pip --version &> /dev/null; then
    PIP_CMD="$PYTHON_CMD -m pip"
elif command -v pip3 &> /dev/null; then
    PIP_CMD="pip3"
elif command -v pip &> /dev/null; then
    PIP_CMD="pip"
fi

if [ -z "$PIP_CMD" ]; then
    echo "❌ ERROR: pip was not found. Please install pip for your Python environment." >&2
    exit 1
fi

echo "Installing piper-tts module..."
# 3. Try to install piper-tts
if $PIP_CMD install piper-tts; then
    echo "✅ Successfully installed piper-tts!"
    exit 0
else
    echo "Attempting install with --break-system-packages..."
    if $PIP_CMD install piper-tts --break-system-packages; then
        echo "✅ Successfully installed piper-tts!"
        exit 0
    else
        echo "❌ ERROR: Failed to install piper-tts." >&2
        exit 1
    fi
fi
