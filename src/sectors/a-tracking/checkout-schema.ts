// src/sectors/a-tracking/checkout-schema.ts — zod de items compartido entre
// /api/checkout y /api/checkout/anonymous. Un solo lugar para la selección
// color/size (antes cada ruta tenía su propio z.object() de items inline).
import { z } from "zod";

const colorSizeShape = {
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
};

// Item del checkout anónimo: el precio SIEMPRE se re-lee server-side (nunca
// se CONFÍA en el del cliente) — pero el cliente sí manda el unit_price_cents
// que la UI le mostró, para que el server pueda comparar "lo que vio" contra
// "lo que hay" y rechazar con 409 si difieren (REGLA DE ORO: jamás cobrar un
// precio que el usuario no vio confirmar). Requerido: el único cliente real
// (CheckoutFlow.tsx) siempre lo manda — no es un campo legacy opcional.
export const anonymousCheckoutItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(999),
  unit_price_cents: z.number().int().positive(),
  ...colorSizeShape,
});

// Item del checkout autenticado: sin quantity (esa viene de cart_items en
// DB) — solo la selección color/size del carrito local, cruzada por
// product_id (ver CheckoutInput en ./checkout.ts). unit_price_cents opcional:
// hoy ningún cliente real puebla `items` para esta ruta (createCheckoutOrder
// la usa solo para color/size); cuando llega, se valida igual que en el
// checkout anónimo — ausente = fail-open, mismo criterio que color/size hoy.
export const variantSelectionSchema = z.object({
  product_id: z.string().uuid(),
  unit_price_cents: z.number().int().positive().optional(),
  ...colorSizeShape,
});

export interface PriceCheckLine {
  product_id: string;
  color: string | null;
  size: string | null;
  /** Lo que la UI le mostró al usuario al confirmar. undefined = el cliente
   * no lo mandó -> no se verifica esa línea (fail-open, nunca peor que antes). */
  shown_cents: number | undefined;
  /** Lo que el server calcula ahora mismo (variante si aplica, si no base). */
  current_cents: number;
}

export interface PriceMismatch {
  product_id: string;
  color: string | null;
  size: string | null;
  shown_cents: number;
  current_cents: number;
}

/** Compara "lo que la UI mostró" contra "lo que el server cobraría" por línea.
 * Puro — sin DB — para poder testear la regla de negocio (REGLA DE ORO) sin
 * levantar Postgres. Vacío = todo coincide, el checkout puede seguir. */
export function findPriceMismatches(lines: PriceCheckLine[]): PriceMismatch[] {
  const out: PriceMismatch[] = [];
  for (const l of lines) {
    if (l.shown_cents === undefined || l.shown_cents === l.current_cents) continue;
    out.push({ product_id: l.product_id, color: l.color, size: l.size, shown_cents: l.shown_cents, current_cents: l.current_cents });
  }
  return out;
}

/** El envío/tax que la UI mostró ya no cuadra con el recálculo server-side
 * (peso actualizado, knob de tarifa/tax cambiado entre pintado y confirm).
 * Misma filosofía que PriceChangedError: 409 ANTES de tocar la DB. */
export class TotalsChangedError extends Error {
  constructor(
    readonly ship_total_cents: number,
    readonly tax_cents: number,
  ) {
    super("totals_changed");
    this.name = "TotalsChangedError";
  }
}

/** El precio mostrado ya no es el precio real — createCheckoutOrder/
 * createAnonymousOrder la lanzan ANTES de insertar nada (ver el ROLLBACK en
 * el catch de cada uno); la ruta HTTP la traduce a 409 con el detalle. */
export class PriceChangedError extends Error {
  readonly items: PriceMismatch[];
  constructor(items: PriceMismatch[]) {
    super("price_changed");
    this.name = "PriceChangedError";
    this.items = items;
  }
}
