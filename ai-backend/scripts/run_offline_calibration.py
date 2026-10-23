"""
DERMAI - Standalone Offline Calibration & Confidence Threshold Evaluation Script
================================================================================

Strictly offline scientific experiment script.
- Does NOT modify production inference, model checkpoints, thresholds, or API behavior.
- Uses real production preprocessing from app.utils.image_utils.
- Extracts pre-Softmax logits via penultimate dense weights/bias.
- Validates numerical equivalence between reconstructed logits and model output.
- Fits temperature T on the VALIDATION split (D:\DATASET\dataset\validation) only.
- Evaluates raw vs. calibrated metrics on the UNTOUCHED TEST split (D:\DATASET\dataset\test).
- Evaluates selective classification trade-offs across candidate rejection thresholds.
"""

import sys
import os
import json
import time
from pathlib import Path
from typing import Dict, List, Tuple, Any

# Ensure stdout/stderr handle UTF-8 cleanly on Windows
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

# Add ai-backend to sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
AI_BACKEND_DIR = SCRIPT_DIR.parent
if str(AI_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(AI_BACKEND_DIR))

from PIL import Image
import numpy as np
import tensorflow as tf

from app.config import CLASS_NAMES, INPUT_SIZE
from app.utils.image_utils import preprocess_image
from app.services.model_loader import model_loader
from app.services.skin_validator import skin_validator


# =====================================================================
# CONFIGURATION
# =====================================================================
DEFAULT_DATASET_ROOT = Path(r"D:\DATASET\dataset")
OUTPUT_DIR = AI_BACKEND_DIR / "experiments" / "calibration_output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# =====================================================================
# TASK 2: EXACT LOGIT EXTRACTION & TOLERANCE VERIFICATION
# =====================================================================
class LogitExtractor:
    """
    Extracts exact pre-Softmax logits without altering model weights.
    Reconstructs logits: z = h @ W + b
    where h is the activation of the 'dropout' layer (penultimate 256-D feature),
    W is the kernel of 'dense_1' (256, 5), and b is the bias of 'dense_1' (5,).
    """

    def __init__(self, model):
        self.model = model
        self.dropout_layer = model.get_layer("dropout")
        self.feature_submodel = tf.keras.Model(
            inputs=model.inputs,
            outputs=self.dropout_layer.output,
        )
        self.dense_1 = model.get_layer("dense_1")
        self.W, self.b = self.dense_1.get_weights()
        assert self.W.shape == (256, 5), f"Unexpected W shape: {self.W.shape}"
        assert self.b.shape == (5,), f"Unexpected b shape: {self.b.shape}"

    def extract_logits_and_verify(
        self,
        img_array: np.ndarray,
        tolerance: float = 1e-5,
    ) -> Tuple[np.ndarray, np.ndarray, float]:
        """
        Extract logits, compute Softmax, and verify equivalence to direct model prediction.
        Returns:
            (logits, reconstructed_probs, max_abs_diff)
        """
        direct_probs = self.model.predict(img_array, verbose=0)[0]

        features = self.feature_submodel.predict(img_array, verbose=0)
        logits = np.dot(features, self.W) + self.b
        logits_1d = logits[0]

        # Numerically stable Softmax
        shift = logits_1d - np.max(logits_1d)
        exps = np.exp(shift)
        recon_probs = exps / np.sum(exps)

        diff = float(np.max(np.abs(direct_probs - recon_probs)))
        if diff > tolerance:
            raise ValueError(
                f"Logit reconstruction discrepancy {diff:.2e} exceeds tolerance {tolerance:.2e}"
            )

        return logits_1d, recon_probs, diff


