// src/components/tuki/filters.ts — lógica pura de filtros/orden del listado Tuki.
// Misma semántica que applyAdv del diseño (dc.html 1097–1111), en cents.
import type { StorefrontCard } from "@/storefront/contract";
import type { ProductAttrs } from "./lib";
import { estimateDelivery } from "@/lib/delivery";
import { colorEs } from "./lib";

export interface AdvState {
  sort: "rel" | "asc" | "desc" | "top";
  price: "p1" | "p2" | "p3" | "p4" | null;
  colors: string[];
  oferta: boolean;
  r4: boolean;
  stores: string[];
  sizes: string[];
  /** "llega antes de": máximo de días del rango estimado (vía aérea). */
  etaMax: number | null;
}
export interface FilterableCard {
  card: StorefrontCard;
  attrs: ProductAttrs;
}

export const EMPTY_ADV: AdvState = { sort: "rel", price: null, colors: [], oferta: false, r4: false, stores: [], sizes: [], etaMax: null };

// Labels compartidos por el drawer y las pills removibles (v2).
export const PRICE_LABELS: Record<NonNullable<AdvState["price"]>, string> = {
  p1: "Hasta $15",
  p2: "$15–30",
  p3: "$30–50",
  p4: "$50+",
};
export const SORT_LABELS: Record<AdvState["sort"], string> = {
  rel: "Para ti ✦",
  asc: "Precio ↑",
  desc: "Precio ↓",
  top: "Mejor valorados",
};

// Productos reales (Apify) traen nombres de color en inglés ("Black"); los chips del
// filtro (FILTER_COLORS, tuki/lib.ts) son en español. Sin este alias, un color real
// nunca matchea un chip y el filtro oculta todo producto real (F4 review).
const COLOR_ALIAS_EN_ES: Record<string, string> = {
  black: "negro",
  blue: "azul",
  green: "verde",
  gray: "gris",
  grey: "gris",
  cream: "crema",
  beige: "crema",
  ivory: "crema",
  terracotta: "terracota",
  orange: "terracota",
  brown: "terracota",
};

/** Nombre de color mostrable y comparable: alias EN→ES, capitalizado. */
export function colorLabel(productColorName: string): string {
  const lc = productColorName.trim().toLowerCase();
  const es = COLOR_ALIAS_EN_ES[lc];
  return es ? es.charAt(0).toUpperCase() + es.slice(1) : colorEs(productColorName);
}

function colorMatches(productColorName: string, selected: string[]): boolean {
  const es = colorLabel(productColorName).toLowerCase();
  return selected.some((c) => c.toLowerCase() === es);
}

/** Días máximos estimados (aéreo) — el mismo cálculo que la tarjeta y la PDP. */
export const etaMaxOf = (x: FilterableCard) => estimateDelivery(x.card.source, "aereo").maxDays;

/** Cuenta filtros activos (para el "Más filtros · N"). sort≠rel cuenta como 1. */
export function advCount(a: AdvState): number {
  return (
    (a.oferta ? 1 : 0) + (a.r4 ? 1 : 0) + (a.price ? 1 : 0) + (a.colors.length ? 1 : 0) +
    (a.stores.length ? 1 : 0) + (a.sizes.length ? 1 : 0) + (a.etaMax !== null ? 1 : 0)
  );
}

const PRICE_TEST: Record<NonNullable<AdvState["price"]>, (c: number) => boolean> = {
  p1: (c) => c < 1500,
  p2: (c) => c >= 1500 && c < 3000,
  p3: (c) => c >= 3000 && c < 5000,
  p4: (c) => c >= 5000,
};

type Facet = "price" | "colors" | "stores" | "sizes" | "etaMax";

/** Filtra y ordena. `except`: ignora esa faceta — para contar las opciones de
 * una faceta contra todo lo DEMÁS que está elegido (patrón estándar de tienda). */
