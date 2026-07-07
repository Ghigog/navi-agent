#!/usr/bin/env bash

# Setup directory paths relative to the script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/bin"
VOICES_DIR="$BIN_DIR/voices"

echo "=== Navi Model Setup Script ==="
echo "Ensuring model directories exist..."
mkdir -p "$BIN_DIR"
mkdir -p "$VOICES_DIR"

# Helper function to download files using curl or wget
download_file() {
    local url="$1"
    local output_path="$2"
    local description="$3"

    if [ -f "$output_path" ]; then
        echo "✅ $description already exists at $output_path"
        return 0
    fi

    echo "Downloading $description..."
    if command -v curl &> /dev/null; then
        curl -L -o "$output_path" "$url"
    elif command -v wget &> /dev/null; then
        wget -O "$output_path" "$url"
    else
        echo "❌ ERROR: Neither curl nor wget was found. Please install curl or wget to continue." >&2
        return 1
    fi

    if [ $? -ne 0 ]; then
        echo "❌ ERROR: Failed to download $description." >&2
        # Clean up partial download
        rm -f "$output_path"
        return 1
    fi
    echo "✅ Successfully downloaded $description"
}

# 1. Download Whisper GGML base model
WHISPER_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
download_file "$WHISPER_URL" "$BIN_DIR/ggml-base.en.bin" "Whisper GGML Base Model (ggml-base.en.bin)"
if [ $? -ne 0 ]; then
    exit 1
fi

# 2. Download default Piper Voice ONNX model
PIPER_VOICE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx"
download_file "$PIPER_VOICE_URL" "$VOICES_DIR/en_US-amy-medium.onnx" "Piper Voice ONNX Model (en_US-amy-medium.onnx)"
if [ $? -ne 0 ]; then
    exit 1
fi

# 3. Download default Piper Voice config
PIPER_CONFIG_URL="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json"
download_file "$PIPER_CONFIG_URL" "$VOICES_DIR/en_US-amy-medium.onnx.json" "Piper Voice Config (en_US-amy-medium.onnx.json)"
if [ $? -ne 0 ]; then
    exit 1
fi

echo "Setting execution permissions on local binaries..."
chmod +x "$BIN_DIR/piper" 2>/dev/null || true
chmod +x "$BIN_DIR/whisper-cli" 2>/dev/null || true

echo "=== Navi Setup Completed Successfully! ==="
