# Thesis F2 — Multi-vector × recipient + gift study

Item space: e1_prod2vec. Common universe: 1997. Test cases: 1042.

Modes: average-linkage cosine clustering + medoids (PinnerSage-style), order-invariant. Retrieval: per-mode quota + RRF; gift sessions use a single ephemeral recipient vector.

Gift detection: demographic coherence + cross-cohort (gender/age) on the test item's actual session.

> NOTE (2026-06-07): The detector and runner were rewritten to spec §4.2 (demographic
> coherence + cross-cohort on the test item's ACTUAL session, replacing the embedding-
> coherence-on-whole-history logic that fired 0 times). The numbers below are NOT yet
> regenerated: the live `thesis` schema in this environment is missing the inputs the
> study needs — `thesis.item_vectors` (space='e1_prod2vec') is empty, and
> `thesis.products` holds 120 unrelated rows with NULL `gender_target`/`age_target`
> instead of the 2000-product catalog whose demographics the detector reads (the 1997
> products referenced by `thesis.events` have no catalog row here). Re-run
> `pnpm thesis:train-prod2vec` then `pnpm thesis:f2-study` against a data-complete
> environment to populate the tables below. The figures shown are the prior (pre-fix)
> run and are retained only for reference.

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

(pre-fix run — embedding-coherence detector; superseded by the demographic detector, awaiting data-complete re-run)

- Confusion: TP=0 FP=0 FN=326 TN=716
- Precision: 0.000
- Recall: 0.000
- F1: 0.000

## Recipient-fit@10 (gift sessions, n=326)

- F1-single: 0.372
- F2-multivec: 0.380
