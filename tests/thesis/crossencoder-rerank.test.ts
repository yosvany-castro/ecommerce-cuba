import { describe, test, expect } from "vitest";
import { crossEncoderRanker } from "@/thesis/rerank/crossencoder";
import type { RankItem } from "@/thesis/types";

describe("crossEncoderRanker", () => {
  test("ranks the candidate whose chunks best cover the query chunks first", () => {
    const itemChunks = new Map<string, number[][]>([
      ["match", [[1, 0], [0, 1]]],
      ["partial", [[1, 0]]],
      // off-axis doc: anti-aligned to both query chunks → lowest MaxSim.
      // Kept 2-dim to match the query space (cosineSim now rejects mismatches).
      ["off", [[-1, -1]]],
    ]);
    const r = crossEncoderRanker(itemChunks, () => [[1, 0], [0, 1]]);
    const cands: RankItem[] = [
      { id: "off", popularity: 0, vector: [] },
      { id: "partial", popularity: 0, vector: [] },
      { id: "match", popularity: 0, vector: [] },
    ];
    const out = r.rank({ userVector: [], cohort: null }, cands);
    expect(out[0]).toBe("match");
    expect(out[2]).toBe("off");
  });

  test("is named for the study table", () => {
    const r = crossEncoderRanker(new Map(), () => []);
    expect(r.name).toBe("cross-encoder-maxsim");
  });
});
