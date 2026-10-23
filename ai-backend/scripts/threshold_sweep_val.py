"""
Threshold sweep on VALIDATION set only.
Produces the table needed to justify the confidence gate to the panel.
DO NOT run this on test set.
"""
import json
import numpy as np
from scipy.special import softmax

# ---- Load calibration artifacts ----
val_logits = np.load("calibration/val_logits.npy")   # (260, 5)
val_labels = np.load("calibration/val_labels.npy")   # (260,)
T = json.load(open("calibration/temperature.json"))["temperature"]

CLASS_NAMES = ["Acne_Vulgaris", "Atopic_Dermatitis", "Contact_Dermatitis",
               "Melasma", "Vitiligo"]
N = len(val_labels)

def sweep(probs, labels, thresholds, label_prefix=""):
    """Compute every metric the panel will ask about."""
    preds = probs.argmax(axis=1)
    conf = probs.max(axis=1)
    correct = (preds == labels)

    rows = []
    for t in thresholds:
        accepted = conf >= t
        n_acc = int(accepted.sum())
        n_rej = N - n_acc
        acc_correct = int((accepted & correct).sum())
        acc_incorrect = int((accepted & ~correct).sum())

        coverage = n_acc / N
        sel_acc = acc_correct / n_acc if n_acc > 0 else float("nan")
        frr = ((~accepted) & correct).sum() / max(correct.sum(), 1)
        far = acc_incorrect / max(n_acc, 1)   # false acceptance rate among accepted

        # Per-class rejection rate: for each class, what fraction of true
        # samples of that class get rejected?
        per_class_rej = {}
        for k, name in enumerate(CLASS_NAMES):
            mask = labels == k
            if mask.sum() == 0:
                per_class_rej[name] = None
            else:
                per_class_rej[name] = round(float((~accepted[mask]).mean()), 3)

        rows.append({
            "threshold": round(float(t), 2),
            "coverage": round(coverage, 4),
            "accepted": n_acc,
            "rejected": n_rej,
            "selective_acc": round(sel_acc, 4) if n_acc > 0 else None,
            "incorrect_accepted": acc_incorrect,
            "false_accept_rate": round(far, 4),
            "false_reject_rate": round(float(frr), 4),
            "per_class_rejection": per_class_rej,
        })

    print(f"\n=== {label_prefix} (N={N}) ===")
    header = (f"{'θ':>5} {'cov':>6} {'acc':>6} {'sel_acc':>8} "
              f"{'inc_acc':>7} {'FAR':>6} {'FRR':>6}")
    print(header)
    print("-" * len(header))
    for r in rows:
        sel = f"{r['selective_acc']:.4f}" if r['selective_acc'] is not None else "  n/a"
        print(f"{r['threshold']:>5.2f} {r['coverage']:>6.3f} "
              f"{r['accepted']:>6d} {sel:>8} {r['incorrect_accepted']:>7d} "
              f"{r['false_accept_rate']:>6.3f} {r['false_reject_rate']:>6.3f}")
        print(f"        per-class rejection: {r['per_class_rejection']}")
    return rows

# ---- Thresholds to test ----
thresholds = np.arange(0.50, 0.96, 0.05)

# ---- Calibrated sweep (this is the one you ship) ----
cal_probs = softmax(val_logits / T, axis=1)
cal_rows = sweep(cal_probs, val_labels, thresholds, "CALIBRATED (T=1.492)")

# ---- Raw sweep (for "before" comparison only) ----
raw_probs = softmax(val_logits / 1.0, axis=1)
raw_rows = sweep(raw_probs, val_labels, thresholds, "RAW (T=1.000)")

# ---- Save for the paper ----
out = {
    "calibration_set": "validation",
    "n": N,
    "temperature": T,
    "constraint": "maximize selective_acc subject to coverage >= 0.80",
    "calibrated": cal_rows,
    "raw": raw_rows,
}
json.dump(out, open("calibration/threshold_sweep_validation.json", "w"), indent=2)
print("\nSaved: ai-backend/calibration/threshold_sweep_validation.json")