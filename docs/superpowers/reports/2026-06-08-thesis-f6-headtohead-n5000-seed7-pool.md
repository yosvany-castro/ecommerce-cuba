# Thesis F6 W1 — Head-to-head (frame: pool)

Item space: e1_prod2vec (canonical 64d). n=5000, seed=7. E1 universe: 4998. Products: 5000. Eval cases: 2873 (self 1962, gift 911). LLM: off.

**Pool frame** — candidates = each case's 4-source RRF(200) pool (still excludes train). Isolates the value of reranking GIVEN the retrieval.

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.018 | 0.025 | 0.033 | 0.047 | 0.031 | 0.018 | 0.047 | 24828.8524 | 0.107 | 0.391 | 0.916 |
| popular-global | 0.024 | 0.036 | 0.054 | 0.079 | 0.039 | 0.023 | 0.079 | 17690.1260 | 0.109 | 0.442 | 0.555 |
| popular-cohort | 0.198 | 0.229 | 0.258 | 0.378 | 0.200 | 0.184 | 0.378 | 23331.4614 | 0.106 | 0.243 | 0.000 |
| cosine-e1 | 0.033 | 0.051 | 0.075 | 0.111 | 0.051 | 0.033 | 0.111 | 32342.5402 | 0.106 | 0.053 | 0.953 |
| e2_hybrid | 0.044 | 0.064 | 0.091 | 0.133 | 0.062 | 0.044 | 0.133 | 32268.2914 | 0.105 | 0.056 | 0.918 |
| f2-multimode | 0.034 | 0.049 | 0.074 | 0.103 | 0.050 | 0.033 | 0.103 | 31838.3157 | 0.106 | 0.092 | 0.953 |
| f3-rrf | 0.117 | 0.149 | 0.180 | 0.279 | 0.126 | 0.110 | 0.279 | 30837.7787 | 0.106 | 0.153 | 0.841 |
| f3-ltr | 0.022 | 0.033 | 0.047 | 0.072 | 0.037 | 0.021 | 0.072 | 30108.6772 | 0.100 | 0.112 | 0.802 |
| f4-knee | 0.027 | 0.041 | 0.061 | 0.086 | 0.045 | 0.027 | 0.086 | 56121.8805 | 0.102 | 0.066 | 0.945 |
| f4-revenue | 0.021 | 0.032 | 0.052 | 0.072 | 0.039 | 0.021 | 0.072 | 59334.5791 | 0.100 | 0.172 | 0.942 |
| assembled-ltr-f4 | 0.027 | 0.041 | 0.061 | 0.086 | 0.045 | 0.027 | 0.086 | 56121.8805 | 0.102 | 0.066 | 0.945 |

## Self segment (intentGT=self, n=1962)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.026 | 0.048 | 0.033 |
| popular-global | 0.042 | 0.092 | 0.044 |
| popular-cohort | 0.138 | 0.267 | 0.120 |
| cosine-e1 | 0.070 | 0.152 | 0.068 |
| e2_hybrid | 0.088 | 0.181 | 0.083 |
| f2-multimode | 0.070 | 0.145 | 0.068 |
| f3-rrf | 0.188 | 0.355 | 0.157 |
| f3-ltr | 0.045 | 0.099 | 0.048 |
| f4-knee | 0.055 | 0.115 | 0.057 |
| f4-revenue | 0.041 | 0.090 | 0.047 |
| assembled-ltr-f4 | 0.055 | 0.115 | 0.057 |

## Gift segment (intentGT=gift, n=911)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.022 | 0.043 | 0.027 | 0.466 |
| popular-global | 0.024 | 0.050 | 0.029 | 0.418 |
| popular-cohort | 0.427 | 0.617 | 0.373 | 0.627 |
| cosine-e1 | 0.009 | 0.023 | 0.015 | 0.366 |
| e2_hybrid | 0.011 | 0.027 | 0.016 | 0.358 |
| f2-multimode | 0.005 | 0.013 | 0.013 | 0.369 |
| f3-rrf | 0.064 | 0.117 | 0.061 | 0.541 |
| f3-ltr | 0.006 | 0.013 | 0.014 | 0.335 |
| f4-knee | 0.010 | 0.023 | 0.018 | 0.565 |
| f4-revenue | 0.014 | 0.033 | 0.021 | 0.539 |
| assembled-ltr-f4 | 0.010 | 0.023 | 0.018 | 0.565 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **pool** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.149** vs popular-cohort's **0.229** — a -35.0% DEFICIT (and revenue@10 +32.2% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +154.3% vs popular-cohort, at nDCG@10 -85.9% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.041 (-82.3% vs PC), recall@10 -77.3%, revenue@10 +140.5% vs PC.

**Verdict (pool, n=5000, seed=7): even the relevance-optimal pipeline config (f3-rrf) does NOT beat popular-cohort on nDCG@10 (-35.0%).** Reported as-is per F6's honesty mandate. The cohort=subcategory rival is strong on a synthetic catalog of n=5000; W2 (scale) tests whether the cohort dilutes as the catalog grows.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.945; seller-gini@10 0.102 vs 0.106; diversity@10 0.066 vs 0.243. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

