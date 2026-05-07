import { describe, test, expect } from "vitest";
import { rrfFuse, RRF_K0, type RankedProduct } from "@/sectors/c-search/retrieve/rrf";

const r = (id: string, rank: number): RankedProduct => ({ id, rank, score: 1 / rank });

describe("rrfFuse", () => {
  test("product in both lists at rank 1: rrf_score = 2/(60+1)", () => {
    const out = rrfFuse([[r("A", 1)], [r("A", 1)]]);
    expect(out).toHaveLength(1);
    expect(out[0].rrf_score).toBeCloseTo(2 / 61, 6);
    expect(out[0].ranks).toEqual({ bm25: 1, cosine: 1 });
  });

  test("product only in BM25 at rank 1: rrf_score = 1/61", () => {
    const out = rrfFuse([[r("A", 1)], []]);
    expect(out[0].rrf_score).toBeCloseTo(1 / 61, 6);
    expect(out[0].ranks).toEqual({ bm25: 1 });
  });

  test("symmetry: BM25 1 + cosine 5 == BM25 5 + cosine 1 (commutative)", () => {
    const out = rrfFuse([
      [r("A", 1), r("B", 5)],
      [r("B", 1), r("A", 5)],
    ]);
    expect(out[0].rrf_score).toBeCloseTo(out[1].rrf_score, 6);
    expect([out[0].id, out[1].id].sort()).toEqual(["A", "B"]);
  });

  test("k0=60 changes scores vs k0=0 (mutation guard)", () => {
    const r60 = rrfFuse([[r("A", 1)]], 60);
    const r0 = rrfFuse([[r("A", 1)]], 0);
    expect(r60[0].rrf_score).toBeCloseTo(1 / 61, 6);
    expect(r0[0].rrf_score).toBeCloseTo(1 / 1, 6);
    expect(r60[0].rrf_score).not.toBe(r0[0].rrf_score);
  });

  test("empty inputs → empty output", () => {
    expect(rrfFuse([[], []])).toEqual([]);
    expect(rrfFuse([])).toEqual([]);
  });

  test("single-list ranking passes through with no fusion", () => {
    const out = rrfFuse([[r("A", 1), r("B", 2), r("C", 3)]]);
    expect(out.map((p) => p.id)).toEqual(["A", "B", "C"]);
    expect(out[0].rrf_score).toBeCloseTo(1 / 61, 6);
  });

  test("3 in BM25 + 1 distinct in cosine: 4 fused, sorted by score", () => {
    const out = rrfFuse([
      [r("A", 1), r("B", 2), r("C", 3)],
      [r("D", 1)],
    ]);
    expect(out).toHaveLength(4);
    expect(out.map((p) => p.id).sort()).toEqual(["A", "B", "C", "D"]);
    expect(out[0].rrf_score).toBeCloseTo(1 / 61, 6);
    expect(out[1].rrf_score).toBeCloseTo(1 / 61, 6);
    expect(out[2].rrf_score).toBeCloseTo(1 / 62, 6);
    expect(out[3].rrf_score).toBeCloseTo(1 / 63, 6);
  });

  test("RRF_K0 const is 60", () => {
    expect(RRF_K0).toBe(60);
  });
});
