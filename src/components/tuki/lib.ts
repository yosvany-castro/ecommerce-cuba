// src/components/tuki/lib.ts — helpers puros del port Tuki. Sin imports de sectors.
import type { StorefrontCard } from "@/storefront/contract";

export interface CatDef { id: string; label: string; tint: string; deep: string; a: string; b: string }
// Paleta del diseño (dc.html 874–881) reasignada a la taxonomía REAL del catálogo.
export const CATS: Record<string, CatDef> = {
  electronica: { id: "electronica", label: "Electrónica", tint: "#E9F1FB", deep: "#4C6E96", a: "#F2F6FB", b: "#E4EDF8" },
  hogar: { id: "hogar", label: "Hogar", tint: "#EAF2EA", deep: "#557A55", a: "#F0F6F0", b: "#E2EDE2" },
  ropa: { id: "ropa", label: "Ropa", tint: "#F0ECFA", deep: "#6B5BA8", a: "#F5F2FC", b: "#EAE4F6" },
  belleza: { id: "belleza", label: "Belleza", tint: "#FBEDF3", deep: "#A25578", a: "#FBF2F6", b: "#F4E3EB" },
  juguetes_bebe: { id: "juguetes_bebe", label: "Juguetes y bebé", tint: "#E4F2F1", deep: "#3E7F78", a: "#EDF6F5", b: "#DFEEEC" },
  otros: { id: "otros", label: "Otros", tint: "#FBEBEA", deep: "#A25B52", a: "#FAF0EF", b: "#F3E1DF" },
};
export const OFFER_TINT = "#FBEFE2";
export const OFFER_DEEP = "#A2683B";

export function catOf(category: string | null | undefined): CatDef {
  return (category && CATS[category]) || CATS.otros;
}
export function stripe(c: Pick<CatDef, "a" | "b">): string {
  return `repeating-linear-gradient(-45deg, ${c.a}, ${c.a} 9px, ${c.b} 9px, ${c.b} 18px)`;
}
export function fmt(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

// El catálogo es 100% real (A4/Apify): nada de rating/ventas/precio viejo/colores/
// tallas inventados. Solo el peso sigue siendo sintético (determinístico por id) —
// ningún proveedor lo trae y el checkout necesita ALGO para decidir tramos de envío
// (ver checkout-core.ts); no se muestra como "atributo verificado" del producto, es
// un insumo interno del cálculo de tarifa.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const PALETTE = [
  { name: "Negro", hex: "#26262B" }, { name: "Crema", hex: "#EDE6D6" }, { name: "Azul", hex: "#3D4A66" },
  { name: "Verde", hex: "#6B7A5A" }, { name: "Terracota", hex: "#C56B4F" }, { name: "Gris", hex: "#9C9EA3" },
];
export const FILTER_COLORS = PALETTE;
const WEIGHT_BASE: Record<string, number> = { ropa: 0.6, electronica: 1.2, hogar: 3.0, juguetes_bebe: 1.0, belleza: 0.4, otros: 1.5 };

export function weightLbFor(productId: string, category: string | null | undefined): number {
  const h = hash(productId);
  const cat = catOf(category).id;
  return Math.round((WEIGHT_BASE[cat] ?? 1) * (0.5 + (h % 100) / 66) * 10) / 10;
}

export interface ProductAttrs {
  rating?: number;
  sold?: string;
  oldPriceCents: number | null;
  colors: { name: string; hex?: string }[];
  sizes: string[];
  weightLb: number;
}
/** Atributos de UI de una card: 100% lo que trajo el proveedor real (card.attrs),
 * sin relleno inventado. Ausente en `attrs` ⇒ ausente en la UI (sin fallback). */
export function attrsOf(card: StorefrontCard): ProductAttrs {
  const a = card.attrs;
  return {
    rating: a?.rating,
    sold: a?.sold,
    oldPriceCents: a?.old_price_cents ?? null,
    colors: a?.colors ?? [],
    sizes: a?.sizes ?? [],
    weightLb: weightLbFor(card.id, card.category),
  };
}

