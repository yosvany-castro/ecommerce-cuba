# Thesis F4 — Multi-objective rerank + Pareto frontier vs F3-RRF

Item space: e1_prod2vec. Common universe: 1998. Eval cases: 1107. Pool size: 200. k=10.

ONE shared pool per user (the SAME 4-source RRF pool as F3); every config scores the identical candidate set. Objective features use only relevance (cosine to modes) + catalog margin/price/popularity/seller. The held-out test purchase is ground-truth for relevance/revenue MEASUREMENT only — never a feature. Fully deterministic (seed 42).

λ-grid: relevance=1 fixed; revenue∈{0,0.5,1}, margin∈{0,0.5}, diversity∈{0,0.5}, sellerFairness∈{0,0.5}; convProb=novelty=0 → 24 configs.

## Baseline (F3-RRF, relevance-only)

| metric | value |
|---|---|
| relevance (nDCG@10) | 0.202 |
| revenue@10 | 29702.2101 |
| diversity (intra-list@10) | 0.132 |
| novelty@10 | -4.254 |
| sellerGini@10 | 0.103 |

## Pareto frontier (maximize relevance, revenue, diversity, fairness=1−gini)

Frontier configs: 23/24.

| cfg | λ (rel,rev,mar,div,fair) | relevance | revenue@10 | diversity | sellerGini | fairness |
|---|---|---|---|---|---|---|
| cfg0 | rel=1, rev=0, mar=0, div=0, fair=0 | 0.107 | 31923.2947 | 0.068 | 0.107 | 0.893 |
| cfg1 | rel=1, rev=0, mar=0, div=0, fair=0.5 | 0.061 | 28610.9872 | 0.173 | 0.094 | 0.906 |
| cfg2 | rel=1, rev=0, mar=0, div=0.5, fair=0 | 0.097 | 31559.9836 | 0.102 | 0.109 | 0.891 |
| cfg3 | rel=1, rev=0, mar=0, div=0.5, fair=0.5 | 0.058 | 28033.7194 | 0.195 | 0.092 | 0.908 |
| cfg4 | rel=1, rev=0, mar=0.5, div=0, fair=0 | 0.103 | 30512.1816 | 0.068 | 0.113 | 0.887 |
| cfg5 | rel=1, rev=0, mar=0.5, div=0, fair=0.5 | 0.064 | 28318.2105 | 0.173 | 0.097 | 0.903 |
| cfg6 | rel=1, rev=0, mar=0.5, div=0.5, fair=0 | 0.098 | 31331.2550 | 0.098 | 0.116 | 0.884 |
| cfg7 | rel=1, rev=0, mar=0.5, div=0.5, fair=0.5 | 0.059 | 27083.4946 | 0.210 | 0.100 | 0.900 |
| cfg8 | rel=1, rev=0.5, mar=0, div=0, fair=0 | 0.081 | 48498.0968 | 0.106 | 0.111 | 0.889 |
| cfg9 | rel=1, rev=0.5, mar=0, div=0, fair=0.5 | 0.059 | 37686.1048 | 0.168 | 0.094 | 0.906 |
| cfg10 | rel=1, rev=0.5, mar=0, div=0.5, fair=0 | 0.072 | 49372.2002 | 0.160 | 0.114 | 0.886 |
| cfg11 | rel=1, rev=0.5, mar=0, div=0.5, fair=0.5 | 0.052 | 37915.7867 | 0.197 | 0.094 | 0.906 |
| cfg12 | rel=1, rev=0.5, mar=0.5, div=0, fair=0 | 0.077 | 48496.9369 | 0.110 | 0.109 | 0.891 |
| cfg13 | rel=1, rev=0.5, mar=0.5, div=0, fair=0.5 | 0.059 | 38000.5542 | 0.169 | 0.106 | 0.894 |
| cfg14 | rel=1, rev=0.5, mar=0.5, div=0.5, fair=0 | 0.065 | 48733.9061 | 0.145 | 0.111 | 0.889 |
| cfg15 | rel=1, rev=0.5, mar=0.5, div=0.5, fair=0.5 | 0.055 | 37473.1845 | 0.187 | 0.104 | 0.896 |
| cfg16 | rel=1, rev=1, mar=0, div=0, fair=0 | 0.065 | 51576.5565 | 0.170 | 0.111 | 0.889 |
| cfg17 | rel=1, rev=1, mar=0, div=0, fair=0.5 | 0.059 | 46798.8954 | 0.181 | 0.110 | 0.890 |
| cfg18 | rel=1, rev=1, mar=0, div=0.5, fair=0 | 0.056 | 52523.9601 | 0.226 | 0.110 | 0.890 |
| cfg19 | rel=1, rev=1, mar=0, div=0.5, fair=0.5 | 0.053 | 47378.2095 | 0.236 | 0.105 | 0.895 |
| cfg20 | rel=1, rev=1, mar=0.5, div=0, fair=0 | 0.068 | 50837.6285 | 0.145 | 0.110 | 0.890 |
| cfg22 | rel=1, rev=1, mar=0.5, div=0.5, fair=0 | 0.057 | 52000.3291 | 0.212 | 0.110 | 0.890 |
| cfg23 | rel=1, rev=1, mar=0.5, div=0.5, fair=0.5 | 0.056 | 46943.8102 | 0.216 | 0.117 | 0.883 |

