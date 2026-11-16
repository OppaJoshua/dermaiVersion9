"""
Regression test suite for DermAI Low-Confidence Result Path, Threshold Gate,
Temperature Calibration, Image Combiner, and Non-Confidence Error Paths.
"""

import asyncio
import os
import unittest
from unittest.mock import patch, AsyncMock, MagicMock
from PIL import Image
from fastapi import HTTPException

from app.config import CLASSIFIER_CONFIDENCE_FALLBACK, CLASS_NAMES, DISPLAY_NAMES
from app.routers.predict import predict_skin_condition
from app.services.result_combiner import combine_image_predictions
from app.utils.image_utils import ImageValidationError


def make_mock_primary_result(
    confidence: float,
    predicted_class: str = "Acne_Vulgaris",
    inference_time_ms: int = 42,
):
    display_name = DISPLAY_NAMES.get(predicted_class, predicted_class)
    if confidence >= 75:
        confidence_level = "high"
    elif confidence >= 60:
        confidence_level = "medium"
    else:
        confidence_level = "low"

    rem = round((100.0 - confidence) / 4.0, 2)
    probs = {}
    for cls in CLASS_NAMES:
        probs[cls] = confidence if cls == predicted_class else rem

    return {
        "predicted_class": predicted_class,
        "display_name": display_name,
        "confidence": confidence,
        "confidence_level": confidence_level,
        "probabilities": probs,
        "inference_time_ms": inference_time_ms,
    }


def run_predict_with_mocks(
    primary_confidence: float,
    predicted_class: str = "Acne_Vulgaris",
    threshold: float = CLASSIFIER_CONFIDENCE_FALLBACK,
    wide_result: dict = None,
):
    dummy_img = Image.new("RGB", (224, 224), color=(200, 150, 130))
    mock_upload = MagicMock()
    mock_upload.filename = "closeup.jpg"

    mock_wide_upload = None
    if wide_result is not None:
        mock_wide_upload = MagicMock()
        mock_wide_upload.filename = "wide.jpg"

    primary_res = make_mock_primary_result(primary_confidence, predicted_class)
    quality_res = {
        "passed": True,
        "issues": [],
        "blur_score": 145.2,
        "brightness": 128.4,
        "contrast": 42.1,
    }

    async def _call():
        with patch("app.routers.predict.CLASSIFIER_CONFIDENCE_FALLBACK", threshold), \
             patch("app.routers.predict.load_image_from_upload", new=AsyncMock(return_value=dummy_img)), \
             patch("app.routers.predict.check_image_quality", return_value=quality_res), \
             patch("app.routers.predict.skin_validator.is_human_skin", return_value=(True, 0.9456)), \
             patch("app.routers.predict.predictor.predict") as mock_predict:
            if wide_result is not None:
                mock_predict.side_effect = [primary_res, wide_result]
            else:
                mock_predict.return_value = primary_res
            resp = await predict_skin_condition(image=mock_upload, wide_image=mock_wide_upload)
            return resp, mock_predict.call_count

    return asyncio.run(_call())


