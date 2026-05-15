import { describe, test, expect } from "vitest";
import {
  rrfFuse,
  RRF_K0,
  type RankedList,
} from "@/sectors/d-personalization/retrieve/rrf";

describe("rrfFuse (d-personalization)", () => {
  test("RRF_K0 is 60", () => {
    expect(RRF_K0).toBe(60);
  });

  test("product in top-1 of 3 lists outranks product in top-1 of 1 list", () => {
    const lists: RankedList[] = [
      { source: "A", items: [{ id: "X", rank: 1 }, { id: "Y", rank: 2 }] },
      { source: "B", items: [{ id: "X", rank: 1 }, { id: "Z", rank: 2 }] },
      { source: "C", items: [{ id: "X", rank: 1 }, { id: "W", rank: 2 }] },
    ];
    const fused = rrfFuse(lists, 60);
    expect(fused[0].id).toBe("X");
    expect(fused[0].sources).toEqual(["A", "B", "C"]);
  });

  test("rank 1 dominates rank 19 within same list", () => {
    const lists: RankedList[] = [
      {
        source: "A",
        items: Array.from({ length: 20 }, (_, i) => ({ id: `id-${i}`, rank: i + 1 })),
      },
    ];
    const fused = rrfFuse(lists, 60);
    expect(fused[0].id).toBe("id-0");
    expect(fused[fused.length - 1].id).toBe("id-19");
  });

  test("two single-source rank-1 items: same score", () => {
    const lists: RankedList[] = [
      { source: "A", items: [{ id: "P", rank: 1 }] },
      { source: "B", items: [{ id: "Q", rank: 1 }] },
    ];
    const fused = rrfFuse(lists, 60);
    expect(fused.length).toBe(2);
    expect(fused[0].rrf_score).toBeCloseTo(1 / 61, 6);
    expect(fused[1].rrf_score).toBeCloseTo(1 / 61, 6);
  });

  test("empty lists return empty array", () => {
    expect(rrfFuse([], 60)).toEqual([]);
    expect(rrfFuse([{ source: "A", items: [] }], 60)).toEqual([]);
  });
});
