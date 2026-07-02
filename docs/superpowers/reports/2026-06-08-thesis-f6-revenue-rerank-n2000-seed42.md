# Thesis F6 W5 — Reranker trained on the business outcome (revenue)

Item space: e1_prod2vec (canonical 64d). n=2000, seed=42. E1 universe: 1998. Products: 2000. Eval cases: 1107. Pool size: 200.

**Pool frame** — candidates = each case's 4-source RRF(200) pool (excludes train). Three rerankers over the IDENTICAL candidate set isolate the value of the LEARNER given the retrieval. `f3-rrf` = the fused RRF order (no learner). `ltr-relevance` = the F3 pointwise LTR (binary purchase label). `ltr-revenue` = the W5 LTR (target = normalized expected revenue). Both learners share the EXACT same features (E1) and train-split-only samples; they differ ONLY in target. No ground-truth leaks: positives = train purchases, negatives = seeded pool ids with the held-out test pid excluded.

## Rerankers over the shared pool

| Reranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | revenue@10 | seller-gini@10 |
|---|---|---|---|---|---|---|---|
| f3-rrf | 0.186 | 0.236 | 0.272 | 0.445 | 0.189 | 33448.8710 | 0.105 |
| ltr-relevance | 0.086 | 0.119 | 0.149 | 0.239 | 0.103 | 31317.3412 | 0.105 |
| ltr-revenue | 0.155 | 0.195 | 0.223 | 0.369 | 0.159 | 32607.0873 | 0.108 |

## Verdict — does ltr-revenue beat RRF on revenue@10 while keeping nDCG@10 ≥ 0.7·RRF?

- revenue@10: ltr-revenue **32607.0873** vs RRF **33448.8710** (-2.5%) → beats RRF on revenue: **NO**.
- nDCG@10: ltr-revenue **0.195** vs RRF **0.236** (-17.4%); guardrail floor 0.7·RRF = **0.165** → relevance kept: **YES**.
- **Overall verdict: FAIL** — ltr-revenue does NOT beat RRF on revenue@10 while holding nDCG@10 ≥ 0.7·RRF.

### Honest read

On this synthetic pool, the revenue-target LTR does **NOT** clear the bar: revenue@10 32607.0873 ≤ RRF 33448.8710. Reported as-is per F6's honesty mandate. RRF fuses four sources whose top-10 is already revenue-dense; a pointwise learner on 10200 samples has little headroom to re-sort it without paying relevance. The relevance LTR (nDCG@10 0.119, revenue@10 31317.3412) is tabled alongside so the relevance↔revenue trade-off of the two targets is visible, not hidden.

## Revenue-LTR feature weights (interpretability)

| feature | ltr-relevance | ltr-revenue |
|---|---|---|
| retrievalScore | 9.5876 | 0.2321 |
| npmiScore | -0.2898 | 0.0961 |
| priceFit | 2.3772 | 0.0972 |
| demoMatch | -0.4006 | 0.0517 |
| isGift | -0.4477 | 0.0507 |
| popularity | 2.8474 | -0.0089 |
| (bias) | -14.7937 | 0.0398 |

