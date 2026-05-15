import { describe, test, expect } from "vitest";
import { runEval3aSmoke } from "@/../scripts/eval-personalization-3a";

describe("eval-personalization-3a smoke (small fixtures)", () => {
  test("runs end-to-end and reports finite metrics", async () => {
    const result = await runEval3aSmoke({
      productsPerCohort: 3,
      eventsPerUser: 5,
    });
    expect(Number.isFinite(result.recall_at_10)).toBe(true);
    expect(Number.isFinite(result.baseline_recall_at_10)).toBe(true);
    expect(result.recall_at_10).toBeGreaterThanOrEqual(0);
    expect(result.recall_at_10).toBeLessThanOrEqual(1);
    expect(result.per_user.length).toBe(3);
    expect(Number.isFinite(result.jaccard_inter_user)).toBe(true);
    expect(Number.isFinite(result.shift_user_split_score)).toBe(true);
  }, 600_000);
});
