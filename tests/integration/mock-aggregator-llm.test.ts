import { describe, test, expect, afterEach } from "vitest";
import { generateProductsWithLLM } from "@/sectors/b-catalog/mock/llm-generator";
import { fetchFromAggregator } from "@/sectors/b-catalog/mock/aggregator";

describe("generateProductsWithLLM (REAL DeepSeek)", () => {
  test("query 'Nike Air Max' → mayoría (≥60%) de productos tienen 'nike' en título o brand", async () => {
    const products = await generateProductsWithLLM({ query: "Nike Air Max", limit: 5 });
    expect(products.length).toBe(5);
    const nikeCount = products.filter(
      (p) => /nike/i.test(p.title) || /nike/i.test(p.brand),
    ).length;
    expect(nikeCount / products.length).toBeGreaterThanOrEqual(0.6);
  }, 60_000);

  test("respeta el limit param exacto: limit=3 → 3 productos", async () => {
    const products = await generateProductsWithLLM({ query: "iPhone 15", limit: 3 });
    expect(products.length).toBe(3);
  }, 60_000);

  test("cada producto cumple shape MockProduct", async () => {
    const products = await generateProductsWithLLM({ query: "regalo cumpleaños", limit: 3 });
    for (const p of products) {
      expect(["amazon", "aliexpress", "shein"]).toContain(p.source);
      expect(typeof p.id).toBe("string");
      expect(p.id.length).toBeGreaterThan(0);
      expect(typeof p.source_product_id).toBe("string");
      expect(p.source_product_id.length).toBeGreaterThan(0);
      expect(typeof p.title).toBe("string");
      expect(p.title.length).toBeGreaterThan(0);
      expect(Number.isInteger(p.price_cents)).toBe(true);
      expect(p.price_cents).toBeGreaterThanOrEqual(0);
      expect(typeof p.raw_category).toBe("string");
      expect(typeof p.attributes).toBe("object");
      expect(p.attributes).not.toBeNull();
    }
  }, 60_000);

  test("category='electronica': ≥80% de productos tienen raw_category in {electronica, otros}", async () => {
    const products = await generateProductsWithLLM({
      query: "auriculares bluetooth",
      category: "electronica",
      limit: 5,
    });
    const matching = products.filter(
      (p) => p.raw_category === "electronica" || p.raw_category === "otros",
    ).length;
    expect(matching / products.length).toBeGreaterThanOrEqual(0.8);
  }, 60_000);
});

describe("fetchFromAggregator mode switch", () => {
  afterEach(() => {
    delete process.env.MOCK_AGGREGATOR_MODE;
    delete process.env.MOCK_AGGREGATOR_ERROR_RATE;
  });

  test("MODE='auto' + query → llama LLM (productos relacionados con la query)", async () => {
    process.env.MOCK_AGGREGATOR_MODE = "auto";
    process.env.MOCK_AGGREGATOR_ERROR_RATE = "0";
    const r = await fetchFromAggregator({ query: "Adidas Stan Smith", limit: 4 });
    expect(r.products.length).toBe(4);
    const adidas = r.products.filter(
      (p) => /adidas|stan smith/i.test(p.title + " " + (p.brand ?? "")),
    ).length;
    expect(adidas / r.products.length).toBeGreaterThanOrEqual(0.5);
  }, 60_000);

  test("MODE='fixture' + query → ignora LLM, usa fixture deterministica", async () => {
    process.env.MOCK_AGGREGATOR_MODE = "fixture";
    process.env.MOCK_AGGREGATOR_ERROR_RATE = "0";
    const r = await fetchFromAggregator({ category: "ropa", limit: 3 });
    expect(r.products.length).toBeLessThanOrEqual(3);
    for (const p of r.products) {
      expect(p.raw_category).toBe("ropa");
    }
  }, 30_000);
});
