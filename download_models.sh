#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
MODEL_DIR="${MODEL_DIR:-${APP_ROOT}/models}"

echo "=== Checking AI Models ==="
echo "App root: ${APP_ROOT}"
echo "Model dir: ${MODEL_DIR}"
mkdir -p "${MODEL_DIR}"

download_file() {
  local dst="$1"
  local url="$2"
  echo "  -> ${url}"
  if ! curl -L --fail --show-error --retry 4 --retry-delay 2 --retry-all-errors -o "${dst}" "${url}"; then
    echo "  ! Download failed for ${url}" >&2
    return 1
  fi
}

is_valid_file() {
  local path="$1"
  local min_kb="$2"
  if [[ -f "${path}" ]]; then
    local size_kb
    size_kb="$(du -k "${path}" 2>/dev/null | cut -f1)"
    if [[ "${size_kb}" -ge "${min_kb}" ]]; then
      return 0
    fi
  fi
  return 1
}

ensure_model() {
  local filename="$1"
  local min_kb="$2"
  local label="$3"
  shift 3
  local urls=("$@")
  local target="${MODEL_DIR}/${filename}"

  if is_valid_file "${target}" "${min_kb}"; then
    echo "✓ ${label} already present"
    return 0
  fi

  rm -f "${target}"
  echo "→ Downloading ${label}..."
  local ok=0
  for url in "${urls[@]}"; do
    if download_file "${target}" "${url}" && is_valid_file "${target}" "${min_kb}"; then
      ok=1
      break
    fi
    rm -f "${target}"
  done

  if [[ "${ok}" -ne 1 ]]; then
    echo "✗ Failed to download valid model: ${label}" >&2
    return 1
  fi
  echo "✓ ${label} ready"
}

# Required for current production pipeline (BiSeNet + SegFormer + Ultra-Light + MODNet matting backend).
ensure_model \
  "face_parsing_resnet18.onnx" \
  300000 \
  "BiSeNet face parsing model" \
  "https://huggingface.co/jonathandinu/face-parsing/resolve/main/onnx/model.onnx"

ensure_model \
  "segformer_face_parsing.onnx" \
  300000 \
  "SegFormer face parsing model" \
  "https://huggingface.co/Flafa/hair-segmentation-models/resolve/main/segformer_face_parsing.onnx"

ensure_model \
  "version-RFB-320.onnx" \
  800 \
  "Ultra-Light face detector" \
  "https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/raw/master/models/onnx/version-RFB-320.onnx"

ensure_model \
  "modnet_photographic_portrait_matting.onnx" \
  20000 \
  "MODNet portrait matting model" \
  "https://huggingface.co/onnx-community/modnet-webnn/resolve/main/onnx/model.onnx"

# Optional models for detector comparison experiments.
if [[ "${DOWNLOAD_EXTRA_FACE_DETECTORS:-0}" == "1" ]]; then
  ensure_model \
    "scrfd_2.5g_bnkps.onnx" \
    2500 \
    "SCRFD detector (optional)" \
    "https://github.com/deepinsight/insightface/releases/download/v0.7/scrfd_2.5g_bnkps.onnx"

  ensure_model \
    "retinaface_amd_int.onnx" \
    1200 \
    "RetinaFace AMD detector (optional)" \
    "https://github.com/deepinsight/insightface/releases/download/v0.7/retinaface_amd_int.onnx"
fi

echo "=== All required models are ready ==="
