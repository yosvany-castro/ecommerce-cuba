import { describe, test, expect } from "vitest";
import { curateAttrs, attrsForStorage } from "@/sectors/b-catalog/enrichment/attrs";

describe("curateAttrs", () => {
  test("full valid attrs pass through", () => {
    const out = curateAttrs({
      colors: ["Rojo", "Azul"],
      sizes: ["S", "M", "L"],
      images: ["https://img/1.jpg", "https://img/2.jpg"],
      old_price_cents: 2999,
      rating: 4.5,
      orders: "10,000+ sold",
      brand: "Acme",
    });
    expect(out).toEqual({
      colors: [{ name: "Rojo" }, { name: "Azul" }],
      sizes: ["S", "M", "L"],
      images: ["https://img/1.jpg", "https://img/2.jpg"],
      old_price_cents: 2999,
      rating: 4.5,
      orders: "10,000+ sold",
      brand: "Acme",
    });
  });

  test("old mock attrs {generated, seedIndex, cat} → undefined (no key in whitelist)", () => {
    expect(curateAttrs({ generated: true, seedIndex: 3, cat: "x" })).toBeUndefined();
  });

  test("empty object → undefined", () => {
    expect(curateAttrs({})).toBeUndefined();
  });

  test("old_price_cents as numeric string is discarded (not an integer)", () => {
    const out = curateAttrs({ old_price_cents: "12.34", brand: "Acme" });
    expect(out).toEqual({ brand: "Acme" });
  });

  test("old_price_cents non-positive or non-integer float is discarded", () => {
    expect(curateAttrs({ old_price_cents: 0 })).toBeUndefined();
    expect(curateAttrs({ old_price_cents: -100 })).toBeUndefined();
    expect(curateAttrs({ old_price_cents: 12.5 })).toBeUndefined();
  });

  test("rating out of 0-5 range is discarded", () => {
    expect(curateAttrs({ rating: 7 })).toBeUndefined();
    expect(curateAttrs({ rating: -1 })).toBeUndefined();
    const out = curateAttrs({ rating: 5 });
    expect(out).toEqual({ rating: 5 });
  });

  test("rating: 0 is preserved as valid boundary", () => {
    const out = curateAttrs({ rating: 0 });
    expect(out).toEqual({ rating: 0 });
  });

  test("mixed colors (objects + strings) normalize consistently to {name} objects", () => {
    const out = curateAttrs({ colors: [{ name: "Rojo" }, "Azul"] });
    expect(out).toEqual({ colors: [{ name: "Rojo" }, { name: "Azul" }] });
  });

  test("color objects preserve a valid hex alongside name", () => {
    const out = curateAttrs({ colors: [{ name: "Rojo", hex: "#ff0000" }] });
    expect(out).toEqual({ colors: [{ name: "Rojo", hex: "#ff0000" }] });
  });

  test("invalid color entries (empty string, object with no name) are dropped", () => {
    const out = curateAttrs({ colors: ["", { hex: "#fff" }, "Verde"] });
    expect(out).toEqual({ colors: [{ name: "Verde" }] });
  });

  test("images capped at 12", () => {
    const images = Array.from({ length: 20 }, (_, i) => `https://img/${i}.jpg`);
    const out = curateAttrs({ images });
    expect(out!.images).toHaveLength(12);
    expect(out!.images).toEqual(images.slice(0, 12));
  });

  test("colors and sizes also capped at 12", () => {
    const sizes = Array.from({ length: 15 }, (_, i) => `S${i}`);
    const colors = Array.from({ length: 15 }, (_, i) => `C${i}`);
    const out = curateAttrs({ sizes, colors });
    expect(out!.sizes).toHaveLength(12);
    expect(out!.colors).toHaveLength(12);
  });

  test("sizes/images with empty strings or non-strings are dropped, not counted", () => {
    const out = curateAttrs({ sizes: ["S", "", "M", 42, null] });
    expect(out).toEqual({ sizes: ["S", "M"] });
  });

  test("orders accepts string or number", () => {
    expect(curateAttrs({ orders: "1,200 sold" })).toEqual({ orders: "1,200 sold" });
    expect(curateAttrs({ orders: 1200 })).toEqual({ orders: 1200 });
    expect(curateAttrs({ orders: true })).toBeUndefined();
  });

  test("orders: 0 is preserved as valid boundary", () => {
    const out = curateAttrs({ orders: 0 });
    expect(out).toEqual({ orders: 0 });
  });

  test("brand: empty/whitespace string discarded, non-string discarded", () => {
    expect(curateAttrs({ brand: "" })).toBeUndefined();
    expect(curateAttrs({ brand: "   " })).toBeUndefined();
    expect(curateAttrs({ brand: 123 })).toBeUndefined();
    expect(curateAttrs({ brand: "Nike" })).toEqual({ brand: "Nike" });
  });

  test("unknown keys are stripped even alongside valid ones", () => {
    const out = curateAttrs({ brand: "Nike", material: "cotton", weight_kg: 2 });
    expect(out).toEqual({ brand: "Nike" });
  });
});

describe("attrsForStorage (hueco de honestidad — F4 review)", () => {
  test("mock viejo (generated: true) sin atributos curables -> undefined (sin attrs key, comportamiento actual)", () => {
    expect(attrsForStorage({ generated: true, seedIndex: 3, cat: "x" })).toBeUndefined();
  });

  test("producto real (sin generated) sin atributos curables -> {} (real sin datos, honesto, NO undefined)", () => {
    expect(attrsForStorage({})).toEqual({});
    expect(attrsForStorage({ material: "cotton" })).toEqual({});
  });

  test("producto real con atributos curables -> objeto curado tal cual", () => {
    expect(attrsForStorage({ brand: "Nike", rating: 4.5 })).toEqual({ brand: "Nike", rating: 4.5 });
  });
});
