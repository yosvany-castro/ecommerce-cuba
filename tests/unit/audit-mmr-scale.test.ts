import { describe, test, expect } from "vitest";
import { mmrSelect } from "@/sectors/d-personalization/retrieve/mmr";

/**
 * AUDIT FINDING (P1) — MMR scale mismatch: rrf_score vs cosine.
 *
 * mmr.ts:66  score = λ·rrf_score - (1-λ)·maxSim
 *
 * The relevance term uses `rrf_score`, which in production comes from
 * rrfFuse (rrf.ts:30): 1/(k0 + rank) with k0=60. So a candidate ranked #1 in
 * one source scores ~1/61 ≈ 0.0164; ranked #1 in all 3 sources ≈ 3/61 ≈ 0.049;
 * ranked low ≈ 1/110 ≈ 0.009. Realistic rrf_score ∈ ~[0.008, 0.05].
 *
 * The diversity term uses cosine ∈ [0, 1]. With λ=0.7 the relevance term tops
 * out at 0.7·0.05 ≈ 0.035 while the diversity term reaches 0.3·1.0 = 0.30 —
 * roughly a 10x scale gap. Carbonell & Goldstein's MMR assumes BOTH terms share
 * the same scale (cosine for both). Mixing a ~0.01 relevance scale with a ~1.0
 * similarity scale means the documented λ=0.7 behaves like an effective λ≈0.04:
 * diversity dominates and the fusion ranking is almost ignored after pick #1.
 *
 * The existing unit test (mmr-personalization.test.ts:46) hid this by feeding
 * rrf_score values of 1.0/0.95/0.5 — values that never occur in production.
 *
 * This test uses REALISTIC rrf_score values. With λ=0.7 a far-more-relevant
 * candidate (B, ~3.6x the rrf of C) that is only MODERATELY similar to the first
 * pick should still be selected over a near-irrelevant but orthogonal candidate
 * (C). A correctly-scaled MMR (relevance normalised to [0,1]) picks B. The
 * current implementation picks C.
 *
 * EXPECTED ON MAIN: FAILS (out[1] === "C", not "B").
 */
describe("AUDIT: MMR rrf_score/cosine scale mismatch", () => {
  test("λ=0.7 should keep the much-more-relevant candidate over a barely-relevant orthogonal one", () => {
    // Realistic RRF scores (k0=60):
    //   A: rank #1 in all 3 sources           → 3/61 ≈ 0.0492  (top fused item)
    //   B: rank #1 in 2 sources               → 2/61 ≈ 0.0328  (2nd most relevant)
    //   C: rank #50 in 1 source               → 1/110 ≈ 0.0091 (least relevant)
    const candidates = [
      { id: "A", rrf_score: 3 / 61 },
      { id: "B", rrf_score: 2 / 61 },
      { id: "C", rrf_score: 1 / 110 },
    ];
    // A and B moderately similar (cosine 0.6); C orthogonal to A (cosine 0).
    const embeddings = new Map<string, number[]>([
      ["A", [1, 0, 0]],
      ["B", [0.6, 0.8, 0]], // |·|=1, cosine(A,B)=0.6
      ["C", [0, 0, 1]], // cosine(A,C)=0
    ]);

    const out = mmrSelect({ candidates, embeddings, k: 3 }); // default λ=0.7

    // Sanity: the top fused item is always picked first (pure rrf_score).
    expect(out[0].id).toBe("A");

    // B is 3.6x more relevant than C (rrf 0.0328 vs 0.0091) and only moderately
    // similar to A. At λ=0.7 (relevance-weighted) B must be picked second.
    //
    // Actual on main: score(C)=0.7·0.0091-0 ≈ +0.0064 beats
    //                 score(B)=0.7·0.0328-0.3·0.6 ≈ -0.157  → C wins.
    expect(out[1].id).toBe("B");
  });
});
