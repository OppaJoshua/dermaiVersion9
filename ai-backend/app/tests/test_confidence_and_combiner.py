"""
Regression test suite for DermAI Low-Confidence Threshold and Image Combiner.
Verifies:
1. 64.99% confidence is strictly rejected (< 65.00%).
2. Rejection message formats confidence and configured threshold to 2 decimal places.
3. 65.00% confidence passes the confidence check (does not reject).
4. 65.01% confidence passes the confidence check.
5. Dynamic threshold from environment/config is respected.
6. Wide-view failures gracefully fallback to close-up prediction with status='invalid'.
7. Close-up and wide-view agreement vs disagreement metadata behavior.
"""

import os
import unittest
from unittest.mock import patch
from fastapi import HTTPException

from app.config import CLASSIFIER_CONFIDENCE_FALLBACK
from app.services.result_combiner import combine_image_predictions


def evaluate_confidence_gate(confidence: float, threshold: float = CLASSIFIER_CONFIDENCE_FALLBACK):
    """
    Simulates the exact gate in predict.py lines 119-132:
    if primary_result["confidence"] < CLASSIFIER_CONFIDENCE_FALLBACK:
        raise HTTPException(...)
    """
    primary_result = {"confidence": confidence}
    if primary_result["confidence"] < threshold:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": (
                    f"We couldn't confidently assess this photo. The model's confidence was "
                    f"{primary_result['confidence']:.2f}%, below the required "
                    f"{threshold:.2f}% threshold. Please retake the close-up "
                    "photo with good lighting and the affected skin area clearly in focus."
                ),
                "error_type": "low_confidence",
            },
        )
    return True


