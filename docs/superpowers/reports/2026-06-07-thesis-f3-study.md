# Thesis F3 — Multi-source candidate pool + four rerankers

Item space: e1_prod2vec. Common universe: 1999. Eval cases: 1098. Pool size: 200.

Sources fused via RRF: retrieval (top-80 max-cos to mode medoids), npmi (last-viewed neighbours), popular (cohort popularity), exploration (seeded shuffle).

ONE shared pool per user — every reranker ranks the identical candidate set (positional metrics only). Gift intent + recipient demographics come from the F2 detector on the user's session; NO ground-truth leaks into ranker features.

E4 late-interaction chunks loaded: 2000 products.

## Pool recall vs F2 top-30

- Pool recall (held-out test item in pool): 0.839 (921/1098)
- F2 top-30 recall (top-30 by max-cos to modes): 0.410 (450/1098)

## Rerankers over the shared pool (overall)

| Reranker | nDCG@10 | Recall@10 | MRR | set-change@10 |
|---|---|---|---|---|
| baseline-rrf | 0.177 | 0.336 | 0.145 | 0.000 |
| mmr | 0.125 | 0.204 | 0.119 | 0.527 |
| cross-encoder | 0.027 | 0.056 | 0.033 | 0.952 |
| ltr | 0.055 | 0.097 | 0.056 | 0.773 |

## Self/gift segments — ltr vs baseline-rrf (GT intent)

| Segment | n | ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|---|---|
| self | 743 | baseline-rrf | 0.235 | 0.445 | 0.189 |
| self | 743 | ltr | 0.069 | 0.121 | 0.068 |
| gift | 355 | baseline-rrf | 0.055 | 0.107 | 0.055 |
| gift | 355 | ltr | 0.026 | 0.045 | 0.030 |

## LLM listwise (DeepSeek) on first 120 cases (pool top-30)

- nDCG@10: 0.166
- Recall@10: 0.333
- set-change@10: 0.429
- fallback rate: 0.000 (0/120)

## LTR feature weights (interpretability)

| feature | weight |
|---|---|
| retrievalScore | 6.4368 |
| npmiScore | -6.3192 |
| priceFit | 2.0571 |
| demoMatch | -0.2416 |
| isGift | 0.0000 |
| popularity | 2.3634 |
| (bias) | -14.9547 |

