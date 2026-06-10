# Thesis F6 W1 — Head-to-head (frame: full)

Item space: e1_prod2vec (canonical 64d). n=5000, seed=123. E1 universe: 4995. Products: 5000. Eval cases: 2800 (self 1962, gift 838). LLM: off.

**Full frame** — candidates = catalog \ train (the production feed). Titular question: does the assembled pipeline beat popular-cohort here?

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.000 | 0.001 | 0.002 | 0.003 | 0.002 | 0.001 | 0.003 | 1213.1045 | 0.237 | 0.548 | 0.997 |
| popular-global | 0.003 | 0.004 | 0.006 | 0.009 | 0.005 | 0.003 | 0.009 | 1191.4836 | 0.165 | 0.611 | 0.968 |
| popular-cohort | 0.041 | 0.053 | 0.075 | 0.102 | 0.058 | 0.038 | 0.102 | 10147.2556 | 0.138 | 0.257 | 0.000 |
| popular-cohort-real | 0.011 | 0.016 | 0.027 | 0.034 | 0.021 | 0.010 | 0.034 | 15433.6865 | 0.108 | 0.256 | 0.551 |
| cosine-e1 | 0.024 | 0.036 | 0.055 | 0.079 | 0.037 | 0.024 | 0.079 | 26063.5183 | 0.121 | 0.034 | 0.977 |
| e2_hybrid | 0.026 | 0.041 | 0.061 | 0.090 | 0.041 | 0.026 | 0.090 | 26964.6653 | 0.109 | 0.039 | 0.945 |
| f2-multimode | 0.024 | 0.038 | 0.057 | 0.084 | 0.035 | 0.025 | 0.084 | 30059.2913 | 0.112 | 0.073 | 0.973 |
| f3-rrf | 0.027 | 0.041 | 0.059 | 0.092 | 0.040 | 0.026 | 0.092 | 31873.4859 | 0.104 | 0.147 | 0.898 |
| f3-ltr | 0.019 | 0.031 | 0.045 | 0.069 | 0.034 | 0.020 | 0.069 | 30355.1670 | 0.105 | 0.151 | 0.807 |
| f4-knee | 0.021 | 0.034 | 0.050 | 0.076 | 0.036 | 0.021 | 0.076 | 58815.9417 | 0.106 | 0.048 | 0.972 |
| f4-revenue | 0.016 | 0.027 | 0.043 | 0.062 | 0.032 | 0.017 | 0.062 | 61245.6360 | 0.102 | 0.139 | 0.974 |
| assembled-ltr-f4 | 0.021 | 0.034 | 0.050 | 0.076 | 0.036 | 0.021 | 0.076 | 58815.9417 | 0.106 | 0.048 | 0.972 |

## Self segment (intentGT=self, n=1962)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.001 | 0.002 | 0.002 |
| popular-global | 0.006 | 0.013 | 0.006 |
| popular-cohort | 0.062 | 0.116 | 0.066 |
| popular-cohort-real | 0.023 | 0.049 | 0.029 |
| cosine-e1 | 0.051 | 0.110 | 0.050 |
| e2_hybrid | 0.056 | 0.123 | 0.055 |
| f2-multimode | 0.053 | 0.117 | 0.048 |
| f3-rrf | 0.057 | 0.125 | 0.053 |
| f3-ltr | 0.043 | 0.095 | 0.045 |
| f4-knee | 0.047 | 0.105 | 0.048 |
| f4-revenue | 0.037 | 0.085 | 0.041 |
| assembled-ltr-f4 | 0.047 | 0.105 | 0.048 |

## Gift segment (intentGT=gift, n=838)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.001 | 0.004 | 0.002 | 0.235 |
| popular-global | 0.001 | 0.001 | 0.002 | 0.233 |
| popular-cohort | 0.031 | 0.069 | 0.039 | 0.696 |
| popular-cohort-real | 0.000 | 0.000 | 0.002 | 0.319 |
| cosine-e1 | 0.003 | 0.006 | 0.006 | 0.336 |
| e2_hybrid | 0.005 | 0.012 | 0.007 | 0.340 |
| f2-multimode | 0.004 | 0.006 | 0.005 | 0.341 |
| f3-rrf | 0.005 | 0.013 | 0.008 | 0.469 |
| f3-ltr | 0.003 | 0.006 | 0.009 | 0.357 |
| f4-knee | 0.003 | 0.007 | 0.009 | 0.473 |
| f4-revenue | 0.003 | 0.008 | 0.009 | 0.453 |
| assembled-ltr-f4 | 0.003 | 0.007 | 0.009 | 0.473 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **full** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.041** vs popular-cohort's **0.053** — a -21.2% DEFICIT (and revenue@10 +214.1% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +503.6% vs popular-cohort, at nDCG@10 -48.2% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.034 (-35.6% vs PC), recall@10 -25.6%, revenue@10 +479.6% vs PC.

**Verdict (full, n=5000, seed=123): even the relevance-optimal pipeline config (f3-rrf) does NOT beat popular-cohort on nDCG@10 (-21.2%).** Reported as-is per F6's honesty mandate. The cohort=subcategory rival is strong on a synthetic catalog of n=5000; W2 (scale) tests whether the cohort dilutes as the catalog grows.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.972; seller-gini@10 0.106 vs 0.138; diversity@10 0.048 vs 0.257. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

