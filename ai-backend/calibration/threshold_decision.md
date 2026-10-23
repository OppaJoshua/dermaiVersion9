# Pre-registered constraint for threshold selection

**Date:** 2026-10-23 (fill in actual)
**Author:** DermAI capstone team

## Constraint
We will select the confidence threshold θ* that maximizes selective accuracy
on the VALIDATION set (N=260), subject to:
  - Coverage ≥ 0.80
  - Selective accuracy ≥ 0.85

## Why these constraints
- Coverage ≥ 0.80: A rejection rate above 20% would mean more than 1 in 5
  users is asked to retake, which is unacceptable for a consumer triage app.
- Selective accuracy ≥ 0.85: Below this, the accepted predictions are not
  meaningfully better than the raw model's accuracy on all data (80.4%),
  so the gate is not earning its cost.

## Why validation, not test
Tuning on the test set would constitute optimization on the reported metric.

## If no threshold satisfies both constraints
If no θ in [0.50, 0.95] satisfies both constraints, we will lower the
selective-accuracy floor to 0.83 and record this decision, and we will report
that the model does not meet the original target.

## Signed
[names]