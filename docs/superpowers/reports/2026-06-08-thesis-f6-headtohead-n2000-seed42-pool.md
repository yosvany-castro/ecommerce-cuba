# Thesis F6 W1 — Head-to-head (frame: pool)

Item space: e1_prod2vec (canonical 64d). n=2000, seed=42. E1 universe: 1998. Products: 2000. Eval cases: 1107 (self 759, gift 348). LLM: off.

**Pool frame** — candidates = each case's 4-source RRF(200) pool (still excludes train). Isolates the value of reranking GIVEN the retrieval.

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit uses the DETECTOR's predicted recipient.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.019 | 0.030 | 0.037 | 0.059 | 0.035 | 0.022 | 0.059 | 23311.9065 | 0.110 | 0.451 | 0.910 |
| popular-global | 0.030 | 0.047 | 0.073 | 0.102 | 0.051 | 0.031 | 0.102 | 18698.1811 | 0.106 | 0.460 | 0.657 |
| popular-cohort | 0.264 | 0.314 | 0.356 | 0.542 | 0.260 | 0.243 | 0.542 | 21512.2857 | 0.104 | 0.256 | 0.000 |
| cosine-e1 | 0.071 | 0.106 | 0.143 | 0.230 | 0.088 | 0.069 | 0.230 | 34742.1530 | 0.112 | 0.064 | 0.887 |
| e2_hybrid | 0.086 | 0.121 | 0.165 | 0.257 | 0.100 | 0.080 | 0.257 | 34842.7076 | 0.110 | 0.063 | 0.854 |
| f2-multimode | 0.071 | 0.104 | 0.140 | 0.224 | 0.086 | 0.069 | 0.224 | 34189.2251 | 0.111 | 0.106 | 0.885 |
| f3-rrf | 0.158 | 0.200 | 0.236 | 0.373 | 0.165 | 0.148 | 0.373 | 32585.5102 | 0.106 | 0.133 | 0.811 |
| f3-ltr | 0.080 | 0.113 | 0.142 | 0.231 | 0.096 | 0.077 | 0.231 | 33369.3194 | 0.103 | 0.148 | 0.748 |
| f4-knee | 0.063 | 0.087 | 0.114 | 0.179 | 0.077 | 0.060 | 0.179 | 53143.1125 | 0.111 | 0.099 | 0.904 |
| f4-revenue | 0.042 | 0.059 | 0.088 | 0.123 | 0.059 | 0.040 | 0.123 | 57537.9488 | 0.111 | 0.223 | 0.924 |
| assembled-ltr-f4 | 0.063 | 0.087 | 0.114 | 0.179 | 0.077 | 0.060 | 0.179 | 53143.1125 | 0.111 | 0.099 | 0.904 |

## Self segment (intentGT=self, n=759)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.029 | 0.057 | 0.034 |
| popular-global | 0.052 | 0.115 | 0.056 |
| popular-cohort | 0.254 | 0.487 | 0.205 |
| cosine-e1 | 0.144 | 0.307 | 0.118 |
| e2_hybrid | 0.166 | 0.349 | 0.133 |
| f2-multimode | 0.141 | 0.299 | 0.115 |
| f3-rrf | 0.266 | 0.493 | 0.214 |
| f3-ltr | 0.151 | 0.307 | 0.124 |
| f4-knee | 0.119 | 0.238 | 0.102 |
| f4-revenue | 0.080 | 0.163 | 0.077 |
| assembled-ltr-f4 | 0.119 | 0.238 | 0.102 |

## Gift segment (intentGT=gift, n=348)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.034 | 0.063 | 0.037 | 0.269 |
| popular-global | 0.035 | 0.075 | 0.040 | 0.191 |
| popular-cohort | 0.443 | 0.661 | 0.381 | 0.267 |
| cosine-e1 | 0.024 | 0.063 | 0.024 | 0.261 |
| e2_hybrid | 0.024 | 0.057 | 0.028 | 0.269 |
| f2-multimode | 0.024 | 0.060 | 0.025 | 0.265 |
| f3-rrf | 0.057 | 0.112 | 0.058 | 0.293 |
| f3-ltr | 0.030 | 0.066 | 0.035 | 0.295 |
| f4-knee | 0.018 | 0.049 | 0.022 | 0.244 |
| f4-revenue | 0.013 | 0.034 | 0.020 | 0.207 |
| assembled-ltr-f4 | 0.018 | 0.049 | 0.022 | 0.244 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **pool** frame, the relevance-optimal pipeline config (**f3-rrf**) scores nDCG@10 **0.200** vs popular-cohort's **0.314** — a -36.1% DEFICIT (and revenue@10 +51.5% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +167.5% vs popular-cohort, at nDCG@10 -81.2% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.087 (-72.3% vs PC), recall@10 -67.0%, revenue@10 +147.0% vs PC.

**Verdict (pool, n=2000, seed=42): even the relevance-optimal pipeline config (f3-rrf) does NOT beat popular-cohort on nDCG@10 (-36.1%).** Reported as-is per F6's honesty mandate. The cohort=subcategory rival is strong on a synthetic catalog of n=2000; W2 (scale) tests whether the cohort dilutes as the catalog grows.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 0.904; seller-gini@10 0.111 vs 0.104; diversity@10 0.099 vs 0.256. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

