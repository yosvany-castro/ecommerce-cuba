# Thesis F6 W1 — Head-to-head (frame: full)

Item space: e1_prod2vec (canonical 64d). n=2000, seed=42. E1 universe: 1998. Products: 2000. Eval cases: 1107 (self 770, gift 337). LLM: off.

**Full frame** — candidates = catalog \ train (the production feed). Titular question: does the assembled pipeline beat popular-cohort here?

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.001 | 0.002 | 0.004 | 0.005 | 0.004 | 0.001 | 0.005 | 1290.1082 | 0.316 | 0.588 | 0.998 |
| popular-global | 0.004 | 0.007 | 0.010 | 0.020 | 0.009 | 0.004 | 0.020 | 1280.6041 | 0.219 | 0.575 | 0.971 |
| popular-cohort | 0.129 | 0.177 | 0.241 | 0.360 | 0.152 | 0.123 | 0.360 | 13284.2010 | 0.155 | 0.268 | 0.000 |
| cosine-e1 | 0.070 | 0.104 | 0.141 | 0.225 | 0.085 | 0.068 | 0.225 | 29542.0718 | 0.112 | 0.064 | 0.913 |
| e2_hybrid | 0.085 | 0.119 | 0.162 | 0.253 | 0.097 | 0.079 | 0.253 | 29867.1613 | 0.124 | 0.064 | 0.892 |
| f2-multimode | 0.069 | 0.102 | 0.137 | 0.220 | 0.081 | 0.067 | 0.220 | 29718.5179 | 0.112 | 0.093 | 0.919 |
| f3-rrf | 0.186 | 0.236 | 0.272 | 0.445 | 0.190 | 0.173 | 0.445 | 33448.8710 | 0.105 | 0.135 | 0.849 |
| f3-ltr | 0.086 | 0.119 | 0.149 | 0.239 | 0.103 | 0.083 | 0.239 | 31317.3412 | 0.105 | 0.141 | 0.818 |
| f4-knee | 0.075 | 0.104 | 0.138 | 0.213 | 0.092 | 0.071 | 0.213 | 53861.1347 | 0.107 | 0.101 | 0.921 |
| f4-revenue | 0.048 | 0.070 | 0.106 | 0.147 | 0.070 | 0.048 | 0.147 | 58321.5368 | 0.110 | 0.224 | 0.941 |
| assembled-ltr-f4 | 0.075 | 0.104 | 0.138 | 0.213 | 0.092 | 0.071 | 0.213 | 53861.1347 | 0.107 | 0.101 | 0.921 |

## Self segment (intentGT=self, n=770)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.001 | 0.003 | 0.003 |
| popular-global | 0.009 | 0.025 | 0.010 |
| popular-cohort | 0.184 | 0.369 | 0.157 |
| cosine-e1 | 0.146 | 0.314 | 0.117 |
| e2_hybrid | 0.167 | 0.355 | 0.133 |
| f2-multimode | 0.143 | 0.308 | 0.112 |
| f3-rrf | 0.294 | 0.557 | 0.232 |
| f3-ltr | 0.163 | 0.327 | 0.136 |
| f4-knee | 0.135 | 0.273 | 0.117 |
| f4-revenue | 0.092 | 0.188 | 0.089 |
| assembled-ltr-f4 | 0.135 | 0.273 | 0.117 |

## Gift segment (intentGT=gift, n=337)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.003 | 0.009 | 0.004 | 0.229 |
| popular-global | 0.003 | 0.009 | 0.006 | 0.249 |
| popular-cohort | 0.163 | 0.338 | 0.140 | 0.674 |
| cosine-e1 | 0.009 | 0.021 | 0.013 | 0.274 |
| e2_hybrid | 0.010 | 0.021 | 0.015 | 0.280 |
| f2-multimode | 0.008 | 0.021 | 0.009 | 0.295 |
| f3-rrf | 0.104 | 0.190 | 0.094 | 0.504 |
| f3-ltr | 0.018 | 0.039 | 0.029 | 0.306 |
| f4-knee | 0.032 | 0.077 | 0.034 | 0.520 |
| f4-revenue | 0.020 | 0.053 | 0.027 | 0.498 |
| assembled-ltr-f4 | 0.032 | 0.077 | 0.034 | 0.520 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **full** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.236** vs popular-cohort's **0.177** — a +33.2% LIFT (and revenue@10 +151.8% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +339.0% vs popular-cohort, at nDCG@10 -60.4% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.104 (-41.6% vs PC), recall@10 -40.7%, revenue@10 +305.5% vs PC.

**Verdict (full, n=2000, seed=42): the pipeline BEATS the MVP rival on relevance (f3-rrf +33.2% nDCG@10) AND on revenue — the fair head-to-head the thesis declared pending (same cases, candidates, split). Caveat: no LEARNED reranker beats RRF (consistent with F3) — the win is the multi-source POOL, not the reranker. W2 tests whether this holds at larger n.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.921; seller-gini@10 0.107 vs 0.155; diversity@10 0.101 vs 0.268. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

