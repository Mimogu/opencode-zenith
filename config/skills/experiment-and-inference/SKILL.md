---
name: experiment-and-inference
description: Statistical inference done correctly - choosing the right test, checking assumptions, p-values vs effect sizes, confidence intervals, power/sample size, A/B tests, multiple comparisons, regression inference with statsmodels. Use for "is this difference significant", A/B test analysis, hypothesis testing, survey analysis, or when teaching statistics.
---

# Inference checklist

Complements `data:statistical-analysis` (descriptive/trends). Python: scipy.stats, statsmodels, pingouin optional.

## 1. Question -> test
| Question | Data | Test (parametric / robust) |
|---|---|---|
| 2 group means | numeric, independent | Welch t-test / Mann-Whitney U |
| Same units before/after | numeric, paired | paired t / Wilcoxon signed-rank |
| 3+ group means | numeric | Welch ANOVA / Kruskal-Wallis (+ post-hoc with correction) |
| 2+ proportions | counts | two-proportion z / chi-square (Fisher if expected < 5) |
| Association, 2 numeric | numeric | Pearson (linear) / Spearman (monotonic) |
| Effect of several factors | numeric target | OLS regression (statsmodels) with robust SE |
| Binary outcome | 0/1 | logistic regression |
Default to Welch (unequal variances), not Student t.

## 2. Assumptions (check, don't assume)
Independence (design!), outliers, normality of residuals only matters for small n (CLT helps n > ~30 per group),
equal variances (avoid needing it). Plot first: histograms/box plots per group.

## 3. Report properly
- Effect size with CI, not just p: mean difference + 95% CI, Cohen's d, relative lift, odds ratio.
- p-value in words: "if there were no real difference, a gap this large would happen ~X% of the time" -
  NOT "probability the hypothesis is true". p > 0.05 ≠ "no effect".
- Multiple tests -> Holm or Benjamini-Hochberg; say how many tests were run.
- Practical significance vs statistical significance (big n makes tiny effects "significant").

## 4. A/B tests
Pre-register metric, MDE, alpha, power (usually 0.8) -> sample size (statsmodels `NormalIndPower` /
`tt_ind_solve_power`). No peeking/early stopping without sequential methods. Check sample ratio mismatch
(chi-square on group sizes). Segment results only as exploratory.

## 5. Regression inference
Check residual plots, multicollinearity (VIF), heteroscedasticity (use HC3 robust SE), interpret coefficients in units,
"association, not causation" unless the design supports causal claims.

Load `anti-sycophancy` before concluding an effect is real.
