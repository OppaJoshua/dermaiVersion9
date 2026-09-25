"""
DERMAI - Model Loader
Loads the ResNet50 model ONCE at startup and keeps it in memory
"""

import os
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")  # Reduce TF logging noise

import tensorflow as tf
from app.config import MODEL_PATH


class ModelLoader:
    """
    Singleton-style model loader.
    The model is loaded once when the FastAPI app starts, then reused for all requests.
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
            print(f"📂 Loading model from: {MODEL_PATH}")
            
            if not MODEL_PATH.exists():
                raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")
            
            self._model = tf.keras.models.load_model(str(MODEL_PATH))
            print("✅ Model loaded successfully!")
            
            # Warm-up: Run a dummy prediction to initialize TF graph
            import numpy as np
            dummy = np.zeros((1, 224, 224, 3), dtype=np.float32)
            _ = self._model.predict(dummy, verbose=0)
            print("✅ Model warm-up complete!")
        
        return self._model
    
    def get_model(self):
        """Get the loaded model (loads if needed)"""
        if self._model is None:
            self.load()
        return self._model


# Global singleton
model_loader = ModelLoader()