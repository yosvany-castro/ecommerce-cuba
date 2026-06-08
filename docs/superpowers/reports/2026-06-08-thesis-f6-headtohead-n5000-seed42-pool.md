# Thesis F6 W1 — Head-to-head (frame: pool)

Item space: e1_prod2vec (canonical 64d). n=5000, seed=42. E1 universe: 4999. Products: 5000. Eval cases: 2893 (self 2015, gift 878). LLM: off.

**Pool frame** — candidates = each case's 4-source RRF(200) pool (still excludes train). Isolates the value of reranking GIVEN the retrieval.

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.019 | 0.029 | 0.036 | 0.056 | 0.033 | 0.021 | 0.056 | 24917.7700 | 0.108 | 0.398 | 0.917 |
| popular-global | 0.024 | 0.036 | 0.053 | 0.080 | 0.039 | 0.023 | 0.080 | 16080.4465 | 0.105 | 0.433 | 0.568 |
| popular-cohort | 0.205 | 0.235 | 0.267 | 0.386 | 0.206 | 0.189 | 0.386 | 22591.5600 | 0.107 | 0.241 | 0.000 |
| cosine-e1 | 0.032 | 0.050 | 0.075 | 0.108 | 0.051 | 0.032 | 0.108 | 31960.8959 | 0.109 | 0.053 | 0.948 |
| e2_hybrid | 0.040 | 0.060 | 0.087 | 0.130 | 0.058 | 0.039 | 0.130 | 31755.2537 | 0.108 | 0.056 | 0.915 |
| f2-multimode | 0.036 | 0.051 | 0.075 | 0.108 | 0.051 | 0.034 | 0.108 | 31598.4331 | 0.111 | 0.086 | 0.947 |
| f3-rrf | 0.116 | 0.149 | 0.180 | 0.280 | 0.127 | 0.110 | 0.280 | 31331.2241 | 0.111 | 0.166 | 0.841 |
| f3-ltr | 0.026 | 0.035 | 0.050 | 0.069 | 0.041 | 0.025 | 0.069 | 31175.7999 | 0.106 | 0.108 | 0.818 |
| f4-knee | 0.029 | 0.045 | 0.068 | 0.101 | 0.047 | 0.028 | 0.101 | 55533.2834 | 0.110 | 0.070 | 0.932 |
| f4-revenue | 0.021 | 0.035 | 0.058 | 0.083 | 0.040 | 0.021 | 0.083 | 58680.6688 | 0.106 | 0.174 | 0.936 |
| assembled-ltr-f4 | 0.029 | 0.045 | 0.068 | 0.101 | 0.047 | 0.028 | 0.101 | 55533.2834 | 0.110 | 0.070 | 0.932 |

## Self segment (intentGT=self, n=2015)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.034 | 0.066 | 0.038 |
| popular-global | 0.039 | 0.085 | 0.042 |
| popular-cohort | 0.144 | 0.278 | 0.125 |
| cosine-e1 | 0.067 | 0.146 | 0.066 |
| e2_hybrid | 0.081 | 0.176 | 0.075 |
| f2-multimode | 0.069 | 0.144 | 0.067 |
| f3-rrf | 0.181 | 0.344 | 0.150 |
| f3-ltr | 0.047 | 0.095 | 0.052 |
| f4-knee | 0.058 | 0.132 | 0.058 |
| f4-revenue | 0.045 | 0.106 | 0.048 |
| assembled-ltr-f4 | 0.058 | 0.132 | 0.058 |

## Gift segment (intentGT=gift, n=878)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.017 | 0.035 | 0.024 | 0.441 |
| popular-global | 0.030 | 0.067 | 0.033 | 0.402 |
| popular-cohort | 0.445 | 0.634 | 0.391 | 0.601 |
| cosine-e1 | 0.009 | 0.021 | 0.016 | 0.363 |
| e2_hybrid | 0.011 | 0.025 | 0.018 | 0.358 |
| f2-multimode | 0.009 | 0.023 | 0.015 | 0.355 |
| f3-rrf | 0.076 | 0.131 | 0.073 | 0.512 |
| f3-ltr | 0.006 | 0.011 | 0.015 | 0.316 |
| f4-knee | 0.014 | 0.030 | 0.021 | 0.568 |
| f4-revenue | 0.014 | 0.030 | 0.021 | 0.542 |
| assembled-ltr-f4 | 0.014 | 0.030 | 0.021 | 0.568 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **pool** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.149** vs popular-cohort's **0.235** — a -36.7% DEFICIT (and revenue@10 +38.7% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +159.7% vs popular-cohort, at nDCG@10 -85.0% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.045 (-80.9% vs PC), recall@10 -73.9%, revenue@10 +145.8% vs PC.

**Verdict (pool, n=5000, seed=42): even the relevance-optimal pipeline config (f3-rrf) does NOT beat popular-cohort on nDCG@10 (-36.7%).** Reported as-is per F6's honesty mandate. The cohort=subcategory rival is strong on a synthetic catalog of n=5000; W2 (scale) tests whether the cohort dilutes as the catalog grows.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.932; seller-gini@10 0.110 vs 0.107; diversity@10 0.070 vs 0.241. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

