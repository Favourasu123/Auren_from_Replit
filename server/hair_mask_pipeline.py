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
SCRFD_FACE_MODEL_PATH = Path(__file__).parent.parent / "models" / "scrfd_2.5g_bnkps.onnx"
RETINAFACE_AMD_MODEL_PATH = Path(__file__).parent.parent / "models" / "retinaface_amd_int.onnx"
RETINAFACE_STANDARD_MODEL_PATH = Path(__file__).parent.parent / "models" / "retinaface_standard_conversion.onnx"
MODNET_MODEL_PATH = Path(
    os.environ.get(
        "MODNET_MODEL_PATH",
        str(Path(__file__).parent.parent / "models" / "modnet_photographic_portrait_matting.onnx")
    )
)

# Quiet mode - suppress verbose logging (only errors and final status shown)
QUIET_MODE = os.environ.get("BISENET_QUIET", "1") == "1"

# Enable/disable early face detection (Ultra-Light-Fast face detector before BiSeNet)
USE_EARLY_FACE_DETECTION = os.environ.get("EARLY_FACE_DETECTION", "1") == "1"
FACE_DETECTION_CONFIDENCE = 0.7  # Minimum confidence for face detection

# Kontext face detector settings
KONTEXT_FACE_DETECTOR = os.environ.get("KONTEXT_FACE_DETECTOR", "ultralight").strip().lower()
ULTRALIGHT_DET_THRESHOLD = float(os.environ.get("ULTRALIGHT_DET_THRESHOLD", "0.60"))
SCRFD_DET_THRESHOLD = float(os.environ.get("SCRFD_DET_THRESHOLD", "0.50"))
RETINAFACE_DET_THRESHOLD = float(os.environ.get("RETINAFACE_DET_THRESHOLD", "0.45"))
KONTEXT_MULTI_PASS_SCALES_ENV = os.environ.get("KONTEXT_MULTI_PASS_SCALES", "1.0,1.2,0.9")
KONTEXT_MATTING_BACKEND = os.environ.get("KONTEXT_MATTING_BACKEND", "trimap").strip().lower()
MODNET_INPUT_SIZE = int(os.environ.get("MODNET_INPUT_SIZE", "512"))
KONTEXT_EDGE_DECONTAMINATE = os.environ.get("KONTEXT_EDGE_DECONTAMINATE", "1") == "1"
KONTEXT_EDGE_DECONTAM_STRENGTH = float(os.environ.get("KONTEXT_EDGE_DECONTAM_STRENGTH", "0.65"))


def parse_multipass_scales(raw: str) -> list:
    scales = []
    for p in (raw or "").split(","):
        p = p.strip()
        if not p:
            continue
        try:
            v = float(p)
            if 0.6 <= v <= 2.0:
                scales.append(v)
        except Exception:
            continue
    if not scales:
        return [1.0, 1.2, 0.9]
    if 1.0 not in scales:
        scales.insert(0, 1.0)
    return scales


def parse_boolish(value, default: bool = False) -> bool:
    """Parse booleans from bool/int/str values."""
    if value is None:
        return bool(default)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"1", "true", "yes", "y", "on"}:
            return True
        if v in {"0", "false", "no", "n", "off"}:
            return False
    return bool(default)


KONTEXT_MULTI_PASS_SCALES = parse_multipass_scales(KONTEXT_MULTI_PASS_SCALES_ENV)


def resolve_runtime_detector(detector_type: str) -> str:
    """
    Resolve requested detector to an available runtime detector.
    Falls back to ultralight if the requested detector model is unavailable.
    """
    detector = (detector_type or "ultralight").strip().lower()
    if detector not in {"ultralight", "scrfd", "retinaface"}:
        detector = "ultralight"

    if detector == "scrfd" and not SCRFD_FACE_MODEL_PATH.exists():
        log_info("[FACE DET] SCRFD model missing at runtime; falling back to ultralight")
        return "ultralight"

    if detector == "retinaface":
        has_retina = RETINAFACE_AMD_MODEL_PATH.exists() or RETINAFACE_STANDARD_MODEL_PATH.exists()
        if not has_retina:
            log_info("[FACE DET] RetinaFace model missing at runtime; falling back to ultralight")
            return "ultralight"

    if detector == "ultralight" and not ULTRA_LIGHT_FACE_MODEL_PATH.exists():
        # Keep behavior explicit if deployment is missing the only supported detector.
        log_info(f"[FACE DET] Ultra-Light model not found at {ULTRA_LIGHT_FACE_MODEL_PATH}")

    return detector


def resolve_runtime_matting_backend(backend_type: str) -> str:
    """
    Resolve requested matting backend to an available backend.
    Falls back to trimap if MODNet model is unavailable.
    """
    backend = (backend_type or KONTEXT_MATTING_BACKEND or "trimap").strip().lower()
    if backend not in {"trimap", "modnet"}:
        backend = "trimap"

    if backend == "modnet" and not MODNET_MODEL_PATH.exists():
        log_info(f"[MATTING] MODNet model missing at runtime ({MODNET_MODEL_PATH}); falling back to trimap")
        return "trimap"
    return backend


def get_detector_default_threshold(detector_type: str) -> float:
    detector = resolve_runtime_detector(detector_type)
    if detector == "scrfd":
        return float(SCRFD_DET_THRESHOLD)
    if detector == "retinaface":
        return float(RETINAFACE_DET_THRESHOLD)
    return float(ULTRALIGHT_DET_THRESHOLD)

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
_scrfd_face_session = None
_retinaface_face_session = None
_retinaface_model_kind = None
_modnet_session = None

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


def nms_xyxy(dets: np.ndarray, iou_threshold: float = 0.4) -> np.ndarray:
    """NMS for Nx5 detections in [x1,y1,x2,y2,score] format."""
    if dets is None or dets.size == 0:
        return np.array([], dtype=np.int32)

    x1 = dets[:, 0]
    y1 = dets[:, 1]
    x2 = dets[:, 2]
    y2 = dets[:, 3]
    scores = dets[:, 4]
    areas = np.maximum(0.0, x2 - x1 + 1.0) * np.maximum(0.0, y2 - y1 + 1.0)
    order = scores.argsort()[::-1]

    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        if order.size == 1:
            break

        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1 + 1.0)
        h = np.maximum(0.0, yy2 - yy1 + 1.0)
        inter = w * h
        iou = inter / np.maximum(1e-6, areas[i] + areas[order[1:]] - inter)
        inds = np.where(iou <= iou_threshold)[0]
        order = order[inds + 1]
    return np.array(keep, dtype=np.int32)


