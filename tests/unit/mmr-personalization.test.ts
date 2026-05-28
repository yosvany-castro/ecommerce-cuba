import { describe, test, expect } from "vitest";
import {
  mmrSelect,
  MMR_LAMBDA,
} from "@/sectors/d-personalization/retrieve/mmr";
import { normalize, cosine } from "@/lib/math";

describe("mmrSelect", () => {
  test("MMR_LAMBDA is 0.7", () => {
    expect(MMR_LAMBDA).toBe(0.7);
  });

  test("λ=1.0 (pure relevance) → output ordered by rrf_score", () => {
    const candidates = [
      { id: "a", rrf_score: 0.9 },
      { id: "b", rrf_score: 0.5 },
      { id: "c", rrf_score: 0.7 },
    ];
    const embeddings = new Map([
      ["a", [1, 0, 0]],
      ["b", [0, 1, 0]],
      ["c", [0, 0, 1]],
    ]);
    const out = mmrSelect({ candidates, embeddings, k: 3, lambda: 1.0 });
    expect(out.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  test("λ=0.0 (pure diversity) → selects orthogonal directions after first pick", () => {
    const candidates = [
      { id: "a", rrf_score: 0.9 },
      { id: "a2", rrf_score: 0.85 }, // very similar to a
      { id: "b", rrf_score: 0.5 }, // orthogonal
    ];
    const embeddings = new Map([
      ["a", normalize([1, 0, 0])],
      ["a2", normalize([0.99, 0.01, 0])],
      ["b", normalize([0, 1, 0])],
    ]);
    const out = mmrSelect({ candidates, embeddings, k: 2, lambda: 0.0 });
    expect(out[0].id).toBe("a");
    // λ=0.0 picks the candidate maximally distant from selected.
    // b (orthogonal) wins over a2 (very similar to a).
    expect(out[1].id).toBe("b");
  });

  test("λ=0.7 balanced: similar high-score wins thin over orthogonal mid-score", () => {
    const candidates = [
      { id: "a", rrf_score: 1.0 },
      { id: "a2", rrf_score: 0.95 },
      { id: "b", rrf_score: 0.5 },
    ];
    const embeddings = new Map([
      ["a", normalize([1, 0, 0])],
      ["a2", normalize([0.99, 0.01, 0])],
      ["b", normalize([0, 1, 0])],
    ]);
    const out = mmrSelect({ candidates, embeddings, k: 2, lambda: 0.7 });
    expect(out[0].id).toBe("a");
    // score(a2) = 0.7*0.95 - 0.3*~1 ≈ 0.368
    // score(b)  = 0.7*0.50 - 0.3*0   = 0.35
    // a2 wins by ~0.018
    expect(out[1].id).toBe("a2");
  });

  test("empty candidates → empty output", () => {
    expect(
      mmrSelect({ candidates: [], embeddings: new Map(), k: 10 }),
    ).toEqual([]);
  });

  test("k > candidates.length → returns candidates.length items", () => {
    const out = mmrSelect({
      candidates: [{ id: "a", rrf_score: 1 }],
      embeddings: new Map([["a", [1, 0]]]),
      k: 5,
    });
    expect(out.length).toBe(1);
  });

  test("missing embedding → item still considered with sim=0 contribution", () => {
    const out = mmrSelect({
      candidates: [
        { id: "a", rrf_score: 1 },
        { id: "b", rrf_score: 0.5 },
      ],
      embeddings: new Map([["a", [1, 0]]]),
      k: 2,
    });
    expect(out.length).toBe(2);
    expect(out[0].id).toBe("a");
  });

  test("mmr_score preserves rrf_score for first pick", () => {
    const out = mmrSelect({
      candidates: [{ id: "a", rrf_score: 0.42 }],
      embeddings: new Map([["a", [1, 0]]]),
      k: 1,
    });
    expect(out[0].mmr_score).toBe(0.42);
  });
});
