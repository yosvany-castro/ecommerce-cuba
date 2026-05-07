import { describe, test, expect } from "vitest";
import { normalizeQueryWithLLM } from "@/sectors/c-search/normalizer/normalize";

describe("normalizeQueryWithLLM (REAL DeepSeek)", () => {
  test("clear gift query: 'regalo para mi sobrina de 8 años'", async () => {
    const r = await normalizeQueryWithLLM("regalo para mi sobrina de 8 años");
    expect(r.intent).toBe("regalo");
    expect(r.recipient_gender === "femenino" || r.recipient_gender === "unisex").toBe(true);
    expect(r.recipient_age_min ?? -1).toBeGreaterThanOrEqual(6);
    expect(r.recipient_age_max ?? 999).toBeLessThanOrEqual(10);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.search_terms.length).toBeGreaterThan(0);
    expect(r.prompt_version).toBe("v1.0.0-fase2");
  }, 30_000);

  test("garbage query: 'asdfgh qwerty zzzz' → confidence < 0.5", async () => {
    const r = await normalizeQueryWithLLM("asdfgh qwerty zzzz");
    expect(r.confidence).toBeLessThan(0.5);
  }, 30_000);

  test("clear product query: 'Nike Air Max 270 talle 42'", async () => {
    const r = await normalizeQueryWithLLM("Nike Air Max 270 talle 42");
    expect(r.search_terms.toLowerCase()).toMatch(/nike|air|max|270/);
    expect(r.confidence).toBeGreaterThan(0.5);
  }, 30_000);

  test("returns valid schema with all fields populated or null/empty", async () => {
    const r = await normalizeQueryWithLLM("audífonos bluetooth con cancelación de ruido");
    expect(r).toMatchObject({
      intent: expect.stringMatching(/^(compra|regalo|exploracion|comparacion)$/),
      categories: expect.any(Array),
      style: expect.any(Array),
      search_terms: expect.any(String),
      confidence: expect.any(Number),
      prompt_version: "v1.0.0-fase2",
    });
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  }, 30_000);

  test("category inference: 'pantalón corto verano' → categories includes 'ropa' (or subcategory)", async () => {
    const r = await normalizeQueryWithLLM("pantalón corto verano");
    expect(r.categories.length).toBeGreaterThan(0);
    expect(r.categories.some((c) => c.toLowerCase().includes("ropa"))).toBe(true);
  }, 30_000);
});
