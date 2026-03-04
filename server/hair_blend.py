#!/usr/bin/env python3
"""
Hair Blending Service for Auren (blend_inpaint backend).

Pipeline summary:
1) Decode inputs.
2) Clean both binary masks and keep largest components.
3) Estimate affine alignment from reference hair mask -> user hair mask.
4) Warp reference image + mask into user coordinates.
5) Build soft alpha from warped mask for edge-safe compositing.
6) Color-match warped reference hair toward user image statistics.
7) Blend with Poisson cloning (if possible), then edge alpha composite.
"""

import sys
import json
import time
import base64
import numpy as np
import cv2


def log_debug(msg: str) -> None:
    # Keep stdout clean for JSON response parsing in Node.
    sys.stderr.write(f"[hair_blend] {msg}\n")
    sys.stderr.flush()


def decode_base64_image(base64_str: str) -> np.ndarray:
    if base64_str.startswith("data:"):
        base64_str = base64_str.split(",", 1)[1]
    img_data = base64.b64decode(base64_str)
    img_array = np.frombuffer(img_data, dtype=np.uint8)
    image = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Failed to decode image")
    return image


def decode_base64_mask(base64_str: str) -> np.ndarray:
    if base64_str.startswith("data:"):
        base64_str = base64_str.split(",", 1)[1]
    img_data = base64.b64decode(base64_str)
    img_array = np.frombuffer(img_data, dtype=np.uint8)
    mask = cv2.imdecode(img_array, cv2.IMREAD_GRAYSCALE)
    if mask is None:
        raise ValueError("Failed to decode mask")
    return mask


def encode_image_base64(img: np.ndarray) -> str:
    success, buffer = cv2.imencode(".png", img)
    if not success:
        raise ValueError("Failed to encode image")
    return f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"


def largest_component(mask: np.ndarray) -> np.ndarray:
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if num_labels <= 1:
        return mask

    largest_idx = 1
    largest_area = stats[1, cv2.CC_STAT_AREA]
    for i in range(2, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if area > largest_area:
            largest_area = area
            largest_idx = i

    output = np.zeros_like(mask, dtype=np.uint8)
    output[labels == largest_idx] = 255
    return output


def cleanup_mask(mask: np.ndarray) -> np.ndarray:
    mask_bin = (mask > 127).astype(np.uint8) * 255
    kernel_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    kernel_mid = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    cleaned = cv2.morphologyEx(mask_bin, cv2.MORPH_OPEN, kernel_small, iterations=1)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel_mid, iterations=1)
    cleaned = largest_component(cleaned)
    return cleaned


def safe_bbox(mask: np.ndarray):
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return None
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    return (x0, y0, x1 - x0 + 1, y1 - y0 + 1)


