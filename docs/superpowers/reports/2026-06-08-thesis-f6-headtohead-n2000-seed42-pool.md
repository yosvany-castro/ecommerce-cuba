# Thesis F6 W1 — Head-to-head (frame: pool)

Item space: e1_prod2vec (canonical 64d). n=2000, seed=42. E1 universe: 1998. Products: 2000. Eval cases: 1107 (self 770, gift 337). LLM: off.

**Pool frame** — candidates = each case's 4-source RRF(200) pool (still excludes train). Isolates the value of reranking GIVEN the retrieval.

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.018 | 0.027 | 0.033 | 0.051 | 0.034 | 0.020 | 0.051 | 23831.8432 | 0.108 | 0.448 | 0.912 |
| popular-global | 0.034 | 0.051 | 0.078 | 0.108 | 0.055 | 0.034 | 0.108 | 18581.5313 | 0.107 | 0.459 | 0.687 |
| popular-cohort | 0.259 | 0.311 | 0.359 | 0.546 | 0.258 | 0.239 | 0.546 | 23090.2309 | 0.105 | 0.235 | 0.000 |
| cosine-e1 | 0.072 | 0.109 | 0.148 | 0.237 | 0.091 | 0.071 | 0.237 | 32883.1652 | 0.111 | 0.069 | 0.885 |
| e2_hybrid | 0.088 | 0.125 | 0.170 | 0.265 | 0.104 | 0.083 | 0.265 | 32988.6751 | 0.107 | 0.068 | 0.852 |
| f2-multimode | 0.070 | 0.105 | 0.143 | 0.229 | 0.088 | 0.068 | 0.229 | 32365.7240 | 0.110 | 0.098 | 0.890 |
| f3-rrf | 0.186 | 0.236 | 0.272 | 0.445 | 0.189 | 0.173 | 0.445 | 33448.8710 | 0.105 | 0.135 | 0.790 |
| f3-ltr | 0.086 | 0.119 | 0.149 | 0.239 | 0.103 | 0.083 | 0.239 | 31317.3412 | 0.105 | 0.141 | 0.766 |
| f4-knee | 0.075 | 0.104 | 0.138 | 0.213 | 0.091 | 0.071 | 0.213 | 53861.1347 | 0.107 | 0.101 | 0.884 |
| f4-revenue | 0.048 | 0.070 | 0.106 | 0.147 | 0.070 | 0.048 | 0.147 | 58321.5368 | 0.110 | 0.224 | 0.912 |
| assembled-ltr-f4 | 0.075 | 0.104 | 0.138 | 0.213 | 0.091 | 0.071 | 0.213 | 53861.1347 | 0.107 | 0.101 | 0.884 |

## Self segment (intentGT=self, n=770)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.025 | 0.047 | 0.033 |
| popular-global | 0.057 | 0.123 | 0.060 |
| popular-cohort | 0.246 | 0.475 | 0.201 |
| cosine-e1 | 0.150 | 0.326 | 0.121 |
| e2_hybrid | 0.172 | 0.366 | 0.137 |
| f2-multimode | 0.145 | 0.314 | 0.117 |
| f3-rrf | 0.294 | 0.557 | 0.232 |
| f3-ltr | 0.163 | 0.327 | 0.135 |
| f4-knee | 0.135 | 0.273 | 0.117 |
| f4-revenue | 0.092 | 0.188 | 0.089 |
| assembled-ltr-f4 | 0.135 | 0.273 | 0.117 |

## Gift segment (intentGT=gift, n=337)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.031 | 0.062 | 0.036 | 0.432 |
| popular-global | 0.037 | 0.074 | 0.043 | 0.409 |
| popular-cohort | 0.459 | 0.706 | 0.388 | 0.606 |
| cosine-e1 | 0.014 | 0.033 | 0.022 | 0.293 |
| e2_hybrid | 0.018 | 0.033 | 0.027 | 0.291 |
| f2-multimode | 0.013 | 0.033 | 0.020 | 0.313 |
| f3-rrf | 0.104 | 0.190 | 0.092 | 0.504 |
| f3-ltr | 0.018 | 0.039 | 0.028 | 0.306 |
| f4-knee | 0.032 | 0.077 | 0.033 | 0.520 |
| f4-revenue | 0.020 | 0.053 | 0.026 | 0.498 |
| assembled-ltr-f4 | 0.032 | 0.077 | 0.033 | 0.520 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **pool** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.236** vs popular-cohort's **0.311** — a -24.0% DEFICIT (and revenue@10 +44.9% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +152.6% vs popular-cohort, at nDCG@10 -77.4% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.104 (-66.7% vs PC), recall@10 -60.9%, revenue@10 +133.3% vs PC.

**Verdict (pool, n=2000, seed=42): even the relevance-optimal pipeline config (f3-rrf) does NOT beat popular-cohort on nDCG@10 (-24.0%).** Reported as-is per F6's honesty mandate. The cohort=subcategory rival is strong on a synthetic catalog of n=2000; W2 (scale) tests whether the cohort dilutes as the catalog grows.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.884; seller-gini@10 0.107 vs 0.105; diversity@10 0.101 vs 0.235. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

