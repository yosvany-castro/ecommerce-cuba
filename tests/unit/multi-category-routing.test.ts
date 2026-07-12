import { describe, test, expect } from "vitest";
import { makeMultiProvider, CATEGORY_PROVIDER_MAP } from "@/sectors/b-catalog/multi";
import type { AggregatorProvider } from "@/sectors/b-catalog/provider";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";

const product = (id: string): MockProduct => ({
  id,
  source: "amazon",
  source_product_id: id,
  title: "T",
  description: "D",
  image_url: "",
  price_cents: 100,
  brand: "",
  raw_category: "",
  attributes: {},
});

function makeProvider(name: string, calls: string[]): AggregatorProvider {
  return {
    name,
    async fetch() {
      calls.push(name);
      return { products: [product(name)], cost_cents: 1, latency_ms: 1 };
    },
  };
}

describe("makeMultiProvider — ruteo por categoría", () => {
  test("categoría ropa: llama shein-prod y aliexpress-prod, NO walmart-prod ni amazon-prod", async () => {
    const calls: string[] = [];
    const universe = [
      makeProvider("shein-prod", calls),
      makeProvider("aliexpress-prod", calls),
      makeProvider("walmart-prod", calls),
      makeProvider("amazon-prod", calls),
    ];
    const multi = makeMultiProvider(universe);
    await multi.fetch({ category: "ropa" });
    expect(calls.sort()).toEqual(["aliexpress-prod", "shein-prod"]);
  });

  test("categoría electronica: llama aliexpress-prod y walmart-prod, no shein/amazon", async () => {
    const calls: string[] = [];
    const universe = [
      makeProvider("shein-prod", calls),
      makeProvider("aliexpress-prod", calls),
      makeProvider("walmart-prod", calls),
      makeProvider("amazon-prod", calls),
    ];
    const multi = makeMultiProvider(universe);
    await multi.fetch({ category: "electronica" });
    expect(calls.sort()).toEqual(["aliexpress-prod", "walmart-prod"]);
  });

  test("sin categoría: usa el default (aliexpress-prod + amazon-prod, igual que 'otros')", async () => {
    const calls: string[] = [];
    const universe = [
      makeProvider("shein-prod", calls),
      makeProvider("aliexpress-prod", calls),
      makeProvider("walmart-prod", calls),
      makeProvider("amazon-prod", calls),
    ];
    const multi = makeMultiProvider(universe);
    await multi.fetch({});
    expect(calls.sort()).toEqual(CATEGORY_PROVIDER_MAP.otros.slice().sort());
  });

  test("mapa sin match contra el universo configurado → usa todos (defensivo)", async () => {
    const calls: string[] = [];
    // Universo NO incluye ninguno de los nombres que pide "ropa" (shein-prod/aliexpress-prod).
    const universe = [makeProvider("amazon-prod", calls), makeProvider("walmart-prod", calls)];
    const multi = makeMultiProvider(universe);
    await multi.fetch({ category: "ropa" });
    expect(calls.sort()).toEqual(["amazon-prod", "walmart-prod"]);
  });

  test("categoría válida filtra correctamente incluso cuando el universo es un subconjunto", async () => {
    const calls: string[] = [];
    // Universo real de hoy: solo amazon-prod + aliexpress-prod (default de MULTI_PROVIDER_SOURCES).
    const universe = [makeProvider("amazon-prod", calls), makeProvider("aliexpress-prod", calls)];
    const multi = makeMultiProvider(universe);
    await multi.fetch({ category: "ropa" }); // pide shein-prod+aliexpress-prod
    expect(calls).toEqual(["aliexpress-prod"]); // shein-prod no está en el universo → se ignora
  });
});
