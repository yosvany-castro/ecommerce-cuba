import { describe, expect, it } from "vitest";
import { applyFilters } from "@/components/tuki/filters";

const f = (id: string, price: number, rating: number, old: number | null, colors: string[]) => ({
  card: { id, title: id, price_cents: price, currency: "USD", image_url: null } as never,
  attrs: { rating, sold: "1", oldPriceCents: old, colors: colors.map((n) => ({ name: n, hex: "#000" })), sizes: [], weightLb: 1 },
});
const base = [f("a", 1000, 4.4, null, ["Negro"]), f("b", 2500, 4.8, 3000, ["Crema"]), f("c", 6000, 4.6, null, [])];

describe("applyFilters", () => {
  it("oferta filtra por oldPrice, r4 por rating, precio por bandas", () => {
    expect(applyFilters(base, { sort: "rel", price: null, colors: [], oferta: true, envio: false, r4: false }).map((x) => x.card.id)).toEqual(["b"]);
    expect(applyFilters(base, { sort: "rel", price: "p4", colors: [], oferta: false, envio: false, r4: true }).map((x) => x.card.id)).toEqual(["c"]);
  });
  it("sort asc/top", () => {
    expect(applyFilters(base, { sort: "asc", price: null, colors: [], oferta: false, envio: false, r4: false })[0].card.id).toBe("a");
    expect(applyFilters(base, { sort: "top", price: null, colors: [], oferta: false, envio: false, r4: false })[0].card.id).toBe("b");
  });
  it("colors interseca", () => {
    expect(applyFilters(base, { sort: "rel", price: null, colors: ["Crema"], oferta: false, envio: false, r4: false }).map((x) => x.card.id)).toEqual(["b"]);
  });
  it("colors: nombre inglés de producto real ('Black') matchea el chip español 'Negro' (F4 review)", () => {
    const real = [f("d", 1500, 4.5, null, ["Black"])];
    expect(applyFilters(real, { sort: "rel", price: null, colors: ["Negro"], oferta: false, envio: false, r4: false }).map((x) => x.card.id)).toEqual(["d"]);
    expect(applyFilters(real, { sort: "rel", price: null, colors: ["Crema"], oferta: false, envio: false, r4: false })).toEqual([]);
  });
});