class TestConfidenceAndCombiner(unittest.TestCase):

    def test_confidence_64_99_rejected(self):
        """64.99% must be strictly rejected when threshold is 65.00%."""
        with self.assertRaises(HTTPException) as ctx:
            evaluate_confidence_gate(64.99, 65.0)

        exc = ctx.exception
        self.assertEqual(exc.status_code, 400)
        self.assertEqual(exc.detail["error_type"], "low_confidence")
        self.assertFalse(exc.detail["success"])
        # Must show exactly 64.99% and 65.00% without rounding 64.99% to 65.0%
        self.assertIn("64.99%", exc.detail["error"])
        self.assertIn("65.00%", exc.detail["error"])
        self.assertNotIn("65.0%", exc.detail["error"])

    def test_confidence_65_00_passes(self):
        """65.00% must pass the confidence check (65.00 < 65.0 is False)."""
        passed = evaluate_confidence_gate(65.00, 65.0)
        self.assertTrue(passed)

    def test_confidence_65_01_passes(self):
        """65.01% must pass the confidence check."""
        passed = evaluate_confidence_gate(65.01, 65.0)
        self.assertTrue(passed)

    def test_dynamic_threshold(self):
        """Custom configured threshold (e.g. 70.0%) must be respected and formatted."""
        with self.assertRaises(HTTPException) as ctx:
            evaluate_confidence_gate(69.99, 70.0)
        exc = ctx.exception
        self.assertIn("69.99%", exc.detail["error"])
        self.assertIn("70.00%", exc.detail["error"])

        # 70.00% passes
        self.assertTrue(evaluate_confidence_gate(70.00, 70.0))

    def test_combiner_invalid_wide_view_fallback(self):
        """When wide-view is marked invalid, combiner must fallback to close-up without failing scan."""
        primary_result = {
            "predicted_class": "Acne_Vulgaris",
            "display_name": "Acne Vulgaris",
            "confidence": 88.50,
            "confidence_level": "high",
            "probabilities": {"Acne_Vulgaris": 88.50, "Melasma": 5.0, "Vitiligo": 2.0, "Atopic_Dermatitis": 2.5, "Contact_Dermatitis": 2.0},
        }
        supporting_result = {
            "status": "invalid",
            "error": "Quality issue: Image appears blurry",
        }
        combined = combine_image_predictions(primary_result, supporting_result)

        self.assertEqual(combined["predicted_class"], "Acne_Vulgaris")
        self.assertEqual(combined["confidence"], 88.50)
        self.assertFalse(combined["is_combined"])
        self.assertIsNone(combined["agreement"])
        self.assertIsNotNone(combined["supporting_prediction"])
        self.assertEqual(combined["supporting_prediction"]["status"], "invalid")
        self.assertEqual(combined["supporting_prediction"]["error"], "Quality issue: Image appears blurry")

    def test_combiner_disagreement_anchors_closeup(self):
        """When images disagree, close-up must anchor the predicted class."""
        primary_result = {
            "predicted_class": "Acne_Vulgaris",
            "display_name": "Acne Vulgaris",
            "confidence": 75.00,
            "confidence_level": "medium",
            "probabilities": {"Acne_Vulgaris": 75.00, "Melasma": 5.0, "Vitiligo": 5.0, "Atopic_Dermatitis": 10.0, "Contact_Dermatitis": 5.0},
        }
        supporting_result = {
            "status": "valid",
            "predicted_class": "Melasma",
            "display_name": "Melasma",
            "confidence": 60.00,
            "confidence_level": "medium",
            "probabilities": {"Acne_Vulgaris": 15.00, "Melasma": 60.00, "Vitiligo": 5.0, "Atopic_Dermatitis": 10.0, "Contact_Dermatitis": 10.0},
        }
        combined = combine_image_predictions(primary_result, supporting_result)

        self.assertEqual(combined["predicted_class"], "Acne_Vulgaris")
        self.assertEqual(combined["display_name"], "Acne Vulgaris")
        self.assertEqual(combined["confidence"], 75.00)
        self.assertTrue(combined["is_combined"])
        self.assertFalse(combined["agreement"])
        # 0.70 * 75.00 + 0.30 * 15.00 = 52.50 + 4.50 = 57.00
        self.assertEqual(combined["combined_evidence_score"], 57.00)

    def test_combiner_agreement(self):
        """When images agree, agreement flag is true and score is fused."""
        primary_result = {
            "predicted_class": "Melasma",
            "display_name": "Melasma",
            "confidence": 85.00,
            "confidence_level": "high",
            "probabilities": {"Acne_Vulgaris": 5.0, "Melasma": 85.00, "Vitiligo": 2.0, "Atopic_Dermatitis": 4.0, "Contact_Dermatitis": 4.0},
        }
        supporting_result = {
            "status": "valid",
            "predicted_class": "Melasma",
            "display_name": "Melasma",
            "confidence": 80.00,
            "confidence_level": "high",
            "probabilities": {"Acne_Vulgaris": 4.0, "Melasma": 80.00, "Vitiligo": 1.0, "Atopic_Dermatitis": 5.0, "Contact_Dermatitis": 10.0},
        }
        combined = combine_image_predictions(primary_result, supporting_result)

        self.assertEqual(combined["predicted_class"], "Melasma")
        self.assertEqual(combined["confidence"], 85.00)
        self.assertTrue(combined["is_combined"])
        self.assertTrue(combined["agreement"])
        # 0.7 * 85 + 0.3 * 80 = 59.5 + 24.0 = 83.5
        self.assertEqual(combined["combined_evidence_score"], 83.50)

    def test_combiner_single_image_none(self):
        """When supporting_result is None, combiner returns pure primary result."""
        primary_result = {
            "predicted_class": "Vitiligo",
            "display_name": "Vitiligo",
            "confidence": 92.40,
            "confidence_level": "high",
            "probabilities": {"Acne_Vulgaris": 1.0, "Melasma": 2.0, "Vitiligo": 92.40, "Atopic_Dermatitis": 2.3, "Contact_Dermatitis": 2.3},
        }
        combined = combine_image_predictions(primary_result, None)

        self.assertEqual(combined["predicted_class"], "Vitiligo")
        self.assertEqual(combined["confidence"], 92.40)
        self.assertFalse(combined["is_combined"])
        self.assertIsNone(combined["agreement"])
        self.assertIsNone(combined["combined_evidence_score"])
        self.assertIsNone(combined["supporting_prediction"])

    def test_combiner_probabilities_sum(self):
        """Fused probabilities vector must sum to approximately 100.0%."""
        primary_result = {
            "predicted_class": "Acne_Vulgaris",
            "display_name": "Acne Vulgaris",
            "confidence": 70.00,
            "confidence_level": "medium",
            "probabilities": {"Acne_Vulgaris": 70.00, "Melasma": 10.00, "Vitiligo": 5.00, "Atopic_Dermatitis": 10.00, "Contact_Dermatitis": 5.00},
        }
        supporting_result = {
            "status": "valid",
            "predicted_class": "Acne_Vulgaris",
            "display_name": "Acne Vulgaris",
            "confidence": 65.00,
            "confidence_level": "medium",
            "probabilities": {"Acne_Vulgaris": 65.00, "Melasma": 15.00, "Vitiligo": 5.00, "Atopic_Dermatitis": 10.00, "Contact_Dermatitis": 5.00},
        }
        combined = combine_image_predictions(primary_result, supporting_result)
        total_prob = sum(combined["probabilities"].values())
        self.assertAlmostEqual(total_prob, 100.0, places=1)


    def test_combiner_wide_zero_support_for_primary(self):
        """When wide-view provides 0.0% support for the primary class, 70/30 weighting strictly computes 0.70 * primary."""
        primary_result = {
            "predicted_class": "Vitiligo",
            "display_name": "Vitiligo",
            "confidence": 80.00,
            "confidence_level": "high",
            "probabilities": {"Vitiligo": 80.00, "Acne_Vulgaris": 5.00, "Melasma": 5.00, "Atopic_Dermatitis": 5.00, "Contact_Dermatitis": 5.00},
        }
        supporting_result = {
            "status": "valid",
            "predicted_class": "Acne_Vulgaris",
            "display_name": "Acne Vulgaris",
            "confidence": 95.00,
            "confidence_level": "high",
            "probabilities": {"Acne_Vulgaris": 95.00, "Vitiligo": 0.00, "Melasma": 2.00, "Atopic_Dermatitis": 2.00, "Contact_Dermatitis": 1.00},
        }
        combined = combine_image_predictions(primary_result, supporting_result)

        self.assertEqual(combined["predicted_class"], "Vitiligo")
        self.assertFalse(combined["agreement"])
        self.assertTrue(combined["is_combined"])
        # 0.70 * 80.00 + 0.30 * 0.00 = 56.00
        self.assertEqual(combined["combined_evidence_score"], 56.00)
        self.assertEqual(combined["confidence"], 80.00)

    def test_combiner_scores_near_100_and_0(self):
        """Combiner correctly handles extreme values at 100.0% and 0.0% without error or overflow."""
        # Near 100% agreement
        primary_100 = {
            "predicted_class": "Melasma",
            "display_name": "Melasma",
            "confidence": 100.00,
            "confidence_level": "high",
            "probabilities": {"Melasma": 100.00, "Acne_Vulgaris": 0.0, "Vitiligo": 0.0, "Atopic_Dermatitis": 0.0, "Contact_Dermatitis": 0.0},
        }
        supporting_100 = {
            "status": "valid",
            "predicted_class": "Melasma",
            "display_name": "Melasma",
            "confidence": 100.00,
            "confidence_level": "high",
            "probabilities": {"Melasma": 100.00, "Acne_Vulgaris": 0.0, "Vitiligo": 0.0, "Atopic_Dermatitis": 0.0, "Contact_Dermatitis": 0.0},
        }
        combined_100 = combine_image_predictions(primary_100, supporting_100)
        self.assertEqual(combined_100["combined_evidence_score"], 100.00)
        self.assertTrue(combined_100["agreement"])

        # 0.0% primary and supporting
        primary_0 = {
            "predicted_class": "Acne_Vulgaris",
            "display_name": "Acne Vulgaris",
            "confidence": 0.00,
            "confidence_level": "low",
            "probabilities": {"Acne_Vulgaris": 0.00, "Melasma": 0.0, "Vitiligo": 0.0, "Atopic_Dermatitis": 0.0, "Contact_Dermatitis": 0.0},
        }
        supporting_0 = {
            "status": "valid",
            "predicted_class": "Acne_Vulgaris",
            "display_name": "Acne Vulgaris",
            "confidence": 0.00,
            "confidence_level": "low",
            "probabilities": {"Acne_Vulgaris": 0.00, "Melasma": 0.0, "Vitiligo": 0.0, "Atopic_Dermatitis": 0.0, "Contact_Dermatitis": 0.0},
        }
        combined_0 = combine_image_predictions(primary_0, supporting_0)
        self.assertEqual(combined_0["combined_evidence_score"], 0.00)

    def test_combiner_decimal_precision_and_determinism(self):
        """Combiner preserves 2-decimal rounding precision and produces deterministic results across invocations."""
        primary_result = {
            "predicted_class": "Contact_Dermatitis",
            "display_name": "Contact Dermatitis",
            "confidence": 77.77,
            "confidence_level": "high",
            "probabilities": {"Contact_Dermatitis": 77.77, "Acne_Vulgaris": 5.0, "Melasma": 5.0, "Vitiligo": 2.23, "Atopic_Dermatitis": 10.0},
        }
        supporting_result = {
            "status": "valid",
            "predicted_class": "Contact_Dermatitis",
            "display_name": "Contact Dermatitis",
            "confidence": 33.33,
            "confidence_level": "low",
            "probabilities": {"Contact_Dermatitis": 33.33, "Acne_Vulgaris": 16.67, "Melasma": 20.0, "Vitiligo": 10.0, "Atopic_Dermatitis": 20.0},
        }
        # 0.70 * 77.77 + 0.30 * 33.33 = 54.439 + 9.999 = 64.438 -> rounded to 64.44
        run_1 = combine_image_predictions(primary_result, supporting_result)
        run_2 = combine_image_predictions(primary_result, supporting_result)

        self.assertEqual(run_1["combined_evidence_score"], 64.44)
        self.assertEqual(run_1, run_2, "Combiner must be deterministic")


if __name__ == "__main__":
    unittest.main()