## Guardrail feasibility (relevance ≥ 0.7·base (0.141); sellerGini ≤ base+0.2 (0.303))

Configs satisfying BOTH guardrails: **0/24**.

No config satisfies the relevance≥0.7·baseline guardrail — the relevance↔revenue trade-off is steep on this pool; `pickByKpi` falls back to the global revenue maximum (reported below), which does NOT meet the guardrail.


## KPI-selected operating point (maximize revenue@10; guardrails: relevance ≥ 0.7·base, sellerGini ≤ base+0.2)

Selected: **cfg18** — λ: rel=1, rev=1, mar=0, div=0.5, fair=0. On Pareto frontier: yes. Guardrail status: **FALLBACK (does NOT meet guardrails — global revenue maximum)**.

| metric | KPI point | baseline | Δ% |
|---|---|---|---|
| relevance (nDCG@10) | 0.056 | 0.202 | -72.4% |
| revenue@10 | 52523.9601 | 29702.2101 | +76.8% |
| diversity@10 | 0.226 | 0.132 | 70.8% |
| sellerGini@10 | 0.110 | 0.103 | 6.6% |

## Balanced operating point (knee — min-max normalized, maximize min(relN, revN))

Min-max normalization across the 24 swept configs: relN = (rel−minRel)/(maxRel−minRel), revN = (rev−minRev)/(maxRev−minRev). The knee maximizes min(relN, revN) — scale-free, so it is not dominated by revenue's raw magnitude (~30k vs relevance ~0.1).

Selected: **cfg8** — λ: rel=1, rev=0.5, mar=0, div=0, fair=0. relN=0.529, revN=0.842. On Pareto frontier: yes. Guardrail status: **does NOT meet guardrails**.

| metric | knee point | baseline | Δ% |
|---|---|---|---|
| relevance (nDCG@10) | 0.081 | 0.202 | -59.8% |
| revenue@10 | 48498.0968 | 29702.2101 | +63.3% |
| diversity@10 | 0.106 | 0.132 | -19.9% |
| sellerGini@10 | 0.111 | 0.103 | 8.1% |

## Trade-off summary

**+76.8% revenue@10 for −72.4% relevance@10 vs RRF**

A config with revenue@10 > baseline exists: yes.

### Honest read

The Pareto frontier (23/24 configs) is real: weighting the revenue objective moves the operating point along a genuine relevance↔revenue trade-off. At the revenue-max point (cfg18) the lift is +76.8% revenue@10 for −72.4% relevance@10 vs RRF.

The strict 0.7·baseline relevance guardrail is INFEASIBLE on this pool: 0/24 configs satisfy it, so `pickByKpi` falls back to the global revenue maximum — a point that sacrifices 72.4% of relevance and is therefore NOT a desirable production operating point. This corrects an earlier draft that incorrectly described the KPI point as inside the guardrail; it is not.

The balanced knee (min-max) is cfg8 (relN=0.529, revN=0.842): -59.8% relevance@10 and +63.3% revenue@10 vs baseline. It keeps 53% of the relevance range and 84% of the revenue range — a genuine compromise, far better than the revenue corner that a raw rel/base+rev/base sum (dominated by revenue's magnitude) would pick.

The deeper finding: **every reranked config has relevance well below the RRF baseline**. The best config on relevance (cfg0, 0.107) is still -47.1% below baseline (0.202) — even the best reranking roughly halves nDCG@10 on this pool. So on THIS synthetic pool pure-RRF order is a strong relevance optimum, and ANY revenue/diversity/fairness weighting costs substantial relevance. The min-max knee is the least-bad compromise, NOT a free lunch.

For the thesis: the multi-objective frontier is genuine and lets the business DIAL revenue vs relevance, but on this synthetic pool pure-RRF order is the relevance optimum and any revenue/diversity/fairness weighting costs relevance, so the right operating choice is the min-max balanced knee — the least-bad compromise, not the degenerate revenue corner a naïve KPI-max would select.

