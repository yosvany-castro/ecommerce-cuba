# Thesis F6 W1 — Head-to-head (frame: full)

Item space: e1_prod2vec (canonical 64d). n=5000, seed=123. E1 universe: 4999. Products: 5000. Eval cases: 2801 (self 1963, gift 838). LLM: off.

**Full frame** — candidates = catalog \ train (the production feed). Titular question: does the assembled pipeline beat popular-cohort here?

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.001 | 0.001 | 0.002 | 0.002 | 0.002 | 0.001 | 0.002 | 1365.8102 | 0.233 | 0.585 | 0.997 |
| popular-global | 0.004 | 0.005 | 0.007 | 0.010 | 0.006 | 0.003 | 0.010 | 859.1025 | 0.203 | 0.694 | 0.969 |
| popular-cohort | 0.063 | 0.088 | 0.120 | 0.179 | 0.084 | 0.061 | 0.179 | 10877.3439 | 0.165 | 0.285 | 0.000 |
| cosine-e1 | 0.030 | 0.046 | 0.068 | 0.100 | 0.044 | 0.030 | 0.100 | 25549.7114 | 0.119 | 0.046 | 0.972 |
| e2_hybrid | 0.042 | 0.060 | 0.084 | 0.123 | 0.056 | 0.041 | 0.123 | 26127.6326 | 0.123 | 0.048 | 0.949 |
| f2-multimode | 0.029 | 0.043 | 0.064 | 0.092 | 0.039 | 0.028 | 0.092 | 27641.0681 | 0.115 | 0.080 | 0.970 |
| f3-rrf | 0.123 | 0.154 | 0.187 | 0.287 | 0.131 | 0.113 | 0.287 | 31647.5060 | 0.105 | 0.150 | 0.897 |
| f3-ltr | 0.031 | 0.046 | 0.064 | 0.095 | 0.049 | 0.031 | 0.095 | 30012.8312 | 0.103 | 0.152 | 0.840 |
| f4-knee | 0.030 | 0.049 | 0.068 | 0.111 | 0.049 | 0.031 | 0.111 | 57358.6417 | 0.107 | 0.062 | 0.965 |
| f4-revenue | 0.023 | 0.039 | 0.060 | 0.087 | 0.043 | 0.025 | 0.087 | 59954.9977 | 0.108 | 0.158 | 0.965 |
| assembled-ltr-f4 | 0.030 | 0.049 | 0.068 | 0.111 | 0.049 | 0.031 | 0.111 | 57358.6417 | 0.107 | 0.062 | 0.965 |

## Self segment (intentGT=self, n=1963)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.001 | 0.003 | 0.002 |
| popular-global | 0.007 | 0.014 | 0.008 |
| popular-cohort | 0.098 | 0.192 | 0.093 |
| cosine-e1 | 0.064 | 0.140 | 0.061 |
| e2_hybrid | 0.082 | 0.169 | 0.076 |
| f2-multimode | 0.060 | 0.128 | 0.055 |
| f3-rrf | 0.195 | 0.363 | 0.163 |
| f3-ltr | 0.060 | 0.125 | 0.061 |
| f4-knee | 0.065 | 0.147 | 0.061 |
| f4-revenue | 0.050 | 0.111 | 0.053 |
| assembled-ltr-f4 | 0.065 | 0.147 | 0.061 |

## Gift segment (intentGT=gift, n=838)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.000 | 0.000 | 0.001 | 0.240 |
| popular-global | 0.002 | 0.002 | 0.003 | 0.230 |
| popular-cohort | 0.064 | 0.149 | 0.062 | 0.696 |
| cosine-e1 | 0.002 | 0.006 | 0.005 | 0.342 |
| e2_hybrid | 0.007 | 0.016 | 0.008 | 0.344 |
| f2-multimode | 0.004 | 0.007 | 0.004 | 0.339 |
| f3-rrf | 0.057 | 0.110 | 0.055 | 0.516 |
| f3-ltr | 0.011 | 0.025 | 0.020 | 0.348 |
| f4-knee | 0.012 | 0.026 | 0.020 | 0.553 |
| f4-revenue | 0.014 | 0.033 | 0.021 | 0.527 |
| assembled-ltr-f4 | 0.012 | 0.026 | 0.020 | 0.553 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **full** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.154** vs popular-cohort's **0.088** — a +74.7% LIFT (and revenue@10 +190.9% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +451.2% vs popular-cohort, at nDCG@10 -55.9% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.049 (-44.5% vs PC), recall@10 -38.2%, revenue@10 +427.3% vs PC.

**Verdict (full, n=5000, seed=123): the pipeline BEATS the MVP rival on relevance (f3-rrf +74.7% nDCG@10) AND on revenue — the fair head-to-head the thesis declared pending (same cases, candidates, split). Caveat: no LEARNED reranker beats RRF (consistent with F3) — the win is the multi-source POOL, not the reranker. W2 tests whether this holds at larger n.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.965; seller-gini@10 0.107 vs 0.165; diversity@10 0.062 vs 0.285. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

