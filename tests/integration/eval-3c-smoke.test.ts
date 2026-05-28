import { describe, test, expect } from "vitest";
import { runEval3c } from "../../scripts/eval-personalization-3c";

describe("eval-personalization-3c smoke", () => {
  test("runs end-to-end and returns finite metrics", async () => {
    const r = await runEval3c();
    expect(Number.isFinite(r.ndcg_3c)).toBe(true);
    expect(Number.isFinite(r.ndcg_baseline)).toBe(true);
    expect(Number.isFinite(r.ndcg_delta_pct)).toBe(true);
    expect(typeof r.latency_p99_ms).toBe("number");
    expect(typeof r.cache_hit_rate).toBe("number");
    expect(typeof r.pass).toBe("boolean");
  }, 1_800_000);
});
