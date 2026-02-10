#!/usr/bin/env python3
"""
Hair Mask Service for Auren
Uses face parsing to extract hair regions with proper post-processing.
Follows BiSeNet-style mask refinement: dilation, feathering, clamping.
"""

import sys
import json
import base64
import numpy as np
import cv2
from io import BytesIO
from PIL import Image


def decode_base64_image(base64_str: str) -> np.ndarray:
    """Decode a base64 image string to OpenCV format (BGR)."""
    if base64_str.startswith("data:"):
        base64_str = base64_str.split(",", 1)[1]
    
    img_data = base64.b64decode(base64_str)
    img_array = np.frombuffer(img_data, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    return img


def encode_mask_base64(mask: np.ndarray) -> str:
    """Encode a grayscale mask to base64 PNG."""
    success, buffer = cv2.imencode('.png', mask)
    if not success:
        raise ValueError("Failed to encode mask")
    
    base64_str = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/png;base64,{base64_str}"


def dilate_mask(mask: np.ndarray, kernel_size: int = 5, iterations: int = 1) -> np.ndarray:
    """
    Step 1: Expand hair slightly (dilation)
    Prevents hairline gaps.
    """
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    dilated = cv2.dilate(mask, kernel, iterations=iterations)
    return dilated


def feather_edges(mask: np.ndarray, blur_size: int = 7) -> np.ndarray:
    """
    Step 2: Feather edges (soft blend)
    Makes it look natural.
    """
    if blur_size % 2 == 0:
        blur_size += 1
    feathered = cv2.GaussianBlur(mask, (blur_size, blur_size), 0)
    return feathered


def clamp_values(mask: np.ndarray) -> np.ndarray:
    """
    Step 3: Clamp values
    Ensure clean white/black.
    """
    clamped = np.clip(mask, 0, 255).astype(np.uint8)
    return clamped


def refine_hair_mask(raw_mask: np.ndarray, 
                     dilation_kernel: int = 5,
                     dilation_iterations: int = 1,
                     feather_size: int = 7) -> np.ndarray:
    """
    Apply full mask refinement pipeline:
    1. Dilation - expand to prevent hairline gaps
    2. Feathering - soft edges for natural blending
    3. Clamping - ensure clean 0-255 values
    """
    mask = dilate_mask(raw_mask, dilation_kernel, dilation_iterations)
    mask = feather_edges(mask, feather_size)
    mask = clamp_values(mask)
    return mask


def create_debug_overlay(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """
    Create a debug overlay showing hair region in red.
    Useful for verifying mask quality.
    """
    overlay = image.copy()
    hair_region = mask > 128
    overlay[hair_region] = [0, 0, 255]
    
    alpha = 0.5
    blended = cv2.addWeighted(image, 1 - alpha, overlay, alpha, 0)
    return blended


def extract_hair_from_segmentation(seg_map: np.ndarray, hair_class_id: int = 2) -> np.ndarray:
    """
    Extract hair region from a segmentation map.
    BiSeNet standard: class 2 = hair
    """
    hair_mask = np.zeros_like(seg_map, dtype=np.uint8)
    hair_mask[seg_map == hair_class_id] = 255
    return hair_mask


def process_raw_mask(raw_mask_base64: str,
                    dilation_kernel: int = 5,
                    dilation_iterations: int = 1,
                    feather_size: int = 7,
                    user_image_base64: str = None,
                    create_overlay: bool = False) -> dict:
    """
    Process a raw hair mask with refinement pipeline.
    
    Args:
        raw_mask_base64: Base64 encoded raw mask (white=hair, black=rest)
        dilation_kernel: Size of dilation kernel
        dilation_iterations: Number of dilation passes
        feather_size: Size of Gaussian blur for feathering
        user_image_base64: Optional user image for debug overlay
        create_overlay: Whether to create debug overlay
    
    Returns:
        dict with 'mask' (refined mask) and optionally 'overlay' (debug image)
    """
    if raw_mask_base64.startswith("data:"):
        raw_mask_base64 = raw_mask_base64.split(",", 1)[1]
    
    mask_data = base64.b64decode(raw_mask_base64)
    mask_array = np.frombuffer(mask_data, dtype=np.uint8)
    raw_mask = cv2.imdecode(mask_array, cv2.IMREAD_GRAYSCALE)
    
    if raw_mask is None:
        raise ValueError("Failed to decode mask image")
    
    refined_mask = refine_hair_mask(
        raw_mask,
        dilation_kernel=dilation_kernel,
        dilation_iterations=dilation_iterations,
        feather_size=feather_size
    )
    
    result = {
        "mask": encode_mask_base64(refined_mask)
    }
    
    if create_overlay and user_image_base64:
        user_image = decode_base64_image(user_image_base64)
        resized_mask = cv2.resize(refined_mask, (user_image.shape[1], user_image.shape[0]))
        overlay = create_debug_overlay(user_image, resized_mask)
        success, buffer = cv2.imencode('.png', overlay)
        if success:
            result["overlay"] = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
    
    return result


def invert_mask(mask_base64: str) -> str:
    """
    Invert a mask (white becomes black, black becomes white).
    Useful for switching between 'hair area' and 'preserve area'.
    """
    if mask_base64.startswith("data:"):
        mask_base64 = mask_base64.split(",", 1)[1]
    
    mask_data = base64.b64decode(mask_base64)
    mask_array = np.frombuffer(mask_data, dtype=np.uint8)
    mask = cv2.imdecode(mask_array, cv2.IMREAD_GRAYSCALE)
    
    inverted = 255 - mask
    return encode_mask_base64(inverted)


def main():
    """Main entry point - reads JSON input from stdin, outputs result to stdout."""
    try:
        input_data = json.loads(sys.stdin.read())
        
        action = input_data.get("action", "refine")
        
        if action == "refine":
            raw_mask = input_data["rawMask"]
            dilation_kernel = input_data.get("dilationKernel", 5)
            dilation_iterations = input_data.get("dilationIterations", 1)
            feather_size = input_data.get("featherSize", 7)
            user_image = input_data.get("userImage")
            create_overlay = input_data.get("createOverlay", False)
            
            result = process_raw_mask(
                raw_mask,
                dilation_kernel=dilation_kernel,
                dilation_iterations=dilation_iterations,
                feather_size=feather_size,
                user_image_base64=user_image,
                create_overlay=create_overlay
            )
            
            output = {
                "success": True,
                "mask": result["mask"]
            }
            if "overlay" in result:
                output["overlay"] = result["overlay"]
                
        elif action == "invert":
            mask = input_data["mask"]
            inverted = invert_mask(mask)
            output = {
                "success": True,
                "mask": inverted
            }
        else:
            output = {
                "success": False,
                "error": f"Unknown action: {action}"
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
