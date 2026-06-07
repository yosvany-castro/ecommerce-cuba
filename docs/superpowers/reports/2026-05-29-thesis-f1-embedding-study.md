# Thesis F1 — Embedding Study

## Fair-comparison disclosure

- Common candidate universe (items representable in EVERY participating space): **1999** items.
- Eval cases (identical users across all spaces): **1098**.
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
| e0_text | 1098 | 0.037 | 0.022 | 0.038 | 0.053 | 0.036 | 0.086 | 0.146 | 0.001 |
| e1_prod2vec | 1098 | 0.082 | 0.071 | 0.101 | 0.136 | 0.124 | 0.219 | 0.360 | 0.000 |
| e3_two_tower | 1098 | 0.051 | 0.036 | 0.049 | 0.070 | 0.053 | 0.094 | 0.177 | 0.000 |
| e5_context3 | 1098 | 0.040 | 0.025 | 0.039 | 0.059 | 0.041 | 0.085 | 0.162 | 0.001 |
| e2_hybrid | 1098 | 0.102 | 0.092 | 0.124 | 0.161 | 0.151 | 0.252 | 0.400 | 0.000 |
| e4_late | 1098 | 0.039 | 0.025 | 0.039 | 0.058 | 0.041 | 0.087 | 0.164 | 0.002 |

## Production recommendation

**Deploy: `e2_hybrid`** (utility = quality − 0.5·normalizedCost).

| Space | quality | utility |
|---|---|---|
| e2_hybrid | 0.074 | -0.026 |
| e1_prod2vec | 0.061 | -0.039 |
| e3_two_tower | 0.030 | -0.070 |
| e0_text | 0.023 | -0.077 |
| e5_context3 | 0.024 | -0.176 |
| e4_late | 0.024 | -0.476 |
