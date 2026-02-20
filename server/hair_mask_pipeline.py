#!/usr/bin/env python3
"""
Optimized Hair Mask Pipeline - Combined Segmentation + Refinement
Single Python process for better performance.

Usage:
  echo '{"imageUrl": "..."}' | python3 server/hair_mask_pipeline.py

Output:
  {"success": true, "mask": "data:image/png;base64,...", "raw_mask": "..."}
"""

import sys
import json
import base64
import numpy as np
import cv2
import onnxruntime as ort
from pathlib import Path
import urllib.request
import os

MODEL_PATH = Path(__file__).parent.parent / "models" / "face_parsing_resnet18.onnx"
SEGFORMER_MODEL_PATH = Path(__file__).parent.parent / "models" / "segformer_face_parsing.onnx"
ULTRA_LIGHT_FACE_MODEL_PATH = Path(__file__).parent.parent / "models" / "version-RFB-320.onnx"

# Quiet mode - suppress verbose logging (only errors and final status shown)
QUIET_MODE = os.environ.get("BISENET_QUIET", "1") == "1"

# Enable/disable early face detection (Ultra-Light-Fast face detector before BiSeNet)
USE_EARLY_FACE_DETECTION = os.environ.get("EARLY_FACE_DETECTION", "1") == "1"
FACE_DETECTION_CONFIDENCE = 0.7  # Minimum confidence for face detection

def log_debug(msg: str):
    """Log debug message (suppressed in quiet mode)"""
    if not QUIET_MODE:
        print(msg)

def log_info(msg: str):
    """Log info message (always shown)"""
    print(msg)

# BiSeNet CelebAMask-HQ class IDs
HAIR_CLASS_ID = 17
SKIN_CLASS_ID = 1
NECK_ID = 14
LEFT_EAR_ID = 7
RIGHT_EAR_ID = 8
LEFT_EYEBROW_ID = 2
RIGHT_EYEBROW_ID = 3
LEFT_EYE_ID = 4
RIGHT_EYE_ID = 5
NOSE_ID = 10
UPPER_LIP_ID = 12
LOWER_LIP_ID = 13
MOUTH_ID = 11

# Grey background color for masks (RGB 128,128,128 in BGR format)
GRAY_BG = (128, 128, 128)

# User photo quality thresholds for face detection
# Note: Eye thresholds lowered to accommodate Asian facial features (monolids, smaller eye openings)
# The BiSeNet model (trained on CelebAMask-HQ) may detect fewer eye pixels for these features
USER_PHOTO_QUALITY = {
    "min_image_size": 499,       # Minimum dimension (width or height) - TypeScript enforces 95%+ mask score for 499-599px
    "min_eye_pixels": 30,        # Minimum pixels for each eye (lowered from 100 for Asian features)
    "min_nose_pixels": 200,      # Minimum pixels for nose
    "min_mouth_pixels": 150,     # Minimum pixels for mouth (includes lips)
    "min_forehead_pixels": 150,  # Minimum pixels for forehead region (area above eyebrows)
    "strong_face_threshold": 2000,  # If nose+mouth exceed this, consider face "strongly detected"
}

# Mask validation thresholds (relaxed to allow more refs to pass advanced pipeline)
MASK_VALIDATION = {
    "min_hair_ratio": 0.01,      # Hair should be at least 1% of image (relaxed from 2%)
    "max_hair_ratio": 0.60,      # Hair shouldn't exceed 60% of image (relaxed from 50%)
    "max_centroid_y_ratio": 0.85, # Hair centroid should be in upper 85% of image (relaxed from 70%)
    "min_connected_ratio": 0.50,  # Largest connected component should be 50%+ of total hair (relaxed from 60%)
    "min_facial_features": 300,   # Minimum pixels of facial features to confirm face presence (relaxed from 500)
}

# Ultra-Light face detector globals (lazy loaded)
_ultra_light_face_session = None

def get_ultra_light_face_detector():
    """Get or create the Ultra-Light face detector session (lazy loading)."""
    global _ultra_light_face_session
    
    if _ultra_light_face_session is not None:
        return _ultra_light_face_session
    
    if not ULTRA_LIGHT_FACE_MODEL_PATH.exists():
        log_info(f"Ultra-Light face model not found at {ULTRA_LIGHT_FACE_MODEL_PATH}")
        return None
    
    # Check if model file is valid (not a failed download)
    if ULTRA_LIGHT_FACE_MODEL_PATH.stat().st_size < 100000:  # Should be at least 100KB
        log_info(f"Ultra-Light face model file too small, likely corrupted")
        return None
    
    try:
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = 4
        
        _ultra_light_face_session = ort.InferenceSession(
            str(ULTRA_LIGHT_FACE_MODEL_PATH),
            sess_options=opts,
            providers=['CPUExecutionProvider']
        )
        log_debug("Ultra-Light face detector loaded successfully")
        return _ultra_light_face_session
    except Exception as e:
        log_info(f"Failed to load Ultra-Light face detector: {e}")
        return None

def detect_faces_ultra_light(image: np.ndarray, confidence_threshold: float = FACE_DETECTION_CONFIDENCE) -> list:
    """
    Detect faces using Ultra-Light-Fast-Generic-Face-Detector ONNX model.
    
    This is a very fast face detector (~1MB model) that runs efficiently on CPU.
    
    Args:
        image: BGR image as numpy array
        confidence_threshold: Minimum confidence for detection
        
    Returns:
        List of detected faces, each as dict with:
            - bbox: (x, y, w, h) bounding box
            - confidence: detection confidence
            - area: face area in pixels
    """
    session = get_ultra_light_face_detector()
    if session is None:
        return []
    
    h, w = image.shape[:2]
    
    # Ultra-Light RFB-320 expects 320x240 input
    input_w, input_h = 320, 240
    
    # Resize image to model input size
    resized = cv2.resize(image, (input_w, input_h))
    
    # Preprocess: BGR to RGB, normalize to [-1, 1]
    input_image = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    input_image = (input_image - 127.0) / 128.0  # Normalize to [-1, 1]
    input_image = input_image.astype(np.float32)
    input_image = np.transpose(input_image, (2, 0, 1))  # HWC to CHW
    input_image = np.expand_dims(input_image, axis=0)  # Add batch dimension
    
    # Run inference
    try:
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: input_image})
        # Output: [confidences, boxes]
        # confidences: (1, N, 2) - background and face scores
        # boxes: (1, N, 4) - normalized [x1, y1, x2, y2]
        confidences = outputs[0][0]  # (N, 2)
        boxes = outputs[1][0]  # (N, 4)
    except Exception as e:
        log_info(f"Ultra-Light face detection error: {e}")
        return []
    
    faces = []
    for i in range(len(confidences)):
        # Get face confidence (index 1 is face, index 0 is background)
        conf = confidences[i, 1]
        
        if conf < confidence_threshold:
            continue
        
        # Get bounding box (normalized coordinates)
        x1_norm, y1_norm, x2_norm, y2_norm = boxes[i]
        
        # Convert to original image coordinates
        x1 = int(x1_norm * w)
        y1 = int(y1_norm * h)
        x2 = int(x2_norm * w)
        y2 = int(y2_norm * h)
        
        # Clamp to image bounds
        x1 = max(0, min(w, x1))
        y1 = max(0, min(h, y1))
        x2 = max(0, min(w, x2))
        y2 = max(0, min(h, y2))
        
        face_w = x2 - x1
        face_h = y2 - y1
        
        if face_w > 20 and face_h > 20:  # Minimum face size
            faces.append({
                "bbox": (x1, y1, face_w, face_h),
                "confidence": float(conf),
                "area": face_w * face_h
            })
    
    # Sort by confidence and apply NMS
    faces.sort(key=lambda f: f["confidence"], reverse=True)
    
    # Simple NMS
    final_faces = []
    for face in faces:
        x1, y1, fw, fh = face["bbox"]
        is_duplicate = False
        for kept in final_faces:
            kx1, ky1, kw, kh = kept["bbox"]
            # Check IoU
            ix1 = max(x1, kx1)
            iy1 = max(y1, ky1)
            ix2 = min(x1 + fw, kx1 + kw)
            iy2 = min(y1 + fh, ky1 + kh)
            if ix2 > ix1 and iy2 > iy1:
                intersection = (ix2 - ix1) * (iy2 - iy1)
                union = fw * fh + kw * kh - intersection
                if intersection / union > 0.5:
                    is_duplicate = True
                    break
        if not is_duplicate:
            final_faces.append(face)
    
    # Sort by area for final output
    final_faces.sort(key=lambda f: f["area"], reverse=True)
    
    return final_faces

def early_face_check(image: np.ndarray) -> dict:
    """
    Perform early face detection before BiSeNet processing.
    
    Logic: IF face detector finds face → crop face region → return True
           ELSE → fail early
    
    Args:
        image: BGR image as numpy array
        
    Returns:
        dict with:
            - face_found: bool
            - faces: list of detected faces
            - crop_region: (x, y, w, h) expanded bbox for cropping (or None)
            - message: status message
    """
    if not USE_EARLY_FACE_DETECTION:
        return {
            "face_found": True,  # Skip check, assume face exists
            "faces": [],
            "crop_region": None,
            "message": "Early face detection disabled"
        }
    
    try:
        faces = detect_faces_ultra_light(image)
    except Exception as e:
        log_info(f"Warning: Ultra-Light face detection error: {e}")
        # If face detection fails, skip the early check and let BiSeNet handle it
        return {
            "face_found": True,  # Allow to proceed
            "faces": [],
            "crop_region": None,
            "message": f"Face detection unavailable: {e}"
        }
    
    if not faces:
        return {
            "face_found": False,
            "faces": [],
            "crop_region": None,
            "message": "No face detected in image - please upload a clear photo of your face"
        }
    
    # Get the largest face
    largest_face = faces[0]
    x, y, w, h = largest_face["bbox"]
    
    # Expand the crop region to include hair (expand up by 60%, sides by 30%)
    img_h, img_w = image.shape[:2]
    expand_top = int(h * 0.6)
    expand_sides = int(w * 0.3)
    expand_bottom = int(h * 0.2)
    
    crop_x = max(0, x - expand_sides)
    crop_y = max(0, y - expand_top)
    crop_x2 = min(img_w, x + w + expand_sides)
    crop_y2 = min(img_h, y + h + expand_bottom)
    crop_w = crop_x2 - crop_x
    crop_h = crop_y2 - crop_y
    
    return {
        "face_found": True,
        "faces": faces,
        "crop_region": (crop_x, crop_y, crop_w, crop_h),
        "message": f"Face detected with {largest_face['confidence']*100:.1f}% confidence"
    }

def validate_hair_mask(hair_mask: np.ndarray, facial_mask: np.ndarray, image_shape: tuple) -> dict:
    """
    Validate a hair mask using heuristic checks.
    
    Returns:
        dict with keys:
            - valid: bool - overall pass/fail
            - score: float - quality score 0-100
            - issues: list - specific problems found
            - metrics: dict - detailed measurements
    """
    h, w = image_shape[:2]
    total_pixels = h * w
    issues = []
    metrics = {}
    
    # 1. Pixel count ratio check
    hair_pixels = np.sum(hair_mask > 0)
    hair_ratio = hair_pixels / total_pixels
    metrics["hair_ratio"] = round(hair_ratio * 100, 2)
    metrics["hair_pixels"] = int(hair_pixels)
    
    if hair_ratio < MASK_VALIDATION["min_hair_ratio"]:
        issues.append(f"Hair too small: {hair_ratio*100:.1f}% (min {MASK_VALIDATION['min_hair_ratio']*100}%)")
    elif hair_ratio > MASK_VALIDATION["max_hair_ratio"]:
        issues.append(f"Hair too large: {hair_ratio*100:.1f}% (max {MASK_VALIDATION['max_hair_ratio']*100}%)")
    
    # 2. Position check - hair centroid should be in upper portion
    if hair_pixels > 0:
        hair_coords = np.where(hair_mask > 0)
        centroid_y = np.mean(hair_coords[0])
        centroid_x = np.mean(hair_coords[1])
        centroid_y_ratio = centroid_y / h
        metrics["centroid_y_ratio"] = round(centroid_y_ratio, 3)
        metrics["centroid"] = (int(centroid_x), int(centroid_y))
        
        if centroid_y_ratio > MASK_VALIDATION["max_centroid_y_ratio"]:
            issues.append(f"Hair position too low: {centroid_y_ratio*100:.1f}% from top (max {MASK_VALIDATION['max_centroid_y_ratio']*100}%)")
    else:
        metrics["centroid_y_ratio"] = None
        metrics["centroid"] = None
        issues.append("No hair detected at all")
    
    # 3. Connectivity check - hair should be mostly one connected region
    if hair_pixels > 100:
        # Find connected components
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
            hair_mask.astype(np.uint8), connectivity=8
        )
        
        if num_labels > 1:  # Background is label 0
            # Find largest component (excluding background)
            component_sizes = stats[1:, cv2.CC_STAT_AREA]  # Skip background
            largest_component = np.max(component_sizes)
            connected_ratio = largest_component / hair_pixels
            metrics["connected_ratio"] = round(connected_ratio, 3)
            metrics["num_components"] = num_labels - 1  # Exclude background
            
            if connected_ratio < MASK_VALIDATION["min_connected_ratio"]:
                issues.append(f"Hair fragmented: largest region is {connected_ratio*100:.1f}% (min {MASK_VALIDATION['min_connected_ratio']*100}%)")
        else:
            metrics["connected_ratio"] = 1.0
            metrics["num_components"] = 0
    else:
        metrics["connected_ratio"] = None
        metrics["num_components"] = None
    
    # 4. Face presence check
    facial_pixels = np.sum(facial_mask > 0) if facial_mask is not None else 0
    metrics["facial_pixels"] = int(facial_pixels)
    
    if facial_pixels < MASK_VALIDATION["min_facial_features"]:
        issues.append(f"No clear face detected: {facial_pixels} facial pixels (min {MASK_VALIDATION['min_facial_features']})")
    
    # 5. Bounding box aspect ratio check
    if hair_pixels > 100:
        rows = np.any(hair_mask > 0, axis=1)
        cols = np.any(hair_mask > 0, axis=0)
        if np.any(rows) and np.any(cols):
            y_min, y_max = np.where(rows)[0][[0, -1]]
            x_min, x_max = np.where(cols)[0][[0, -1]]
            bbox_w = x_max - x_min + 1
            bbox_h = y_max - y_min + 1
            aspect_ratio = bbox_w / max(bbox_h, 1)
            metrics["bbox_aspect_ratio"] = round(aspect_ratio, 2)
            metrics["bbox"] = (int(x_min), int(y_min), int(bbox_w), int(bbox_h))
            
            # Extremely wide or tall hair regions are suspicious
            if aspect_ratio > 5.0:
                issues.append(f"Hair region too wide: aspect ratio {aspect_ratio:.1f}")
            elif aspect_ratio < 0.2:
                issues.append(f"Hair region too narrow: aspect ratio {aspect_ratio:.1f}")
    else:
        metrics["bbox_aspect_ratio"] = None
        metrics["bbox"] = None
    
    # Calculate overall score (0-100)
    score = 100
    score -= len(issues) * 20  # Each issue deducts 20 points
    score = max(0, min(100, score))
    
    # Determine validity
    valid = len(issues) == 0
    
    return {
        "valid": valid,
        "score": score,
        "issues": issues,
        "metrics": metrics
    }

def validate_user_mask(face_mask: np.ndarray, facial_features_mask: np.ndarray, image_shape: tuple, 
                       ultralight_face_found: bool = False) -> dict:
    """
    Validate a user mask (face region for AI input).
    
    Args:
        face_mask: Binary mask of face skin area
        facial_features_mask: Binary mask of facial features (eyes, nose, mouth)
        image_shape: Shape of the original image (h, w, ...)
        ultralight_face_found: If True, Ultra-Light detector found a face (more lenient validation)
    
    Returns same structure as validate_hair_mask.
    """
    h, w = image_shape[:2]
    total_pixels = h * w
    issues = []
    metrics = {}
    
    # 1. Face region should be 5-60% of image (or 1% if Ultra-Light found face)
    face_pixels = np.sum(face_mask > 0)
    face_ratio = face_pixels / total_pixels
    metrics["face_ratio"] = round(face_ratio * 100, 2)
    metrics["face_pixels"] = int(face_pixels)
    
    # Use more lenient threshold if Ultra-Light detector found a face
    min_face_ratio = 0.01 if ultralight_face_found else 0.05
    
    if face_ratio < min_face_ratio:
        issues.append(f"Face too small: {face_ratio*100:.1f}% (min {min_face_ratio*100:.0f}%)")
    elif face_ratio > 0.60:
        issues.append(f"Face too large: {face_ratio*100:.1f}% (max 60%)")
    
    # 2. Facial features should be present (skip if Ultra-Light found face)
    facial_pixels = np.sum(facial_features_mask > 0) if facial_features_mask is not None else 0
    metrics["facial_pixels"] = int(facial_pixels)
    
    # Only check facial features if Ultra-Light didn't find a face
    if not ultralight_face_found and facial_pixels < 1000:
        issues.append(f"Insufficient facial features: {facial_pixels} pixels (min 1000)")
    
    # 3. Face should be roughly centered
    if face_pixels > 0:
        face_coords = np.where(face_mask > 0)
        centroid_y = np.mean(face_coords[0])
        centroid_x = np.mean(face_coords[1])
        
        # Check if centroid is within middle 80% of image
        x_ratio = centroid_x / w
        y_ratio = centroid_y / h
        metrics["centroid"] = (int(centroid_x), int(centroid_y))
        metrics["centroid_x_ratio"] = round(x_ratio, 3)
        metrics["centroid_y_ratio"] = round(y_ratio, 3)
        
        if x_ratio < 0.1 or x_ratio > 0.9:
            issues.append(f"Face too far off-center horizontally: {x_ratio*100:.1f}%")
        if y_ratio < 0.1 or y_ratio > 0.9:
            issues.append(f"Face too far off-center vertically: {y_ratio*100:.1f}%")
    else:
        issues.append("No face region detected")
        metrics["centroid"] = None
    
    # Calculate score
    score = 100 - len(issues) * 25
    score = max(0, min(100, score))
    
    return {
        "valid": len(issues) == 0,
        "score": score,
        "issues": issues,
        "metrics": metrics
    }

