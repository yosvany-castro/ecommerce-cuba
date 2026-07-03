import { describe, expect, it } from "vitest";
import { addItem, cartKey, removeItem, setQty, subtotalCents } from "@/components/tuki/cart-core";

const snap = { id: "p1", title: "Producto", price_cents: 2000, category: "hogar", image_url: null };

describe("tuki cart core", () => {
  it("agrega y fusiona por key producto+variante", () => {
    let items = addItem([], snap, 1, "Negro", null);
    items = addItem(items, snap, 2, "Negro", null);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(3);
    items = addItem(items, snap, 1, "Crema", null); // otra variante → otra línea
    expect(items).toHaveLength(2);
    expect(items[0].key).toBe(cartKey("p1", "Negro", null));
  });
  it("setQty clampa a 1 y remove elimina", () => {
    let items = addItem([], snap, 1, null, null);
    items = setQty(items, items[0].key, -5);
    expect(items[0].qty).toBe(1);
    expect(removeItem(items, items[0].key)).toHaveLength(0);
  });
  it("subtotal en centavos", () => {
    const items = addItem(addItem([], snap, 2, null, null), { ...snap, id: "p2", price_cents: 500 }, 1, null, null);
    expect(subtotalCents(items)).toBe(4500);
  });
});
