import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import json
import numpy as np
import tensorflow as tf
from app.services.model_loader import model_loader
from app.utils.image_utils import preprocess_image
from PIL import Image

MODEL_PATH = "models/unfreeze_best.h5"
VAL_DIR = r"D:\DATASET\dataset\validation"
OUT_DIR = "calibration"
os.makedirs(OUT_DIR, exist_ok=True)

print("Loading model...")
model = model_loader.get_model()

# Get the feature extractor (output of dropout layer, right before final Dense)
feature_model = tf.keras.Model(inputs=model.inputs, outputs=model.get_layer('dropout').output)

# Get the final dense weights and bias
final_dense = model.get_layer('dense_1')
W, b = final_dense.get_weights()  # W: (256, 5), b: (5,)
print(f"Dense weights shape: {W.shape}, bias shape: {b.shape}")

# Map classes to indices (must match training order)
class_names = ["Acne_Vulgaris", "Atopic_Dermatitis", "Contact_Dermatitis", "Melasma", "Vitiligo"]
class_to_idx = {name: i for i, name in enumerate(class_names)}

val_logits = []
val_labels = []

print(f"Scanning {VAL_DIR}...")
for class_name in class_names:
    class_dir = os.path.join(VAL_DIR, class_name)
    if not os.path.isdir(class_dir):
        print(f"Warning: Directory not found {class_dir}")
        continue
    
    for img_name in os.listdir(class_dir):
        if not img_name.lower().endswith(('.png', '.jpg', '.jpeg')):
            continue
        
        img_path = os.path.join(class_dir, img_name)
        try:
            img = Image.open(img_path).convert("RGB")
            img_array = preprocess_image(img)
            
            # Get features from dropout layer
            features = feature_model.predict(img_array, verbose=0)[0]  # (256,)
            
            # Compute pre-softmax logits manually
            logits = features @ W + b  # (5,)
            
            val_logits.append(logits)
            val_labels.append(class_to_idx[class_name])
        except Exception as e:
            print(f"Error processing {img_path}: {e}")

val_logits = np.array(val_logits)
val_labels = np.array(val_labels)

np.save(os.path.join(OUT_DIR, "val_logits.npy"), val_logits)
np.save(os.path.join(OUT_DIR, "val_labels.npy"), val_labels)

print(f"Saved val_logits.npy with shape {val_logits.shape}")
print(f"Saved val_labels.npy with shape {val_labels.shape}")
print(f"Logit range: min={val_logits.min():.2f}, max={val_logits.max():.2f}")