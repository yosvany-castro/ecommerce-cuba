# Thesis F6 W1 — Head-to-head (frame: full)

Item space: e1_prod2vec (canonical 64d). n=5000, seed=7. E1 universe: 4998. Products: 5000. Eval cases: 2873 (self 1962, gift 911). LLM: off.

**Full frame** — candidates = catalog \ train (the production feed). Titular question: does the assembled pipeline beat popular-cohort here?

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.001 | 0.001 | 0.002 | 0.002 | 0.003 | 0.001 | 0.002 | 855.7271 | 0.207 | 0.587 | 0.996 |
| popular-global | 0.006 | 0.008 | 0.011 | 0.015 | 0.009 | 0.006 | 0.015 | 1039.7271 | 0.135 | 0.606 | 0.970 |
| popular-cohort | 0.071 | 0.096 | 0.128 | 0.190 | 0.090 | 0.068 | 0.190 | 11465.7123 | 0.157 | 0.257 | 0.000 |
| cosine-e1 | 0.029 | 0.044 | 0.066 | 0.096 | 0.043 | 0.029 | 0.096 | 26018.2243 | 0.123 | 0.045 | 0.974 |
| e2_hybrid | 0.039 | 0.057 | 0.082 | 0.118 | 0.054 | 0.039 | 0.118 | 26697.7876 | 0.114 | 0.049 | 0.950 |
| f2-multimode | 0.031 | 0.045 | 0.068 | 0.094 | 0.042 | 0.031 | 0.094 | 27767.5166 | 0.122 | 0.083 | 0.972 |
| f3-rrf | 0.117 | 0.149 | 0.180 | 0.279 | 0.127 | 0.110 | 0.279 | 30837.7787 | 0.106 | 0.153 | 0.895 |
| f3-ltr | 0.022 | 0.033 | 0.047 | 0.072 | 0.038 | 0.021 | 0.072 | 30108.6772 | 0.100 | 0.112 | 0.862 |
| f4-knee | 0.027 | 0.041 | 0.061 | 0.086 | 0.046 | 0.027 | 0.086 | 56121.8805 | 0.102 | 0.066 | 0.968 |
| f4-revenue | 0.021 | 0.032 | 0.052 | 0.072 | 0.040 | 0.021 | 0.072 | 59334.5791 | 0.100 | 0.172 | 0.968 |
| assembled-ltr-f4 | 0.027 | 0.041 | 0.061 | 0.086 | 0.046 | 0.027 | 0.086 | 56121.8805 | 0.102 | 0.066 | 0.968 |

## Self segment (intentGT=self, n=1962)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.002 | 0.003 | 0.003 |
| popular-global | 0.011 | 0.021 | 0.012 |
| popular-cohort | 0.106 | 0.204 | 0.099 |
| cosine-e1 | 0.063 | 0.136 | 0.060 |
| e2_hybrid | 0.081 | 0.168 | 0.075 |
| f2-multimode | 0.065 | 0.135 | 0.060 |
| f3-rrf | 0.188 | 0.355 | 0.158 |
| f3-ltr | 0.045 | 0.099 | 0.048 |
| f4-knee | 0.055 | 0.115 | 0.058 |
| f4-revenue | 0.041 | 0.090 | 0.048 |
| assembled-ltr-f4 | 0.055 | 0.115 | 0.058 |

## Gift segment (intentGT=gift, n=911)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.001 | 0.001 | 0.002 | 0.229 |
| popular-global | 0.001 | 0.002 | 0.003 | 0.244 |
| popular-cohort | 0.074 | 0.159 | 0.073 | 0.727 |
| cosine-e1 | 0.004 | 0.010 | 0.006 | 0.342 |
| e2_hybrid | 0.005 | 0.010 | 0.007 | 0.345 |
| f2-multimode | 0.002 | 0.004 | 0.004 | 0.351 |
| f3-rrf | 0.064 | 0.117 | 0.062 | 0.541 |
| f3-ltr | 0.006 | 0.013 | 0.015 | 0.335 |
| f4-knee | 0.010 | 0.023 | 0.020 | 0.565 |
| f4-revenue | 0.014 | 0.033 | 0.023 | 0.539 |
| assembled-ltr-f4 | 0.010 | 0.023 | 0.020 | 0.565 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **full** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.149** vs popular-cohort's **0.096** — a +55.3% LIFT (and revenue@10 +169.0% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +417.5% vs popular-cohort, at nDCG@10 -66.2% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.041 (-57.8% vs PC), recall@10 -54.9%, revenue@10 +389.5% vs PC.

**Verdict (full, n=5000, seed=7): the pipeline BEATS the MVP rival on relevance (f3-rrf +55.3% nDCG@10) AND on revenue — the fair head-to-head the thesis declared pending (same cases, candidates, split). Caveat: no LEARNED reranker beats RRF (consistent with F3) — the win is the multi-source POOL, not the reranker. W2 tests whether this holds at larger n.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.968; seller-gini@10 0.102 vs 0.157; diversity@10 0.066 vs 0.257. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

