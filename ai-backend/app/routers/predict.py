"""
DERMAI - Prediction Router
POST /predict endpoint.

Full pipeline (matches Manuscript Section 5.4):
    1. Image quality check  — blur, dark, contrast, resolution
    2. Skin validation      — human-skin detection
    3. Classification       — ResNet50 skin condition classifier
    4. Confidence fallback  — reject ambiguous predictions
"""

from typing import Optional
from fastapi import APIRouter, UploadFile, File, HTTPException

from app.schemas.prediction import PredictionResponse, ErrorResponse
from app.services.predictor import predictor
from app.services.skin_validator import skin_validator
from app.services.image_quality import check_image_quality, build_quality_error_response
from app.services.result_combiner import combine_image_predictions
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
    summary="Predict skin condition from close-up and optional supporting wide-view image",
)
async def predict_skin_condition(
    image: UploadFile = File(..., description="Primary close-up human-skin image (JPG/PNG)"),
    wide_image: Optional[UploadFile] = File(None, description="Optional supporting wide-view human-skin image (JPG/PNG)"),
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
    # STEP 4: Classification — Primary close-up image (ResNet50)
    # ==========================================================
    try:
        primary_result = predictor.predict(img)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": f"Primary image inference failed: {str(e)}",
                "error_type": "inference",
            },
        )

    # ==========================================================
    # STEP 5: Confidence fallback on primary image (safety net)
    # ==========================================================
    if primary_result["confidence"] < CLASSIFIER_CONFIDENCE_FALLBACK:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": (
                    f"The model is not confident enough on the close-up photo "
                    f"({primary_result['confidence']:.1f}%). "
                    "Please retake the photo with better lighting and a clear "
                    "close-up of the affected skin."
                ),
                "error_type": "low_confidence",
            },
        )

    # ==========================================================
    # STEP 6: Supporting wide-view image processing (Optional context)
    # Rules:
    #   - Run the SAME ResNet50 model separately (no tensor concatenation).
    #   - If wide-view fails validation/inference, DO NOT fail the scan.
    # ==========================================================
    supporting_result = None
    if wide_image is not None and getattr(wide_image, "filename", None):
        try:
            # 6.1 Validate wide-view format
            img_wide = await load_image_from_upload(wide_image)
            
            # 6.2 Quality check wide-view
            try:
                wide_quality = check_image_quality(img_wide)
            except Exception as e:
                print(f"⚠️ Wide-view quality check error: {e} — skipping check")
                wide_quality = {"passed": True, "issues": []}

            if not wide_quality["passed"]:
                supporting_result = {
                    "status": "invalid",
                    "error": f"Quality issue: {', '.join(wide_quality.get('issues', []))}",
                }
            else:
                # 6.3 Skin validation on wide-view
                try:
                    is_skin_wide, wide_skin_score = skin_validator.is_human_skin(img_wide)
                except Exception as e:
                    print(f"⚠️ Wide-view skin validator error: {e} — skipping")
                    is_skin_wide, wide_skin_score = True, 1.0

                if not is_skin_wide:
                    supporting_result = {
                        "status": "invalid",
                        "error": "Image did not meet human skin criteria",
                    }
                else:
                    # 6.4 Separate ResNet50 inference call on wide-view image
                    raw_wide = predictor.predict(img_wide)
                    supporting_result = {
                        **raw_wide,
                        "status": "valid",
                    }
        except Exception as e:
            print(f"⚠️ Wide-view processing skipped due to error: {e}")
            supporting_result = {
                "status": "invalid",
                "error": f"Processing error: {str(e)}",
            }

    # ==========================================================
    # STEP 7: Result combination layer
    # Weighted evidence: 70% Primary Close-Up, 30% Supporting Wide-View
    # ==========================================================
    final_output = combine_image_predictions(primary_result, supporting_result)

    # Attach metadata
    final_output["skin_score"] = round(skin_score, 4)
    final_output["quality_metrics"] = {
        "blur_score": quality["blur_score"],
        "brightness": quality["brightness"],
        "contrast": quality["contrast"],
    }
    total_time = primary_result.get("inference_time_ms", 0)
    if supporting_result and supporting_result.get("status") == "valid":
        total_time += supporting_result.get("inference_time_ms", 0)
    final_output["inference_time_ms"] = total_time

    return PredictionResponse(**final_output)