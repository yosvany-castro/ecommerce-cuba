import { describe, test, expect } from "vitest";
import {
  TAXONOMY,
  allLeafCategories,
  factorDim,
  factorVectorFor,
} from "@/thesis/taxonomy";

describe("taxonomy", () => {
  test("has multiple top categories with subcategories and brands", () => {
    expect(TAXONOMY.length).toBeGreaterThanOrEqual(5);
    for (const c of TAXONOMY) {
      expect(c.subcategories.length).toBeGreaterThanOrEqual(1);
      expect(c.brands.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("allLeafCategories returns category/subcategory pairs", () => {
    const leaves = allLeafCategories();
    expect(leaves.length).toBeGreaterThanOrEqual(10);
    expect(leaves[0].category.length > 0 && leaves[0].subcategory.length > 0).toBe(true);
  });

  test("factorVectorFor is deterministic and length factorDim()", () => {
    const leaf = allLeafCategories()[0];
    const v1 = factorVectorFor({ category: leaf.category, subcategory: leaf.subcategory, brand: leaf.brands[0], gender: "femenino", ageBand: "adulto", priceBand: 2, style: "casual" });
    const v2 = factorVectorFor({ category: leaf.category, subcategory: leaf.subcategory, brand: leaf.brands[0], gender: "femenino", ageBand: "adulto", priceBand: 2, style: "casual" });
    expect(v1).toEqual(v2);
    expect(v1.length).toBe(factorDim());
  });

  test("different subcategories produce different factor vectors", () => {
    const leaves = allLeafCategories();
    const a = factorVectorFor({ category: leaves[0].category, subcategory: leaves[0].subcategory, brand: leaves[0].brands[0], gender: "femenino", ageBand: "adulto", priceBand: 2, style: "casual" });
    const b = factorVectorFor({ category: leaves[1].category, subcategory: leaves[1].subcategory, brand: leaves[1].brands[0], gender: "femenino", ageBand: "adulto", priceBand: 2, style: "casual" });
    expect(a).not.toEqual(b);
  });
});
