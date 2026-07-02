import { describe, it, expect } from "vitest";
import { rrfFuse, type RankedList } from "@/sectors/d-personalization/retrieve/rrf";

const list = (source: string, ids: string[], weight?: number): RankedList => ({
  source,
  items: ids.map((id, i) => ({ id, rank: i + 1 })),
  ...(weight !== undefined ? { weight } : {}),
});

describe("rrfFuse per-list weight", () => {
  it("default weight 1 keeps the historical unweighted behaviour", () => {
    const unweighted = rrfFuse([list("a", ["x", "y"]), list("b", ["y", "z"])]);
    const explicit = rrfFuse([list("a", ["x", "y"], 1), list("b", ["y", "z"], 1)]);
    expect(explicit).toEqual(unweighted);
    // y appears in both lists → wins over single-list items.
    expect(unweighted[0].id).toBe("y");
  });

  it("a weighted list resists dilution by extra lists (the cross-sell guarantee)", () => {
    // "funda" is rank-1 ONLY in the cross-sell list; "telefono" appears in two
    // other lists (ranks 1 and 3). Unweighted, two-list presence buries the
    // cross-sell item (1/61 < 1/61 + 1/63); weight 2 restores it
    // (2/61 = 0.0328 > 0.0325).
    const others = [
      list("modes", ["telefono", "a1"]),
      list("views-categories", ["a2", "a3", "telefono"]),
    ];
    const unweighted = rrfFuse([list("cooccurrence", ["funda"]), ...others]);
    const weighted = rrfFuse([list("cooccurrence", ["funda"], 2), ...others]);
    const posOf = (fused: { id: string }[], id: string) => fused.findIndex((f) => f.id === id);
    expect(posOf(unweighted, "funda")).toBeGreaterThan(posOf(unweighted, "telefono"));
    expect(posOf(weighted, "funda")).toBeLessThan(posOf(weighted, "telefono"));
  });
});
