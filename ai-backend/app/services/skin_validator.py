"""
DERMAI - Human-Skin Validator
Binary classifier that checks if an image contains suitable human skin
before forwarding to the ResNet50 skin-condition classifier.

Model: MobileNetV2 (frozen ImageNet base + small classification head)
Accuracy: 99.70% on test set
- False Positive Rate: 0.67% (invalid images accepted)
- False Negative Rate: 0.00% (valid human skin rejected)
"""

import os
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np
import tensorflow as tf
from PIL import Image

from app.config import (
    SKIN_VALIDATOR_PATH,
    SKIN_VALIDATOR_THRESHOLD,
    INPUT_SIZE,
)


class SkinValidator:
    """
    Loads the human-skin validator once and reuses it for all requests.
    """

    _instance = None
    _model = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def load(self):
        """Load the model if not already loaded"""
        if self._model is None:
            print(f"📂 Loading skin validator from: {SKIN_VALIDATOR_PATH}")

            if not SKIN_VALIDATOR_PATH.exists():
                raise FileNotFoundError(
                    f"Skin validator model not found: {SKIN_VALIDATOR_PATH}\n"
                    f"  Copy skin_validator_final.h5 to ai-backend/models/ "
                    f"before starting the server."
                )

            self._model = tf.keras.models.load_model(str(SKIN_VALIDATOR_PATH))

            # Warm-up
            dummy = np.zeros((1, 224, 224, 3), dtype=np.float32)
            _ = self._model.predict(dummy, verbose=0)

            print("✅ Skin validator loaded and warmed up")

        return self._model

    def get_model(self):
        if self._model is None:
            self.load()
        return self._model

    def is_human_skin(self, img: Image.Image, threshold: float = None):
        """
        Check if the image is a valid human-skin photo.

        Args:
            img: PIL Image (RGB)
            threshold: score threshold; above = human skin. Defaults to config.

        Returns:
            Tuple (is_human_skin: bool, score: float in [0,1])
        """
        if threshold is None:
            threshold = SKIN_VALIDATOR_THRESHOLD

        from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

        model = self.get_model()

        # Resize + preprocess for MobileNetV2
        img_resized = img.resize(INPUT_SIZE, Image.Resampling.LANCZOS)
        arr = np.array(img_resized, dtype=np.float32)
        arr = preprocess_input(arr)
        arr = np.expand_dims(arr, axis=0)

        # Predict (sigmoid output: 0 = invalid, 1 = valid human skin)
        score = float(model.predict(arr, verbose=0)[0][0])
        return score >= threshold, score


# Global singleton
skin_validator = SkinValidator()