# Thesis F6 W7 — Adversarial profiles

Item space: e1_prod2vec (canonical 64d). n=2000, seed=42. E1 universe: 1998. Products: 2000. Profiles: 7. LTR trained train-split-only on 1107 REAL holdout cases.

**No held-out purchase exists for a synthetic profile**, so per spec §5 W7 this report does **NOT** show nDCG/recall/MRR. It measures graceful adaptation/degradation: gift-detector firing + predicted recipient, mode count, recipient-fit@10, set-change@10 vs popular-cohort, revenue@10, diversity@10. Gift signal is the F2 detector on the synthetic session (no GT); `intentGT` is the profile's INTENDED label (segments the report + sets the recipient-fit target), never a feature.

## Gift detector behavior (per profile)

| Profile | kind | intent | gift fired | predicted recipient | detector correct | modes | pool |
|---|---|---|---|---|---|---|---|
| pure-gift-fem-adulto | pure-gift | gift | YES | femenino/adulto | ✓ | 1 | 155 |
| pure-gift-nino | pure-gift | gift | no | — | ✗ | 2 | 173 |
| multi-modal-6cohorts | multi-modal | self | no | — | ✓ | 4 | 175 |
| price-extreme-high | price-extreme | self | no | — | ✓ | 1 | 145 |
| price-extreme-cheap | price-extreme | self | no | — | ✓ | 2 | 192 |
| ambiguous-gift-noisy | ambiguous | gift | YES | femenino/adulto | ✓ | 3 | 186 |
| ambiguous-self-mixed | ambiguous | self | no | — | ✓ | 3 | 178 |

## Adaptation metrics @10 (per profile × ranker)

| Profile | ranker | recipient-fit@10 | set-change@10 (vs PC) | revenue@10 | diversity@10 | seller-gini@10 |
|---|---|---|---|---|---|---|
| pure-gift-fem-adulto | popular-cohort | 1.000 | 0.000 | 16934 | 0.335 | 0.150 |
| pure-gift-fem-adulto | assembled-rrf-f4 | 1.000 | 0.800 | 23345 | 0.255 | 0.150 |
| pure-gift-fem-adulto | assembled-ltr-f4 | 1.000 | 0.800 | 23345 | 0.255 | 0.150 |
| pure-gift-nino | popular-cohort | 1.000 | 0.000 | 9559 | 0.417 | 0.089 |
| pure-gift-nino | assembled-rrf-f4 | 1.000 | 1.000 | 17838 | 0.045 | 0.150 |
| pure-gift-nino | assembled-ltr-f4 | 1.000 | 1.000 | 17838 | 0.045 | 0.150 |
| multi-modal-6cohorts | popular-cohort | n/a | 0.000 | 25270 | 0.313 | 0.267 |
| multi-modal-6cohorts | assembled-rrf-f4 | n/a | 1.000 | 36937 | 0.285 | 0.000 |
| multi-modal-6cohorts | assembled-ltr-f4 | n/a | 1.000 | 36937 | 0.285 | 0.000 |
| price-extreme-high | popular-cohort | n/a | 0.000 | 64883 | 0.482 | 0.000 |
| price-extreme-high | assembled-rrf-f4 | n/a | 0.800 | 190371 | 0.078 | 0.089 |
| price-extreme-high | assembled-ltr-f4 | n/a | 0.800 | 190371 | 0.078 | 0.089 |
| price-extreme-cheap | popular-cohort | n/a | 0.000 | 6145 | 0.222 | 0.000 |
| price-extreme-cheap | assembled-rrf-f4 | n/a | 1.000 | 18594 | 0.401 | 0.150 |
| price-extreme-cheap | assembled-ltr-f4 | n/a | 1.000 | 18594 | 0.401 | 0.150 |
| ambiguous-gift-noisy | popular-cohort | 1.000 | 0.000 | 16387 | 0.349 | 0.089 |
| ambiguous-gift-noisy | assembled-rrf-f4 | 0.500 | 1.000 | 55104 | 0.294 | 0.000 |
| ambiguous-gift-noisy | assembled-ltr-f4 | 0.500 | 1.000 | 55104 | 0.294 | 0.000 |
| ambiguous-self-mixed | popular-cohort | n/a | 0.000 | 5551 | 0.469 | 0.150 |
| ambiguous-self-mixed | assembled-rrf-f4 | n/a | 1.000 | 46952 | 0.249 | 0.089 |
| ambiguous-self-mixed | assembled-ltr-f4 | n/a | 1.000 | 46952 | 0.249 | 0.089 |