def distance2bbox(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    """Decode ltrb distances to xyxy boxes."""
    x1 = points[:, 0] - distance[:, 0]
    y1 = points[:, 1] - distance[:, 1]
    x2 = points[:, 0] + distance[:, 2]
    y2 = points[:, 1] + distance[:, 3]
    return np.stack([x1, y1, x2, y2], axis=-1)


def _faces_to_dets(faces: list) -> np.ndarray:
    if not faces:
        return np.zeros((0, 5), dtype=np.float32)
    rows = []
    for f in faces:
        x, y, w, h = f["bbox"]
        rows.append([float(x), float(y), float(x + w), float(y + h), float(f.get("confidence", 0.0))])
    return np.array(rows, dtype=np.float32)


def _dets_to_faces(dets: np.ndarray, image_shape: tuple) -> list:
    h, w = image_shape[:2]
    faces = []
    if dets is None:
        return faces
    for d in dets:
        x1, y1, x2, y2, score = d.tolist()
        x1 = max(0, min(w - 1, int(round(x1))))
        y1 = max(0, min(h - 1, int(round(y1))))
        x2 = max(0, min(w - 1, int(round(x2))))
        y2 = max(0, min(h - 1, int(round(y2))))
        fw = max(0, x2 - x1)
        fh = max(0, y2 - y1)
        if fw < 20 or fh < 20:
            continue
        faces.append({
            "bbox": (x1, y1, fw, fh),
            "confidence": float(score),
            "area": int(fw * fh)
        })
    faces.sort(key=lambda f: (f["area"], f["confidence"]), reverse=True)
    return faces


def get_scrfd_face_detector():
    """Load SCRFD ONNX detector session."""
    global _scrfd_face_session
    if _scrfd_face_session is not None:
        return _scrfd_face_session

    if not SCRFD_FACE_MODEL_PATH.exists():
        log_debug(f"SCRFD model missing: {SCRFD_FACE_MODEL_PATH}")
        return None
    try:
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = 4
        _scrfd_face_session = ort.InferenceSession(
            str(SCRFD_FACE_MODEL_PATH),
            sess_options=opts,
            providers=['CPUExecutionProvider']
        )
        log_debug("SCRFD face detector loaded")
        return _scrfd_face_session
    except Exception as e:
        log_info(f"Failed to load SCRFD detector: {e}")
        return None


def get_retinaface_face_detector():
    """Load RetinaFace ONNX detector session."""
    global _retinaface_face_session, _retinaface_model_kind
    if _retinaface_face_session is not None:
        return _retinaface_face_session, _retinaface_model_kind

    candidates = [
        (RETINAFACE_AMD_MODEL_PATH, "amd"),
        (RETINAFACE_STANDARD_MODEL_PATH, "standard"),
    ]
    for path, kind in candidates:
        if not path.exists():
            continue
        try:
            opts = ort.SessionOptions()
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.intra_op_num_threads = 4
            sess = ort.InferenceSession(str(path), sess_options=opts, providers=['CPUExecutionProvider'])
            _retinaface_face_session = sess
            _retinaface_model_kind = kind
            log_debug(f"RetinaFace detector loaded ({kind}): {path.name}")
            return _retinaface_face_session, _retinaface_model_kind
        except Exception as e:
            log_info(f"Could not load RetinaFace model {path.name}: {e}")
    return None, None


def detect_faces_scrfd_single(image: np.ndarray, confidence_threshold: float = 0.5,
                              input_size: tuple = (640, 640), nms_thresh: float = 0.4) -> list:
    """Single-pass SCRFD face detection."""
    session = get_scrfd_face_detector()
    if session is None:
        return []

    img_h, img_w = image.shape[:2]
    in_w, in_h = int(input_size[0]), int(input_size[1])
    im_ratio = float(img_h) / float(max(1, img_w))
    model_ratio = float(in_h) / float(max(1, in_w))
    if im_ratio > model_ratio:
        new_h = in_h
        new_w = int(new_h / im_ratio)
    else:
        new_w = in_w
        new_h = int(new_w * im_ratio)

    det_scale = float(new_h) / float(max(1, img_h))
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    det_img = np.zeros((in_h, in_w, 3), dtype=np.uint8)
    det_img[:new_h, :new_w, :] = resized

    blob = cv2.dnn.blobFromImage(
        det_img, 1.0 / 128.0, (in_w, in_h), (127.5, 127.5, 127.5), swapRB=True
    )

    try:
        net_outs = session.run(None, {session.get_inputs()[0].name: blob})
    except Exception as e:
        log_info(f"SCRFD inference error: {e}")
        return []

    feat_strides = [8, 16, 32]
    num_anchors = 2
    scores_list = []
    boxes_list = []
    for idx, stride in enumerate(feat_strides):
        scores = net_outs[idx]
        bbox_preds = net_outs[idx + len(feat_strides)] * stride
        scores = np.squeeze(scores).astype(np.float32)  # (N,)
        bbox_preds = np.array(bbox_preds, dtype=np.float32)
        if bbox_preds.ndim == 3:
            bbox_preds = bbox_preds[0]

        fh = in_h // stride
        fw = in_w // stride
        anchor_centers = np.stack(np.mgrid[:fh, :fw][::-1], axis=-1).astype(np.float32)
        anchor_centers = (anchor_centers * stride).reshape((-1, 2))
        if num_anchors > 1:
            anchor_centers = np.stack([anchor_centers] * num_anchors, axis=1).reshape((-1, 2))

        pos = np.where(scores >= confidence_threshold)[0]
        if pos.size == 0:
            continue
        bboxes = distance2bbox(anchor_centers, bbox_preds)
        boxes_list.append(bboxes[pos])
        scores_list.append(scores[pos][:, None])

    if not boxes_list:
        return []

    bboxes = np.vstack(boxes_list) / float(max(1e-6, det_scale))
    scores = np.vstack(scores_list)
    dets = np.hstack((bboxes, scores)).astype(np.float32, copy=False)
    order = dets[:, 4].argsort()[::-1]
    dets = dets[order]
    keep = nms_xyxy(dets, nms_thresh)
    dets = dets[keep]
    return _dets_to_faces(dets, image.shape)


def detect_faces_retinaface_single(image: np.ndarray, confidence_threshold: float = 0.4,
                                   nms_thresh: float = 0.4) -> list:
    """Single-pass RetinaFace detection (AMD ONNX + standard ONNX fallback)."""
    session, model_kind = get_retinaface_face_detector()
    if session is None:
        return []

    input_meta = session.get_inputs()[0]
    input_name = input_meta.name
    shape = input_meta.shape
    if len(shape) != 4:
        return []

    if model_kind == "amd":
        input_h = int(shape[1])
        input_w = int(shape[2])
    else:
        input_h = int(shape[1]) if isinstance(shape[1], int) else 640
        input_w = int(shape[2]) if isinstance(shape[2], int) else 640

    img_h, img_w = image.shape[:2]
    ratio = min(float(input_w) / float(max(1, img_w)), float(input_h) / float(max(1, img_h)))
    new_w = max(1, int(round(img_w * ratio)))
    new_h = max(1, int(round(img_h * ratio)))
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    pad_x = (input_w - new_w) // 2
    pad_y = (input_h - new_h) // 2
    canvas = np.zeros((input_h, input_w, 3), dtype=np.float32)
    canvas[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = resized.astype(np.float32)

    if model_kind == "amd":
        network_input = np.expand_dims(canvas, axis=0)
        loc, conf, _ = session.run(None, {input_name: network_input})
        loc = loc[0].astype(np.float32)
        conf = conf[0].astype(np.float32)
        if loc.shape[0] == 0 or conf.shape[0] != loc.shape[0]:
            return []

        min_sizes = [[16, 32], [64, 128], [256, 512]]
        steps = [8, 16, 32]
        priors = []
        for k, step in enumerate(steps):
            fh = int(np.ceil(float(input_h) / float(step)))
            fw = int(np.ceil(float(input_w) / float(step)))
            for i in range(fh):
                for j in range(fw):
                    for ms in min_sizes[k]:
                        s_kx = ms / float(input_w)
                        s_ky = ms / float(input_h)
                        cx = (j + 0.5) * step / float(input_w)
                        cy = (i + 0.5) * step / float(input_h)
                        priors.append([cx, cy, s_kx, s_ky])
        priors = np.array(priors, dtype=np.float32)
        if priors.shape[0] != loc.shape[0]:
            log_info(f"RetinaFace prior mismatch: priors={priors.shape[0]} loc={loc.shape[0]}")
            return []

        x = conf - np.max(conf, axis=1, keepdims=True)
        e = np.exp(x)
        probs = e / np.maximum(1e-8, np.sum(e, axis=1, keepdims=True))
        scores = probs[:, 1]

        variances = [0.1, 0.2]
        boxes = np.concatenate(
            [
                priors[:, :2] + loc[:, :2] * variances[0] * priors[:, 2:],
                priors[:, 2:] * np.exp(np.clip(loc[:, 2:] * variances[1], -8.0, 8.0)),
            ],
            axis=1,
        )
        boxes[:, :2] -= boxes[:, 2:] / 2.0
        boxes[:, 2:] += boxes[:, :2]
        boxes[:, 0::2] *= float(input_w)
        boxes[:, 1::2] *= float(input_h)
    else:
        # Fallback decoder for the NHWC "standard conversion" checkpoint.
        network_input = np.expand_dims(canvas, axis=0)
        outs = session.run(None, {input_name: network_input})
        cls_heads = {}
        box_heads = {}
        for out in outs:
            arr = out[0] if out.ndim == 4 else out
            if arr.ndim != 3:
                continue
            h, _, c = arr.shape
            if h <= 0:
                continue
            stride = int(round(float(input_h) / float(h)))
            if c == 4:
                cls_heads[stride] = arr.astype(np.float32)
            elif c == 8:
                box_heads[stride] = arr.astype(np.float32)

        min_sizes = {8: [16, 32], 16: [64, 128], 32: [256, 512]}
        dets_accum = []
        for stride in [8, 16, 32]:
            if stride not in cls_heads or stride not in box_heads:
                continue
            cls = cls_heads[stride]
            bbox = box_heads[stride]
            fg_scores = np.stack([cls[:, :, 2], cls[:, :, 3]], axis=-1).reshape(-1)
            deltas = bbox.reshape(-1, 4)
            h, w = cls.shape[:2]
            anchors = []
            for iy in range(h):
                for ix in range(w):
                    cx = (ix + 0.5) * stride
                    cy = (iy + 0.5) * stride
                    for ms in min_sizes.get(stride, [stride * 2, stride * 4]):
                        anchors.append([cx, cy, float(ms), float(ms)])
            anchors = np.array(anchors, dtype=np.float32)
            if anchors.shape[0] != deltas.shape[0]:
                continue
            dx, dy, dw, dh = deltas[:, 0], deltas[:, 1], deltas[:, 2], deltas[:, 3]
            cx, cy, aw, ah = anchors[:, 0], anchors[:, 1], anchors[:, 2], anchors[:, 3]
            pcx = dx * aw + cx
            pcy = dy * ah + cy
            pw = np.exp(np.clip(dw, -8.0, 8.0)) * aw
            ph = np.exp(np.clip(dh, -8.0, 8.0)) * ah
            x1 = pcx - pw / 2.0
            y1 = pcy - ph / 2.0
            x2 = pcx + pw / 2.0
            y2 = pcy + ph / 2.0
            det = np.stack([x1, y1, x2, y2, fg_scores], axis=1)
            dets_accum.append(det)
        if not dets_accum:
            return []
        det_all = np.vstack(dets_accum).astype(np.float32)
        boxes = det_all[:, :4]
        scores = det_all[:, 4]

    # Map from detector input canvas back to original image coordinates.
    boxes[:, 0::2] = (boxes[:, 0::2] - float(pad_x)) / float(max(1e-6, ratio))
    boxes[:, 1::2] = (boxes[:, 1::2] - float(pad_y)) / float(max(1e-6, ratio))
    dets = np.hstack([boxes, scores.reshape(-1, 1)]).astype(np.float32)
    keep_thresh = max(0.05, float(confidence_threshold))
    dets = dets[dets[:, 4] >= keep_thresh]
    if dets.shape[0] == 0:
        return []
    keep = nms_xyxy(dets, nms_thresh)
    dets = dets[keep]
    return _dets_to_faces(dets, image.shape)


def detect_faces_multipass(image: np.ndarray, detector_type: str = "ultralight",
                           confidence_threshold: float = None, pass_scales: list = None) -> list:
    """Run face detection with configurable detector + multi-pass scales."""
    detector = resolve_runtime_detector(detector_type)
    scales = pass_scales if pass_scales is not None else KONTEXT_MULTI_PASS_SCALES
    if not scales:
        scales = [1.0]

    if confidence_threshold is None:
        confidence_threshold = get_detector_default_threshold(detector)

    img_h, img_w = image.shape[:2]
    det_rows = []

    for s in scales:
        s = float(s)
        if s <= 0:
            continue
        sw = max(64, int(round(img_w * s)))
        sh = max(64, int(round(img_h * s)))
        scaled = cv2.resize(image, (sw, sh), interpolation=cv2.INTER_LINEAR)
        pass_threshold = float(confidence_threshold)
        if s > 1.05:
            pass_threshold = min(0.95, pass_threshold + 0.03)
        elif s < 0.95:
            pass_threshold = max(0.05, pass_threshold - 0.03)

        try:
            if detector == "scrfd":
                faces = detect_faces_scrfd_single(scaled, confidence_threshold=pass_threshold)
            elif detector == "retinaface":
                faces = detect_faces_retinaface_single(scaled, confidence_threshold=pass_threshold)
            else:
                faces = detect_faces_ultra_light(scaled, confidence_threshold=pass_threshold)
        except Exception as e:
            log_info(f"[FACE DET] {detector} pass@{s:.2f} failed: {e}")
            faces = []

        for f in faces:
            x, y, w, h = f["bbox"]
            x1 = float(x) / s
            y1 = float(y) / s
            x2 = float(x + w) / s
            y2 = float(y + h) / s
            det_rows.append([x1, y1, x2, y2, float(f.get("confidence", 0.0))])

    if not det_rows:
        return []

    dets = np.array(det_rows, dtype=np.float32)
    keep = nms_xyxy(dets, iou_threshold=0.45)
    merged = dets[keep]
    return _dets_to_faces(merged, image.shape)

def build_face_crop_region_from_bbox(face_bbox: tuple, image_shape: tuple,
                                     expand_top: float = 0.6, expand_sides: float = 0.3,
                                     expand_bottom: float = 0.2) -> tuple:
    """Build expanded face crop region from a detector bbox."""
    if face_bbox is None:
        return None
    try:
        x, y, w, h = [int(v) for v in face_bbox]
    except Exception:
        return None

    img_h, img_w = image_shape[:2]
    if img_h <= 0 or img_w <= 0 or w <= 0 or h <= 0:
        return None

    crop_x = max(0, x - int(round(w * expand_sides)))
    crop_y = max(0, y - int(round(h * expand_top)))
    crop_x2 = min(img_w, x + w + int(round(w * expand_sides)))
    crop_y2 = min(img_h, y + h + int(round(h * expand_bottom)))
    crop_w = max(1, crop_x2 - crop_x)
    crop_h = max(1, crop_y2 - crop_y)
    return (crop_x, crop_y, crop_w, crop_h)

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
    
    crop_region = build_face_crop_region_from_bbox((x, y, w, h), image.shape)
    if crop_region is None:
        crop_region = (x, y, w, h)
    
    return {
        "face_found": True,
        "faces": faces,
        "crop_region": crop_region,
        "message": f"Face detected with {largest_face['confidence']*100:.1f}% confidence"
    }

def resolve_dynamic_hair_neck_class_ids(seg_map: np.ndarray, face_bbox: tuple = None) -> tuple:
    """
    Resolve hair/neck class ids from the current model output.
    Handles model variants where class ids differ from fixed constants.
    """
    h, w = seg_map.shape[:2]
    total = float(max(1, h * w))

    top_roi = np.zeros((h, w), dtype=np.uint8)
    side_roi = np.zeros((h, w), dtype=np.uint8)
    lower_roi = np.zeros((h, w), dtype=np.uint8)
    center_lower_roi = np.zeros((h, w), dtype=np.uint8)
    face_roi = np.zeros((h, w), dtype=np.uint8)

    face_area = 0
    if face_bbox is not None:
        fx, fy, fw, fh = [int(v) for v in face_bbox]
        fx2 = min(w - 1, fx + fw)
        fy2 = min(h - 1, fy + fh)
        face_roi[max(0, fy):fy2 + 1, max(0, fx):fx2 + 1] = 1
        face_area = int(max(1, fw * fh))

        tx1 = max(0, fx - int(0.7 * fw))
        tx2 = min(w - 1, fx + int(1.7 * fw))
        ty1 = max(0, fy - int(0.9 * fh))
        ty2 = min(h - 1, fy + int(0.45 * fh))
        top_roi[ty1:ty2 + 1, tx1:tx2 + 1] = 1

        ly1 = max(0, fy + int(0.25 * fh))
        ly2 = min(h - 1, fy + int(2.0 * fh))
        lx1 = max(0, fx - int(1.15 * fw))
        lx2 = min(w - 1, fx + int(0.12 * fw))
        rx1 = max(0, fx + int(0.88 * fw))
        rx2 = min(w - 1, fx + int(2.15 * fw))
        side_roi[ly1:ly2 + 1, lx1:lx2 + 1] = 1
        side_roi[ly1:ly2 + 1, rx1:rx2 + 1] = 1

        lower_roi[max(0, fy + int(0.9 * fh)):, :] = 1
        cx1 = max(0, fx + int(0.10 * fw))
        cx2 = min(w - 1, fx + int(0.90 * fw))
        cy1 = max(0, fy + int(0.85 * fh))
        center_lower_roi[cy1:, cx1:cx2 + 1] = 1
    else:
        top_roi[:int(0.42 * h), :] = 1
        lower_roi[int(0.60 * h):, :] = 1
        center_lower_roi[int(0.55 * h):, int(0.30 * w):int(0.70 * w)] = 1
        side_roi[int(0.15 * h):int(0.80 * h), :int(0.22 * w)] = 1
        side_roi[int(0.15 * h):int(0.80 * h), int(0.78 * w):] = 1

    candidates = [int(cid) for cid in np.unique(seg_map) if int(cid) != 0]

    best_hair_id = None
    best_hair_score = -1e9
    min_hair_pixels = max(600, int(0.004 * h * w))
    if face_area > 0:
        min_hair_pixels = max(min_hair_pixels, int(0.05 * face_area))

    for cid in candidates:
        if cid == SKIN_CLASS_ID:
            continue
        mask = (seg_map == cid).astype(np.uint8)
        area = int(np.sum(mask))
        if area < min_hair_pixels:
            continue
        area_ratio = area / total
        top_ratio = float(np.sum(mask & top_roi)) / float(max(1, area))
        side_ratio = float(np.sum(mask & side_roi)) / float(max(1, area))
        lower_ratio = float(np.sum(mask & lower_roi)) / float(max(1, area))
        center_lower_ratio = float(np.sum(mask & center_lower_roi)) / float(max(1, area))
        face_ratio = float(np.sum(mask & face_roi)) / float(max(1, area))

        score = (
            2.8 * top_ratio +
            2.1 * side_ratio -
            3.4 * center_lower_ratio -
            2.2 * lower_ratio -
            2.0 * face_ratio
        )
        if area_ratio < 0.01:
            score -= 2.5
        if area_ratio > 0.35:
            score -= 2.0

        if score > best_hair_score:
            best_hair_score = score
            best_hair_id = cid

    best_neck_id = None
    best_neck_score = -1e9
    min_neck_pixels = max(200, int(0.001 * h * w))
    if face_area > 0:
        min_neck_pixels = max(min_neck_pixels, int(0.01 * face_area))

    for cid in candidates:
        if cid == SKIN_CLASS_ID:
            continue
        mask = (seg_map == cid).astype(np.uint8)
        area = int(np.sum(mask))
        if area < min_neck_pixels:
            continue
        top_ratio = float(np.sum(mask & top_roi)) / float(max(1, area))
        side_ratio = float(np.sum(mask & side_roi)) / float(max(1, area))
        lower_ratio = float(np.sum(mask & lower_roi)) / float(max(1, area))
        center_lower_ratio = float(np.sum(mask & center_lower_roi)) / float(max(1, area))
        face_ratio = float(np.sum(mask & face_roi)) / float(max(1, area))

        score = (
            3.8 * center_lower_ratio +
            2.0 * lower_ratio -
            2.4 * top_ratio -
            1.6 * side_ratio -
            1.2 * face_ratio
        )
        if score > best_neck_score:
            best_neck_score = score
            best_neck_id = cid

    resolved_hair = best_hair_id if best_hair_id is not None else HAIR_CLASS_ID
    resolved_neck = best_neck_id if best_neck_id is not None else NECK_ID
    return resolved_hair, resolved_neck

def get_dynamic_hair_neck_ids_for_image(image: np.ndarray, face_crop_region: tuple = None,
                                        detector_type: str = "ultralight") -> tuple:
    """
    Resolve dynamic hair/neck ids for a full image by probing a 512-scale segmentation.
    """
    face_bbox = None
    try:
        faces = detect_faces_multipass(
            image,
            detector_type=detector_type,
            confidence_threshold=None,
            pass_scales=[1.0]
        )
        if faces:
            face_bbox = faces[0]["bbox"]
    except Exception:
        face_bbox = None

    if face_bbox is None and face_crop_region is not None:
        cx, cy, cw, ch = [int(v) for v in face_crop_region]
        face_bbox = (cx, cy, cw, ch)

    session = get_session()
    probe_seg = segment_at_scale(image, 512, session)
    return resolve_dynamic_hair_neck_class_ids(probe_seg, face_bbox)

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


def get_modnet_session():
    """Load MODNet ONNX model with optimized settings."""
    global _modnet_session
    if _modnet_session is not None:
        return _modnet_session

    if not MODNET_MODEL_PATH.exists():
        return None

    try:
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = 4
        opts.inter_op_num_threads = 1
        _modnet_session = ort.InferenceSession(
            str(MODNET_MODEL_PATH),
            sess_options=opts,
            providers=['CPUExecutionProvider']
        )
        log_debug(f"[MATTING] Loaded MODNet model: {MODNET_MODEL_PATH}")
        return _modnet_session
    except Exception as e:
        log_info(f"[MATTING] Failed to load MODNet model ({MODNET_MODEL_PATH}): {e}")
        return None

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


def composite_with_feather(
    image: np.ndarray,
    keep_mask: np.ndarray,
    exclusion_mask: np.ndarray = None,
    feather_px: int = 6,
    guided_radius: int = 8,
    guided_eps: float = 0.01
) -> np.ndarray:
    """
    Composite image over gray background with edge feathering.
    Uses signed-distance feathering, then guided-filter refinement on boundary band.
    """
    keep_bin = (keep_mask > 0).astype(np.uint8)
    if exclusion_mask is not None:
        keep_bin[exclusion_mask > 0] = 0

    # Fast hard-edge path when feathering disabled.
    if feather_px <= 0:
        out = np.full_like(image, GRAY_BG, dtype=np.uint8)
        out[keep_bin > 0] = image[keep_bin > 0]
        return out

    inside_dist = cv2.distanceTransform(keep_bin, cv2.DIST_L2, 5)
    outside_dist = cv2.distanceTransform((1 - keep_bin).astype(np.uint8), cv2.DIST_L2, 5)
    signed_dist = inside_dist - outside_dist

    feather = float(max(1, int(feather_px)))
    alpha = np.clip((signed_dist + feather) / (2.0 * feather), 0.0, 1.0)
    alpha[inside_dist >= feather] = 1.0
    alpha[outside_dist >= feather] = 0.0

    band = ((inside_dist < feather * 1.5) & (outside_dist < feather * 1.5)).astype(np.uint8)
    if guided_radius > 0 and np.any(band):
        alpha_255 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
        guided_alpha = guided_filter(image, alpha_255, radius=guided_radius, eps=guided_eps).astype(np.float32) / 255.0
        alpha = np.where(band > 0, guided_alpha, alpha)

    if exclusion_mask is not None:
        alpha[exclusion_mask > 0] = 0.0

    alpha3 = np.repeat(alpha[:, :, None], 3, axis=2)
    image_f = image.astype(np.float32)
    bg_f = np.full_like(image_f, GRAY_BG, dtype=np.float32)
    comp = image_f * alpha3 + bg_f * (1.0 - alpha3)
    return np.clip(comp, 0, 255).astype(np.uint8)


def build_trimap_from_mask(
    mask: np.ndarray,
    exclusion_mask: np.ndarray = None,
    fg_erode_px: int = 3,
    unknown_dilate_px: int = 9,
    min_area_ratio: float = 0.0002
) -> tuple:
    """
    Build a 3-class trimap from a hard mask.

    Trimap convention:
      - 255: definite foreground
      - 128: unknown boundary band
      - 0:   definite background
    """
    keep = (mask > 0).astype(np.uint8) * 255
    keep = cleanup_mask(keep, min_area_ratio=min_area_ratio)

    if exclusion_mask is not None:
        keep = keep.copy()
        keep[exclusion_mask > 0] = 0

    keep_bin = (keep > 0).astype(np.uint8)

    if fg_erode_px > 0:
        fg_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (fg_erode_px * 2 + 1, fg_erode_px * 2 + 1)
        )
        definite_fg = cv2.erode(keep_bin, fg_kernel, iterations=1)
    else:
        definite_fg = keep_bin.copy()

    if unknown_dilate_px > 0:
        unk_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (unknown_dilate_px * 2 + 1, unknown_dilate_px * 2 + 1)
        )
        unknown_extent = cv2.dilate(keep_bin, unk_kernel, iterations=1)
    else:
        unknown_extent = keep_bin.copy()

    if exclusion_mask is not None:
        definite_fg[exclusion_mask > 0] = 0
        unknown_extent[exclusion_mask > 0] = 0

    trimap = np.zeros_like(keep_bin, dtype=np.uint8)
    trimap[unknown_extent > 0] = 128
    trimap[definite_fg > 0] = 255

    unknown_band = ((trimap == 128)).astype(np.uint8)
    log_debug(
        f"[TRIMAP] fg={np.sum(definite_fg)} "
        f"unknown={np.sum(unknown_band)} bg={np.sum(trimap == 0)} "
        f"(erode={fg_erode_px}px, dilate={unknown_dilate_px}px)"
    )
    return trimap, definite_fg, unknown_band


