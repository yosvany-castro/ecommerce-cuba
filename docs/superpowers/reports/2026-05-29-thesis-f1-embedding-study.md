# Thesis F1 — Embedding Study

## Fair-comparison disclosure

- Common candidate universe (items representable in EVERY participating space): **1997** items.
- Eval cases (identical users across all spaces): **1042**.
- Complement targets are intersected with the candidate universe (and exclude the user's train items).
- Per-space representation / dimension:
- `e0_text`: 1024
- `e1_prod2vec`: 64
- `e3_two_tower`: 64
- `e5_context3`: 1024
- `e2_hybrid`: score-fusion (text 1024-d ⊕ behaviour 64-d)
- `e4_late`: chunk-MaxSim
- E4 late-interaction query is capped at **24** chunks per user.

| Space | cases | MRR | nDCG@5 | nDCG@10 | nDCG@20 | Recall@5 | Recall@10 | Recall@20 | complR@10 |
|---|---|---|---|---|---|---|---|---|---|
| e0_text | 1042 | 0.040 | 0.027 | 0.039 | 0.063 | 0.049 | 0.086 | 0.181 | 0.001 |
| e1_prod2vec | 1042 | 0.084 | 0.073 | 0.104 | 0.139 | 0.127 | 0.225 | 0.361 | 0.000 |
| e3_two_tower | 1042 | 0.044 | 0.027 | 0.042 | 0.066 | 0.045 | 0.090 | 0.188 | 0.001 |
| e5_context3 | 1042 | 0.046 | 0.031 | 0.045 | 0.065 | 0.047 | 0.092 | 0.171 | 0.001 |
| e2_hybrid | 1042 | 0.101 | 0.084 | 0.126 | 0.163 | 0.134 | 0.265 | 0.411 | 0.001 |
| e4_late | 1042 | 0.041 | 0.026 | 0.039 | 0.062 | 0.042 | 0.083 | 0.174 | 0.001 |

## Production recommendation

**Deploy: `e2_hybrid`** (utility = quality − 0.5·normalizedCost).

| Space | quality | utility |
|---|---|---|
| e2_hybrid | 0.076 | -0.024 |
| e1_prod2vec | 0.063 | -0.037 |
| e3_two_tower | 0.025 | -0.075 |
| e0_text | 0.024 | -0.076 |
| e5_context3 | 0.028 | -0.172 |
| e4_late | 0.024 | -0.476 |
