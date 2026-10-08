"""
DERMAI - Image Quality Check
Pre-check before AI analysis to reject blurry, dark, or unclear images.

Implements Manuscript Section 5.4.1:
"Image quality check — Detects blurry, dark, or unclear images and
 prompts the user to retake."

Runs BEFORE the skin validator and classifier.
"""

import io
import numpy as np
import cv2
from PIL import Image


# ============================================
# THRESHOLDS (tunable)
# ============================================

# Blur: Laplacian variance. Lower = blurrier.
# Real photos in good lighting: typically 100-1000+
# Slightly blurry: 40-100
# Very blurry / out of focus: < 40
BLUR_THRESHOLD = 40.0

# Brightness: mean pixel value (0-255)
BRIGHTNESS_MIN = 30.0
BRIGHTNESS_MAX = 230.0

# Contrast: std deviation of pixels
CONTRAST_MIN = 20.0

# Resolution: minimum pixel dimensions
MIN_WIDTH = 200
MIN_HEIGHT = 200


# ============================================
# EXCEPTIONS
# ============================================

class ImageQualityError(Exception):
    """Raised when an image fails quality checks."""
    def __init__(self, message: str, reason: str):
        super().__init__(message)
        self.reason = reason


# ============================================
# ANALYSIS FUNCTIONS
# ============================================

def compute_blur_score(img: Image.Image) -> float:
    """Compute the variance of the Laplacian (blur metric).
    Higher = sharper. Lower = blurrier."""
    gray = np.array(img.convert("L"), dtype=np.uint8)
    gray = cv2.resize(gray, (500, 500), interpolation=cv2.INTER_AREA)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    return float(laplacian.var())


def compute_brightness(img: Image.Image) -> float:
    """Compute mean pixel value (0-255)."""
    arr = np.array(img.convert("L"), dtype=np.float32)
    return float(arr.mean())


def compute_contrast(img: Image.Image) -> float:
    """Compute the standard deviation of pixel values."""
    arr = np.array(img.convert("L"), dtype=np.float32)
    return float(arr.std())


def check_resolution(img: Image.Image) -> tuple:
    """Verify image is large enough."""
    w, h = img.size
    if w < MIN_WIDTH or h < MIN_HEIGHT:
        return False, f"Image is too small ({w}x{h}px). Minimum: {MIN_WIDTH}x{MIN_HEIGHT}px."
    return True, ""


# ============================================
# MAIN CHECK
# ============================================

def check_image_quality(img: Image.Image) -> dict:
    """Run all quality checks on the image."""
    issues = []

    # Resolution
    res_ok, res_msg = check_resolution(img)
    if not res_ok:
        issues.append({"type": "resolution", "message": res_msg})

    # Blur
    blur_score = compute_blur_score(img)
    if blur_score < BLUR_THRESHOLD:
        issues.append({
            "type": "blur",
            "message": (
                f"Image appears blurry (sharpness score: {blur_score:.1f}, "
                f"minimum: {BLUR_THRESHOLD}). Please retake with the camera steady."
            ),
        })

    # Brightness
    brightness = compute_brightness(img)
    if brightness < BRIGHTNESS_MIN:
        issues.append({
            "type": "dark",
            "message": (
                f"Image is too dark (brightness: {brightness:.1f}, "
                f"minimum: {BRIGHTNESS_MIN}). Please retake in better lighting."
            ),
        })
    elif brightness > BRIGHTNESS_MAX:
        issues.append({
            "type": "bright",
            "message": (
                f"Image is too bright or overexposed (brightness: {brightness:.1f}, "
                f"maximum: {BRIGHTNESS_MAX}). Avoid direct flash or sunlight."
            ),
        })

    # Contrast
    contrast = compute_contrast(img)
    if contrast < CONTRAST_MIN:
        issues.append({
            "type": "contrast",
            "message": (
                f"Image has very low contrast (score: {contrast:.1f}, "
                f"minimum: {CONTRAST_MIN}). Please retake in better lighting."
            ),
        })

    return {
        "passed": len(issues) == 0,
        "blur_score": round(blur_score, 2),
        "brightness": round(brightness, 2),
        "contrast": round(contrast, 2),
        "issues": issues,
    }


# ============================================
# FORMAT FOR API RESPONSE
# ============================================

def build_quality_error_response(issues: list) -> dict:
    """Build a friendly, user-facing error response from quality issues."""
    if not issues:
        return {}

    primary = issues[0]
    return {
        "success": False,
        "error": primary["message"],
        "error_type": f"quality_{primary['type']}",
        "all_issues": [i["message"] for i in issues],
    }