def estimate_alpha_from_trimap(
    image: np.ndarray,
    trimap: np.ndarray,
    guided_radius: int = 8,
    guided_eps: float = 0.008
) -> np.ndarray:
    """
    Estimate an alpha matte from trimap seeds.
    Refines only unknown pixels while keeping FG/BG seeds fixed.
    """
    fg = trimap == 255
    bg = trimap == 0
    unknown = trimap == 128

    alpha = np.zeros(trimap.shape, dtype=np.float32)
    alpha[fg] = 1.0

    if np.any(unknown):
        # Distance ratio gives a smooth initialization inside unknown band.
        dist_to_fg = cv2.distanceTransform((~fg).astype(np.uint8), cv2.DIST_L2, 5)
        dist_to_bg = cv2.distanceTransform((~bg).astype(np.uint8), cv2.DIST_L2, 5)
        denom = dist_to_fg + dist_to_bg + 1e-6
        init_unknown = np.clip(dist_to_bg / denom, 0.0, 1.0)
        alpha[unknown] = init_unknown[unknown]

        alpha_u8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
        refined = guided_filter(
            image,
            alpha_u8,
            radius=max(1, int(guided_radius)),
            eps=float(guided_eps)
        ).astype(np.float32) / 255.0
        alpha[unknown] = refined[unknown]

    alpha[fg] = 1.0
    alpha[bg] = 0.0
    return np.clip(alpha, 0.0, 1.0)


def _decode_modnet_matte(raw_output) -> np.ndarray:
    """Decode MODNet output to a 2D float matte in [0,1]."""
    arr = np.asarray(raw_output)
    if arr.ndim == 4:
        if arr.shape[1] == 1:
            matte = arr[0, 0]
        elif arr.shape[-1] == 1:
            matte = arr[0, :, :, 0]
        else:
            matte = arr[0, 0]
    elif arr.ndim == 3:
        matte = arr[0]
    elif arr.ndim == 2:
        matte = arr
    else:
        return None

    matte = matte.astype(np.float32)
    if np.max(matte) > 1.2 or np.min(matte) < -0.2:
        matte = 1.0 / (1.0 + np.exp(-np.clip(matte, -18.0, 18.0)))
    else:
        matte = np.clip(matte, 0.0, 1.0)
    return matte


def estimate_alpha_with_modnet(
    image: np.ndarray,
    trimap: np.ndarray = None,
    keep_mask: np.ndarray = None,
    exclusion_mask: np.ndarray = None,
    target_size: int = None
) -> np.ndarray:
    """
    Estimate alpha matte using MODNet ONNX.
    Falls back to None if MODNet is unavailable/inference fails.
    """
    session = get_modnet_session()
    if session is None:
        return None

    img_h, img_w = image.shape[:2]
    input_meta = session.get_inputs()[0]
    input_name = input_meta.name
    shape = input_meta.shape

    # Determine inference size; prefer model-declared static size.
    in_h, in_w = None, None
    if len(shape) == 4:
        if isinstance(shape[2], int) and shape[2] > 0:
            in_h = int(shape[2])
        if isinstance(shape[3], int) and shape[3] > 0:
            in_w = int(shape[3])

    if in_h is None or in_w is None:
        target = max(256, int(target_size if target_size is not None else MODNET_INPUT_SIZE))
        scale = target / float(max(1, max(img_h, img_w)))
        in_w = max(32, int(round((img_w * scale) / 32.0) * 32))
        in_h = max(32, int(round((img_h * scale) / 32.0) * 32))

    resized = cv2.resize(image, (in_w, in_h), interpolation=cv2.INTER_LINEAR)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    normalized = (rgb - 0.5) / 0.5
    network_input = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0).astype(np.float32)

    try:
        outs = session.run(None, {input_name: network_input})
    except Exception as e:
        log_info(f"[MATTING] MODNet inference failed: {e}")
        return None

    if not outs:
        return None

    matte = _decode_modnet_matte(outs[0])
    if matte is None:
        return None

    alpha = cv2.resize(matte, (img_w, img_h), interpolation=cv2.INTER_LINEAR)
    alpha = np.clip(alpha, 0.0, 1.0)

    # Constrain MODNet output with segmentation-derived priors for robustness.
    if trimap is not None:
        alpha[trimap == 255] = 1.0
        alpha[trimap == 0] = 0.0

    if keep_mask is not None:
        allowed = (keep_mask > 0)
        if trimap is not None:
            allowed = allowed | (trimap == 128)
        alpha[~allowed] = 0.0

    if exclusion_mask is not None:
        alpha[exclusion_mask > 0] = 0.0

    # Snap unknown band edges to image gradients while keeping seeds fixed.
    if trimap is not None and np.any(trimap == 128):
        alpha_u8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
        refined = guided_filter(
            image,
            alpha_u8,
            radius=max(6, int(round(min(img_h, img_w) * 0.02))),
            eps=0.006
        ).astype(np.float32) / 255.0
        unknown = trimap == 128
        alpha[unknown] = refined[unknown]
        alpha[trimap == 255] = 1.0
        alpha[trimap == 0] = 0.0

    return np.clip(alpha, 0.0, 1.0)


def decontaminate_edge_colors(
    image: np.ndarray,
    alpha: np.ndarray,
    unknown_band: np.ndarray = None,
    strength: float = 0.65
) -> np.ndarray:
    """
    Reduce background color spill on semi-transparent hair edges.
    Pulls edge colors toward nearby high-alpha foreground estimates.
    """
    s = float(np.clip(strength, 0.0, 1.0))
    if s <= 0.0:
        return image

    alpha_f = np.clip(alpha, 0.0, 1.0).astype(np.float32)
    if unknown_band is not None:
        edge = (unknown_band > 0) & (alpha_f > 0.01) & (alpha_f < 0.99)
    else:
        edge = (alpha_f > 0.01) & (alpha_f < 0.99)
    if not np.any(edge):
        return image

    img_f = image.astype(np.float32)
    w = np.clip(alpha_f, 0.0, 1.0) ** 2
    w3 = w[:, :, None]

    sigma = max(1.2, float(min(image.shape[:2])) * 0.012)
    num = cv2.GaussianBlur(img_f * w3, (0, 0), sigmaX=sigma, sigmaY=sigma)
    den = cv2.GaussianBlur(w, (0, 0), sigmaX=sigma, sigmaY=sigma)
    fg_est = num / np.maximum(den[:, :, None], 1e-4)

    t = np.clip(s * (1.0 - alpha_f), 0.0, 1.0)
    out = img_f.copy()
    out[edge] = img_f[edge] * (1.0 - t[edge, None]) + fg_est[edge] * t[edge, None]
    return np.clip(out, 0, 255).astype(np.uint8)


def composite_with_alpha(
    image: np.ndarray,
    alpha: np.ndarray,
    background: tuple = GRAY_BG
) -> np.ndarray:
    """Composite original image over a solid background using alpha matte."""
    alpha_f = np.clip(alpha, 0.0, 1.0).astype(np.float32)
    alpha3 = np.repeat(alpha_f[:, :, None], 3, axis=2)
    img_f = image.astype(np.float32)
    bg_f = np.full_like(img_f, background, dtype=np.float32)
    comp = img_f * alpha3 + bg_f * (1.0 - alpha3)
    return np.clip(comp, 0, 255).astype(np.uint8)


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


def softmax_channelwise(logits: np.ndarray) -> np.ndarray:
    """Softmax over class/channel axis for logits shaped [C,H,W]."""
    x = logits - np.max(logits, axis=0, keepdims=True)
    e = np.exp(x)
    return e / np.maximum(1e-8, np.sum(e, axis=0, keepdims=True))


def segment_logits_at_scale_standard(image: np.ndarray, scale: int, session) -> tuple:
    """
    Standard BiSeNet preprocessing (legacy square path), returning logits at original resolution.
    Returns: (seg_map_full, logits_full[C,H,W])
    """
    original_h, original_w = image.shape[:2]
    if scale != 512:
        scaled = cv2.resize(image, (scale, scale), interpolation=cv2.INTER_LINEAR)
        resized = cv2.resize(scaled, (512, 512), interpolation=cv2.INTER_LINEAR)
    else:
        resized = cv2.resize(image, (512, 512), interpolation=cv2.INTER_LINEAR)

    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    normalized = rgb.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normalized = (normalized - mean) / std
    batched = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0)

    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: batched})
    logits_512 = outputs[0][0].astype(np.float32)  # [C,512,512]
    channels = logits_512.shape[0]
    logits_full = np.zeros((channels, original_h, original_w), dtype=np.float32)
    for c in range(channels):
        logits_full[c] = cv2.resize(logits_512[c], (original_w, original_h), interpolation=cv2.INTER_LINEAR)
    seg_map_full = np.argmax(logits_full, axis=0).astype(np.uint8)
    return seg_map_full, logits_full


def segment_logits_at_scale_aspect(image: np.ndarray, scale: int, session) -> tuple:
    """
    Run BiSeNet inference using aspect-ratio preserving preprocessing.
    Returns: (seg_map_full, logits_full[C,H,W])
    """
    original_h, original_w = image.shape[:2]
    if original_h <= 0 or original_w <= 0:
        raise ValueError("Invalid image size")

    target_long = int(max(256, scale))
    long_side = float(max(original_h, original_w))
    resize_ratio = target_long / long_side
    scaled_w = max(1, int(round(original_w * resize_ratio)))
    scaled_h = max(1, int(round(original_h * resize_ratio)))
    scaled = cv2.resize(image, (scaled_w, scaled_h), interpolation=cv2.INTER_LINEAR)

    model_size = 512
    fit_ratio = min(float(model_size) / float(scaled_w), float(model_size) / float(scaled_h))
    fit_w = max(1, int(round(scaled_w * fit_ratio)))
    fit_h = max(1, int(round(scaled_h * fit_ratio)))
    fit_img = cv2.resize(scaled, (fit_w, fit_h), interpolation=cv2.INTER_LINEAR)

    pad_x = (model_size - fit_w) // 2
    pad_y = (model_size - fit_h) // 2
    pad_left = pad_x
    pad_right = model_size - fit_w - pad_x
    pad_top = pad_y
    pad_bottom = model_size - fit_h - pad_y
    # Reflect padding avoids introducing large flat-black regions that bias parsing.
    canvas = cv2.copyMakeBorder(
        fit_img,
        pad_top, pad_bottom, pad_left, pad_right,
        borderType=cv2.BORDER_REFLECT_101
    )

    rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
    normalized = rgb.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normalized = (normalized - mean) / std
    batched = np.expand_dims(np.transpose(normalized, (2, 0, 1)), axis=0)

    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: batched})
    logits_512 = outputs[0][0].astype(np.float32)  # [C,512,512]

    logits_crop = logits_512[:, pad_y:pad_y + fit_h, pad_x:pad_x + fit_w]
    channels = logits_crop.shape[0]
    logits_full = np.zeros((channels, original_h, original_w), dtype=np.float32)
    for c in range(channels):
        logits_full[c] = cv2.resize(
            logits_crop[c], (original_w, original_h), interpolation=cv2.INTER_LINEAR
        )

    seg_map_full = np.argmax(logits_full, axis=0).astype(np.uint8)
    return seg_map_full, logits_full


def build_spatial_rois(h: int, w: int, face_bbox: tuple = None) -> tuple:
    top_roi = np.zeros((h, w), dtype=np.uint8)
    side_roi = np.zeros((h, w), dtype=np.uint8)
    lower_roi = np.zeros((h, w), dtype=np.uint8)
    center_lower_roi = np.zeros((h, w), dtype=np.uint8)
    face_roi = np.zeros((h, w), dtype=np.uint8)

    if face_bbox is not None:
        fx, fy, fw, fh = [int(v) for v in face_bbox]
        fx2 = min(w - 1, fx + fw)
        fy2 = min(h - 1, fy + fh)
        face_roi[max(0, fy):fy2 + 1, max(0, fx):fx2 + 1] = 1

        tx1 = max(0, fx - int(0.7 * fw))
        tx2 = min(w - 1, fx + int(1.7 * fw))
        ty1 = max(0, fy - int(0.9 * fh))
        ty2 = min(h - 1, fy + int(0.45 * fh))
        top_roi[ty1:ty2 + 1, tx1:tx2 + 1] = 1

        ly1 = max(0, fy + int(0.25 * fh))
        ly2 = min(h - 1, fy + int(2.0 * fh))
        lx1 = max(0, fx - int(1.15 * fw))
        lx2 = min(w - 1, fx + int(0.12 * fw))
        rx1 = max(0, fx + int(0.88 * fw))
        rx2 = min(w - 1, fx + int(2.15 * fw))
        side_roi[ly1:ly2 + 1, lx1:lx2 + 1] = 1
        side_roi[ly1:ly2 + 1, rx1:rx2 + 1] = 1

        lower_roi[max(0, fy + int(0.9 * fh)):, :] = 1
        cx1 = max(0, fx + int(0.10 * fw))
        cx2 = min(w - 1, fx + int(0.90 * fw))
        cy1 = max(0, fy + int(0.85 * fh))
        center_lower_roi[cy1:, cx1:cx2 + 1] = 1
    else:
        top_roi[:int(0.42 * h), :] = 1
        lower_roi[int(0.60 * h):, :] = 1
        center_lower_roi[int(0.55 * h):, int(0.30 * w):int(0.70 * w)] = 1
        side_roi[int(0.15 * h):int(0.80 * h), :int(0.22 * w)] = 1
        side_roi[int(0.15 * h):int(0.80 * h), int(0.78 * w):] = 1
    return top_roi, side_roi, lower_roi, center_lower_roi, face_roi