def validate_early_photo_quality(image: np.ndarray) -> dict:
    """
    FAST early validation checks that run BEFORE expensive BiSeNet processing.
    Checks: image size, blur/focus, and lighting.
    
    These checks are cheap (no neural network) and can reject bad photos early.
    
    Args:
        image: BGR image as numpy array
    
    Returns:
        dict with keys:
            - valid: bool - whether to proceed with BiSeNet processing
            - issues: list - problems found
            - metrics: dict - measurements
            - guidance: str - user-friendly message
    """
    issues = []
    metrics = {}
    h, w = image.shape[:2]
    
    log_debug(f"[EARLY QUALITY] Starting fast validation for {w}x{h} image")
    
    # 1. Check image size (minimum dimension)
    min_dim = min(h, w)
    metrics["min_dimension"] = min_dim
    metrics["width"] = w
    metrics["height"] = h
    
    if min_dim < USER_PHOTO_QUALITY["min_image_size"]:
        issues.append(f"Image too small: {min_dim}px (min {USER_PHOTO_QUALITY['min_image_size']}px)")
        log_debug(f"[EARLY QUALITY] Image too small: {min_dim}px")
    
    # 2. Check blur/focus using Laplacian variance (FAST - no neural network)
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        metrics["blur_score"] = round(laplacian_var, 2)
        
        BLUR_THRESHOLD = 25
        if laplacian_var < BLUR_THRESHOLD:
            issues.append("Photo is too blurry")
            log_debug(f"[EARLY QUALITY] Too blurry: {laplacian_var:.2f} (min {BLUR_THRESHOLD})")
        else:
            log_debug(f"[EARLY QUALITY] Focus OK: {laplacian_var:.2f}")
    except Exception as e:
        log_debug(f"[EARLY QUALITY] Could not check blur: {e}")
        metrics["blur_score"] = None
    
    # 3. Check lighting (FAST - simple brightness calculation)
    try:
        if 'gray' not in locals():
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
        mean_brightness = np.mean(gray)
        metrics["brightness"] = round(mean_brightness, 2)
        
        if mean_brightness < 40:
            issues.append("Photo is too dark")
            log_debug(f"[EARLY QUALITY] Too dark: {mean_brightness:.2f}")
        elif mean_brightness > 220:
            issues.append("Photo is overexposed")
            log_debug(f"[EARLY QUALITY] Overexposed: {mean_brightness:.2f}")
        else:
            log_debug(f"[EARLY QUALITY] Lighting OK: {mean_brightness:.2f}")
    except Exception as e:
        log_debug(f"[EARLY QUALITY] Could not check lighting: {e}")
        metrics["brightness"] = None
    
    # Generate guidance
    guidance = ""
    if issues:
        guidance_parts = []
        if "too small" in str(issues):
            guidance_parts.append("use a higher resolution photo (at least 500x500 pixels)")
        if "blurry" in str(issues):
            guidance_parts.append("use a clearer, more focused photo")
        if "too dark" in str(issues):
            guidance_parts.append("use a photo with better lighting")
        if "overexposed" in str(issues):
            guidance_parts.append("use a photo that isn't overexposed")
        
        if guidance_parts:
            guidance = "Please " + ", ".join(guidance_parts) + "."
        else:
            guidance = "Please upload a clearer photo."
    
    valid = len(issues) == 0
    log_debug(f"[EARLY QUALITY] Completed: valid={valid}, issues={issues}")
    
    return {
        "valid": valid,
        "issues": issues,
        "metrics": metrics,
        "guidance": guidance
    }

def validate_user_photo_quality(parsing_result: np.ndarray, image_shape: tuple, image: np.ndarray = None,
                                 ultralight_face_found: bool = False) -> dict:
    """
    Validate user photo quality for hairstyle generation.
    Checks: early face detection (DNN), image size, face visibility, focus/blur, and lighting.
    
    Uses RetinaFace-style logic:
        IF face detector finds face → crop face region → THEN apply BiSeNet checks
        ELSE → fail early with clear message
    
    Args:
        parsing_result: BiSeNet parsing output (H x W with class IDs)
        image_shape: Original image shape (H, W, C)
        image: Original BGR image for blur/lighting checks (optional)
        ultralight_face_found: If True, Ultra-Light detector found a face (skip strict BiSeNet checks)
    
    Returns:
        dict with keys:
            - valid: bool - whether photo quality is acceptable
            - issues: list - specific problems found
            - metrics: dict - detailed measurements
            - guidance: str - user-friendly guidance message
            - face_detection: dict - early face detection results
    """
    h, w = image_shape[:2]
    issues = []
    metrics = {}
    
    # 0. EARLY FACE DETECTION (RetinaFace-style check before BiSeNet)
    # Logic: IF face detector finds face → continue, ELSE → fail early
    face_detection_result = None
    if image is not None and USE_EARLY_FACE_DETECTION:
        face_detection_result = early_face_check(image)
        metrics["early_face_detection"] = {
            "face_found": face_detection_result["face_found"],
            "num_faces": len(face_detection_result["faces"]),
            "message": face_detection_result["message"]
        }
        
        if not face_detection_result["face_found"]:
            # FAIL EARLY - no need to continue with other checks
            log_info(f"[QUALITY] Early face detection FAILED: {face_detection_result['message']}")
            issues.append("No face detected - please upload a clear photo of your face looking at the camera")
            return {
                "valid": False,
                "issues": issues,
                "metrics": metrics,
                "guidance": "Please upload a clear, well-lit photo showing your face looking directly at the camera. Avoid photos with sunglasses, masks, or where your face is turned away.",
                "face_detection": face_detection_result
            }
        else:
            log_debug(f"[QUALITY] Early face detection PASSED: {face_detection_result['message']}")
            # Store face crop region for potential future use
            if face_detection_result["crop_region"]:
                metrics["face_crop_region"] = face_detection_result["crop_region"]
    
    # 1. Check image size (minimum dimension)
    min_dim = min(h, w)
    metrics["min_dimension"] = min_dim
    if min_dim < USER_PHOTO_QUALITY["min_image_size"]:
        issues.append(f"Image too small: {min_dim}px (min {USER_PHOTO_QUALITY['min_image_size']}px)")
    
    # 2. Check if ANY face is visible (relaxed check)
    # Count total facial feature pixels (eyes, nose, mouth, eyebrows, skin)
    left_eye_pixels = int(np.sum(parsing_result == LEFT_EYE_ID))
    right_eye_pixels = int(np.sum(parsing_result == RIGHT_EYE_ID))
    nose_pixels = int(np.sum(parsing_result == NOSE_ID))
    mouth_pixels = int(np.sum((parsing_result == MOUTH_ID) | 
                               (parsing_result == UPPER_LIP_ID) | 
                               (parsing_result == LOWER_LIP_ID)))
    eyebrow_pixels = int(np.sum((parsing_result == LEFT_EYEBROW_ID) | 
                                 (parsing_result == RIGHT_EYEBROW_ID)))
    skin_pixels = int(np.sum(parsing_result == SKIN_CLASS_ID))
    
    # Store metrics for debugging
    metrics["left_eye_pixels"] = left_eye_pixels
    metrics["right_eye_pixels"] = right_eye_pixels
    metrics["nose_pixels"] = nose_pixels
    metrics["mouth_pixels"] = mouth_pixels
    metrics["eyebrow_pixels"] = eyebrow_pixels
    metrics["skin_pixels"] = skin_pixels
    
    # Total facial pixels = any combination of features
    total_facial_pixels = left_eye_pixels + right_eye_pixels + nose_pixels + mouth_pixels + eyebrow_pixels + skin_pixels
    metrics["total_facial_pixels"] = total_facial_pixels
    
    # COMBINED APPROACH: Use both Ultra-Light and BiSeNet together
    # Face is detected if EITHER detector finds it (union of results)
    MIN_FACE_PIXELS = 500
    bisenet_face_detected = total_facial_pixels >= MIN_FACE_PIXELS
    face_detected = bisenet_face_detected or ultralight_face_found
    metrics["face_detected"] = face_detected
    metrics["bisenet_face_detected"] = bisenet_face_detected
    metrics["ultralight_face_found"] = ultralight_face_found
    
    if face_detected:
        log_debug(f"[QUALITY] Face detected (combined): BiSeNet={bisenet_face_detected} ({total_facial_pixels}px), Ultra-Light={ultralight_face_found}")
    else:
        issues.append("No face detected in the photo")
        log_debug(f"[QUALITY] No face detected by either detector: BiSeNet={total_facial_pixels}px, Ultra-Light={ultralight_face_found}")
    
    # 2b. COMBINED: Check eye visibility using BiSeNet, validated by Ultra-Light
    # Eyes are considered visible if BiSeNet detects them OR Ultra-Light found face (implies eyes exist)
    MIN_EYE_PIXELS = 30  # Minimum pixels for a visible eye
    has_left_eye = left_eye_pixels >= MIN_EYE_PIXELS
    has_right_eye = right_eye_pixels >= MIN_EYE_PIXELS
    bisenet_eye_detected = has_left_eye or has_right_eye
    eye_check_passed = bisenet_eye_detected or ultralight_face_found
    metrics["has_left_eye"] = has_left_eye
    metrics["has_right_eye"] = has_right_eye
    metrics["has_at_least_one_eye"] = eye_check_passed
    metrics["bisenet_eye_detected"] = bisenet_eye_detected
    
    if eye_check_passed:
        log_debug(f"[QUALITY] Eye check passed (combined): BiSeNet={bisenet_eye_detected} (L={left_eye_pixels}px, R={right_eye_pixels}px), Ultra-Light={ultralight_face_found}")
    else:
        issues.append("Please ensure at least one eye is clearly visible in the photo")
        log_debug(f"[QUALITY] Eye check failed: BiSeNet={bisenet_eye_detected}, Ultra-Light={ultralight_face_found}")
    
    # 3. COMBINED: Check for multiple faces using both detectors
    # BiSeNet uses connected components, Ultra-Light is more reliable for single face detection
    try:
        # Create a combined face mask (skin + facial features)
        face_mask = (
            (parsing_result == SKIN_CLASS_ID) |
            (parsing_result == LEFT_EYE_ID) |
            (parsing_result == RIGHT_EYE_ID) |
            (parsing_result == NOSE_ID) |
            (parsing_result == MOUTH_ID) |
            (parsing_result == UPPER_LIP_ID) |
            (parsing_result == LOWER_LIP_ID)
        ).astype(np.uint8)
        
        # Find connected components
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(face_mask, connectivity=8)
        
        # Filter out small components (noise) - only count regions > 3000 pixels as faces
        MIN_FACE_COMPONENT_SIZE = 3000
        bisenet_face_count = 0
        for i in range(1, num_labels):  # Skip background (label 0)
            if stats[i, cv2.CC_STAT_AREA] >= MIN_FACE_COMPONENT_SIZE:
                bisenet_face_count += 1
        
        metrics["bisenet_face_count"] = bisenet_face_count
        
        # COMBINED: Trust Ultra-Light for single face confirmation (more reliable)
        # Only flag multiple faces if Ultra-Light didn't find a face AND BiSeNet found multiple
        if ultralight_face_found:
            # Ultra-Light confirmed one face - trust it over BiSeNet's possibly spurious regions
            metrics["face_count"] = 1
            log_debug(f"[QUALITY] Face count (combined): Ultra-Light=1, BiSeNet={bisenet_face_count} (trusting Ultra-Light)")
        else:
            # No Ultra-Light detection - use BiSeNet result
            metrics["face_count"] = bisenet_face_count
            log_debug(f"[QUALITY] Face count (BiSeNet only): {bisenet_face_count}")
            if bisenet_face_count > 1:
                issues.append("Please get closer to the camera. We recommend a shoulders-up photo with space around your hair.")
                log_debug(f"[QUALITY] Multiple faces: {bisenet_face_count} detected (max 1 allowed)")
    except Exception as e:
        log_debug(f"[QUALITY] Could not check face count: {e}")
        metrics["face_count"] = 1 if ultralight_face_found else None
        metrics["bisenet_face_count"] = None
    
    # 4. Check image focus/blur using Laplacian variance
    if image is not None:
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
            metrics["blur_score"] = round(laplacian_var, 2)
            
            # Threshold: below 25 is very blurry (relaxed from 50)
            BLUR_THRESHOLD = 25
            if laplacian_var < BLUR_THRESHOLD:
                issues.append("Photo is too blurry")
                log_debug(f"[QUALITY] Photo too blurry: Laplacian variance = {laplacian_var:.2f} (min {BLUR_THRESHOLD})")
            else:
                log_debug(f"[QUALITY] Focus OK: Laplacian variance = {laplacian_var:.2f}")
        except Exception as e:
            log_debug(f"[QUALITY] Could not check blur: {e}")
            metrics["blur_score"] = None
    
    # 4. Check lighting - image should not be too dark or overexposed
    if image is not None:
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
            mean_brightness = np.mean(gray)
            metrics["brightness"] = round(mean_brightness, 2)
            
            # Check if too dark (< 40) or overexposed (> 220)
            if mean_brightness < 40:
                issues.append("Photo is too dark")
                log_debug(f"[QUALITY] Photo too dark: brightness = {mean_brightness:.2f}")
            elif mean_brightness > 220:
                issues.append("Photo is overexposed")
                log_debug(f"[QUALITY] Photo overexposed: brightness = {mean_brightness:.2f}")
            else:
                log_debug(f"[QUALITY] Lighting OK: brightness = {mean_brightness:.2f}")
        except Exception as e:
            log_debug(f"[QUALITY] Could not check lighting: {e}")
            metrics["brightness"] = None
    
    # Generate user-friendly guidance
    guidance = ""
    if len(issues) > 0:
        guidance_parts = []
        if "too small" in str(issues):
            guidance_parts.append("use a higher resolution photo (at least 500x500 pixels)")
        if "No face" in str(issues):
            guidance_parts.append("make sure your face is visible in the photo")
        if "Multiple faces" in str(issues):
            guidance_parts.append("use a photo with only one person")
        if "blurry" in str(issues):
            guidance_parts.append("use a clearer, more focused photo")
        if "too dark" in str(issues):
            guidance_parts.append("use a photo with better lighting")
        if "overexposed" in str(issues):
            guidance_parts.append("use a photo that isn't overexposed")
        
        if guidance_parts:
            guidance = "Please " + ", ".join(guidance_parts) + "."
        else:
            guidance = "Please upload a clear photo where your face is visible."
    
    return {
        "valid": len(issues) == 0,
        "issues": issues,
        "metrics": metrics,
        "guidance": guidance,
        "face_detection": face_detection_result
    }

# Optimized ONNX session options
_session = None
_segformer_session = None

def get_session():
    """Load BiSeNet ONNX model with optimized settings."""
    global _session
    if _session is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model not found: {MODEL_PATH}")
        
        # Optimize for CPU inference
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = 4  # Use multiple threads
        opts.inter_op_num_threads = 1
        
        _session = ort.InferenceSession(
            str(MODEL_PATH), 
            sess_options=opts,
            providers=['CPUExecutionProvider']
        )
    return _session

def get_segformer_session():
    """Load SegFormer ONNX model with optimized settings."""
    global _segformer_session
    if _segformer_session is None:
        if not SEGFORMER_MODEL_PATH.exists():
            raise FileNotFoundError(f"SegFormer model not found: {SEGFORMER_MODEL_PATH}")
        
        # Optimize for CPU inference
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = 4
        opts.inter_op_num_threads = 1
        
        _segformer_session = ort.InferenceSession(
            str(SEGFORMER_MODEL_PATH), 
            sess_options=opts,
            providers=['CPUExecutionProvider']
        )
    return _segformer_session

def download_image(url: str) -> np.ndarray:
    """Download image from URL or decode base64."""
    if url.startswith("data:"):
        header, data = url.split(",", 1)
        img_bytes = base64.b64decode(data)
        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
        return cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    else:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            img_bytes = resp.read()
        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
        return cv2.imdecode(img_array, cv2.IMREAD_COLOR)

