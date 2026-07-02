import { describe, test, expect } from "vitest";
import { multiModeRank } from "@/thesis/multivector/retrieve";
import type { UserMode } from "@/thesis/multivector/modes";
import type { RankItem } from "@/thesis/types";

describe("multiModeRank", () => {
  const candidates: RankItem[] = [
    { id: "x1", popularity: 0, vector: [1, 0, 0] },
    { id: "x2", popularity: 0, vector: [0.9, 0.1, 0] },
    { id: "y1", popularity: 0, vector: [0, 1, 0] },
    { id: "y2", popularity: 0, vector: [0, 0.9, 0.1] },
    { id: "z1", popularity: 0, vector: [0, 0, 1] },
  ];

  test("two equal-weight modes surface BOTH tastes near the top (not a compromise)", () => {
    const modes: UserMode[] = [
      { medoid: [1, 0, 0], weight: 0.5, size: 5 },
      { medoid: [0, 1, 0], weight: 0.5, size: 5 },
    ];
    const out = multiModeRank({ modes, candidates, perModeK: 3 });
    const top4 = out.slice(0, 4);
    expect(top4.some((id) => id.startsWith("x"))).toBe(true);
    expect(top4.some((id) => id.startsWith("y"))).toBe(true);
  });

  test("a single mode ranks that taste first", () => {
    const modes: UserMode[] = [{ medoid: [1, 0, 0], weight: 1, size: 5 }];
    const out = multiModeRank({ modes, candidates, perModeK: 3 });
    expect(out[0]).toBe("x1");
  });

  test("returns every candidate id exactly once", () => {
    const modes: UserMode[] = [
      { medoid: [1, 0, 0], weight: 0.7, size: 7 },
      { medoid: [0, 1, 0], weight: 0.3, size: 3 },
    ];
    const out = multiModeRank({ modes, candidates, perModeK: 2 });
    expect([...out].sort()).toEqual(["x1", "x2", "y1", "y2", "z1"]);
  });

  test("no modes → empty", () => {
    expect(multiModeRank({ modes: [], candidates, perModeK: 3 })).toEqual([]);
  });

  test("an item in both modes' quotas still yields a permutation (no dup/missing)", () => {
    const modes: UserMode[] = [
      { medoid: [1, 0, 0], weight: 0.5, size: 5 },
      { medoid: [0.8, 0.6, 0], weight: 0.5, size: 5 }, // near x too → 'x1' likely in both quotas
    ];
    const out = multiModeRank({ modes, candidates, perModeK: 3 });
    expect([...out].sort()).toEqual(["x1", "x2", "y1", "y2", "z1"]);
    expect(new Set(out).size).toBe(out.length); // no duplicates
  });

  test("does not mutate the input candidates array", () => {
    const modes: UserMode[] = [{ medoid: [1, 0, 0], weight: 1, size: 5 }];
    const before = candidates.map((c) => c.id);
    multiModeRank({ modes, candidates, perModeK: 3 });
    expect(candidates.map((c) => c.id)).toEqual(before);
  });
});