def resolve_dynamic_hair_neck_class_ids_scored(avg_probs: np.ndarray, face_bbox: tuple = None) -> tuple:
    """
    Model-score based class ID selection using averaged probability maps.
    avg_probs shape: [C,H,W]
    """
    c, h, w = avg_probs.shape
    top_roi, side_roi, lower_roi, center_lower_roi, face_roi = build_spatial_rois(h, w, face_bbox)
    head_roi = np.zeros((h, w), dtype=np.uint8)
    face_area = max(1, int(0.06 * h * w))
    face_bottom_ratio = 0.58
    if face_bbox is not None:
        fx, fy, fw, fh = [int(v) for v in face_bbox]
        face_area = max(1, int(fw * fh))
        face_bottom_ratio = float(min(h - 1, fy + fh)) / float(max(1, h))
        hx1 = max(0, fx - int(0.85 * fw))
        hx2 = min(w - 1, fx + int(1.85 * fw))
        hy1 = max(0, fy - int(1.05 * fh))
        hy2 = min(h - 1, fy + int(1.05 * fh))
        head_roi[hy1:hy2 + 1, hx1:hx2 + 1] = 1
    else:
        head_roi[:int(0.60 * h), :] = 1

    face_ring_roi = np.zeros((h, w), dtype=np.uint8)
    if np.any(face_roi):
        ring_k = max(15, (int(round(min(h, w) * 0.10)) | 1))
        ring_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ring_k, ring_k))
        face_ring_roi = cv2.dilate(face_roi, ring_kernel, iterations=1)
        face_ring_roi[face_roi > 0] = 0

    argmax_map = np.argmax(avg_probs, axis=0).astype(np.uint8)
    all_candidates = [int(cid) for cid in np.unique(argmax_map) if int(cid) != 0]
    fallback_hair, fallback_neck = resolve_dynamic_hair_neck_class_ids(argmax_map, face_bbox)
    candidates = []
    for cid in [fallback_hair, HAIR_CLASS_ID, 13, 17, 18]:
        if 0 <= int(cid) < int(c) and int(cid) != SKIN_CLASS_ID and int(cid) not in candidates:
            candidates.append(int(cid))
    for cid in all_candidates:
        if cid in candidates or cid == SKIN_CLASS_ID:
            continue
        candidates.append(cid)

    total = float(max(1, h * w))
    min_hair_px = max(1200, int(0.010 * h * w), int(0.08 * face_area))
    max_hair_px = int(0.68 * h * w)

    best_hair = (None, -1e9)
    for cid in candidates:
        area_est = int(np.sum(argmax_map == cid))
        if area_est < min_hair_px or area_est > max_hair_px:
            continue
        p = avg_probs[cid]
        p_sum = float(np.sum(p)) + 1e-6
        top_score = float(np.sum(p[top_roi > 0])) / p_sum if np.any(top_roi) else 0.0
        side_score = float(np.sum(p[side_roi > 0])) / p_sum if np.any(side_roi) else 0.0
        lower_score = float(np.sum(p[lower_roi > 0])) / p_sum if np.any(lower_roi) else 0.0
        center_lower_score = float(np.sum(p[center_lower_roi > 0])) / p_sum if np.any(center_lower_roi) else 0.0
        face_score = float(np.sum(p[face_roi > 0])) / p_sum if np.any(face_roi) else 0.0
        head_score = float(np.sum(p[head_roi > 0])) / p_sum if np.any(head_roi) else 0.0
        ring_score = float(np.sum(p[face_ring_roi > 0])) / p_sum if np.any(face_ring_roi) else 0.0
        hi = float(np.percentile(p, 99.5))
        ys = np.where(argmax_map == cid)[0]
        centroid_y_ratio = float(np.mean(ys)) / float(max(1, h)) if ys.size > 0 else 1.0

        if head_score < 0.20:
            continue
        if lower_score > 0.82 or center_lower_score > 0.45:
            continue
        if face_bbox is not None and centroid_y_ratio > min(0.92, face_bottom_ratio + 0.26):
            continue
        if face_bbox is not None and center_lower_score > 0.24 and centroid_y_ratio > face_bottom_ratio + 0.16:
            continue

        hair_score = (
            3.4 * head_score +
            2.5 * top_score +
            2.2 * ring_score +
            1.6 * side_score +
            0.6 * hi +
            0.25 * np.log1p(float(area_est)) -
            3.2 * lower_score -
            4.2 * center_lower_score -
            1.9 * face_score
        )
        if area_est < int(0.015 * h * w):
            hair_score -= 1.5
        if cid == fallback_hair:
            hair_score += 0.35
        if hair_score > best_hair[1]:
            best_hair = (cid, hair_score)

    if best_hair[0] is not None:
        hair_id = best_hair[0]
    else:
        hair_id = None
        for cid in [13, HAIR_CLASS_ID, fallback_hair]:
            if int(cid) < 0 or int(cid) >= int(c):
                continue
            if int(cid) == SKIN_CLASS_ID:
                continue
            area_est = int(np.sum(argmax_map == int(cid)))
            if area_est >= max(800, int(0.002 * h * w)):
                hair_id = int(cid)
                break
        if hair_id is None:
            hair_id = fallback_hair

    neck_candidates = []
    for cid in [fallback_neck, NECK_ID, 17, 18]:
        if 0 <= int(cid) < int(c) and int(cid) not in neck_candidates and int(cid) != SKIN_CLASS_ID:
            neck_candidates.append(int(cid))
    for cid in all_candidates:
        if cid in neck_candidates or cid == SKIN_CLASS_ID:
            continue
        if cid in {LEFT_EYE_ID, RIGHT_EYE_ID, LEFT_EYEBROW_ID, RIGHT_EYEBROW_ID, NOSE_ID, MOUTH_ID, UPPER_LIP_ID, LOWER_LIP_ID}:
            continue
        neck_candidates.append(cid)

    best_neck = (None, -1e9)
    min_neck_px = max(300, int(0.004 * h * w), int(0.02 * face_area))
    for cid in neck_candidates:
        area_est = int(np.sum(argmax_map == cid))
        if area_est < min_neck_px:
            continue
        p = avg_probs[cid]
        p_sum = float(np.sum(p)) + 1e-6
        top_score = float(np.sum(p[top_roi > 0])) / p_sum if np.any(top_roi) else 0.0
        side_score = float(np.sum(p[side_roi > 0])) / p_sum if np.any(side_roi) else 0.0
        lower_score = float(np.sum(p[lower_roi > 0])) / p_sum if np.any(lower_roi) else 0.0
        center_lower_score = float(np.sum(p[center_lower_roi > 0])) / p_sum if np.any(center_lower_roi) else 0.0
        face_score = float(np.sum(p[face_roi > 0])) / p_sum if np.any(face_roi) else 0.0

        neck_score = (
            3.8 * center_lower_score +
            2.2 * lower_score -
            2.0 * top_score -
            1.4 * side_score -
            1.2 * face_score
        )
        if cid == fallback_neck:
            neck_score += 0.2
        if neck_score > best_neck[1]:
            best_neck = (cid, neck_score)

    neck_id = best_neck[0] if best_neck[0] is not None else fallback_neck
    if neck_id == hair_id:
        neck_id = fallback_neck if fallback_neck != hair_id else NECK_ID
    return hair_id, neck_id


def compute_face_focus_crop(image_shape: tuple, face_bbox: tuple = None) -> tuple:
    """Build a face-centered crop for context-aware segmentation."""
    h, w = image_shape[:2]
    if face_bbox is None:
        return (0, 0, w, h), None

    fx, fy, fw, fh = [int(v) for v in face_bbox]
    x1 = max(0, fx - int(0.65 * fw))
    x2 = min(w, fx + fw + int(0.65 * fw))
    y1 = max(0, fy - int(0.95 * fh))
    y2 = min(h, fy + fh + int(0.95 * fh))

    crop_w = x2 - x1
    crop_h = y2 - y1
    min_w = max(220, int(1.8 * fw))
    min_h = max(280, int(2.0 * fh))
    if crop_w < min_w:
        pad = (min_w - crop_w) // 2 + 1
        x1 = max(0, x1 - pad)
        x2 = min(w, x2 + pad)
    if crop_h < min_h:
        pad = (min_h - crop_h) // 2 + 1
        y1 = max(0, y1 - pad)
        y2 = min(h, y2 + pad)

    crop_w = max(1, x2 - x1)
    crop_h = max(1, y2 - y1)
    local_face = (
        max(0, fx - x1),
        max(0, fy - y1),
        min(crop_w - 1, fw),
        min(crop_h - 1, fh)
    )
    return (x1, y1, crop_w, crop_h), local_face


def multi_scale_segment_hair_aspect_scored(
    image: np.ndarray,
    scales: list = [512, 768, 1024],
    face_bbox: tuple = None
) -> tuple:
    """
    Aspect-ratio-preserving multi-scale segmentation with model-score class selection.
    Returns: (hair_mask, facial_mask, hair_class_id, neck_class_id)
    """
    session = get_session()
    full_h, full_w = image.shape[:2]
    crop_region, local_face_bbox = compute_face_focus_crop(image.shape, face_bbox)
    crop_x, crop_y, crop_w, crop_h = crop_region
    crop_img = image[crop_y:crop_y + crop_h, crop_x:crop_x + crop_w]

    probs_list = []
    seg_maps = []
    for scale in scales:
        seg_map, logits = segment_logits_at_scale_aspect(crop_img, scale, session)
        probs = softmax_channelwise(logits)
        seg_maps.append(seg_map)
        probs_list.append(probs)

    avg_probs = np.mean(np.stack(probs_list, axis=0), axis=0)
    hair_class_id, neck_class_id = resolve_dynamic_hair_neck_class_ids_scored(avg_probs, local_face_bbox)
    argmax_avg = np.argmax(avg_probs, axis=0).astype(np.uint8)

    hair_prob = avg_probs[hair_class_id]
    hair_seed = hair_prob[argmax_avg == hair_class_id]
    if hair_seed.size > 0:
        thr = max(0.16, float(np.percentile(hair_seed, 32.0)))
    else:
        thr = 0.30
    hair_mask = ((argmax_avg == hair_class_id) | (hair_prob >= max(0.35, thr))).astype(np.uint8)

    if local_face_bbox is not None:
        fx, fy, fw, fh = [int(v) for v in local_face_bbox]
        gx1 = max(0, fx - int(0.45 * fw))
        gx2 = min(crop_w, fx + fw + int(0.45 * fw))
        gy1 = max(0, fy - int(0.95 * fh))
        gy2 = min(crop_h, fy + fh + int(1.35 * fh))
        allowed = np.zeros((crop_h, crop_w), dtype=np.uint8)
        allowed[gy1:gy2, gx1:gx2] = 1
        hair_mask = hair_mask & allowed.astype(np.uint8)

    min_hair_px = max(1200, int(0.006 * crop_h * crop_w))
    if int(np.sum(hair_mask)) < min_hair_px:
        hair_mask = np.zeros((crop_h, crop_w), dtype=np.uint8)
        for seg in seg_maps:
            hair_mask = hair_mask | (seg == hair_class_id).astype(np.uint8)

    # Face exclusion mask: use detector bbox geometry as primary, with skin class as secondary.
    facial_mask = np.zeros((crop_h, crop_w), dtype=np.uint8)
    if local_face_bbox is not None:
        fx, fy, fw, fh = [int(v) for v in local_face_bbox]
        fx1 = max(0, fx - int(0.10 * fw))
        fx2 = min(crop_w, fx + fw + int(0.10 * fw))
        fy1 = max(0, fy - int(0.06 * fh))
        fy2 = min(crop_h, fy + fh + int(0.22 * fh))
        facial_mask[fy1:fy2, fx1:fx2] = 1
    facial_mask = facial_mask | (argmax_avg == SKIN_CLASS_ID).astype(np.uint8)
    hair_mask[facial_mask > 0] = 0

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    hair_mask = cv2.morphologyEx(hair_mask, cv2.MORPH_OPEN, kernel)
    hair_mask = cv2.morphologyEx(hair_mask, cv2.MORPH_CLOSE, kernel)

    full_hair_mask = np.zeros((full_h, full_w), dtype=np.uint8)
    full_facial_mask = np.zeros((full_h, full_w), dtype=np.uint8)
    full_hair_mask[crop_y:crop_y + crop_h, crop_x:crop_x + crop_w] = hair_mask
    full_facial_mask[crop_y:crop_y + crop_h, crop_x:crop_x + crop_w] = facial_mask
    return full_hair_mask.astype(np.uint8), full_facial_mask.astype(np.uint8), hair_class_id, neck_class_id


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


def multi_scale_segment_hair_segformer(image: np.ndarray, scales: list = [512, 768, 1024],
                                       hair_class_id = None,
                                       neck_class_id = None) -> tuple:
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
    
    if hair_class_id is None or neck_class_id is None:
        resolved_hair, resolved_neck = get_dynamic_hair_neck_ids_for_image(image)
        if hair_class_id is None:
            hair_class_id = resolved_hair
        if neck_class_id is None:
            neck_class_id = resolved_neck

    # Initialize vote counters
    hair_votes = np.zeros((original_h, original_w), dtype=np.float32)
    facial_votes = np.zeros((original_h, original_w), dtype=np.float32)
    
    # Run inference at each scale
    for scale in scales:
        seg_map = segment_at_scale_segformer(image, scale, session)
        
        # Accumulate hair votes
        hair_votes += (seg_map == hair_class_id).astype(np.float32)
        
        # Accumulate facial feature votes (eyes, eyebrows, nose, mouth, lips)
        facial_mask = np.zeros_like(seg_map, dtype=np.float32)
        for class_id in [LEFT_EYE_ID, RIGHT_EYE_ID, LEFT_EYEBROW_ID, RIGHT_EYEBROW_ID,
                         NOSE_ID, UPPER_LIP_ID, LOWER_LIP_ID, MOUTH_ID]:
            facial_mask += (seg_map == class_id).astype(np.float32)
        facial_votes += (facial_mask > 0).astype(np.float32)
    
    # Use majority voting (>= half the scales)
    threshold = len(scales) / 2
    hair_mask = (hair_votes >= threshold).astype(np.uint8)
    facial_features_mask = (facial_votes >= threshold).astype(np.uint8)
    
    log_debug(f"[SEGFORMER MULTI-SCALE] Scales: {scales}, hair pixels: {np.sum(hair_mask)}, facial pixels: {np.sum(facial_features_mask)}")
    
    return hair_mask, facial_features_mask


