# Thesis F1 — Embedding Study

Cases vary per space (users with ≥1 train item in that space).

| Space | cases | MRR | nDCG@5 | nDCG@10 | nDCG@20 | Recall@5 | Recall@10 | Recall@20 | complR@10 |
|---|---|---|---|---|---|---|---|---|---|
| e0_text | 222 | 0.137 | 0.132 | 0.169 | 0.194 | 0.207 | 0.324 | 0.419 | 0.027 |
| e1_prod2vec | 222 | 0.217 | 0.231 | 0.255 | 0.281 | 0.351 | 0.423 | 0.527 | 0.061 |
| e3_two_tower | 222 | 0.149 | 0.145 | 0.191 | 0.209 | 0.230 | 0.374 | 0.441 | 0.027 |
| e5_context3 | 222 | 0.133 | 0.127 | 0.165 | 0.187 | 0.198 | 0.315 | 0.401 | 0.019 |
| e2_hybrid | 222 | 0.221 | 0.237 | 0.262 | 0.288 | 0.360 | 0.437 | 0.545 | 0.036 |
| e4_late | 222 | 0.134 | 0.134 | 0.176 | 0.192 | 0.221 | 0.351 | 0.414 | 0.032 |

## Production recommendation

**Deploy: `e1_prod2vec`** (utility = quality − 0.5·normalizedCost).

| Space | quality | utility |
|---|---|---|
| e1_prod2vec | 0.177 | 0.077 |
| e2_hybrid | 0.171 | 0.071 |
| e3_two_tower | 0.126 | 0.026 |
| e0_text | 0.112 | 0.012 |
| e5_context3 | 0.106 | -0.094 |
| e4_late | 0.118 | -0.382 |