export function applyFilters(list: FilterableCard[], adv: AdvState, except?: Facet): FilterableCard[] {
  let l = list;
  if (except !== "stores" && adv.stores.length) l = l.filter((x) => adv.stores.includes(x.card.source ?? ""));
  if (except !== "sizes" && adv.sizes.length) l = l.filter((x) => x.attrs.sizes.some((sz) => adv.sizes.includes(sz)));
  if (except !== "etaMax" && adv.etaMax !== null) l = l.filter((x) => etaMaxOf(x) <= adv.etaMax!);
  if (adv.oferta) l = l.filter((x) => x.attrs.oldPriceCents != null);
  // Sin rating real no puede afirmar "4.6+" — se excluye, no se le inventa un 0.
  if (adv.r4) l = l.filter((x) => x.attrs.rating != null && x.attrs.rating >= 4.6);
  if (except !== "price" && adv.price) l = l.filter((x) => PRICE_TEST[adv.price!](x.card.price_cents));
  if (except !== "colors" && adv.colors.length) l = l.filter((x) => x.attrs.colors.some((c) => colorMatches(c.name, adv.colors)));
  if (adv.sort === "asc") l = l.slice().sort((a, b) => a.card.price_cents - b.card.price_cents);
  if (adv.sort === "desc") l = l.slice().sort((a, b) => b.card.price_cents - a.card.price_cents);
  if (adv.sort === "top") l = l.slice().sort((a, b) => (b.attrs.rating ?? 0) - (a.attrs.rating ?? 0));
  return l;
}

export interface FacetOption<V> {
  value: V;
  label: string;
  count: number;
}

export const STORE_LABELS: Record<string, string> = { amazon: "Amazon", aliexpress: "AliExpress", shein: "Shein", walmart: "Walmart", temu: "Temu" };

function tally<V>(list: FilterableCard[], keysOf: (x: FilterableCard) => V[]): Map<V, number> {
  const m = new Map<V, number>();
  for (const x of list) for (const k of new Set(keysOf(x))) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

/** Opciones REALES de cada faceta con su cantidad, contadas contra los demás
 * filtros activos. Opciones con 0 no se devuelven (jamás ofrecer un callejón). */
export function facetOptions(list: FilterableCard[], adv: AdvState) {
  // lo ELEGIDO siempre sigue en la lista (aunque quede en 0) para poder quitarlo
  const keep = <V,>(opts: FacetOption<V>[], selected: V[], label: (v: V) => string): FacetOption<V>[] => [
    ...opts,
    ...selected.filter((v) => !opts.some((o) => o.value === v)).map((value) => ({ value, label: label(value), count: 0 })),
  ];
  const price = tally(applyFilters(list, adv, "price"), (x) =>
    (Object.keys(PRICE_TEST) as NonNullable<AdvState["price"]>[]).filter((k) => PRICE_TEST[k](x.card.price_cents)),
  );
  const stores = tally(applyFilters(list, adv, "stores"), (x) => [x.card.source ?? ""]);
  const colors = tally(applyFilters(list, adv, "colors"), (x) => x.attrs.colors.map((c) => colorLabel(c.name)));
  const sizes = tally(applyFilters(list, adv, "sizes"), (x) => x.attrs.sizes);
  // "llega antes de": cada máximo distinto es un corte; cuenta acumulada.
  const etaBase = applyFilters(list, adv, "etaMax").map(etaMaxOf);
  const etaCuts = [...new Set(adv.etaMax !== null ? [...etaBase, adv.etaMax] : etaBase)].sort((a, b) => a - b);
  const byCount = <V,>(m: Map<V, number>, label: (v: V) => string): FacetOption<V>[] =>
    [...m.entries()].filter(([v, n]) => n > 0 && v !== "").sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: label(value), count }));
  return {
    price: (Object.keys(PRICE_LABELS) as NonNullable<AdvState["price"]>[])
      .filter((k) => (price.get(k) ?? 0) > 0 || k === adv.price)
      .map((k) => ({ value: k, label: PRICE_LABELS[k], count: price.get(k) ?? 0 })),
    stores: keep(byCount(stores, (v) => STORE_LABELS[v] ?? v), adv.stores, (v) => STORE_LABELS[v] ?? v),
    colors: keep(byCount(colors, (v) => v), adv.colors, (v) => v),
    sizes: keep(byCount(sizes, (v) => v), adv.sizes, (v) => v),
    eta: etaCuts.map((d) => ({ value: d, label: "", count: etaBase.filter((x) => x <= d).length })),
  };
}