# =====================================================================
# DATASET LOADING WITH AUDITING
# =====================================================================
def load_and_extract_split(
    split_dir: Path,
    extractor: LogitExtractor,
    class_names: List[str] = CLASS_NAMES,
    check_skin_validator: bool = True,
) -> Dict[str, Any]:
    """
    Iterates through class subdirectories of split_dir,
    runs production preprocessing, extracts logits and verifies tolerance.
    """
    print(f"\n📂 Scanning split: {split_dir}")
    if not split_dir.exists():
        raise FileNotFoundError(f"Split directory not found: {split_dir}")

    all_logits = []
    all_labels = []
    all_paths = []
    validator_scores = []
    excluded_by_validator = []
    max_tolerance_seen = 0.0

    for class_idx, class_name in enumerate(class_names):
        class_folder = split_dir / class_name
        if not class_folder.exists():
            raise FileNotFoundError(f"Class folder not found: {class_folder}")

        files = sorted([
            f for f in class_folder.iterdir()
            if f.is_file() and f.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
        ])
        print(f"  Class [{class_idx}] {class_name:20s}: {len(files)} images")

        for f in files:
            img = Image.open(f)
            if img.mode != "RGB":
                img = img.convert("RGB")

            # Check MobileNetV2 skin validator behavior
            if check_skin_validator:
                is_skin, skin_score = skin_validator.is_human_skin(img)
                validator_scores.append(skin_score)
                if not is_skin:
                    excluded_by_validator.append({
                        "file": str(f),
                        "class": class_name,
                        "skin_score": round(skin_score, 4),
                    })

            # Production preprocessing (Lanczos resize + preprocess_input)
            img_array = preprocess_image(img)

            # Logit extraction + tolerance check
            logits, _, diff = extractor.extract_logits_and_verify(img_array)
            if diff > max_tolerance_seen:
                max_tolerance_seen = diff

            all_logits.append(logits)
            all_labels.append(class_idx)
            all_paths.append(str(f))

    logits_arr = np.array(all_logits, dtype=np.float32)
    labels_arr = np.array(all_labels, dtype=np.int64)

    return {
        "split_name": split_dir.name,
        "sample_count": len(all_labels),
        "logits": logits_arr,
        "labels": labels_arr,
        "paths": all_paths,
        "max_reconstruction_diff": max_tolerance_seen,
        "validator_exclusions": excluded_by_validator,
    }


# =====================================================================
# TASK 3: TEMPERATURE SCALING OPTIMIZATION (NUMPY-ONLY BRENT/GOLDEN SEARCH)
# =====================================================================
def compute_nll(logits: np.ndarray, labels: np.ndarray, temperature: float) -> float:
    """
    Categorical Negative Log-Likelihood (cross-entropy) given temperature T.
    Numerically stable using logsumexp.
    """
    scaled_logits = logits / temperature
    max_z = np.max(scaled_logits, axis=1, keepdims=True)
    log_sum_exp = max_z + np.log(np.sum(np.exp(scaled_logits - max_z), axis=1, keepdims=True))
    log_probs = scaled_logits - log_sum_exp  # shape (N, C)

    # NLL = - 1/N sum log_probs[i, y_i]
    n = len(labels)
    correct_log_probs = log_probs[np.arange(n), labels]
    return -float(np.mean(correct_log_probs))


def golden_section_search_temperature(
    logits: np.ndarray,
    labels: np.ndarray,
    bracket: Tuple[float, float] = (0.05, 10.0),
    tol: float = 1e-6,
    max_iter: int = 150,
) -> Tuple[float, float, List[Dict[str, float]]]:
    """
    Stable bounded scalar minimizer for temperature T using Golden Section Search.
    Does not require scipy or external packages.
    """
    a, b = bracket
    phi = (np.sqrt(5.0) - 1.0) / 2.0  # ~0.61803398875

    c = b - phi * (b - a)
    d = a + phi * (b - a)
    nll_c = compute_nll(logits, labels, c)
    nll_d = compute_nll(logits, labels, d)

    trajectory = [
        {"iter": 0, "a": round(a, 6), "b": round(b, 6), "c": round(c, 6), "nll_c": round(nll_c, 6)}
    ]

    for it in range(1, max_iter + 1):
        if (b - a) < tol:
            break

        if nll_c < nll_d:
            b = d
            d = c
            nll_d = nll_c
            c = b - phi * (b - a)
            nll_c = compute_nll(logits, labels, c)
        else:
            a = c
            c = d
            nll_c = nll_d
            d = a + phi * (b - a)
            nll_d = compute_nll(logits, labels, d)

        if it % 10 == 0:
            trajectory.append({
                "iter": it,
                "a": round(a, 6),
                "b": round(b, 6),
                "current_best_T": round((a + b) / 2.0, 6),
                "current_best_NLL": round(min(nll_c, nll_d), 6),
            })

    optimal_t = float((a + b) / 2.0)
    final_nll = compute_nll(logits, labels, optimal_t)
    return optimal_t, final_nll, trajectory


