import { describe, test, expect } from "vitest";
import { buildCandidatePool } from "@/thesis/rerank/candidates";

describe("buildCandidatePool", () => {
  const sources = [
    { source: "retrieval", ids: ["a", "b", "c"] },
    { source: "npmi", ids: ["c", "d"] },
    { source: "popular", ids: ["e"] },
  ];

  test("fuses sources by RRF and caps at poolSize", () => {
    const pool = buildCandidatePool(sources, 3);
    expect(pool.length).toBe(3);
  });

  test("tags each candidate with the sources it came from", () => {
    const pool = buildCandidatePool(sources, 10);
    const c = pool.find((p) => p.id === "c")!;
    expect([...c.sources].sort()).toEqual(["npmi", "retrieval"]);
  });

  test("an item in two sources outranks a single-source item of similar rank", () => {
    const pool = buildCandidatePool(sources, 10);
    const cPos = pool.findIndex((p) => p.id === "c");
    const ePos = pool.findIndex((p) => p.id === "e");
    expect(cPos).toBeLessThan(ePos);
  });

  test("returns every unique id when poolSize exceeds total", () => {
    const pool = buildCandidatePool(sources, 100);
    expect([...pool.map((p) => p.id)].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("empty sources → empty pool", () => {
    expect(buildCandidatePool([], 10)).toEqual([]);
  });
});
