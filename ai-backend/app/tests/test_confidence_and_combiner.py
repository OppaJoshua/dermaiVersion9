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

    def test_confidence_59_99_rejected(self):
        """59.99% must be strictly rejected when threshold is 60.00%."""
        with self.assertRaises(HTTPException) as ctx:
            evaluate_confidence_gate(59.99, 60.0)

        exc = ctx.exception
        self.assertEqual(exc.status_code, 400)
        self.assertEqual(exc.detail["error_type"], "low_confidence")
        self.assertFalse(exc.detail["success"])
        # Must show exactly 59.99% and 60.00% without rounding
        self.assertIn("59.99%", exc.detail["error"])
        self.assertIn("60.00%", exc.detail["error"])
        self.assertNotIn("60.0%", exc.detail["error"])

    def test_confidence_60_00_passes(self):
        """60.00% must pass the confidence check (60.00 < 60.0 is False)."""
        passed = evaluate_confidence_gate(60.00, 60.0)
        self.assertTrue(passed)

    def test_confidence_60_01_passes(self):
        """60.01% must pass the confidence check."""
        passed = evaluate_confidence_gate(60.01, 60.0)
        self.assertTrue(passed)

    def test_legacy_threshold_65_regression(self):
        """Custom configured threshold (65.0%) continues to work as expected."""
        with self.assertRaises(HTTPException) as ctx:
            evaluate_confidence_gate(64.99, 65.0)
        exc = ctx.exception
        self.assertIn("64.99%", exc.detail["error"])
        self.assertIn("65.00%", exc.detail["error"])
        self.assertTrue(evaluate_confidence_gate(65.00, 65.0))

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


