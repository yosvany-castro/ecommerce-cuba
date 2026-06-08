# Thesis F6 W1 — Head-to-head (frame: pool)

Item space: e1_prod2vec (canonical 64d). n=5000, seed=123. E1 universe: 4999. Products: 5000. Eval cases: 2801 (self 1963, gift 838). LLM: off.

**Pool frame** — candidates = each case's 4-source RRF(200) pool (still excludes train). Isolates the value of reranking GIVEN the retrieval.

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.021 | 0.030 | 0.039 | 0.059 | 0.035 | 0.022 | 0.059 | 25960.1532 | 0.109 | 0.399 | 0.916 |
| popular-global | 0.021 | 0.035 | 0.052 | 0.080 | 0.037 | 0.021 | 0.080 | 19314.7001 | 0.103 | 0.448 | 0.540 |
| popular-cohort | 0.200 | 0.231 | 0.262 | 0.385 | 0.200 | 0.183 | 0.385 | 23791.4043 | 0.103 | 0.264 | 0.000 |
| cosine-e1 | 0.034 | 0.052 | 0.079 | 0.114 | 0.053 | 0.034 | 0.114 | 32870.2292 | 0.101 | 0.054 | 0.948 |
| e2_hybrid | 0.048 | 0.067 | 0.096 | 0.136 | 0.065 | 0.046 | 0.136 | 32825.0430 | 0.105 | 0.056 | 0.915 |
| f2-multimode | 0.032 | 0.047 | 0.070 | 0.102 | 0.048 | 0.031 | 0.102 | 32529.8136 | 0.105 | 0.089 | 0.949 |
| f3-rrf | 0.123 | 0.154 | 0.187 | 0.287 | 0.130 | 0.113 | 0.287 | 31647.5060 | 0.105 | 0.150 | 0.840 |
| f3-ltr | 0.031 | 0.046 | 0.064 | 0.095 | 0.048 | 0.031 | 0.095 | 30012.8312 | 0.103 | 0.152 | 0.771 |
| f4-knee | 0.030 | 0.049 | 0.068 | 0.111 | 0.048 | 0.031 | 0.111 | 57358.6417 | 0.107 | 0.062 | 0.940 |
| f4-revenue | 0.023 | 0.039 | 0.060 | 0.087 | 0.042 | 0.025 | 0.087 | 59954.9977 | 0.108 | 0.158 | 0.940 |
| assembled-ltr-f4 | 0.030 | 0.049 | 0.068 | 0.111 | 0.048 | 0.031 | 0.111 | 57358.6417 | 0.107 | 0.062 | 0.940 |

## Self segment (intentGT=self, n=1963)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.033 | 0.062 | 0.038 |
| popular-global | 0.042 | 0.096 | 0.043 |
| popular-cohort | 0.149 | 0.284 | 0.130 |
| cosine-e1 | 0.071 | 0.154 | 0.068 |
| e2_hybrid | 0.089 | 0.182 | 0.084 |
| f2-multimode | 0.064 | 0.139 | 0.062 |
| f3-rrf | 0.195 | 0.363 | 0.163 |
| f3-ltr | 0.060 | 0.125 | 0.061 |
| f4-knee | 0.065 | 0.147 | 0.060 |
| f4-revenue | 0.050 | 0.111 | 0.052 |
| assembled-ltr-f4 | 0.065 | 0.147 | 0.060 |

## Gift segment (intentGT=gift, n=838)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.023 | 0.051 | 0.027 | 0.460 |
| popular-global | 0.018 | 0.044 | 0.024 | 0.409 |
| popular-cohort | 0.424 | 0.622 | 0.366 | 0.592 |
| cosine-e1 | 0.009 | 0.020 | 0.016 | 0.379 |
| e2_hybrid | 0.013 | 0.029 | 0.018 | 0.377 |
| f2-multimode | 0.007 | 0.014 | 0.014 | 0.374 |
| f3-rrf | 0.057 | 0.110 | 0.054 | 0.516 |
| f3-ltr | 0.011 | 0.025 | 0.018 | 0.348 |
| f4-knee | 0.012 | 0.026 | 0.018 | 0.553 |
| f4-revenue | 0.014 | 0.033 | 0.019 | 0.527 |
| assembled-ltr-f4 | 0.012 | 0.026 | 0.018 | 0.553 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **pool** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.154** vs popular-cohort's **0.231** — a -33.4% DEFICIT (and revenue@10 +33.0% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +152.0% vs popular-cohort, at nDCG@10 -83.2% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.049 (-78.8% vs PC), recall@10 -71.3%, revenue@10 +141.1% vs PC.

**Verdict (pool, n=5000, seed=123): even the relevance-optimal pipeline config (f3-rrf) does NOT beat popular-cohort on nDCG@10 (-33.4%).** Reported as-is per F6's honesty mandate. The cohort=subcategory rival is strong on a synthetic catalog of n=5000; W2 (scale) tests whether the cohort dilutes as the catalog grows.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.940; seller-gini@10 0.107 vs 0.103; diversity@10 0.062 vs 0.264. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

