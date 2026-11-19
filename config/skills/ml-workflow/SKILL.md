---
name: ml-workflow
description: Rigorous machine-learning workflow with scikit-learn / XGBoost - framing, splits, baselines, cross-validation, metrics, leakage checks, tuning, explainability and reporting. Use for any predictive modelling, classification, regression, forecasting model, churn/demand/price prediction, or reviewing someone's ML notebook.
---

# ML workflow (do every step, in order)

Python: `~/freelance-portfolio/.venv/bin/python` (install missing well-known packages with
`uv pip install --python ~/freelance-portfolio/.venv/bin/python scikit-learn xgboost shap statsmodels`).

1. **Frame**: target, unit of prediction, when the prediction is made, what decision it drives, the cost of each error type.
   Write it down before touching models.
2. **Split first, look later**: hold out a test set immediately (stratified for classification; time-based split for
   anything with dates - never shuffle time series). Test set is touched ONCE at the end.
3. **Leakage audit**: for every feature ask "would I know this at prediction time?". Drop IDs, post-outcome fields,
   target-derived columns. Fit scalers/encoders/imputers inside a `Pipeline` so CV folds don't leak.
4. **Baseline**: majority class / mean / last-value / simple linear model. Every model must beat it on the same CV.
5. **Model**: start simple (logistic/linear, then tree ensembles). Use `cross_val_score` / `cross_validate` with
   `StratifiedKFold` or `TimeSeriesSplit`; report mean ± std.
6. **Metrics that match the decision**: classification -> precision/recall/F1, ROC-AUC and PR-AUC (PR-AUC when imbalanced),
   confusion matrix at a chosen threshold; regression -> MAE (explainable in units), RMSE, MAPE only if no zeros.
   Never report accuracy alone on imbalanced data.
7. **Tune** with `RandomizedSearchCV`/`GridSearchCV` inside CV only. Fix `random_state` everywhere.
8. **Final test**: fit on full train, evaluate once on test. If test << CV, investigate (leakage, drift) - don't re-tune on test.
9. **Explain**: feature importance (permutation importance preferred), SHAP summary for tree models, partial dependence;
   sanity-check that top features make business sense.
10. **Report**: problem, data, baseline vs model table, chosen threshold and why, limitations, next steps.
    Plots readable, labelled, one message each.

## Red flags to check before claiming results
- Near-perfect scores (AUC > 0.98) -> almost always leakage.
- Target imbalance not mentioned; duplicates across train/test; time leakage; tuning on test.
- Metrics on training data; no baseline; random split on time-dependent data.
Load `anti-sycophancy` before declaring a model "good".
