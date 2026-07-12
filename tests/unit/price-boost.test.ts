import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  priceFactor,
  priceFactorForProduct,
  applyPriceBoost,
  fuseWithPriceBoost,
  EXPENSIVE_EXCEPTION_REGEX,
} from "@/sectors/c-search/retrieve/price-boost";
import type { FusedProduct, RankedProduct } from "@/sectors/c-search/retrieve/rrf";

describe("priceFactor", () => {
  test("≤$15 → boost (1.25 con defaults)", () => {
    expect(priceFactor(0)).toBeCloseTo(1.25, 6);
    expect(priceFactor(1500)).toBeCloseTo(1.25, 6);
  });

  test("$15–50 interpola suave de 1.25 a 1.0", () => {
    const mid = priceFactor(3250); // punto medio del tramo
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(1.25);
    expect(priceFactor(5000)).toBeCloseTo(1, 6);
  });

  test("$50–120 interpola suave de 1.0 a 0.8 (penalty 0.20 default)", () => {
    const mid = priceFactor(8500); // punto medio del tramo
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.8);
    expect(priceFactor(12000)).toBeCloseTo(0.8, 6);
  });

  test(">$120 → penalty plano (0.8)", () => {
    expect(priceFactor(12001)).toBeCloseTo(0.8, 6);
    expect(priceFactor(999_999)).toBeCloseTo(0.8, 6);
  });

  describe("con env overrides", () => {
    const OLD = { ...process.env };
    beforeEach(() => {
      process.env.PRICE_CHEAP_BOOST = "0.5";
      process.env.PRICE_EXPENSIVE_PENALTY = "0.1";
    });
    afterEach(() => {
      process.env = { ...OLD };
    });
    test("boost/penalty leen las envs en cada llamada", () => {
      expect(priceFactor(0)).toBeCloseTo(1.5, 6);
      expect(priceFactor(999_999)).toBeCloseTo(0.9, 6);
    });
  });
});

describe("priceFactorForProduct — excepción de alta demanda", () => {
  test("producto caro que matchea la excepción NO recibe penalty", () => {
    expect(priceFactorForProduct(50000, "EcoFlow Delta 2 Power Station")).toBe(1);
    expect(priceFactorForProduct(30000, "Generador eléctrico portátil 3000W")).toBe(1);
    expect(priceFactorForProduct(15000, "Panel solar plegable 100W")).toBe(1);
    expect(priceFactorForProduct(20000, "Batería de litio 12V 100Ah")).toBe(1);
  });

  test("producto caro que NO matchea sí recibe el penalty normal", () => {
    expect(priceFactorForProduct(50000, "Sofá reclinable de cuero")).toBeCloseTo(0.8, 6);
  });

  test("regex exportado matchea variantes con tilde y sin tilde", () => {
    expect(EXPENSIVE_EXCEPTION_REGEX.test("planta electrica de emergencia")).toBe(true);
    expect(EXPENSIVE_EXCEPTION_REGEX.test("planta eléctrica de emergencia")).toBe(true);
    expect(EXPENSIVE_EXCEPTION_REGEX.test("inversor de corriente 2000W")).toBe(true);
    expect(EXPENSIVE_EXCEPTION_REGEX.test("mesa de comedor")).toBe(false);
  });
});

const fp = (id: string, rrf_score: number): FusedProduct => ({ id, rrf_score, ranks: {} });

describe("applyPriceBoost — reordena, empates conservan orden (estable)", () => {
  test("barato sube por encima de un score de relevancia levemente mayor", () => {
    const fused = [fp("caro", 0.02), fp("barato", 0.019)];
    const info = new Map([
      ["caro", { price_cents: 50000, title: "Sofá" }],
      ["barato", { price_cents: 500, title: "Llavero" }],
    ]);
    const out = applyPriceBoost(fused, info);
    expect(out.map((p) => p.id)).toEqual(["barato", "caro"]);
  });

  test("caro baja por debajo de un score de relevancia levemente menor", () => {
    const fused = [fp("caro", 0.021), fp("medio", 0.02)];
    const info = new Map([
      ["caro", { price_cents: 50000, title: "Sofá" }],
      ["medio", { price_cents: 3000, title: "Zapatos" }],
    ]);
    const out = applyPriceBoost(fused, info);
    expect(out.map((p) => p.id)).toEqual(["medio", "caro"]);
  });

  test("excepción de alta demanda no baja pese a ser caro (le gana a un caro normal con más relevancia cruda)", () => {
    // Mismo tramo de precio (>$120, factor normal 0.8) para ambos — la única
    // diferencia es que "ecoflow" matchea la excepción (factor=1, sin penalty).
    const fused = [fp("ecoflow", 0.02), fp("otro_caro", 0.021)];
    const info = new Map([
      ["ecoflow", { price_cents: 80000, title: "EcoFlow Delta 2 Power Station" }],
      ["otro_caro", { price_cents: 80000, title: "Sofá de cuero" }],
    ]);
    const out = applyPriceBoost(fused, info);
    // ecoflow: 0.02×1 = 0.02 · otro_caro: 0.021×0.8 = 0.0168 → ecoflow gana pese a menor rrf_score crudo.
    expect(out.map((p) => p.id)).toEqual(["ecoflow", "otro_caro"]);
  });

  test("empate en score' conserva el orden original de relevancia", () => {
    // Mismo price_cents → mismo factor → mismo score' → el orden de entrada debe sobrevivir.
    const fused = [fp("A", 0.02), fp("B", 0.02), fp("C", 0.02)];
    const info = new Map([
      ["A", { price_cents: 3000, title: "x" }],
      ["B", { price_cents: 3000, title: "y" }],
      ["C", { price_cents: 3000, title: "z" }],
    ]);
    const out = applyPriceBoost(fused, info);
    expect(out.map((p) => p.id)).toEqual(["A", "B", "C"]);
  });

  test("producto sin info de precio (no debería pasar) queda con factor=1, no rompe", () => {
    const fused = [fp("sin_info", 0.02), fp("barato", 0.019)];
    const info = new Map([["barato", { price_cents: 500, title: "x" }]]);
    const out = applyPriceBoost(fused, info);
    expect(out.map((p) => p.id).sort()).toEqual(["barato", "sin_info"]);
  });
});

describe("fuseWithPriceBoost — integración fuse + boost", () => {
  test("fusiona y reordena en un solo paso a partir de listas bm25/cosine con price_cents/title", () => {
    const bm25: RankedProduct[] = [
      { id: "caro", rank: 1, score: 1, price_cents: 50000, title: "Sofá" },
      { id: "barato", rank: 2, score: 0.9, price_cents: 500, title: "Llavero" },
    ];
    const cos: RankedProduct[] = [];
    const out = fuseWithPriceBoost([bm25, cos]);
    expect(out.map((p) => p.id)).toEqual(["barato", "caro"]);
  });
});
