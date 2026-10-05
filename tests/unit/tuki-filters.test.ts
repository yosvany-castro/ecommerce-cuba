import { describe, expect, it } from "vitest";
import { applyFilters, EMPTY_ADV, facetOptions } from "@/components/tuki/filters";

const f = (id: string, price: number, rating: number, old: number | null, colors: string[]) => ({
  card: { id, title: id, price_cents: price, currency: "USD", image_url: null } as never,
  attrs: { rating, sold: "1", oldPriceCents: old, colors: colors.map((n) => ({ name: n, hex: "#000" })), sizes: [], weightLb: 1 },
});
const base = [f("a", 1000, 4.4, null, ["Negro"]), f("b", 2500, 4.8, 3000, ["Crema"]), f("c", 6000, 4.6, null, [])];

describe("applyFilters", () => {
  it("oferta filtra por oldPrice, r4 por rating, precio por bandas", () => {
    expect(applyFilters(base, { sort: "rel", price: null, colors: [], oferta: true, r4: false, stores: [], sizes: [], etaMax: null }).map((x) => x.card.id)).toEqual(["b"]);
    expect(applyFilters(base, { sort: "rel", price: "p4", colors: [], oferta: false, r4: true, stores: [], sizes: [], etaMax: null }).map((x) => x.card.id)).toEqual(["c"]);
  });
  it("sort asc/top", () => {
    expect(applyFilters(base, { sort: "asc", price: null, colors: [], oferta: false, r4: false, stores: [], sizes: [], etaMax: null })[0].card.id).toBe("a");
    expect(applyFilters(base, { sort: "top", price: null, colors: [], oferta: false, r4: false, stores: [], sizes: [], etaMax: null })[0].card.id).toBe("b");
  });
  it("colors interseca", () => {
    expect(applyFilters(base, { sort: "rel", price: null, colors: ["Crema"], oferta: false, r4: false, stores: [], sizes: [], etaMax: null }).map((x) => x.card.id)).toEqual(["b"]);
  });
  it("colors: nombre inglés de producto real ('Black') matchea el chip español 'Negro' (F4 review)", () => {
    const real = [f("d", 1500, 4.5, null, ["Black"])];
    expect(applyFilters(real, { sort: "rel", price: null, colors: ["Negro"], oferta: false, r4: false, stores: [], sizes: [], etaMax: null }).map((x) => x.card.id)).toEqual(["d"]);
    expect(applyFilters(real, { sort: "rel", price: null, colors: ["Crema"], oferta: false, r4: false, stores: [], sizes: [], etaMax: null })).toEqual([]);
  });
});

describe("facetas con cantidades (rediseño 2026-10-05)", () => {
  const mk = (id: string, source: string, price: number, colors: string[], sizes: string[] = []) => ({
    card: { id, title: id, price_cents: price, currency: "USD", image_url: "", category: "ropa", source } as never,
    attrs: { oldPriceCents: null, colors: colors.map((name) => ({ name })), sizes, weightLb: 1 } as never,
  });
  const list = [mk("a", "amazon", 1000, ["Black"], ["M"]), mk("b", "aliexpress", 2000, ["negro", "Blue"], ["S", "M"]), mk("c", "amazon", 6000, [])];
  it("cuenta cada opción contra los DEMÁS filtros y oculta las de 0", () => {
    const f = facetOptions(list, EMPTY_ADV);
    expect(f.stores).toEqual([{ value: "amazon", label: "Amazon", count: 2 }, { value: "aliexpress", label: "AliExpress", count: 1 }]);
    expect(f.colors.find((c) => c.value === "Negro")?.count).toBe(2); // Black + negro = mismo color
    expect(f.price.map((p) => p.value)).toEqual(["p1", "p2", "p4"]); // p3 vacío no se ofrece
    const conAmazon = facetOptions(list, { ...EMPTY_ADV, stores: ["amazon"] });
    expect(conAmazon.stores.length).toBe(2); // la faceta propia no se filtra a sí misma
    expect(conAmazon.sizes).toEqual([{ value: "M", label: "M", count: 1 }]);
  });
  it("tienda, talla y llega-antes filtran", () => {
    expect(applyFilters(list, { ...EMPTY_ADV, stores: ["aliexpress"] }).map((x) => x.card.id)).toEqual(["b"]);
    expect(applyFilters(list, { ...EMPTY_ADV, sizes: ["S"] }).map((x) => x.card.id)).toEqual(["b"]);
    const amazonMax = facetOptions(list, EMPTY_ADV).eta[0].value; // amazon llega antes que aliexpress
    expect(applyFilters(list, { ...EMPTY_ADV, etaMax: amazonMax }).map((x) => x.card.id)).toEqual(["a", "c"]);
  });
});

describe("colorEs (solo presentación)", () => {
  it("traduce colores y pone el modificador detrás", async () => {
    const { colorEs } = await import("@/components/tuki/lib");
    expect(colorEs("Black")).toBe("Negro");
    expect(colorEs("Dark Blue")).toBe("Azul oscuro");
    expect(colorEs("Style 3")).toBe("Style 3"); // no entendido → original
  });
});
