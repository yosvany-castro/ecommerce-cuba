# Thesis F6 W8 — Gift-detector robustness

Item space: e1_prod2vec (canonical 64d). E1 universe: 1998. Eval cases: 200 (gift 52, self 148). Label = sim_sessions.intent (SCORE-ONLY — never a detector feature; W8 exception).

The detector is scored on the FAITHFUL session: each test item's ACTUAL browsing session (events → sim_sessions, as `f2-study.ts`). The buyer's own modal gender/age comes from their TRAIN history; cross-cohort = the session's modal gender OR age band differs from that buyer demographic. The production detector (unified-cases GIFT_OPTS) lives at minItems=2, coherence=0.6.

## Why not score on the train history? (degeneracy diagnostic)

`unified-cases.ts` feeds the detector each user's TRAIN items as the session, so the session's modal demographic ALWAYS equals the buyer's own modal demographic → cross-cohort is structurally impossible and the embedded `giftSignal` fires on **0/200** loaded cases. W8 therefore scores the detector on the actual session — the way the F2 pipeline genuinely runs it (0 loaded cases had no resolvable session and were excluded).

## Production detector — threshold sweep (confusion matrix + P/R/F1)

| minItems | coherence | TP | FP | FN | TN | Precision | Recall | F1 | P(predict gift) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.4 | 28 | 46 | 24 | 102 | 0.378 | 0.538 | 0.444 | 0.370 |
| 1 | 0.5 | 28 | 46 | 24 | 102 | 0.378 | 0.538 | 0.444 | 0.370 |
| 1 | 0.6 | 27 | 43 | 25 | 105 | 0.386 | 0.519 | 0.443 | 0.350 |
| 1 | 0.7 | 26 | 38 | 26 | 110 | 0.406 | 0.500 | 0.448 | 0.320 |
| 2 | 0.4 | 28 | 46 | 24 | 102 | 0.378 | 0.538 | 0.444 | 0.370 |
| 2 | 0.5 | 28 | 46 | 24 | 102 | 0.378 | 0.538 | 0.444 | 0.370 |
| 2 ⟵ prod | 0.6 | 27 | 43 | 25 | 105 | 0.386 | 0.519 | 0.443 | 0.350 |
| 2 | 0.7 | 26 | 38 | 26 | 110 | 0.406 | 0.500 | 0.448 | 0.320 |
| 3 | 0.4 | 28 | 46 | 24 | 102 | 0.378 | 0.538 | 0.444 | 0.370 |
| 3 | 0.5 | 28 | 46 | 24 | 102 | 0.378 | 0.538 | 0.444 | 0.370 |
| 3 | 0.6 | 27 | 43 | 25 | 105 | 0.386 | 0.519 | 0.443 | 0.350 |
| 3 | 0.7 | 26 | 38 | 26 | 110 | 0.406 | 0.500 | 0.448 | 0.320 |

Production cell {2,0.6}: precision 0.386, recall 0.519, F1 0.443 (FP=43, FN=25). Best-F1 production cell: {1,0.7} → F1 0.448 (precision 0.406, recall 0.500).

## Proposed heuristic — joint age+gender coherence (NON-LEAKY)

Improvement: require BOTH gender coherence AND age-band coherence (when the session bears age info) before firing; the cross-cohort rule is unchanged (gender OR age vs the buyer). This reads ONLY the session's own item demographics + the buyer's modal demographic — the same feature surface as the production detector. `sim_sessions.intent` is NOT a feature (no leakage).

| minItems | coherence | TP | FP | FN | TN | Precision | Recall | F1 | P(predict gift) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.4 | 28 | 46 | 24 | 102 | 0.378 | 0.538 | 0.444 | 0.370 |
| 1 | 0.5 | 27 | 46 | 25 | 102 | 0.370 | 0.519 | 0.432 | 0.365 |
| 1 | 0.6 | 21 | 38 | 31 | 110 | 0.356 | 0.404 | 0.378 | 0.295 |
| 1 | 0.7 | 20 | 27 | 32 | 121 | 0.426 | 0.385 | 0.404 | 0.235 |
| 2 | 0.4 | 28 | 46 | 24 | 102 | 0.378 | 0.538 | 0.444 | 0.370 |
| 2 | 0.5 | 27 | 46 | 25 | 102 | 0.370 | 0.519 | 0.432 | 0.365 |
| 2 | 0.6 | 21 | 38 | 31 | 110 | 0.356 | 0.404 | 0.378 | 0.295 |
| 2 | 0.7 | 20 | 27 | 32 | 121 | 0.426 | 0.385 | 0.404 | 0.235 |
| 3 | 0.4 | 28 | 46 | 24 | 102 | 0.378 | 0.538 | 0.444 | 0.370 |
| 3 | 0.5 | 27 | 46 | 25 | 102 | 0.370 | 0.519 | 0.432 | 0.365 |
| 3 | 0.6 | 21 | 38 | 31 | 110 | 0.356 | 0.404 | 0.378 | 0.295 |
| 3 | 0.7 | 20 | 27 | 32 | 121 | 0.426 | 0.385 | 0.404 | 0.235 |

## Verdict — does the non-leaky heuristic raise F1?

**At the production thresholds {2,0.6}:** joint F1 0.378 vs production F1 0.443 — -0.064 F1 (does NOT improve). Precision 0.356 vs 0.386; recall 0.404 vs 0.519; FP 38 vs 43.

**Best cell vs best cell:** joint best-F1 0.444 at {1,0.4} vs production best-F1 0.448 at {1,0.7} — -0.004 F1 (does NOT improve).

**Read (honest, negative):** the joint heuristic does NOT raise F1 over the production detector on this dataset — the extra age-coherence requirement removes true-positive gift sessions (age-diffuse but genuinely cross-gender) faster than it removes false positives. The simpler gender-only detector stands; reported with the same weight as a positive result (F6 honesty mandate).

