"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/components/CartProvider";
import { SurfaceSections } from "./SurfaceSections";

/**
 * The add-to-cart MOMENT (E4): the instant the user commits to a product is
 * the highest-intent second of the session — the cross-sell/add-ons section
 * appears RIGHT THERE, under the PDP, resolved by the same engine (cart
 * surface over the WHOLE cart's co-occurrence). Nothing renders until the
 * gesture happens on THIS page (no permanent clutter, no speculative fetch);
 * lo nuevo entra DEBAJO, rotulado — lo visible nunca se reordena.
 */
export function AfterAddSuggestions() {
  const { items } = useCart();
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    const onAdd = () => setTriggered(true);
    window.addEventListener("cart:item-added", onAdd);
    return () => window.removeEventListener("cart:item-added", onAdd);
  }, []);

  if (!triggered || items.length === 0) return null;
  const ids = items.map((i) => i.product_id);
  return (
    <SurfaceSections
      surface="cart"
      surfaceArgs={{ cart_product_ids: ids }}
      refreshKey={ids.sort().join(",")}
    />
  );
}