def segment_hair_focused_segformer(image: np.ndarray, face_crop_region: tuple = None, 
                                     scales: list = [512, 768, 1024],
                                     hair_class_id = None,
                                     neck_class_id = None) -> tuple:
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
        return multi_scale_segment_hair_segformer(image, scales, hair_class_id, neck_class_id)
    
    crop_x, crop_y, crop_w, crop_h = face_crop_region
    
    # Validate crop region
    if crop_w < 100 or crop_h < 100:
        log_debug(f"[SEGFORMER FOCUSED] Crop region too small ({crop_w}x{crop_h}) - using full image")
        return multi_scale_segment_hair_segformer(image, scales, hair_class_id, neck_class_id)
    
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
    cropped_hair_mask, cropped_facial_mask = multi_scale_segment_hair_segformer(
        cropped_image, focused_scales, hair_class_id, neck_class_id
    )
    
    # Map masks back to original image coordinates
    full_hair_mask = np.zeros((original_h, original_w), dtype=np.uint8)
    full_facial_mask = np.zeros((original_h, original_w), dtype=np.uint8)
    
    # Place the cropped masks in their original positions
    full_hair_mask[crop_y:crop_y+crop_h, crop_x:crop_x+crop_w] = cropped_hair_mask
    full_facial_mask[crop_y:crop_y+crop_h, crop_x:crop_x+crop_w] = cropped_facial_mask
    
    total_hair_pixels = np.sum(full_hair_mask)
    log_debug(f"[SEGFORMER FOCUSED] Result: {total_hair_pixels} hair pixels in focused region")
    
    return full_hair_mask, full_facial_mask


def multi_scale_segment_hair(image: np.ndarray, scales: list = [512, 768, 1024],
                             hair_class_id = None,
                             neck_class_id = None) -> tuple:
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
    
    if hair_class_id is None or neck_class_id is None:
        resolved_hair, resolved_neck = get_dynamic_hair_neck_ids_for_image(image)
        if hair_class_id is None:
            hair_class_id = resolved_hair
        if neck_class_id is None:
            neck_class_id = resolved_neck

    log_debug(f"[MULTI-SCALE] Running segmentation at scales: {scales} (hair={hair_class_id}, neck={neck_class_id})")
    
    # Collect hair masks and facial feature masks from each scale
    hair_masks = []
    facial_masks = []
    
    for scale in scales:
        seg_map = segment_at_scale(image, scale, session)
        
        # Extract hair mask using resolved hair class id
        hair_mask = (seg_map == hair_class_id).astype(np.uint8)
        
        # Fallback: try alternate known hair class ids when current class is weak
        hair_pixels = np.sum(hair_mask)
        if hair_pixels < 1000:
            alt_ids = [HAIR_CLASS_ID, 13]
            for alt_id in alt_ids:
                if alt_id == hair_class_id:
                    continue
                alt_mask = (seg_map == alt_id).astype(np.uint8)
                alt_pixels = np.sum(alt_mask)
                if alt_pixels > hair_pixels:
                    hair_mask = alt_mask
                    hair_pixels = alt_pixels
                    log_debug(f"[MULTI-SCALE] Scale {scale}: Using alt class {alt_id} ({alt_pixels} px)")
        
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
            (seg_map == neck_class_id)
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
                          scales: list = [512, 768, 1024],
                          hair_class_id = None,
                          neck_class_id = None) -> tuple:
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
        return multi_scale_segment_hair(image, scales, hair_class_id, neck_class_id)
    
    crop_x, crop_y, crop_w, crop_h = face_crop_region
    
    # Validate crop region
    if crop_w < 100 or crop_h < 100:
        log_debug(f"[FOCUSED] Crop region too small ({crop_w}x{crop_h}) - using full image")
        return multi_scale_segment_hair(image, scales, hair_class_id, neck_class_id)
    
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
    cropped_hair_mask, cropped_facial_mask = multi_scale_segment_hair(
        cropped_image, focused_scales, hair_class_id, neck_class_id
    )
    
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
                  exclude_facial_features: bool = True,
                  hair_class_id = None,
                  neck_class_id = None) -> tuple:
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
    
    if hair_class_id is None or neck_class_id is None:
        resolved_hair, resolved_neck = resolve_dynamic_hair_neck_class_ids(seg_map)
        if hair_class_id is None:
            hair_class_id = resolved_hair
        if neck_class_id is None:
            neck_class_id = resolved_neck

    # Extract hair mask
    hair_mask = (seg_map == hair_class_id).astype(np.uint8)
    
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

    hair_class_id, neck_class_id = get_dynamic_hair_neck_ids_for_image(original_image, face_crop_region)
    log_debug(f"[USER MASK RAW] Resolved class IDs: hair={hair_class_id}, neck={neck_class_id}")
    
    # STEP 2: HYBRID APPROACH - combine face-focused (for face) + full-image (for hair)
    if face_crop_region is not None:
        # Face-focused segmentation - better at finding the face accurately
        focused_hair_mask, focused_facial_mask = segment_hair_focused(
            image, face_crop_region, scales=[512, 768, 1024],
            hair_class_id=hair_class_id, neck_class_id=neck_class_id
        )
        focused_hair_pixels = np.sum(focused_hair_mask)
        log_debug(f"[USER MASK RAW] Face-focused: {focused_hair_pixels} hair pixels, {np.sum(focused_facial_mask)} facial pixels")
        
        # Full-image segmentation - better at finding ALL hair (including edges far from face)
        full_hair_mask, full_facial_mask = multi_scale_segment_hair(
            image, scales=[512, 768, 1024],
            hair_class_id=hair_class_id, neck_class_id=neck_class_id
        )
        full_hair_pixels = np.sum(full_hair_mask)
        log_debug(f"[USER MASK RAW] Full-image: {full_hair_pixels} hair pixels, {np.sum(full_facial_mask)} facial pixels")
        
        # COMBINE: Union of hair masks (catch all hair), but use focused facial mask (more accurate face)
        hair_mask = focused_hair_mask | full_hair_mask
        facial_mask = focused_facial_mask  # Face-focused gives more accurate face boundaries
        
        combined_hair_pixels = np.sum(hair_mask)
        log_debug(f"[USER MASK RAW] HYBRID result: {combined_hair_pixels} hair pixels (union of both)")
    else:
        # No face detected - use full-image only
        hair_mask, facial_mask = multi_scale_segment_hair(
            image, scales=[512, 768, 1024],
            hair_class_id=hair_class_id, neck_class_id=neck_class_id
        )
        log_debug(f"[USER MASK RAW] No face detected, using full-image only")
    
    hair_pixels = np.sum(hair_mask)
    log_debug(f"[USER MASK RAW] Final hair mask: {hair_pixels} pixels")
    
    # Get neck mask if we need to gray it out
    neck_mask = None
    if not include_neck:
        session = get_session()
        seg_map = segment_at_scale(image, 512, session)
        neck_mask = (seg_map == neck_class_id).astype(np.uint8)
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
            keep_visible = keep_visible | (seg_map == neck_class_id)
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
                               hair_buffer_px: int = 40, sharpen: bool = True, blot_eyes: bool = True,
                               face_bbox_override: tuple = None):
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
        face_bbox_override: Optional detector bbox (x, y, w, h) to use instead of Ultra-Light face box
    
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
    face_bbox = None
    if face_bbox_override is not None:
        try:
            face_bbox = tuple(int(v) for v in face_bbox_override)
            log_debug(f"[HAIR ONLY RAW] Using face bbox override: {face_bbox}")
        except Exception:
            face_bbox = None

    if face_crop_region is None and face_bbox is not None:
        face_crop_region = build_face_crop_region_from_bbox(face_bbox, original_image.shape)
        if face_crop_region is not None:
            log_debug(f"[HAIR ONLY RAW] Built crop region from override bbox: {face_crop_region}")

    if face_crop_region is None:
        face_check = early_face_check(original_image)  # Use original for face detection
        if face_check["face_found"] and face_check["crop_region"]:
            face_crop_region = face_check["crop_region"]
            log_debug(f"[HAIR ONLY RAW] Detected face with crop region: {face_crop_region}")
        if face_bbox is None and face_check.get("faces"):
            face_bbox = face_check["faces"][0]["bbox"]
    else:
        # If crop was provided externally, still try to get face bbox for class resolution.
        if face_bbox is None:
            faces = detect_faces_ultra_light(original_image, confidence_threshold=0.55)
            if faces:
                face_bbox = faces[0]["bbox"]

    # Resolve dynamic class ids for this image to handle model label-map variants.
    session = get_session()
    probe_seg = segment_at_scale(original_image, 512, session)
    hair_class_id, neck_class_id = resolve_dynamic_hair_neck_class_ids(probe_seg, face_bbox)
    log_debug(f"[HAIR ONLY RAW] Resolved class IDs: hair={hair_class_id}, neck={neck_class_id}")
    
    # STEP 2: HYBRID APPROACH - combine face-focused (for face) + full-image (for hair)
    if face_crop_region is not None:
        # Face-focused segmentation - better at finding the face accurately
        focused_hair_mask, focused_facial_mask = segment_hair_focused(
            image, face_crop_region, scales=[512, 768, 1024],
            hair_class_id=hair_class_id, neck_class_id=neck_class_id
        )
        focused_hair_pixels = np.sum(focused_hair_mask)
        log_debug(f"[HAIR ONLY RAW] Face-focused: {focused_hair_pixels} hair pixels, {np.sum(focused_facial_mask)} facial pixels")
        
        # Full-image segmentation - better at finding ALL hair (including edges far from face)
        full_hair_mask, full_facial_mask = multi_scale_segment_hair(
            image, scales=[512, 768, 1024],
            hair_class_id=hair_class_id, neck_class_id=neck_class_id
        )
        full_hair_pixels = np.sum(full_hair_mask)
        log_debug(f"[HAIR ONLY RAW] Full-image: {full_hair_pixels} hair pixels, {np.sum(full_facial_mask)} facial pixels")
        
        # COMBINE: Union of hair masks (catch all hair), but use focused facial mask (more accurate face)
        hair_mask = focused_hair_mask | full_hair_mask
        facial_mask = focused_facial_mask  # Face-focused gives more accurate face boundaries
        
        combined_hair_pixels = np.sum(hair_mask)
        log_debug(f"[HAIR ONLY RAW] HYBRID result: {combined_hair_pixels} hair pixels (union of both)")
    else:
        # No face detected - use full-image only
        hair_mask, facial_mask = multi_scale_segment_hair(
            image, scales=[512, 768, 1024],
            hair_class_id=hair_class_id, neck_class_id=neck_class_id
        )
        log_debug(f"[HAIR ONLY RAW] No face detected, using full-image only")
    
    hair_pixels = np.sum(hair_mask)
    log_debug(f"[HAIR ONLY RAW] Final hair mask: {hair_pixels} pixels")
    
    # Get segmentation for eyebrow detection
    seg_map = segment_at_scale(original_image, 512, session)
    
    # Use full hair mask without any cutoff - show all detected hair
    hair_mask_visible = hair_mask
    log_debug(f"[HAIR ONLY RAW] Using full hair mask without cutoff, pixels: {np.sum(hair_mask)}")
    
    # Expand hair mask by buffer_px for softer edges and better blending
    if hair_buffer_px > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (hair_buffer_px * 2 + 1, hair_buffer_px * 2 + 1))
        expanded_hair_mask = cv2.dilate(hair_mask_visible, kernel, iterations=1)
        
        # IMPORTANT: Subtract facial mask to prevent buffer bleeding into face
        # The buffer should expand outward (background) but NOT into facial features
        expanded_hair_mask = expanded_hair_mask & ~facial_mask
        
        buffer_pixels = np.sum(expanded_hair_mask) - np.sum(hair_mask_visible)
        log_debug(f"[HAIR ONLY RAW] Expanded hair mask by {hair_buffer_px}px buffer (+{buffer_pixels} pixels, face excluded)")
    else:
        expanded_hair_mask = hair_mask_visible
    
    # Show hair + buffer area with feathered boundaries for smoother edges.
    # Use ORIGINAL image pixels (not sharpened) for output quality.
    feather_px = max(4, min(10, int(round(min(original_h, original_w) * 0.004))))
    output = composite_with_feather(
        original_image,
        expanded_hair_mask,
        exclusion_mask=facial_mask,
        feather_px=feather_px,
        guided_radius=max(6, feather_px + 2),
        guided_eps=0.008
    )
    
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


def create_kontext_result_mask_test(image: np.ndarray, return_masks: bool = False, buffer_px: int = 30,
                                    detector_type: str = None, detector_threshold: float = None,
                                    pass_scales: list = None, return_debug: bool = False,
                                    trimap_fg_erode_px: int = None, trimap_unknown_dilate_px: int = None,
                                    matting_backend: str = None, modnet_input_size: int = None,
                                    edge_decontaminate: bool = None, edge_decontam_strength: float = None):
    """
    Kontext Stage-1 mask test with explicit trimap pipeline.

    Steps:
      1. Detect face and create hard hair mask.
      2. Build trimap (definite FG / unknown band / BG).
      3. Estimate alpha matte via selected backend (trimap or MODNet).
      4. Optional edge color decontamination.
      5. Composite over neutral background.
    """
    effective_buffer = max(0, int(buffer_px if buffer_px is not None else 30))
    detector = resolve_runtime_detector(detector_type or KONTEXT_FACE_DETECTOR or "ultralight")
    faces = detect_faces_multipass(
        image,
        detector_type=detector,
        confidence_threshold=detector_threshold,
        pass_scales=pass_scales if pass_scales is not None else KONTEXT_MULTI_PASS_SCALES
    )
    face_bbox = faces[0]["bbox"] if faces else None
    face_crop_region = build_face_crop_region_from_bbox(face_bbox, image.shape) if face_bbox is not None else None
    _, hair_mask, facial_mask = create_hair_only_mask_raw(
        image,
        return_masks=True,
        face_crop_region=face_crop_region,
        hair_buffer_px=effective_buffer,
        sharpen=True,
        blot_eyes=True,
        face_bbox_override=face_bbox
    )

    keep_mask = hair_mask.astype(np.uint8)
    if effective_buffer > 0:
        keep_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (effective_buffer * 2 + 1, effective_buffer * 2 + 1)
        )
        keep_mask = cv2.dilate(keep_mask, keep_kernel, iterations=1)
    keep_mask[facial_mask > 0] = 0

    if trimap_fg_erode_px is None:
        trimap_fg_erode_px = max(1, min(12, int(round(max(6, effective_buffer) * 0.20))))
    else:
        trimap_fg_erode_px = max(0, int(trimap_fg_erode_px))

    if trimap_unknown_dilate_px is None:
        trimap_unknown_dilate_px = max(2, min(24, int(round(max(8, effective_buffer) * 0.35))))
    else:
        trimap_unknown_dilate_px = max(0, int(trimap_unknown_dilate_px))

    trimap, _, unknown_band = build_trimap_from_mask(
        keep_mask,
        exclusion_mask=facial_mask,
        fg_erode_px=trimap_fg_erode_px,
        unknown_dilate_px=trimap_unknown_dilate_px
    )

    requested_backend = (matting_backend or KONTEXT_MATTING_BACKEND or "trimap").strip().lower()
    effective_backend = resolve_runtime_matting_backend(requested_backend)

    alpha = None
    if effective_backend == "modnet":
        alpha = estimate_alpha_with_modnet(
            image,
            trimap=trimap,
            keep_mask=keep_mask,
            exclusion_mask=facial_mask,
            target_size=modnet_input_size
        )
        if alpha is None:
            effective_backend = "trimap"
            log_info("[MATTING] MODNet inference unavailable; using trimap alpha")

    if alpha is None:
        alpha = estimate_alpha_from_trimap(
            image,
            trimap,
            guided_radius=max(6, trimap_unknown_dilate_px),
            guided_eps=0.008
        )

    decontam_enabled = (
        KONTEXT_EDGE_DECONTAMINATE
        if edge_decontaminate is None
        else bool(edge_decontaminate)
    )
    decontam_strength = (
        KONTEXT_EDGE_DECONTAM_STRENGTH
        if edge_decontam_strength is None
        else float(edge_decontam_strength)
    )
    decontam_strength = float(np.clip(decontam_strength, 0.0, 1.0))

    image_for_comp = image
    if decontam_enabled and decontam_strength > 0.0:
        image_for_comp = decontaminate_edge_colors(
            image,
            alpha,
            unknown_band=unknown_band,
            strength=decontam_strength
        )

    output = composite_with_alpha(image_for_comp, alpha, background=GRAY_BG)

    # Keep eyes neutral for consistency with other mask modes.
    session = get_session()
    seg_map = segment_at_scale(image, 512, session)
    eye_mask = ((seg_map == LEFT_EYE_ID) | (seg_map == RIGHT_EYE_ID)).astype(np.uint8)
    output[eye_mask > 0] = GRAY_BG

    log_debug(
        f"[KONTEXT RESULT MASK TEST] detector={detector} faces={len(faces)} "
        f"face_bbox={face_bbox} crop_region={face_crop_region} buffer={effective_buffer} "
        f"matting={effective_backend} "
        f"trimap(erode={trimap_fg_erode_px}, dilate={trimap_unknown_dilate_px}) "
        f"unknown_pixels={int(np.sum(unknown_band))} "
        f"decontam={'on' if decontam_enabled else 'off'} strength={decontam_strength:.2f}"
    )

    if return_debug:
        alpha_u8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
        debug_meta = {
            "mattingBackendRequested": requested_backend,
            "mattingBackendUsed": effective_backend,
            "edgeDecontaminate": bool(decontam_enabled),
            "edgeDecontamStrength": float(decontam_strength),
        }
        return output, hair_mask, facial_mask, trimap, alpha_u8, debug_meta

    if return_masks:
        return output, hair_mask, facial_mask
    return output


