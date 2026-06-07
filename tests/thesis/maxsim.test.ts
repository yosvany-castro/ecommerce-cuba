import { describe, test, expect } from "vitest";
import { maxSim, maxSimRanker } from "@/thesis/embedders/maxsim";

describe("maxSim", () => {
  test("sum over query chunks of best doc-chunk cosine", () => {
    const q = [[1, 0], [0, 1]];
    const d = [[1, 0], [0, 1]];
    expect(maxSim(q, d)).toBeCloseTo(2, 9);
  });
  test("a doc matching only one query chunk scores ~1", () => {
    expect(maxSim([[1, 0], [0, 1]], [[1, 0]])).toBeCloseTo(1, 9);
  });
  test("empty query or doc → 0", () => {
    expect(maxSim([], [[1, 0]])).toBe(0);
    expect(maxSim([[1, 0]], [])).toBe(0);
  });
});

describe("maxSimRanker", () => {
  test("ranks the doc whose chunks best cover the query first", () => {
    const itemChunks = new Map<string, number[][]>([
      ["doc1", [[1, 0], [0, 1]]],
      ["doc2", [[1, 0]]],
      // off-axis doc: anti-aligned to both query chunks → lowest MaxSim.
      // Kept 2-dim to match the query space (cosineSim now rejects mismatches).
      ["doc3", [[-1, -1]]],
    ]);
    const r = maxSimRanker(itemChunks, () => [[1, 0], [0, 1]]);
    const out = r.rank({ userVector: [], cohort: null }, [
      { id: "doc1", popularity: 0, vector: [] },
      { id: "doc2", popularity: 0, vector: [] },
      { id: "doc3", popularity: 0, vector: [] },
    ]);
    expect(out[0]).toBe("doc1");
    expect(out[2]).toBe("doc3");
  });

  test("empty query → all scores 0 → deterministic id-ascending order", () => {
    const itemChunks = new Map<string, number[][]>([
      ["z", [[1, 0]]], ["a", [[0, 1]]], ["m", [[1, 1]]],
    ]);
    const r = maxSimRanker(itemChunks, () => []);
    const out = r.rank({ userVector: [], cohort: null }, [
      { id: "z", popularity: 0, vector: [] },
      { id: "a", popularity: 0, vector: [] },
      { id: "m", popularity: 0, vector: [] },
    ]);
    expect(out).toEqual(["a", "m", "z"]);
  });
});
