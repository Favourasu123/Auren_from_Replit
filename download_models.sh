#!/bin/bash
set -e

echo "=== Downloading AI Models for Hair Segmentation ==="

# Create models directory
mkdir -p models

# Function to check if a file exists and is valid (>100KB)
is_valid_model() {
    if [ -f "$1" ]; then
        size=$(du -k "$1" 2>/dev/null | cut -f1)
        if [ "$size" -gt 100 ]; then
            return 0
        fi
    fi
    return 1
}

# Check if models already downloaded
if is_valid_model "models/face_parsing_resnet18.onnx" && \
   is_valid_model "models/version-RFB-320.onnx"; then
    echo "✓ Models already exist - skipping download"
    exit 0
fi

echo "Downloading models (this will take ~30 seconds)..."

# Download BiSeNet Face Parsing Model (~30MB)
if ! is_valid_model "models/face_parsing_resnet18.onnx"; then
    echo "→ Downloading BiSeNet face parsing model..."

curl -L --fail --silent --show-error \
    -o models/face_parsing_resnet18.onnx \
    "https://huggingface.co/jonathandinu/face-parsing/resolve/main/face_parsing_resnet18.onnx?download=true" || {
    echo "❌ Failed to download BiSeNet model"
    exit 1
}

    echo "✓ BiSeNet model downloaded"
fi

# Download Ultra-Light Face Detector (~1MB)
if ! is_valid_model "models/version-RFB-320.onnx"; then
    echo "→ Downloading Ultra-Light face detector..."

    curl -L --fail --silent --show-error \
        -o models/version-RFB-320.onnx \
        "https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/raw/master/models/onnx/version-RFB-320.onnx" || {
        echo "❌ Failed to download Ultra-Light face detector"
        exit 1
    }

    echo "✓ Ultra-Light face detector downloaded"
fi

echo "=== All models ready! ==="
echo "   BiSeNet: $(du -h models/face_parsing_resnet18.onnx | cut -f1)"
echo "   Ultra-Light: $(du -h models/version-RFB-320.onnx | cut -f1)"