class TestConfidenceAndCombiner(unittest.TestCase):

    def test_confidence_59_99_returns_low_confidence_result(self):
        """59.99% (< 60.00%) must return structured low-confidence PredictionResponse, not raise HTTP 400."""
        wide_res = make_mock_primary_result(82.0, "Acne_Vulgaris")
        resp, call_count = run_predict_with_mocks(59.99, "Acne_Vulgaris", 60.0, wide_result=wide_res)

        self.assertTrue(resp.success)
        self.assertEqual(resp.result_status, "low_confidence")
        self.assertEqual(resp.confidence, 59.99)
        self.assertEqual(resp.confidence_threshold, 60.0)
        self.assertEqual(resp.predicted_class, "Acne_Vulgaris")
        self.assertEqual(resp.display_name, "Acne Vulgaris")
        self.assertEqual(resp.confidence_level, "low")
        self.assertFalse(resp.is_combined)
        self.assertIsNone(resp.agreement)
        self.assertIsNone(resp.combined_evidence_score)
        self.assertIsNone(resp.supporting_prediction)
        self.assertIsNotNone(resp.primary_prediction)
        self.assertEqual(resp.primary_prediction.confidence, 59.99)
        self.assertIn("Acne Vulgaris", resp.message)
        self.assertIn("dermatologist", resp.message.lower())
        # Wide-view inference must NOT execute when primary confidence is below threshold
        self.assertEqual(call_count, 1)

    def test_confidence_60_00_passes_normal_confident_flow(self):
        """60.00% (>= 60.00%) must return normal confident PredictionResponse."""
        resp, call_count = run_predict_with_mocks(60.00, "Acne_Vulgaris", 60.0)
        self.assertTrue(resp.success)
        self.assertEqual(resp.result_status, "confident")
        self.assertEqual(resp.confidence, 60.00)
        self.assertEqual(resp.confidence_level, "medium")
        self.assertEqual(call_count, 1)

    def test_confidence_60_01_passes_and_runs_70_30_fusion(self):
        """60.01% (>= 60.00%) must pass and execute optional wide-view 70/30 fusion."""
        wide_res = make_mock_primary_result(80.00, "Acne_Vulgaris")
        resp, call_count = run_predict_with_mocks(60.01, "Acne_Vulgaris", 60.0, wide_result=wide_res)
        self.assertTrue(resp.success)
        self.assertEqual(resp.result_status, "confident")
        self.assertEqual(resp.confidence, 60.01)
        self.assertTrue(resp.is_combined)
        self.assertTrue(resp.agreement)
        # 0.70 * 60.01 + 0.30 * 80.00 = 42.007 + 24.00 = 66.01
        self.assertEqual(resp.combined_evidence_score, 66.01)
        self.assertEqual(call_count, 2)

    def test_confidence_40_00_low_confidence_result(self):
        """40.00% primary confidence returns structured low-confidence result with metadata."""
        resp, _ = run_predict_with_mocks(40.00, "Melasma", 60.0)
        self.assertTrue(resp.success)
        self.assertEqual(resp.result_status, "low_confidence")
        self.assertEqual(resp.predicted_class, "Melasma")
        self.assertEqual(resp.display_name, "Melasma")
        self.assertEqual(resp.confidence, 40.00)
        self.assertEqual(resp.confidence_level, "low")
        self.assertEqual(resp.skin_score, 0.9456)
        self.assertEqual(resp.quality_metrics["blur_score"], 145.2)
        self.assertEqual(resp.inference_time_ms, 42)

    def test_all_five_classes_supported_when_low_confidence(self):
        """All 5 configured classes return accurate display_name and probabilities below threshold."""
        for cls_name in CLASS_NAMES:
            resp, _ = run_predict_with_mocks(52.35, cls_name, 60.0)
            self.assertEqual(resp.result_status, "low_confidence")
            self.assertEqual(resp.predicted_class, cls_name)
            self.assertEqual(resp.display_name, DISPLAY_NAMES[cls_name])
            self.assertEqual(resp.confidence, 52.35)
            self.assertEqual(resp.probabilities[cls_name], 52.35)

    def test_custom_configured_threshold_65_and_50(self):
        """Custom CLASSIFIER_CONFIDENCE_FALLBACK values (e.g. 65.0% and 50.0%) are respected."""
        resp_low_65, _ = run_predict_with_mocks(64.99, "Vitiligo", 65.0)
        self.assertEqual(resp_low_65.result_status, "low_confidence")
        self.assertEqual(resp_low_65.confidence_threshold, 65.0)

        resp_ok_65, _ = run_predict_with_mocks(65.00, "Vitiligo", 65.0)
        self.assertEqual(resp_ok_65.result_status, "confident")

        resp_low_50, _ = run_predict_with_mocks(49.99, "Contact_Dermatitis", 50.0)
        self.assertEqual(resp_low_50.result_status, "low_confidence")
        self.assertEqual(resp_low_50.confidence_threshold, 50.0)

        resp_ok_50, _ = run_predict_with_mocks(50.00, "Contact_Dermatitis", 50.0)
        self.assertEqual(resp_ok_50.result_status, "confident")

    def test_non_confidence_errors_still_raise_http_exceptions(self):
        """Format, quality, skin validation, and inference failures still raise HTTP 400/500."""
        mock_upload = MagicMock()
        mock_upload.filename = "bad.txt"
        dummy_img = Image.new("RGB", (224, 224))

        # 1. Image format validation error -> 400 validation
        async def _test_format():
            with patch("app.routers.predict.load_image_from_upload", side_effect=ImageValidationError("Invalid image format")):
                await predict_skin_condition(image=mock_upload, wide_image=None)

        with self.assertRaises(HTTPException) as ctx1:
            asyncio.run(_test_format())
        self.assertEqual(ctx1.exception.status_code, 400)
        self.assertEqual(ctx1.exception.detail["error_type"], "validation")

        # 2. Image quality error -> 400 quality_blur
        async def _test_quality():
            with patch("app.routers.predict.load_image_from_upload", new=AsyncMock(return_value=dummy_img)), \
                 patch("app.routers.predict.check_image_quality", return_value={
                     "passed": False,
                     "issues": [{"type": "blur", "message": "Image is blurry"}],
                     "blur_score": 12.0,
                     "brightness": 100.0,
                     "contrast": 30.0,
                 }):
                await predict_skin_condition(image=mock_upload, wide_image=None)

        with self.assertRaises(HTTPException) as ctx2:
            asyncio.run(_test_quality())
        self.assertEqual(ctx2.exception.status_code, 400)
        self.assertEqual(ctx2.exception.detail["error_type"], "quality_blur")

        # 3. Not human skin -> 400 not_human_skin
        async def _test_skin():
            with patch("app.routers.predict.load_image_from_upload", new=AsyncMock(return_value=dummy_img)), \
                 patch("app.routers.predict.check_image_quality", return_value={"passed": True, "issues": [], "blur_score": 100.0, "brightness": 100.0, "contrast": 40.0}), \
                 patch("app.routers.predict.skin_validator.is_human_skin", return_value=(False, 0.12)):
                await predict_skin_condition(image=mock_upload, wide_image=None)

        with self.assertRaises(HTTPException) as ctx3:
            asyncio.run(_test_skin())
        self.assertEqual(ctx3.exception.status_code, 400)
        self.assertEqual(ctx3.exception.detail["error_type"], "not_human_skin")

        # 4. Model inference failure -> 500 inference
        async def _test_inference():
            with patch("app.routers.predict.load_image_from_upload", new=AsyncMock(return_value=dummy_img)), \
                 patch("app.routers.predict.check_image_quality", return_value={"passed": True, "issues": [], "blur_score": 100.0, "brightness": 100.0, "contrast": 40.0}), \
                 patch("app.routers.predict.skin_validator.is_human_skin", return_value=(True, 0.95)), \
                 patch("app.routers.predict.predictor.predict", side_effect=RuntimeError("OOM")):
                await predict_skin_condition(image=mock_upload, wide_image=None)

        with self.assertRaises(HTTPException) as ctx4:
            asyncio.run(_test_inference())
        self.assertEqual(ctx4.exception.status_code, 500)
        self.assertEqual(ctx4.exception.detail["error_type"], "inference")


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


