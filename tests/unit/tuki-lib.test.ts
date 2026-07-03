import { describe, expect, it } from "vitest";
import { CATS, catOf, demoAttrs, fmt, sectionize, stripe } from "@/components/tuki/lib";

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
  it("sectionize agrupa en [aisle6, focus1, grid4] cíclico sin perder cards", () => {
    const cards = Array.from({ length: 13 }, (_, i) => card(String(i), "hogar"));
    const secs = sectionize(cards);
    expect(secs.map((s) => s.kind)).toEqual(["aisle", "focus", "grid", "aisle"]);
    expect(secs.flatMap((s) => s.cards)).toHaveLength(13);
    expect(secs[0].title.length).toBeGreaterThan(0);
    expect(secs[0].cat.id).toBe("hogar");
  });
});
