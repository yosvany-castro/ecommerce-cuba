import { describe, expect, it } from "vitest";
import { attrsOf, CATS, catOf, fmt, ratingLine, sectionize, stripe, weightLbFor } from "@/components/tuki/lib";
import type { StorefrontCard } from "@/storefront/contract";

const card = (id: string, category: string, attrs?: StorefrontCard["attrs"]): StorefrontCard => ({
  id, title: "p" + id, price_cents: 1000, currency: "USD", image_url: null,
  category,
  ...(attrs !== undefined ? { attrs } : {}),
});

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
  it("weightLbFor es determinístico y positivo (único dato sintético que queda, uso interno de envío)", () => {
    const w1 = weightLbFor("3f2b8c31-3a71-4b06-91ec-9217efa5e48b", "ropa");
    const w2 = weightLbFor("3f2b8c31-3a71-4b06-91ec-9217efa5e48b", "ropa");
    expect(w1).toBe(w2);
    expect(w1).toBeGreaterThan(0);
  });
  it("attrsOf: sin attrs (producto sin datos curables) -> todo vacío/undefined, nada inventado", () => {
    const c = card("id-1", "ropa");
    const da = attrsOf(c);
    expect(da.rating).toBeUndefined();
    expect(da.sold).toBeUndefined();
    expect(da.oldPriceCents).toBeNull();
    expect(da.colors).toEqual([]);
    expect(da.sizes).toEqual([]);
    expect(da.weightLb).toBeGreaterThan(0);
  });
  it("attrsOf: attrs={} (real sin datos curables) -> igual de vacío, sin fallback a nada demo", () => {
    const da = attrsOf(card("id-1", "ropa", {}));
    expect(da.rating).toBeUndefined();
    expect(da.sold).toBeUndefined();
    expect(da.oldPriceCents).toBeNull();
    expect(da.colors).toEqual([]);
    expect(da.sizes).toEqual([]);
  });
  it("attrsOf: usa colors/sizes/old_price_cents/rating/sold reales cuando vienen", () => {
    const da = attrsOf(
      card("id-1", "ropa", { colors: [{ name: "Rojo", hex: "#F00" }], sizes: ["M"], old_price_cents: 3000, rating: 4.9, sold: "3.4k" }),
    );
    expect(da.colors).toEqual([{ name: "Rojo", hex: "#F00" }]);
    expect(da.sizes).toEqual(["M"]);
    expect(da.oldPriceCents).toBe(3000);
    expect(da.rating).toBe(4.9);
    expect(da.sold).toBe("3.4k");
  });
  it("attrsOf: weightLb siempre sintético, no depende de attrs", () => {
    const a = attrsOf(card("id-1", "ropa"));
    const b = attrsOf(card("id-1", "ropa", { rating: 4.9 }));
    expect(a.weightLb).toBe(b.weightLb);
  });
  it("ratingLine: combina rating+sold reales, cae a lo que haya, null si no hay nada (sin inventar)", () => {
    expect(ratingLine(4.8, "1.6k")).toBe("★ 4.8 · 1.6k vendidos");
    expect(ratingLine(4.8, undefined)).toBe("★ 4.8");
    expect(ratingLine(undefined, "1.6k")).toBe("1.6k vendidos");
    expect(ratingLine(undefined, undefined)).toBeNull();
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
