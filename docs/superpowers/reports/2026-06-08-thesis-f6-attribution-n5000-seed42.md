# Thesis F6 W4 — F4 attribution caveat: single- vs multi-signal relevance

Item space: e1_prod2vec (64d). E1 universe: 4999. Products match dataset. Eval cases: 300, sweeping 300. Pool size: 200. k=10. Seed 42.

ONE shared 4-source RRF pool per user (the SAME pool as F3/F4); every config — single AND multi — scores the IDENTICAL candidate set. The multi-signal relevance FUSES retrieval-cosine + NPMI-to-last-viewed + cohort-popularity (RRF, mirroring the pool fusion). Every OTHER objective feature is unchanged. The held-out purchase is ground-truth for nDCG/recall/revenue MEASUREMENT only — never a feature. Deterministic (seed 42).

## Baseline (F3-RRF, 4-source fusion, relevance-only ordering)

| metric | value |
|---|---|
| nDCG@10 | 0.153 |
| recall@10 | 0.287 |
| revenue@10 | 31342.4640 |

## Per-config: single-signal vs multi-signal relevance (nDCG@10 / recall@10 / revenue@10)

| cfg | λ (rel,rev,mar,div,fair) | nDCG single | nDCG multi | recall single | recall multi | rev single | rev multi |
|---|---|---|---|---|---|---|---|
| cfg0 (rel-only) | rel=1, rev=0, mar=0, div=0, fair=0 | 0.071 | 0.155 | 0.153 | 0.290 | 34437.8104 | 32304.0082 |
| cfg1 | rel=1, rev=0, mar=0, div=0, fair=0.5 | 0.054 | 0.118 | 0.113 | 0.207 | 31847.1857 | 30060.5217 |
| cfg2 | rel=1, rev=0, mar=0, div=0.5, fair=0 | 0.060 | 0.143 | 0.117 | 0.277 | 33542.9531 | 29662.6770 |
| cfg3 | rel=1, rev=0, mar=0, div=0.5, fair=0.5 | 0.054 | 0.108 | 0.113 | 0.193 | 31118.6171 | 27258.8170 |
| cfg4 | rel=1, rev=0, mar=0.5, div=0, fair=0 | 0.045 | 0.148 | 0.097 | 0.287 | 35693.7941 | 30569.6994 |
| cfg5 | rel=1, rev=0, mar=0.5, div=0, fair=0.5 | 0.054 | 0.116 | 0.110 | 0.213 | 31105.7902 | 27530.2438 |
| cfg6 | rel=1, rev=0, mar=0.5, div=0.5, fair=0 | 0.042 | 0.135 | 0.093 | 0.273 | 35886.8587 | 27068.0153 |
| cfg7 | rel=1, rev=0, mar=0.5, div=0.5, fair=0.5 | 0.054 | 0.106 | 0.107 | 0.190 | 30002.7840 | 24515.1248 |
| cfg8 | rel=1, rev=0.5, mar=0, div=0, fair=0 | 0.058 | 0.153 | 0.113 | 0.300 | 55934.2699 | 45070.8523 |
| cfg9 | rel=1, rev=0.5, mar=0, div=0, fair=0.5 | 0.059 | 0.120 | 0.120 | 0.227 | 41625.6177 | 42215.5471 |
| cfg10 | rel=1, rev=0.5, mar=0, div=0.5, fair=0 | 0.056 | 0.142 | 0.103 | 0.287 | 56938.5331 | 44374.9493 |
| cfg11 | rel=1, rev=0.5, mar=0, div=0.5, fair=0.5 | 0.055 | 0.110 | 0.113 | 0.213 | 42133.1125 | 39989.2573 |
| cfg12 | rel=1, rev=0.5, mar=0.5, div=0, fair=0 | 0.056 | 0.147 | 0.117 | 0.297 | 55855.8139 | 44606.4223 |
| cfg13 | rel=1, rev=0.5, mar=0.5, div=0, fair=0.5 | 0.058 | 0.117 | 0.117 | 0.227 | 42665.1631 | 41365.6018 |
| cfg14 | rel=1, rev=0.5, mar=0.5, div=0.5, fair=0 | 0.058 | 0.138 | 0.117 | 0.280 | 56119.5020 | 43326.6693 |
| cfg15 | rel=1, rev=0.5, mar=0.5, div=0.5, fair=0.5 | 0.059 | 0.112 | 0.123 | 0.220 | 42672.4955 | 38189.7597 |
| cfg16 | rel=1, rev=1, mar=0, div=0, fair=0 | 0.054 | 0.122 | 0.110 | 0.250 | 58499.0609 | 53882.8290 |
| cfg17 | rel=1, rev=1, mar=0, div=0, fair=0.5 | 0.062 | 0.110 | 0.127 | 0.217 | 51791.1822 | 50279.4044 |
| cfg18 | rel=1, rev=1, mar=0, div=0.5, fair=0 | 0.051 | 0.116 | 0.103 | 0.240 | 59257.4085 | 54258.5495 |
| cfg19 | rel=1, rev=1, mar=0, div=0.5, fair=0.5 | 0.060 | 0.102 | 0.130 | 0.197 | 52577.9753 | 50084.7592 |
| cfg20 | rel=1, rev=1, mar=0.5, div=0, fair=0 | 0.059 | 0.126 | 0.123 | 0.253 | 57601.7609 | 53369.6345 |
| cfg21 | rel=1, rev=1, mar=0.5, div=0, fair=0.5 | 0.062 | 0.113 | 0.127 | 0.217 | 51314.9499 | 49906.1683 |
| cfg22 | rel=1, rev=1, mar=0.5, div=0.5, fair=0 | 0.056 | 0.120 | 0.113 | 0.250 | 58368.0016 | 53554.4769 |
| cfg23 | rel=1, rev=1, mar=0.5, div=0.5, fair=0.5 | 0.059 | 0.108 | 0.123 | 0.213 | 52098.7228 | 49450.1828 |

