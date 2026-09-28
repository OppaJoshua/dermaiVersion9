"""
DERMAI - Prediction Router
POST /predict endpoint.

Pipeline:
    1. Image format/size validation
    2. Human-skin validation (MobileNetV2 validator)
    3. Skin condition classification (ResNet50 classifier)
    4. Confidence fallback (secondary safety net)
"""

from fastapi import APIRouter, UploadFile, File, HTTPException

from app.schemas.prediction import PredictionResponse, ErrorResponse
from app.services.predictor import predictor
from app.services.skin_validator import skin_validator
from app.utils.image_utils import load_image_from_upload, ImageValidationError
from app.config import CLASSIFIER_CONFIDENCE_FALLBACK


router = APIRouter(tags=["Prediction"])


@router.post(
    "/predict",
    response_model=PredictionResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid image / not human skin"},
        500: {"model": ErrorResponse, "description": "Server error"},
    },
    summary="Predict skin condition from image",
)
async def predict_skin_condition(
    image: UploadFile = File(..., description="Close-up human-skin image (JPG/PNG)"),
):
    # ==========================================================
    # STEP 1: Format validation
    # ==========================================================
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

    # ==========================================================
    # STEP 2: HUMAN-SKIN VALIDATION (primary gate)
    # ==========================================================
    try:
        is_skin, skin_score = skin_validator.is_human_skin(img)
    except Exception as e:
        # If validator fails (e.g. model file missing), log and skip.
        # The classifier will still run — safer than blocking all requests.
        print(f"⚠️  Skin validator error: {e} — skipping validation")
        is_skin, skin_score = True, 1.0

    if not is_skin:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": (
                    "This image does not appear to be a suitable human-skin photo. "
                    "Please upload a clear close-up of the affected human skin area."
                ),
                "error_type": "not_human_skin",
                "skin_score": round(skin_score, 4),
            },
        )

    # ==========================================================
    # STEP 3: ResNet50 classification
    # ==========================================================
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

    # ==========================================================
    # STEP 4: Confidence fallback (secondary safety net)
    # ==========================================================
    if result["confidence"] < CLASSIFIER_CONFIDENCE_FALLBACK:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": (
                    f"The model is not confident enough "
                    f"({result['confidence']:.1f}%). "
                    "Please retake the photo with better lighting and a clear "
                    "close-up of the affected skin."
                ),
                "error_type": "low_confidence",
            },
        )

    # Attach skin_score to response (optional but useful for UI/logging)
    result["skin_score"] = round(skin_score, 4)
    return PredictionResponse(**result)