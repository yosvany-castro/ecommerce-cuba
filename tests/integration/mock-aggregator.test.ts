import { describe, it, expect, beforeEach } from "vitest";
import { loadFixture, FIXTURE_SIZE, TARGET_DISTRIBUTION } from "@/sectors/b-catalog/mock/fixture";
import { fetchFromAggregator, getCallCount, resetCallCount } from "@/sectors/b-catalog/mock/aggregator";

describe("mock fixture", () => {
  it("loads exactly 500 products", async () => {
    const fixture = await loadFixture();
    expect(fixture).toHaveLength(FIXTURE_SIZE);
  });

  it("has unique IDs", async () => {
    const fixture = await loadFixture();
    const ids = new Set(fixture.map((p) => p.id));
    expect(ids.size).toBe(FIXTURE_SIZE);
  });

  it("category distribution matches target ±2%", async () => {
    const fixture = await loadFixture();
    for (const [cat, target] of Object.entries(TARGET_DISTRIBUTION)) {
      const count = fixture.filter((p) => p.raw_category === cat).length;
      const ratio = count / FIXTURE_SIZE;
      expect(Math.abs(ratio - target)).toBeLessThan(0.02);
    }
  });

  it("sources spread across amazon, aliexpress, shein", async () => {
    const fixture = await loadFixture();
    const sources = new Set(fixture.map((p) => p.source));
    expect(sources).toEqual(new Set(["amazon", "aliexpress", "shein"]));
  });
});

describe("mock aggregator", () => {
  beforeEach(() => resetCallCount());

  it("returns exactly 25 products per call", async () => {
    const res = await fetchFromAggregator({ category: "ropa" });
    expect(res.products).toHaveLength(25);
  });

  it("filters by category", async () => {
    const res = await fetchFromAggregator({ category: "electronica" });
    for (const p of res.products) expect(p.raw_category).toBe("electronica");
  });

  it("latency is between 2 and 4 seconds (5 measurements)", async () => {
    const ts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      try {
        await fetchFromAggregator({ category: "ropa" });
      } catch {
        /* error path is timing-correct too */
      }
      ts.push(performance.now() - t0);
    }
    for (const t of ts) {
      expect(t).toBeGreaterThan(1900); // small buffer below 2s
      expect(t).toBeLessThan(4200);    // small buffer above 4s
    }
    // Variance check: not all equal (jitter)
    const max = Math.max(...ts), min = Math.min(...ts);
    expect(max - min).toBeGreaterThan(100); // at least 100ms jitter
  }, 30_000);

  it("call counter increments on every invocation (success or error)", async () => {
    expect(getCallCount()).toBe(0);
    for (let i = 0; i < 3; i++) {
      try { await fetchFromAggregator({ category: "ropa" }); } catch { /* ignore */ }
    }
    expect(getCallCount()).toBe(3);
  });

  // Long-running: only when CI_FULL=1 is set; skip otherwise
  it.skipIf(process.env.CI_FULL !== "1")("error rate is approximately 2% over 200 calls (±3%)", async () => {
    let errors = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      try { await fetchFromAggregator({ category: "ropa" }); }
      catch { errors++; }
    }
    const rate = errors / N;
    // 2% target with binomial variance allowance: tolerate 0% to 5%
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(0.05);
  }, 200 * 4500); // worst case 200 calls × 4.5s timeout
});
