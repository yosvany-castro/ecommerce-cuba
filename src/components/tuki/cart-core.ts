// src/components/tuki/cart-core.ts — lógica pura del carrito Tuki. Sin React, sin browser APIs.
import { demoAttrs } from "./lib";

export interface TukiCartItem {
  key: string;
  product_id: string;
  qty: number;
  color: string | null;
  size: string | null;
  title: string;
  price_cents: number;
  category: string | null;
  image_url: string | null;
}

export interface CardSnapshot {
  id: string;
  title: string;
  price_cents: number;
  category?: string | null;
  image_url: string | null;
}

export function cartKey(productId: string, color: string | null, size: string | null): string {
  return `${productId}|${color ?? ""}|${size ?? ""}`;
}

export function addItem(
  items: TukiCartItem[],
  snap: CardSnapshot,
  qty: number,
  color: string | null,
  size: string | null,
): TukiCartItem[] {
  const key = cartKey(snap.id, color, size);
  const existing = items.find((i) => i.key === key);
  if (existing) {
    return items.map((i) => (i.key === key ? { ...i, qty: i.qty + qty } : i));
  }
  const item: TukiCartItem = {
    key,
    product_id: snap.id,
    qty,
    color,
    size,
    title: snap.title,
    price_cents: snap.price_cents,
    category: snap.category ?? null,
    image_url: snap.image_url,
  };
  return [...items, item];
}

export function setQty(items: TukiCartItem[], key: string, delta: number): TukiCartItem[] {
  return items.map((i) => (i.key === key ? { ...i, qty: Math.max(1, i.qty + delta) } : i));
}

export function removeItem(items: TukiCartItem[], key: string): TukiCartItem[] {
  return items.filter((i) => i.key !== key);
}

export function subtotalCents(items: TukiCartItem[]): number {
  return items.reduce((sum, i) => sum + i.price_cents * i.qty, 0);
}

export function cartWeightLb(items: TukiCartItem[]): number {
  return items.reduce(
    (sum, i) => sum + demoAttrs(i.product_id, i.category, i.price_cents).weightLb * i.qty,
    0,
  );
}