def create_kontext_result_mask_test_v2(image: np.ndarray, return_masks: bool = False, buffer_px: int = 30,
                                       detector_type: str = None, detector_threshold: float = None,
                                       pass_scales: list = None, return_debug: bool = False,
                                       trimap_fg_erode_px: int = None, trimap_unknown_dilate_px: int = None,
                                       matting_backend: str = None, modnet_input_size: int = None,
                                       edge_decontaminate: bool = None, edge_decontam_strength: float = None,
                                       roi_dilate_px: int = 100):
    """
    Kontext Stage-1 mask test V2.

    Pipeline:
      1) Coarse high-recall hair mask on original image.
      2) Dilate coarse mask to build ROI.
      3) Re-run segmentation on ORIGINAL pixels inside ROI crop.
      4) Map refined masks back to full resolution.
      5) Build trimap + alpha refinement in boundary band.
    """
    effective_buffer = max(0, int(buffer_px if buffer_px is not None else 30))
    effective_roi_dilate = max(10, int(roi_dilate_px if roi_dilate_px is not None else 100))

    detector = resolve_runtime_detector(detector_type or KONTEXT_FACE_DETECTOR or "ultralight")
    faces = detect_faces_multipass(
        image,
        detector_type=detector,
        confidence_threshold=detector_threshold,
        pass_scales=pass_scales if pass_scales is not None else KONTEXT_MULTI_PASS_SCALES
    )
    face_bbox = faces[0]["bbox"] if faces else None
    face_crop_region = build_face_crop_region_from_bbox(face_bbox, image.shape) if face_bbox is not None else None

    # Step 1: coarse high-recall mask on full original image
    _, coarse_hair_mask, coarse_facial_mask = create_hair_only_mask_raw(
        image,
        return_masks=True,
        face_crop_region=face_crop_region,
        hair_buffer_px=0,
        sharpen=True,
        blot_eyes=True,
        face_bbox_override=face_bbox
    )
    coarse_hair_mask = coarse_hair_mask.astype(np.uint8)
    coarse_facial_mask = coarse_facial_mask.astype(np.uint8)

    # Step 2: ROI from coarse mask (+face region for contextual stability)
    roi_seed = coarse_hair_mask.copy()
    if face_bbox is not None:
        fx, fy, fw, fh = [int(v) for v in face_bbox]
        h, w = image.shape[:2]
        fx1 = max(0, fx - int(round(fw * 0.35)))
        fy1 = max(0, fy - int(round(fh * 0.65)))
        fx2 = min(w, fx + fw + int(round(fw * 0.35)))
        fy2 = min(h, fy + fh + int(round(fh * 0.40)))
        roi_seed[fy1:fy2, fx1:fx2] = 1

    roi_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (effective_roi_dilate * 2 + 1, effective_roi_dilate * 2 + 1)
    )
    roi_mask = cv2.dilate(roi_seed, roi_kernel, iterations=1)

    ys, xs = np.where(roi_mask > 0)
    if len(xs) == 0 or len(ys) == 0:
        # Degenerate ROI: keep coarse masks.
        x1, y1, x2, y2 = 0, 0, image.shape[1], image.shape[0]
        refined_hair_mask = coarse_hair_mask
        refined_facial_mask = coarse_facial_mask
    else:
        x1, x2 = int(np.min(xs)), int(np.max(xs)) + 1
        y1, y2 = int(np.min(ys)), int(np.max(ys)) + 1

        roi_image = image[y1:y2, x1:x2].copy()
        if roi_image.shape[0] < 64 or roi_image.shape[1] < 64:
            refined_hair_mask = coarse_hair_mask
            refined_facial_mask = coarse_facial_mask
        else:
            face_bbox_roi = None
            if face_bbox is not None:
                bx, by, bw, bh = [int(v) for v in face_bbox]
                face_bbox_roi = (
                    max(0, bx - x1),
                    max(0, by - y1),
                    bw,
                    bh
                )
            face_crop_region_roi = (
                build_face_crop_region_from_bbox(face_bbox_roi, roi_image.shape)
                if face_bbox_roi is not None else None
            )

            # Step 3: re-segment inside ROI on original pixels
            _, roi_hair_mask, roi_facial_mask = create_hair_only_mask_raw(
                roi_image,
                return_masks=True,
                face_crop_region=face_crop_region_roi,
                hair_buffer_px=0,
                sharpen=True,
                blot_eyes=True,
                face_bbox_override=face_bbox_roi
            )

            # Step 4: map back to full image
            refined_hair_mask = np.zeros(image.shape[:2], dtype=np.uint8)
            refined_facial_mask = np.zeros(image.shape[:2], dtype=np.uint8)
            refined_hair_mask[y1:y2, x1:x2] = roi_hair_mask.astype(np.uint8)
            refined_facial_mask[y1:y2, x1:x2] = roi_facial_mask.astype(np.uint8)

            if int(np.sum(refined_hair_mask)) < 300:
                # Keep coarse if ROI refinement collapses.
                refined_hair_mask = coarse_hair_mask
                refined_facial_mask = coarse_facial_mask

    # Step 5: trimap + alpha refinement
    keep_mask = refined_hair_mask.astype(np.uint8)
    if effective_buffer > 0:
        keep_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (effective_buffer * 2 + 1, effective_buffer * 2 + 1)
        )
        keep_mask = cv2.dilate(keep_mask, keep_kernel, iterations=1)
    keep_mask[refined_facial_mask > 0] = 0

    if trimap_fg_erode_px is None:
        trimap_fg_erode_px = max(1, min(12, int(round(max(6, effective_buffer) * 0.20))))
    else:
        trimap_fg_erode_px = max(0, int(trimap_fg_erode_px))

    if trimap_unknown_dilate_px is None:
        trimap_unknown_dilate_px = max(2, min(24, int(round(max(8, effective_buffer) * 0.35))))
    else:
        trimap_unknown_dilate_px = max(0, int(trimap_unknown_dilate_px))

    trimap, _, unknown_band = build_trimap_from_mask(
        keep_mask,
        exclusion_mask=refined_facial_mask,
        fg_erode_px=trimap_fg_erode_px,
        unknown_dilate_px=trimap_unknown_dilate_px
    )

    requested_backend = (matting_backend or KONTEXT_MATTING_BACKEND or "trimap").strip().lower()
    effective_backend = resolve_runtime_matting_backend(requested_backend)

    alpha = None
    if effective_backend == "modnet":
        alpha = estimate_alpha_with_modnet(
            image,
            trimap=trimap,
            keep_mask=keep_mask,
            exclusion_mask=refined_facial_mask,
            target_size=modnet_input_size
        )
        if alpha is None:
            effective_backend = "trimap"
            log_info("[MATTING V2] MODNet inference unavailable; using trimap alpha")

    if alpha is None:
        alpha = estimate_alpha_from_trimap(
            image,
            trimap,
            guided_radius=max(6, trimap_unknown_dilate_px),
            guided_eps=0.008
        )

    decontam_enabled = (
        KONTEXT_EDGE_DECONTAMINATE
        if edge_decontaminate is None
        else bool(edge_decontaminate)
    )
    decontam_strength = (
        KONTEXT_EDGE_DECONTAM_STRENGTH
        if edge_decontam_strength is None
        else float(edge_decontam_strength)
    )
    decontam_strength = float(np.clip(decontam_strength, 0.0, 1.0))

    image_for_comp = image
    if decontam_enabled and decontam_strength > 0.0:
        image_for_comp = decontaminate_edge_colors(
            image,
            alpha,
            unknown_band=unknown_band,
            strength=decontam_strength
        )

    output = composite_with_alpha(image_for_comp, alpha, background=GRAY_BG)

    # Keep eyes neutral for consistency with other mask modes.
    session = get_session()
    seg_map = segment_at_scale(image, 512, session)
    eye_mask = ((seg_map == LEFT_EYE_ID) | (seg_map == RIGHT_EYE_ID)).astype(np.uint8)
    output[eye_mask > 0] = GRAY_BG

    roi_bbox = [int(x1), int(y1), int(x2 - x1), int(y2 - y1)]
    log_debug(
        f"[KONTEXT RESULT MASK TEST V2] detector={detector} faces={len(faces)} "
        f"face_bbox={face_bbox} roi_bbox={roi_bbox} roi_dilate={effective_roi_dilate}px "
        f"buffer={effective_buffer}px matting={effective_backend} "
        f"trimap(erode={trimap_fg_erode_px}, dilate={trimap_unknown_dilate_px}) "
        f"unknown_pixels={int(np.sum(unknown_band))}"
    )

    if return_debug:
        alpha_u8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
        debug_meta = {
            "mattingBackendRequested": requested_backend,
            "mattingBackendUsed": effective_backend,
            "edgeDecontaminate": bool(decontam_enabled),
            "edgeDecontamStrength": float(decontam_strength),
            "roiDilatePx": int(effective_roi_dilate),
            "roiBBox": roi_bbox,
            "coarseHairPixels": int(np.sum(coarse_hair_mask)),
            "refinedHairPixels": int(np.sum(refined_hair_mask)),
        }
        return output, refined_hair_mask, refined_facial_mask, trimap, alpha_u8, debug_meta

    if return_masks:
        return output, refined_hair_mask, refined_facial_mask
    return output


