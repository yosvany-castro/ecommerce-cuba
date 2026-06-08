# Thesis F6 W4 — F4 attribution caveat: single- vs multi-signal relevance

Item space: e1_prod2vec (64d). E1 universe: 1998. Products match dataset. Eval cases: 300, sweeping 300. Pool size: 200. k=10. Seed 42.

ONE shared 4-source RRF pool per user (the SAME pool as F3/F4); every config — single AND multi — scores the IDENTICAL candidate set. The multi-signal relevance FUSES retrieval-cosine + NPMI-to-last-viewed + cohort-popularity (RRF, mirroring the pool fusion). Every OTHER objective feature is unchanged. The held-out purchase is ground-truth for nDCG/recall/revenue MEASUREMENT only — never a feature. Deterministic (seed 42).

## Baseline (F3-RRF, 4-source fusion, relevance-only ordering)

| metric | value |
|---|---|
| nDCG@10 | 0.235 |
| recall@10 | 0.453 |
| revenue@10 | 29625.2254 |

## Per-config: single-signal vs multi-signal relevance (nDCG@10 / recall@10 / revenue@10)

| cfg | λ (rel,rev,mar,div,fair) | nDCG single | nDCG multi | recall single | recall multi | rev single | rev multi |
|---|---|---|---|---|---|---|---|
| cfg0 (rel-only) | rel=1, rev=0, mar=0, div=0, fair=0 | 0.135 | 0.220 | 0.283 | 0.423 | 31734.9688 | 29828.4817 |
| cfg1 | rel=1, rev=0, mar=0, div=0, fair=0.5 | 0.068 | 0.181 | 0.127 | 0.357 | 28017.8167 | 26862.7704 |
| cfg2 | rel=1, rev=0, mar=0, div=0.5, fair=0 | 0.123 | 0.207 | 0.267 | 0.417 | 31475.8691 | 27123.3002 |
| cfg3 | rel=1, rev=0, mar=0, div=0.5, fair=0.5 | 0.066 | 0.145 | 0.127 | 0.280 | 27711.8037 | 23937.4899 |
| cfg4 | rel=1, rev=0, mar=0.5, div=0, fair=0 | 0.128 | 0.223 | 0.277 | 0.427 | 32062.8776 | 28572.9285 |
| cfg5 | rel=1, rev=0, mar=0.5, div=0, fair=0.5 | 0.070 | 0.180 | 0.120 | 0.347 | 28201.6774 | 25538.2669 |
| cfg6 | rel=1, rev=0, mar=0.5, div=0.5, fair=0 | 0.121 | 0.204 | 0.257 | 0.397 | 32226.8334 | 25094.1672 |
| cfg7 | rel=1, rev=0, mar=0.5, div=0.5, fair=0.5 | 0.065 | 0.151 | 0.117 | 0.287 | 26962.6963 | 21851.1004 |
| cfg8 | rel=1, rev=0.5, mar=0, div=0, fair=0 | 0.092 | 0.198 | 0.200 | 0.397 | 47748.5893 | 38632.3141 |
| cfg9 | rel=1, rev=0.5, mar=0, div=0, fair=0.5 | 0.073 | 0.180 | 0.140 | 0.340 | 36755.2778 | 36752.9519 |
| cfg10 | rel=1, rev=0.5, mar=0, div=0.5, fair=0 | 0.084 | 0.190 | 0.187 | 0.393 | 48687.7801 | 39063.7928 |
| cfg11 | rel=1, rev=0.5, mar=0, div=0.5, fair=0.5 | 0.064 | 0.155 | 0.120 | 0.290 | 37047.7126 | 35030.0348 |
| cfg12 | rel=1, rev=0.5, mar=0.5, div=0, fair=0 | 0.089 | 0.203 | 0.197 | 0.410 | 47733.1882 | 38371.8728 |
| cfg13 | rel=1, rev=0.5, mar=0.5, div=0, fair=0.5 | 0.070 | 0.183 | 0.140 | 0.357 | 37151.3045 | 36371.5912 |
| cfg14 | rel=1, rev=0.5, mar=0.5, div=0.5, fair=0 | 0.076 | 0.191 | 0.157 | 0.383 | 48063.3453 | 37340.0028 |
| cfg15 | rel=1, rev=0.5, mar=0.5, div=0.5, fair=0.5 | 0.067 | 0.159 | 0.137 | 0.307 | 36838.1237 | 33572.1753 |
| cfg16 | rel=1, rev=1, mar=0, div=0, fair=0 | 0.074 | 0.152 | 0.153 | 0.317 | 50848.1263 | 45669.8686 |
| cfg17 | rel=1, rev=1, mar=0, div=0, fair=0.5 | 0.068 | 0.151 | 0.140 | 0.290 | 45702.9147 | 44175.4063 |
| cfg18 | rel=1, rev=1, mar=0, div=0.5, fair=0 | 0.064 | 0.138 | 0.137 | 0.297 | 51797.7786 | 46036.5416 |
| cfg19 | rel=1, rev=1, mar=0, div=0.5, fair=0.5 | 0.063 | 0.135 | 0.133 | 0.250 | 46300.0175 | 44200.0763 |
| cfg20 | rel=1, rev=1, mar=0.5, div=0, fair=0 | 0.078 | 0.165 | 0.160 | 0.340 | 49982.8040 | 44823.6812 |
| cfg21 | rel=1, rev=1, mar=0.5, div=0, fair=0.5 | 0.072 | 0.155 | 0.153 | 0.290 | 45392.9397 | 43521.1125 |
| cfg22 | rel=1, rev=1, mar=0.5, div=0.5, fair=0 | 0.066 | 0.154 | 0.133 | 0.320 | 51159.7163 | 45615.0745 |
| cfg23 | rel=1, rev=1, mar=0.5, div=0.5, fair=0.5 | 0.066 | 0.140 | 0.137 | 0.257 | 45658.1382 | 43635.8711 |

## Decomposition

### (a) The CONFOUND — single→multi relevance gap at identical weights

At the relevance-only config (**cfg0**: rel=1, rev=0, mar=0, div=0, fair=0), swapping the single-signal relevance feature for the multi-signal fusion moves nDCG@10 from **0.135** to **0.220** (+62.6%, Δ=+0.085).

Relative to the 4-source RRF baseline (0.235): single rel-only is -42.4%, multi rel-only is -6.4%. The multi signal closes **84.9%** of the single→baseline gap. This is the single-signal-vs-fusion CONFOUND the F4 study flagged — NOT a relevance↔revenue trade-off cost.

### (b) The TRUE trade-off — measured WITH multi-signal relevance

Confound-free: revenue-max config (**cfg18**: rel=1, rev=1, mar=0, div=0.5, fair=0) vs the multi-signal relevance-only config (cfg0). Revenue@10 +54.3% for nDCG@10 -37.0%. Both legs use the SAME fused relevance feature, so this is the GENUINE cost of tilting toward revenue — the single-signal handicap is removed.

For contrast, the NAIVE single-signal trade-off (what F4 reported): revenue-max-single (cfg18) vs single relevance-only — revenue@10 +63.2% for nDCG@10 -53.1%.

### Honest read

The F4 headline "every reranked config has relevance well below the RRF baseline" conflated TWO effects. (a) is the confound: a single-signal relevance feature (cosine-to-modes ≈ retrieval source) cannot match a 4-source fused baseline; fusing NPMI + cohort-popularity into the relevance feature narrows that gap by 84.9%. (b) is the trade-off, now measured on equal footing: the revenue dial costs 37.0% nDCG@10 for +54.3% revenue@10 — the figure the thesis can defend, with the single-signal artifact removed.