def sharpen_image(image: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """Apply unsharp mask sharpening to enhance image details.
    
    Args:
        image: Input BGR image
        strength: Sharpening strength (0.5 = subtle, 1.0 = normal, 2.0 = strong)
    
    Returns:
        Sharpened image
    """
    # Create a blurred version
    blurred = cv2.GaussianBlur(image, (0, 0), 3)
    
    # Unsharp mask: original + strength * (original - blurred)
    sharpened = cv2.addWeighted(image, 1.0 + strength, blurred, -strength, 0)
    
    # Clip values to valid range
    sharpened = np.clip(sharpened, 0, 255).astype(np.uint8)
    
    log_debug(f"[SHARPEN] Applied sharpening with strength={strength}")
    return sharpened


def guided_filter(guide: np.ndarray, src: np.ndarray, radius: int = 8, eps: float = 0.01) -> np.ndarray:
    """
    Apply guided filter for edge-aware mask refinement.
    This snaps mask boundaries to image edges, similar to CRF but faster.
    
    Args:
        guide: Guide image (BGR, used to detect edges)
        src: Source mask to filter (0-255 grayscale)
        radius: Filter radius (larger = smoother)
        eps: Regularization (smaller = more edge-aware)
    
    Returns:
        Refined mask with edges aligned to image boundaries
    """
    # Convert guide to grayscale if needed
    if len(guide.shape) == 3:
        guide_gray = cv2.cvtColor(guide, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    else:
        guide_gray = guide.astype(np.float32) / 255.0
    
    # Normalize source mask
    src_float = src.astype(np.float32) / 255.0
    
    # Guided filter implementation
    # Based on "Guided Image Filtering" by He et al.
    mean_I = cv2.boxFilter(guide_gray, -1, (radius, radius))
    mean_p = cv2.boxFilter(src_float, -1, (radius, radius))
    corr_I = cv2.boxFilter(guide_gray * guide_gray, -1, (radius, radius))
    corr_Ip = cv2.boxFilter(guide_gray * src_float, -1, (radius, radius))
    
    var_I = corr_I - mean_I * mean_I
    cov_Ip = corr_Ip - mean_I * mean_p
    
    a = cov_Ip / (var_I + eps)
    b = mean_p - a * mean_I
    
    mean_a = cv2.boxFilter(a, -1, (radius, radius))
    mean_b = cv2.boxFilter(b, -1, (radius, radius))
    
    q = mean_a * guide_gray + mean_b
    
    # Convert back to uint8
    result = np.clip(q * 255.0, 0, 255).astype(np.uint8)
    
    log_debug(f"[GUIDED FILTER] Applied with radius={radius}, eps={eps}")
    return result


def segment_at_scale(image: np.ndarray, scale: int, session) -> np.ndarray:
    """
    Run BiSeNet inference at a specific conceptual scale.
    
    BiSeNet ONNX model has fixed 512x512 input. To achieve multi-scale:
    1. Resize input image to target scale (e.g., 768, 1024)
    2. Then resize that to 512x512 for inference
    3. Resize segmentation result back to target scale
    4. Finally resize to original resolution
    
    Larger scales capture fine details (after upsampling) better because
    the 512x512 window covers a smaller physical area of the image.
    
    Args:
        image: Input BGR image at original resolution
        scale: Conceptual scale - image is resized to this before inference
        session: ONNX session
    
    Returns:
        Segmentation map at original resolution
    """
    original_h, original_w = image.shape[:2]
    
    # Step 1: Resize image to target scale (simulates different detail levels)
    # For scales > 512, this effectively zooms in on the center
    # For scale = 512, this is equivalent to standard processing
    if scale != 512:
        # Resize to target scale first
        scaled = cv2.resize(image, (scale, scale), interpolation=cv2.INTER_LINEAR)
        # Then resize to 512 for BiSeNet (model's fixed input size)
        resized = cv2.resize(scaled, (512, 512), interpolation=cv2.INTER_LINEAR)
    else:
        resized = cv2.resize(image, (512, 512), interpolation=cv2.INTER_LINEAR)
    
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    
    # ImageNet normalization
    normalized = rgb.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normalized = (normalized - mean) / std
    
    batched = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0)
    
    # Inference at fixed 512x512
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: batched})
    
    # Get segmentation map at 512x512
    seg_map_512 = np.argmax(outputs[0], axis=1)[0].astype(np.uint8)
    
    # Resize back through scale if needed, then to original
    if scale != 512:
        # First to target scale
        seg_map_scaled = cv2.resize(seg_map_512, (scale, scale), interpolation=cv2.INTER_NEAREST)
        # Then to original
        seg_map_full = cv2.resize(seg_map_scaled, (original_w, original_h), interpolation=cv2.INTER_NEAREST)
    else:
        seg_map_full = cv2.resize(seg_map_512, (original_w, original_h), interpolation=cv2.INTER_NEAREST)
    
    return seg_map_full


def segment_at_scale_segformer(image: np.ndarray, scale: int, session) -> np.ndarray:
    """
    Run SegFormer inference at a specific conceptual scale.
    
    SegFormer accepts dynamic input size but outputs at 1/4 resolution.
    Preserves aspect ratio by scaling longest edge to target scale.
    
    Args:
        image: Input BGR image at original resolution
        scale: Target size for longest edge
        session: SegFormer ONNX session
    
    Returns:
        Segmentation map at original resolution
    """
    original_h, original_w = image.shape[:2]
    
    # Preserve aspect ratio - scale longest edge to target scale
    if original_h > original_w:
        new_h = scale
        new_w = int(original_w * scale / original_h)
    else:
        new_w = scale
        new_h = int(original_h * scale / original_w)
    
    # Ensure dimensions are divisible by 4 (SegFormer requirement for clean upscaling)
    new_w = max(4, (new_w // 4) * 4)
    new_h = max(4, (new_h // 4) * 4)
    
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    
    # SegFormer uses ImageNet normalization
    normalized = rgb.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normalized = (normalized - mean) / std
    
    batched = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0)
    
    # Inference
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: batched})
    
    # SegFormer outputs at 1/4 resolution, need to upscale
    logits = outputs[0]  # (1, num_classes, H/4, W/4)
    seg_map_quarter = np.argmax(logits, axis=1)[0].astype(np.uint8)
    
    # Resize to original resolution
    seg_map_full = cv2.resize(seg_map_quarter, (original_w, original_h), interpolation=cv2.INTER_NEAREST)
    
    return seg_map_full


def multi_scale_segment_hair_segformer(image: np.ndarray, scales: list = [512, 768, 1024]) -> tuple:
    """
    Run multi-scale hair segmentation using SegFormer for improved accuracy.
    Same approach as BiSeNet but using SegFormer model.
    
    Args:
        image: Input BGR image
        scales: List of scales to run inference at
    
    Returns:
        Tuple of (hair_mask, facial_features_mask) as binary arrays
    """
    session = get_segformer_session()
    original_h, original_w = image.shape[:2]
    
    # Initialize vote counters
    hair_votes = np.zeros((original_h, original_w), dtype=np.float32)
    facial_votes = np.zeros((original_h, original_w), dtype=np.float32)
    
    # Run inference at each scale
    for scale in scales:
        seg_map = segment_at_scale_segformer(image, scale, session)
        
        # Accumulate hair votes
        hair_votes += (seg_map == HAIR_CLASS_ID).astype(np.float32)
        
        # Accumulate facial feature votes (eyes, eyebrows, nose, mouth, lips, neck)
        # Neck is included to prevent neck leakage into hair-only masks on some Kontext outputs.
        facial_mask = np.zeros_like(seg_map, dtype=np.float32)
        for class_id in [LEFT_EYE_ID, RIGHT_EYE_ID, LEFT_EYEBROW_ID, RIGHT_EYEBROW_ID,
                         NOSE_ID, UPPER_LIP_ID, LOWER_LIP_ID, MOUTH_ID, NECK_ID]:
            facial_mask += (seg_map == class_id).astype(np.float32)
        facial_votes += (facial_mask > 0).astype(np.float32)
    
    # Use majority voting (>= half the scales)
    threshold = len(scales) / 2
    hair_mask = (hair_votes >= threshold).astype(np.uint8)
    facial_features_mask = (facial_votes >= threshold).astype(np.uint8)
    
    log_debug(f"[SEGFORMER MULTI-SCALE] Scales: {scales}, hair pixels: {np.sum(hair_mask)}, facial pixels: {np.sum(facial_features_mask)}")
    
    return hair_mask, facial_features_mask


def segment_hair_focused_segformer(image: np.ndarray, face_crop_region: tuple = None, 
                                     scales: list = [512, 768, 1024]) -> tuple:
    """
    Run SegFormer hair segmentation focused on the face region for better accuracy.
    
    Same approach as BiSeNet's segment_hair_focused but using SegFormer model.
    Uses the face bounding box to:
    1. Crop the image to the face+hair region
    2. Run SegFormer on the focused crop
    3. Map the mask back to original coordinates
    
    Args:
        image: Input BGR image (full size)
        face_crop_region: (x, y, w, h) expanded face region from early_face_check
                         If None, falls back to full-image processing
        scales: SegFormer inference scales
    
    Returns:
        tuple: (hair_mask, facial_features_mask) at original image resolution
    """
    original_h, original_w = image.shape[:2]
    
    # If no face crop region, fall back to full-image processing
    if face_crop_region is None:
        log_debug("[SEGFORMER FOCUSED] No face crop region - using full image")
        return multi_scale_segment_hair_segformer(image, scales)
    
    crop_x, crop_y, crop_w, crop_h = face_crop_region
    
    # Validate crop region
    if crop_w < 100 or crop_h < 100:
        log_debug(f"[SEGFORMER FOCUSED] Crop region too small ({crop_w}x{crop_h}) - using full image")
        return multi_scale_segment_hair_segformer(image, scales)
    
    log_debug(f"[SEGFORMER FOCUSED] Using face-focused crop: ({crop_x}, {crop_y}) {crop_w}x{crop_h}")
    
    # Crop the image to the face region
    cropped_image = image[crop_y:crop_y+crop_h, crop_x:crop_x+crop_w]
    
    # Run multi-scale segmentation on the cropped region
    # Use smaller scales for the cropped region since it's already zoomed in
    focused_scales = [min(s, max(crop_w, crop_h)) for s in scales]
    focused_scales = [s for s in focused_scales if s >= 256]  # Minimum scale
    if not focused_scales:
        focused_scales = [512]
    
    log_debug(f"[SEGFORMER FOCUSED] Running SegFormer at scales: {focused_scales}")
    
    # Get masks for the cropped region
    cropped_hair_mask, cropped_facial_mask = multi_scale_segment_hair_segformer(cropped_image, focused_scales)
    
    # Map masks back to original image coordinates
    full_hair_mask = np.zeros((original_h, original_w), dtype=np.uint8)
    full_facial_mask = np.zeros((original_h, original_w), dtype=np.uint8)
    
    # Place the cropped masks in their original positions
    full_hair_mask[crop_y:crop_y+crop_h, crop_x:crop_x+crop_w] = cropped_hair_mask
    full_facial_mask[crop_y:crop_y+crop_h, crop_x:crop_x+crop_w] = cropped_facial_mask
    
    total_hair_pixels = np.sum(full_hair_mask)
    log_debug(f"[SEGFORMER FOCUSED] Result: {total_hair_pixels} hair pixels in focused region")
    
    return full_hair_mask, full_facial_mask


def multi_scale_segment_hair(image: np.ndarray, scales: list = [512, 768, 1024]) -> tuple:
    """
    Run multi-scale hair segmentation for improved accuracy.
    Runs BiSeNet at multiple resolutions and merges results.
    
    Higher resolutions capture fine details (flyaways, baby hairs).
    Lower resolutions provide robust overall shape.
    
    Args:
        image: Input BGR image
        scales: List of scales to run inference at (default: 512, 768, 1024)
    
    Returns:
        tuple: (merged_hair_mask, merged_facial_features_mask) at original resolution
    """
    session = get_session()
    original_h, original_w = image.shape[:2]
    
    log_debug(f"[MULTI-SCALE] Running segmentation at scales: {scales}")
    
    # Collect hair masks and facial feature masks from each scale
    hair_masks = []
    facial_masks = []
    
    for scale in scales:
        seg_map = segment_at_scale(image, scale, session)
        
        # Extract hair mask
        hair_mask = (seg_map == HAIR_CLASS_ID).astype(np.uint8)
        
        # Fallback: use hat class if hair is too small (common for locs/braids/waves)
        hair_pixels = np.sum(hair_mask)
        if hair_pixels < 1000:
            hat_mask = (seg_map == 18).astype(np.uint8)  # Hat class
            hat_pixels = np.sum(hat_mask)
            if hat_pixels > hair_pixels:
                log_debug(f"[MULTI-SCALE] Scale {scale}: Using hat class fallback ({hat_pixels} vs {hair_pixels} hair pixels)")
                hair_mask = hat_mask
        
        # Exclude ears from hair
        ear_mask = ((seg_map == LEFT_EAR_ID) | (seg_map == RIGHT_EAR_ID)).astype(np.uint8)
        hair_mask = hair_mask & (~ear_mask)
        
        hair_masks.append(hair_mask)
        
        # Extract facial features mask
        facial_mask = (
            (seg_map == LEFT_EYEBROW_ID) | 
            (seg_map == RIGHT_EYEBROW_ID) |
            (seg_map == LEFT_EYE_ID) |
            (seg_map == RIGHT_EYE_ID) |
            (seg_map == NOSE_ID) |
            (seg_map == LEFT_EAR_ID) |
            (seg_map == RIGHT_EAR_ID) |
            (seg_map == SKIN_CLASS_ID) |
            (seg_map == NECK_ID)
        ).astype(np.uint8)
        facial_masks.append(facial_mask)
        
        log_debug(f"[MULTI-SCALE] Scale {scale}: {np.sum(hair_mask)} hair pixels")
    
    # Merge masks using union approach (any scale detecting hair counts)
    # This is more inclusive for varied web images with unusual angles/compositions
    # Previous weighted voting was too strict (required 2+ scales to agree)
    
    # Union merge: include hair detected at ANY scale
    merged_hair = np.zeros((original_h, original_w), dtype=np.uint8)
    for mask in hair_masks:
        merged_hair = merged_hair | mask
    
    log_debug(f"[MULTI-SCALE] Hair union across all scales: {np.sum(merged_hair)} pixels")
    
    # Union for facial features (any scale detecting it counts)
    merged_facial = np.zeros((original_h, original_w), dtype=np.uint8)
    for mask in facial_masks:
        merged_facial = merged_facial | mask
    
    # Morphological cleanup on merged hair mask
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    merged_hair = cv2.morphologyEx(merged_hair, cv2.MORPH_OPEN, kernel)  # Remove noise
    merged_hair = cv2.morphologyEx(merged_hair, cv2.MORPH_CLOSE, kernel)  # Fill holes
    
    total_hair_pixels = np.sum(merged_hair)
    log_debug(f"[MULTI-SCALE] Merged result: {total_hair_pixels} hair pixels")
    
    return merged_hair, merged_facial


def expand_face_box_for_hair(face_box: tuple, img_h: int, img_w: int, 
                              top_expand: float = 0.8, side_expand: float = 0.3,
                              bottom_expand: float = 0.2) -> tuple:
    """
    Expand a face bounding box to include hair region above the head.
    
    Args:
        face_box: (x, y, w, h) face bounding box
        img_h, img_w: Original image dimensions
        top_expand: Fraction of face height to expand upward (default 0.8 = 80%)
        side_expand: Fraction of face width to expand on each side (default 0.3 = 30%)
        bottom_expand: Fraction of face height to expand downward (default 0.2 = 20%)
    
    Returns:
        (crop_x, crop_y, crop_w, crop_h) expanded region
    """
    x, y, w, h = face_box
    
    # Expand upward to capture hair (80% of face height)
    expand_top = int(h * top_expand)
    # Expand sides for wider hairstyles (30% of face width)
    expand_sides = int(w * side_expand)
    # Small bottom expansion for chin/neck (20% of face height)
    expand_bottom = int(h * bottom_expand)
    
    crop_x = max(0, x - expand_sides)
    crop_y = max(0, y - expand_top)
    crop_x2 = min(img_w, x + w + expand_sides)
    crop_y2 = min(img_h, y + h + expand_bottom)
    
    return (crop_x, crop_y, crop_x2 - crop_x, crop_y2 - crop_y)


def segment_hair_focused(image: np.ndarray, face_crop_region: tuple = None, 
                          scales: list = [512, 768, 1024]) -> tuple:
    """
    Run hair segmentation focused on the face region for better accuracy and speed.
    
    Uses the face bounding box from Ultra-Light detector to:
    1. Crop the image to the face+hair region
    2. Run BiSeNet on the focused crop
    3. Map the mask back to original coordinates
    
    This provides:
    - Better accuracy: BiSeNet focuses on the face/hair area
    - Faster processing: Smaller input region
    - Better hair capture: Expanded crop includes hair above head
    - Fewer false positives: Only detects hair near the face
    
    Args:
        image: Input BGR image (full size)
        face_crop_region: (x, y, w, h) expanded face region from early_face_check
                         If None, falls back to full-image processing
        scales: BiSeNet inference scales
    
    Returns:
        tuple: (hair_mask, facial_features_mask) at original image resolution
    """
    original_h, original_w = image.shape[:2]
    
    # If no face crop region, fall back to full-image processing
    if face_crop_region is None:
        log_debug("[FOCUSED] No face crop region - using full image")
        return multi_scale_segment_hair(image, scales)
    
    crop_x, crop_y, crop_w, crop_h = face_crop_region
    
    # Validate crop region
    if crop_w < 100 or crop_h < 100:
        log_debug(f"[FOCUSED] Crop region too small ({crop_w}x{crop_h}) - using full image")
        return multi_scale_segment_hair(image, scales)
    
    log_debug(f"[FOCUSED] Using face-focused crop: ({crop_x}, {crop_y}) {crop_w}x{crop_h}")
    
    # Crop the image to the face region
    cropped_image = image[crop_y:crop_y+crop_h, crop_x:crop_x+crop_w]
    
    # Run multi-scale segmentation on the cropped region
    # Use smaller scales for the cropped region since it's already zoomed in
    focused_scales = [min(s, max(crop_w, crop_h)) for s in scales]
    focused_scales = [s for s in focused_scales if s >= 256]  # Minimum scale
    if not focused_scales:
        focused_scales = [512]
    
    log_debug(f"[FOCUSED] Running BiSeNet at scales: {focused_scales}")
    
    # Get masks for the cropped region
    cropped_hair_mask, cropped_facial_mask = multi_scale_segment_hair(cropped_image, focused_scales)
    
    # Map masks back to original image coordinates
    full_hair_mask = np.zeros((original_h, original_w), dtype=np.uint8)
    full_facial_mask = np.zeros((original_h, original_w), dtype=np.uint8)
    
    # Place the cropped masks in their original positions
    full_hair_mask[crop_y:crop_y+crop_h, crop_x:crop_x+crop_w] = cropped_hair_mask
    full_facial_mask[crop_y:crop_y+crop_h, crop_x:crop_x+crop_w] = cropped_facial_mask
    
    total_hair_pixels = np.sum(full_hair_mask)
    log_debug(f"[FOCUSED] Result: {total_hair_pixels} hair pixels in focused region")
    
    return full_hair_mask, full_facial_mask


def segment_hair(image: np.ndarray, include_forehead: bool = False, 
                  forehead_extension: int = 80, above_hair: int = 20,
                  eyebrow_margin: int = 20, forehead_fraction: float = 0.5,
                  exclude_facial_features: bool = True) -> tuple:
    """Run BiSeNet inference to extract hair mask (optionally with forehead).
    
    Args:
        include_forehead: Whether to include forehead region
        forehead_extension: Pixels to extend below hair (stops before eyebrows)
        above_hair: Pixels to extend above the hair
        eyebrow_margin: Pixels to stop before eyebrows
        forehead_fraction: Fraction of forehead skin to include (0.0-1.0, from bottom up)
        exclude_facial_features: If True, return facial feature mask for later exclusion
    
    Returns:
        tuple: (hair_mask, facial_features_mask) - both at original resolution
               facial_features_mask is None if exclude_facial_features is False
    """
    session = get_session()
    original_h, original_w = image.shape[:2]
    
    # Preprocess: resize, normalize with ImageNet mean/std, transpose to NCHW
    resized = cv2.resize(image, (512, 512), interpolation=cv2.INTER_LINEAR)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    
    # CRITICAL: BiSeNet expects ImageNet normalization, not just 0-1 scaling
    # Without this, the model produces garbage masks
    normalized = rgb.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normalized = (normalized - mean) / std
    
    batched = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0)
    
    # Inference
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: batched})
    
    # Get full segmentation map
    seg_map = np.argmax(outputs[0], axis=1)[0]
    
    # Extract hair mask
    hair_mask = (seg_map == HAIR_CLASS_ID).astype(np.uint8)
    
    # Exclude ears from the mask
    ear_mask = ((seg_map == LEFT_EAR_ID) | (seg_map == RIGHT_EAR_ID)).astype(np.uint8)
    hair_mask = hair_mask & (~ear_mask)
    
    # Create facial features mask (to exclude AFTER dilation)
    # This prevents the buffer from including eyebrows, eyes, nose, etc.
    facial_features_mask_512 = None
    if exclude_facial_features:
        facial_features_mask_512 = (
            (seg_map == LEFT_EYEBROW_ID) | 
            (seg_map == RIGHT_EYEBROW_ID) |
            (seg_map == LEFT_EYE_ID) |
            (seg_map == RIGHT_EYE_ID) |
            (seg_map == NOSE_ID) |
            (seg_map == LEFT_EAR_ID) |
            (seg_map == RIGHT_EAR_ID) |
            (seg_map == SKIN_CLASS_ID)  # Exclude all skin/face
        ).astype(np.uint8)
    
    # Add pixels above hair
    if above_hair > 0:
        hair_rows = np.where(hair_mask.any(axis=1))[0]
        if len(hair_rows) > 0:
            hair_top = hair_rows[0]
            extend_top = max(0, hair_top - above_hair)
            # Extend upward for columns that have hair
            for col in range(512):
                col_hair_rows = np.where(hair_mask[:, col] == 1)[0]
                if len(col_hair_rows) > 0:
                    col_top = col_hair_rows[0]
                    new_top = max(0, col_top - above_hair)
                    hair_mask[new_top:col_top, col] = 1
    
    if include_forehead:
        # Get skin mask and eyebrow positions
        skin_mask = (seg_map == SKIN_CLASS_ID).astype(np.uint8)
        eyebrow_mask = ((seg_map == LEFT_EYEBROW_ID) | (seg_map == RIGHT_EYEBROW_ID)).astype(np.uint8)
        
        # Find the top of eyebrows (we stop before this)
        eyebrow_rows = np.where(eyebrow_mask.any(axis=1))[0]
        if len(eyebrow_rows) > 0:
            eyebrow_top = eyebrow_rows[0]
            # Stop 20px before eyebrows
            stop_line = max(0, eyebrow_top - eyebrow_margin)
            
            # Forehead = skin pixels ABOVE the stop line (limited by forehead_fraction)
            forehead_mask = np.zeros_like(skin_mask)
            # Find the top of skin in the forehead area
            skin_rows_above = np.where(skin_mask[:stop_line, :].any(axis=1))[0]
            if len(skin_rows_above) > 0:
                skin_top = skin_rows_above[0]
                forehead_height = stop_line - skin_top
                # Only include bottom fraction of forehead
                start_row = stop_line - int(forehead_height * forehead_fraction)
                forehead_mask[start_row:stop_line, :] = skin_mask[start_row:stop_line, :]
            
            # Also extend below hair using column-wise expansion
            hair_rows, hair_cols = np.where(hair_mask == 1)
            if len(hair_rows) > 0:
                # For each column, find the bottom of hair and extend downward
                for col in range(512):
                    col_hair = hair_rows[hair_cols == col]
                    if len(col_hair) > 0:
                        hair_bottom = col_hair.max()
                        # Extend down but stop before eyebrows
                        extend_to = min(hair_bottom + forehead_extension, stop_line)
                        forehead_mask[hair_bottom:extend_to, col] = 1
            
            # Combine hair + forehead
            hair_mask = np.clip(hair_mask + forehead_mask, 0, 1)
    
    # Convert to 0-255
    hair_mask = (hair_mask * 255).astype(np.uint8)
    
    # Resize masks back to original using INTER_LINEAR for smoother edges
    hair_mask_resized = cv2.resize(hair_mask, (original_w, original_h), interpolation=cv2.INTER_LINEAR)
    
    # Also resize facial features mask if we have one
    facial_features_mask = None
    if facial_features_mask_512 is not None:
        # Convert to 0-255 and resize
        facial_features_mask_512 = (facial_features_mask_512 * 255).astype(np.uint8)
        facial_features_mask = cv2.resize(facial_features_mask_512, (original_w, original_h), interpolation=cv2.INTER_NEAREST)
    
    return hair_mask_resized, facial_features_mask