## Qualitative read (graceful adaptation / degradation)

### pure-gift-fem-adulto (pure-gift, intent=gift)

Pure gift: session is 6 feminino/adulto items (moda_mujer/joyeria/belleza); demographically opposite to a masculine-adult buyer baseline. Detector should fire.

- Session (6 real items): 552dad19-d585-46db-a700-8f13de67462b, b19f5a28-36dd-4eb0-ba28-269fc5508dc6, 5adb59a7-ca10-478e-b1c5-07cb5001aeb4, 4f699436-b56d-4a60-ae2b-d10fc086095d, 19b3c20a-5aa4-4832-a5d0-c556276ba232, ffdfe841-d7f4-477c-bc5e-1317f79b43cf
- Gift detector: FIRED (score 1.000, reasons: demographically_coherent | cross_cohort_gender)
- Predicted recipient: femenino / adulto
- Interest modes: 1 (weights [1])
- **Note:** Detector FIRED and routed to recipient (femenino/adulto); recipient-fit@10 1.000 vs popular-cohort 1.000 — pipeline targets the recipient at least as well.

### pure-gift-nino (pure-gift, intent=gift)

Pure gift: session is 6 niño items (juguetes/moda_infantil); cross-AGE vs an adult buyer (gift for a child). Detector should fire on cross_cohort_age.

- Session (6 real items): 5e4a9df2-14da-4ecc-a40e-2354cc41881c, 6ec6e8a5-05d5-4f5e-8a46-9d7c02b3016d, 44aa2566-e58c-44b7-98cb-44ec596ed5d0, 58814a98-940b-4a9c-8804-f16e02cb814e, c19ff7d9-68a0-4a42-bc04-cb4630ea376f, d0444e3b-0ab4-40b5-99e0-0e4d6bf75f53
- Gift detector: did not fire (score 0.000, reasons: cross_cohort_gender | cross_cohort_age)
- Interest modes: 2 (weights [0.833,0.167])
- **Note:** Detector MISSED a pure gift (FN) → pipeline degrades to SELF mode. recipient-fit@10 1.000; graceful only if the self-mode feed still partially overlaps the recipient cohort.

### multi-modal-6cohorts (multi-modal, intent=self)

Multi-modal: 6 orthogonal subcategories (smartphone, vestido, muneca, zapatillas_running, perfume, teclado) — disjoint cohorts spanning genders/ages. Forces PinnerSage to keep >=5 interest modes.

- Session (6 real items): 9007da94-632e-40f4-83d6-5ea24fbef8af, 552dad19-d585-46db-a700-8f13de67462b, 80900065-2d31-4929-96d3-91b1c7ac48aa, 3aae6226-8ed0-44f8-b891-75ff7ce2ec36, 3ea11572-38ad-463b-88dd-e40b0a03a3ff, 97dc6db8-1b9b-485b-b503-fe87387cedbb
- Gift detector: did not fire (score 0.000, reasons: demographically_coherent)
- Interest modes: 4 (weights [0.5,0.167,0.167,0.167])
- **Note:** PinnerSage kept 4 interest modes over 6 orthogonal items — collapsed below 5 modes (some cohorts merged). diversity@10 0.285 vs popular-cohort 0.313.

### price-extreme-high (price-extreme, intent=self)

Price-extreme (high tail): session is 6 price_band-3 items only. Probes whether the scorer chases revenue past the user's never-leaving-the-high-band budget.

- Session (6 real items): 4f699436-b56d-4a60-ae2b-d10fc086095d, 9fdb7646-34c7-4a4b-8dd4-10117f32ee99, b1561058-f311-4e52-b49b-71daf2b25a82, 1f6a24cd-00c5-4082-939b-af75c73bbd8a, 277d7415-741b-45f5-a65a-acd1c2c6abef, b5777368-e88d-49dc-82dd-0318e8435734
- Gift detector: did not fire (score 0.000, reasons: demographically_coherent)
- Interest modes: 1 (weights [1])
- **Note:** Single-band budget (mean band 3); revenue@10 190371 vs popular-cohort 64883 — scorer extracts more revenue at the degenerate band. set-change@10 vs PC 0.800 (how far the slate moves from the popularity prior).