def create_user_face_only_mask_from_kontext_pipeline(
    image: np.ndarray,
    return_masks: bool = False,
    include_neck: bool = False,
    detector_type: str = None,
    detector_threshold: float = None,
    pass_scales: list = None,
    trimap_fg_erode_px: int = None,
    trimap_unknown_dilate_px: int = None,
    matting_backend: str = None,
    modnet_input_size: int = None,
    edge_decontaminate: bool = None,
    edge_decontam_strength: float = None,
):
    """
    Face-only user mask using the SAME detector/segmentation/matting path as
    create_kontext_result_mask_test, but keeping only facial region (no buffer).
    """
    detector = resolve_runtime_detector(detector_type or KONTEXT_FACE_DETECTOR or "ultralight")
    faces = detect_faces_multipass(
        image,
        detector_type=detector,
        confidence_threshold=detector_threshold,
        pass_scales=pass_scales if pass_scales is not None else KONTEXT_MULTI_PASS_SCALES,
    )
    face_bbox = faces[0]["bbox"] if faces else None
    face_crop_region = build_face_crop_region_from_bbox(face_bbox, image.shape) if face_bbox is not None else None

    # Reuse the same core segmentation path used by kontext_result_mask_test.
    _, hair_mask, facial_mask = create_hair_only_mask_raw(
        image,
        return_masks=True,
        face_crop_region=face_crop_region,
        hair_buffer_px=0,
        sharpen=True,
        blot_eyes=False,
        face_bbox_override=face_bbox,
    )

    session = get_session()
    seg_map = segment_at_scale(image, 512, session)
    _, neck_class_id = resolve_dynamic_hair_neck_class_ids(seg_map, face_bbox)

    # Build face-only keep mask (explicitly excludes hair and neck).
    # Keep full facial region so the user mask visibly preserves the whole face.
    ear_keep = (
        (seg_map == LEFT_EAR_ID)
        | (seg_map == RIGHT_EAR_ID)
    ).astype(np.uint8)

    facial_feature_keep = (
        (seg_map == LEFT_EYEBROW_ID)
        | (seg_map == RIGHT_EYEBROW_ID)
        | (seg_map == LEFT_EYE_ID)
        | (seg_map == RIGHT_EYE_ID)
        | (seg_map == NOSE_ID)
        | (seg_map == UPPER_LIP_ID)
        | (seg_map == LOWER_LIP_ID)
        | (seg_map == MOUTH_ID)
    ).astype(np.uint8)
    face_keep = facial_mask.astype(np.uint8) | facial_feature_keep | ear_keep
    # Keep detected ears even if they overlap hair; subtract hair from the rest of face.
    face_keep[(hair_mask > 0) & (ear_keep == 0)] = 0
    # Re-assert ear regions after hair exclusion.
    face_keep[ear_keep > 0] = 1
    if include_neck:
        face_keep[seg_map == neck_class_id] = 1
    if not include_neck:
        face_keep[seg_map == neck_class_id] = 0

    face_keep = cleanup_mask(face_keep)

    if trimap_fg_erode_px is None:
        trimap_fg_erode_px = 1
    else:
        trimap_fg_erode_px = max(0, int(trimap_fg_erode_px))

    if trimap_unknown_dilate_px is None:
        trimap_unknown_dilate_px = 3
    else:
        trimap_unknown_dilate_px = max(0, int(trimap_unknown_dilate_px))

    trimap, _, unknown_band = build_trimap_from_mask(
        face_keep,
        exclusion_mask=hair_mask,
        fg_erode_px=trimap_fg_erode_px,
        unknown_dilate_px=trimap_unknown_dilate_px,
    )

    requested_backend = (matting_backend or KONTEXT_MATTING_BACKEND or "trimap").strip().lower()
    effective_backend = resolve_runtime_matting_backend(requested_backend)

    alpha = None
    if effective_backend == "modnet":
        alpha = estimate_alpha_with_modnet(
            image,
            trimap=trimap,
            keep_mask=face_keep,
            exclusion_mask=hair_mask,
            target_size=modnet_input_size,
        )
        if alpha is None:
            effective_backend = "trimap"
            log_info("[USER MASK FACE-ONLY] MODNet inference unavailable; using trimap alpha")

    if alpha is None:
        alpha = estimate_alpha_from_trimap(
            image,
            trimap,
            guided_radius=max(5, trimap_unknown_dilate_px + 2),
            guided_eps=0.008,
        )

    decontam_enabled = (
        KONTEXT_EDGE_DECONTAMINATE if edge_decontaminate is None else bool(edge_decontaminate)
    )
    decontam_strength = (
        KONTEXT_EDGE_DECONTAM_STRENGTH
        if edge_decontam_strength is None
        else float(edge_decontam_strength)
    )
    decontam_strength = float(np.clip(decontam_strength, 0.0, 1.0))

    image_for_comp = image
    if decontam_enabled and decontam_strength > 0.0:
        image_for_comp = decontaminate_edge_colors(
            image, alpha, unknown_band=unknown_band, strength=decontam_strength
        )

    output = composite_with_alpha(image_for_comp, alpha, background=GRAY_BG)

    facial_features_mask = (
        (seg_map == LEFT_EYEBROW_ID)
        | (seg_map == RIGHT_EYEBROW_ID)
        | (seg_map == LEFT_EYE_ID)
        | (seg_map == RIGHT_EYE_ID)
        | (seg_map == NOSE_ID)
        | (seg_map == UPPER_LIP_ID)
        | (seg_map == LOWER_LIP_ID)
        | (seg_map == MOUTH_ID)
    ).astype(np.uint8)

    log_debug(
        f"[USER MASK FACE-ONLY] detector={detector} faces={len(faces)} "
        f"bbox={face_bbox} include_neck={include_neck} matting={effective_backend} "
        f"trimap(erode={trimap_fg_erode_px}, dilate={trimap_unknown_dilate_px}) "
        f"face_pixels={int(np.sum(face_keep))}"
    )

    if return_masks:
        return output, face_keep.astype(np.uint8), facial_features_mask.astype(np.uint8)
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
        # No buffer, face-only output using the same core path as kontext_result_mask_test.
        detector = resolve_runtime_detector(KONTEXT_FACE_DETECTOR or "ultralight")
        det_threshold = get_detector_default_threshold(detector)
        backend = resolve_runtime_matting_backend(KONTEXT_MATTING_BACKEND)
        return create_user_face_only_mask_from_kontext_pipeline(
            image,
            return_masks=return_masks,
            include_neck=include_neck,
            detector_type=detector,
            detector_threshold=det_threshold,
            pass_scales=KONTEXT_MULTI_PASS_SCALES,
            matting_backend=backend,
            edge_decontaminate=KONTEXT_EDGE_DECONTAMINATE,
            edge_decontam_strength=KONTEXT_EDGE_DECONTAM_STRENGTH,
        )
    
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

    hair_class_id, neck_class_id = get_dynamic_hair_neck_ids_for_image(original_image, face_crop_region)
    log_debug(f"[USER MASK] Resolved class IDs: hair={hair_class_id}, neck={neck_class_id}")
    
    if use_multi_scale:
        # Use focused segmentation if face crop region is available
        if face_crop_region is not None:
            log_debug(f"[USER MASK] Using face-focused segmentation with crop region: {face_crop_region}")
            hair_mask, facial_features_mask = segment_hair_focused(
                image, face_crop_region, scales=[512, 768, 1024],
                hair_class_id=hair_class_id, neck_class_id=neck_class_id
            )
        else:
            hair_mask, facial_features_mask = multi_scale_segment_hair(
                image, scales=[512, 768, 1024],
                hair_class_id=hair_class_id, neck_class_id=neck_class_id
            )
        
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
        
        hair_mask = (seg_map_full == hair_class_id).astype(np.uint8)
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
    neck_mask_raw = (seg_map_full == neck_class_id).astype(np.uint8)
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

    # Use the raw dynamic pipeline as canonical implementation for hair-only masks.
    # This avoids failures when model class maps differ from hardcoded IDs.
    raw_output, raw_hair_mask, raw_facial_mask = create_hair_only_mask_raw(
        image,
        return_masks=True,
        hair_buffer_px=max(0, int(buffer_px)),
        sharpen=sharpen,
        blot_eyes=True
    )
    if return_masks:
        return raw_output, raw_hair_mask, raw_facial_mask
    return raw_output
    
    # Legacy path (kept for reference; currently bypassed by early return above)
    # Keep original for guided filter
    original_image = image.copy()
    
    # Apply sharpening before mask generation - sharpened pixels will be kept in output
    if sharpen:
        image = sharpen_image(image, strength=1.0)
        log_debug(f"[HAIR ONLY] Applied sharpening (will be kept in output)")
    
    original_h, original_w = image.shape[:2]
    log_debug(f"[HAIR ONLY] Image size: {original_w}x{original_h}")

    hair_class_id, neck_class_id = get_dynamic_hair_neck_ids_for_image(original_image)
    log_debug(f"[HAIR ONLY] Resolved class IDs: hair={hair_class_id}, neck={neck_class_id}")
    
    if use_multi_scale:
        # Use multi-scale segmentation for better hair detection
        hair_mask, ms_facial_mask = multi_scale_segment_hair(
            image, scales=[512, 768, 1024],
            hair_class_id=hair_class_id, neck_class_id=neck_class_id
        )
        
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
        hair_mask = (seg_map_full == hair_class_id).astype(np.uint8)
        hair_pixels = np.sum(hair_mask)
        log_debug(f"[HAIR ONLY] Class {hair_class_id} (hair) pixels: {hair_pixels}")
        
        # Fallback: try alternate known hair ids if current class is weak
        if hair_pixels < 1000:
            for alt_id in [HAIR_CLASS_ID, 13]:
                if alt_id == hair_class_id:
                    continue
                alt_mask = (seg_map_full == alt_id).astype(np.uint8)
                alt_pixels = np.sum(alt_mask)
                log_debug(f"[HAIR ONLY] Class {alt_id} fallback pixels: {alt_pixels}")
                if alt_pixels > hair_pixels:
                    hair_mask = alt_mask
                    hair_pixels = alt_pixels
        
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
    neck_mask = (seg_map_full == neck_class_id).astype(np.uint8)
    
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
    hair_class_id, neck_class_id = get_dynamic_hair_neck_ids_for_image(image)
    log_debug(f"[HAIR+SKIN BORDER] Resolved class IDs: hair={hair_class_id}, neck={neck_class_id}")
    
    # Get hair mask using multi-scale or single-scale
    if use_multi_scale:
        hair_mask, _ = multi_scale_segment_hair(
            image, scales=[512, 768, 1024],
            hair_class_id=hair_class_id, neck_class_id=neck_class_id
        )
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
        hair_mask = (seg_map_full == hair_class_id).astype(np.uint8)
    
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


