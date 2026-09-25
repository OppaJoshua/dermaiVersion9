"""
DERMAI - Predictor Service
Handles inference with the loaded ResNet50 model
"""

import time
import numpy as np
from PIL import Image
from typing import Dict, Any

from app.config import CLASS_NAMES, DISPLAY_NAMES, get_confidence_level
from app.services.model_loader import model_loader
from app.utils.image_utils import preprocess_image


class Predictor:
    """
    Makes predictions using the loaded model.
    Uses the singleton model instance.
    """
    
    def __init__(self):
        self.class_names = CLASS_NAMES
        self.display_names = DISPLAY_NAMES
    
    def predict(self, img: Image.Image) -> Dict[str, Any]:
        """
        Run inference on a PIL Image.
        
        Args:
            img: PIL Image (RGB mode expected)
        
        Returns:
            {
                "predicted_class": str,        # e.g. "Acne_Vulgaris"
                "display_name": str,           # e.g. "Acne Vulgaris"
                "confidence": float,           # 0-100
                "confidence_level": str,       # "high" | "medium" | "low"
                "probabilities": {             # All class probabilities
                    "Acne_Vulgaris": 95.66,
                    ...
                },
                "inference_time_ms": int
            }
        """
        start_time = time.time()
        
        # Get model
        model = model_loader.get_model()
        
        # Preprocess
        img_array = preprocess_image(img)
        
        # Inference
        predictions = model.predict(img_array, verbose=0)
        probabilities = predictions[0]  # shape (5,)
        
        # Best class
        predicted_idx = int(np.argmax(probabilities))
        predicted_class = self.class_names[predicted_idx]
        confidence = float(probabilities[predicted_idx] * 100)
        
        # Build response
        result = {
            "predicted_class": predicted_class,
            "display_name": self.display_names[predicted_class],
            "confidence": round(confidence, 2),
            "confidence_level": get_confidence_level(confidence),
            "probabilities": {
                self.class_names[i]: round(float(probabilities[i] * 100), 2)
                for i in range(len(self.class_names))
            },
            "inference_time_ms": int((time.time() - start_time) * 1000),
        }
        
        return result


# Global singleton
predictor = Predictor()