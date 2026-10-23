import numpy as np
import json
from scipy.special import softmax
from scipy.optimize import minimize_scalar

# --- 1. Load the extracted validation data ---
val_logits = np.load("calibration/val_logits.npy")
val_labels = np.load("calibration/val_labels.npy")

# --- 2. Define the metric functions ---
def fit_temperature(logits, labels):
    def nll(T):
        probs = softmax(logits / T, axis=1)
        return -np.mean(np.log(probs[np.arange(len(labels)), labels] + 1e-12))
    res = minimize_scalar(nll, bounds=(0.05, 10.0), method="bounded")
    return res.x

def get_metrics(probs, labels, threshold):
    conf = probs.max(axis=1)
    preds = probs.argmax(axis=1)
    correct = (preds == labels)
    accepted = conf >= threshold
    n_acc = int(accepted.sum())
    if n_acc == 0:
        return 0.0, 0.0
    coverage = n_acc / len(labels)
    sel_acc = (accepted & correct).sum() / n_acc
    return coverage, sel_acc

# --- 3. Custom Stratified 5-Fold Split ---
# We build the folds by shuffling indices within each class, then splitting.
# This guarantees exactly 52 samples per class, split into 5 folds of ~10-11 each.
np.random.seed(42)
fold_assignments = np.zeros(len(val_labels), dtype=int)

for c in range(5):
    class_idx = np.where(val_labels == c)[0]
    np.random.shuffle(class_idx)
    for i, idx in enumerate(class_idx):
        fold_assignments[idx] = i % 5   # rotates 0,1,2,3,4

# --- 4. Run 5-Fold Cross-Calibration ---
print("Running 5-Fold Cross-Calibration on 260 images...\n")

thresholds = [0.50, 0.55, 0.60, 0.65, 0.70]
results = {t: {'cov': [], 'acc': []} for t in thresholds}

for fold in range(5):
    train_mask = fold_assignments != fold
    test_mask  = fold_assignments == fold

    train_logits, train_labels = val_logits[train_mask], val_labels[train_mask]
    test_logits,  test_labels  = val_logits[test_mask],  val_labels[test_mask]

    # Fit T on training folds
    T_fold = fit_temperature(train_logits, train_labels)
    
    # Test on held-out fold
    test_probs = softmax(test_logits / T_fold, axis=1)

    for t in thresholds:
        cov, sel_acc = get_metrics(test_probs, test_labels, t)
        results[t]['cov'].append(cov)
        results[t]['acc'].append(sel_acc)

    print(f"Fold {fold+1}: Fitted T = {T_fold:.3f} | Test N = {len(test_labels)}")

# --- 5. Print the Aggregated Results ---
print(f"\n{'Threshold':>9} | {'Avg Coverage':>12} | {'Std Dev':>8} | {'Avg Sel Accuracy':>16}")
print("-" * 60)

for t in thresholds:
    avg_cov = np.mean(results[t]['cov'])
    std_cov = np.std(results[t]['cov'])
    avg_acc = np.mean(results[t]['acc'])
    print(f"{t:>9.2f} | {avg_cov:>11.2%} | {std_cov:>7.2%} | {avg_acc:>15.2%}")
