import { describe, test, expect } from "vitest";
import { runEval3b } from "@/../scripts/eval-personalization-3b";

describe("eval-personalization-3b smoke", () => {
  test("runs end-to-end and returns finite metrics for all 3 sub-experiments", async () => {
    const r = await runEval3b({
      multimodeEventsPerStyle: 5,
      multimodeProductsPerStyle: 6,
      crossSellCoSessions: 3,
      diversityEventsPerUser: 5,
    });
    expect(Number.isFinite(r.multimode_balance_multi)).toBe(true);
    expect(Number.isFinite(r.multimode_balance_single)).toBe(true);
    expect(typeof r.multimode_formal_multi).toBe("number");
    expect(typeof r.multimode_casual_multi).toBe("number");
    expect(typeof r.crosssell_fundas_in_top10).toBe("number");
    expect(Number.isFinite(r.diversity_jaccard_avg)).toBe(true);
    expect(typeof r.multimode_pass).toBe("boolean");
    expect(typeof r.crosssell_pass).toBe("boolean");
    expect(typeof r.diversity_pass).toBe("boolean");
  }, 900_000);
});
