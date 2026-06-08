# Thesis F6 W1 — Head-to-head (frame: pool)

Item space: e1_prod2vec (canonical 64d). n=10000, seed=42. E1 universe: 9999. Products: 10000. Eval cases: 2000 (self 1397, gift 603). LLM: off.

**Pool frame** — candidates = each case's 4-source RRF(200) pool (still excludes train). Isolates the value of reranking GIVEN the retrieval.

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.013 | 0.022 | 0.031 | 0.048 | 0.026 | 0.014 | 0.048 | 25598.9259 | 0.107 | 0.372 | 0.917 |
| popular-global | 0.017 | 0.025 | 0.037 | 0.056 | 0.029 | 0.016 | 0.056 | 18427.3027 | 0.110 | 0.410 | 0.492 |
| popular-cohort | 0.183 | 0.204 | 0.225 | 0.317 | 0.183 | 0.170 | 0.317 | 23386.4820 | 0.109 | 0.252 | 0.000 |
| cosine-e1 | 0.021 | 0.030 | 0.045 | 0.066 | 0.034 | 0.020 | 0.066 | 32489.3097 | 0.105 | 0.052 | 0.965 |
| e2_hybrid | 0.027 | 0.039 | 0.055 | 0.084 | 0.041 | 0.026 | 0.084 | 32276.2602 | 0.107 | 0.055 | 0.939 |
| f2-multimode | 0.017 | 0.024 | 0.037 | 0.051 | 0.029 | 0.016 | 0.051 | 31346.3170 | 0.104 | 0.088 | 0.966 |
| f3-rrf | 0.089 | 0.111 | 0.133 | 0.206 | 0.096 | 0.082 | 0.206 | 30984.5890 | 0.107 | 0.193 | 0.854 |
| f3-ltr | 0.011 | 0.016 | 0.024 | 0.035 | 0.021 | 0.011 | 0.035 | 30846.2389 | 0.109 | 0.083 | 0.843 |
| f4-knee | 0.014 | 0.024 | 0.038 | 0.054 | 0.029 | 0.014 | 0.054 | 57679.3193 | 0.110 | 0.054 | 0.958 |
| f4-revenue | 0.013 | 0.022 | 0.035 | 0.054 | 0.028 | 0.013 | 0.054 | 60534.2924 | 0.111 | 0.149 | 0.954 |
| assembled-ltr-f4 | 0.014 | 0.024 | 0.038 | 0.054 | 0.029 | 0.014 | 0.054 | 57679.3193 | 0.110 | 0.054 | 0.958 |

## Self segment (intentGT=self, n=1397)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.025 | 0.055 | 0.028 |
| popular-global | 0.031 | 0.069 | 0.033 |
| popular-cohort | 0.115 | 0.205 | 0.105 |
| cosine-e1 | 0.039 | 0.083 | 0.042 |
| e2_hybrid | 0.053 | 0.111 | 0.052 |
| f2-multimode | 0.031 | 0.066 | 0.036 |
| f3-rrf | 0.136 | 0.252 | 0.116 |
| f3-ltr | 0.023 | 0.048 | 0.027 |
| f4-knee | 0.029 | 0.070 | 0.034 |
| f4-revenue | 0.027 | 0.067 | 0.032 |
| assembled-ltr-f4 | 0.029 | 0.070 | 0.034 |

## Gift segment (intentGT=gift, n=603)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.014 | 0.032 | 0.021 | 0.451 |
| popular-global | 0.013 | 0.027 | 0.020 | 0.381 |
| popular-cohort | 0.412 | 0.577 | 0.363 | 0.577 |
| cosine-e1 | 0.011 | 0.025 | 0.016 | 0.354 |
| e2_hybrid | 0.009 | 0.020 | 0.014 | 0.348 |
| f2-multimode | 0.008 | 0.018 | 0.013 | 0.345 |
| f3-rrf | 0.053 | 0.100 | 0.052 | 0.474 |
| f3-ltr | 0.001 | 0.003 | 0.007 | 0.306 |
| f4-knee | 0.010 | 0.018 | 0.017 | 0.557 |
| f4-revenue | 0.012 | 0.023 | 0.019 | 0.540 |
| assembled-ltr-f4 | 0.010 | 0.018 | 0.017 | 0.557 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **pool** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.111** vs popular-cohort's **0.204** — a -45.9% DEFICIT (and revenue@10 +32.5% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +158.8% vs popular-cohort, at nDCG@10 -89.0% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.024 (-88.5% vs PC), recall@10 -82.8%, revenue@10 +146.6% vs PC.

**Verdict (pool, n=10000, seed=42): even the relevance-optimal pipeline config (f3-rrf) does NOT beat popular-cohort on nDCG@10 (-45.9%).** Reported as-is per F6's honesty mandate. The cohort=subcategory rival is strong on a synthetic catalog of n=10000; W2 (scale) tests whether the cohort dilutes as the catalog grows.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.958; seller-gini@10 0.110 vs 0.109; diversity@10 0.054 vs 0.252. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

