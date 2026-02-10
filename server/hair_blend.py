#!/usr/bin/env python3
"""
Hair Blending Service for Auren
Copies hair from a reference image onto a user's photo using OpenCV.
"""

import sys
import json
import base64
import numpy as np
import cv2
from io import BytesIO

def decode_base64_image(base64_str: str) -> np.ndarray:
    """Decode a base64 image string to OpenCV format."""
    if base64_str.startswith("data:"):
        base64_str = base64_str.split(",", 1)[1]
    
    img_data = base64.b64decode(base64_str)
    img_array = np.frombuffer(img_data, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    return img

def decode_base64_mask(base64_str: str) -> np.ndarray:
    """Decode a base64 mask image to grayscale."""
    if base64_str.startswith("data:"):
        base64_str = base64_str.split(",", 1)[1]
    
    img_data = base64.b64decode(base64_str)
    img_array = np.frombuffer(img_data, dtype=np.uint8)
    mask = cv2.imdecode(img_array, cv2.IMREAD_GRAYSCALE)
    return mask

def encode_image_base64(img: np.ndarray) -> str:
    """Encode an OpenCV image to base64 PNG."""
    success, buffer = cv2.imencode('.png', img)
    if not success:
        raise ValueError("Failed to encode image")
    
    base64_str = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/png;base64,{base64_str}"

def find_hair_center(mask: np.ndarray) -> tuple:
    """Find the center of mass of the hair region."""
    moments = cv2.moments(mask)
    if moments["m00"] == 0:
        return (mask.shape[1] // 2, mask.shape[0] // 2)
    
    cx = int(moments["m10"] / moments["m00"])
    cy = int(moments["m01"] / moments["m00"])
    return (cx, cy)

def color_match_lab(source: np.ndarray, target: np.ndarray, mask: np.ndarray = None) -> np.ndarray:
    """Match the color statistics of source to target using LAB color space."""
    source_lab = cv2.cvtColor(source, cv2.COLOR_BGR2LAB).astype(np.float32)
    target_lab = cv2.cvtColor(target, cv2.COLOR_BGR2LAB).astype(np.float32)
    
    if mask is not None:
        mask_3d = mask[:, :, np.newaxis] / 255.0
        source_mean = np.sum(source_lab * mask_3d, axis=(0, 1)) / (np.sum(mask_3d) + 1e-6)
        source_std = np.sqrt(np.sum(((source_lab - source_mean) ** 2) * mask_3d, axis=(0, 1)) / (np.sum(mask_3d) + 1e-6))
        target_mean = np.sum(target_lab * mask_3d, axis=(0, 1)) / (np.sum(mask_3d) + 1e-6)
        target_std = np.sqrt(np.sum(((target_lab - target_mean) ** 2) * mask_3d, axis=(0, 1)) / (np.sum(mask_3d) + 1e-6))
    else:
        source_mean = np.mean(source_lab, axis=(0, 1))
        source_std = np.std(source_lab, axis=(0, 1))
        target_mean = np.mean(target_lab, axis=(0, 1))
        target_std = np.std(target_lab, axis=(0, 1))
    
    source_std = np.maximum(source_std, 1e-6)
    
    result_lab = (source_lab - source_mean) * (target_std / source_std) + target_mean
    result_lab = np.clip(result_lab, 0, 255).astype(np.uint8)
    
    result = cv2.cvtColor(result_lab, cv2.COLOR_LAB2BGR)
    return result

def feather_mask(mask: np.ndarray, feather_amount: int = 15) -> np.ndarray:
    """Apply feathering to mask edges for smoother blending."""
    blurred = cv2.GaussianBlur(mask, (feather_amount * 2 + 1, feather_amount * 2 + 1), 0)
    return blurred

def resize_hair_to_fit(hair_img: np.ndarray, hair_mask: np.ndarray, 
                       user_img: np.ndarray, user_mask: np.ndarray) -> tuple:
    """Resize the reference hair to match the user's head size."""
    ref_contours, _ = cv2.findContours(hair_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    user_contours, _ = cv2.findContours(user_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not ref_contours or not user_contours:
        return hair_img, hair_mask
    
    ref_bbox = cv2.boundingRect(max(ref_contours, key=cv2.contourArea))
    user_bbox = cv2.boundingRect(max(user_contours, key=cv2.contourArea))
    
    scale_w = user_bbox[2] / max(ref_bbox[2], 1)
    scale_h = user_bbox[3] / max(ref_bbox[3], 1)
    scale = (scale_w + scale_h) / 2
    scale = max(0.5, min(2.0, scale))
    
    new_size = (int(hair_img.shape[1] * scale), int(hair_img.shape[0] * scale))
    
    resized_hair = cv2.resize(hair_img, new_size, interpolation=cv2.INTER_LINEAR)
    resized_mask = cv2.resize(hair_mask, new_size, interpolation=cv2.INTER_LINEAR)
    
    return resized_hair, resized_mask

def blend_hair(user_base64: str, ref_base64: str, user_mask_base64: str, ref_mask_base64: str) -> str:
    """
    Main blending function.
    Copies hair from reference image onto user image using masks.
    """
    user_img = decode_base64_image(user_base64)
    ref_img = decode_base64_image(ref_base64)
    user_mask = decode_base64_mask(user_mask_base64)
    ref_mask = decode_base64_mask(ref_mask_base64)
    
    target_size = (1024, 1024)
    user_img = cv2.resize(user_img, target_size)
    ref_img = cv2.resize(ref_img, target_size)
    user_mask = cv2.resize(user_mask, target_size)
    ref_mask = cv2.resize(ref_mask, target_size)
    
    _, user_mask = cv2.threshold(user_mask, 127, 255, cv2.THRESH_BINARY)
    _, ref_mask = cv2.threshold(ref_mask, 127, 255, cv2.THRESH_BINARY)
    
    ref_img_matched, ref_mask_scaled = resize_hair_to_fit(ref_img, ref_mask, user_img, user_mask)
    
    if ref_img_matched.shape[:2] != target_size:
        pad_h = max(0, target_size[0] - ref_img_matched.shape[0])
        pad_w = max(0, target_size[1] - ref_img_matched.shape[1])
        ref_img_matched = cv2.copyMakeBorder(ref_img_matched, 0, pad_h, 0, pad_w, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        ref_mask_scaled = cv2.copyMakeBorder(ref_mask_scaled, 0, pad_h, 0, pad_w, cv2.BORDER_CONSTANT, value=0)
        ref_img_matched = cv2.resize(ref_img_matched, target_size)
        ref_mask_scaled = cv2.resize(ref_mask_scaled, target_size)
    
    ref_hair_matched = color_match_lab(ref_img_matched, user_img, ref_mask_scaled)
    
    feathered_ref_mask = feather_mask(ref_mask_scaled, feather_amount=20)
    
    mask_float = feathered_ref_mask.astype(np.float32) / 255.0
    mask_3d = mask_float[:, :, np.newaxis]
    
    blended = (ref_hair_matched * mask_3d + user_img * (1 - mask_3d)).astype(np.uint8)
    
    center = find_hair_center(ref_mask_scaled)
    
    try:
        combined_mask = cv2.bitwise_or(user_mask, ref_mask_scaled)
        result = cv2.seamlessClone(blended, user_img, combined_mask, center, cv2.NORMAL_CLONE)
    except cv2.error:
        result = blended
    
    return encode_image_base64(result)

def main():
    """Main entry point - reads JSON input from stdin, outputs result to stdout."""
    try:
        input_data = json.loads(sys.stdin.read())
        
        user_base64 = input_data["userImage"]
        ref_base64 = input_data["referenceImage"]
        user_mask_base64 = input_data["userMask"]
        ref_mask_base64 = input_data["referenceMask"]
        
        result_base64 = blend_hair(user_base64, ref_base64, user_mask_base64, ref_mask_base64)
        
        output = {
            "success": True,
            "result": result_base64
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
