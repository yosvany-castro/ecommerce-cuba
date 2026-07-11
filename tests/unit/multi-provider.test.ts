import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { makeMultiProvider } from "@/sectors/b-catalog/multi";
import type { AggregatorProvider } from "@/sectors/b-catalog/provider";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";

const product = (id: string, source: MockProduct["source"] = "amazon"): MockProduct => ({
  id,
  source,
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

describe("makeMultiProvider", () => {
  test("2 exitosos → merge de productos y suma de cost_cents", async () => {
    const a = makeProvider("a", async () => ({
      products: [product("a1"), product("a2")],
      cost_cents: 4,
      latency_ms: 1,
    }));
    const b = makeProvider("b", async () => ({
      products: [product("b1", "aliexpress")],
      cost_cents: 3,
      latency_ms: 1,
    }));
    const multi = makeMultiProvider([a, b]);

    const result = await multi.fetch({});
    expect(multi.name).toBe("multi");
    expect(result.products.map((p) => p.id).sort()).toEqual(["a1", "a2", "b1"]);
    expect(result.cost_cents).toBe(7);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("1 falla + 1 ok → resultado parcial y warn del fallo", async () => {
    const good = makeProvider("good", async () => ({
      products: [product("g1")],
      cost_cents: 5,
      latency_ms: 1,
    }));
    const bad = makeProvider("bad", async () => {
      throw new Error("boom");
    });
    const multi = makeMultiProvider([good, bad]);

    const result = await multi.fetch({});
    expect(result.products).toEqual([product("g1")]);
    expect(result.cost_cents).toBe(5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("bad");
  });

  test("todos fallan → throw con mensaje agregado", async () => {
    const a = makeProvider("a", async () => {
      throw new Error("boom-a");
    });
    const b = makeProvider("b", async () => {
      throw new Error("boom-b");
    });
    const multi = makeMultiProvider([a, b]);

    await expect(multi.fetch({})).rejects.toThrow(/boom-a/);
    await expect(multi.fetch({})).rejects.toThrow(/boom-b/);
  });

  test("dedupe: mismo source+source_product_id repetido → queda el primero", async () => {
    const a = makeProvider("a", async () => ({
      products: [product("dup"), product("unique-a")],
      cost_cents: 1,
      latency_ms: 1,
    }));
    // Mismo provider "repetido" en config: misma fuente, mismo id → duplicado real.
    const aAgain = makeProvider("a", async () => ({
      products: [product("dup"), product("unique-a2")],
      cost_cents: 1,
      latency_ms: 1,
    }));
    const multi = makeMultiProvider([a, aAgain]);

    const result = await multi.fetch({});
    const ids = result.products.map((p) => p.id);
    expect(ids).toEqual(["dup", "unique-a", "unique-a2"]);
  });

  test("marketplaces distintos con el mismo source_product_id no colisionan", async () => {
    const amazon = makeProvider("amazon", async () => ({
      products: [product("123", "amazon")],
      cost_cents: 0,
      latency_ms: 1,
    }));
    const shein = makeProvider("shein", async () => ({
      products: [product("123", "shein")],
      cost_cents: 0,
      latency_ms: 1,
    }));
    const multi = makeMultiProvider([amazon, shein]);

    const result = await multi.fetch({});
    expect(result.products).toHaveLength(2);
  });
});
