import { describe, it, expect } from "vitest";
import {
  predictTopSubcategories,
  rankByViewedCategoriesQuota,
} from "@/sectors/d-personalization/ranking/views-categories";

describe("predictTopSubcategories", () => {
  it("returns the top-K viewed subcategories with their share of the kept views", () => {
    const out = predictTopSubcategories(
      ["shoes", "shoes", "shoes", "bags", "bags", "phones", "watches"],
      3,
    );
    expect(out.map((x) => x.subcategory)).toEqual(["shoes", "bags", "phones"]);
    expect(out[0].share).toBeCloseTo(3 / 6, 12);
    expect(out[1].share).toBeCloseTo(2 / 6, 12);
    expect(out[2].share).toBeCloseTo(1 / 6, 12);
  });

  it("drops null/empty subcategories and returns [] when nothing is left", () => {
    expect(predictTopSubcategories([null, "", null])).toEqual([]);
    expect(predictTopSubcategories([])).toEqual([]);
  });

  it("breaks count ties lexicographically (deterministic)", () => {
    const out = predictTopSubcategories(["b", "a"], 2);
    expect(out.map((x) => x.subcategory)).toEqual(["a", "b"]);
  });
});

describe("rankByViewedCategoriesQuota", () => {
  // Catalog: 3 subcategories × popularity. s1/s2 are the user's; s3 is not.
  const subOf = (id: string) => id.split("-")[0] || null;
  const popMap: Record<string, number> = {
    "s1-top": 90,
    "s1-mid": 50,
    "s1-low": 1,
    "s2-top": 80,
    "s2-low": 2,
    "s3-top": 999,
    "s3-low": 3,
  };
  const popOf = (id: string) => popMap[id] ?? 0;
  const candidates = Object.keys(popMap);

  it("fills the head with popular items of the predicted subcategories, proportional to share", () => {
    const out = rankByViewedCategoriesQuota({
      topSubcategories: [
        { subcategory: "s1", share: 2 / 3 },
        { subcategory: "s2", share: 1 / 3 },
      ],
      candidates,
      subcategoryOf: subOf,
      popOf,
      headSize: 3,
    });
    // quota(s1)=round(3·2/3)=2 → s1-top,s1-mid; quota(s2)=max(1,round(1))=1 → s2-top.
    expect(out.slice(0, 3)).toEqual(["s1-top", "s1-mid", "s2-top"]);
    // The globally-most-popular but off-taste s3-top must NOT crowd the head…
    expect(out.slice(0, 3)).not.toContain("s3-top");
    // …but leads the popularity-ordered tail.
    expect(out[3]).toBe("s3-top");
  });

  it("guarantees every predicted subcategory at least one slot", () => {
    const out = rankByViewedCategoriesQuota({
      topSubcategories: [
        { subcategory: "s1", share: 0.95 },
        { subcategory: "s2", share: 0.05 },
      ],
      candidates,
      subcategoryOf: subOf,
      popOf,
      headSize: 4,
    });
    expect(out.slice(0, 5)).toContain("s2-top");
  });

  it("is a full permutation: no candidate lost, none duplicated", () => {
    const out = rankByViewedCategoriesQuota({
      topSubcategories: [{ subcategory: "s1", share: 1 }],
      candidates,
      subcategoryOf: subOf,
      popOf,
      headSize: 10,
    });
    expect([...out].sort()).toEqual([...candidates].sort());
    expect(new Set(out).size).toBe(candidates.length);
  });

  it("falls back to pure popularity ordering when no subcategories were predicted", () => {
    const out = rankByViewedCategoriesQuota({
      topSubcategories: [],
      candidates,
      subcategoryOf: subOf,
      popOf,
    });
    expect(out[0]).toBe("s3-top");
    expect(out[out.length - 1]).toBe("s1-low");
  });
});