def cleanup_mask(mask: np.ndarray, min_area_ratio: float = 0.001) -> np.ndarray:
    """Remove small islands and fill small holes in the mask.
    
    Args:
        mask: Binary mask (0 or 255)
        min_area_ratio: Minimum area as fraction of image size to keep
    """
    h, w = mask.shape
    min_area = int(h * w * min_area_ratio)
    
    # Morphological opening to remove small islands (noise)
    kernel_small = np.ones((3, 3), np.uint8)
    cleaned = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel_small)
    
    # Morphological closing to fill small holes
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel_small)
    
    # Remove small connected components (islands)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(cleaned, connectivity=8)
    
    # Keep only components larger than min_area
    output = np.zeros_like(cleaned)
    for i in range(1, num_labels):  # Skip background (label 0)
        area = stats[i, cv2.CC_STAT_AREA]
        if area >= min_area:
            output[labels == i] = 255
    
    return output


def smooth_contours(mask: np.ndarray, epsilon_ratio: float = 0.001) -> np.ndarray:
    """Smooth mask edges using contour approximation.
    
    Args:
        mask: Binary mask (0 or 255)
        epsilon_ratio: Smoothing factor (lower = more detail, higher = smoother)
    """
    h, w = mask.shape
    
    # Find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        return mask
    
    # Create output mask
    smoothed = np.zeros_like(mask)
    
    for contour in contours:
        # Calculate epsilon based on contour perimeter
        perimeter = cv2.arcLength(contour, True)
        epsilon = epsilon_ratio * perimeter
        
        # Approximate contour with fewer points (smoothing)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        
        # Draw filled contour
        cv2.drawContours(smoothed, [approx], -1, 255, -1)
    
    return smoothed


def refine_mask(mask: np.ndarray, dilation_kernel: int = 5, 
                dilation_iterations: int = 1, feather_size: int = 7,
                downward_only: bool = False,
                facial_features_mask: np.ndarray = None) -> np.ndarray:
    """Apply cleanup + smoothing + dilation + feathering + facial feature exclusion.
    
    Pipeline:
    1. Morphological cleanup (remove islands, fill holes)
    2. Contour smoothing (reduce jagged edges)
    3. Dilation (expand mask boundary)
    4. Exclude facial features (eyebrows, eyes, nose, ears, skin)
    5. Gaussian feathering (soft edges)
    
    Args:
        downward_only: If True, only dilate downward (toward face), not upward
        facial_features_mask: If provided, these regions will be excluded AFTER dilation
    """
    # Step 1: Cleanup - remove small islands and fill holes
    cleaned = cleanup_mask(mask)
    
    # Step 2: Smooth contours for cleaner edges
    smoothed = smooth_contours(cleaned)
    
    # Step 3: Dilation
    if downward_only and dilation_kernel > 1:
        # Find the top edge of the mask for each column BEFORE dilation
        h, w = smoothed.shape
        top_edges = np.full(w, h, dtype=np.int32)  # Default to bottom if no mask
        for col in range(w):
            mask_rows = np.where(smoothed[:, col] > 0)[0]
            if len(mask_rows) > 0:
                top_edges[col] = mask_rows[0]
        
        # Apply full dilation
        kernel = np.ones((dilation_kernel, dilation_kernel), np.uint8)
        dilated = cv2.dilate(smoothed, kernel, iterations=dilation_iterations)
        
        # Restore original top edges - zero out everything above the original top
        for col in range(w):
            if top_edges[col] < h:
                dilated[:top_edges[col], col] = 0
    else:
        # Standard symmetric dilation
        kernel = np.ones((dilation_kernel, dilation_kernel), np.uint8)
        dilated = cv2.dilate(smoothed, kernel, iterations=dilation_iterations)
    
    # Step 4: Exclude facial features AFTER dilation
    # This prevents the buffer from including eyebrows, eyes, nose, etc.
    if facial_features_mask is not None:
        # Zero out any pixels that overlap with facial features
        dilated = dilated.copy()
        dilated[facial_features_mask > 128] = 0
    
    # Step 5: Feathering for soft edges
    if feather_size % 2 == 0:
        feather_size += 1
    feathered = cv2.GaussianBlur(dilated, (feather_size, feather_size), 0)
    
    # Clamp
    return np.clip(feathered, 0, 255).astype(np.uint8)