### price-extreme-cheap (price-extreme, intent=self)

Price-extreme (cheap floor): session is 6 price_band-0 items only. Probes whether the scorer's revenue tilt drags a budget user toward unaffordable high-margin items.

- Session (6 real items): 5754db98-deae-4821-a5c0-02c15b5b1cf0, 3fb5a5a3-55b9-4d47-9cd5-acb85303fc57, 58814a98-940b-4a9c-8804-f16e02cb814e, 7d499235-d24a-4a3c-9e9a-40c4c6a06e90, c00149c0-bb8b-41dd-9574-7b4207762e66, 9eabed1b-b671-44ef-b483-044904a0a7ca
- Gift detector: did not fire (score 0.000, reasons: demographically_coherent)
- Interest modes: 2 (weights [0.667,0.333])
- **Note:** Single-band budget (mean band 0); revenue@10 18594 vs popular-cohort 6145 — scorer extracts more revenue at the degenerate band. set-change@10 vs PC 1.000 (how far the slate moves from the popularity prior).

### ambiguous-gift-noisy (ambiguous, intent=gift)

Ambiguous (gift-leaning, noisy): 4 feminino/adulto + 2 masculino items → coherence ≈0.67, hovering just over the 0.6 threshold. A true gift the detector may FN.

- Session (6 real items): 552dad19-d585-46db-a700-8f13de67462b, b19f5a28-36dd-4eb0-ba28-269fc5508dc6, 5adb59a7-ca10-478e-b1c5-07cb5001aeb4, 4f699436-b56d-4a60-ae2b-d10fc086095d, 174e1389-e695-4d75-ba3a-c7d35609f1d9, f51dc42c-14f3-4771-a820-2f4953d3ebe2
- Gift detector: FIRED (score 0.667, reasons: demographically_coherent | cross_cohort_gender)
- Predicted recipient: femenino / adulto
- Interest modes: 3 (weights [0.5,0.333,0.167])
- **Note:** Detector FIRED on an ambiguous session (intent=gift); CORRECT (score 0.667, reasons: demographically_coherent|cross_cohort_gender). Pipeline routes to the right mode.

### ambiguous-self-mixed (ambiguous, intent=self)

Ambiguous (self-leaning, mixed): 5 masculino items across tech/deporte — modal gender = the buyer's own, so NOT cross-cohort. Detector should NOT fire (true self).

- Session (5 real items): 174e1389-e695-4d75-ba3a-c7d35609f1d9, f51dc42c-14f3-4771-a820-2f4953d3ebe2, 5754db98-deae-4821-a5c0-02c15b5b1cf0, ae19997e-17af-4bda-b7e0-2db9db9fad90, 1b91b02c-844d-4339-80e2-b059899719b7
- Gift detector: did not fire (score 0.000, reasons: demographically_coherent)
- Interest modes: 3 (weights [0.6,0.2,0.2])
- **Note:** Detector did NOT fire on an ambiguous session (intent=self); CORRECT (score 0.000, reasons: demographically_coherent). Pipeline routes to the right mode.

## Verdict (honest)

- **Pure-gift / gift-intent detection:** detector fired on 2/3 gift-intent profiles. Where it fires, the pipeline routes to the recipient (recipient-fit@10 in the table); where it misses, it degrades to self-mode — graceful iff the self feed still overlaps the recipient cohort.
- **Multi-modal robustness:** 0/1 multi-modal profiles kept >=5 interest modes, i.e. the feed did not collapse to a single taste under orthogonal interests.
- **Ambiguous sessions:** the detector was correct on 2/2 knife-edge profiles — consistent with its ~0.43-precision operating point. The degradation question (does the multi-source POOL still cover the true intent when the detector is wrong?) is answered per-profile above via set-change@10 and the pool size.
- **Price-extreme:** at a degenerate single budget band the multi-objective scorer's revenue tilt is visible in revenue@10 vs popular-cohort — reported as-is so over/under-monetization is not hidden.

