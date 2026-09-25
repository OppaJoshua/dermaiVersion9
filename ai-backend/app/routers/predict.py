"""
DERMAI - Prediction Router
POST /predict endpoint
"""

from fastapi import APIRouter, UploadFile, File, HTTPException

from app.schemas.prediction import PredictionResponse, ErrorResponse
from app.services.predictor import predictor
from app.utils.image_utils import load_image_from_upload, ImageValidationError


router = APIRouter(tags=["Prediction"])


@router.post(
    "/predict",
    response_model=PredictionResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid image"},
        500: {"model": ErrorResponse, "description": "Server error"},
    },
    summary="Predict skin condition from image",
)
async def predict_skin_condition(
    image: UploadFile = File(..., description="Close-up skin image (JPG/PNG)"),
):
    """
    Run inference on an uploaded skin image using ResNet50.
    
    **Request:**
    - `image`: multipart/form-data image file (close-up photo)
    
    **Response:**
    - `predicted_class`: class label (e.g. `Acne_Vulgaris`)
    - `display_name`: human-readable name
    - `confidence`: 0-100 percentage
    - `confidence_level`: `high` | `medium` | `low`
    - `probabilities`: all 5 class probabilities
    - `inference_time_ms`: time taken
    """
    # Validate image
    try:
        img = await load_image_from_upload(image)
    except ImageValidationError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": str(e),
                "error_type": "validation",
            },
        )
    
    # Run inference
    try:
        result = predictor.predict(img)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": f"Inference failed: {str(e)}",
                "error_type": "inference",
            },
        )
    
    return PredictionResponse(**result)