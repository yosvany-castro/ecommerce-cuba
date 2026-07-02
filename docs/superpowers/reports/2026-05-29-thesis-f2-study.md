# Thesis F2 — Multi-vector × recipient + gift study

Item space: e1_prod2vec. Common universe: 1999. Test cases: 1098.

Modes: average-linkage cosine clustering + medoids (PinnerSage-style), order-invariant. Retrieval: per-mode quota + RRF; gift sessions use a single ephemeral recipient vector.

Gift detection: demographic coherence + cross-cohort (gender/age) on the test item's actual session.

| Segment | n | model | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|---|---|
| overall | 1098 | F1-single | 0.101 | 0.219 | 0.082 |
| overall | 1098 | F2-multivec | 0.152 | 0.310 | 0.118 |
| gift|1mode | 287 | F1-single | 0.013 | 0.024 | 0.017 |
| gift|1mode | 287 | F2-multivec | 0.063 | 0.115 | 0.054 |
| gift|2-3modes | 62 | F1-single | 0.006 | 0.016 | 0.009 |
| gift|2-3modes | 62 | F2-multivec | 0.072 | 0.113 | 0.062 |
| self|1mode | 598 | F1-single | 0.151 | 0.331 | 0.118 |
| self|1mode | 598 | F2-multivec | 0.200 | 0.408 | 0.155 |
| self|2-3modes | 151 | F1-single | 0.109 | 0.225 | 0.092 |
| self|2-3modes | 151 | F2-multivec | 0.163 | 0.371 | 0.117 |

## Gift detection vs ground truth (n=1098)

- Confusion: TP=135 FP=179 FN=214 TN=570
- Precision: 0.430
- Recall: 0.387
- F1: 0.407

## Recipient-fit@10 (gift sessions, n=349)

- F1-single: 0.285
- F2-multivec: 0.476
