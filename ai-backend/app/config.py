"""
DERMAI - AI Backend Configuration
Central config for paths, settings, class mappings
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ============================================
# PATHS
# ============================================

# Base directory (ai-backend/)
BASE_DIR = Path(__file__).resolve().parent.parent

# Model path
MODEL_PATH = BASE_DIR / os.getenv("MODEL_PATH", "models/unfreeze_best.h5").lstrip("./")

# ============================================
# SERVER CONFIGURATION
# ============================================

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))
DEBUG = os.getenv("DEBUG", "True").lower() == "true"

# CORS origins (comma-separated)
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:3000"
    ).split(",")
]

# ============================================
# MODEL CONFIGURATION
# ============================================

INPUT_SIZE = (224, 224)

# Class names in the EXACT order the model outputs them
# This order matches training: sorted alphabetically from flow_from_directory
CLASS_NAMES = [
    "Acne_Vulgaris",        # index 0
    "Atopic_Dermatitis",    # index 1
    "Contact_Dermatitis",   # index 2
    "Melasma",              # index 3
    "Vitiligo",             # index 4
]

# Human-readable display names
DISPLAY_NAMES = {
    "Acne_Vulgaris": "Acne Vulgaris",
    "Atopic_Dermatitis": "Atopic Dermatitis",
    "Contact_Dermatitis": "Contact Dermatitis",
    "Melasma": "Melasma",
    "Vitiligo": "Vitiligo",
}

# Mapping to Supabase skin_condition.condition_id (UUIDs from your schema)
# Used by frontend when saving results
CONDITION_UUIDS = {
    "Acne_Vulgaris":       "00000000-0000-0000-0000-000000000012",
    "Atopic_Dermatitis":   "00000000-0000-0000-0000-000000000013",
    "Contact_Dermatitis":  "00000000-0000-0000-0000-000000000014",
    "Melasma":             "00000000-0000-0000-0000-000000000015",
    "Vitiligo":            "00000000-0000-0000-0000-000000000011",
}

# ============================================
# CONFIDENCE THRESHOLDS
# ============================================

CONFIDENCE_HIGH = int(os.getenv("CONFIDENCE_HIGH", 80))
CONFIDENCE_MEDIUM = int(os.getenv("CONFIDENCE_MEDIUM", 60))


def get_confidence_level(confidence: float) -> str:
    """Convert numeric confidence to level string"""
    if confidence >= CONFIDENCE_HIGH:
        return "high"
    elif confidence >= CONFIDENCE_MEDIUM:
        return "medium"
    return "low"


# ============================================
# VALIDATION
# ============================================

def validate_config():
    """Check that required files exist at startup"""
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model not found at: {MODEL_PATH}")
    
    if len(CLASS_NAMES) != 5:
        raise ValueError(f"Expected 5 classes, got {len(CLASS_NAMES)}")
    
    return True