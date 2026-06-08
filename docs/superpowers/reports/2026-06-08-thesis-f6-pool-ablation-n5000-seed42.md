# Thesis F6 W9 — Pool source ablations (leave-one-source-out)

Item space: e1_prod2vec (canonical 64d). E1 universe: 4999. Eval cases: 2893. Pool cap: 200. RRF k0=60.

Four sources fused via RRF: **retrieval** (top-80 max-cos to E1 mode medoids), **npmi** (last-viewed co-occurrence neighbours, top-50), **popular** (cohort popularity, top-40), **exploration** (seeded shuffle, 30). Each ablation rebuilds the pool with ONE source dropped, then measures pool-recall (held-out purchase in pool) and nDCG@10 of the RRF order (no reranker — isolates retrieval+fusion).

No GT leaks: the pool is built from the F2 detector path (modes / last-viewed / cohort); the held-out test purchase is used ONLY as the recall/nDCG label.

## Ablation results (pool-recall + nDCG@10 of the RRF order)

| Variant | pool-recall | Δrecall vs full | nDCG@10 | ΔnDCG@10 vs full | avg pool size |
|---|---|---|---|---|---|
| full | 0.796 | — | 0.123 | — | 166.8 |
| -retrieval | 0.708 | -0.089 | 0.105 | -0.018 | 104.2 |
| -npmi | 0.455 | -0.341 | 0.053 | -0.070 | 138.4 |
| -popular | 0.781 | -0.016 | 0.124 | +0.001 | 138.8 |
| -exploration | 0.795 | -0.002 | 0.129 | +0.006 | 137.6 |

## Per-source diagnostics (held-out test item reachability)

| Source | source-only recall | hits |
|---|---|---|
| retrieval | 0.411 | 1189/2893 |
| npmi | 0.636 | 1840/2893 |
| popular | 0.193 | 557/2893 |
| exploration | 0.004 | 12/2893 |

## NPMI orthogonality test (does NPMI recover complements cosine misses?)

- Cases with a last-viewed (NPMI reachable at all): 2893/2893 (1.000).
- Test item in NPMI source list: 1840/2893 (0.636).
- Test item in retrieval source list: 1189/2893 (0.411).
- **Test item in NPMI but NOT in retrieval (the complements cosine misses): 1064/2893 (0.368).**
- Removing NPMI changes pool-recall by -0.341 (recall DROPS — NPMI helped).

## Verdict (honest read)

**CONFIRMED — NPMI adds orthogonal signal.** Dropping NPMI lowers pool-recall by 0.341 (and nDCG@10 by 0.070), and in 1064/2893 cases the held-out purchase is reachable via the NPMI co-occurrence list but NOT via cosine retrieval — exactly the complements the coseno fails to surface. NPMI is not redundant with retrieval on this dataset.

Most load-bearing source for pool-recall: dropping **npmi** costs the most recall (-0.341). Full-pool recall = 0.796, nDCG@10 = 0.123.

