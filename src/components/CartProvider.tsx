"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface CartItem {
  product_id: string;
  quantity: number;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

function localKey(): string {
  return `cart:${getCookie("anonymous_id") ?? "anon"}`;
}

function readLocal(): CartItem[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(localKey());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is CartItem =>
        typeof i?.product_id === "string" && typeof i?.quantity === "number" && i.quantity > 0,
    );
  } catch {
    return [];
  }
}

function writeLocal(items: CartItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(localKey(), JSON.stringify(items));
}

async function trackEvent(body: Record<string, unknown>) {
  return fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

interface CartContextValue {
  items: CartItem[];
  loading: boolean;
  add: (productId: string, qty?: number) => Promise<void>;
  remove: (productId: string, qty?: number) => Promise<void>;
  clear: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children, isLoggedIn }: { children: React.ReactNode; isLoggedIn: boolean }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (isLoggedIn) {
      const r = await fetch("/api/cart");
      if (r.ok) {
        const body = await r.json();
        setItems(body.items as CartItem[]);
      }
    } else {
      setItems(readLocal());
    }
    setLoading(false);
  }, [isLoggedIn]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback(
    async (productId: string, qty = 1) => {
      if (isLoggedIn) {
        await fetch("/api/cart", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ product_id: productId, quantity: qty }),
        });
      } else {
        const next = [...readLocal()];
        const existing = next.find((i) => i.product_id === productId);
        if (existing) existing.quantity += qty;
        else next.push({ product_id: productId, quantity: qty });
        writeLocal(next);
        setItems(next);
      }
      await trackEvent({
        event_type: "add_to_cart",
        occurred_at: new Date().toISOString(),
        payload: { product_id: productId, quantity: qty },
      });
      if (isLoggedIn) await refresh();
    },
    [isLoggedIn, refresh],
  );

  const remove = useCallback(
    async (productId: string, qty = 1) => {
      if (isLoggedIn) {
        await fetch("/api/cart", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ product_id: productId, quantity: qty }),
        });
      } else {
        const next = readLocal().flatMap((i) => {
          if (i.product_id !== productId) return [i];
          const newQty = i.quantity - qty;
          return newQty > 0 ? [{ product_id: productId, quantity: newQty }] : [];
        });
        writeLocal(next);
        setItems(next);
      }
      await trackEvent({
        event_type: "remove_from_cart",
        occurred_at: new Date().toISOString(),
        payload: { product_id: productId, quantity: qty },
      });
      if (isLoggedIn) await refresh();
    },
    [isLoggedIn, refresh],
  );

  const clear = useCallback(async () => {
    if (!isLoggedIn) {
      writeLocal([]);
      setItems([]);
    } else {
      await fetch("/api/cart", { method: "DELETE" });
      await refresh();
    }
  }, [isLoggedIn, refresh]);

  return (
    <CartContext.Provider value={{ items, loading, add, remove, clear, refresh }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
