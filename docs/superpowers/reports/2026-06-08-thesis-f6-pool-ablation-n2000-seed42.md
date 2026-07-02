# Thesis F6 W9 — Pool source ablations (leave-one-source-out)

Item space: e1_prod2vec (canonical 64d). E1 universe: 1998. Eval cases: 1107. Pool cap: 200. RRF k0=60.

Four sources fused via RRF: **retrieval** (top-80 max-cos to E1 mode medoids), **npmi** (last-viewed co-occurrence neighbours, top-50), **popular** (cohort popularity, top-40), **exploration** (seeded shuffle, 30). Each ablation rebuilds the pool with ONE source dropped, then measures pool-recall (held-out purchase in pool) and nDCG@10 of the RRF order (no reranker — isolates retrieval+fusion).

No GT leaks: the pool is built from the F2 detector path (modes / last-viewed / cohort); the held-out test purchase is used ONLY as the recall/nDCG label.

## Ablation results (pool-recall + nDCG@10 of the RRF order)

| Variant | pool-recall | Δrecall vs full | nDCG@10 | ΔnDCG@10 vs full | avg pool size |
|---|---|---|---|---|---|
| full | 0.874 | — | 0.200 | — | 158.1 |
| -retrieval | 0.811 | -0.062 | 0.186 | -0.015 | 97.4 |
| -npmi | 0.593 | -0.280 | 0.123 | -0.078 | 135.8 |
| -popular | 0.862 | -0.012 | 0.198 | -0.002 | 132.3 |
| -exploration | 0.871 | -0.003 | 0.206 | +0.006 | 130.1 |

## Per-source diagnostics (held-out test item reachability)

| Source | source-only recall | hits |
|---|---|---|
| retrieval | 0.540 | 598/1107 |
| npmi | 0.722 | 799/1107 |
| popular | 0.361 | 400/1107 |
| exploration | 0.017 | 19/1107 |

## NPMI orthogonality test (does NPMI recover complements cosine misses?)

- Cases with a last-viewed (NPMI reachable at all): 1107/1107 (1.000).
- Test item in NPMI source list: 799/1107 (0.722).
- Test item in retrieval source list: 598/1107 (0.540).
- **Test item in NPMI but NOT in retrieval (the complements cosine misses): 353/1107 (0.319).**
- Removing NPMI changes pool-recall by -0.280 (recall DROPS — NPMI helped).

## Verdict (honest read)

**CONFIRMED — NPMI adds orthogonal signal.** Dropping NPMI lowers pool-recall by 0.280 (and nDCG@10 by 0.078), and in 353/1107 cases the held-out purchase is reachable via the NPMI co-occurrence list but NOT via cosine retrieval — exactly the complements the coseno fails to surface. NPMI is not redundant with retrieval on this dataset.

Most load-bearing source for pool-recall: dropping **npmi** costs the most recall (-0.280). Full-pool recall = 0.874, nDCG@10 = 0.200.

