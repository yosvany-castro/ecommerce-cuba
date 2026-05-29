import { describe, test, expect } from "vitest";
import { mmrSelect } from "@/sectors/d-personalization/retrieve/mmr";

/**
 * AUDIT FINDING (P2) — MMR treats a missing embedding as "maximally diverse".
 *
 * mmr.ts:57-65  maxSim starts at 0; if a candidate has no embedding
 * (`normFor` returns null) the similarity loop is skipped and maxSim stays 0,
 * so the candidate receives ZERO diversity penalty. Likewise a SELECTED item
 * with no embedding (mmr.ts:61 `if (!selN) continue;`) exerts zero repulsion.
 *
 * Consequence: a candidate that is in fact a near-duplicate of an already-picked
 * item, but whose embedding happens to be absent from the `embeddings` map, is
 * NOT penalised and gets surfaced — defeating diversification. In production the
 * embeddings map is built by feed.ts:fetchProductEmbeddings, which only returns
 * rows WHERE embedding IS NOT NULL, so co-occurrence / popular candidates that
 * lack an embedding routinely hit this path. For a reseller pulling from
 * Amazon/AliExpress, missing-embedding products are exactly the ones we know the
 * least about — and MMR systematically favours them.
 *
 * The control case (duplicate WITH embedding) passes; the bug case (the SAME
 * duplicate WITHOUT embedding) demonstrates the asymmetry.
 */
describe("AUDIT: MMR missing-embedding escapes the diversity penalty", () => {
  // rrf: A top, B a near/exact duplicate of A (2nd), C orthogonal/diverse (3rd)
  const candidates = [
    { id: "A", rrf_score: 0.05 },
    { id: "B", rrf_score: 0.04 },
    { id: "C", rrf_score: 0.03 },
  ];

  test("CONTROL: a duplicate WITH an embedding is correctly suppressed", () => {
    const embeddings = new Map<string, number[]>([
      ["A", [1, 0, 0]],
      ["B", [1, 0, 0]], // exact duplicate of A
      ["C", [0, 1, 0]], // orthogonal / diverse
    ]);
    const out = mmrSelect({ candidates, embeddings, k: 3 }); // λ=0.7
    expect(out[0].id).toBe("A");
    // B is penalised (cosine 1.0 to A) so the diverse C is chosen second.
    expect(out[1].id).toBe("C");
  });

  test("BUG: the same duplicate WITHOUT an embedding is surfaced instead of the diverse item", () => {
    // B is the SAME duplicate product, but its embedding is missing from the map
    // (e.g. not yet embedded in the catalogue). It is NOT in `embeddings`.
    const embeddings = new Map<string, number[]>([
      ["A", [1, 0, 0]],
      ["C", [0, 1, 0]], // diverse item still has its embedding
    ]);
    const out = mmrSelect({ candidates, embeddings, k: 3 }); // λ=0.7
    expect(out[0].id).toBe("A");
    // Diversity should still suppress the duplicate B in favour of C — a missing
    // embedding must not be rewarded as if the item were maximally diverse.
    //
    // Actual on main: score(B)=0.7·0.04-0 = 0.028 beats
    //                 score(C)=0.7·0.03-0 = 0.021  → duplicate B wins.
    expect(out[1].id).toBe("C");
  });
});