# =====================================================================
# TASK 4: METRICS EVALUATION (ECE, MCE, BRIER, ACCURACY, CONFUSION MATRIX)
# =====================================================================
def softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    """Stable Softmax with optional temperature scaling."""
    scaled = logits / temperature
    max_z = np.max(scaled, axis=1, keepdims=True)
    exps = np.exp(scaled - max_z)
    return exps / np.sum(exps, axis=1, keepdims=True)


def compute_ece_and_mce(
    probs: np.ndarray,
    labels: np.ndarray,
    n_bins: int = 15,
) -> Tuple[float, float, List[Dict[str, Any]]]:
    """
    Computes Expected Calibration Error (ECE) and Maximum Calibration Error (MCE)
    with n_bins equal-width bins in [0, 1].
    """
    confidences = np.max(probs, axis=1)
    predictions = np.argmax(probs, axis=1)
    accuracies = (predictions == labels).astype(np.float64)

    bin_boundaries = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    mce = 0.0
    bin_details = []
    total_samples = len(labels)

    for i in range(n_bins):
        bin_lower = bin_boundaries[i]
        bin_upper = bin_boundaries[i + 1]

        # Use [lower, upper] for final bin, [lower, upper) otherwise
        if i == n_bins - 1:
            in_bin = (confidences >= bin_lower) & (confidences <= bin_upper)
        else:
            in_bin = (confidences >= bin_lower) & (confidences < bin_upper)

        bin_count = int(np.sum(in_bin))
        if bin_count > 0:
            bin_acc = float(np.mean(accuracies[in_bin]))
            bin_conf = float(np.mean(confidences[in_bin]))
            bin_error = abs(bin_acc - bin_conf)

            ece += (bin_count / total_samples) * bin_error
            if bin_error > mce:
                mce = bin_error

            bin_details.append({
                "bin_idx": i + 1,
                "range": f"[{bin_lower:.2f}, {bin_upper:.2f}]",
                "count": bin_count,
                "accuracy": round(bin_acc, 4),
                "confidence": round(bin_conf, 4),
                "error": round(bin_error, 4),
            })
        else:
            bin_details.append({
                "bin_idx": i + 1,
                "range": f"[{bin_lower:.2f}, {bin_upper:.2f}]",
                "count": 0,
                "accuracy": None,
                "confidence": None,
                "error": 0.0,
            })

    return float(ece), float(mce), bin_details


def compute_multiclass_brier(probs: np.ndarray, labels: np.ndarray) -> float:
    """Multiclass Brier score: 1/N sum_i sum_k (p_ik - y_ik)^2"""
    n, k = probs.shape
    one_hot = np.zeros((n, k), dtype=np.float64)
    one_hot[np.arange(n), labels] = 1.0
    return float(np.mean(np.sum((probs - one_hot) ** 2, axis=1)))


