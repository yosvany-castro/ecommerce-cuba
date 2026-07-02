# Thesis F6 W1 — Head-to-head (frame: full)

Item space: e1_prod2vec (canonical 64d). n=5000, seed=123. E1 universe: 4926. Products: 5000. Eval cases: 40 (self 34, gift 6). LLM: on (DeepSeek).

**Full frame** — candidates = catalog \ train (the production feed). Titular question: does the assembled pipeline beat popular-cohort here?

Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. `intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.

## Overall (all cases) — IR + business metrics

| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | realizedRev@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 0.000 | 0.000 | 0.000 | 0.000 | 0.002 | 0.000 | 0.000 | 449.8319 | 0.0000 | 0.315 | 0.435 | 1.000 |
| popular-global | 0.000 | 0.008 | 0.008 | 0.025 | 0.008 | 0.004 | 0.025 | 968.9532 | 288.1195 | 0.252 | 0.904 | 0.990 |
| popular-cohort | 0.132 | 0.180 | 0.187 | 0.350 | 0.141 | 0.128 | 0.350 | 833.0211 | 1653.0733 | 0.110 | 0.667 | 0.000 |
| popular-cohort-real | 0.000 | 0.008 | 0.008 | 0.025 | 0.006 | 0.004 | 0.025 | 5559.2532 | 22.1180 | 0.118 | 0.685 | 0.950 |
| cosine-e1 | 0.000 | 0.000 | 0.000 | 0.000 | 0.001 | 0.000 | 0.000 | 7035.1227 | 0.0000 | 0.120 | 0.164 | 1.000 |
| e2_hybrid | 0.000 | 0.000 | 0.000 | 0.000 | 0.001 | 0.000 | 0.000 | 3268.3829 | 0.0000 | 0.252 | 0.172 | 1.000 |
| f2-multimode | 0.000 | 0.000 | 0.000 | 0.000 | 0.001 | 0.000 | 0.000 | 9609.1644 | 0.0000 | 0.043 | 0.264 | 1.000 |
| f3-rrf | 0.000 | 0.000 | 0.000 | 0.000 | 0.006 | 0.000 | 0.000 | 14321.5334 | 0.0000 | 0.116 | 0.479 | 0.975 |
| f3-ltr | 0.000 | 0.017 | 0.017 | 0.050 | 0.013 | 0.007 | 0.050 | 10250.9746 | 88.1111 | 0.104 | 0.665 | 0.940 |
| f4-knee | 0.000 | 0.000 | 0.000 | 0.000 | 0.006 | 0.000 | 0.000 | 58991.9004 | 0.0000 | 0.113 | 0.211 | 1.000 |
| f4-revenue | 0.000 | 0.000 | 0.000 | 0.000 | 0.005 | 0.000 | 0.000 | 61353.6856 | 0.0000 | 0.097 | 0.254 | 1.000 |
| assembled-ltr-f4 | 0.000 | 0.000 | 0.000 | 0.000 | 0.006 | 0.000 | 0.000 | 58991.9004 | 0.0000 | 0.113 | 0.211 | 1.000 |
| f3-llm | — | 0.000 | — | 0.000 | 0.006 | — | — | — | — | — | — | 0.997 |

`realizedRev@10` = price×margin of the HELD-OUT purchase when captured in the top-10 (averaged over cases). Unlike `revenue@10` (model-expected, gameable by a blind price×margin sort), realized revenue can only be earned by surfacing what the user actually bought.

f3-llm (DeepSeek listwise, pool top-30): nDCG@10 0.000, Recall@10 0.000, MRR 0.006, fallback rate 0.000 (0/40).

## Self segment (intentGT=self, n=34)

| Ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|
| random | 0.000 | 0.000 | 0.002 |
| popular-global | 0.000 | 0.000 | 0.004 |
| popular-cohort | 0.151 | 0.294 | 0.120 |
| popular-cohort-real | 0.010 | 0.029 | 0.006 |
| cosine-e1 | 0.000 | 0.000 | 0.001 |
| e2_hybrid | 0.000 | 0.000 | 0.001 |
| f2-multimode | 0.000 | 0.000 | 0.001 |
| f3-rrf | 0.000 | 0.000 | 0.007 |
| f3-ltr | 0.020 | 0.059 | 0.014 |
| f4-knee | 0.000 | 0.000 | 0.006 |
| f4-revenue | 0.000 | 0.000 | 0.006 |
| assembled-ltr-f4 | 0.000 | 0.000 | 0.006 |

## Gift segment (intentGT=gift, n=6)

| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |
|---|---|---|---|---|
| random | 0.000 | 0.000 | 0.000 | 0.000 |
| popular-global | 0.056 | 0.167 | 0.028 | 0.000 |
| popular-cohort | 0.346 | 0.667 | 0.262 | 0.000 |
| popular-cohort-real | 0.000 | 0.000 | 0.003 | 0.000 |
| cosine-e1 | 0.000 | 0.000 | 0.000 | 0.000 |
| e2_hybrid | 0.000 | 0.000 | 0.000 | 0.000 |
| f2-multimode | 0.000 | 0.000 | 0.001 | 0.000 |
| f3-rrf | 0.000 | 0.000 | 0.005 | 0.000 |
| f3-ltr | 0.000 | 0.000 | 0.005 | 0.000 |
| f4-knee | 0.000 | 0.000 | 0.005 | 0.000 |
| f4-revenue | 0.000 | 0.000 | 0.005 | 0.000 |
| assembled-ltr-f4 | 0.000 | 0.000 | 0.005 | 0.000 |

## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker

In the **full** frame, the relevance-optimal pipeline config (**f3-ltr**) scores nDCG@10 **0.017** vs popular-cohort's **0.180** — a -90.7% DEFICIT (and revenue@10 +1130.6% at the same time).

The revenue-optimal config (**f4-revenue**) lifts revenue@10 by +7265.2% vs popular-cohort, at nDCG@10 -100.0% — this is the multi-objective dial.

The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: nDCG@10 0.000 (-100.0% vs PC), recall@10 -100.0%, revenue@10 +6981.7% vs PC.

**Verdict (full, n=5000, seed=123): even the relevance-optimal pipeline config (f3-ltr) does NOT beat popular-cohort on nDCG@10 (-90.7%).** Reported as-is per F6's honesty mandate. The cohort=subcategory rival is strong on a synthetic catalog of n=5000; W2 (scale) tests whether the cohort dilutes as the catalog grows.

Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = 1.000; seller-gini@10 0.113 vs 0.110; diversity@10 0.211 vs 0.667. Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the trade-off is visible, not hidden.

