# Thesis F6 W1 — Head-to-head (frame: full)

Item space: e1_prod2vec (canonical 64d). n=5000, seed=42. E1 universe: 4999. Products: 5000. Eval cases: 2893 (self 2015, gift 878). LLM: off.

**Full frame** — candidates = catalog \ train (the production feed). Titular question: does the assembled pipeline beat popular-cohort here?

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.000 | 0.001 | 0.001 | 0.003 | 0.002 | 0.000 | 0.003 | 1108.3057 | 0.212 | 0.577 | 0.997 |
| popular-global | 0.004 | 0.006 | 0.009 | 0.012 | 0.007 | 0.004 | 0.012 | 1092.6790 | 0.168 | 0.609 | 0.968 |
| popular-cohort | 0.067 | 0.092 | 0.122 | 0.185 | 0.086 | 0.064 | 0.185 | 10989.5478 | 0.150 | 0.263 | 0.000 |
| cosine-e1 | 0.028 | 0.044 | 0.066 | 0.095 | 0.043 | 0.029 | 0.095 | 25124.3515 | 0.126 | 0.046 | 0.973 |
| e2_hybrid | 0.036 | 0.053 | 0.076 | 0.115 | 0.050 | 0.035 | 0.115 | 25666.3066 | 0.124 | 0.050 | 0.951 |
| f2-multimode | 0.032 | 0.047 | 0.068 | 0.099 | 0.042 | 0.031 | 0.099 | 26761.3677 | 0.127 | 0.079 | 0.972 |
| f3-rrf | 0.116 | 0.149 | 0.180 | 0.280 | 0.127 | 0.110 | 0.280 | 31331.2241 | 0.111 | 0.166 | 0.900 |
| f3-ltr | 0.026 | 0.035 | 0.050 | 0.069 | 0.041 | 0.025 | 0.069 | 31175.7999 | 0.106 | 0.108 | 0.881 |
| f4-knee | 0.029 | 0.045 | 0.068 | 0.101 | 0.047 | 0.028 | 0.101 | 55533.2834 | 0.110 | 0.070 | 0.961 |
| f4-revenue | 0.021 | 0.035 | 0.058 | 0.083 | 0.040 | 0.021 | 0.083 | 58680.6688 | 0.106 | 0.174 | 0.962 |
| assembled-ltr-f4 | 0.029 | 0.045 | 0.068 | 0.101 | 0.047 | 0.028 | 0.101 | 55533.2834 | 0.110 | 0.070 | 0.961 |

## Self segment (intentGT=self, n=2015)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.001 | 0.004 | 0.002 |
| popular-global | 0.007 | 0.015 | 0.008 |
| popular-cohort | 0.100 | 0.197 | 0.092 |
| cosine-e1 | 0.062 | 0.133 | 0.059 |
| e2_hybrid | 0.074 | 0.160 | 0.068 |
| f2-multimode | 0.065 | 0.137 | 0.059 |
| f3-rrf | 0.181 | 0.344 | 0.151 |
| f3-ltr | 0.047 | 0.095 | 0.052 |
| f4-knee | 0.058 | 0.132 | 0.058 |
| f4-revenue | 0.045 | 0.106 | 0.048 |
| assembled-ltr-f4 | 0.058 | 0.132 | 0.058 |

## Gift segment (intentGT=gift, n=878)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.000 | 0.001 | 0.001 | 0.240 |
| popular-global | 0.002 | 0.005 | 0.003 | 0.257 |
| popular-cohort | 0.074 | 0.156 | 0.072 | 0.692 |
| cosine-e1 | 0.003 | 0.007 | 0.006 | 0.337 |
| e2_hybrid | 0.005 | 0.011 | 0.007 | 0.342 |
| f2-multimode | 0.004 | 0.011 | 0.004 | 0.340 |
| f3-rrf | 0.076 | 0.131 | 0.074 | 0.512 |
| f3-ltr | 0.006 | 0.011 | 0.016 | 0.316 |
| f4-knee | 0.014 | 0.030 | 0.022 | 0.568 |
| f4-revenue | 0.014 | 0.030 | 0.022 | 0.542 |
| assembled-ltr-f4 | 0.014 | 0.030 | 0.022 | 0.568 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **full** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.149** vs popular-cohort's **0.092** — a +62.6% LIFT (and revenue@10 +185.1% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +434.0% vs popular-cohort, at nDCG@10 -61.4% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.045 (-51.0% vs PC), recall@10 -45.5%, revenue@10 +405.3% vs PC.

**Verdict (full, n=5000, seed=42): the pipeline BEATS the MVP rival on relevance (f3-rrf +62.6% nDCG@10) AND on revenue — the fair head-to-head the thesis declared pending (same cases, candidates, split). Caveat: no LEARNED reranker beats RRF (consistent with F3) — the win is the multi-source POOL, not the reranker. W2 tests whether this holds at larger n.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.961; seller-gini@10 0.110 vs 0.150; diversity@10 0.070 vs 0.263. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

