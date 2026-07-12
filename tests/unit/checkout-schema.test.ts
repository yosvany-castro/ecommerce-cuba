import { describe, test, expect } from "vitest";
import { anonymousCheckoutItemSchema, variantSelectionSchema } from "@/sectors/a-tracking/checkout-schema";

// Valid RFC 4122 v4 UUID (zod 4 enforces version/variant bits)
const validId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

describe("anonymousCheckoutItemSchema", () => {
  test("acepta item sin color/size (compatibilidad hacia atrás)", () => {
    const out = anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1 });
    expect(out.color).toBeUndefined();
    expect(out.size).toBeUndefined();
  });

  test("acepta color y size como strings", () => {
    const out = anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 2, color: "Rojo", size: "M" });
    expect(out).toMatchObject({ color: "Rojo", size: "M" });
  });

  test("acepta null explícito para color/size", () => {
    const out = anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1, color: null, size: null });
    expect(out.color).toBeNull();
    expect(out.size).toBeNull();
  });

  test("rechaza color no-string", () => {
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1, color: 5 })).toThrow();
  });

  test("rechaza product_id inválido", () => {
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: "nope", quantity: 1 })).toThrow();
  });

  test("rechaza quantity fuera de rango (checkout/anonymous/route.ts cota 999)", () => {
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 1000 })).toThrow();
    expect(() => anonymousCheckoutItemSchema.parse({ product_id: validId, quantity: 0 })).toThrow();
  });
});

describe("variantSelectionSchema (checkout autenticado — sin quantity, viene de cart_items)", () => {
  test("no requiere quantity", () => {
    const out = variantSelectionSchema.parse({ product_id: validId, color: "Azul" });
    expect(out.size).toBeUndefined();
  });

  test("acepta solo product_id (sin selección)", () => {
    const out = variantSelectionSchema.parse({ product_id: validId });
    expect(out.color).toBeUndefined();
    expect(out.size).toBeUndefined();
  });

  test("rechaza product_id inválido", () => {
    expect(() => variantSelectionSchema.parse({ product_id: "nope" })).toThrow();
  });
});
