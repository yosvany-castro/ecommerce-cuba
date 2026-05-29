import { describe, test, expect } from "vitest";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { factorDim, factorVectorFor, PRICE_BANDS } from "@/thesis/taxonomy";

describe("sampleCatalog", () => {
  test("produces exactly n products, deterministic by seed", () => {
    const a = sampleCatalog(200, 99);
    const b = sampleCatalog(200, 99);
    expect(a.length).toBe(200);
    expect(a.map((p) => p.title)).toEqual(b.map((p) => p.title));
  });

  test("each product has Spanish title, valid price, factor vector", () => {
    const cat = sampleCatalog(50, 1);
    for (const p of cat) {
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.price_cents).toBeGreaterThan(0);
      expect(p.factor_vector.length).toBe(factorDim());
      expect(typeof p.attrs.subcategory).toBe("string");
    }
  });

  test("canonical text concatenates title and description", () => {
    const p = sampleCatalog(1, 5)[0];
    expect(p.canonicalText.includes(p.title)).toBe(true);
  });

  test("covers several distinct subcategories", () => {
    const cat = sampleCatalog(300, 2);
    const subs = new Set(cat.map((p) => p.attrs.subcategory));
    expect(subs.size).toBeGreaterThanOrEqual(10);
  });

  test("source_product_id is unique across the catalog", () => {
    const cat = sampleCatalog(500, 3);
    const ids = new Set(cat.map((p) => p.source_product_id));
    expect(ids.size).toBe(cat.length);
  });

  test("factor_vector equals factorVectorFor(attrs)", () => {
    const cat = sampleCatalog(20, 7);
    for (const p of cat) {
      expect(p.factor_vector).toEqual(factorVectorFor(p.attrs));
    }
  });

  test("price_cents is within the product's price band", () => {
    const cat = sampleCatalog(100, 8);
    for (const p of cat) {
      const band = PRICE_BANDS[p.attrs.priceBand];
      expect(p.price_cents >= band.min && p.price_cents < band.max).toBe(true);
    }
  });
});