def compute_classification_report(
    preds: np.ndarray,
    labels: np.ndarray,
    class_names: List[str] = CLASS_NAMES,
) -> Dict[str, Any]:
    """Pure NumPy calculation of confusion matrix, precision, recall, F1 per class."""
    n_classes = len(class_names)
    cm = np.zeros((n_classes, n_classes), dtype=np.int64)
    for t, p in zip(labels, preds):
        cm[t, p] += 1

    per_class = {}
    precisions, recalls, f1s = [], [], []

    for i, name in enumerate(class_names):
        tp = float(cm[i, i])
        fp = float(np.sum(cm[:, i]) - tp)
        fn = float(np.sum(cm[i, :]) - tp)
        support = int(np.sum(cm[i, :]))

        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2.0 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0

        precisions.append(prec)
        recalls.append(rec)
        f1s.append(f1)

        per_class[name] = {
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1": round(f1, 4),
            "support": support,
        }

    macro_prec = float(np.mean(precisions))
    macro_rec = float(np.mean(recalls))
    macro_f1 = float(np.mean(f1s))
    accuracy = float(np.sum(preds == labels) / len(labels))

    return {
        "accuracy": round(accuracy, 4),
        "macro_precision": round(macro_prec, 4),
        "macro_recall": round(macro_rec, 4),
        "macro_f1": round(macro_f1, 4),
        "per_class": per_class,
        "confusion_matrix": cm.tolist(),
    }


# =====================================================================
# TASK 5: THRESHOLD TRADE-OFF EVALUATION (COVERAGE, ACCURACY, FRR)
# =====================================================================
def evaluate_threshold_tradeoffs(
    probs: np.ndarray,
    labels: np.ndarray,
    candidate_thresholds: List[float] = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95],
) -> List[Dict[str, Any]]:
    """
    Evaluates selective classification metrics at prespecified candidate thresholds:
    - Total samples (N)
    - Accepted count (N_acc): max_k p_ik >= theta
    - Rejected count (N_rej): max_k p_ik < theta
    - Coverage: N_acc / N
    - Selective Accuracy: accuracy on accepted samples
    - Total correct in dataset: N_correct_total
    - False Rejection Count: samples with (pred == label) that were rejected
    - False Rejection Rate (FRR): False Rejections / N_correct_total
    """
    total = len(labels)
    preds = np.argmax(probs, axis=1)
    confs = np.max(probs, axis=1)
    is_correct = (preds == labels)
    total_correct = int(np.sum(is_correct))

    tradeoffs = []
    for theta in candidate_thresholds:
        accepted_mask = confs >= theta
        rejected_mask = ~accepted_mask

        n_accepted = int(np.sum(accepted_mask))
        n_rejected = int(np.sum(rejected_mask))
        coverage = n_accepted / total

        if n_accepted > 0:
            sel_acc = float(np.mean(is_correct[accepted_mask]))
        else:
            sel_acc = 0.0

        false_rejections = int(np.sum(is_correct[rejected_mask]))
        frr = false_rejections / total_correct if total_correct > 0 else 0.0

        tradeoffs.append({
            "threshold": round(theta, 2),
            "coverage": round(coverage, 4),
            "coverage_pct": f"{coverage * 100:.1f}%",
            "accepted_count": n_accepted,
            "rejected_count": n_rejected,
            "selective_accuracy": round(sel_acc, 4),
            "selective_accuracy_pct": f"{sel_acc * 100:.2f}%",
            "false_rejection_count": false_rejections,
            "false_rejection_rate": round(frr, 4),
            "false_rejection_rate_pct": f"{frr * 100:.2f}%",
        })

    return tradeoffs


