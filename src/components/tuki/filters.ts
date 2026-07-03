// src/components/tuki/filters.ts — lógica pura de filtros/orden del listado Tuki.
// Misma semántica que applyAdv del diseño (dc.html 1097–1111), en cents.
import type { StorefrontCard } from "@/storefront/contract";
import type { DemoAttrs } from "./lib";

export interface AdvState {
  sort: "rel" | "asc" | "desc" | "top";
  price: "p1" | "p2" | "p3" | "p4" | null;
  colors: string[];
  oferta: boolean;
  envio: boolean;
  r4: boolean;
}
export interface FilterableCard {
  card: StorefrontCard;
  attrs: DemoAttrs;
}

export const EMPTY_ADV: AdvState = { sort: "rel", price: null, colors: [], oferta: false, envio: false, r4: false };

/** Cuenta filtros activos (para el "Más filtros · N"). sort≠rel cuenta como 1. */
export function advCount(a: AdvState): number {
  return (a.oferta ? 1 : 0) + (a.r4 ? 1 : 0) + (a.envio ? 1 : 0) + (a.price ? 1 : 0) + (a.colors.length ? 1 : 0) + (a.sort !== "rel" ? 1 : 0);
}

export function applyFilters(list: FilterableCard[], adv: AdvState): FilterableCard[] {
  let l = list;
  if (adv.oferta) l = l.filter((x) => x.attrs.oldPriceCents != null);
  if (adv.r4) l = l.filter((x) => x.attrs.rating >= 4.6);
  if (adv.envio) l = l.filter((x) => x.card.price_cents >= 2000);
  if (adv.price === "p1") l = l.filter((x) => x.card.price_cents < 1500);
  if (adv.price === "p2") l = l.filter((x) => x.card.price_cents >= 1500 && x.card.price_cents < 3000);
  if (adv.price === "p3") l = l.filter((x) => x.card.price_cents >= 3000 && x.card.price_cents < 5000);
  if (adv.price === "p4") l = l.filter((x) => x.card.price_cents >= 5000);
  if (adv.colors.length) l = l.filter((x) => x.attrs.colors.some((c) => adv.colors.includes(c.name)));
  if (adv.sort === "asc") l = l.slice().sort((a, b) => a.card.price_cents - b.card.price_cents);
  if (adv.sort === "desc") l = l.slice().sort((a, b) => b.card.price_cents - a.card.price_cents);
  if (adv.sort === "top") l = l.slice().sort((a, b) => b.attrs.rating - a.attrs.rating);
  return l;
}