def create_facial_features_only_mask(
    image: np.ndarray,
    buffer_px: int = 5,
    return_masks: bool = False,
    gray_out_eyes: bool = False,
    face_border_px: int = 0,
    detector_type: str = None,
    detector_threshold: float = None,
    pass_scales: list = None,
    trimap_fg_erode_px: int = None,
    trimap_unknown_dilate_px: int = None,
    matting_backend: str = None,
    modnet_input_size: int = None,
    edge_decontaminate: bool = None,
    edge_decontam_strength: float = None
):
    """
    Hair+face mask that follows the same detector + trimap/matting pipeline used by
    create_kontext_result_mask_test, while preserving facial_features_only behavior.
    """
    hair_buffer_px = 20
    face_buffer_px = max(0, int(buffer_px if buffer_px is not None else 5))
    eye_buffer_px = 5

    detector = resolve_runtime_detector(detector_type or KONTEXT_FACE_DETECTOR or "ultralight")
    effective_threshold = (
        float(detector_threshold)
        if detector_threshold is not None
        else get_detector_default_threshold(detector)
    )
    effective_scales = pass_scales if pass_scales is not None else KONTEXT_MULTI_PASS_SCALES

    faces = detect_faces_multipass(
        image,
        detector_type=detector,
        confidence_threshold=effective_threshold,
        pass_scales=effective_scales
    )
    face_bbox = faces[0]["bbox"] if faces else None
    face_crop_region = build_face_crop_region_from_bbox(face_bbox, image.shape) if face_bbox is not None else None

    # Reuse the same core hair/facial segmentation path used by kontext_result_mask_test.
    _, hair_mask_raw, facial_mask_raw = create_hair_only_mask_raw(
        image,
        return_masks=True,
        face_crop_region=face_crop_region,
        hair_buffer_px=0,
        sharpen=True,
        blot_eyes=False,
        face_bbox_override=face_bbox
    )

    session = get_session()
    seg_map_full = segment_at_scale(image, 512, session)
    _, neck_class_id = resolve_dynamic_hair_neck_class_ids(seg_map_full, face_bbox)

    # Build full face region (skin + features + ears + neck).
    face_mask = (
        facial_mask_raw > 0
    ) | (
        (seg_map_full == UPPER_LIP_ID) |
        (seg_map_full == LOWER_LIP_ID) |
        (seg_map_full == MOUTH_ID) |
        (seg_map_full == neck_class_id)
    )
    face_mask = face_mask.astype(np.uint8)
    face_mask = cleanup_mask(face_mask)

    # Expand hair and face regions for stable boundaries.
    if hair_buffer_px > 0:
        hk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (hair_buffer_px * 2 + 1, hair_buffer_px * 2 + 1))
        hair_expanded = cv2.dilate(hair_mask_raw.astype(np.uint8), hk, iterations=1)
    else:
        hair_expanded = hair_mask_raw.astype(np.uint8)

    if face_buffer_px > 0:
        fk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (face_buffer_px * 2 + 1, face_buffer_px * 2 + 1))
        face_expanded = cv2.dilate(face_mask, fk, iterations=1)
    else:
        face_expanded = face_mask.copy()

    keep_mask = (hair_expanded > 0) | (face_expanded > 0)
    keep_mask = keep_mask.astype(np.uint8)

    eye_exclusion = np.zeros_like(keep_mask, dtype=np.uint8)
    if gray_out_eyes:
        eye_mask = ((seg_map_full == LEFT_EYE_ID) | (seg_map_full == RIGHT_EYE_ID)).astype(np.uint8)
        brow_mask = ((seg_map_full == LEFT_EYEBROW_ID) | (seg_map_full == RIGHT_EYEBROW_ID)).astype(np.uint8)

        if eye_buffer_px > 0:
            ek = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (eye_buffer_px * 2 + 1, eye_buffer_px * 2 + 1))
            eye_mask = cv2.dilate(eye_mask, ek, iterations=1)
        eyebrow_buffer_px = 3
        bk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (eyebrow_buffer_px * 2 + 1, eyebrow_buffer_px * 2 + 1))
        brow_mask = cv2.dilate(brow_mask, bk, iterations=1)

        eye_exclusion = ((eye_mask > 0) | (brow_mask > 0)).astype(np.uint8)
        keep_mask[eye_exclusion > 0] = 0

    face_interior_no_hair = np.zeros_like(keep_mask, dtype=np.uint8)
    if face_border_px > 0:
        erode_kernel_size = face_border_px * 2 + 1
        erode_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_kernel_size, erode_kernel_size))
        face_interior = cv2.erode(face_expanded.astype(np.uint8), erode_kernel, iterations=1)
        face_interior_no_hair = cv2.bitwise_and(face_interior, cv2.bitwise_not(hair_expanded.astype(np.uint8)))
        keep_mask[face_interior_no_hair > 0] = 0

    keep_mask = cleanup_mask(keep_mask)

    effective_span = max(hair_buffer_px, face_buffer_px)
    if trimap_fg_erode_px is None:
        trimap_fg_erode_px = max(1, min(12, int(round(max(6, effective_span) * 0.20))))
    else:
        trimap_fg_erode_px = max(0, int(trimap_fg_erode_px))
    if trimap_unknown_dilate_px is None:
        trimap_unknown_dilate_px = max(2, min(24, int(round(max(8, effective_span) * 0.35))))
    else:
        trimap_unknown_dilate_px = max(0, int(trimap_unknown_dilate_px))

    exclusion_mask = eye_exclusion if gray_out_eyes else None
    trimap, _, unknown_band = build_trimap_from_mask(
        keep_mask,
        exclusion_mask=exclusion_mask,
        fg_erode_px=trimap_fg_erode_px,
        unknown_dilate_px=trimap_unknown_dilate_px
    )

    requested_backend = (matting_backend or KONTEXT_MATTING_BACKEND or "trimap").strip().lower()
    effective_backend = resolve_runtime_matting_backend(requested_backend)

    alpha = None
    if effective_backend == "modnet":
        alpha = estimate_alpha_with_modnet(
            image,
            trimap=trimap,
            keep_mask=keep_mask,
            exclusion_mask=exclusion_mask,
            target_size=modnet_input_size
        )
        if alpha is None:
            effective_backend = "trimap"
            log_info("[HAIR+FACE MASK] MODNet inference unavailable; using trimap alpha")

    if alpha is None:
        alpha = estimate_alpha_from_trimap(
            image,
            trimap,
            guided_radius=max(6, trimap_unknown_dilate_px),
            guided_eps=0.008
        )

    if np.any(face_interior_no_hair > 0):
        alpha[face_interior_no_hair > 0] = 0.0
    if np.any(eye_exclusion > 0):
        alpha[eye_exclusion > 0] = 0.0

    decontam_enabled = (
        KONTEXT_EDGE_DECONTAMINATE if edge_decontaminate is None else bool(edge_decontaminate)
    )
    decontam_strength = (
        KONTEXT_EDGE_DECONTAM_STRENGTH
        if edge_decontam_strength is None
        else float(edge_decontam_strength)
    )
    decontam_strength = float(np.clip(decontam_strength, 0.0, 1.0))

    image_for_comp = image
    if decontam_enabled and decontam_strength > 0.0:
        image_for_comp = decontaminate_edge_colors(
            image,
            alpha,
            unknown_band=unknown_band,
            strength=decontam_strength
        )

    output = composite_with_alpha(image_for_comp, alpha, background=GRAY_BG)
    if np.any(eye_exclusion > 0):
        output[eye_exclusion > 0] = GRAY_BG

    visible_pixels = int(np.sum(np.any(output != GRAY_BG, axis=2)))
    log_debug(
        f"[HAIR+FACE MASK] detector={detector} faces={len(faces)} "
        f"hair_buffer={hair_buffer_px}px face_buffer={face_buffer_px}px "
        f"gray_out_eyes={gray_out_eyes} face_border_px={face_border_px} "
        f"matting={effective_backend} visible={visible_pixels}"
    )

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
    hair_class_id, neck_class_id = get_dynamic_hair_neck_ids_for_image(image)
    log_debug(f"[REF MASK] Resolved class IDs: hair={hair_class_id}, neck={neck_class_id}")
    
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
    hair_mask = (seg_map_full == hair_class_id).astype(np.uint8)
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
        
        # Keep a minimal active masking surface.
        # Legacy modes are normalized to the active hair pipeline for compatibility.
        mode = input_data.get("mode", "mask")
        legacy_hair_modes = {
            "reference",
            "hair_only",
            "hair_only_ultra",
            "hair_only_simple",
            "kontext_result_mask_test_v2",
            "hair_with_skin_border",
            "reference_face_masked",
            "facial_features_only",
        }
        if mode in legacy_hair_modes:
            log_debug(f"[MODE] '{mode}' is deprecated; routing to 'kontext_result_mask_test'")
            mode = "kontext_result_mask_test"
        
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
        elif mode == "kontext_result_mask_test":
            # Kontext Stage-1 mask test with configurable face detector comparison.
            buffer_px = int(input_data.get("bufferPx", 30))
            detector_type = str(input_data.get("detectorType", KONTEXT_FACE_DETECTOR)).strip().lower()
            effective_detector_type = resolve_runtime_detector(detector_type)
            requested_matting_backend = str(
                input_data.get("mattingBackend", KONTEXT_MATTING_BACKEND)
            ).strip().lower()
            effective_matting_backend = resolve_runtime_matting_backend(requested_matting_backend)

            modnet_input_size = input_data.get("modnetInputSize", None)
            if modnet_input_size is not None:
                try:
                    modnet_input_size = int(modnet_input_size)
                except Exception:
                    modnet_input_size = None

            edge_decontaminate = parse_boolish(
                input_data.get("edgeDecontaminate", KONTEXT_EDGE_DECONTAMINATE),
                default=KONTEXT_EDGE_DECONTAMINATE
            )
            edge_decontam_strength = input_data.get("edgeDecontamStrength", KONTEXT_EDGE_DECONTAM_STRENGTH)
            try:
                edge_decontam_strength = float(edge_decontam_strength)
            except Exception:
                edge_decontam_strength = KONTEXT_EDGE_DECONTAM_STRENGTH
            edge_decontam_strength = float(np.clip(edge_decontam_strength, 0.0, 1.0))

            detector_threshold = input_data.get("detectorThreshold", None)
            if detector_threshold is not None:
                try:
                    detector_threshold = float(detector_threshold)
                except Exception:
                    detector_threshold = None

            pass_scales = input_data.get("detectorPassScales", None)
            if isinstance(pass_scales, str):
                pass_scales = parse_multipass_scales(pass_scales)
            elif isinstance(pass_scales, list):
                parsed = []
                for s in pass_scales:
                    try:
                        v = float(s)
                        if 0.6 <= v <= 2.0:
                            parsed.append(v)
                    except Exception:
                        continue
                pass_scales = parsed if parsed else KONTEXT_MULTI_PASS_SCALES
            else:
                pass_scales = KONTEXT_MULTI_PASS_SCALES

            effective_detector_threshold = (
                float(detector_threshold)
                if detector_threshold is not None
                else get_detector_default_threshold(effective_detector_type)
            )
            trimap_fg_erode_px = input_data.get("trimapFgErodePx", None)
            if trimap_fg_erode_px is not None:
                try:
                    trimap_fg_erode_px = int(trimap_fg_erode_px)
                except Exception:
                    trimap_fg_erode_px = None
            resolved_trimap_fg_erode_px = (
                trimap_fg_erode_px
                if trimap_fg_erode_px is not None
                else max(1, min(12, int(round(max(6, buffer_px) * 0.20))))
            )

            trimap_unknown_dilate_px = input_data.get("trimapUnknownDilatePx", None)
            if trimap_unknown_dilate_px is not None:
                try:
                    trimap_unknown_dilate_px = int(trimap_unknown_dilate_px)
                except Exception:
                    trimap_unknown_dilate_px = None
            resolved_trimap_unknown_dilate_px = (
                trimap_unknown_dilate_px
                if trimap_unknown_dilate_px is not None
                else max(2, min(24, int(round(max(8, buffer_px) * 0.35))))
            )

            debug_result = create_kontext_result_mask_test(
                image,
                return_masks=True,
                buffer_px=buffer_px,
                detector_type=effective_detector_type,
                detector_threshold=effective_detector_threshold,
                pass_scales=pass_scales,
                return_debug=True,
                trimap_fg_erode_px=resolved_trimap_fg_erode_px,
                trimap_unknown_dilate_px=resolved_trimap_unknown_dilate_px,
                matting_backend=effective_matting_backend,
                modnet_input_size=modnet_input_size,
                edge_decontaminate=edge_decontaminate,
                edge_decontam_strength=edge_decontam_strength
            )
            if len(debug_result) >= 6:
                kontext_mask, hair_mask, facial_mask, trimap, alpha_matte, debug_meta = debug_result
            else:
                kontext_mask, hair_mask, facial_mask, trimap, alpha_matte = debug_result
                debug_meta = {
                    "mattingBackendRequested": requested_matting_backend,
                    "mattingBackendUsed": effective_matting_backend,
                    "edgeDecontaminate": bool(edge_decontaminate),
                    "edgeDecontamStrength": float(edge_decontam_strength),
                }

            validation = validate_hair_mask(hair_mask, facial_mask, image.shape)
            log_debug(f"[KONTEXT RESULT MASK TEST] Validation: valid={validation['valid']}, score={validation['score']}, issues={validation['issues']}")

            success, buffer = cv2.imencode('.png', kontext_mask)
            if not success:
                raise ValueError("Failed to encode kontext result mask test image")
            kontext_base64 = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"

            success, trimap_buffer = cv2.imencode('.png', trimap)
            if not success:
                raise ValueError("Failed to encode kontext trimap image")
            trimap_base64 = f"data:image/png;base64,{base64.b64encode(trimap_buffer).decode('utf-8')}"

            success, alpha_buffer = cv2.imencode('.png', alpha_matte)
            if not success:
                raise ValueError("Failed to encode kontext alpha matte image")
            alpha_base64 = f"data:image/png;base64,{base64.b64encode(alpha_buffer).decode('utf-8')}"

            output = {
                "success": True,
                "hairOnlyImage": kontext_base64,
                "trimapImage": trimap_base64,
                "alphaMatte": alpha_base64,
                "width": image.shape[1],
                "height": image.shape[0],
                "validation": validation,
                "trimapStats": {
                    "foregroundPixels": int(np.sum(trimap == 255)),
                    "unknownPixels": int(np.sum(trimap == 128)),
                    "backgroundPixels": int(np.sum(trimap == 0))
                },
                "detector": {
                    "type": effective_detector_type,
                    "threshold": effective_detector_threshold,
                    "passScales": pass_scales
                },
                "matting": {
                    "requestedBackend": debug_meta.get("mattingBackendRequested", requested_matting_backend),
                    "usedBackend": debug_meta.get("mattingBackendUsed", effective_matting_backend),
                    "modnetModelPath": str(MODNET_MODEL_PATH),
                    "modnetModelAvailable": bool(MODNET_MODEL_PATH.exists()),
                    "modnetInputSize": int(modnet_input_size) if modnet_input_size is not None else int(MODNET_INPUT_SIZE),
                    "edgeDecontaminate": bool(debug_meta.get("edgeDecontaminate", edge_decontaminate)),
                    "edgeDecontamStrength": float(debug_meta.get("edgeDecontamStrength", edge_decontam_strength)),
                },
                "trimapParams": {
                    "fgErodePx": int(resolved_trimap_fg_erode_px),
                    "unknownDilatePx": int(resolved_trimap_unknown_dilate_px)
                }
            }
        elif mode == "kontext_result_mask_test_v2":
            # Kontext Stage-1 mask test V2: coarse mask -> ROI crop -> refined re-segmentation -> trimap/alpha.
            buffer_px = int(input_data.get("bufferPx", 30))
            detector_type = str(input_data.get("detectorType", KONTEXT_FACE_DETECTOR)).strip().lower()
            effective_detector_type = resolve_runtime_detector(detector_type)
            requested_matting_backend = str(
                input_data.get("mattingBackend", KONTEXT_MATTING_BACKEND)
            ).strip().lower()
            effective_matting_backend = resolve_runtime_matting_backend(requested_matting_backend)
            roi_dilate_px = input_data.get("roiDilatePx", 100)
            try:
                roi_dilate_px = int(roi_dilate_px)
            except Exception:
                roi_dilate_px = 100
            roi_dilate_px = max(10, int(roi_dilate_px))

            modnet_input_size = input_data.get("modnetInputSize", None)
            if modnet_input_size is not None:
                try:
                    modnet_input_size = int(modnet_input_size)
                except Exception:
                    modnet_input_size = None

            edge_decontaminate = parse_boolish(
                input_data.get("edgeDecontaminate", KONTEXT_EDGE_DECONTAMINATE),
                default=KONTEXT_EDGE_DECONTAMINATE
            )
            edge_decontam_strength = input_data.get("edgeDecontamStrength", KONTEXT_EDGE_DECONTAM_STRENGTH)
            try:
                edge_decontam_strength = float(edge_decontam_strength)
            except Exception:
                edge_decontam_strength = KONTEXT_EDGE_DECONTAM_STRENGTH
            edge_decontam_strength = float(np.clip(edge_decontam_strength, 0.0, 1.0))

            detector_threshold = input_data.get("detectorThreshold", None)
            if detector_threshold is not None:
                try:
                    detector_threshold = float(detector_threshold)
                except Exception:
                    detector_threshold = None

            pass_scales = input_data.get("detectorPassScales", None)
            if isinstance(pass_scales, str):
                pass_scales = parse_multipass_scales(pass_scales)
            elif isinstance(pass_scales, list):
                parsed = []
                for s in pass_scales:
                    try:
                        v = float(s)
                        if 0.6 <= v <= 2.0:
                            parsed.append(v)
                    except Exception:
                        continue
                pass_scales = parsed if parsed else KONTEXT_MULTI_PASS_SCALES
            else:
                pass_scales = KONTEXT_MULTI_PASS_SCALES

            effective_detector_threshold = (
                float(detector_threshold)
                if detector_threshold is not None
                else get_detector_default_threshold(effective_detector_type)
            )
            trimap_fg_erode_px = input_data.get("trimapFgErodePx", None)
            if trimap_fg_erode_px is not None:
                try:
                    trimap_fg_erode_px = int(trimap_fg_erode_px)
                except Exception:
                    trimap_fg_erode_px = None
            resolved_trimap_fg_erode_px = (
                trimap_fg_erode_px
                if trimap_fg_erode_px is not None
                else max(1, min(12, int(round(max(6, buffer_px) * 0.20))))
            )

            trimap_unknown_dilate_px = input_data.get("trimapUnknownDilatePx", None)
            if trimap_unknown_dilate_px is not None:
                try:
                    trimap_unknown_dilate_px = int(trimap_unknown_dilate_px)
                except Exception:
                    trimap_unknown_dilate_px = None
            resolved_trimap_unknown_dilate_px = (
                trimap_unknown_dilate_px
                if trimap_unknown_dilate_px is not None
                else max(2, min(24, int(round(max(8, buffer_px) * 0.35))))
            )

            debug_result = create_kontext_result_mask_test_v2(
                image,
                return_masks=True,
                buffer_px=buffer_px,
                detector_type=effective_detector_type,
                detector_threshold=effective_detector_threshold,
                pass_scales=pass_scales,
                return_debug=True,
                trimap_fg_erode_px=resolved_trimap_fg_erode_px,
                trimap_unknown_dilate_px=resolved_trimap_unknown_dilate_px,
                matting_backend=effective_matting_backend,
                modnet_input_size=modnet_input_size,
                edge_decontaminate=edge_decontaminate,
                edge_decontam_strength=edge_decontam_strength,
                roi_dilate_px=roi_dilate_px
            )
            if len(debug_result) >= 6:
                kontext_mask, hair_mask, facial_mask, trimap, alpha_matte, debug_meta = debug_result
            else:
                kontext_mask, hair_mask, facial_mask, trimap, alpha_matte = debug_result
                debug_meta = {
                    "mattingBackendRequested": requested_matting_backend,
                    "mattingBackendUsed": effective_matting_backend,
                    "edgeDecontaminate": bool(edge_decontaminate),
                    "edgeDecontamStrength": float(edge_decontam_strength),
                    "roiDilatePx": int(roi_dilate_px),
                }

            validation = validate_hair_mask(hair_mask, facial_mask, image.shape)
            log_debug(f"[KONTEXT RESULT MASK TEST V2] Validation: valid={validation['valid']}, score={validation['score']}, issues={validation['issues']}")

            success, buffer = cv2.imencode('.png', kontext_mask)
            if not success:
                raise ValueError("Failed to encode kontext result mask test v2 image")
            kontext_base64 = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"

            success, trimap_buffer = cv2.imencode('.png', trimap)
            if not success:
                raise ValueError("Failed to encode kontext v2 trimap image")
            trimap_base64 = f"data:image/png;base64,{base64.b64encode(trimap_buffer).decode('utf-8')}"

            success, alpha_buffer = cv2.imencode('.png', alpha_matte)
            if not success:
                raise ValueError("Failed to encode kontext v2 alpha matte image")
            alpha_base64 = f"data:image/png;base64,{base64.b64encode(alpha_buffer).decode('utf-8')}"

            output = {
                "success": True,
                "hairOnlyImage": kontext_base64,
                "trimapImage": trimap_base64,
                "alphaMatte": alpha_base64,
                "width": image.shape[1],
                "height": image.shape[0],
                "validation": validation,
                "trimapStats": {
                    "foregroundPixels": int(np.sum(trimap == 255)),
                    "unknownPixels": int(np.sum(trimap == 128)),
                    "backgroundPixels": int(np.sum(trimap == 0))
                },
                "detector": {
                    "type": effective_detector_type,
                    "threshold": effective_detector_threshold,
                    "passScales": pass_scales
                },
                "matting": {
                    "requestedBackend": debug_meta.get("mattingBackendRequested", requested_matting_backend),
                    "usedBackend": debug_meta.get("mattingBackendUsed", effective_matting_backend),
                    "modnetModelPath": str(MODNET_MODEL_PATH),
                    "modnetModelAvailable": bool(MODNET_MODEL_PATH.exists()),
                    "modnetInputSize": int(modnet_input_size) if modnet_input_size is not None else int(MODNET_INPUT_SIZE),
                    "edgeDecontaminate": bool(debug_meta.get("edgeDecontaminate", edge_decontaminate)),
                    "edgeDecontamStrength": float(debug_meta.get("edgeDecontamStrength", edge_decontam_strength)),
                },
                "trimapParams": {
                    "fgErodePx": int(resolved_trimap_fg_erode_px),
                    "unknownDilatePx": int(resolved_trimap_unknown_dilate_px)
                },
                "roi": {
                    "dilatePx": int(debug_meta.get("roiDilatePx", roi_dilate_px)),
                    "bbox": debug_meta.get("roiBBox"),
                    "coarseHairPixels": int(debug_meta.get("coarseHairPixels", 0)),
                    "refinedHairPixels": int(debug_meta.get("refinedHairPixels", 0)),
                }
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
            log_debug(f"[HAIR ONLY SIMPLE] Validation: valid={validation['valid']}, score={validation['score']}, issues={validation['issues']}")
            
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
            # Create user masked image using strict face-only pipeline
            # (face visible, hair/neck/background grayed).
            buffer_px = input_data.get("bufferPx", 10)
            hairline_visible_px = input_data.get("hairlineVisiblePx", 20)  # Pixels of hair to show above hairline
            validate_quality = input_data.get("validateQuality", True)  # New flag for quality check
            # User mask keeps face + neck by default.
            include_neck = bool(input_data.get("includeNeck", True))
            gray_out_background = True
            
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
            
            # STEP 3: Run face-only pipeline for user mask output
            user_masked, face_mask, facial_features_mask = create_user_face_only_mask_from_kontext_pipeline(
                image,
                return_masks=True,
                include_neck=include_neck
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
