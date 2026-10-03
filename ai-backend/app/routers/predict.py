"""
DERMAI - Prediction Router
POST /predict endpoint.

Full pipeline (matches Manuscript Section 5.4):
    1. Image quality check  — blur, dark, contrast, resolution
    2. Skin validation      — human-skin detection
    3. Classification       — ResNet50 skin condition classifier
    4. Confidence fallback  — reject ambiguous predictions
"""

from fastapi import APIRouter, UploadFile, File, HTTPException

from app.schemas.prediction import PredictionResponse, ErrorResponse
from app.services.predictor import predictor
from app.services.skin_validator import skin_validator
from app.services.image_quality import check_image_quality, build_quality_error_response
from app.utils.image_utils import load_image_from_upload, ImageValidationError
from app.config import CLASSIFIER_CONFIDENCE_FALLBACK


router = APIRouter(tags=["Prediction"])


@router.post(
    "/predict",
    response_model=PredictionResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid image, quality issue, or not human skin"},
        500: {"model": ErrorResponse, "description": "Server error"},
    },
    summary="Predict skin condition from image",
)
async def predict_skin_condition(
    image: UploadFile = File(..., description="Close-up human-skin image (JPG/PNG)"),
):
    # ==========================================================
    # STEP 1: Image format validation
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
    # STEP 2: Image quality check (manuscript 5.4.1)
    # ==========================================================
    try:
        quality = check_image_quality(img)
    except Exception as e:
        print(f"⚠️  Quality check error: {e} — skipping")
        quality = {"passed": True, "issues": []}

    if not quality["passed"]:
        error_response = build_quality_error_response(quality["issues"])
        raise HTTPException(
            status_code=400,
            detail={
                **error_response,
                "quality_metrics": {
                    "blur_score": quality["blur_score"],
                    "brightness": quality["brightness"],
                    "contrast": quality["contrast"],
                },
            },
        )

    # ==========================================================
    # STEP 3: Human-skin validation (manuscript 5.4.2)
    # ==========================================================
    try:
        is_skin, skin_score = skin_validator.is_human_skin(img)
    except Exception as e:
        print(f"⚠️  Skin validator error: {e} — skipping")
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
    # STEP 4: Classification (ResNet50)
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
    # STEP 5: Confidence fallback (safety net)
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

    # Attach metadata
    result["skin_score"] = round(skin_score, 4)
    result["quality_metrics"] = {
        "blur_score": quality["blur_score"],
        "brightness": quality["brightness"],
        "contrast": quality["contrast"],
    }

    return PredictionResponse(**result)