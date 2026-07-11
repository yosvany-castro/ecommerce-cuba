import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { withFallback } from "@/sectors/b-catalog/fallback";
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

function makeProvider(name: string, impl: AggregatorProvider["fetch"]): AggregatorProvider {
  return { name, fetch: impl };
}

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe("withFallback", () => {
  test("primary lanza → usa fallback y loguea", async () => {
    const primary = makeProvider("primary", async () => {
      throw new Error("boom");
    });
    const fallback = makeProvider("fallback", async () => ({
      products: [product("f1")],
      cost_cents: 0,
      latency_ms: 1,
    }));
    const wrapped = withFallback(primary, fallback);

    const result = await wrapped.fetch({});
    expect(result.products).toEqual([product("f1")]);
    expect(wrapped.name).toBe("primary+fb:fallback");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("primary devuelve 0 productos → usa fallback y loguea", async () => {
    const primary = makeProvider("primary", async () => ({
      products: [],
      cost_cents: 0,
      latency_ms: 1,
    }));
    const fallback = makeProvider("fallback", async () => ({
      products: [product("f2")],
      cost_cents: 0,
      latency_ms: 1,
    }));
    const wrapped = withFallback(primary, fallback);

    const result = await wrapped.fetch({});
    expect(result.products).toEqual([product("f2")]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("primary ok (con productos) → no llama fallback, sin warn", async () => {
    let fallbackCalled = false;
    const primary = makeProvider("primary", async () => ({
      products: [product("p1")],
      cost_cents: 5,
      latency_ms: 1,
    }));
    const fallback = makeProvider("fallback", async () => {
      fallbackCalled = true;
      return { products: [product("f3")], cost_cents: 0, latency_ms: 1 };
    });
    const wrapped = withFallback(primary, fallback);

    const result = await wrapped.fetch({});
    expect(result.products).toEqual([product("p1")]);
    expect(fallbackCalled).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
