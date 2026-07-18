import { describe, test, expect } from "vitest";
import {
  anonymousCheckoutItemSchema,
  variantSelectionSchema,
  findPriceMismatches,
  PriceChangedError,
  TotalsChangedError,
} from "@/sectors/a-tracking/checkout-schema";

// Valid RFC 4122 v4 UUID (zod 4 enforces version/variant bits)
const validId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

describe("anonymousCheckoutItemSchema", () => {
  test("acepta item sin color/size, con unit_price_cents (lo que la UI muestra)", () => {
    const out = anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1, unit_price_cents: 1200 });
    expect(out.color).toBeUndefined();
    expect(out.size).toBeUndefined();
    expect(out.unit_price_cents).toBe(1200);
  });

  test("acepta color y size como strings", () => {
    const out = anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 2, unit_price_cents: 1200, color: "Rojo", size: "M" });
    expect(out).toMatchObject({ color: "Rojo", size: "M" });
  });

  test("acepta null explícito para color/size", () => {
    const out = anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1, unit_price_cents: 1200, color: null, size: null });
    expect(out.color).toBeNull();
    expect(out.size).toBeNull();
  });

  test("rechaza color no-string", () => {
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1, unit_price_cents: 1200, color: 5 })).toThrow();
  });

  test("rechaza product_id inválido", () => {
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: "nope", quantity: 1, unit_price_cents: 1200 })).toThrow();
  });

  test("rechaza quantity fuera de rango (checkout/anonymous/route.ts cota 999)", () => {
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1000, unit_price_cents: 1200 })).toThrow();
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 0, unit_price_cents: 1200 })).toThrow();
  });

  test("rechaza sin unit_price_cents — REGLA DE ORO: el server necesita saber qué vio el usuario", () => {
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1 })).toThrow();
  });

  test("rechaza unit_price_cents <= 0 o no entero", () => {
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1, unit_price_cents: 0 })).toThrow();
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1, unit_price_cents: -100 })).toThrow();
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1, unit_price_cents: 12.5 })).toThrow();
  });
});

describe("variantSelectionSchema (checkout autenticado — sin quantity, viene de cart_items)", () => {
  test("no requiere quantity", () => {
    const out = variantSelectionSchema.parse({ product_id: validId, color: "Azul" });
    expect(out.size).toBeUndefined();
  });

  test("acepta solo product_id (sin selección, sin unit_price_cents — nadie lo manda hoy)", () => {
    const out = variantSelectionSchema.parse({ product_id: validId });
    expect(out.color).toBeUndefined();
    expect(out.size).toBeUndefined();
    expect(out.unit_price_cents).toBeUndefined();
  });

  test("acepta unit_price_cents cuando viene (opcional, no todos los clientes lo mandan)", () => {
    const out = variantSelectionSchema.parse({ product_id: validId, unit_price_cents: 900 });
    expect(out.unit_price_cents).toBe(900);
  });

  test("rechaza product_id inválido", () => {
    expect(() => variantSelectionSchema.parse({ product_id: "nope" })).toThrow();
  });
});

describe("findPriceMismatches — REGLA DE ORO: el server acepta cuando coincide, marca mismatch cuando no", () => {
  test("todo coincide (sin variante, precio base) -> []", () => {
    const out = findPriceMismatches([
      { product_id: "p1", color: null, size: null, shown_cents: 1000, current_cents: 1000 },
    ]);
    expect(out).toEqual([]);
  });

  test("todo coincide (con variante, precio de la combinación color/talla) -> []", () => {
    const out = findPriceMismatches([
      { product_id: "p1", color: "Rojo", size: "M", shown_cents: 1200, current_cents: 1200 },
    ]);
    expect(out).toEqual([]);
  });

  test("mismatch sin variante (el precio base subió) -> reporta la línea", () => {
    const out = findPriceMismatches([
      { product_id: "p1", color: null, size: null, shown_cents: 1000, current_cents: 1500 },
    ]);
    expect(out).toEqual([{ product_id: "p1", color: null, size: null, shown_cents: 1000, current_cents: 1500 }]);
  });

  test("mismatch con variante (la UI mostró el precio de otra combinación) -> reporta la línea", () => {
    const out = findPriceMismatches([
      { product_id: "p1", color: "Rojo", size: "M", shown_cents: 1200, current_cents: 1300 },
    ]);
    expect(out).toEqual([{ product_id: "p1", color: "Rojo", size: "M", shown_cents: 1200, current_cents: 1300 }]);
  });

  test("shown_cents ausente (cliente no lo mandó) -> no se verifica esa línea (fail-open)", () => {
    const out = findPriceMismatches([
      { product_id: "p1", color: null, size: null, shown_cents: undefined, current_cents: 9999 },
    ]);
    expect(out).toEqual([]);
  });

  test("varias líneas: solo reporta las que no coinciden", () => {
    const out = findPriceMismatches([
      { product_id: "ok", color: null, size: null, shown_cents: 500, current_cents: 500 },
      { product_id: "bad", color: "Azul", size: "L", shown_cents: 800, current_cents: 850 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].product_id).toBe("bad");
  });
});

describe("PriceChangedError", () => {
  test("carga los items del mismatch, name identifica el error", () => {
    const items = [{ product_id: "p1", color: null, size: null, shown_cents: 1000, current_cents: 1500 }];
    const err = new PriceChangedError(items);
    expect(err.name).toBe("PriceChangedError");
    expect(err.items).toBe(items);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("TotalsChangedError", () => {
  test("lleva los totales recalculados por el server", () => {
    const e = new TotalsChangedError(4200, 750);
    expect(e.ship_total_cents).toBe(4200);
    expect(e.tax_cents).toBe(750);
    expect(e.message).toBe("totals_changed");
  });
});
