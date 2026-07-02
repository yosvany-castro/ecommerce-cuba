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
| cross-encoder | 0.055 | 0.120 | 0.053 | 0.821 |
| ltr | 0.121 | 0.250 | 0.100 | 0.578 |

### Honest read

On this synthetic dataset, **no non-learned or learned reranker beats baseline-RRF at nDCG@10** (0.177). MMR is the cleanest baseline-correct non-learned reranker (nDCG@10 0.125): it diversifies the top-10 (set-change@10 0.527) at a positional-accuracy cost. The cross-encoder MaxSim query is now in the SAME E4 (1024-dim) space as the doc chunks (the user's TRAIN items' E4 chunks, F1 pattern); its nDCG@10 0.055 / set-change@10 0.821 is a real measurement — earlier 0.027/0.952 was a cross-space bug (64-dim E1 medoids queried against 1024-dim E4 docs, silently truncated by cosineSim). The honest finding stands: aggressive reranking reshuffles the top-10 without improving recall of the held-out purchase on this data; RRF fusion is the strongest ranker here.

## Self/gift segments — ltr vs baseline-rrf (GT intent)

| Segment | n | ranker | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|---|---|
| self | 743 | baseline-rrf | 0.235 | 0.445 | 0.189 |
| self | 743 | ltr | 0.159 | 0.332 | 0.127 |
| gift | 355 | baseline-rrf | 0.055 | 0.107 | 0.055 |
| gift | 355 | ltr | 0.041 | 0.079 | 0.044 |

## LLM listwise (DeepSeek) on first 120 cases (pool top-30)

- nDCG@10: 0.170
- Recall@10: 0.350
- set-change@10: 0.427
- fallback rate: 0.000 (0/120)

## LTR feature weights (interpretability)

| feature | weight |
|---|---|
| retrievalScore | 6.8185 |
| npmiScore | 0.2878 |
| priceFit | 1.8114 |
| demoMatch | 0.0445 |
| isGift | 0.0000 |
| popularity | 2.2423 |
| (bias) | -15.6126 |