def find_hair_center(mask: np.ndarray) -> tuple:
    moments = cv2.moments(mask)
    if moments["m00"] <= 1e-6:
        return (mask.shape[1] // 2, mask.shape[0] // 2)
    cx = int(moments["m10"] / moments["m00"])
    cy = int(moments["m01"] / moments["m00"])
    return (cx, cy)


def _edge_point(mask: np.ndarray, y_ratio: float, side: str) -> tuple:
    ys, _ = np.where(mask > 0)
    if len(ys) == 0:
        return (mask.shape[1] // 2, mask.shape[0] // 2)

    y0, y1 = int(ys.min()), int(ys.max())
    h = max(1, y1 - y0 + 1)
    target_y = int(round(y0 + y_ratio * (h - 1)))
    band = max(2, int(round(h * 0.03)))

    y_start = max(0, target_y - band)
    y_end = min(mask.shape[0], target_y + band + 1)

    band_mask = mask[y_start:y_end, :]
    ys_band, xs_band = np.where(band_mask > 0)
    if len(xs_band) == 0:
        bbox = safe_bbox(mask)
        if bbox is None:
            return (mask.shape[1] // 2, mask.shape[0] // 2)
        x, y, w, _ = bbox
        return (x if side == "left" else x + w - 1, target_y)

    if side == "left":
        idx = int(np.argmin(xs_band))
    else:
        idx = int(np.argmax(xs_band))
    return (int(xs_band[idx]), int(ys_band[idx] + y_start))


def extract_alignment_points(mask: np.ndarray):
    bbox = safe_bbox(mask)
    if bbox is None:
        return None

    x, y, w, h = bbox
    top_band_h = max(2, int(round(h * 0.04)))
    top_band = mask[y:y + top_band_h, x:x + w]
    ys_top, xs_top = np.where(top_band > 0)
    if len(xs_top) > 0:
        top_center = (int(x + np.mean(xs_top)), int(y + np.mean(ys_top)))
    else:
        top_center = (int(x + w * 0.5), y)

    left_upper = _edge_point(mask, 0.25, "left")
    right_upper = _edge_point(mask, 0.25, "right")
    left_mid = _edge_point(mask, 0.55, "left")
    right_mid = _edge_point(mask, 0.55, "right")
    left_low = _edge_point(mask, 0.82, "left")
    right_low = _edge_point(mask, 0.82, "right")

    pts = np.array(
        [
            top_center,
            left_upper,
            right_upper,
            left_mid,
            right_mid,
            left_low,
            right_low,
        ],
        dtype=np.float32,
    )
    return pts


def estimate_mask_affine(ref_mask: np.ndarray, user_mask: np.ndarray):
    ref_pts = extract_alignment_points(ref_mask)
    user_pts = extract_alignment_points(user_mask)
    if ref_pts is None or user_pts is None:
        return None

    matrix, inliers = cv2.estimateAffinePartial2D(
        ref_pts,
        user_pts,
        method=cv2.RANSAC,
        ransacReprojThreshold=8.0,
        maxIters=2000,
        confidence=0.99,
        refineIters=25,
    )

    if matrix is not None and inliers is not None and int(np.sum(inliers)) >= 3:
        return matrix

    ref_bbox = safe_bbox(ref_mask)
    user_bbox = safe_bbox(user_mask)
    if ref_bbox is None or user_bbox is None:
        return None

    rx, ry, rw, rh = ref_bbox
    ux, uy, uw, uh = user_bbox
    sx = uw / max(1.0, float(rw))
    sy = uh / max(1.0, float(rh))

    ref_top = ref_pts[0]
    user_top = user_pts[0]
    tx = user_top[0] - sx * ref_top[0]
    ty = user_top[1] - sy * ref_top[1]
    return np.array([[sx, 0.0, tx], [0.0, sy, ty]], dtype=np.float32)


def warp_reference_to_user(ref_img: np.ndarray, ref_mask: np.ndarray, user_mask: np.ndarray):
    h, w = user_mask.shape
    affine = estimate_mask_affine(ref_mask, user_mask)
    if affine is None:
        return ref_img.copy(), ref_mask.copy()

    warped_img = cv2.warpAffine(
        ref_img,
        affine,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101,
    )
    warped_mask = cv2.warpAffine(
        ref_mask,
        affine,
        (w, h),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    return warped_img, warped_mask


def color_match_lab(source: np.ndarray, target: np.ndarray, mask: np.ndarray = None) -> np.ndarray:
    source_lab = cv2.cvtColor(source, cv2.COLOR_BGR2LAB).astype(np.float32)
    target_lab = cv2.cvtColor(target, cv2.COLOR_BGR2LAB).astype(np.float32)

    if mask is not None:
        mask_f = (mask > 0).astype(np.float32)[:, :, None]
        source_mean = np.sum(source_lab * mask_f, axis=(0, 1)) / (np.sum(mask_f) + 1e-6)
        source_std = np.sqrt(
            np.sum(((source_lab - source_mean) ** 2) * mask_f, axis=(0, 1))
            / (np.sum(mask_f) + 1e-6)
        )
        target_mean = np.sum(target_lab * mask_f, axis=(0, 1)) / (np.sum(mask_f) + 1e-6)
        target_std = np.sqrt(
            np.sum(((target_lab - target_mean) ** 2) * mask_f, axis=(0, 1))
            / (np.sum(mask_f) + 1e-6)
        )
    else:
        source_mean = np.mean(source_lab, axis=(0, 1))
        source_std = np.std(source_lab, axis=(0, 1))
        target_mean = np.mean(target_lab, axis=(0, 1))
        target_std = np.std(target_lab, axis=(0, 1))

    source_std = np.maximum(source_std, 1e-6)
    matched = (source_lab - source_mean) * (target_std / source_std) + target_mean
    matched = np.clip(matched, 0, 255).astype(np.uint8)
    return cv2.cvtColor(matched, cv2.COLOR_LAB2BGR)


def soft_alpha_from_mask(mask: np.ndarray, feather_px: int = 8) -> np.ndarray:
    mask_bin = (mask > 0).astype(np.uint8)
    if feather_px <= 0:
        return mask_bin.astype(np.float32)

    inside_dist = cv2.distanceTransform(mask_bin, cv2.DIST_L2, 5)
    outside_dist = cv2.distanceTransform((1 - mask_bin).astype(np.uint8), cv2.DIST_L2, 5)
    signed_dist = inside_dist - outside_dist

    f = float(max(1, feather_px))
    alpha = np.clip((signed_dist + f) / (2.0 * f), 0.0, 1.0)
    alpha[inside_dist >= f] = 1.0
    alpha[outside_dist >= f] = 0.0
    return alpha.astype(np.float32)


def constrain_to_user_envelope(user_mask: np.ndarray, candidate_mask: np.ndarray) -> np.ndarray:
    """
    Keep candidate mask around the user's head envelope to avoid forehead/face spill.
    """
    bbox = safe_bbox(user_mask)
    if bbox is None:
        return candidate_mask

    x, y, w, h = bbox
    dilate_px = int(np.clip(round(max(w, h) * 0.16), 16, 72))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_px * 2 + 1, dilate_px * 2 + 1))
    envelope = cv2.dilate(user_mask, kernel, iterations=1)

    # Do not allow excessive downward leakage from warped reference mask.
    max_bottom = min(user_mask.shape[0], int(round(y + h * 1.18)))
    envelope[max_bottom:, :] = 0

    constrained = cv2.bitwise_and(candidate_mask, envelope)
    constrained = cleanup_mask(constrained)
    return constrained


def blend_hair(user_base64: str, ref_base64: str, user_mask_base64: str, ref_mask_base64: str):
    t0 = time.time()

    user_img = decode_base64_image(user_base64)
    ref_img = decode_base64_image(ref_base64)
    user_mask_raw = decode_base64_mask(user_mask_base64)
    ref_mask_raw = decode_base64_mask(ref_mask_base64)

    target_h, target_w = user_img.shape[:2]
    if target_h <= 0 or target_w <= 0:
        raise ValueError("Invalid user image dimensions")

    target_size = (target_w, target_h)
    ref_img = cv2.resize(ref_img, target_size, interpolation=cv2.INTER_LINEAR)
    user_mask = cv2.resize(user_mask_raw, target_size, interpolation=cv2.INTER_NEAREST)
    ref_mask = cv2.resize(ref_mask_raw, target_size, interpolation=cv2.INTER_NEAREST)

    user_mask = cleanup_mask(user_mask)
    ref_mask = cleanup_mask(ref_mask)

    if np.sum(user_mask > 0) < 200 or np.sum(ref_mask > 0) < 200:
        raise ValueError("Hair masks too small after cleanup")

    warped_ref_img, warped_ref_mask = warp_reference_to_user(ref_img, ref_mask, user_mask)
    warped_ref_mask = cleanup_mask(warped_ref_mask)
    warped_ref_mask = constrain_to_user_envelope(user_mask, warped_ref_mask)

    if np.sum(warped_ref_mask > 0) < 200:
        raise ValueError("Warped reference hair mask is empty")

    erode_px = int(np.clip(round(max(target_w, target_h) * 0.004), 2, 8))
    core_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_px * 2 + 1, erode_px * 2 + 1))
    core_mask = cv2.erode(warped_ref_mask, core_kernel, iterations=1)
    if np.sum(core_mask > 0) < 150:
        core_mask = warped_ref_mask.copy()

    color_matched_ref = color_match_lab(warped_ref_img, user_img, core_mask)

    alpha_full = soft_alpha_from_mask(warped_ref_mask, feather_px=5)
    alpha_core = soft_alpha_from_mask(core_mask, feather_px=3)
    alpha_full3 = np.repeat(alpha_full[:, :, None], 3, axis=2)
    alpha_core3 = np.repeat(alpha_core[:, :, None], 3, axis=2)

    soft_comp = (
        color_matched_ref.astype(np.float32) * alpha_full3
        + user_img.astype(np.float32) * (1.0 - alpha_full3)
    ).astype(np.uint8)

    center = find_hair_center(core_mask)
    poisson_ok = False
    try:
        poisson = cv2.seamlessClone(
            color_matched_ref,
            user_img,
            core_mask,
            center,
            cv2.NORMAL_CLONE,
        )
        poisson_ok = True
    except cv2.error:
        poisson = soft_comp

    final = (
        poisson.astype(np.float32) * alpha_core3
        + soft_comp.astype(np.float32) * (1.0 - alpha_core3)
    )

    # Boundary safeguard: pull uncertain edge pixels toward user image to avoid halos.
    edge_alpha = np.clip(alpha_full - alpha_core, 0.0, 1.0)
    edge_alpha3 = np.repeat((edge_alpha * 0.45)[:, :, None], 3, axis=2)
    final = (
        final * (1.0 - edge_alpha3)
        + user_img.astype(np.float32) * edge_alpha3
    ).astype(np.uint8)

    elapsed_ms = int(round((time.time() - t0) * 1000))
    stats = {
        "elapsedMs": elapsed_ms,
        "userMaskPx": int(np.sum(user_mask > 0)),
        "refMaskPx": int(np.sum(ref_mask > 0)),
        "warpedMaskPx": int(np.sum(warped_ref_mask > 0)),
        "coreMaskPx": int(np.sum(core_mask > 0)),
        "poissonUsed": bool(poisson_ok),
    }
    log_debug(f"blend complete: {stats}")

    return encode_image_base64(final), stats


def main():
    try:
        input_data = json.loads(sys.stdin.read())
        user_base64 = input_data["userImage"]
        ref_base64 = input_data["referenceImage"]
        user_mask_base64 = input_data["userMask"]
        ref_mask_base64 = input_data["referenceMask"]

        result_base64, stats = blend_hair(
            user_base64,
            ref_base64,
            user_mask_base64,
            ref_mask_base64,
        )
        print(json.dumps({"success": True, "result": result_base64, "stats": stats}))
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
