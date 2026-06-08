# Thesis F6 W1 — Head-to-head (frame: full)

Item space: e1_prod2vec (canonical 64d). n=2000, seed=42. E1 universe: 1998. Products: 2000. Eval cases: 1107 (self 759, gift 348). LLM: off.

**Full frame** — candidates = catalog \ train (the production feed). Titular question: does the assembled pipeline beat popular-cohort here?

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit uses the DETECTOR's predicted recipient.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.001 | 0.002 | 0.004 | 0.005 | 0.004 | 0.001 | 0.005 | 1349.4607 | 0.327 | 0.588 | 0.998 |
| popular-global | 0.004 | 0.007 | 0.010 | 0.020 | 0.009 | 0.004 | 0.020 | 1280.8401 | 0.217 | 0.575 | 0.971 |
| popular-cohort | 0.129 | 0.177 | 0.241 | 0.360 | 0.152 | 0.123 | 0.360 | 12427.9349 | 0.153 | 0.268 | 0.000 |
| cosine-e1 | 0.070 | 0.104 | 0.141 | 0.225 | 0.085 | 0.068 | 0.225 | 33499.7751 | 0.112 | 0.064 | 0.913 |
| e2_hybrid | 0.085 | 0.119 | 0.162 | 0.253 | 0.097 | 0.079 | 0.253 | 33494.6261 | 0.110 | 0.064 | 0.892 |
| f2-multimode | 0.071 | 0.104 | 0.140 | 0.224 | 0.083 | 0.069 | 0.224 | 34059.1570 | 0.110 | 0.107 | 0.916 |
| f3-rrf | 0.158 | 0.200 | 0.236 | 0.373 | 0.166 | 0.148 | 0.373 | 32585.5102 | 0.106 | 0.133 | 0.856 |
| f3-ltr | 0.080 | 0.113 | 0.142 | 0.231 | 0.096 | 0.077 | 0.231 | 33369.3194 | 0.103 | 0.148 | 0.818 |
| f4-knee | 0.063 | 0.087 | 0.114 | 0.179 | 0.078 | 0.060 | 0.179 | 53143.1125 | 0.111 | 0.099 | 0.930 |
| f4-revenue | 0.042 | 0.059 | 0.088 | 0.123 | 0.060 | 0.040 | 0.123 | 57537.9488 | 0.111 | 0.223 | 0.949 |
| assembled-ltr-f4 | 0.063 | 0.087 | 0.114 | 0.179 | 0.078 | 0.060 | 0.179 | 53143.1125 | 0.111 | 0.099 | 0.930 |

## Self segment (intentGT=self, n=759)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.002 | 0.004 | 0.004 |
| popular-global | 0.010 | 0.026 | 0.010 |
| popular-cohort | 0.187 | 0.375 | 0.160 |
| cosine-e1 | 0.142 | 0.300 | 0.115 |
| e2_hybrid | 0.164 | 0.344 | 0.131 |
| f2-multimode | 0.141 | 0.299 | 0.112 |
| f3-rrf | 0.266 | 0.493 | 0.215 |
| f3-ltr | 0.151 | 0.307 | 0.124 |
| f4-knee | 0.119 | 0.238 | 0.103 |
| f4-revenue | 0.080 | 0.163 | 0.078 |
| assembled-ltr-f4 | 0.119 | 0.238 | 0.103 |

## Gift segment (intentGT=gift, n=348)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.002 | 0.006 | 0.004 | 0.189 |
| popular-global | 0.002 | 0.006 | 0.005 | 0.297 |
| popular-cohort | 0.155 | 0.325 | 0.135 | 0.279 |
| cosine-e1 | 0.023 | 0.060 | 0.020 | 0.258 |
| e2_hybrid | 0.023 | 0.055 | 0.023 | 0.268 |
| f2-multimode | 0.024 | 0.060 | 0.019 | 0.265 |
| f3-rrf | 0.057 | 0.112 | 0.059 | 0.293 |
| f3-ltr | 0.030 | 0.066 | 0.036 | 0.295 |
| f4-knee | 0.018 | 0.049 | 0.023 | 0.244 |
| f4-revenue | 0.013 | 0.034 | 0.022 | 0.207 |
| assembled-ltr-f4 | 0.018 | 0.049 | 0.023 | 0.244 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **full** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.200** vs popular-cohort's **0.177** — a +13.0% LIFT (and revenue@10 +162.2% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +363.0% vs popular-cohort, at nDCG@10 -66.7% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.087 (-50.9% vs PC), recall@10 -50.3%, revenue@10 +327.6% vs PC.

**Verdict (full, n=2000, seed=42): the pipeline BEATS the MVP rival on relevance (f3-rrf +13.0% nDCG@10) AND on revenue — the fair head-to-head the thesis declared pending (same cases, candidates, split). Caveat: no LEARNED reranker beats RRF (consistent with F3) — the win is the multi-source POOL, not the reranker. W2 tests whether this holds at larger n.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.930; seller-gini@10 0.111 vs 0.153; diversity@10 0.099 vs 0.268. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

