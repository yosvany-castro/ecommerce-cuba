# Thesis F6 W5 — Reranker trained on the business outcome (revenue)

Item space: e1_prod2vec (canonical 64d). n=10000, seed=42. E1 universe: 9999. Products: 10000. Eval cases: 2000. Pool size: 200.

**Pool frame** — candidates = each case's 4-source RRF(200) pool (excludes train). Three rerankers over the IDENTICAL candidate set isolate the value of the LEARNER given the retrieval. `f3-rrf` = the fused RRF order (no learner). `ltr-relevance` = the F3 pointwise LTR (binary purchase label). `ltr-revenue` = the W5 LTR (target = normalized expected revenue). Both learners share the EXACT same features (E1) and train-split-only samples; they differ ONLY in target. No ground-truth leaks: positives = train purchases, negatives = seeded pool ids with the held-out test pid excluded.

## Rerankers over the shared pool

| Reranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | revenue@10 | seller-gini@10 |
|---|---|---|---|---|---|---|---|
| f3-rrf | 0.089 | 0.111 | 0.133 | 0.206 | 0.096 | 30984.5890 | 0.107 |
| ltr-relevance | 0.011 | 0.016 | 0.024 | 0.035 | 0.021 | 30846.2389 | 0.109 |
| ltr-revenue | 0.083 | 0.111 | 0.149 | 0.223 | 0.096 | 31954.9393 | 0.104 |

## Verdict — does ltr-revenue beat RRF on revenue@10 while keeping nDCG@10 ≥ 0.7·RRF?

- revenue@10: ltr-revenue **31954.9393** vs RRF **30984.5890** (+3.1%) → beats RRF on revenue: **YES**.
- nDCG@10: ltr-revenue **0.111** vs RRF **0.111** (+0.7%); guardrail floor 0.7·RRF = **0.077** → relevance kept: **YES**.
- **Overall verdict: PASS** — ltr-revenue DOES beat RRF on revenue@10 while holding nDCG@10 ≥ 0.7·RRF.

### Honest read

Training a pointwise LTR directly on the business outcome (expected revenue) **lifts revenue@10 by +3.1% over RRF** while staying within the relevance guardrail (nDCG@10 0.111 ≥ 0.077). This is a genuinely new result: F4 dialed revenue via a hand-set scorer weight, whereas W5 LEARNS the revenue ranking from train-split data alone. Caveat (spec §10): the outcome model is synthetic (P·price·margin), so the lift is revenue of the MODEL, not of real users — the same caveat that bounds every F4/F6 revenue claim.

## Revenue-LTR feature weights (interpretability)

| feature | ltr-relevance | ltr-revenue |
|---|---|---|
| retrievalScore | 7.1047 | 0.0924 |
| npmiScore | -3.3846 | 0.2246 |
| priceFit | 2.7703 | -0.0398 |
| demoMatch | -1.3247 | 0.1044 |
| isGift | -0.0778 | 0.0059 |
| popularity | 0.9168 | -0.0198 |
| (bias) | -11.5634 | 0.2699 |

