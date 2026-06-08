# Thesis F6 W1 — Head-to-head (frame: full)

Item space: e1_prod2vec (canonical 64d). n=10000, seed=42. E1 universe: 9999. Products: 10000. Eval cases: 2000 (self 1397, gift 603). LLM: off.

**Full frame** — candidates = catalog \ train (the production feed). Titular question: does the assembled pipeline beat popular-cohort here?

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 337.7274 | 0.131 | 0.572 | 0.998 |
| popular-global | 0.004 | 0.006 | 0.009 | 0.013 | 0.006 | 0.004 | 0.013 | 742.3311 | 0.223 | 0.721 | 0.968 |
| popular-cohort | 0.051 | 0.065 | 0.084 | 0.120 | 0.064 | 0.048 | 0.120 | 9502.4782 | 0.149 | 0.265 | 0.000 |
| cosine-e1 | 0.014 | 0.020 | 0.030 | 0.043 | 0.023 | 0.013 | 0.043 | 22239.3695 | 0.126 | 0.040 | 0.988 |
| e2_hybrid | 0.021 | 0.031 | 0.044 | 0.066 | 0.031 | 0.021 | 0.066 | 22826.0189 | 0.124 | 0.043 | 0.972 |
| f2-multimode | 0.012 | 0.017 | 0.027 | 0.036 | 0.018 | 0.012 | 0.036 | 25771.1072 | 0.121 | 0.073 | 0.986 |
| f3-rrf | 0.089 | 0.111 | 0.133 | 0.206 | 0.097 | 0.082 | 0.206 | 30984.5890 | 0.107 | 0.193 | 0.917 |
| f3-ltr | 0.011 | 0.016 | 0.024 | 0.035 | 0.022 | 0.011 | 0.035 | 30846.2389 | 0.109 | 0.083 | 0.906 |
| f4-knee | 0.014 | 0.024 | 0.038 | 0.054 | 0.030 | 0.014 | 0.054 | 57679.3193 | 0.110 | 0.054 | 0.983 |
| f4-revenue | 0.013 | 0.022 | 0.035 | 0.054 | 0.029 | 0.013 | 0.054 | 60534.2924 | 0.111 | 0.149 | 0.979 |
| assembled-ltr-f4 | 0.014 | 0.024 | 0.038 | 0.054 | 0.030 | 0.014 | 0.054 | 57679.3193 | 0.110 | 0.054 | 0.983 |

## Self segment (intentGT=self, n=1397)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.000 | 0.000 | 0.001 |
| popular-global | 0.008 | 0.018 | 0.008 |
| popular-cohort | 0.076 | 0.138 | 0.073 |
| cosine-e1 | 0.028 | 0.060 | 0.032 |
| e2_hybrid | 0.043 | 0.091 | 0.043 |
| f2-multimode | 0.024 | 0.052 | 0.024 |
| f3-rrf | 0.136 | 0.252 | 0.117 |
| f3-ltr | 0.023 | 0.048 | 0.028 |
| f4-knee | 0.029 | 0.070 | 0.035 |
| f4-revenue | 0.027 | 0.067 | 0.033 |
| assembled-ltr-f4 | 0.029 | 0.070 | 0.035 |

## Gift segment (intentGT=gift, n=603)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.002 | 0.002 | 0.002 | 0.220 |
| popular-global | 0.001 | 0.003 | 0.002 | 0.231 |
| popular-cohort | 0.039 | 0.080 | 0.044 | 0.688 |
| cosine-e1 | 0.002 | 0.005 | 0.003 | 0.321 |
| e2_hybrid | 0.003 | 0.008 | 0.004 | 0.324 |
| f2-multimode | 0.001 | 0.002 | 0.002 | 0.319 |
| f3-rrf | 0.053 | 0.100 | 0.053 | 0.474 |
| f3-ltr | 0.001 | 0.003 | 0.009 | 0.306 |
| f4-knee | 0.010 | 0.018 | 0.019 | 0.557 |
| f4-revenue | 0.012 | 0.023 | 0.020 | 0.540 |
| assembled-ltr-f4 | 0.010 | 0.018 | 0.019 | 0.557 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **full** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.111** vs popular-cohort's **0.065** — a +71.4% LIFT (and revenue@10 +226.1% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +537.0% vs popular-cohort, at nDCG@10 -65.2% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.024 (-63.5% vs PC), recall@10 -54.8%, revenue@10 +507.0% vs PC.

**Verdict (full, n=10000, seed=42): the pipeline BEATS the MVP rival on relevance (f3-rrf +71.4% nDCG@10) AND on revenue — the fair head-to-head the thesis declared pending (same cases, candidates, split). Caveat: no LEARNED reranker beats RRF (consistent with F3) — the win is the multi-source POOL, not the reranker. W2 tests whether this holds at larger n.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.983; seller-gini@10 0.110 vs 0.149; diversity@10 0.054 vs 0.265. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

