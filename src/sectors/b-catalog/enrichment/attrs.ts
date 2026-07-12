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
  variants?: CuratedVariant[];
  hydrated_at?: string;
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
export function curateColors(v: unknown): CuratedColor[] | undefined {
  if (!Array.isArray(v)) return undefined;
  // dedupe por nombre: al aplanar variantes, varias tallas comparten color y el
  // swatch se repetiría (visto en vivo con la hidratación, 2026-07-11)
  const seen = new Set<string>();
  const out: CuratedColor[] = [];
  for (const c of v.map(curateColor)) {
    if (!c || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
    if (out.length >= CAP) break;
  }
  return out.length ? out : undefined;
}

export function curateStrings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  // mismo dedupe: tallas iguales llegan repetidas desde variantes de distinto color
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string" || x.trim().length === 0 || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (out.length >= CAP) break;
  }
  return out.length ? out : undefined;
}

const CAP_VARIANTS = 30;

export interface CuratedVariant {
  color?: string;
  size?: string;
  price_cents?: number;
  available?: boolean;
  image?: string;
}

function curateVariant(v: unknown): CuratedVariant | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const color = typeof o.color === "string" && o.color.trim() ? o.color.trim() : undefined;
  const size = typeof o.size === "string" && o.size.trim() ? o.size.trim() : undefined;
  if (!color && !size) return undefined; // sin ninguna dimensión no es una variante útil
  const price_cents = typeof o.price_cents === "number" && Number.isInteger(o.price_cents) && o.price_cents > 0 ? o.price_cents : undefined;
  const available = typeof o.available === "boolean" ? o.available : undefined;
  const image = typeof o.image === "string" && o.image.trim() ? o.image.trim() : undefined;
  return {
    ...(color && { color }), ...(size && { size }),
    ...(price_cents !== undefined && { price_cents }),
    ...(available !== undefined && { available }),
    ...(image && { image }),
  };
}

export function curateVariants(v: unknown): CuratedVariant[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const out: CuratedVariant[] = [];
  for (const item of v) {
    const c = curateVariant(item);
    if (!c) continue;
    const key = `${c.color ?? ""}|${c.size ?? ""}`;
    if (seen.has(key)) continue; // dedupe antes de cortar
    seen.add(key);
    out.push(c);
    if (out.length >= CAP_VARIANTS) break;
  }
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
// SIEMPRE, incluso `{}` si no hubo nada curable — la UI (tuki/lib.ts attrsOf) es
// real-o-nada por campo: si un campo no vino de acá, no se muestra, sin inventar nada.
export function attrsForStorage(rawAttributes: Record<string, unknown>): CuratedAttrs | undefined {
  const curated = curateAttrs(rawAttributes);
  if (rawAttributes.generated === true) return curated;
  return curated ?? {};
}