# =====================================================================
# MAIN RUNNER
# =====================================================================
def main():
    print("=" * 80)
    print("🔬 DERMAI OFFLINE TEMPERATURE CALIBRATION EXPERIMENT")
    print("=" * 80)
    print(f"Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Dataset root: {DEFAULT_DATASET_ROOT}")

    if not DEFAULT_DATASET_ROOT.exists():
        print(f"\n❌ BLOCKER: Dataset root not found: {DEFAULT_DATASET_ROOT}")
        sys.exit(1)

    val_dir = DEFAULT_DATASET_ROOT / "validation"
    test_dir = DEFAULT_DATASET_ROOT / "test"

    # 1. Load model via singleton
    print("\n[1/5] Loading production model checkpoint...")
    model = model_loader.get_model()
    extractor = LogitExtractor(model)
    print("  Model loaded successfully. Penultimate feature extractor ready.")

    # 2. Extract Validation Split
    print("\n[2/5] Extracting VALIDATION split logits (for temperature optimization)...")
    val_data = load_and_extract_split(val_dir, extractor, check_skin_validator=True)
    print(f"  Validation samples extracted: {val_data['sample_count']}")
    print(f"  Max logit reconstruction diff: {val_data['max_reconstruction_diff']:.2e}")
    print(f"  Validator exclusions: {len(val_data['validator_exclusions'])}")

    # 3. Fit Temperature on Validation Set ONLY
    print("\n[3/5] Fitting Temperature T on Validation split ONLY...")
    raw_val_nll = compute_nll(val_data["logits"], val_data["labels"], temperature=1.0)
    print(f"  Baseline Validation NLL (T=1.0000): {raw_val_nll:.4f}")

    opt_T, opt_val_nll, trajectory = golden_section_search_temperature(
        val_data["logits"],
        val_data["labels"],
        bracket=(0.05, 10.0),
        tol=1e-6,
    )
    print(f"  Optimization Complete:")
    print(f"  👉 Fitted Temperature T*:  {opt_T:.4f}")
    print(f"  👉 Minimized Validation NLL: {opt_val_nll:.4f} (improved by {raw_val_nll - opt_val_nll:.4f})")

    # 4. Extract Test Split (UNTOUCHED EVALUATION)
    print("\n[4/5] Extracting UNTOUCHED TEST split logits...")
    test_data = load_and_extract_split(test_dir, extractor, check_skin_validator=True)
    print(f"  Test samples extracted: {test_data['sample_count']}")
    print(f"  Max logit reconstruction diff: {test_data['max_reconstruction_diff']:.2e}")

    # Evaluate Raw vs Calibrated on Test Set
    print("\n[5/5] Evaluating Raw (T=1.0) vs Calibrated (T=T*) on Test Split...")
    raw_test_probs = softmax(test_data["logits"], temperature=1.0)
    cal_test_probs = softmax(test_data["logits"], temperature=opt_T)

    raw_nll = compute_nll(test_data["logits"], test_data["labels"], temperature=1.0)
    cal_nll = compute_nll(test_data["logits"], test_data["labels"], temperature=opt_T)

    raw_brier = compute_multiclass_brier(raw_test_probs, test_data["labels"])
    cal_brier = compute_multiclass_brier(cal_test_probs, test_data["labels"])

    raw_ece, raw_mce, raw_bins = compute_ece_and_mce(raw_test_probs, test_data["labels"], n_bins=15)
    cal_ece, cal_mce, cal_bins = compute_ece_and_mce(cal_test_probs, test_data["labels"], n_bins=15)

    test_preds = np.argmax(raw_test_probs, axis=1)
    cal_test_preds = np.argmax(cal_test_probs, axis=1)
    assert np.array_equal(test_preds, cal_test_preds), "Top-1 predictions changed under temperature scaling!"

    clf_report = compute_classification_report(test_preds, test_data["labels"])

    # Threshold Trade-offs
    raw_tradeoffs = evaluate_threshold_tradeoffs(raw_test_probs, test_data["labels"])
    cal_tradeoffs = evaluate_threshold_tradeoffs(cal_test_probs, test_data["labels"])

    # Build Complete Experiment Artifact
    experiment_results = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "model_path": str(model_loader._model_path if hasattr(model_loader, "_model_path") else "unfreeze_best.h5"),
        "fitted_temperature": round(opt_T, 4),
        "validation_metrics": {
            "sample_count": val_data["sample_count"],
            "raw_nll": round(raw_val_nll, 4),
            "calibrated_nll": round(opt_val_nll, 4),
            "nll_improvement": round(raw_val_nll - opt_val_nll, 4),
            "validator_exclusions": val_data["validator_exclusions"],
        },
        "test_metrics": {
            "sample_count": test_data["sample_count"],
            "top1_accuracy": clf_report["accuracy"],
            "macro_f1": clf_report["macro_f1"],
            "macro_precision": clf_report["macro_precision"],
            "macro_recall": clf_report["macro_recall"],
            "raw_evaluation": {
                "temperature": 1.0,
                "nll": round(raw_nll, 4),
                "ece_15bins": round(raw_ece, 4),
                "mce_15bins": round(raw_mce, 4),
                "brier_score": round(raw_brier, 4),
                "bin_details": raw_bins,
            },
            "calibrated_evaluation": {
                "temperature": round(opt_T, 4),
                "nll": round(cal_nll, 4),
                "ece_15bins": round(cal_ece, 4),
                "mce_15bins": round(cal_mce, 4),
                "brier_score": round(cal_brier, 4),
                "bin_details": cal_bins,
            },
            "classification_report": clf_report,
            "raw_threshold_tradeoffs": raw_tradeoffs,
            "calibrated_threshold_tradeoffs": cal_tradeoffs,
        },
    }

    # Save artifact
    output_path = OUTPUT_DIR / "calibration_experiment_results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(experiment_results, f, indent=2)
    print(f"\n✅ Results artifact saved: {output_path}")

    # Print Summary Tables
    print("\n" + "=" * 80)
    print("📊 UNTOUCHED TEST SET CALIBRATION SUMMARY (N = 265)")
    print("=" * 80)
    print(f"{'Metric':<25} {'Raw (T=1.000)':<20} {'Calibrated (T=' + f'{opt_T:.3f})':<20} {'Delta':<15}")
    print("-" * 80)
    print(f"{'Top-1 Accuracy':<25} {clf_report['accuracy']*100:.2f}%{'':<14} {clf_report['accuracy']*100:.2f}%{'':<14} {'0.00% (Preserved)':<15}")
    print(f"{'Negative Log-Likelihood':<25} {raw_nll:<20.4f} {cal_nll:<20.4f} {cal_nll - raw_nll:<15.4f}")
    print(f"{'Multiclass Brier Score':<25} {raw_brier:<20.4f} {cal_brier:<20.4f} {cal_brier - raw_brier:<15.4f}")
    print(f"{'ECE (15 equal bins)':<25} {raw_ece*100:<19.2f}% {cal_ece*100:<19.2f}% {(cal_ece - raw_ece)*100:<14.2f}%")
    print(f"{'MCE (15 equal bins)':<25} {raw_mce*100:<19.2f}% {cal_mce*100:<19.2f}% {(cal_mce - raw_mce)*100:<14.2f}%")

    print("\n" + "=" * 80)
    print("🎯 PER-CLASS PERFORMANCE (TEST SET)")
    print("=" * 80)
    print(f"{'Class':<22} {'Precision':<12} {'Recall':<12} {'F1-Score':<12} {'Support':<8}")
    print("-" * 80)
    for cname, metrics in clf_report["per_class"].items():
        print(f"{cname:<22} {metrics['precision']:<12.4f} {metrics['recall']:<12.4f} {metrics['f1']:<12.4f} {metrics['support']:<8}")

    print("\n" + "=" * 80)
    print("⚖️ REJECTION THRESHOLD TRADE-OFF TABLE (CALIBRATED T*)")
    print("=" * 80)
    print(f"{'Threshold':<10} {'Coverage':<12} {'Accepted':<10} {'Rejected':<10} {'Selective Acc':<16} {'FRR':<10}")
    print("-" * 80)
    for row in cal_tradeoffs:
        print(f"{row['threshold']:<10.2f} {row['coverage_pct']:<12} {row['accepted_count']:<10} {row['rejected_count']:<10} {row['selective_accuracy_pct']:<16} {row['false_rejection_rate_pct']:<10}")


if __name__ == "__main__":
    main()
