"""
DERMAI - Image Utilities
Handles image loading, validation, and preprocessing
"""

import io
from pathlib import Path
from typing import Union
import numpy as np
from PIL import Image
from fastapi import UploadFile

from app.config import INPUT_SIZE


# Allowed image extensions
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".heic", ".webp"}


class ImageValidationError(Exception):
    """Raised when image validation fails"""
    pass


async def load_image_from_upload(file: UploadFile) -> Image.Image:
    """
    Load image from FastAPI UploadFile.
    
    Validates:
    - File extension
    - File size
    - Is a valid image
    - Convertible to RGB
    
    Returns:
        PIL.Image.Image in RGB mode
    """
    # Validate extension
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    
    if ext not in ALLOWED_EXTENSIONS:
        raise ImageValidationError(
            f"Invalid file type: {ext}. "
            f"Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )
    
    # Read bytes
    try:
        contents = await file.read()
    except Exception as e:
        raise ImageValidationError(f"Failed to read file: {e}")
    
    if not contents:
        raise ImageValidationError("Empty file")
    
    # Validate size (10 MB max)
    max_size = 10 * 1024 * 1024
    if len(contents) > max_size:
        raise ImageValidationError(
            f"File too large: {len(contents) / 1024 / 1024:.1f} MB. "
            f"Max: {max_size / 1024 / 1024:.0f} MB"
        )
    
    # Open as image
    try:
        img = Image.open(io.BytesIO(contents))
        img.load()  # Force load to catch corruption early
    except Exception as e:
        raise ImageValidationError(f"Invalid image file: {e}")
    
    # Convert to RGB (handles grayscale, RGBA, palette, CMYK)
    if img.mode != "RGB":
        img = img.convert("RGB")
    
    return img


def preprocess_image(img: Image.Image, target_size: tuple = INPUT_SIZE) -> np.ndarray:
    """
    Preprocess image for ResNet50 inference.
    
    Steps:
    1. Resize to target size (224x224)
    2. Convert to numpy array
    3. Apply ResNet50 preprocessing (caffe-style: mean subtraction, BGR)
    4. Add batch dimension
    
    Returns:
        np.ndarray of shape (1, 224, 224, 3) ready for model.predict()
    """
    # Import inside function to avoid circular deps
    from tensorflow.keras.applications.resnet50 import preprocess_input
    
    # Resize
    img_resized = img.resize(target_size, Image.Resampling.LANCZOS)
    
    # To numpy
    arr = np.array(img_resized, dtype=np.float32)
    
    # ResNet50 preprocessing (mean subtraction, RGB→BGR)
    arr = preprocess_input(arr)
    
    # Add batch dimension
    arr = np.expand_dims(arr, axis=0)
    
    return arr