# Thesis F6 W9 — Pool source ablations (leave-one-source-out)

Item space: e1_prod2vec (canonical 64d). E1 universe: 4998. Eval cases: 2873. Pool cap: 200. RRF k0=60.

Four sources fused via RRF: **retrieval** (top-80 max-cos to E1 mode medoids), **npmi** (last-viewed co-occurrence neighbours, top-50), **popular** (cohort popularity, top-40), **exploration** (seeded shuffle, 30). Each ablation rebuilds the pool with ONE source dropped, then measures pool-recall (held-out purchase in pool) and nDCG@10 of the RRF order (no reranker — isolates retrieval+fusion).

No GT leaks: the pool is built from the F2 detector path (modes / last-viewed / cohort); the held-out test purchase is used ONLY as the recall/nDCG label.

## Ablation results (pool-recall + nDCG@10 of the RRF order)

| Variant | pool-recall | Δrecall vs full | nDCG@10 | ΔnDCG@10 vs full | avg pool size |
|---|---|---|---|---|---|
| full | 0.796 | — | 0.130 | — | 166.5 |
| -retrieval | 0.714 | -0.082 | 0.105 | -0.025 | 104.4 |
| -npmi | 0.460 | -0.336 | 0.051 | -0.079 | 137.7 |
| -popular | 0.783 | -0.013 | 0.141 | +0.011 | 139.2 |
| -exploration | 0.794 | -0.002 | 0.134 | +0.004 | 137.3 |

## Per-source diagnostics (held-out test item reachability)

| Source | source-only recall | hits |
|---|---|---|
| retrieval | 0.422 | 1211/2873 |
| npmi | 0.641 | 1842/2873 |
| popular | 0.197 | 565/2873 |
| exploration | 0.006 | 18/2873 |

## NPMI orthogonality test (does NPMI recover complements cosine misses?)

- Cases with a last-viewed (NPMI reachable at all): 2873/2873 (1.000).
- Test item in NPMI source list: 1842/2873 (0.641).
- Test item in retrieval source list: 1211/2873 (0.422).
- **Test item in NPMI but NOT in retrieval (the complements cosine misses): 1033/2873 (0.360).**
- Removing NPMI changes pool-recall by -0.336 (recall DROPS — NPMI helped).

## Verdict (honest read)

**CONFIRMED — NPMI adds orthogonal signal.** Dropping NPMI lowers pool-recall by 0.336 (and nDCG@10 by 0.079), and in 1033/2873 cases the held-out purchase is reachable via the NPMI co-occurrence list but NOT via cosine retrieval — exactly the complements the coseno fails to surface. NPMI is not redundant with retrieval on this dataset.

Most load-bearing source for pool-recall: dropping **npmi** costs the most recall (-0.336). Full-pool recall = 0.796, nDCG@10 = 0.130.