export type CardVariant = NonNullable<NonNullable<StorefrontCard["attrs"]>["variants"]>[number];

/** Variante cuyos campos DEFINIDOS coinciden con la selección actual (mismo
 * criterio que findVariantPriceCents en b-catalog/enrichment/attrs.ts, pero
 * sin exigir price_cents: acá también interesan foto/disponibilidad). Sin
 * color ni talla pedidos, o sin variantes -> undefined (precio/foto base). */
export function matchVariant(
  variants: CardVariant[] | undefined,
  color: string | null,
  size: string | null,
): CardVariant | undefined {
  if (!variants || (color === null && size === null)) return undefined;
  return variants.find(
    (v) => (v.color === undefined || v.color === color) && (v.size === undefined || v.size === size),
  );
}

/** Primera foto de una variante de ESE color (cualquier talla) — a diferencia
 * de matchVariant (que exige que TODAS las dimensiones pedidas matcheen), acá
 * basta el color: permite cambiar la imagen principal y pintar el swatch con
 * foto real aunque el producto también tenga tallas y el usuario aún no haya
 * elegido ninguna (bug visto: con color+talla sin talla elegida, matchVariant
 * nunca matcheaba y la imagen del color jamás cambiaba). */
export function imageForColor(variants: CardVariant[] | undefined, color: string | null): string | undefined {
  if (!variants || !color) return undefined;
  return variants.find((v) => v.color === color && v.image)?.image;
}

/** Menor precio entre el base y las variantes con price_cents propio — el "desde
 * $X" que se muestra mientras el comprador no eligió color/talla todavía. */
export function minPriceCents(basePriceCents: number, variants: CardVariant[] | undefined): number {
  const variantPrices = (variants ?? []).map((v) => v.price_cents).filter((p): p is number => p != null);
  return Math.min(basePriceCents, ...variantPrices);
}

/** true si alguna variante tiene un price_cents distinto del base (o entre sí)
 * — solo entonces seleccionar color/talla puede CAMBIAR el precio grande, y
 * solo entonces se justifica bloquear "Agregar" hasta que el usuario elija
 * (REGLA DE ORO: el precio nunca salta solo — si no puede saltar, no hace
 * falta bloquear). Variantes sin price_cents (p.ej. Amazon: solo color/talla,
 * sin precio por combinación) no aportan rango -> false, comportamiento actual. */
export function hasPriceRange(basePriceCents: number, variants: CardVariant[] | undefined): boolean {
  const prices = new Set((variants ?? []).map((v) => v.price_cents).filter((p): p is number => p != null));
  prices.add(basePriceCents);
  return prices.size > 1;
}

interface ColorHexEntry {
  match: string[];
  hex: string;
}

