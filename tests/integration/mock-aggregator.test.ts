import { describe, it, expect } from "vitest";
import { loadFixture, FIXTURE_SIZE, TARGET_DISTRIBUTION } from "@/sectors/b-catalog/mock/fixture";

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
