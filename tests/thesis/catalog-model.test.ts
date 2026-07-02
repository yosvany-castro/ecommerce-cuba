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

describe("sampleCatalog business fields (F4)", () => {
  test("every product has margin_pct, stock_health in [0,1], a seller_id, seller_age_days>=0", () => {
    const cat = sampleCatalog(300, 7);
    for (const p of cat) {
      expect(p.margin_pct >= 0 && p.margin_pct <= 1).toBe(true);
      expect(p.stock_health >= 0 && p.stock_health <= 1).toBe(true);
      expect(typeof p.seller_id === "string" && p.seller_id.length > 0).toBe(true);
      expect(Number.isInteger(p.seller_age_days) && p.seller_age_days >= 0).toBe(true);
    }
  });

  test("deterministic by seed", () => {
    const a = sampleCatalog(100, 7).map((p) => [p.margin_pct, p.seller_id, p.seller_age_days]);
    const b = sampleCatalog(100, 7).map((p) => [p.margin_pct, p.seller_id, p.seller_age_days]);
    expect(a).toEqual(b);
  });

  test("margin is anti-correlated with price band (cheap/long-tail carries higher margin)", () => {
    const cat = sampleCatalog(2000, 11);
    const lowBand = cat.filter((p) => p.attrs.priceBand <= 1);
    const highBand = cat.filter((p) => p.attrs.priceBand >= 2);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    expect(mean(lowBand.map((p) => p.margin_pct))).toBeGreaterThan(mean(highBand.map((p) => p.margin_pct)));
  });

  test("draws from a small seller pool (<=40 distinct sellers) with some new sellers (<30d)", () => {
    const cat = sampleCatalog(800, 3);
    const sellers = new Set(cat.map((p) => p.seller_id));
    expect(sellers.size).toBeLessThanOrEqual(40);
    expect(cat.some((p) => p.seller_age_days < 30)).toBe(true);
  });
});
