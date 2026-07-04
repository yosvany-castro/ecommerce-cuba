"use client";
// src/components/tuki/cart.tsx — provider client del carrito Tuki.
// Composición requerida: <ToastProvider><TukiCartProvider>…</TukiCartProvider></ToastProvider>
// (TukiCartProvider consume useToast, así que ToastProvider debe envolverlo desde fuera).
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { track } from "@/lib/client/track";
import { useToast } from "./Toast";
import {
  addItem,
  cartWeightLb,
  removeItem as removeItemCore,
  setQty as setQtyCore,
  subtotalCents,
  type CardSnapshot,
  type TukiCartItem,
} from "./cart-core";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

function localKey(): string {
  return `tuki_cart:${getCookie("anonymous_id") ?? "anon"}`;
}

function readLocal(): TukiCartItem[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(localKey());
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TukiCartItem[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(items: TukiCartItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(localKey(), JSON.stringify(items));
}

interface TukiCartContextValue {
  items: TukiCartItem[];
  count: number;
  subtotal: number;
  weightLb: number;
  hydrated: boolean;
  open: boolean;
  setOpen(v: boolean): void;
  add(snap: CardSnapshot, qty?: number, color?: string | null, size?: string | null): void;
  inc(key: string): void;
  dec(key: string): void;
  remove(key: string): void;
  clear(): void;
}

const TukiCartContext = createContext<TukiCartContextValue | null>(null);

export function TukiCartProvider({ children }: { children: React.ReactNode }) {
  // SSR guard: primer render vacío en server y cliente por igual; localStorage
  // se lee recién en el effect (evita mismatch de hidratación). Costo: un
  // "parpadeo" de carrito vacío en el primer paint del cliente antes del effect.
  const [items, setItems] = useState<TukiCartItem[]>([]);
  const [open, setOpen] = useState(false);
  // hydrated=false hasta que el effect lee localStorage: distingue "carrito vacío
  // de verdad" de "aún no cargó" (primer paint siempre vacío por el SSR guard).
  const [hydrated, setHydrated] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    setItems(readLocal());
    setHydrated(true);
  }, []);

  const add = useCallback(
    (snap: CardSnapshot, qty = 1, color: string | null = null, size: string | null = null) => {
      const next = addItem(readLocal(), snap, qty, color, size);
      writeLocal(next);
      setItems(next);
      track("add_to_cart", { product_id: snap.id, quantity: qty }, { urgent: true });
      showToast(`✓ agregado — ${snap.title}`);
    },
    [showToast],
  );

  const inc = useCallback((key: string) => {
    const next = setQtyCore(readLocal(), key, 1);
    writeLocal(next);
    setItems(next);
  }, []);

  const dec = useCallback((key: string) => {
    const next = setQtyCore(readLocal(), key, -1);
    writeLocal(next);
    setItems(next);
  }, []);

  const remove = useCallback((key: string) => {
    const current = readLocal();
    const item = current.find((i) => i.key === key);
    const next = removeItemCore(current, key);
    writeLocal(next);
    setItems(next);
    if (item) track("remove_from_cart", { product_id: item.product_id, quantity: item.qty }, { urgent: true });
  }, []);

  const clear = useCallback(() => {
    writeLocal([]);
    setItems([]);
  }, []);

  const value: TukiCartContextValue = {
    items,
    count: items.reduce((sum, i) => sum + i.qty, 0),
    subtotal: subtotalCents(items),
    weightLb: cartWeightLb(items),
    hydrated,
    open,
    setOpen,
    add,
    inc,
    dec,
    remove,
    clear,
  };

  return <TukiCartContext.Provider value={value}>{children}</TukiCartContext.Provider>;
}

export function useTukiCart(): TukiCartContextValue {
  const ctx = useContext(TukiCartContext);
  if (!ctx) throw new Error("useTukiCart must be used inside <TukiCartProvider>");
  return ctx;
}
