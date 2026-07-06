// tests/unit/storefront-card-category.test.ts
import { describe, expect, it } from "vitest";
import { toCard } from "@/storefront/map";

describe("toCard", () => {
  it("propaga metadata.category al StorefrontCard", () => {
    const c = toCard(
      {
        id: "x", title: "t", description: "", price_cents: 100, currency: "USD",
        image_url: null, metadata: { category: "hogar" }, created_at: "2026-01-01",
      } as never,
      "por algo",
      3,
    );
    expect(c.category).toBe("hogar");
    expect(c.reason).toBe("por algo");
  });
  it("category null si metadata no la trae", () => {
    const c = toCard({
      id: "x", title: "t", description: "", price_cents: 100, currency: "USD",
      image_url: null, metadata: {}, created_at: "",
    } as never);
    expect(c.category).toBeNull();
  });
  it("attrs undefined si metadata.attrs ausente", () => {
    const c = toCard({
      id: "x", title: "t", description: "", price_cents: 100, currency: "USD",
      image_url: null, metadata: { category: "hogar" }, created_at: "",
    } as never);
    expect(c.attrs).toBeUndefined();
  });
  it("metadata.attrs={} (real sin datos curables) -> card.attrs={}, NO undefined (F4 review)", () => {
    const c = toCard({
      id: "x", title: "t", description: "", price_cents: 100, currency: "USD",
      image_url: null, metadata: { category: "hogar", attrs: {} }, created_at: "",
    } as never);
    expect(c.attrs).toEqual({});
  });
  it("mapea metadata.attrs a card.attrs: colors tal cual, orders numérico -> sold formateado 'k'", () => {
    const c = toCard({
      id: "x", title: "t", description: "", price_cents: 100, currency: "USD",
      image_url: null,
      metadata: { category: "hogar", attrs: { colors: [{ name: "Rojo", hex: "#F00" }], rating: 4.7, orders: 2300, old_price_cents: 500, sizes: ["M"], images: ["/a.jpg"] } },
      created_at: "",
    } as never);
    expect(c.attrs).toEqual({
      colors: [{ name: "Rojo", hex: "#F00" }],
      rating: 4.7,
      sold: "2.3k",
      old_price_cents: 500,
      sizes: ["M"],
      images: ["/a.jpg"],
    });
  });
  it("mapea orders string tal cual (sin formatear)", () => {
    const c = toCard({
      id: "x", title: "t", description: "", price_cents: 100, currency: "USD",
      image_url: null,
      metadata: { attrs: { orders: "50+" } },
      created_at: "",
    } as never);
    expect(c.attrs?.sold).toBe("50+");
  });
  it("orders numérico bajo (<1000) queda tal cual sin sufijo k", () => {
    const c = toCard({
      id: "x", title: "t", description: "", price_cents: 100, currency: "USD",
      image_url: null,
      metadata: { attrs: { orders: 340 } },
      created_at: "",
    } as never);
    expect(c.attrs?.sold).toBe("340");
  });
  it("orders string con sufijo 'sold' del proveedor -> se quita (el UI ya añade el suyo, F4 review)", () => {
    const c = toCard({
      id: "x", title: "t", description: "", price_cents: 100, currency: "USD",
      image_url: null,
      metadata: { attrs: { orders: "10,000+ sold" } },
      created_at: "",
    } as never);
    expect(c.attrs?.sold).toBe("10,000+");
  });
});
