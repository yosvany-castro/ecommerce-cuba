import { describe, test, expect } from "vitest";
import { rerankWithLLM } from "@/sectors/d-personalization/reranker/rerank";
import { PROMPT_VERSION } from "@/sectors/d-personalization/reranker/prompt";

describe("rerankWithLLM (REAL Anthropic Haiku)", () => {
  test("returns 10 items with unique ranks 1-10 and non-generic reasons", async () => {
    const candidates = Array.from({ length: 30 }, (_, i) => ({
      product_id: `a0eebc99-9c0b-4ef8-bb6d-${String(i).padStart(12, "0")}`,
      title:
        i % 3 === 0
          ? `Vestido elegante mujer adulta ${i}`
          : i % 3 === 1
            ? `Funda silicona iPhone Pro ${i}`
            : `Crema hidratante facial ${i}`,
      price_cents: 1000 + i * 100,
      brand: i % 3 === 0 ? "Zara" : i % 3 === 1 ? "Apple" : "Nivea",
      category: i % 3 === 0 ? "ropa" : i % 3 === 1 ? "electronica" : "belleza",
    }));

    const out = await rerankWithLLM({
      candidates,
      context: {
        profile_summary:
          "Mujer adulta, compra para sí misma, frecuenta ropa elegante y belleza.",
        hour: 14,
        day_of_week: "jueves",
        last_interaction: "Vio Funda silicona iPhone Pro 1 hace 5 minutos",
        recent_query: null,
      },
    });

    expect(out.items.length).toBe(10);
    expect(out.prompt_version).toBe(PROMPT_VERSION);

    const ranks = out.items.map((it) => it.rank);
    expect(new Set(ranks).size).toBe(10);
    expect(Math.min(...ranks)).toBe(1);
    expect(Math.max(...ranks)).toBe(10);

    const inputIds = new Set(candidates.map((c) => c.product_id));
    for (const it of out.items) {
      expect(inputIds.has(it.product_id)).toBe(true);
    }

    const generic =
      /^(producto recomendado|para ti|popular|te puede gustar|alto rating)$/i;
    for (const it of out.items) {
      expect(it.reason.length).toBeGreaterThan(3);
      expect(generic.test(it.reason.trim())).toBe(false);
    }
  }, 90_000);

  test("throws if candidates.length < 10", async () => {
    await expect(
      rerankWithLLM({
        candidates: [
          {
            product_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            title: "x",
            price_cents: 100,
            brand: "y",
            category: "z",
          },
        ],
        context: {
          profile_summary: "x",
          hour: 0,
          day_of_week: "lunes",
          last_interaction: null,
          recent_query: null,
        },
      }),
    ).rejects.toThrow();
  });
});
