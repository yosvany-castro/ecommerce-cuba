import { describe, test, expect } from "vitest";
import { buildUserModes } from "@/thesis/multivector/modes";
import { multiModeRank } from "@/thesis/multivector/retrieve";
import { cosineSingleVectorRanker } from "@/thesis/eval/baselines";
import { l2normalize, meanPool } from "@/thesis/embedders/space";
import type { RankItem } from "@/thesis/types";

/**
 * Replicates the feedback's 70/30 experiment (pure, no DB): a user with two
 * orthogonal tastes. Single-vector retrieval averages to a compromise that
 * under-serves the minority taste; multi-mode retrieval surfaces BOTH. Asserts
 * the multi-mode top-10 contains strictly more of the minority taste.
 */
describe("F2 discrimination: multi-vector beats single-vector for a bimodal user", () => {
  test("multi-mode top-10 covers the minority taste better than single-vector", () => {
    const history: number[][] = [
      ...Array.from({ length: 7 }, (_, i) => [1, i * 0.001, 0]),     // majority: shoes (x)
      ...Array.from({ length: 3 }, (_, i) => [0, 1, i * 0.001]),     // minority: bags (y)
    ];
    const candidates: RankItem[] = [
      ...Array.from({ length: 50 }, (_, i) => ({ id: `shoe${i}`, popularity: 0, vector: [1, i * 0.0001, 0] })),
      ...Array.from({ length: 50 }, (_, i) => ({ id: `bag${i}`, popularity: 0, vector: [0, 1, i * 0.0001] })),
    ];
    const modes = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });
    expect(modes.length).toBe(2);

    const f2 = multiModeRank({ modes, candidates, perModeK: 20 });
    const single = cosineSingleVectorRanker().rank({ userVector: l2normalize(meanPool(history)), cohort: null }, candidates);

    const bagsInTop10 = (ids: string[]) => ids.slice(0, 10).filter((id) => id.startsWith("bag")).length;
    expect(bagsInTop10(f2)).toBeGreaterThan(bagsInTop10(single));
  });
});
