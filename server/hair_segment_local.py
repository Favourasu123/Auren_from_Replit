#!/usr/bin/env python3
"""
Local Hair Segmentation using ONNX BiSeNet
Replaces external Replicate API with local inference.

Usage:
  echo '{"imageUrl": "base64_or_url"}' | python3 server/hair_segment_local.py

Output:
  {"success": true, "mask": "data:image/png;base64,..."}
"""

import sys
import json
import base64
import numpy as np
import cv2
import onnxruntime as ort
from pathlib import Path
import urllib.request

MODEL_PATH = Path(__file__).parent.parent / "models" / "face_parsing_resnet18.onnx"
HAIR_CLASS_ID = 17  # BiSeNet: class 17 = hair

# Global session (loaded once)
_session = None

def get_session():
    """Load ONNX model session (cached)."""
    global _session
    if _session is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model not found: {MODEL_PATH}")
        _session = ort.InferenceSession(str(MODEL_PATH), providers=['CPUExecutionProvider'])
    return _session

def download_image(url: str) -> np.ndarray:
    """Download image from URL and return as OpenCV BGR array."""
    if url.startswith("data:"):
        # Base64 data URI
        header, data = url.split(",", 1)
        img_bytes = base64.b64decode(data)
        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
        return cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    else:
        # HTTP URL
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            img_bytes = resp.read()
        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
        return cv2.imdecode(img_array, cv2.IMREAD_COLOR)

def preprocess(image: np.ndarray, size: int = 512) -> tuple:
    """Preprocess image for BiSeNet inference."""
    original_size = image.shape[:2]
    
    # Resize to model input size
    resized = cv2.resize(image, (size, size), interpolation=cv2.INTER_LINEAR)
    
    # Convert BGR to RGB
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    
    # Normalize to [0, 1] and transpose to NCHW
    normalized = rgb.astype(np.float32) / 255.0
    transposed = np.transpose(normalized, (2, 0, 1))
    batched = np.expand_dims(transposed, axis=0)
    
    return batched, original_size

def segment_hair(image: np.ndarray) -> np.ndarray:
    """
    Run BiSeNet inference to extract hair mask.
    
    Args:
        image: BGR image as numpy array
        
    Returns:
        Hair mask as uint8 numpy array (white=hair, black=rest)
    """
    session = get_session()
    
    # Preprocess
    input_tensor, original_size = preprocess(image)
    
    # Get input name
    input_name = session.get_inputs()[0].name
    
    # Run inference
    outputs = session.run(None, {input_name: input_tensor})
    
    # Get segmentation map (argmax over classes)
    seg_map = np.argmax(outputs[0], axis=1)[0]  # Shape: (512, 512)
    
    # Extract hair class
    hair_mask = (seg_map == HAIR_CLASS_ID).astype(np.uint8) * 255
    
    # Resize back to original size
    hair_mask = cv2.resize(hair_mask, (original_size[1], original_size[0]), 
                           interpolation=cv2.INTER_NEAREST)
    
    return hair_mask

def encode_mask(mask: np.ndarray) -> str:
    """Encode mask as base64 PNG data URI."""
    success, buffer = cv2.imencode('.png', mask)
    if not success:
        raise ValueError("Failed to encode mask")
    return f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"

def main():
    """Main entry point - reads JSON from stdin, outputs result to stdout."""
    try:
        input_data = json.loads(sys.stdin.read())
        image_url = input_data.get("imageUrl") or input_data.get("image_url")
        
        if not image_url:
            raise ValueError("imageUrl is required")
        
        # Download and segment
        image = download_image(image_url)
        if image is None:
            raise ValueError("Failed to decode image")
        
        hair_mask = segment_hair(image)
        mask_b64 = encode_mask(hair_mask)
        
        output = {
            "success": True,
            "mask": mask_b64,
            "width": image.shape[1],
            "height": image.shape[0]
        }
        print(json.dumps(output))
        
    except Exception as e:
        output = {
            "success": False,
            "error": str(e)
        }
        print(json.dumps(output))
        sys.exit(1)

if __name__ == "__main__":
    main()
