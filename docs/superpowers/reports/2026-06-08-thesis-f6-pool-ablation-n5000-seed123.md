# Thesis F6 W9 — Pool source ablations (leave-one-source-out)

Item space: e1_prod2vec (canonical 64d). E1 universe: 4999. Eval cases: 2801. Pool cap: 200. RRF k0=60.

Four sources fused via RRF: **retrieval** (top-80 max-cos to E1 mode medoids), **npmi** (last-viewed co-occurrence neighbours, top-50), **popular** (cohort popularity, top-40), **exploration** (seeded shuffle, 30). Each ablation rebuilds the pool with ONE source dropped, then measures pool-recall (held-out purchase in pool) and nDCG@10 of the RRF order (no reranker — isolates retrieval+fusion).

No GT leaks: the pool is built from the F2 detector path (modes / last-viewed / cohort); the held-out test purchase is used ONLY as the recall/nDCG label.

## Ablation results (pool-recall + nDCG@10 of the RRF order)

| Variant | pool-recall | Δrecall vs full | nDCG@10 | ΔnDCG@10 vs full | avg pool size |
|---|---|---|---|---|---|
| full | 0.803 | — | 0.131 | — | 166.5 |
| -retrieval | 0.714 | -0.089 | 0.122 | -0.009 | 104.1 |
| -npmi | 0.472 | -0.331 | 0.055 | -0.076 | 138.2 |
| -popular | 0.785 | -0.017 | 0.136 | +0.005 | 138.7 |
| -exploration | 0.802 | -0.001 | 0.137 | +0.006 | 137.3 |

## Per-source diagnostics (held-out test item reachability)

| Source | source-only recall | hits |
|---|---|---|
| retrieval | 0.426 | 1192/2801 |
| npmi | 0.643 | 1800/2801 |
| popular | 0.203 | 569/2801 |
| exploration | 0.005 | 15/2801 |

## NPMI orthogonality test (does NPMI recover complements cosine misses?)

- Cases with a last-viewed (NPMI reachable at all): 2801/2801 (1.000).
- Test item in NPMI source list: 1800/2801 (0.643).
- Test item in retrieval source list: 1192/2801 (0.426).
- **Test item in NPMI but NOT in retrieval (the complements cosine misses): 1005/2801 (0.359).**
- Removing NPMI changes pool-recall by -0.331 (recall DROPS — NPMI helped).

## Verdict (honest read)

**CONFIRMED — NPMI adds orthogonal signal.** Dropping NPMI lowers pool-recall by 0.331 (and nDCG@10 by 0.076), and in 1005/2801 cases the held-out purchase is reachable via the NPMI co-occurrence list but NOT via cosine retrieval — exactly the complements the coseno fails to surface. NPMI is not redundant with retrieval on this dataset.

Most load-bearing source for pool-recall: dropping **npmi** costs the most recall (-0.331). Full-pool recall = 0.803, nDCG@10 = 0.131.

