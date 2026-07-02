import { describe, it, expect } from "vitest";
import { applyPopularityPrior } from "@/sectors/d-personalization/ranking/pop-prior";

describe("applyPopularityPrior", () => {
  const pop = (m: Record<string, number>) => (id: string) => m[id] ?? 0;

  it("lifts a popular near-match above a slightly-more-similar cold item (the exp-I fix)", () => {
    // The exact failure the audit measured: cosine alone ranks the cold item
    // first and the best-seller is buried. The prior must flip that.
    const out = applyPopularityPrior(
      [
        { id: "cold", score: 0.6 },
        { id: "bestseller", score: 0.5 },
      ],
      pop({ bestseller: 100, cold: 0 }),
    );
    expect(out.map((x) => x.id)).toEqual(["bestseller", "cold"]);
  });

  it("never manufactures relevance from popularity alone: non-positive scores stay at 0", () => {
    const out = applyPopularityPrior(
      [
        { id: "irrelevant-hit", score: -0.2 },
        { id: "barely-relevant", score: 0.01 },
      ],
      pop({ "irrelevant-hit": 10_000 }),
    );
    expect(out[0].id).toBe("barely-relevant");
    expect(out.find((x) => x.id === "irrelevant-hit")?.score).toBe(0);
  });

  it("is monotone in popularity at equal similarity", () => {
    const out = applyPopularityPrior(
      [
        { id: "a", score: 0.4 },
        { id: "b", score: 0.4 },
        { id: "c", score: 0.4 },
      ],
      pop({ a: 1, b: 50, c: 10 }),
    );
    expect(out.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("strength=0 disables the prior (clamped pure-similarity order)", () => {
    const out = applyPopularityPrior(
      [
        { id: "cold", score: 0.6 },
        { id: "bestseller", score: 0.5 },
      ],
      pop({ bestseller: 100 }),
      0,
    );
    expect(out.map((x) => x.id)).toEqual(["cold", "bestseller"]);
  });

  it("higher strength leans further into popularity", () => {
    // At strength 1 similarity wins (0.9·ln3 ≈ 0.99 > 0.5·ln5 ≈ 0.80);
    // at strength 3 popularity wins (0.9·ln3³ ≈ 1.19 < 0.5·ln5³ ≈ 2.08).
    const cands = [
      { id: "similar", score: 0.9 },
      { id: "popular", score: 0.5 },
    ];
    const popularity = pop({ similar: 1, popular: 3 });
    expect(applyPopularityPrior(cands, popularity, 1)[0].id).toBe("similar");
    expect(applyPopularityPrior(cands, popularity, 3)[0].id).toBe("popular");
  });

  it("breaks score ties by ascending id (deterministic permutation)", () => {
    const out = applyPopularityPrior(
      [
        { id: "z", score: 0.5 },
        { id: "a", score: 0.5 },
      ],
      () => 7,
    );
    expect(out.map((x) => x.id)).toEqual(["a", "z"]);
  });

  it("treats negative popularity counts as 0 instead of NaN-ing the score", () => {
    const out = applyPopularityPrior([{ id: "a", score: 0.5 }], () => -3);
    expect(out[0].score).toBeCloseTo(0.5 * Math.log(2), 12);
  });
});
