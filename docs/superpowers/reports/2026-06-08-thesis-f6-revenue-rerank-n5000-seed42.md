# Thesis F6 W5 — Reranker trained on the business outcome (revenue)

Item space: e1_prod2vec (canonical 64d). n=5000, seed=42. E1 universe: 4999. Products: 5000. Eval cases: 2893. Pool size: 200.

**Pool frame** — candidates = each case's 4-source RRF(200) pool (excludes train). Three rerankers over the IDENTICAL candidate set isolate the value of the LEARNER given the retrieval. `f3-rrf` = the fused RRF order (no learner). `ltr-relevance` = the F3 pointwise LTR (binary purchase label). `ltr-revenue` = the W5 LTR (target = normalized expected revenue). Both learners share the EXACT same features (E1) and train-split-only samples; they differ ONLY in target. No ground-truth leaks: positives = train purchases, negatives = seeded pool ids with the held-out test pid excluded.

## Rerankers over the shared pool

| Reranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | revenue@10 | seller-gini@10 |
|---|---|---|---|---|---|---|---|
| f3-rrf | 0.116 | 0.149 | 0.180 | 0.280 | 0.127 | 31331.2241 | 0.111 |
| ltr-relevance | 0.026 | 0.035 | 0.050 | 0.069 | 0.041 | 31175.7999 | 0.106 |
| ltr-revenue | 0.031 | 0.051 | 0.079 | 0.114 | 0.052 | 31697.5057 | 0.109 |

## Verdict — does ltr-revenue beat RRF on revenue@10 while keeping nDCG@10 ≥ 0.7·RRF?

- revenue@10: ltr-revenue **31697.5057** vs RRF **31331.2241** (+1.2%) → beats RRF on revenue: **YES**.
- nDCG@10: ltr-revenue **0.051** vs RRF **0.149** (-65.9%); guardrail floor 0.7·RRF = **0.104** → relevance kept: **NO**.
- **Overall verdict: FAIL** — ltr-revenue does NOT beat RRF on revenue@10 while holding nDCG@10 ≥ 0.7·RRF.

### Honest read

On this synthetic pool, the revenue-target LTR does **lift revenue@10 but NOT** clear the bar: nDCG@10 0.051 falls below the 0.7·RRF floor 0.104. Reported as-is per F6's honesty mandate. RRF fuses four sources whose top-10 is already revenue-dense; a pointwise learner on 27067 samples has little headroom to re-sort it without paying relevance. The relevance LTR (nDCG@10 0.035, revenue@10 31175.7999) is tabled alongside so the relevance↔revenue trade-off of the two targets is visible, not hidden.

## Revenue-LTR feature weights (interpretability)

| feature | ltr-relevance | ltr-revenue |
|---|---|---|
| retrievalScore | 7.1780 | 0.0783 |
| npmiScore | -2.0632 | 0.0908 |
| priceFit | 1.6757 | -0.0003 |
| demoMatch | -1.0188 | 0.2097 |
| isGift | 0.8587 | -0.0718 |
| popularity | 1.5790 | -0.0505 |
| (bias) | -14.6678 | 0.3436 |

