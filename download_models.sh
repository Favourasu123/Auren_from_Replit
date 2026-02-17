#!/bin/bash
set -e
echo "=== Checking AI Models ==="
mkdir -p /app/models

is_valid_model() {
    if [ -f "$1" ]; then
        size=$(du -k "$1" 2>/dev/null | cut -f1)
        if [ "$size" -gt 100 ]; then
            return 0
        fi
    fi
    return 1
}

is_valid_segformer() {
    if [ -f "$1" ]; then
        size=$(du -k "$1" 2>/dev/null | cut -f1)
        if [ "$size" -gt 300000 ]; then
            return 0
        fi
    fi
    return 1
}

if is_valid_model "/app/models/face_parsing_resnet18.onnx" && \
   is_valid_model "/app/models/version-RFB-320.onnx" && \
   is_valid_segformer "/app/models/segformer_face_parsing.onnx"; then
    echo "✓ Models already exist on volume - skipping download"
    exit 0
fi

echo "Downloading models (first deploy only)..."

if ! is_valid_model "/app/models/face_parsing_resnet18.onnx"; then
    echo "→ Downloading BiSeNet face parsing model..."
    curl -L --fail --show-error \
        -o /app/models/face_parsing_resnet18.onnx \
        "https://huggingface.co/jonathandinu/face-parsing/resolve/main/onnx/model.onnx"
    echo "✓ BiSeNet model downloaded"
fi

if ! is_valid_segformer "/app/models/segformer_face_parsing.onnx"; then
    echo "→ Downloading SegFormer face parsing model..."
    rm -f /app/models/segformer_face_parsing.onnx
    curl -L --fail --show-error \
        -o /app/models/segformer_face_parsing.onnx \
        "https://huggingface.co/Flafa/hair-segmentation-models/resolve/main/segformer_face_parsing.onnx"
    echo "✓ SegFormer model downloaded"
fi

if ! is_valid_model "/app/models/version-RFB-320.onnx"; then
    echo "→ Downloading Ultra-Light face detector..."
    curl -L --fail --show-error \
        -o /app/models/version-RFB-320.onnx \
        "https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/raw/master/models/onnx/version-RFB-320.onnx"
    echo "✓ Ultra-Light face detector downloaded"
fi

echo "=== All models ready! ==="
