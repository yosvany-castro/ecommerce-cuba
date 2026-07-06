// Curación defensiva de MockProduct.attributes (Apify A2/A3) antes de persistir en
// products.metadata.attrs. Whitelist exacta + validación tosca de tipos: basura de
// actores (o del mock viejo {generated, seedIndex, cat}) nunca llega al jsonb.

const CAP = 12;

export interface CuratedColor {
  name: string;
  hex?: string;
}

export interface CuratedAttrs {
  colors?: CuratedColor[];
  sizes?: string[];
  images?: string[];
  old_price_cents?: number;
  rating?: number;
  orders?: string | number;
  brand?: string;
}

function curateColor(c: unknown): CuratedColor | undefined {
  if (typeof c === "string") {
    return c.trim() ? { name: c.trim() } : undefined;
  }
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const o = c as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) return undefined;
    const hex = typeof o.hex === "string" && o.hex.trim() ? o.hex.trim() : undefined;
    return hex ? { name, hex } : { name };
  }
  return undefined;
}

// colors puede venir como string[] u objetos {name,hex?}[] (o mezclado) — se normaliza
// TODO a objetos {name} (+hex si viene) para que el consumidor solo maneje una forma.
function curateColors(v: unknown): CuratedColor[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map(curateColor).filter((c): c is CuratedColor => c !== undefined).slice(0, CAP);
  return out.length ? out : undefined;
}

function curateStrings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, CAP);
  return out.length ? out : undefined;
}

function curateOldPriceCents(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
}

function curateRating(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 5 ? v : undefined;
}

function curateOrders(v: unknown): string | number | undefined {
  if (typeof v === "string") return v.trim() ? v : undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  return undefined;
}

function curateBrand(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function curateAttrs(input: Record<string, unknown>): CuratedAttrs | undefined {
  const out: CuratedAttrs = {};
  const colors = curateColors(input.colors);
  const sizes = curateStrings(input.sizes);
  const images = curateStrings(input.images);
  const oldPriceCents = curateOldPriceCents(input.old_price_cents);
  const rating = curateRating(input.rating);
  const orders = curateOrders(input.orders);
  const brand = curateBrand(input.brand);

  if (colors) out.colors = colors;
  if (sizes) out.sizes = sizes;
  if (images) out.images = images;
  if (oldPriceCents !== undefined) out.old_price_cents = oldPriceCents;
  if (rating !== undefined) out.rating = rating;
  if (orders !== undefined) out.orders = orders;
  if (brand) out.brand = brand;

  return Object.keys(out).length ? out : undefined;
}

// Decide qué clave `attrs` persistir en metadata (F4 review, hueco de honestidad).
// Mock viejo (fixture.ts) marca sus productos con `attributes.generated: true`: sin
// proveedor real detrás, así que sin attrs key (comportamiento actual, ausencia = "no
// aplica"). Cualquier OTRO producto es real (Apify u origen futuro): persistir attrs
// SIEMPRE, incluso `{}` si no hubo nada curable — así mergeAttrs (tuki/lib.ts) ve
// `attrs` presente y no cae al demo completo (old-price/colores/tallas inventados)
// sobre un producto real. `{}` sigue dando rating/sold demo vía mergeAttrs, honesto.
export function attrsForStorage(rawAttributes: Record<string, unknown>): CuratedAttrs | undefined {
  const curated = curateAttrs(rawAttributes);
  if (rawAttributes.generated === true) return curated;
  return curated ?? {};
}
