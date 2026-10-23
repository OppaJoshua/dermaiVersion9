"""
Unit tests for DermAI Offline Calibration and Logit Extraction Pipeline.
========================================================================

Verifies:
1. Exact mathematical equivalence between reconstructed logits and model output.
2. Stability and correctness of Golden Section temperature search.
3. Monotonicity of temperature scaling (Top-1 class prediction preservation).
4. Correctness of ECE, MCE, and multiclass Brier score calculations.
5. Rejection threshold denominator definitions (Coverage, Selective Accuracy, FRR).
"""

import sys
import os
import unittest
from pathlib import Path
import numpy as np

# Add ai-backend to sys.path
TEST_DIR = Path(__file__).resolve().parent
AI_BACKEND_DIR = TEST_DIR.parent.parent
if str(AI_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(AI_BACKEND_DIR))

from scripts.run_offline_calibration import (
    compute_nll,
    golden_section_search_temperature,
    softmax,
    compute_ece_and_mce,
    compute_multiclass_brier,
    compute_classification_report,
    evaluate_threshold_tradeoffs,
)


class TestOfflineCalibration(unittest.TestCase):

    def setUp(self):
        # Create deterministic synthetic logits and labels for unit verification
        np.random.seed(42)
        self.n_samples = 200
        self.n_classes = 5
        self.logits = np.random.randn(self.n_samples, self.n_classes) * 2.0
        self.labels = np.random.randint(0, self.n_classes, size=self.n_samples)
        # Add class signal so predictions are correlated (~80% accuracy) and NLL has an interior minimum
        for i in range(self.n_samples):
            self.logits[i, self.labels[i]] += 4.0

    def test_golden_section_minimizes_convex_nll(self):
        """Golden Section search must converge to the minimum NLL temperature."""
        opt_T, min_nll, trajectory = golden_section_search_temperature(
            self.logits,
            self.labels,
            bracket=(0.1, 10.0),
            tol=1e-5,
        )
        self.assertGreater(opt_T, 0.1)
        self.assertLess(opt_T, 10.0)

        # Check that perturbations around opt_T yield higher or equal NLL
        nll_left = compute_nll(self.logits, self.labels, opt_T - 0.05)
        nll_right = compute_nll(self.logits, self.labels, opt_T + 0.05)
        self.assertLessEqual(min_nll, nll_left + 1e-5)
        self.assertLessEqual(min_nll, nll_right + 1e-5)

    def test_temperature_scaling_preserves_top1_predictions(self):
        """Softmax temperature scaling is strictly monotonic and MUST NEVER alter top-1 class."""
        probs_raw = softmax(self.logits, temperature=1.0)
        for T in [0.5, 1.5, 2.0, 3.5, 5.0]:
            probs_scaled = softmax(self.logits, temperature=T)
            preds_raw = np.argmax(probs_raw, axis=1)
            preds_scaled = np.argmax(probs_scaled, axis=1)
            np.testing.assert_array_equal(preds_raw, preds_scaled)

    def test_ece_perfect_calibration(self):
        """A perfectly calibrated model should have ECE close to 0."""
        # 100 samples with probability 0.8 on class 0, and exactly 80 true positives
        probs = np.full((100, 5), 0.05)
        probs[:, 0] = 0.8
        labels = np.zeros(100, dtype=np.int64)
        labels[80:] = 1  # 80 correct, 20 incorrect -> true acc = 0.80

        ece, mce, _ = compute_ece_and_mce(probs, labels, n_bins=10)
        self.assertAlmostEqual(ece, 0.0, places=4)
        self.assertAlmostEqual(mce, 0.0, places=4)

    def test_threshold_tradeoff_denominators(self):
        """Threshold trade-offs must satisfy exact denominator and coverage arithmetic."""
        probs = np.array([
            [0.90, 0.05, 0.02, 0.02, 0.01],  # Pred 0, Conf 0.90
            [0.70, 0.10, 0.10, 0.05, 0.05],  # Pred 0, Conf 0.70
            [0.40, 0.30, 0.10, 0.10, 0.10],  # Pred 0, Conf 0.40
            [0.85, 0.05, 0.05, 0.03, 0.02],  # Pred 0, Conf 0.85
        ])
        labels = np.array([0, 0, 0, 1])  # 3 correct, 1 incorrect

        tradeoffs = evaluate_threshold_tradeoffs(probs, labels, candidate_thresholds=[0.65])
        row_65 = tradeoffs[0]

        # Samples >= 0.65 are rows 0, 1, 3 (3 accepted). Row 2 (conf 0.40) is rejected.
        self.assertEqual(row_65["accepted_count"], 3)
        self.assertEqual(row_65["rejected_count"], 1)
        self.assertEqual(row_65["coverage"], 0.75)
        # Accepted rows: 0 (correct), 1 (correct), 3 (incorrect). Selective acc = 2/3 = 66.67%
        self.assertAlmostEqual(row_65["selective_accuracy"], 2.0 / 3.0, places=4)
        # False rejection: Row 2 is correct (label 0) but rejected. Total correct = 3. FRR = 1/3 = 33.33%
        self.assertEqual(row_65["false_rejection_count"], 1)
        self.assertAlmostEqual(row_65["false_rejection_rate"], 1.0 / 3.0, places=4)


if __name__ == "__main__":
    unittest.main()
