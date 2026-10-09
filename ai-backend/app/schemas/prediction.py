"""
DERMAI - Pydantic Response Schemas
"""

from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any


class EvidencePrediction(BaseModel):
    """Prediction evidence for an individual image (close-up or wide-view)"""
    predicted_class: Optional[str] = None
    display_name: Optional[str] = None
    confidence: Optional[float] = None
    confidence_level: Optional[str] = None
    probabilities: Optional[Dict[str, float]] = None
    status: str = "valid"
    error: Optional[str] = None


class PredictionResponse(BaseModel):
    """Successful prediction response"""
    success: bool = True
    predicted_class: str = Field(..., description="Class label (e.g. Acne_Vulgaris)")
    display_name: str = Field(..., description="Human-readable name")
    confidence: float = Field(..., ge=0, le=100, description="Confidence percentage")
    confidence_level: str = Field(..., description="high | medium | low")
    probabilities: Dict[str, float] = Field(..., description="All class probabilities")
    inference_time_ms: int = Field(..., description="Time taken for inference")
    skin_score: float = Field(
        1.0, ge=0, le=1,
        description="Human-skin validator confidence (0=invalid, 1=valid)",
    )
    quality_metrics: Dict[str, float] = Field(
        default_factory=dict,
        description="Image quality metrics (blur_score, brightness, contrast)",
    )
    # Dual-image / Multi-view scan evidence fields
    is_combined: bool = False
    agreement: Optional[bool] = None
    combined_evidence_score: Optional[float] = Field(
        None,
        description="Derived system-level fusion score (70% primary + 30% supporting), NOT raw ResNet50 confidence",
    )
    primary_prediction: Optional[EvidencePrediction] = None
    supporting_prediction: Optional[EvidencePrediction] = None


class ErrorResponse(BaseModel):
    """Error response"""
    success: bool = False
    error: str
    error_type: str = Field(
        ...,
        description=(
            "validation | not_human_skin | low_confidence | "
            "quality_blur | quality_dark | quality_bright | "
            "quality_contrast | quality_resolution | inference | server"
        ),
    )
    all_issues: List[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    """Health check response"""
    status: str = "healthy"
    model_loaded: bool
    model_path: str
    classes: List[str]
    version: str = "1.0.0"