# Thesis F6 W1 — Head-to-head (frame: full)

Item space: e1_prod2vec (canonical 64d). n=5000, seed=123. E1 universe: 4926. Products: 5000. Eval cases: 2252 (self 2074, gift 178). LLM: off.

**Full frame** — candidates = catalog \ train (the production feed). Titular question: does the assembled pipeline beat popular-cohort here?

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | realizedRev@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.000 | 0.000 | 0.001 | 0.001 | 0.002 | 0.000 | 0.001 | 695.5301 | 3.8640 | 0.237 | 0.428 | 0.999 |
| popular-global | 0.037 | 0.044 | 0.053 | 0.071 | 0.043 | 0.036 | 0.071 | 943.4654 | 247.3860 | 0.229 | 0.905 | 0.965 |
| popular-cohort | 0.230 | 0.262 | 0.287 | 0.437 | 0.224 | 0.208 | 0.437 | 764.6336 | 1223.2696 | 0.163 | 0.687 | 0.000 |
| popular-cohort-real | 0.014 | 0.016 | 0.018 | 0.029 | 0.016 | 0.012 | 0.029 | 5296.2057 | 68.0108 | 0.124 | 0.685 | 0.924 |
| pc-views-multi | 0.024 | 0.033 | 0.047 | 0.067 | 0.032 | 0.023 | 0.067 | 1705.9548 | 201.0412 | 0.146 | 0.795 | 0.894 |
| e1-views-pop | 0.024 | 0.029 | 0.033 | 0.050 | 0.026 | 0.023 | 0.050 | 765.8168 | 137.9928 | 0.261 | 0.735 | 0.958 |
| rrf-sess-pop | 0.038 | 0.045 | 0.056 | 0.073 | 0.044 | 0.036 | 0.073 | 1081.3384 | 257.2488 | 0.255 | 0.910 | 0.959 |
| feed-pop | 0.036 | 0.043 | 0.051 | 0.075 | 0.040 | 0.033 | 0.075 | 1301.2086 | 253.6228 | 0.245 | 0.909 | 0.959 |
| cosine-e1 | 0.000 | 0.000 | 0.000 | 0.000 | 0.001 | 0.000 | 0.000 | 7246.1715 | 5.9805 | 0.166 | 0.154 | 1.000 |
| e2_hybrid | 0.000 | 0.001 | 0.001 | 0.003 | 0.001 | 0.001 | 0.003 | 2889.7906 | 15.0931 | 0.294 | 0.178 | 1.000 |
| f2-multimode | 0.000 | 0.000 | 0.000 | 0.001 | 0.001 | 0.000 | 0.001 | 8474.1370 | 1.8910 | 0.117 | 0.259 | 0.999 |
| f3-rrf | 0.005 | 0.006 | 0.008 | 0.012 | 0.010 | 0.004 | 0.012 | 14431.5089 | 27.0040 | 0.103 | 0.468 | 0.986 |
| f3-ltr | 0.003 | 0.004 | 0.006 | 0.009 | 0.009 | 0.003 | 0.009 | 12209.7769 | 9.2644 | 0.109 | 0.335 | 0.994 |
| f4-knee | 0.000 | 0.000 | 0.000 | 0.000 | 0.005 | 0.000 | 0.000 | 54539.7854 | 5.9805 | 0.108 | 0.204 | 1.000 |
| f4-revenue | 0.000 | 0.000 | 0.000 | 0.000 | 0.005 | 0.000 | 0.000 | 56633.7782 | 0.0000 | 0.110 | 0.252 | 0.999 |
| assembled-ltr-f4 | 0.000 | 0.000 | 0.000 | 0.000 | 0.005 | 0.000 | 0.000 | 54539.7854 | 5.9805 | 0.108 | 0.204 | 1.000 |

`realizedRev@10` = price×margin of the HELD-OUT purchase when captured in the top-10 (averaged over cases). Unlike `revenue@10` (model-expected, gameable by a blind price×margin sort), realized revenue can only be earned by surfacing what the user actually bought.

## Self segment (intentGT=self, n=2074)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.000 | 0.001 | 0.001 |
| popular-global | 0.043 | 0.069 | 0.042 |
| popular-cohort | 0.261 | 0.437 | 0.223 |
| popular-cohort-real | 0.017 | 0.031 | 0.017 |
| pc-views-multi | 0.035 | 0.071 | 0.033 |
| e1-views-pop | 0.030 | 0.052 | 0.027 |
| rrf-sess-pop | 0.044 | 0.071 | 0.044 |
| feed-pop | 0.042 | 0.074 | 0.039 |
| cosine-e1 | 0.000 | 0.000 | 0.001 |
| e2_hybrid | 0.001 | 0.003 | 0.002 |
| f2-multimode | 0.000 | 0.001 | 0.001 |
| f3-rrf | 0.005 | 0.011 | 0.009 |
| f3-ltr | 0.005 | 0.010 | 0.009 |
| f4-knee | 0.000 | 0.000 | 0.005 |
| f4-revenue | 0.000 | 0.000 | 0.005 |
| assembled-ltr-f4 | 0.000 | 0.000 | 0.005 |

## Gift segment (intentGT=gift, n=178)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.000 | 0.000 | 0.002 | 0.228 |
| popular-global | 0.059 | 0.090 | 0.055 | 0.294 |
| popular-cohort | 0.272 | 0.438 | 0.237 | 0.534 |
| popular-cohort-real | 0.007 | 0.011 | 0.009 | 0.281 |
| pc-views-multi | 0.013 | 0.028 | 0.020 | 0.255 |
| e1-views-pop | 0.023 | 0.028 | 0.024 | 0.234 |
| rrf-sess-pop | 0.054 | 0.096 | 0.047 | 0.304 |
| feed-pop | 0.052 | 0.090 | 0.045 | 0.304 |
| cosine-e1 | 0.000 | 0.000 | 0.001 | 0.213 |
| e2_hybrid | 0.000 | 0.000 | 0.001 | 0.251 |
| f2-multimode | 0.000 | 0.000 | 0.001 | 0.222 |
| f3-rrf | 0.012 | 0.022 | 0.014 | 0.246 |
| f3-ltr | 0.000 | 0.000 | 0.006 | 0.191 |
| f4-knee | 0.000 | 0.000 | 0.005 | 0.243 |
| f4-revenue | 0.000 | 0.000 | 0.005 | 0.251 |
| assembled-ltr-f4 | 0.000 | 0.000 | 0.005 | 0.243 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **full** frame, the relevance-optimal pipeline config (**rrf-sess-pop**) scores nDCG@10 **0.045** vs popular-cohort's **0.262** — a -83.0% DEFICIT (and revenue@10 +41.4% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +7306.7% vs popular-cohort, at nDCG@10 -100.0% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.000 (-99.9% vs PC), recall@10 -99.9%, revenue@10 +7032.8% vs PC.

**Verdict (full, n=5000, seed=123): even the relevance-optimal pipeline config (rrf-sess-pop) does NOT beat popular-cohort on nDCG@10 (-83.0%).** Reported as-is per F6's honesty mandate. The cohort=subcategory rival is strong on a synthetic catalog of n=5000; W2 (scale) tests whether the cohort dilutes as the catalog grows.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 1.000; seller-gini@10 0.108 vs 0.163; diversity@10 0.204 vs 0.687. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

