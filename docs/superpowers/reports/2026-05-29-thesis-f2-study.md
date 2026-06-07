# Thesis F2 — Multi-vector × recipient + gift study

Item space: e1_prod2vec. Common universe: 1998. Test cases: 1038.

Modes: average-linkage cosine clustering + medoids (PinnerSage-style), order-invariant. Retrieval: per-mode quota + RRF; gift sessions use a single ephemeral recipient vector.

Gift detection: demographic coherence + cross-cohort (gender/age) on the test item's actual session.

| Segment | n | model | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|---|---|
| overall | 1038 | F1-single | 0.100 | 0.213 | 0.084 |
| overall | 1038 | F2-multivec | 0.176 | 0.337 | 0.141 |
| gift|1mode | 282 | F1-single | 0.014 | 0.035 | 0.016 |
| gift|1mode | 282 | F2-multivec | 0.085 | 0.128 | 0.079 |
| gift|2-3modes | 53 | F1-single | 0.000 | 0.000 | 0.009 |
| gift|2-3modes | 53 | F2-multivec | 0.080 | 0.094 | 0.081 |
| self|1mode | 614 | F1-single | 0.149 | 0.311 | 0.124 |
| self|1mode | 614 | F2-multivec | 0.216 | 0.438 | 0.167 |
| self|2-3modes | 89 | F1-single | 0.095 | 0.225 | 0.074 |
| self|2-3modes | 89 | F2-multivec | 0.241 | 0.449 | 0.193 |

## Gift detection vs ground truth (n=1038)

- Confusion: TP=156 FP=174 FN=179 TN=529
- Precision: 0.473
- Recall: 0.466
- F1: 0.469

## Recipient-fit@10 (gift sessions, n=335)

- F1-single: 0.347
- F2-multivec: 0.606