// Nombre→hex real (T4, "los filtros deben tener el color que dicen") — sustituye
// el círculo gris (#D8D8D3) que se mostraba cuando el proveedor no trajo hex.
// Orden importa: frases compuestas ANTES que su palabra genérica (p.ej. "azul
// marino" antes que "azul") para que el substring match no se quede con la
// entrada equivocada. Lavados de jean (denim/stonewash/rinse) son azules —
// tonos propios, no el azul genérico.
export const COLOR_HEX: ColorHexEntry[] = [
  { match: ["azul marino", "navy"], hex: "#1F3A5F" },
  { match: ["celeste", "light blue", "sky blue"], hex: "#AFCBE3" },
  { match: ["rinse"], hex: "#1a2744" },
  { match: ["stonewash", "stone"], hex: "#5E7492" },
  { match: ["denim"], hex: "#3B5B7A" },
  { match: ["azul", "blue"], hex: "#3D5A80" },
  { match: ["negro", "black", "coal"], hex: "#1C1D20" },
  { match: ["blanco", "white"], hex: "#FAFAF8" },
  { match: ["rojo", "red"], hex: "#B23A2E" },
  { match: ["vino", "burgundy", "wine", "maroon"], hex: "#5E2129" },
  { match: ["coral"], hex: "#E8836B" },
  { match: ["salmón", "salmon"], hex: "#E39C8E" },
  { match: ["rosa", "pink"], hex: "#E4A6BB" },
  { match: ["fucsia", "fuchsia", "magenta"], hex: "#C13584" },
  { match: ["verde oliva", "olive"], hex: "#6B6B3A" },
  { match: ["verde militar", "military green"], hex: "#5B6650" },
  { match: ["verde", "green"], hex: "#4F7A5C" },
  { match: ["menta", "mint"], hex: "#A6D9C1" },
  { match: ["turquesa", "teal"], hex: "#2E8B8B" },
  { match: ["morado", "purple", "violeta", "violet"], hex: "#6B4C8A" },
  { match: ["lavanda", "lavender"], hex: "#B7A6D9" },
  { match: ["amarillo", "yellow", "mostaza", "mustard"], hex: "#E3B23C" },
  { match: ["naranja", "orange"], hex: "#D9762E" },
  { match: ["dorado", "gold"], hex: "#C6A15B" },
  { match: ["plateado", "silver"], hex: "#B8B9BC" },
  { match: ["gris", "gray", "grey"], hex: "#8E8F94" },
  { match: ["beige"], hex: "#D9CBB0" },
  { match: ["caqui", "khaki"], hex: "#BFB088" },
  { match: ["crema", "cream", "ivory"], hex: "#EDE6D6" },
  { match: ["camel"], hex: "#C19A6B" },
  { match: ["nude"], hex: "#D9B99B" },
  { match: ["terracota", "terracotta"], hex: "#C56B4F" },
  { match: ["marrón", "marron", "brown", "café", "cafe", "chocolate"], hex: "#6B4B3A" },
];

/** Hex por substring case-insensitive sobre el nombre real del color (es/en
 * mezclados) — "Coal Black"→black, "Medium Stone"→stonewash, "azul índigo"→azul
 * (matchea "azul", sin entrada propia para índigo). undefined = sin match,
 * el caller cae al chip de texto (nunca inventa un color que no dijo). */
export function resolveColorHex(name: string): string | undefined {
  const n = name.toLowerCase();
  return COLOR_HEX.find((entry) => entry.match.some((k) => n.includes(k)))?.hex;
}

/** "★ rating · sold vendidos" con lo real que haya; null si no hay nada que mostrar. */
export function ratingLine(rating?: number, sold?: string): string | null {
  if (rating != null && sold != null) return `★ ${rating} · ${sold} vendidos`;
  if (rating != null) return `★ ${rating}`;
  if (sold != null) return `${sold} vendidos`;
  return null;
}

const WHYS = ["elegido para ti", "también encaja contigo", "tendencia hoy en tu zona", "muy pedido esta semana"];
export interface TukiSection { kind: "aisle" | "focus" | "grid"; title: string; why: string; cat: CatDef; cards: StorefrontCard[] }
/** Agrupa cards del feed real en secciones visuales estilo Tuki: [aisle 6, focus 1, grid 4] cíclico. */
export function sectionize(cards: StorefrontCard[], startIndex = 0): TukiSection[] {
  const PATTERN: { kind: TukiSection["kind"]; n: number }[] = [
    { kind: "aisle", n: 6 }, { kind: "focus", n: 1 }, { kind: "grid", n: 4 },
  ];
  const out: TukiSection[] = [];
  let i = 0, p = startIndex;
  while (i < cards.length) {
    const { kind, n } = PATTERN[p % PATTERN.length];
    const chunk = cards.slice(i, i + n);
    if (chunk.length === 0) break;
    const counts = new Map<string, number>();
    for (const c of chunk) {
      const k = catOf((c as { category?: string | null }).category).id;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const domCat = catOf([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]);
    const withReason = chunk.find((c) => c.reason);
    out.push({
      kind, cards: chunk, cat: domCat,
      title: kind === "focus" ? "Una cosa buena" : kind === "grid" ? "Para ti" : `Pasillo de ${domCat.label.toLowerCase()}`,
      why: withReason?.reason ?? WHYS[p % WHYS.length],
    });
    i += n; p += 1;
  }
  return out;
}
