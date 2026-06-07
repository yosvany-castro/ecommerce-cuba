# Thesis F2 — Multi-vector × recipient + gift study

Item space: e1_prod2vec. Common universe: 1997. Test cases: 1042.

Modes: average-linkage cosine clustering + medoids (PinnerSage-style), order-invariant. Retrieval: per-mode quota + RRF; gift sessions use a single ephemeral recipient vector.

| Segment | n | model | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|---|---|
| overall | 1042 | F1-single | 0.104 | 0.225 | 0.084 |
| overall | 1042 | F2-multivec | 0.116 | 0.233 | 0.092 |
| gift|1mode | 268 | F1-single | 0.025 | 0.049 | 0.027 |
| gift|1mode | 268 | F2-multivec | 0.032 | 0.063 | 0.028 |
| gift|2-3modes | 58 | F1-single | 0.028 | 0.034 | 0.032 |
| gift|2-3modes | 58 | F2-multivec | 0.007 | 0.017 | 0.008 |
| self|1mode | 623 | F1-single | 0.146 | 0.319 | 0.114 |
| self|1mode | 623 | F2-multivec | 0.166 | 0.334 | 0.129 |
| self|2-3modes | 93 | F1-single | 0.096 | 0.215 | 0.081 |
| self|2-3modes | 93 | F2-multivec | 0.090 | 0.183 | 0.079 |

## Gift detection vs ground truth (n=1042)

- Confusion: TP=0 FP=0 FN=326 TN=716
- Precision: 0.000
- Recall: 0.000
- F1: 0.000

## Recipient-fit@10 (gift sessions, n=326)

- F1-single: 0.372
- F2-multivec: 0.380
