# Thesis F6 W6 — End-to-end serving latency / p99

Item space: e1_prod2vec (canonical 64d). n=2000, seed=42. E1 universe: 1998. Products: 2000. Pool size: 200. Requests timed: 200. LLM: off.

All latencies are **per-request** wall times from `performance.now()` (monotonic instrumentation only — never stored as data, never affects ranking; spec §2 exception). Reference gate: **p99 < 1.5 s** end-to-end (Fase-3c spec). **Scale caveat:** these are n=2000 baseline numbers; the real-scale figures come at n=10000 (W2). Stage-1 (retrieval) is O(N·dim) so it grows with the catalog — extrapolate accordingly.

Offline LTR training (NOT in per-request timing; done once): 251.91 ms for all 200 cases.

## Per-stage latency (ms)

| Stage | p50 | p95 | p99 | mean | max | n |
|---|---|---|---|---|---|---|
| 1. retrieval / pool-order | 3.34 | 5.04 | 7.60 | 3.55 | 9.85 | 200 |
| 2. rerank (F3 LTR) | 0.87 | 1.73 | 3.32 | 1.03 | 10.72 | 200 |
| 3. scorer (F4 multi-objective) | 1.60 | 3.66 | 4.40 | 1.91 | 8.55 | 200 |

## End-to-end latency (ms)

| Path | p50 | p95 | p99 | mean | max | n |
|---|---|---|---|---|---|---|
| end-to-end (no LLM): retrieval+LTR+scorer | 5.90 | 9.90 | 14.10 | 6.49 | 16.76 | 200 |

## Reference gate — p99 < 1.5 s

Operative end-to-end (no-LLM) p99 = **14.10 ms** → gate (< 1500 ms): **PASS**.

## Lectura (honest read)

Without the LLM, end-to-end p99 is **14.10 ms** — well under the 1.5 s gate. The dominant stage (p99) is **retrieval/pool-order** (7.60 ms). Note that retrieval / pool-order is the O(N·dim) scan over ~1998 candidates (p99 7.60 ms) — the stage that grows with the catalog, so at n=10000 (W2) it is expected to overtake the fixed-cost rerank/scorer stages, which only touch the 200-item pool.

The LLM leg was OFF for this run (`--llm` not passed); only the deterministic LTR pipeline was timed. Re-run with `--llm` to measure the DeepSeek listwise tail + $/request.

**Caveat (honest):** every latency here is single-process, single-thread tsx on the dev box, with all vectors already resident in memory (the loader bulk-reads them once). A real serving tier adds DB/cache round-trips per request, GC pressure under concurrency, and cold-start. These numbers are a LOWER BOUND on the compute cost of the ranking math, not a production SLA.