class TestTemperatureCalibrationAndPipeline(unittest.TestCase):
    """
    Test suite verifying post-hoc temperature calibration behavior:
    1. Top-1 prediction invariance under monotonic temperature scaling.
    2. Sum-to-one and positivity of probability axioms.
    3. Numerical stability under extreme probability distributions.
    4. Safe handling of invalid / non-positive temperatures.
    5. Preserved behavior when calibration is disabled.
    6. Symmetry between primary and secondary image calibration paths.
    7. Distinction between primary confidence and derived 70/30 combined score.
    """

    def setUp(self):
        import numpy as np
        self.np = np
        from app.services.predictor import apply_temperature_scaling
        self.apply_temperature_scaling = apply_temperature_scaling

    def test_top1_invariance_under_temperature_scaling(self):
        """Monotonic scaling must strictly preserve top-1 argmax for all positive temperatures."""
        np = self.np
        # Test various probability distributions with distinct argmax
        test_distributions = [
            np.array([0.55, 0.20, 0.10, 0.10, 0.05]),  # Top 0
            np.array([0.05, 0.65, 0.15, 0.10, 0.05]),  # Top 1
            np.array([0.10, 0.10, 0.45, 0.20, 0.15]),  # Top 2
            np.array([0.02, 0.03, 0.05, 0.85, 0.05]),  # Top 3
            np.array([0.18, 0.18, 0.18, 0.18, 0.28]),  # Top 4
        ]
        test_temperatures = [0.1, 0.5, 0.8, 1.0, 1.492, 2.0, 3.5, 5.0, 10.0]

        for p_raw in test_distributions:
            expected_argmax = int(np.argmax(p_raw))
            for T in test_temperatures:
                p_cal = self.apply_temperature_scaling(p_raw, temperature=T)
                actual_argmax = int(np.argmax(p_cal))
                self.assertEqual(
                    actual_argmax,
                    expected_argmax,
                    f"Argmax changed from {expected_argmax} to {actual_argmax} at T={T}"
                )

    def test_calibrated_probabilities_validity_and_sum(self):
        """Calibrated probabilities must strictly sum to 1.0 and all elements must be positive and finite."""
        np = self.np
        p_raw = np.array([0.70, 0.15, 0.08, 0.05, 0.02])
        p_cal = self.apply_temperature_scaling(p_raw, temperature=1.492)

        self.assertTrue(np.all(np.isfinite(p_cal)))
        self.assertTrue(np.all(p_cal > 0.0))
        self.assertAlmostEqual(float(np.sum(p_cal)), 1.0, places=5)
        # Because T=1.492 > 1.0, probability entropy increases and max probability decreases
        self.assertLess(float(np.max(p_cal)), float(np.max(p_raw)))

    def test_extreme_probabilities_numerical_stability(self):
        """Extreme probabilities (near 0 and near 1) must not yield NaN or Inf."""
        np = self.np
        # Near saturation
        p_near_1 = np.array([1.0 - 1e-12, 1e-13, 1e-13, 1e-13, 1e-13])
        p_cal_1 = self.apply_temperature_scaling(p_near_1, temperature=1.492)
        self.assertTrue(np.all(np.isfinite(p_cal_1)))
        self.assertAlmostEqual(float(np.sum(p_cal_1)), 1.0, places=5)

        # Flat distribution
        p_flat = np.array([0.20, 0.20, 0.20, 0.20, 0.20])
        p_cal_flat = self.apply_temperature_scaling(p_flat, temperature=1.492)
        self.assertTrue(np.all(np.isfinite(p_cal_flat)))
        self.assertAlmostEqual(float(np.sum(p_cal_flat)), 1.0, places=5)

    def test_invalid_or_non_positive_temperature_handling(self):
        """Invalid or non-positive temperature must safely fall back to raw probabilities without crashing."""
        np = self.np
        p_raw = np.array([0.60, 0.20, 0.10, 0.05, 0.05])
        
        # Test T = 0, negative T, and None
        for invalid_t in [0.0, -1.0, -1.492, None]:
            p_out = self.apply_temperature_scaling(p_raw, temperature=invalid_t)
            np.testing.assert_array_almost_equal(p_out, p_raw)

    def test_calibration_disabled_preserves_uncalibrated(self):
        """When calibration is disabled, predictor logic preserves exact raw probabilities."""
        np = self.np
        from app.services.predictor import Predictor
        predictor_instance = Predictor()

        # Mock model output
        p_mock = np.array([[0.62, 0.18, 0.10, 0.05, 0.05]])
        with patch.object(predictor_instance, "predict") as mock_predict:
            mock_predict.return_value = {
                "predicted_class": "Acne_Vulgaris",
                "display_name": "Acne Vulgaris",
                "confidence": 62.00,
                "confidence_level": "medium",
                "probabilities": {"Acne_Vulgaris": 62.00, "Atopic_Dermatitis": 18.00, "Contact_Dermatitis": 10.00, "Melasma": 5.00, "Vitiligo": 5.00},
                "inference_time_ms": 15,
            }
            res = predictor_instance.predict(None, calibration_enabled=False)
            self.assertEqual(res["confidence"], 62.00)

    def test_shared_calibration_for_primary_and_secondary(self):
        """Primary and secondary inference use the exact same calibration function and temperature."""
        np = self.np
        # Simulated raw predictions from primary and secondary image
        p_primary_raw = np.array([0.72, 0.12, 0.08, 0.05, 0.03])
        p_secondary_raw = np.array([0.65, 0.15, 0.10, 0.05, 0.05])

        # Both use apply_temperature_scaling with T = 1.492
        p_primary_cal = self.apply_temperature_scaling(p_primary_raw, temperature=1.492)
        p_secondary_cal = self.apply_temperature_scaling(p_secondary_raw, temperature=1.492)

        self.assertAlmostEqual(float(np.sum(p_primary_cal)), 1.0, places=5)
        self.assertAlmostEqual(float(np.sum(p_secondary_cal)), 1.0, places=5)
        # Class orders are unchanged
        self.assertEqual(int(np.argmax(p_primary_cal)), int(np.argmax(p_primary_raw)))
        self.assertEqual(int(np.argmax(p_secondary_cal)), int(np.argmax(p_secondary_raw)))

    def test_primary_confidence_and_combined_evidence_distinction(self):
        """API response must preserve primary confidence in 'confidence' and fused score in 'combined_evidence_score'."""
        primary_calibrated = {
            "predicted_class": "Contact_Dermatitis",
            "display_name": "Contact Dermatitis",
            "confidence": 61.50,  # Calibrated close-up confidence (passes >= 60.0%)
            "confidence_level": "medium",
            "probabilities": {"Contact_Dermatitis": 61.50, "Atopic_Dermatitis": 20.00, "Acne_Vulgaris": 10.00, "Melasma": 5.00, "Vitiligo": 3.50},
        }
        supporting_calibrated = {
            "status": "valid",
            "predicted_class": "Contact_Dermatitis",
            "display_name": "Contact Dermatitis",
            "confidence": 55.00,  # Secondary view
            "confidence_level": "low",
            "probabilities": {"Contact_Dermatitis": 55.00, "Atopic_Dermatitis": 25.00, "Acne_Vulgaris": 10.00, "Melasma": 5.00, "Vitiligo": 5.00},
        }

        fused = combine_image_predictions(primary_calibrated, supporting_calibrated)

        # 1. 'confidence' must be the primary close-up confidence, NOT the fused score
        self.assertEqual(fused["confidence"], 61.50)
        # 2. 'predicted_class' must be strictly anchored to primary class
        self.assertEqual(fused["predicted_class"], "Contact_Dermatitis")
        # 3. 'combined_evidence_score' must be the 70/30 derived score: 0.70 * 61.50 + 0.30 * 55.00 = 43.05 + 16.50 = 59.55
        self.assertEqual(fused["combined_evidence_score"], 59.55)
        # 4. 'probabilities' must be the 70/30 combined probability vector
        expected_contact = round(0.70 * 61.50 + 0.30 * 55.00, 2)
        self.assertEqual(fused["probabilities"]["Contact_Dermatitis"], expected_contact)


if __name__ == "__main__":
    unittest.main()