## Decomposition

### (a) The CONFOUND — single→multi relevance gap at identical weights

At the relevance-only config (**cfg0**: rel=1, rev=0, mar=0, div=0, fair=0), swapping the single-signal relevance feature for the multi-signal fusion moves nDCG@10 from **0.071** to **0.155** (+118.9%, Δ=+0.084).

Relative to the 4-source RRF baseline (0.153): single rel-only is -53.9%, multi rel-only is +1.0%. The multi signal closes **101.9%** of the single→baseline gap. This is the single-signal-vs-fusion CONFOUND the F4 study flagged — NOT a relevance↔revenue trade-off cost.

### (b) The TRUE trade-off — measured WITH multi-signal relevance

Confound-free: revenue-max config (**cfg18**: rel=1, rev=1, mar=0, div=0.5, fair=0) vs the multi-signal relevance-only config (cfg0). Revenue@10 +68.0% for nDCG@10 -25.2%. Both legs use the SAME fused relevance feature, so this is the GENUINE cost of tilting toward revenue — the single-signal handicap is removed.

For contrast, the NAIVE single-signal trade-off (what F4 reported): revenue-max-single (cfg18) vs single relevance-only — revenue@10 +72.1% for nDCG@10 -28.2%.

### Honest read

The F4 headline "every reranked config has relevance well below the RRF baseline" conflated TWO effects. (a) is the confound: a single-signal relevance feature (cosine-to-modes ≈ retrieval source) cannot match a 4-source fused baseline; fusing NPMI + cohort-popularity into the relevance feature narrows that gap by 101.9%. (b) is the trade-off, now measured on equal footing: the revenue dial costs 25.2% nDCG@10 for +68.0% revenue@10 — the figure the thesis can defend, with the single-signal artifact removed.