def create_overlay(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Create debug overlay with hair region in red."""
    overlay = image.copy()
    hair_region = mask > 128
    overlay[hair_region] = [0, 0, 255]
    return cv2.addWeighted(image, 0.5, overlay, 0.5, 0)

def create_user_masked_image_raw(image: np.ndarray, face_crop_region: tuple = None, 
                                   return_masks: bool = False, include_neck: bool = True,
                                   gray_out_background: bool = False):
    """
    Create a RAW user masked image - shows face only, grays out hair and optionally background.
    Uses HYBRID approach: face-focused for accurate face + full-image for complete hair detection.
    
    NO buffer around face - just the face with nothing extra.
    
    Args:
        image: Input BGR image
        face_crop_region: (x, y, w, h) face crop region for focused processing (optional)
        return_masks: If True, return (output, hair_mask, facial_mask) for validation
        include_neck: If True, keep neck visible. If False, gray out neck too (default True)
        gray_out_background: If True, gray out background/clothes (default False - only grays hair)
    
    Returns:
        If return_masks=False: output image (np.ndarray)
        If return_masks=True: (output, hair_mask, facial_mask) tuple
    """
    log_debug(f"[USER MASK RAW] Starting HYBRID approach - NO buffer, just face (include_neck={include_neck}, gray_out_background={gray_out_background})")
    
    original_image = image.copy()
    original_h, original_w = image.shape[:2]
    log_debug(f"[USER MASK RAW] Image size: {original_w}x{original_h}")
    
    # STEP 1: Try to detect face for focused segmentation
    if face_crop_region is None:
        face_check = early_face_check(original_image)
        if face_check["face_found"] and face_check["crop_region"]:
            face_crop_region = face_check["crop_region"]
            log_debug(f"[USER MASK RAW] Detected face with crop region: {face_crop_region}")
    
    # STEP 2: HYBRID APPROACH - combine face-focused (for face) + full-image (for hair)
    if face_crop_region is not None:
        # Face-focused segmentation - better at finding the face accurately
        focused_hair_mask, focused_facial_mask = segment_hair_focused(image, face_crop_region, scales=[512, 768, 1024])
        focused_hair_pixels = np.sum(focused_hair_mask)
        log_debug(f"[USER MASK RAW] Face-focused: {focused_hair_pixels} hair pixels, {np.sum(focused_facial_mask)} facial pixels")
        
        # Full-image segmentation - better at finding ALL hair (including edges far from face)
        full_hair_mask, full_facial_mask = multi_scale_segment_hair(image, scales=[512, 768, 1024])
        full_hair_pixels = np.sum(full_hair_mask)
        log_debug(f"[USER MASK RAW] Full-image: {full_hair_pixels} hair pixels, {np.sum(full_facial_mask)} facial pixels")
        
        # COMBINE: Union of hair masks (catch all hair), but use focused facial mask (more accurate face)
        hair_mask = focused_hair_mask | full_hair_mask
        facial_mask = focused_facial_mask  # Face-focused gives more accurate face boundaries
        
        combined_hair_pixels = np.sum(hair_mask)
        log_debug(f"[USER MASK RAW] HYBRID result: {combined_hair_pixels} hair pixels (union of both)")
    else:
        # No face detected - use full-image only
        hair_mask, facial_mask = multi_scale_segment_hair(image, scales=[512, 768, 1024])
        log_debug(f"[USER MASK RAW] No face detected, using full-image only")
    
    hair_pixels = np.sum(hair_mask)
    log_debug(f"[USER MASK RAW] Final hair mask: {hair_pixels} pixels")
    
    # Get neck mask if we need to gray it out
    neck_mask = None
    if not include_neck:
        session = get_session()
        seg_map = segment_at_scale(image, 512, session)
        neck_mask = (seg_map == NECK_ID).astype(np.uint8)
        neck_pixels = np.sum(neck_mask)
        log_debug(f"[USER MASK RAW] Will gray out {neck_pixels} neck pixels")
    
    # Simple direct mask application - gray out hair, keep face (NO buffer)
    output = original_image.copy()
    # Gray out ALL hair - no buffer zone
    hair_to_gray = (hair_mask > 0)
    output[hair_to_gray] = GRAY_BG
    log_debug(f"[USER MASK RAW] Graying {np.sum(hair_to_gray)} hair pixels (preserving {np.sum((hair_mask > 0) & (facial_mask > 0))} within face buffer)")
    
    # Optionally gray out neck
    if neck_mask is not None:
        output[neck_mask > 0] = GRAY_BG
    
    # Optionally gray out background/clothes
    if gray_out_background:
        session = get_session()
        seg_map = segment_at_scale(image, 512, session)
        # Get all face-related classes to KEEP visible
        keep_visible = (
            (seg_map == SKIN_CLASS_ID) |  # Skin
            (seg_map == LEFT_EYE_ID) | (seg_map == RIGHT_EYE_ID) |  # Eyes
            (seg_map == LEFT_EYEBROW_ID) | (seg_map == RIGHT_EYEBROW_ID) |  # Eyebrows
            (seg_map == NOSE_ID) |  # Nose
            (seg_map == UPPER_LIP_ID) | (seg_map == LOWER_LIP_ID) | (seg_map == MOUTH_ID) |  # Lips/mouth
            (seg_map == LEFT_EAR_ID) | (seg_map == RIGHT_EAR_ID)  # Ears
        )
        if include_neck:
            keep_visible = keep_visible | (seg_map == NECK_ID)
        # Gray out everything not face-related (background, clothes, etc.)
        background_mask = ~keep_visible & (hair_mask == 0)  # Not face and not already hair
        output[background_mask] = GRAY_BG
        log_debug(f"[USER MASK RAW] Grayed out {np.sum(background_mask)} background/clothes pixels")
    
    visible_pixels = np.sum(output[:,:,0] != GRAY_BG[0])
    if gray_out_background:
        log_debug(f"[USER MASK RAW] Complete - FACE ONLY (hair+background grayed) - visible pixels: {visible_pixels}")
    else:
        log_debug(f"[USER MASK RAW] Complete - Hair grayed only - visible pixels: {visible_pixels}")
    
    if return_masks:
        return output, hair_mask, facial_mask
    return output


def create_hair_only_mask_raw(image: np.ndarray, return_masks: bool = False, face_crop_region: tuple = None,
                               hair_buffer_px: int = 40, sharpen: bool = True, blot_eyes: bool = True):
    """
    Create a RAW hair-only mask - shows hair with buffer, grays out face and everything else.
    Uses HYBRID approach: face-focused for accurate face detection + full-image for complete hair outline.
    
    Sharpens image before segmentation for more accurate hair detection.
    Expands hair mask by buffer_px to include surrounding area.
    Shows all detected hair without any cutoff.
    Always blots out eyes for privacy/consistency.
    
    Args:
        image: Input BGR image
        return_masks: If True, return (output, hair_mask, facial_mask) for validation
        face_crop_region: (x, y, w, h) face crop region for focused processing (optional)
        hair_buffer_px: Pixels to expand hair mask outward (default 40)
        sharpen: Whether to sharpen image before segmentation for better accuracy (default True)
        blot_eyes: Whether to always gray out eyes (default True)
    
    Returns:
        If return_masks=False: output image (np.ndarray)
        If return_masks=True: (output, hair_mask, facial_mask) tuple
    """
    log_debug(f"[HAIR ONLY RAW] Starting HYBRID approach - buffer={hair_buffer_px}px, sharpen={sharpen}")
    
    original_image = image.copy()
    original_h, original_w = image.shape[:2]
    log_debug(f"[HAIR ONLY RAW] Image size: {original_w}x{original_h}")
    
    # Sharpen image before segmentation for better hair edge detection
    # Sharpening increases local contrast, making fine hair strands more distinguishable
    if sharpen:
        image = sharpen_image(image, strength=1.0)
        log_debug(f"[HAIR ONLY RAW] Applied sharpening for better mask accuracy")
    
    # STEP 1: Try to detect face for focused segmentation
    if face_crop_region is None:
        face_check = early_face_check(original_image)  # Use original for face detection
        if face_check["face_found"] and face_check["crop_region"]:
            face_crop_region = face_check["crop_region"]
            log_debug(f"[HAIR ONLY RAW] Detected face with crop region: {face_crop_region}")
    
    # STEP 2: HYBRID APPROACH - combine face-focused (for face) + full-image (for hair)
    if face_crop_region is not None:
        # Face-focused segmentation - better at finding the face accurately
        focused_hair_mask, focused_facial_mask = segment_hair_focused(image, face_crop_region, scales=[512, 768, 1024])
        focused_hair_pixels = np.sum(focused_hair_mask)
        log_debug(f"[HAIR ONLY RAW] Face-focused: {focused_hair_pixels} hair pixels, {np.sum(focused_facial_mask)} facial pixels")
        
        # Full-image segmentation - better at finding ALL hair (including edges far from face)
        full_hair_mask, full_facial_mask = multi_scale_segment_hair(image, scales=[512, 768, 1024])
        full_hair_pixels = np.sum(full_hair_mask)
        log_debug(f"[HAIR ONLY RAW] Full-image: {full_hair_pixels} hair pixels, {np.sum(full_facial_mask)} facial pixels")
        
        # COMBINE: Union of hair masks (catch all hair), but use focused facial mask (more accurate face)
        hair_mask = focused_hair_mask | full_hair_mask
        facial_mask = focused_facial_mask  # Face-focused gives more accurate face boundaries
        
        combined_hair_pixels = np.sum(hair_mask)
        log_debug(f"[HAIR ONLY RAW] HYBRID result: {combined_hair_pixels} hair pixels (union of both)")
    else:
        # No face detected - use full-image only
        hair_mask, facial_mask = multi_scale_segment_hair(image, scales=[512, 768, 1024])
        log_debug(f"[HAIR ONLY RAW] No face detected, using full-image only")
    
    hair_pixels = np.sum(hair_mask)
    log_debug(f"[HAIR ONLY RAW] Final hair mask: {hair_pixels} pixels")
    
    # Get segmentation for eye/neck exclusion masks
    session = get_session()
    seg_map = segment_at_scale(original_image, 512, session)
    
    # Use full hair mask without any cutoff - show all detected hair
    hair_mask_visible = hair_mask
    log_debug(f"[HAIR ONLY RAW] Using full hair mask without cutoff, pixels: {np.sum(hair_mask)}")
    
    # Remove neck from visible hair region before buffer expansion.
    # This directly prevents neck-only leaks when Stage 1 output confuses boundaries.
    neck_mask = (seg_map == NECK_ID).astype(np.uint8)
    if np.sum(neck_mask) > 0:
        hair_mask_visible = hair_mask_visible & (~neck_mask)
        log_debug(f"[HAIR ONLY RAW] Excluded {np.sum(neck_mask)} neck pixels from visible hair mask")

    # Expand hair mask by buffer_px for softer edges and better blending
    if hair_buffer_px > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (hair_buffer_px * 2 + 1, hair_buffer_px * 2 + 1))
        expanded_hair_mask = cv2.dilate(hair_mask_visible, kernel, iterations=1)
        
        # IMPORTANT: Subtract facial mask to prevent buffer bleeding into face
        # The buffer should expand outward (background) but NOT into facial features
        expanded_hair_mask = expanded_hair_mask & ~facial_mask
        # Also keep neck excluded after expansion
        expanded_hair_mask = expanded_hair_mask & (~neck_mask)
        
        buffer_pixels = np.sum(expanded_hair_mask) - np.sum(hair_mask_visible)
        log_debug(f"[HAIR ONLY RAW] Expanded hair mask by {hair_buffer_px}px buffer (+{buffer_pixels} pixels, face excluded)")
    else:
        expanded_hair_mask = hair_mask_visible
    
    # Show hair + buffer area, gray out everything else (including face)
    # Use ORIGINAL image pixels (not sharpened) for output quality
    output = np.full_like(original_image, GRAY_BG)
    output[expanded_hair_mask > 0] = original_image[expanded_hair_mask > 0]
    
    # Always blot out eyes for privacy/consistency
    if blot_eyes:
        eye_mask = ((seg_map == LEFT_EYE_ID) | (seg_map == RIGHT_EYE_ID)).astype(np.uint8)
        eye_pixels = np.sum(eye_mask > 0)
        if eye_pixels > 0:
            output[eye_mask > 0] = GRAY_BG
            log_debug(f"[HAIR ONLY RAW] Blotted out {eye_pixels} eye pixels")
    
    visible_pixels = np.sum((output[:,:,0] != GRAY_BG[0]) | (output[:,:,1] != GRAY_BG[1]) | (output[:,:,2] != GRAY_BG[2]))
    log_debug(f"[HAIR ONLY RAW] Complete - HAIR ONLY with {hair_buffer_px}px buffer - visible pixels: {visible_pixels}")
    
    if return_masks:
        return output, hair_mask, facial_mask
    return output


def create_hair_only_mask_kontext(image: np.ndarray, return_masks: bool = False,
                                   hair_buffer_px: int = 30, blot_eyes: bool = False):
    """
    BRAND-NEW Kontext-specific hair-only mask pipeline.

    Goal:
      Gray out everything except:
        1) detected hair
        2) a fixed 30px buffer around detected hair

    This pipeline is isolated from other modes and only used for Kontext outputs.
    """
    log_debug(f"[HAIR ONLY KONTEXT V2] Starting new pipeline - buffer={hair_buffer_px}px")

    original = image.copy()
    h, w = image.shape[:2]
    session = get_session()

    # 1) Multi-scale hair votes using BiSeNet classes:
    #    class 17 = hair, class 18 = hat fallback (often captures braids/locs/waves).
    scales = [512, 768, 1024]
    hair_votes = np.zeros((h, w), dtype=np.float32)

    for scale in scales:
        seg_map = segment_at_scale(original, scale, session)
        hair_like = ((seg_map == HAIR_CLASS_ID) | (seg_map == 18)).astype(np.float32)
        hair_votes += hair_like

    # Keep any pixel classified as hair-like by at least one scale.
    hair_seed = (hair_votes >= 1.0).astype(np.uint8)

    # 2) Clean noise while keeping fine strands.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    hair_seed = cv2.morphologyEx(hair_seed, cv2.MORPH_OPEN, kernel)
    hair_seed = cv2.morphologyEx(hair_seed, cv2.MORPH_CLOSE, kernel)

    # 3) Spatial filtering to avoid neck-only components.
    # Prefer components near detected face/head region when face is found.
    face_info = early_face_check(original)
    if np.sum(hair_seed) > 0:
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(hair_seed, connectivity=8)
        filtered = np.zeros_like(hair_seed, dtype=np.uint8)

        if face_info.get("face_found") and face_info.get("faces"):
            fx, fy, fw, fh = face_info["faces"][0]["bbox"]
            x_min = max(0, fx - int(0.9 * fw))
            x_max = min(w - 1, fx + fw + int(0.9 * fw))
            y_max = min(h - 1, fy + int(1.15 * fh))
            y_min = max(0, fy - int(1.2 * fh))

            for i in range(1, num_labels):
                area = stats[i, cv2.CC_STAT_AREA]
                top = stats[i, cv2.CC_STAT_TOP]
                left = stats[i, cv2.CC_STAT_LEFT]
                width_i = stats[i, cv2.CC_STAT_WIDTH]
                cx = left + width_i // 2
                if area < 180:
                    continue
                if cx < x_min or cx > x_max:
                    continue
                if top > y_max or top < y_min:
                    continue
                filtered[labels == i] = 1
        else:
            # Generic upper-region prior if no face found.
            upper_limit = int(h * 0.80)
            for i in range(1, num_labels):
                area = stats[i, cv2.CC_STAT_AREA]
                top = stats[i, cv2.CC_STAT_TOP]
                if area >= 180 and top <= upper_limit:
                    filtered[labels == i] = 1

        # If filtering removes everything, keep original seed to avoid all-gray failure.
        if np.sum(filtered) > 0:
            hair_seed = filtered

    # 4) Build fixed buffer around hair seed.
    if hair_buffer_px > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (hair_buffer_px * 2 + 1, hair_buffer_px * 2 + 1))
        visible = cv2.dilate(hair_seed, k, iterations=1)
    else:
        visible = hair_seed.copy()

    # 5) Render: gray everything except hair + buffer.
    output = np.full_like(original, GRAY_BG)
    output[visible > 0] = original[visible > 0]

    # Optional eye blotting if explicitly requested.
    if blot_eyes:
        seg_map_512 = segment_at_scale(original, 512, session)
        eye_mask = ((seg_map_512 == LEFT_EYE_ID) | (seg_map_512 == RIGHT_EYE_ID))
        output[eye_mask] = GRAY_BG

    log_debug(f"[HAIR ONLY KONTEXT V2] Complete - seed={np.sum(hair_seed)} visible={np.sum(visible)}")

    if return_masks:
        # facial-like mask for validation consistency (used only as a sanity metric)
        facial_like = np.zeros_like(hair_seed, dtype=np.uint8)
        return output, hair_seed, facial_like
    return output


def create_user_masked_image(image: np.ndarray, face_buffer_px: int = 25, sharpen: bool = True, 
                              use_multi_scale: bool = False, use_guided_filter: bool = True,
                              return_masks: bool = False, hairline_visible_px: int = 20,
                              face_crop_region: tuple = None, include_neck: bool = True,
                              use_raw: bool = True, gray_out_background: bool = True):
    """
    Create a user masked image showing the face with hair grayed out.
    This is input_image_2 for FLUX - shows FLUX what face to preserve.
    
    Args:
        image: Input BGR image
        face_buffer_px: Pixels to expand the face mask outward (default 25px) - IGNORED if use_raw=True
        sharpen: Whether to apply sharpening for mask detection - IGNORED if use_raw=True
        use_multi_scale: Use multi-scale segmentation for better accuracy - IGNORED if use_raw=True (always multi-scale)
        use_guided_filter: Use guided filter for edge-aware refinement - IGNORED if use_raw=True
        return_masks: If True, return (output, face_mask, features_mask) for validation
        hairline_visible_px: Pixels of hair to show above the hairline - IGNORED if use_raw=True
        face_crop_region: (x, y, w, h) face crop region for focused processing (optional)
        include_neck: Whether to include neck in the visible area
        use_raw: If True, use simple raw mask application (default True - recommended)
        gray_out_background: If True, gray out background/clothes (default True)
    
    Returns:
        If return_masks=False: output image (np.ndarray)
        If return_masks=True: (output, face_mask, features_mask) tuple
    """
    # Use raw mode by default - simple, accurate, no post-processing
    if use_raw:
        # No buffer - just the face with nothing extra (hybrid approach)
        return create_user_masked_image_raw(image, face_crop_region, return_masks, include_neck, gray_out_background)
    
    # Legacy processed mode (kept for backward compatibility)
    log_debug(f"[USER MASK] Starting LEGACY mode - face_buffer={face_buffer_px}px, sharpen={sharpen}, multi_scale={use_multi_scale}, guided_filter={use_guided_filter}, include_neck={include_neck}")
    
    # Keep original for guided filter AND for final output (unsharpened pixels)
    original_image = image.copy()
    
    # Apply sharpening for better mask detection, but output will use original pixels
    if sharpen:
        image = sharpen_image(image, strength=1.0)
        log_debug(f"[USER MASK] Applied sharpening for mask detection (output uses original pixels)")
    
    original_h, original_w = image.shape[:2]
    log_debug(f"[USER MASK] Image size: {original_w}x{original_h}")
    
    if use_multi_scale:
        # Use focused segmentation if face crop region is available
        if face_crop_region is not None:
            log_debug(f"[USER MASK] Using face-focused segmentation with crop region: {face_crop_region}")
            hair_mask, facial_features_mask = segment_hair_focused(image, face_crop_region, scales=[512, 768, 1024])
        else:
            hair_mask, facial_features_mask = multi_scale_segment_hair(image, scales=[512, 768, 1024])
        
        # Apply guided filter to refine hair mask edges
        if use_guided_filter:
            hair_mask_255 = (hair_mask * 255).astype(np.uint8)
            refined_hair = guided_filter(original_image, hair_mask_255, radius=8, eps=0.01)
            hair_mask = (refined_hair > 128).astype(np.uint8)
            log_debug(f"[USER MASK] Applied guided filter refinement")
        
        # Get skin mask from single-scale (facial features are less critical)
        session = get_session()
        seg_map = segment_at_scale(image, 512, session)
        skin_mask = (seg_map == SKIN_CLASS_ID).astype(np.uint8)
    else:
        # Original single-scale approach
        session = get_session()
        resized = cv2.resize(image, (512, 512), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        normalized = rgb.astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        normalized = (normalized - mean) / std
        batched = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0)
        
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: batched})
        seg_map = np.argmax(outputs[0], axis=1)[0]
        
        seg_map_full = cv2.resize(seg_map.astype(np.uint8), (original_w, original_h), 
                                   interpolation=cv2.INTER_NEAREST)
        
        hair_mask = (seg_map_full == HAIR_CLASS_ID).astype(np.uint8)
        skin_mask = (seg_map_full == SKIN_CLASS_ID).astype(np.uint8)
        seg_map = seg_map_full
        
        # Apply guided filter to refine hair mask edges (single-scale path)
        if use_guided_filter:
            hair_mask_255 = (hair_mask * 255).astype(np.uint8)
            refined_hair = guided_filter(original_image, hair_mask_255, radius=8, eps=0.01)
            hair_mask = (refined_hair > 128).astype(np.uint8)
            log_debug(f"[USER MASK] Applied guided filter refinement")
    
    # Get seg_map for facial features extraction (use 512 scale)
    session = get_session()
    seg_map_full = segment_at_scale(image, 512, session)
    
    # Get ear masks - INCLUDE ears in the visible face area
    ear_mask = ((seg_map_full == LEFT_EAR_ID) | (seg_map_full == RIGHT_EAR_ID)).astype(np.uint8)
    ear_pixels = np.sum(ear_mask)
    log_debug(f"[USER MASK] Ear pixels detected: {ear_pixels}")
    
    # Get neck mask - will be limited to face bounds later
    neck_mask_raw = (seg_map_full == NECK_ID).astype(np.uint8)
    neck_pixels_raw = np.sum(neck_mask_raw)
    log_debug(f"[USER MASK] Neck pixels detected (raw): {neck_pixels_raw}")
    
    # Get facial feature masks
    eye_mask = ((seg_map_full == LEFT_EYE_ID) | (seg_map_full == RIGHT_EYE_ID)).astype(np.uint8)
    eyebrow_mask = ((seg_map_full == LEFT_EYEBROW_ID) | (seg_map_full == RIGHT_EYEBROW_ID)).astype(np.uint8)
    nose_mask = (seg_map_full == NOSE_ID).astype(np.uint8)
    lip_mask = ((seg_map_full == UPPER_LIP_ID) | (seg_map_full == LOWER_LIP_ID) | (seg_map_full == MOUTH_ID)).astype(np.uint8)
    
    # Combine all facial features for BiSeNet-based refinement
    features_mask = eye_mask | eyebrow_mask | nose_mask | lip_mask
    
    # Get BiSeNet feature bounds (may be used to refine Ultra-Light bounds)
    feature_rows = np.where(features_mask.any(axis=1))[0]
    feature_cols = np.where(features_mask.any(axis=0))[0]
    feature_pixels = np.sum(features_mask)
    
    # STRATEGY: Use Ultra-Light face detector as PRIMARY source, BiSeNet features to REFINE
    # Ultra-Light is more reliable for face localization, BiSeNet for feature details
    
    if face_crop_region is not None:
        # PRIMARY: Use Ultra-Light face detector bounds (most reliable for face localization)
        crop_x, crop_y, crop_w, crop_h = face_crop_region
        
        # Start with Ultra-Light bounds
        ul_forehead_top = max(0, crop_y)
        ul_chin_cutoff = min(crop_y + crop_h, original_h - 1)
        ul_face_left = max(0, crop_x)
        ul_face_right = min(crop_x + crop_w, original_w - 1)
        
        log_debug(f"[USER MASK] Ultra-Light bounds: rows {ul_forehead_top}-{ul_chin_cutoff}, cols {ul_face_left}-{ul_face_right}")
        
        # REFINE with BiSeNet if it detected features (combine best of both)
        if len(feature_rows) > 0 and len(feature_cols) > 0 and feature_pixels >= 200:
            bs_feat_top = feature_rows[0]
            bs_feat_bottom = feature_rows[-1]
            bs_feat_left = feature_cols[0]
            bs_feat_right = feature_cols[-1]
            
            # Calculate face height from BiSeNet features for adaptive extensions
            bs_face_height = bs_feat_bottom - bs_feat_top
            
            # Use BiSeNet to refine vertical bounds (better chin/forehead detection)
            # Extend chin by 50% of BiSeNet face height
            bs_chin_extension = max(int(bs_face_height * 0.50), 80)
            bs_chin_cutoff = min(bs_feat_bottom + bs_chin_extension, original_h - 1)
            
            # Extend forehead by 40% of BiSeNet face height  
            bs_forehead_extension = max(int(bs_face_height * 0.40), 60)
            bs_forehead_top = max(0, bs_feat_top - bs_forehead_extension)
            
            # Horizontal: expand BiSeNet bounds for cheeks/ears
            bs_face_width = bs_feat_right - bs_feat_left
            bs_face_margin = int(bs_face_width * 0.5)
            bs_face_left = max(0, bs_feat_left - bs_face_margin)
            bs_face_right = min(original_w - 1, bs_feat_right + bs_face_margin)
            
            # COMBINE: Take the UNION of Ultra-Light and BiSeNet bounds (most inclusive)
            forehead_top = min(ul_forehead_top, bs_forehead_top)
            chin_cutoff = max(ul_chin_cutoff, bs_chin_cutoff)
            face_left = min(ul_face_left, bs_face_left)
            face_right = max(ul_face_right, bs_face_right)
            feat_top = bs_feat_top  # Used for neck calculation
            
            log_debug(f"[USER MASK] Combined bounds (UL + BiSeNet): rows {forehead_top}-{chin_cutoff}, cols {face_left}-{face_right} (BiSeNet: {feature_pixels}px)")
        else:
            # BiSeNet didn't detect enough features - use only Ultra-Light bounds
            forehead_top = ul_forehead_top
            chin_cutoff = ul_chin_cutoff
            face_left = ul_face_left
            face_right = ul_face_right
            feat_top = forehead_top
            
            log_debug(f"[USER MASK] Using Ultra-Light bounds only (BiSeNet features: {feature_pixels}px)")
    
    elif len(feature_rows) > 0 and len(feature_cols) > 0 and feature_pixels >= 500:
        # FALLBACK: No Ultra-Light bounds, use BiSeNet features only
        feat_top = feature_rows[0]
        feat_bottom = feature_rows[-1]
        feat_left = feature_cols[0]
        feat_right = feature_cols[-1]
        
        face_height = feat_bottom - feat_top
        chin_extension = max(int(face_height * 0.50), 80)
        chin_cutoff = min(feat_bottom + chin_extension, original_h - 1)
        forehead_extension = max(int(face_height * 0.40), 60)
        forehead_top = max(0, feat_top - forehead_extension)
        face_width = feat_right - feat_left
        face_margin = int(face_width * 0.5)
        face_left = max(0, feat_left - face_margin)
        face_right = min(original_w - 1, feat_right + face_margin)
        
        log_debug(f"[USER MASK] Face bounds from BiSeNet only: rows {forehead_top}-{chin_cutoff}, cols {face_left}-{face_right}")
    else:
        # Last resort fallback: use center of image
        feat_top = int(original_h * 0.15)
        chin_cutoff = int(original_h * 0.70)
        forehead_top = feat_top
        face_left = int(original_w * 0.15)
        face_right = int(original_w * 0.85)
        log_debug(f"[USER MASK] FALLBACK face bounds (center of image)")
    
    # Isolate face skin: only skin within face bounds
    face_skin_mask = skin_mask.copy()
    face_skin_mask[:forehead_top, :] = 0  # Remove skin above forehead
    face_skin_mask[chin_cutoff:, :] = 0  # Remove skin below chin
    face_skin_mask[:, :face_left] = 0  # Remove skin left of face
    face_skin_mask[:, face_right:] = 0  # Remove skin right of face
    
    # Limit neck to face bounds - prevent showing shoulders/chest
    # Allow neck to extend 30% further than chin for natural transition
    neck_cutoff = min(chin_cutoff + int((chin_cutoff - feat_top) * 0.30), original_h - 1)
    neck_mask = neck_mask_raw.copy()
    neck_mask[neck_cutoff:, :] = 0  # Remove neck below cutoff
    neck_mask[:, :face_left] = 0  # Remove neck left of face
    neck_mask[:, face_right:] = 0  # Remove neck right of face
    neck_pixels = np.sum(neck_mask)
    log_debug(f"[USER MASK] Neck pixels after bounds limit: {neck_pixels} (cutoff y={neck_cutoff})")
    
    # Find the largest connected component in face skin (eliminates stray pixels)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(face_skin_mask, connectivity=8)
    if num_labels > 1:
        # Find largest component (excluding background at label 0)
        largest_label = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        face_skin_mask = (labels == largest_label).astype(np.uint8)
    
    # Morphological close to fill holes in face
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    face_skin_mask = cv2.morphologyEx(face_skin_mask, cv2.MORPH_CLOSE, close_kernel)
    
    # Apply face buffer - dilate the face mask to expand visible face area
    if face_buffer_px > 0:
        buffer_kernel_size = face_buffer_px * 2 + 1
        buffer_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (buffer_kernel_size, buffer_kernel_size))
        face_skin_mask = cv2.dilate(face_skin_mask, buffer_kernel, iterations=1)
        log_debug(f"[USER MASK] Applied {face_buffer_px}px face buffer")
    
    # Create output image - start with gray background
    # IMPORTANT: Use original_image (unsharpened) for the output pixels sent to FLUX
    output = np.full_like(original_image, GRAY_BG, dtype=np.uint8)
    
    # Layer 1: Show isolated face skin (with buffer) - using ORIGINAL unsharpened pixels
    output[face_skin_mask > 0] = original_image[face_skin_mask > 0]
    
    # Layer 2: Show facial features (eyes, eyebrows, nose, lips) - using ORIGINAL unsharpened pixels
    output[features_mask > 0] = original_image[features_mask > 0]
    
    # Layer 3: Show ears if visible - CRITICAL for natural look - using ORIGINAL unsharpened pixels
    if ear_pixels > 0:
        output[ear_mask > 0] = original_image[ear_mask > 0]
        log_debug(f"[USER MASK] Added {ear_pixels} ear pixels to visible area")
    
    # Layer 4: Show neck - using ORIGINAL unsharpened pixels (only if include_neck=True)
    if include_neck and neck_pixels > 0:
        output[neck_mask > 0] = original_image[neck_mask > 0]
        log_debug(f"[USER MASK] Added {neck_pixels} neck pixels to visible area")
    elif not include_neck:
        log_debug(f"[USER MASK] Skipping neck (include_neck=False)")
    
    # Layer 5: Show hair border using dilation - extend face mask into hair by hairline_visible_px
    # Combine face + features + ears + neck (if included) into one mask, then dilate to extend into hair
    combined_face_mask = np.zeros_like(hair_mask, dtype=np.uint8)
    combined_face_mask[face_skin_mask > 0] = 1
    combined_face_mask[features_mask > 0] = 1
    if ear_pixels > 0:
        combined_face_mask[ear_mask > 0] = 1
    if include_neck and neck_pixels > 0:
        combined_face_mask[neck_mask > 0] = 1
    
    # Dilate the combined face mask to extend into hair border
    if hairline_visible_px > 0:
        hair_border_kernel_size = hairline_visible_px * 2 + 1
        hair_border_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (hair_border_kernel_size, hair_border_kernel_size))
        dilated_face = cv2.dilate(combined_face_mask, hair_border_kernel, iterations=1)
        
        # Hair border = dilated face area that overlaps with hair
        hair_border_mask = (dilated_face > 0) & (hair_mask > 0)
        hair_border_pixels = np.sum(hair_border_mask)
        
        # Show the hair border pixels (original pixels)
        output[hair_border_mask] = original_image[hair_border_mask]
        log_debug(f"[USER MASK] Showing {hair_border_pixels} hair border pixels ({hairline_visible_px}px into hair)")
    else:
        hair_border_mask = np.zeros_like(hair_mask, dtype=bool)
    
    # Gray out remaining hair that's not in the border
    hair_to_gray = (hair_mask > 0) & (~hair_border_mask)
    
    # Gray out the rest of the hair
    output[hair_to_gray] = GRAY_BG
    
    visible_pixels = np.sum(output[:,:,0] != GRAY_BG[0])
    log_debug(f"[USER MASK] Complete - visible pixels: {visible_pixels} (using original unsharpened pixels)")
    
    if return_masks:
        # Return masks for validation - face_skin_mask (visible face area) and features_mask
        return output, face_skin_mask, features_mask
    return output

def create_hair_only_mask(image: np.ndarray, buffer_px: int = 25, sharpen: bool = True,
                           use_multi_scale: bool = False, use_guided_filter: bool = True,
                           return_masks: bool = False):
    """
    Create a hair-only reference mask for FLUX (input_image_3).
    
    Priority order:
      1. PRIMARY: Detect hair and create buffer around it
      2. SECONDARY: Blot out non-hair body parts (face, skin, beard, neck, ears) with gray
    
    This works for any image - even those without visible faces (common in web search results).
    
    Args:
        image: Input BGR image
        buffer_px: Pixels to expand the hair mask (default 25)
        sharpen: Whether to apply sharpening before masking (default True)
                 Note: Sharpened pixels are kept in the output
        use_multi_scale: Use multi-scale segmentation for better accuracy (default True)
        use_guided_filter: Use guided filter for edge-aware refinement (default True)
        return_masks: If True, return (output, hair_mask, facial_mask) for validation
    
    Returns:
        If return_masks=False: output image (np.ndarray)
        If return_masks=True: (output, hair_mask, facial_mask) tuple
    """
    log_debug(f"[HAIR ONLY] Starting - buffer={buffer_px}px, sharpen={sharpen}, multi_scale={use_multi_scale}, guided_filter={use_guided_filter}")
    
    # Keep original for guided filter
    original_image = image.copy()
    
    # Apply sharpening before mask generation - sharpened pixels will be kept in output
    if sharpen:
        image = sharpen_image(image, strength=1.0)
        log_debug(f"[HAIR ONLY] Applied sharpening (will be kept in output)")
    
    original_h, original_w = image.shape[:2]
    log_debug(f"[HAIR ONLY] Image size: {original_w}x{original_h}")
    
    if use_multi_scale:
        # Use multi-scale segmentation for better hair detection
        hair_mask, ms_facial_mask = multi_scale_segment_hair(image, scales=[512, 768, 1024])
        
        hair_pixels_before_filter = np.sum(hair_mask)
        log_debug(f"[HAIR ONLY] Multi-scale raw hair pixels: {hair_pixels_before_filter}")
        
        # Apply guided filter to refine hair mask edges (but only if we have enough hair pixels)
        # For very small hair regions (fades, waves), skip guided filter to preserve detection
        if use_guided_filter and hair_pixels_before_filter > 5000:
            hair_mask_255 = (hair_mask * 255).astype(np.uint8)
            refined_hair = guided_filter(original_image, hair_mask_255, radius=8, eps=0.01)
            hair_mask = (refined_hair > 128).astype(np.uint8)
            log_debug(f"[HAIR ONLY] Applied guided filter refinement")
        elif hair_pixels_before_filter <= 5000:
            log_debug(f"[HAIR ONLY] Skipping guided filter (hair region too small: {hair_pixels_before_filter}px)")
        
        hair_pixels = np.sum(hair_mask)
        log_debug(f"[HAIR ONLY] Multi-scale hair pixels after filter: {hair_pixels}")
        
        # Get detailed facial features from 512 scale for precise blotting
        # (multi-scale facial mask includes skin which we don't want to blot)
        session = get_session()
        seg_map_full = segment_at_scale(image, 512, session)
        
        # Log facial feature detection for debugging
        ms_facial_pixels = np.sum(ms_facial_mask)
        log_debug(f"[HAIR ONLY] Multi-scale facial features: {ms_facial_pixels} pixels")
    else:
        # Original single-scale approach
        session = get_session()
        resized = cv2.resize(image, (512, 512), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        normalized = rgb.astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        normalized = (normalized - mean) / std
        batched = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0)
        
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: batched})
        seg_map = np.argmax(outputs[0], axis=1)[0]
        
        seg_map_full = cv2.resize(seg_map.astype(np.uint8), (original_w, original_h), 
                                   interpolation=cv2.INTER_NEAREST)
        
        # PRIMARY: Create hair mask with buffer
        # Note: BiSeNet sometimes classifies certain hairstyles (waves, locs, braids) as "hat" (class 18)
        # We use class 18 as fallback if no hair is detected in class 17
        HAT_CLASS_ID = 18
        
        hair_mask = (seg_map_full == HAIR_CLASS_ID).astype(np.uint8)
        hair_pixels = np.sum(hair_mask)
        log_debug(f"[HAIR ONLY] Class 17 (hair) pixels: {hair_pixels}")
        
        # Fallback: If no hair detected, check class 18 (hat/cloth) which often catches waves/locs/braids
        if hair_pixels < 1000:  # Threshold for "no meaningful hair detected"
            hat_mask = (seg_map_full == HAT_CLASS_ID).astype(np.uint8)
            hat_pixels = np.sum(hat_mask)
            log_debug(f"[HAIR ONLY] Class 18 (hat fallback) pixels: {hat_pixels}")
            
            if hat_pixels > hair_pixels:
                log_debug(f"[HAIR ONLY] Using class 18 as hair (waves/locs/braids detected)")
                hair_mask = hat_mask
                hair_pixels = hat_pixels
        
        log_debug(f"[HAIR ONLY] Final hair pixels: {hair_pixels}")
        
        # Apply guided filter to refine hair mask edges (single-scale path)
        if use_guided_filter:
            hair_mask_255 = (hair_mask * 255).astype(np.uint8)
            refined_hair = guided_filter(original_image, hair_mask_255, radius=8, eps=0.01)
            hair_mask = (refined_hair > 128).astype(np.uint8)
            log_debug(f"[HAIR ONLY] Applied guided filter refinement")
    
    # Get all facial feature masks to blot out (including skin/beard/neck)
    eye_mask = ((seg_map_full == LEFT_EYE_ID) | (seg_map_full == RIGHT_EYE_ID)).astype(np.uint8)
    eyebrow_mask = ((seg_map_full == LEFT_EYEBROW_ID) | (seg_map_full == RIGHT_EYEBROW_ID)).astype(np.uint8)
    nose_mask = (seg_map_full == NOSE_ID).astype(np.uint8)
    ear_mask = ((seg_map_full == LEFT_EAR_ID) | (seg_map_full == RIGHT_EAR_ID)).astype(np.uint8)
    lip_mask = ((seg_map_full == UPPER_LIP_ID) | (seg_map_full == LOWER_LIP_ID) | (seg_map_full == MOUTH_ID)).astype(np.uint8)
    # Include skin (class 1) which covers the face including beards/facial hair
    skin_mask = (seg_map_full == SKIN_CLASS_ID).astype(np.uint8)
    # Include neck (class 14) to blot out non-hair body parts
    neck_mask = (seg_map_full == NECK_ID).astype(np.uint8)
    
    # Combine all non-hair body parts to blot (face, skin, beard, neck, ears)
    all_facial_features = eye_mask | eyebrow_mask | nose_mask | ear_mask | lip_mask | skin_mask | neck_mask
    feature_pixels = np.sum(all_facial_features)
    skin_pixels = np.sum(skin_mask)
    neck_pixels = np.sum(neck_mask)
    log_debug(f"[HAIR ONLY] Body parts to blot: {feature_pixels} pixels (skin/beard: {skin_pixels}, neck: {neck_pixels})")
    
    # Morphological operations for cleaner hair mask
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    hair_closed = cv2.morphologyEx(hair_mask, cv2.MORPH_CLOSE, close_kernel)
    
    # Dilate hair mask to create buffer
    if buffer_px > 0:
        kernel_size = buffer_px * 2 + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        hair_with_buffer = cv2.dilate(hair_closed, kernel, iterations=1)
    else:
        hair_with_buffer = hair_closed
    
    buffered_pixels = np.sum(hair_with_buffer)
    log_debug(f"[HAIR ONLY] Hair pixels after {buffer_px}px buffer: {buffered_pixels}")
    
    # Find hair bounds
    hair_rows = np.where(hair_with_buffer > 0)[0]
    hair_cols = np.where(np.any(hair_with_buffer > 0, axis=0))[0]
    
    if len(hair_rows) > 0 and len(hair_cols) > 0:
        hair_top_y = int(np.min(hair_rows))
        hair_bottom_y = int(np.max(hair_rows))
        hair_left = int(np.min(hair_cols))
        hair_right = int(np.max(hair_cols))
        
        log_debug(f"[HAIR ONLY] Hair bounds: y={hair_top_y}-{hair_bottom_y}, x={hair_left}-{hair_right}")
    else:
        log_debug(f"[HAIR ONLY] No hair detected, using fallback")
    
    # Use hair with buffer as the visible mask
    visible_mask = hair_with_buffer.copy()
    
    visible_pixels = np.sum(visible_mask)
    log_debug(f"[HAIR ONLY] Total visible: {visible_pixels} pixels (hair + {buffer_px}px buffer)")
    
    # Exclude all facial features from the visible mask (no hairline protection - show hair only)
    if feature_pixels > 0:
        blotted_pixels = np.sum((all_facial_features > 0) & (visible_mask > 0))
        visible_mask[all_facial_features > 0] = 0
        log_debug(f"[HAIR ONLY] Excluded {blotted_pixels} facial feature pixels from mask")
    
    # Show 10px OUTER EDGE of the face outline ONLY FROM EYEBROWS AND UP (forehead area)
    face_edge_px = 10
    if feature_pixels > 0 and face_edge_px > 0:
        # Find the top of eyebrows to limit the face edge
        eyebrow_rows = np.where(eyebrow_mask.any(axis=1))[0]
        if len(eyebrow_rows) > 0:
            eyebrow_top_row = eyebrow_rows[0]
            log_debug(f"[HAIR ONLY] Eyebrow top at row {eyebrow_top_row}")
        else:
            # Fallback: use 40% down the image
            eyebrow_top_row = int(image.shape[0] * 0.4)
            log_debug(f"[HAIR ONLY] No eyebrows found, using fallback row {eyebrow_top_row}")
        
        # Create the full face edge (outer border of all facial features)
        erode_kernel_size = face_edge_px * 2 + 1
        erode_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_kernel_size, erode_kernel_size))
        eroded_face = cv2.erode(all_facial_features.astype(np.uint8), erode_kernel, iterations=1)
        
        # Face edge = original face minus eroded core (the 10px outer border ring)
        full_face_edge = (all_facial_features > 0) & (eroded_face == 0)
        
        # LIMIT TO EYEBROWS AND UP: Only keep edge pixels above the eyebrow top row
        face_edge_above_eyebrows = full_face_edge.copy()
        face_edge_above_eyebrows[eyebrow_top_row:, :] = False  # Clear everything below eyebrows
        
        edge_pixels = np.sum(face_edge_above_eyebrows)
        log_debug(f"[HAIR ONLY] Face edge above eyebrows (10px outline): {edge_pixels} pixels")
        
        if edge_pixels > 0:
            # Add only the face edge above eyebrows to visible mask
            visible_mask[face_edge_above_eyebrows] = 1
            log_debug(f"[HAIR ONLY] Added {edge_pixels} face edge pixels (forehead outline only)")
    
    # CLEANUP: Remove small isolated regions from the mask using morphological operations
    visible_uint8 = (visible_mask * 255).astype(np.uint8)
    
    # Morphological opening to remove small artifacts
    open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    opened = cv2.morphologyEx(visible_uint8, cv2.MORPH_OPEN, open_kernel)
    
    # Use connected components to remove remaining small regions
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    min_area = 500
    
    clean_mask = np.zeros_like(opened)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            clean_mask[labels == i] = 255
    
    removed_regions = num_labels - 1 - np.sum([1 for i in range(1, num_labels) if stats[i, cv2.CC_STAT_AREA] >= min_area])
    if removed_regions > 0:
        log_debug(f"[HAIR ONLY] Removed {removed_regions} small isolated regions from mask")
    
    # Create output using the cleaned mask - gray background stays pristine
    output = np.full_like(image, GRAY_BG, dtype=np.uint8)
    output[clean_mask > 0] = image[clean_mask > 0]
    
    # Sharpening disabled - use original pixels as-is
    
    visible_pixels = np.sum(output[:,:,0] != GRAY_BG[0])
    log_debug(f"[HAIR ONLY] Complete - {visible_pixels} visible pixels (hair + buffer)")
    
    if return_masks:
        # Return masks for validation - use hair_mask (before cleanup) and all_facial_features
        return output, hair_mask, all_facial_features
    return output


def create_hair_with_skin_border_mask(image: np.ndarray, skin_border_px: int = 15, use_multi_scale: bool = True):
    """
    Create a mask showing hair + a border of skin around the hair.
    
    This creates a "halo" effect where:
    - Hair is fully visible
    - X pixels of skin around the hair border is visible
    - Everything else (face center, body, background) is grayed out
    
    Args:
        image: Input BGR image
        skin_border_px: Pixels of skin to show around hair border (default 15)
        use_multi_scale: Use multi-scale segmentation for better hair detection
    
    Returns:
        Output image with hair + skin border visible, rest grayed out
    """
    log_debug(f"[HAIR+SKIN BORDER] Starting - skin_border={skin_border_px}px, multi_scale={use_multi_scale}")
    
    original_h, original_w = image.shape[:2]
    
    # Get hair mask using multi-scale or single-scale
    if use_multi_scale:
        hair_mask, _ = multi_scale_segment_hair(image, scales=[512, 768, 1024])
    else:
        session = get_session()
        resized = cv2.resize(image, (512, 512), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        normalized = rgb.astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        normalized = (normalized - mean) / std
        batched = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0)
        
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: batched})
        seg_map = np.argmax(outputs[0], axis=1)[0]
        seg_map_full = cv2.resize(seg_map.astype(np.uint8), (original_w, original_h), 
                                   interpolation=cv2.INTER_NEAREST)
        hair_mask = (seg_map_full == HAIR_CLASS_ID).astype(np.uint8)
    
    hair_pixels = np.sum(hair_mask)
    log_debug(f"[HAIR+SKIN BORDER] Hair detected: {hair_pixels} pixels")
    
    # Create the visible region: hair + skin_border_px dilation
    # This expands the hair mask outward to include skin around the border
    if skin_border_px > 0:
        kernel_size = skin_border_px * 2 + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        visible_mask = cv2.dilate(hair_mask, kernel, iterations=1)
    else:
        visible_mask = hair_mask.copy()
    
    visible_pixels = np.sum(visible_mask)
    log_debug(f"[HAIR+SKIN BORDER] Visible region (hair + {skin_border_px}px skin border): {visible_pixels} pixels")
    
    # Create output: gray background with visible region showing original image
    output = np.ones_like(image) * 128  # Gray background (128, 128, 128)
    output[visible_mask > 0] = image[visible_mask > 0]  # Show original where visible
    
    log_debug(f"[HAIR+SKIN BORDER] Output created: {original_w}x{original_h}")
    
    return output


def create_facial_features_only_mask(image: np.ndarray, buffer_px: int = 5, return_masks: bool = False, gray_out_eyes: bool = False, face_border_px: int = 0):
    """
    Create a mask showing hair (with 20px buffer) and full face (including facial features).
    Optionally gray out the eyes for privacy/experimentation.
    Optionally gray out the face interior, keeping only a border at the face edge.
    
    Logic:
    1. Create a mask around the person's hair with a 20px buffer
    2. Create a mask for skin, neck, and all facial features
    3. Combine everything to show hair + complete face
    4. If gray_out_eyes=True, replace eye regions with gray
    5. If face_border_px>0, gray out face interior, keeping only border visible
    
    Result: Hair + full face visible. If gray_out_eyes=True, eyes are grayed out.
            If face_border_px>0, only face border is visible, interior is gray.
    
    Args:
        image: Input BGR image
        buffer_px: Pixels to expand the face region (default 5)
        return_masks: If True, return (output, face_mask) for validation
        gray_out_eyes: If True, gray out the eye regions (default False)
        face_border_px: If >0, only show this many pixels at the face edge (default 0 = show full face)
    
    Returns:
        If return_masks=False: output image (np.ndarray)
        If return_masks=True: (output, face_mask) tuple
    """
    HAIR_BUFFER_PX = 20  # Fixed 20px buffer for hair
    FACE_BUFFER_PX = 15  # Buffer around the face region (increased from 5px)
    EYE_BUFFER_PX = 5    # Buffer around eyes when graying them out
    log_debug(f"[HAIR+FACE MASK] Starting - hair buffer={HAIR_BUFFER_PX}px, face buffer={buffer_px}px, gray_out_eyes={gray_out_eyes}, face_border_px={face_border_px}")
    
    session = get_session()
    original_h, original_w = image.shape[:2]
    
    # Preprocess for BiSeNet
    resized = cv2.resize(image, (512, 512), interpolation=cv2.INTER_LINEAR)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    normalized = rgb.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normalized = (normalized - mean) / std
    batched = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0)
    
    # Run inference
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: batched})
    seg_map = np.argmax(outputs[0], axis=1)[0]
    
    # Resize segmentation map to original dimensions
    seg_map_full = cv2.resize(seg_map.astype(np.uint8), (original_w, original_h), 
                               interpolation=cv2.INTER_NEAREST)
    
    # STEP 1: Create hair mask with 20px buffer
    hair_mask = (seg_map_full == HAIR_CLASS_ID).astype(np.uint8)
    hair_pixels = np.sum(hair_mask)
    log_debug(f"[HAIR+FACE MASK] Hair detected: {hair_pixels} pixels")
    
    # Expand hair mask with 20px buffer
    hair_kernel_size = HAIR_BUFFER_PX * 2 + 1
    hair_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (hair_kernel_size, hair_kernel_size))
    hair_expanded = cv2.dilate(hair_mask, hair_kernel, iterations=1)
    hair_expanded_pixels = np.sum(hair_expanded)
    log_debug(f"[HAIR+FACE MASK] Hair after {HAIR_BUFFER_PX}px buffer: {hair_expanded_pixels} pixels")
    
    # STEP 2: Create complete face mask (skin + all facial features)
    face_mask = (
        (seg_map_full == SKIN_CLASS_ID) |
        (seg_map_full == NECK_ID) |
        (seg_map_full == LEFT_EYE_ID) |
        (seg_map_full == RIGHT_EYE_ID) |
        (seg_map_full == LEFT_EYEBROW_ID) |
        (seg_map_full == RIGHT_EYEBROW_ID) |
        (seg_map_full == NOSE_ID) |
        (seg_map_full == UPPER_LIP_ID) |
        (seg_map_full == LOWER_LIP_ID) |
        (seg_map_full == MOUTH_ID) |
        (seg_map_full == LEFT_EAR_ID) |
        (seg_map_full == RIGHT_EAR_ID)
    ).astype(np.uint8)
    
    face_pixels = np.sum(face_mask)
    log_debug(f"[HAIR+FACE MASK] Face (skin + features) detected: {face_pixels} pixels")
    
    # Expand face mask with buffer for clean coverage
    face_kernel_size = FACE_BUFFER_PX * 2 + 1
    face_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (face_kernel_size, face_kernel_size))
    face_expanded = cv2.dilate(face_mask, face_kernel, iterations=1)
    
    expanded_face_pixels = np.sum(face_expanded)
    log_debug(f"[HAIR+FACE MASK] Face after {FACE_BUFFER_PX}px buffer: {expanded_face_pixels} pixels")
    
    # STEP 3: Create output - combine hair and face
    # Start with gray background
    output = np.full_like(image, GRAY_BG, dtype=np.uint8)
    
    # Show hair region (with buffer)
    output[hair_expanded > 0] = image[hair_expanded > 0]
    
    # Show full face region (skin + all facial features)
    output[face_expanded > 0] = image[face_expanded > 0]
    
    # STEP 4: Optionally gray out eyes and eyebrows
    if gray_out_eyes:
        # Create eye mask
        eye_mask = (
            (seg_map_full == LEFT_EYE_ID) |
            (seg_map_full == RIGHT_EYE_ID)
        ).astype(np.uint8)
        
        eye_pixels = np.sum(eye_mask)
        log_debug(f"[HAIR+FACE MASK] Eyes detected: {eye_pixels} pixels")
        
        # Create eyebrow mask
        eyebrow_mask = (
            (seg_map_full == LEFT_EYEBROW_ID) |
            (seg_map_full == RIGHT_EYEBROW_ID)
        ).astype(np.uint8)
        
        eyebrow_pixels = np.sum(eyebrow_mask)
        log_debug(f"[HAIR+FACE MASK] Eyebrows detected: {eyebrow_pixels} pixels")
        
        # Expand eye mask with buffer
        eye_kernel_size = EYE_BUFFER_PX * 2 + 1
        eye_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (eye_kernel_size, eye_kernel_size))
        eye_expanded = cv2.dilate(eye_mask, eye_kernel, iterations=1)
        
        # Expand eyebrow mask with smaller buffer (3px)
        eyebrow_buffer_px = 3
        eyebrow_kernel_size = eyebrow_buffer_px * 2 + 1
        eyebrow_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (eyebrow_kernel_size, eyebrow_kernel_size))
        eyebrow_expanded = cv2.dilate(eyebrow_mask, eyebrow_kernel, iterations=1)
        
        expanded_eye_pixels = np.sum(eye_expanded)
        expanded_eyebrow_pixels = np.sum(eyebrow_expanded)
        log_debug(f"[HAIR+FACE MASK] Eyes after {EYE_BUFFER_PX}px buffer: {expanded_eye_pixels} pixels")
        log_debug(f"[HAIR+FACE MASK] Eyebrows after {eyebrow_buffer_px}px buffer: {expanded_eyebrow_pixels} pixels")
        
        # Gray out the eyes and eyebrows
        output[eye_expanded > 0] = GRAY_BG
        output[eyebrow_expanded > 0] = GRAY_BG
        log_debug(f"[HAIR+FACE MASK] Grayed out {expanded_eye_pixels} eye pixels + {expanded_eyebrow_pixels} eyebrow pixels")
    
    # STEP 5: If face_border_px > 0, gray out face interior, keeping only the border
    if face_border_px > 0:
        log_debug(f"[HAIR+FACE MASK] Graying out face interior, keeping {face_border_px}px border")
        
        # Erode the face mask to get the interior (without the border)
        erode_kernel_size = face_border_px * 2 + 1
        erode_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_kernel_size, erode_kernel_size))
        face_interior = cv2.erode(face_expanded, erode_kernel, iterations=1)
        
        # Make sure we don't gray out hair - the hair should always be visible
        # Subtract hair from face interior
        face_interior_no_hair = cv2.bitwise_and(face_interior, cv2.bitwise_not(hair_expanded))
        
        interior_pixels = np.sum(face_interior_no_hair)
        log_debug(f"[HAIR+FACE MASK] Face interior (to be desaturated): {interior_pixels} pixels")
        
        # Desaturate the face interior (convert to grayscale but keep as 3-channel)
        # This shows the face structure without the skin tones that the model might copy
        face_interior_mask = face_interior_no_hair > 0
        if np.any(face_interior_mask):
            # Get the original face pixels
            original_face = image[face_interior_mask]
            # Convert to grayscale using luminance formula
            gray_values = (0.299 * original_face[:, 2] + 0.587 * original_face[:, 1] + 0.114 * original_face[:, 0]).astype(np.uint8)
            # Apply as 3-channel grayscale
            output[face_interior_mask] = np.stack([gray_values, gray_values, gray_values], axis=1)
        log_debug(f"[HAIR+FACE MASK] Desaturated face interior, keeping {face_border_px}px border in color")
    
    visible_pixels = np.sum(np.any(output != GRAY_BG, axis=2))
    log_debug(f"[HAIR+FACE MASK] Complete - {visible_pixels} visible pixels (hair + face, eyes_grayed={gray_out_eyes}, face_border={face_border_px}px)")
    
    if return_masks:
        return output, face_mask
    return output


def create_reference_face_masked(image: np.ndarray, use_multi_scale: bool = True) -> np.ndarray:
    """
    Create a reference image with specific facial features grayed out.
    
    This shows the FULL reference image (including hair, clothing, background, and skin)
    but with ONLY specific facial features (eyes, eyebrows, nose, mouth, ears) replaced with gray.
    The skin/face shape is preserved to give FLUX context about the hairstyle framing.
    
    Args:
        image: Input BGR image
        use_multi_scale: Whether to use multi-scale segmentation for better accuracy
    
    Returns:
        Image with specific facial features replaced by gray (skin preserved)
    """
    session = get_session()
    original_h, original_w = image.shape[:2]
    
    # Preprocess for BiSeNet
    resized = cv2.resize(image, (512, 512), interpolation=cv2.INTER_LINEAR)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    normalized = rgb.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normalized = (normalized - mean) / std
    batched = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0)
    
    # Run inference
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: batched})
    seg_map = np.argmax(outputs[0], axis=1)[0]
    
    # Create mask for ONLY specific facial features (NOT skin)
    # Eyes, eyebrows, nose, mouth (upper lip, lower lip, inner mouth), ears
    facial_features_mask_512 = (
        (seg_map == LEFT_EYE_ID) |
        (seg_map == RIGHT_EYE_ID) |
        (seg_map == LEFT_EYEBROW_ID) |
        (seg_map == RIGHT_EYEBROW_ID) |
        (seg_map == NOSE_ID) |
        (seg_map == UPPER_LIP_ID) |
        (seg_map == LOWER_LIP_ID) |
        (seg_map == MOUTH_ID) |
        (seg_map == LEFT_EAR_ID) |
        (seg_map == RIGHT_EAR_ID)
    ).astype(np.uint8) * 255
    
    # Resize to original dimensions
    facial_features_mask = cv2.resize(facial_features_mask_512, (original_w, original_h), 
                                       interpolation=cv2.INTER_NEAREST)
    
    if np.sum(facial_features_mask) == 0:
        log_debug(f"[REF FACE MASKED] Warning: No facial features detected, returning original")
        return image.copy()
    
    # Expand the facial features mask slightly for clean coverage
    kernel = np.ones((5, 5), np.uint8)
    facial_expanded = cv2.dilate(facial_features_mask, kernel, iterations=2)
    
    # Create output - start with original image, then gray out only facial features
    output = image.copy()
    output[facial_expanded > 0] = GRAY_BG
    
    masked_pixels = np.sum(facial_expanded > 0)
    log_debug(f"[REF FACE MASKED] Grayed out {masked_pixels} pixels (eyes, eyebrows, nose, mouth, ears only - skin preserved)")
    
    return output


def create_reference_image(image: np.ndarray, buffer_px: int = 10, sharpen: bool = False) -> np.ndarray:
    """
    Create a reference image for FLUX (Image 4) that shows:
    - Hair region with buffer: original pixels
    - Forehead skin: visible
    - Everything from the eyes down: grayed out (blots facial features)
    
    This helps FLUX understand the hairstyle context while not copying
    the reference person's facial features.
    
    Args:
        image: Input BGR image
        buffer_px: Pixels to expand the hair mask
        sharpen: Whether to apply sharpening before masking (default False - disabled)
    """
    # Sharpening disabled - use original image as-is
    
    session = get_session()
    original_h, original_w = image.shape[:2]
    
    # Preprocess for BiSeNet
    resized = cv2.resize(image, (512, 512), interpolation=cv2.INTER_LINEAR)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    normalized = rgb.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normalized = (normalized - mean) / std
    batched = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0)
    
    # Run inference
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: batched})
    seg_map = np.argmax(outputs[0], axis=1)[0]
    
    # Resize segmentation map to original dimensions
    seg_map_full = cv2.resize(seg_map.astype(np.uint8), (original_w, original_h), 
                               interpolation=cv2.INTER_NEAREST)
    
    # Create masks for different regions
    hair_mask = (seg_map_full == HAIR_CLASS_ID).astype(np.uint8)
    skin_mask = (seg_map_full == SKIN_CLASS_ID).astype(np.uint8)
    
    # Get eye positions - we'll gray out everything from the eyes down
    eye_mask = ((seg_map_full == LEFT_EYE_ID) | (seg_map_full == RIGHT_EYE_ID)).astype(np.uint8)
    eyebrow_mask = ((seg_map_full == LEFT_EYEBROW_ID) | (seg_map_full == RIGHT_EYEBROW_ID)).astype(np.uint8)
    nose_mask = (seg_map_full == NOSE_ID).astype(np.uint8)
    
    # Find the TOP of eyes and set cutoff there (blot from eyes down)
    eye_rows = np.where(eye_mask.any(axis=1))[0]
    eyebrow_rows = np.where(eyebrow_mask.any(axis=1))[0]
    nose_rows = np.where(nose_mask.any(axis=1))[0]
    
    if len(eye_rows) > 0:
        # Primary: use top of eyes
        eye_top = eye_rows[0]
        cutoff_row = eye_top  # Blot from eyes down
        log_debug(f"[REF MASK] Using eyes: cutoff at row {cutoff_row} (eye_top={eye_top})")
    elif len(eyebrow_rows) > 0:
        # Fallback 1: use bottom of eyebrows (estimate eyes are ~10px below)
        eyebrow_bottom = eyebrow_rows[-1]
        cutoff_row = eyebrow_bottom + 10
        log_debug(f"[REF MASK] FALLBACK eyebrows: cutoff at row {cutoff_row}")
    elif len(nose_rows) > 0:
        # Fallback 2: use top of nose
        nose_top = nose_rows[0]
        cutoff_row = max(0, nose_top - 20)
        log_debug(f"[REF MASK] FALLBACK nose: cutoff at row {cutoff_row}")
    else:
        # Fallback 3: use top 40% of image
        cutoff_row = int(original_h * 0.4)
        log_debug(f"[REF MASK] FALLBACK 40%: cutoff at row {cutoff_row}")
    
    # Dilate hair mask to create buffer
    if buffer_px > 0:
        kernel_size = buffer_px * 2 + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        hair_with_buffer = cv2.dilate(hair_mask, kernel, iterations=1)
    else:
        hair_with_buffer = hair_mask
    
    # Create output image - start with gray background (BGR format)
    output = np.full_like(image, GRAY_BG, dtype=np.uint8)
    
    # Layer 1: Show skin ABOVE the cutoff line (forehead area)
    skin_above_cutoff = skin_mask.copy()
    skin_above_cutoff[cutoff_row:, :] = 0  # Remove skin below cutoff
    output[skin_above_cutoff > 0] = image[skin_above_cutoff > 0]
    
    # Layer 2: Show hair with buffer - original pixels (overrides skin where they overlap)
    output[hair_with_buffer > 0] = image[hair_with_buffer > 0]
    
    # Layer 3: Gray out EVERYTHING below the cutoff line (from eyes down)
    # except for hair which should remain visible
    below_cutoff_mask = np.zeros((original_h, original_w), dtype=np.uint8)
    below_cutoff_mask[cutoff_row:, :] = 1
    below_cutoff_mask[hair_with_buffer > 0] = 0  # Keep hair visible
    output[below_cutoff_mask > 0] = GRAY_BG
    
    return output

def encode_image(img: np.ndarray) -> str:
    """Encode image as base64 PNG."""
    success, buffer = cv2.imencode('.png', img)
    if not success:
        raise ValueError("Failed to encode image")
    return f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"

def main():
    """Main entry point."""
    try:
        input_data = json.loads(sys.stdin.read())
        image_url = input_data.get("imageUrl") or input_data.get("image_url")
        
        if not image_url:
            raise ValueError("imageUrl is required")
        
        # Download image
        image = download_image(image_url)
        if image is None:
            raise ValueError("Failed to decode image")
        
        # Check for mode: "mask" (default), "reference", or "user_mask"
        mode = input_data.get("mode", "mask")
        
        if mode == "reference":
            # Create reference image: hair + face visible, but features blotted out
            buffer_px = input_data.get("bufferPx", 10)
            ref_image = create_reference_image(image, buffer_px)
            
            # Encode as JPEG for smaller size
            success, buffer = cv2.imencode('.jpg', ref_image, [cv2.IMWRITE_JPEG_QUALITY, 95])
            if not success:
                raise ValueError("Failed to encode reference image")
            ref_base64 = f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}"
            
            output = {
                "success": True,
                "referenceImage": ref_base64,
                "width": image.shape[1],
                "height": image.shape[0]
            }
        elif mode == "hair_only":
            # Create hair-only mask: ONLY hair with buffer visible, everything else gray
            buffer_px = input_data.get("bufferPx", 3)
            # Enable multi-scale for better detection of close-cropped styles (waves, fades, etc.)
            hair_only, hair_mask, facial_mask = create_hair_only_mask(image, buffer_px, use_multi_scale=True, return_masks=True)
            
            # Run validation on the mask
            validation = validate_hair_mask(hair_mask, facial_mask, image.shape)
            log_debug(f"[HAIR ONLY] Validation: valid={validation['valid']}, score={validation['score']}, issues={validation['issues']}")
            
            # Encode as PNG for lossless output (preserves exact gray background)
            success, buffer = cv2.imencode('.png', hair_only)
            if not success:
                raise ValueError("Failed to encode hair-only image")
            hair_only_base64 = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
            
            output = {
                "success": True,
                "hairOnlyImage": hair_only_base64,
                "width": image.shape[1],
                "height": image.shape[0],
                "validation": validation
            }
        elif mode == "hair_only_ultra":
            # Create RAW hair-only mask using SAME pipeline as user_mask raw mode
            # Used for Kontext Stage 1 result masking to ensure consistency
            # No buffer expansion - direct mask application like raw user mask
            
            hair_only, hair_mask, facial_mask = create_hair_only_mask_raw(image, return_masks=True)
            
            # Run validation on the mask
            validation = validate_hair_mask(hair_mask, facial_mask, image.shape)
            log_debug(f"[HAIR ONLY RAW] Validation: valid={validation['valid']}, score={validation['score']}, issues={validation['issues']}")
            
            # Encode as PNG for lossless output
            success, buffer = cv2.imencode('.png', hair_only)
            if not success:
                raise ValueError("Failed to encode hair-only raw image")
            hair_only_base64 = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
            
            output = {
                "success": True,
                "hairOnlyImage": hair_only_base64,
                "width": image.shape[1],
                "height": image.shape[0],
                "validation": validation
            }
        elif mode == "hair_only_kontext":
            # Dedicated Kontext Stage 1 mask pipeline (hair-only + 30px buffer).
            hair_only, hair_mask, facial_mask = create_hair_only_mask_kontext(image, return_masks=True, hair_buffer_px=30)

            validation = validate_hair_mask(hair_mask, facial_mask, image.shape)
            log_debug(f"[HAIR ONLY KONTEXT] Validation: valid={validation['valid']}, score={validation['score']}, issues={validation['issues']}")

            success, buffer = cv2.imencode('.png', hair_only)
            if not success:
                raise ValueError("Failed to encode hair-only kontext image")
            hair_only_base64 = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"

            output = {
                "success": True,
                "hairOnlyImage": hair_only_base64,
                "width": image.shape[1],
                "height": image.shape[0],
                "validation": validation
            }
        elif mode == "hair_only_simple":
            # SIMPLER hair-only mask: single-scale, no guided filter, but SAME buffer as advanced
            # Used as fallback when the advanced pipeline fails validation
            # Maintains 3px buffer + 40px hairline extension for quality parity
            buffer_px = input_data.get("bufferPx", 3)  # Same buffer as advanced
            # Disable multi-scale and guided filter for simpler/faster processing
            hair_only, hair_mask, facial_mask = create_hair_only_mask(
                image, buffer_px, 
                use_multi_scale=False,  # Single scale only
                use_guided_filter=False,  # Skip edge refinement
                return_masks=True
            )
            
            # Run validation on the mask
            validation = validate_hair_mask(hair_mask, facial_mask, image.shape)
            print(f"[HAIR ONLY SIMPLE] Validation: valid={validation['valid']}, score={validation['score']}, issues={validation['issues']}")
            
            # Encode as PNG for lossless output
            success, buffer = cv2.imencode('.png', hair_only)
            if not success:
                raise ValueError("Failed to encode hair-only simple image")
            hair_only_base64 = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
            
            output = {
                "success": True,
                "hairOnlyImage": hair_only_base64,
                "width": image.shape[1],
                "height": image.shape[0],
                "validation": validation
            }
        elif mode == "hair_with_skin_border":
            # Create mask showing hair + skin border around hair
            # Used for Kontext Stage 1 result masking
            skin_border_px = input_data.get("skinBorderPx", 15)
            
            hair_skin_border = create_hair_with_skin_border_mask(image, skin_border_px, use_multi_scale=True)
            
            # Encode as PNG for lossless output
            success, buffer = cv2.imencode('.png', hair_skin_border)
            if not success:
                raise ValueError("Failed to encode hair with skin border image")
            hair_skin_border_base64 = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
            
            output = {
                "success": True,
                "hairSkinBorderImage": hair_skin_border_base64,
                "width": image.shape[1],
                "height": image.shape[0]
            }
        elif mode == "reference_face_masked":
            # Create full reference image with facial features grayed out
            # Hair, clothing, background all visible - just eyes/nose/mouth/ears grayed
            ref_face_masked = create_reference_face_masked(image, use_multi_scale=True)
            
            # Encode as JPEG for smaller size
            success, buffer = cv2.imencode('.jpg', ref_face_masked, [cv2.IMWRITE_JPEG_QUALITY, 95])
            if not success:
                raise ValueError("Failed to encode reference face masked image")
            ref_face_masked_base64 = f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}"
            
            output = {
                "success": True,
                "referenceFaceMaskedImage": ref_face_masked_base64,
                "width": image.shape[1],
                "height": image.shape[0]
            }
        elif mode == "facial_features_only":
            # Create mask showing hair + full face
            # Optionally gray out eyes
            # Optionally gray out face interior with border
            buffer_px = input_data.get("bufferPx", 5)
            gray_out_eyes = input_data.get("grayOutEyes", False)
            face_border_px = input_data.get("faceBorderPx", 0)
            
            features_only, features_mask = create_facial_features_only_mask(
                image, buffer_px, return_masks=True, gray_out_eyes=gray_out_eyes, face_border_px=face_border_px
            )
            
            # Encode as PNG for lossless output
            success, buffer = cv2.imencode('.png', features_only)
            if not success:
                raise ValueError("Failed to encode facial features only image")
            features_only_base64 = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
            
            feature_pixels = int(np.sum(features_mask))
            log_debug(f"[FACIAL FEATURES ONLY] Complete - {feature_pixels} feature pixels detected")
            
            output = {
                "success": True,
                "facialFeaturesOnlyImage": features_only_base64,
                "width": image.shape[1],
                "height": image.shape[0],
                "featurePixels": feature_pixels
            }
        elif mode == "user_mask":
            # Create user masked image: everything visible EXCEPT hair (hair replaced with gray)
            buffer_px = input_data.get("bufferPx", 10)
            hairline_visible_px = input_data.get("hairlineVisiblePx", 20)  # Pixels of hair to show above hairline
            validate_quality = input_data.get("validateQuality", True)  # New flag for quality check
            include_neck = input_data.get("includeNeck", True)  # Whether to include neck in visible area
            gray_out_background = input_data.get("grayOutBackground", True)  # Gray out background/clothes (default True)
            
            # STEP 1: Run EARLY validation (blur, lighting, size) BEFORE expensive BiSeNet
            # This allows fast rejection of obviously bad photos
            if validate_quality:
                early_quality = validate_early_photo_quality(image)
                if not early_quality["valid"]:
                    log_debug(f"[USER MASK] Early validation FAILED: {early_quality['issues']}")
                    # Return early with a minimal mask result that indicates failure
                    output = {
                        "success": True,  # Processing succeeded, but quality check failed
                        "userMaskedImage": None,
                        "width": image.shape[1],
                        "height": image.shape[0],
                        "validation": {
                            "valid": False,
                            "score": 0,
                            "issues": early_quality["issues"]
                        },
                        "photoQuality": {
                            "valid": False,
                            "issues": early_quality["issues"],
                            "metrics": early_quality["metrics"],
                            "guidance": early_quality["guidance"]
                        }
                    }
                    print(json.dumps(output))
                    sys.exit(0)
                log_debug(f"[USER MASK] Early validation PASSED - proceeding with BiSeNet")
            
            # STEP 2: Run early face detection to get focused crop region
            face_crop_region = None
            face_check = early_face_check(image)
            if face_check["face_found"] and face_check["crop_region"]:
                face_crop_region = face_check["crop_region"]
                log_debug(f"[USER MASK] Using face-focused processing with crop region: {face_crop_region}")
            
            # STEP 3: Run expensive BiSeNet processing (only after early checks pass)
            # Enable multi-scale for better detection of close-cropped styles (waves, fades, etc.)
            user_masked, face_mask, facial_features_mask = create_user_masked_image(
                image, buffer_px, use_multi_scale=True, return_masks=True, 
                hairline_visible_px=hairline_visible_px, face_crop_region=face_crop_region,
                include_neck=include_neck, gray_out_background=gray_out_background
            )
            
            # Run validation on the user mask
            # Pass ultralight_face_found=True if face detector found a face (more lenient validation)
            ultralight_found = face_check["face_found"] if face_check else False
            validation = validate_user_mask(face_mask, facial_features_mask, image.shape, ultralight_face_found=ultralight_found)
            log_debug(f"[USER MASK] Validation: valid={validation['valid']}, score={validation['score']}, issues={validation['issues']} (ultralight={ultralight_found})")
            
            # STEP 4: Run full photo quality validation (face features, eye check, etc.)
            photo_quality = None
            if validate_quality:
                # Get the parsing result for quality check
                session = get_session()
                parsing_result = segment_at_scale(image, 512, session)
                # Pass ultralight_found to skip strict BiSeNet checks when face detector found face
                photo_quality = validate_user_photo_quality(parsing_result, image.shape, image, ultralight_face_found=ultralight_found)
                log_debug(f"[USER MASK] Photo quality: valid={photo_quality['valid']}, issues={photo_quality['issues']} (ultralight={ultralight_found})")
                if photo_quality.get("guidance"):
                    log_debug(f"[USER MASK] Photo guidance: {photo_quality['guidance']}")
            
            # Encode as JPEG for smaller size
            success, buffer = cv2.imencode('.jpg', user_masked, [cv2.IMWRITE_JPEG_QUALITY, 95])
            if not success:
                raise ValueError("Failed to encode user masked image")
            masked_base64 = f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}"
            
            output = {
                "success": True,
                "userMaskedImage": masked_base64,
                "width": image.shape[1],
                "height": image.shape[0],
                "validation": validation
            }
            
            # Include photo quality if validation was run
            if photo_quality:
                output["photoQuality"] = photo_quality
        elif mode == "compare_masks":
            # Compare BiSeNet vs SegFormer pipelines side by side
            import time
            buffer_px = input_data.get("bufferPx", 10)
            hairline_visible_px = input_data.get("hairlineVisiblePx", 20)
            
            # Run early face detection for focused processing
            face_crop_region = None
            face_check = early_face_check(image)
            if face_check["face_found"] and face_check["crop_region"]:
                face_crop_region = face_check["crop_region"]
                log_debug(f"[COMPARE] Using face-focused processing with crop region: {face_crop_region}")
            
            # Run BiSeNet pipeline
            bisenet_start = time.time()
            bisenet_error = None
            try:
                if face_crop_region is not None:
                    bisenet_hair_mask, bisenet_facial_mask = segment_hair_focused(image, face_crop_region, scales=[512, 768, 1024])
                else:
                    bisenet_hair_mask, bisenet_facial_mask = multi_scale_segment_hair(image, scales=[512, 768, 1024])
                bisenet_time = time.time() - bisenet_start
                bisenet_hair_pixels = int(np.sum(bisenet_hair_mask))
                bisenet_facial_pixels = int(np.sum(bisenet_facial_mask))
                bisenet_success = True
            except Exception as e:
                bisenet_time = time.time() - bisenet_start
                bisenet_hair_pixels = 0
                bisenet_facial_pixels = 0
                bisenet_success = False
                bisenet_error = str(e)
                bisenet_hair_mask = np.zeros((image.shape[0], image.shape[1]), dtype=np.uint8)
                bisenet_facial_mask = np.zeros((image.shape[0], image.shape[1]), dtype=np.uint8)
                log_debug(f"[COMPARE] BiSeNet failed: {e}")
            
            # Run SegFormer pipeline with same focused + multi-scale approach as BiSeNet
            segformer_start = time.time()
            segformer_error = None
            try:
                # Use same focused cropping and multi-scale as BiSeNet for fair comparison
                if face_crop_region is not None:
                    segformer_hair_mask, segformer_facial_mask = segment_hair_focused_segformer(image, face_crop_region, scales=[512, 768, 1024])
                else:
                    segformer_hair_mask, segformer_facial_mask = multi_scale_segment_hair_segformer(image, scales=[512, 768, 1024])
                segformer_time = time.time() - segformer_start
                segformer_hair_pixels = int(np.sum(segformer_hair_mask))
                segformer_facial_pixels = int(np.sum(segformer_facial_mask))
                segformer_success = True
            except Exception as e:
                segformer_time = time.time() - segformer_start
                segformer_hair_pixels = 0
                segformer_facial_pixels = 0
                segformer_success = False
                segformer_error = str(e)
                segformer_hair_mask = np.zeros((image.shape[0], image.shape[1]), dtype=np.uint8)
                segformer_facial_mask = np.zeros((image.shape[0], image.shape[1]), dtype=np.uint8)
                log_debug(f"[COMPARE] SegFormer failed: {e}")
            
            # Create visual outputs for both pipelines
            original_image = image.copy()
            
            # BiSeNet: Create user mask (face visible, hair grayed)
            bisenet_masked = original_image.copy()
            bisenet_masked[bisenet_hair_mask > 0] = GRAY_BG
            
            # SegFormer: Create user mask (face visible, hair grayed)
            segformer_masked = original_image.copy()
            segformer_masked[segformer_hair_mask > 0] = GRAY_BG
            
            # Create overlay visualizations (hair in red, face in green)
            bisenet_overlay = original_image.copy()
            bisenet_overlay[bisenet_hair_mask > 0] = [0, 0, 255]  # Red for hair
            if bisenet_success:
                bisenet_overlay[bisenet_facial_mask > 0] = [0, 255, 0]  # Green for face
            bisenet_overlay = cv2.addWeighted(original_image, 0.5, bisenet_overlay, 0.5, 0)
            
            segformer_overlay = original_image.copy()
            segformer_overlay[segformer_hair_mask > 0] = [0, 0, 255]  # Red for hair
            if segformer_success:
                segformer_overlay[segformer_facial_mask > 0] = [0, 255, 0]  # Green for face
            segformer_overlay = cv2.addWeighted(original_image, 0.5, segformer_overlay, 0.5, 0)
            
            # Encode images
            def encode_jpg(img):
                success, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 90])
                if not success:
                    return None
                return f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}"
            
            output = {
                "success": True,
                "width": image.shape[1],
                "height": image.shape[0],
                "faceDetected": face_check["face_found"],
                "faceCropRegion": face_crop_region,
                "bisenet": {
                    "success": bisenet_success,
                    "error": bisenet_error,
                    "timeMs": round(bisenet_time * 1000, 1),
                    "hairPixels": bisenet_hair_pixels,
                    "facialPixels": bisenet_facial_pixels,
                    "maskedImage": encode_jpg(bisenet_masked) if bisenet_success else None,
                    "overlayImage": encode_jpg(bisenet_overlay) if bisenet_success else None
                },
                "segformer": {
                    "success": segformer_success,
                    "error": segformer_error,
                    "timeMs": round(segformer_time * 1000, 1),
                    "hairPixels": segformer_hair_pixels,
                    "facialPixels": segformer_facial_pixels,
                    "maskedImage": encode_jpg(segformer_masked) if segformer_success else None,
                    "overlayImage": encode_jpg(segformer_overlay) if segformer_success else None
                }
            }
        else:
            # Standard mask mode
            # Config - updated per guidelines (2-3px dilation, 1-2px feather)
            dilation_kernel = input_data.get("dilationKernel", 3)  # 3x3 kernel = ~2px dilation
            dilation_iterations = input_data.get("dilationIterations", 1)
            feather_size = input_data.get("featherSize", 3)  # 3px blur = ~1-2px feather
            create_debug_overlay = input_data.get("createOverlay", False)
            include_forehead = input_data.get("includeForehead", False)
            forehead_extension = input_data.get("foreheadExtension", 80)
            above_hair = input_data.get("aboveHair", 20)
            eyebrow_margin = input_data.get("eyebrowMargin", 20)
            
            # Segment (returns tuple: hair_mask, facial_features_mask)
            forehead_fraction = input_data.get("foreheadFraction", 0.5)
            downward_only = input_data.get("downwardOnly", False)
            exclude_facial_features = input_data.get("excludeFacialFeatures", True)
            raw_mask, facial_features_mask = segment_hair(
                image, include_forehead, forehead_extension, above_hair, 
                eyebrow_margin, forehead_fraction, exclude_facial_features
            )
            
            # Refine (pass facial features mask to exclude after dilation)
            refined_mask = refine_mask(
                raw_mask, dilation_kernel, dilation_iterations, feather_size, 
                downward_only, facial_features_mask
            )
            
            # Build output
            output = {
                "success": True,
                "mask": encode_image(refined_mask),
                "width": image.shape[1],
                "height": image.shape[0]
            }
            
            # Optional: debug overlay
            if create_debug_overlay:
                overlay = create_overlay(image, refined_mask)
                output["overlay"] = encode_image(overlay)
        
        print(json.dumps(output))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
