"""
DERMAI - Result Combiner Service
Combines predictions from primary (close-up) and supporting (wide-view) skin images.

Decision-level fusion strategy:
Close-up is treated as primary evidence and wide-view as supporting evidence.
The 70/30 weighting is a current system design choice.

Rules:
1. Two separate ResNet50 inference calls on the same model (no tensor concatenation).
2. Close-up is primary evidence because it shows detailed skin lesion morphology.
3. Wide-view is supporting evidence providing anatomical context.
4. If both agree: combine evidence for the agreed condition.
5. If predictions disagree: priority is given to close-up prediction; wide-view
   is preserved as supporting context. No random averaging to a third class.
6. If wide-view fails validation: fallback to close-up result without failing scan.
7. Preserves the exact 5-class scope (Melasma, Acne Vulgaris, Atopic Dermatitis,
   Contact Dermatitis, Vitiligo).
8. Preserves raw ResNet50 confidences independently. The 70/30 fused score is
   treated as a derived system-level fusion score, not raw model confidence.
"""

from typing import Dict, Any, Optional
from app.config import CLASS_NAMES, DISPLAY_NAMES, get_confidence_level


WEIGHT_PRIMARY = 0.70
WEIGHT_SUPPORTING = 0.30


def combine_image_predictions(
    primary_result: Dict[str, Any],
    supporting_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Fuse primary (close-up) and supporting (wide-view) ResNet50 prediction results.
    
    Args:
        primary_result: Prediction dictionary from close-up image.
        supporting_result: Optional prediction dictionary from wide-view image.
        
    Returns:
        Fused result dictionary containing final prediction, derived confidence,
        probabilities, agreement status, and individual evidence records.
    """
    # Build clean primary evidence record
    primary_evidence = {
        "predicted_class": primary_result.get("predicted_class"),
        "display_name": primary_result.get("display_name"),
        "confidence": primary_result.get("confidence"),
        "confidence_level": primary_result.get("confidence_level"),
        "probabilities": primary_result.get("probabilities"),
        "status": "valid",
    }
    
    # If supporting result is absent or marked invalid
    if not supporting_result or supporting_result.get("status") != "valid":
        supporting_evidence = None
        if supporting_result:
            supporting_evidence = {
                "predicted_class": supporting_result.get("predicted_class"),
                "display_name": supporting_result.get("display_name"),
                "confidence": supporting_result.get("confidence"),
                "confidence_level": supporting_result.get("confidence_level"),
                "probabilities": supporting_result.get("probabilities"),
                "status": supporting_result.get("status", "invalid"),
                "error": supporting_result.get("error"),
            }
            
        return {
            "predicted_class": primary_result["predicted_class"],
            "display_name": primary_result["display_name"],
            "confidence": primary_result["confidence"],
            "confidence_level": primary_result["confidence_level"],
            "probabilities": primary_result["probabilities"],
            "is_combined": False,
            "agreement": None,
            "combined_evidence_score": None,
            "primary_prediction": primary_evidence,
            "supporting_prediction": supporting_evidence,
        }

    # Supporting result is valid
    supporting_evidence = {
        "predicted_class": supporting_result.get("predicted_class"),
        "display_name": supporting_result.get("display_name"),
        "confidence": supporting_result.get("confidence"),
        "confidence_level": supporting_result.get("confidence_level"),
        "probabilities": supporting_result.get("probabilities"),
        "status": "valid",
    }

    primary_class = primary_result["predicted_class"]
    supporting_class = supporting_result["predicted_class"]
    agreement = (primary_class == supporting_class)

    # Compute fused class probabilities (70% primary + 30% supporting)
    # Decision-level fusion: Close-up is primary evidence and wide-view is supporting evidence.
    fused_probabilities: Dict[str, float] = {}
    primary_probs = primary_result.get("probabilities", {})
    supporting_probs = supporting_result.get("probabilities", {})

    for c in CLASS_NAMES:
        p_c = (WEIGHT_PRIMARY * primary_probs.get(c, 0.0)) + (WEIGHT_SUPPORTING * supporting_probs.get(c, 0.0))
        fused_probabilities[c] = round(p_c, 2)

    # Final condition is anchored by primary evidence (close-up)
    final_class = primary_class
    final_display_name = primary_result["display_name"]

    if agreement:
        # Both images agree on condition
        derived_fusion_score = round(
            (WEIGHT_PRIMARY * primary_result["confidence"]) +
            (WEIGHT_SUPPORTING * supporting_result["confidence"]),
            2
        )
    else:
        # Images disagree: close-up retains priority, supporting evidence weights its view
        supporting_prob_for_primary = supporting_probs.get(final_class, 0.0)
        derived_fusion_score = round(
            (WEIGHT_PRIMARY * primary_result["confidence"]) +
            (WEIGHT_SUPPORTING * supporting_prob_for_primary),
            2
        )

    return {
        "predicted_class": final_class,
        "display_name": final_display_name,
        # Preserve the raw ResNet50 confidence of the primary image:
        "confidence": primary_result["confidence"],
        "confidence_level": primary_result["confidence_level"],
        "probabilities": fused_probabilities,
        "is_combined": True,
        "agreement": agreement,
        # Explicit derived system-level fusion score (NOT raw ResNet50 confidence):
        "combined_evidence_score": derived_fusion_score,
        "primary_prediction": primary_evidence,
        "supporting_prediction": supporting_evidence,
    }
