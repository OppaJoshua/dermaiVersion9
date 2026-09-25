"""
DERMAI - Pydantic Response Schemas
Defines the JSON structure returned by the API
"""

from pydantic import BaseModel, Field
from typing import Dict


class PredictionResponse(BaseModel):
    """Successful prediction response"""
    success: bool = True
    predicted_class: str = Field(..., description="Class label (e.g. Acne_Vulgaris)")
    display_name: str = Field(..., description="Human-readable name")
    confidence: float = Field(..., ge=0, le=100, description="Confidence percentage")
    confidence_level: str = Field(..., description="high | medium | low")
    probabilities: Dict[str, float] = Field(..., description="All class probabilities")
    inference_time_ms: int = Field(..., description="Time taken for inference")

    model_config = {
        "json_schema_extra": {
            "example": {
                "success": True,
                "predicted_class": "Acne_Vulgaris",
                "display_name": "Acne Vulgaris",
                "confidence": 95.66,
                "confidence_level": "high",
                "probabilities": {
                    "Acne_Vulgaris": 95.66,
                    "Atopic_Dermatitis": 1.04,
                    "Contact_Dermatitis": 0.60,
                    "Melasma": 0.69,
                    "Vitiligo": 2.02,
                },
                "inference_time_ms": 187,
            }
        }
    }


class ErrorResponse(BaseModel):
    """Error response"""
    success: bool = False
    error: str
    error_type: str = Field(..., description="validation | inference | server")


class HealthResponse(BaseModel):
    """Health check response"""
    status: str = "healthy"
    model_loaded: bool
    model_path: str
    classes: list[str]
    version: str = "1.0.0"