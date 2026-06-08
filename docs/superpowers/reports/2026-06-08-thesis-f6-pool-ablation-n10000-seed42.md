# Thesis F6 W9 — Pool source ablations (leave-one-source-out)

Item space: e1_prod2vec (canonical 64d). E1 universe: 9999. Eval cases: 2000 (--limit 2000). Pool cap: 200. RRF k0=60.

Four sources fused via RRF: **retrieval** (top-80 max-cos to E1 mode medoids), **npmi** (last-viewed co-occurrence neighbours, top-50), **popular** (cohort popularity, top-40), **exploration** (seeded shuffle, 30). Each ablation rebuilds the pool with ONE source dropped, then measures pool-recall (held-out purchase in pool) and nDCG@10 of the RRF order (no reranker — isolates retrieval+fusion).

No GT leaks: the pool is built from the F2 detector path (modes / last-viewed / cohort); the held-out test purchase is used ONLY as the recall/nDCG label.

## Ablation results (pool-recall + nDCG@10 of the RRF order)

| Variant | pool-recall | Δrecall vs full | nDCG@10 | ΔnDCG@10 vs full | avg pool size |
|---|---|---|---|---|---|
| full | 0.721 | — | 0.095 | — | 173.2 |
| -retrieval | 0.630 | -0.091 | 0.089 | -0.007 | 106.9 |
| -npmi | 0.341 | -0.380 | 0.025 | -0.070 | 141.2 |
| -popular | 0.701 | -0.020 | 0.092 | -0.003 | 142.5 |
| -exploration | 0.721 | +0.000 | 0.099 | +0.004 | 143.6 |

## Per-source diagnostics (held-out test item reachability)

| Source | source-only recall | hits |
|---|---|---|
| retrieval | 0.291 | 582/2000 |
| npmi | 0.582 | 1164/2000 |
| popular | 0.122 | 245/2000 |
| exploration | 0.001 | 2/2000 |

## NPMI orthogonality test (does NPMI recover complements cosine misses?)

- Cases with a last-viewed (NPMI reachable at all): 2000/2000 (1.000).
- Test item in NPMI source list: 1164/2000 (0.582).
- Test item in retrieval source list: 582/2000 (0.291).
- **Test item in NPMI but NOT in retrieval (the complements cosine misses): 820/2000 (0.410).**
- Removing NPMI changes pool-recall by -0.380 (recall DROPS — NPMI helped).

## Verdict (honest read)

**CONFIRMED — NPMI adds orthogonal signal.** Dropping NPMI lowers pool-recall by 0.380 (and nDCG@10 by 0.070), and in 820/2000 cases the held-out purchase is reachable via the NPMI co-occurrence list but NOT via cosine retrieval — exactly the complements the coseno fails to surface. NPMI is not redundant with retrieval on this dataset.

Most load-bearing source for pool-recall: dropping **npmi** costs the most recall (-0.380). Full-pool recall = 0.721, nDCG@10 = 0.095.

