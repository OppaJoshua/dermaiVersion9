"""
DERMAI - Pydantic Response Schemas
"""

from pydantic import BaseModel, Field
from typing import Dict, List


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