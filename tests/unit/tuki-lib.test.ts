import { describe, expect, it } from "vitest";
import { CATS, catOf, demoAttrs, fmt, mergeAttrs, sectionize, stripe } from "@/components/tuki/lib";

const card = (id: string, category: string) => ({
  id, title: "p" + id, price_cents: 1000, currency: "USD", image_url: null,
  category,
}) as never;

describe("tuki lib", () => {
  it("fmt convierte centavos", () => {
    expect(fmt(2499)).toBe("$24.99");
    expect(fmt(0)).toBe("$0.00");
  });
  it("CATS cubre la taxonomía real y catOf hace fallback a otros", () => {
    for (const k of ["ropa", "electronica", "hogar", "juguetes_bebe", "belleza", "otros"]) expect(CATS[k]).toBeDefined();
    expect(catOf("no-existe").id).toBe("otros");
    expect(catOf(null).id).toBe("otros");
    expect(stripe(CATS.hogar)).toContain("repeating-linear-gradient");
  });
  it("demoAttrs es determinístico y acotado", () => {
    const a1 = demoAttrs("3f2b8c31-3a71-4b06-91ec-9217efa5e48b", "ropa", 2490);
    const a2 = demoAttrs("3f2b8c31-3a71-4b06-91ec-9217efa5e48b", "ropa", 2490);
    expect(a1).toEqual(a2);
    expect(a1.rating).toBeGreaterThanOrEqual(4.3);
    expect(a1.rating).toBeLessThanOrEqual(4.9);
    expect(a1.sizes.length).toBeGreaterThan(0); // ropa lleva tallas
    if (a1.oldPriceCents !== null) expect(a1.oldPriceCents).toBeGreaterThan(2490);
    expect(demoAttrs("otro-id", "electronica", 2490).sizes).toEqual([]); // electronica sin tallas
    expect(a1.weightLb).toBeGreaterThan(0);
  });
  it("mergeAttrs: sin attrs (producto mock) devuelve demo intacto", () => {
    const da = demoAttrs("id-1", "ropa", 2490);
    expect(mergeAttrs(da, undefined)).toEqual(da);
  });
  it("mergeAttrs: attrs presente con colors reales los usa (no demo)", () => {
    const da = demoAttrs("id-1", "ropa", 2490);
    const merged = mergeAttrs(da, { colors: [{ name: "Rojo", hex: "#F00" }] });
    expect(merged.colors).toEqual([{ name: "Rojo", hex: "#F00" }]);
  });
  it("mergeAttrs: attrs presente sin old_price_cents -> null, NO fallback a demo (honestidad)", () => {
    const da = demoAttrs("id-1", "ropa", 2490); // puede o no traer oldPriceCents demo
    const merged = mergeAttrs(da, { rating: 4.8 });
    expect(merged.oldPriceCents).toBeNull();
  });
  it("mergeAttrs: attrs presente sin colors/sizes -> vacíos, NO fallback a demo", () => {
    const da = demoAttrs("id-1", "ropa", 2490); // ropa siempre trae sizes demo
    const merged = mergeAttrs(da, { rating: 4.8 });
    expect(merged.colors).toEqual([]);
    expect(merged.sizes).toEqual([]);
  });
  it("mergeAttrs: rating/sold caen a demo cuando attrs no los trae (cosmética)", () => {
    const da = demoAttrs("id-1", "ropa", 2490);
    const merged = mergeAttrs(da, { colors: [{ name: "Rojo" }] });
    expect(merged.rating).toBe(da.rating);
    expect(merged.sold).toBe(da.sold);
  });
  it("mergeAttrs: rating/sold reales pisan al demo cuando están", () => {
    const da = demoAttrs("id-1", "ropa", 2490);
    const merged = mergeAttrs(da, { rating: 4.9, sold: "3.4k" });
    expect(merged.rating).toBe(4.9);
    expect(merged.sold).toBe("3.4k");
  });
  it("mergeAttrs: weightLb siempre demo (ninguna fuente trae peso)", () => {
    const da = demoAttrs("id-1", "ropa", 2490);
    const merged = mergeAttrs(da, { rating: 4.9 });
    expect(merged.weightLb).toBe(da.weightLb);
  });
  it("mergeAttrs: attrs={} (real sin datos curables) -> old null/colors []/sizes [] pero rating/sold demo (F4 review)", () => {
    const da = demoAttrs("id-1", "ropa", 2490);
    const merged = mergeAttrs(da, {});
    expect(merged.oldPriceCents).toBeNull();
    expect(merged.colors).toEqual([]);
    expect(merged.sizes).toEqual([]);
    expect(merged.rating).toBe(da.rating);
    expect(merged.sold).toBe(da.sold);
  });
  it("sectionize agrupa en [aisle6, focus1, grid4] cíclico sin perder cards", () => {
    const cards = Array.from({ length: 13 }, (_, i) => card(String(i), "hogar"));
    const secs = sectionize(cards);
    expect(secs.map((s) => s.kind)).toEqual(["aisle", "focus", "grid", "aisle"]);
    expect(secs.flatMap((s) => s.cards)).toHaveLength(13);
    expect(secs[0].title.length).toBeGreaterThan(0);
    expect(secs[0].cat.id).toBe("hogar");
  });
});
