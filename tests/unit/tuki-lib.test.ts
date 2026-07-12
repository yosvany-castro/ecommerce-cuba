import { describe, expect, it } from "vitest";
import {
  attrsOf,
  CATS,
  catOf,
  fmt,
  hasPriceRange,
  imageForColor,
  matchVariant,
  minPriceCents,
  ratingLine,
  resolveColorHex,
  sectionize,
  stripe,
  weightLbFor,
} from "@/components/tuki/lib";
import type { StorefrontCard } from "@/storefront/contract";

const card = (id: string, category: string, attrs?: StorefrontCard["attrs"]): StorefrontCard => ({
  id, title: "p" + id, price_cents: 1000, currency: "USD", image_url: null,
  category, source: "aliexpress",
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
  it("matchVariant: PDP reacciona a la selección color/talla (precio/foto/stock por combinación)", () => {
    const variants = [
      { color: "Rojo", size: "M", price_cents: 1200, image: "/rojo-m.jpg" },
      { color: "Azul", size: "M", price_cents: 1300, available: false },
    ];
    expect(matchVariant(variants, "Rojo", "M")).toEqual(variants[0]);
    expect(matchVariant(variants, "Azul", "M")?.available).toBe(false);
    expect(matchVariant(variants, "Verde", "M")).toBeUndefined();
    expect(matchVariant(variants, null, null)).toBeUndefined();
    expect(matchVariant(undefined, "Rojo", "M")).toBeUndefined();
  });

  it("imageForColor: basta el color (a diferencia de matchVariant, no exige talla) — arregla el bug de la foto que no cambiaba", () => {
    const variants = [
      { color: "Rojo", size: "M", image: "/rojo-m.jpg" },
      { color: "Rojo", size: "L" }, // sin foto propia
      { color: "Azul", size: "M", image: "/azul-m.jpg" },
    ];
    // color elegido, talla TODAVÍA sin elegir (null) — matchVariant no matchearía nada acá.
    expect(imageForColor(variants, "Rojo")).toBe("/rojo-m.jpg");
    expect(imageForColor(variants, "Azul")).toBe("/azul-m.jpg");
    expect(imageForColor(variants, "Verde")).toBeUndefined();
    expect(imageForColor(variants, null)).toBeUndefined();
    expect(imageForColor(undefined, "Rojo")).toBeUndefined();
  });

  it("minPriceCents: el menor entre el base y las variantes con price_cents propio", () => {
    const variants = [{ color: "Rojo", price_cents: 1500 }, { color: "Azul", price_cents: 900 }, { color: "Verde" }];
    expect(minPriceCents(1200, variants)).toBe(900); // Azul es el más barato, bajo el base
    expect(minPriceCents(800, variants)).toBe(800); // el base es más barato que cualquier variante
    expect(minPriceCents(1200, undefined)).toBe(1200);
    expect(minPriceCents(1200, [])).toBe(1200);
  });

  it("hasPriceRange: true solo si alguna variante difiere del base (o entre sí) en price_cents", () => {
    expect(hasPriceRange(1000, [{ color: "Rojo", price_cents: 1500 }])).toBe(true);
    expect(hasPriceRange(1000, [{ color: "Rojo", price_cents: 1000 }, { color: "Azul", price_cents: 1000 }])).toBe(false);
    // variantes sin price_cents (p.ej. Amazon: solo color/talla) -> nunca hay rango
    expect(hasPriceRange(1000, [{ color: "Rojo", size: "M" }])).toBe(false);
    expect(hasPriceRange(1000, undefined)).toBe(false);
    expect(hasPriceRange(1000, [])).toBe(false);
  });

  it("resolveColorHex: hex por substring case-insensitive, es/en mezclados, fallback undefined", () => {
    expect(resolveColorHex("Coal Black")).toBe("#1C1D20"); // "Coal Black" -> black
    expect(resolveColorHex("Medium Stone")).toBe("#5E7492"); // "Medium Stone" -> stone(wash)
    expect(resolveColorHex("azul índigo")).toBe("#3D5A80"); // contiene "azul" -> azul genérico, no una entrada propia
    expect(resolveColorHex("Azul Marino")).toBe("#1F3A5F"); // frase compuesta ANTES que "azul" genérico
    expect(resolveColorHex("Rinse")).toBe("#1a2744"); // lavado de jean -> azul propio
    expect(resolveColorHex("blanco")).toBe("#FAFAF8");
    expect(resolveColorHex("WHITE")).toBe("#FAFAF8"); // case-insensitive
    expect(resolveColorHex("café con leche")).toBe("#6B4B3A"); // "café" con tilde
    expect(resolveColorHex("morado oscuro")).toBe("#6B4C8A");
    expect(resolveColorHex("un color inventado que no existe")).toBeUndefined();
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
