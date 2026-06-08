# Thesis F6 W4 — F4 attribution caveat: single- vs multi-signal relevance

Item space: e1_prod2vec (64d). E1 universe: 9999. Products match dataset. Eval cases: 300, sweeping 300. Pool size: 200. k=10. Seed 42.

ONE shared 4-source RRF pool per user (the SAME pool as F3/F4); every config — single AND multi — scores the IDENTICAL candidate set. The multi-signal relevance FUSES retrieval-cosine + NPMI-to-last-viewed + cohort-popularity (RRF, mirroring the pool fusion). Every OTHER objective feature is unchanged. The held-out purchase is ground-truth for nDCG/recall/revenue MEASUREMENT only — never a feature. Deterministic (seed 42).

## Baseline (F3-RRF, 4-source fusion, relevance-only ordering)

| metric | value |
|---|---|
| nDCG@10 | 0.125 |
| recall@10 | 0.217 |
| revenue@10 | 34830.7504 |

## Per-config: single-signal vs multi-signal relevance (nDCG@10 / recall@10 / revenue@10)

| cfg | λ (rel,rev,mar,div,fair) | nDCG single | nDCG multi | recall single | recall multi | rev single | rev multi |
|---|---|---|---|---|---|---|---|
| cfg0 (rel-only) | rel=1, rev=0, mar=0, div=0, fair=0 | 0.019 | 0.108 | 0.040 | 0.187 | 38292.7614 | 36950.3072 |
| cfg1 | rel=1, rev=0, mar=0, div=0, fair=0.5 | 0.024 | 0.073 | 0.063 | 0.147 | 36089.2884 | 32534.2392 |
| cfg2 | rel=1, rev=0, mar=0, div=0.5, fair=0 | 0.029 | 0.102 | 0.063 | 0.177 | 37872.2534 | 33264.3901 |
| cfg3 | rel=1, rev=0, mar=0, div=0.5, fair=0.5 | 0.024 | 0.070 | 0.063 | 0.143 | 35882.3323 | 29448.6868 |
| cfg4 | rel=1, rev=0, mar=0.5, div=0, fair=0 | 0.021 | 0.105 | 0.050 | 0.183 | 42229.6980 | 34512.9070 |
| cfg5 | rel=1, rev=0, mar=0.5, div=0, fair=0.5 | 0.021 | 0.068 | 0.053 | 0.140 | 36054.9578 | 28635.3837 |
| cfg6 | rel=1, rev=0, mar=0.5, div=0.5, fair=0 | 0.027 | 0.102 | 0.060 | 0.183 | 43281.6483 | 29092.6236 |
| cfg7 | rel=1, rev=0, mar=0.5, div=0.5, fair=0.5 | 0.023 | 0.060 | 0.060 | 0.120 | 34932.4057 | 25429.4760 |
| cfg8 | rel=1, rev=0.5, mar=0, div=0, fair=0 | 0.022 | 0.093 | 0.053 | 0.177 | 64805.6820 | 51640.3114 |
| cfg9 | rel=1, rev=0.5, mar=0, div=0, fair=0.5 | 0.023 | 0.066 | 0.063 | 0.127 | 47903.1458 | 48128.4327 |
| cfg10 | rel=1, rev=0.5, mar=0, div=0.5, fair=0 | 0.022 | 0.091 | 0.057 | 0.183 | 65469.0626 | 50263.3792 |
| cfg11 | rel=1, rev=0.5, mar=0, div=0.5, fair=0.5 | 0.023 | 0.066 | 0.067 | 0.127 | 48108.6491 | 45613.0937 |
| cfg12 | rel=1, rev=0.5, mar=0.5, div=0, fair=0 | 0.021 | 0.093 | 0.053 | 0.177 | 64633.0564 | 51499.6611 |
| cfg13 | rel=1, rev=0.5, mar=0.5, div=0, fair=0.5 | 0.020 | 0.067 | 0.057 | 0.137 | 48117.7474 | 47050.6089 |
| cfg14 | rel=1, rev=0.5, mar=0.5, div=0.5, fair=0 | 0.025 | 0.090 | 0.067 | 0.177 | 64568.6265 | 48536.3738 |
| cfg15 | rel=1, rev=0.5, mar=0.5, div=0.5, fair=0.5 | 0.020 | 0.063 | 0.057 | 0.123 | 48146.8582 | 43148.4882 |
| cfg16 | rel=1, rev=1, mar=0, div=0, fair=0 | 0.022 | 0.072 | 0.057 | 0.143 | 66890.8813 | 60322.2471 |
| cfg17 | rel=1, rev=1, mar=0, div=0, fair=0.5 | 0.022 | 0.059 | 0.060 | 0.127 | 59130.6857 | 57441.9364 |
| cfg18 | rel=1, rev=1, mar=0, div=0.5, fair=0 | 0.022 | 0.071 | 0.057 | 0.150 | 67646.9690 | 60425.9357 |
| cfg19 | rel=1, rev=1, mar=0, div=0.5, fair=0.5 | 0.021 | 0.055 | 0.060 | 0.117 | 59632.2096 | 56731.7019 |
| cfg20 | rel=1, rev=1, mar=0.5, div=0, fair=0 | 0.021 | 0.074 | 0.057 | 0.143 | 66053.9335 | 59951.1619 |
| cfg21 | rel=1, rev=1, mar=0.5, div=0, fair=0.5 | 0.022 | 0.062 | 0.060 | 0.133 | 59554.4602 | 57071.3812 |
| cfg22 | rel=1, rev=1, mar=0.5, div=0.5, fair=0 | 0.022 | 0.073 | 0.060 | 0.147 | 66846.5797 | 60063.0418 |
| cfg23 | rel=1, rev=1, mar=0.5, div=0.5, fair=0.5 | 0.020 | 0.059 | 0.057 | 0.130 | 59459.8919 | 55804.6765 |

## Decomposition

### (a) The CONFOUND — single→multi relevance gap at identical weights

At the relevance-only config (**cfg0**: rel=1, rev=0, mar=0, div=0, fair=0), swapping the single-signal relevance feature for the multi-signal fusion moves nDCG@10 from **0.019** to **0.108** (+455.9%, Δ=+0.089).

Relative to the 4-source RRF baseline (0.125): single rel-only is -84.5%, multi rel-only is -13.8%. The multi signal closes **83.7%** of the single→baseline gap. This is the single-signal-vs-fusion CONFOUND the F4 study flagged — NOT a relevance↔revenue trade-off cost.

### (b) The TRUE trade-off — measured WITH multi-signal relevance

Confound-free: revenue-max config (**cfg18**: rel=1, rev=1, mar=0, div=0.5, fair=0) vs the multi-signal relevance-only config (cfg0). Revenue@10 +63.5% for nDCG@10 -34.4%. Both legs use the SAME fused relevance feature, so this is the GENUINE cost of tilting toward revenue — the single-signal handicap is removed.

For contrast, the NAIVE single-signal trade-off (what F4 reported): revenue-max-single (cfg18) vs single relevance-only — revenue@10 +76.7% for nDCG@10 +11.4%.

### Honest read

The F4 headline "every reranked config has relevance well below the RRF baseline" conflated TWO effects. (a) is the confound: a single-signal relevance feature (cosine-to-modes ≈ retrieval source) cannot match a 4-source fused baseline; fusing NPMI + cohort-popularity into the relevance feature narrows that gap by 83.7%. (b) is the trade-off, now measured on equal footing: the revenue dial costs 34.4% nDCG@10 for +63.5% revenue@10 — the figure the thesis can defend, with the single-signal artifact removed.

