// src/lib/shipping.ts — envío a Cuba POR LIBRA + sales tax. Puro y compartido
// cliente/servidor (mismo patrón que src/lib/weight.ts): el checkout del
// cliente y el recálculo del server usan EXACTAMENTE esta aritmética
// (regla: cobro = lo mostrado). Decisiones del spec Bloque 1 (2026-07-17):
// aéreo $3.50/lb; buffer max(15%, 1 lb) que cubre caja+protección — si al
// pesar real sobra, se acredita al saldo (flujo de pesaje llega en B2);
// tax 7.5% (Tampa/Hillsborough: 6% FL + 1.5% county) sobre productos.
// Knobs NEXT_PUBLIC_ para que cliente y server vean el mismo número.

export type ShipVia = "aereo" | "maritimo";

const DEFAULT_AEREO_CENTS_PER_LB = 350;
const DEFAULT_TAX_PCT = 7.5;

function envInt(name: string): number | null {
  const v = process.env[name];
  if (v === undefined || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function shipRateCentsPerLb(via: ShipVia): number | null {
  if (via === "aereo") return envInt("NEXT_PUBLIC_SHIP_AEREO_CENTS_PER_LB") ?? DEFAULT_AEREO_CENTS_PER_LB;
  return envInt("NEXT_PUBLIC_SHIP_MARITIMO_CENTS_PER_LB"); // sin knob → vía oculta
}

export interface ShipQuote {
  est_lb: number;
  buffer_lb: number;
  chargeable_lb: number;
  rate_cents_per_lb: number;
  ship_cents: number;
}

/** Cotiza el envío por libra. buffer = max(15% del estimado, 1 lb) y se cobra
 * el ceil a libra completa. estLb=0 (carrito vacío) → todo 0. null si la vía
 * no tiene tarifa configurada. */
export function shipQuote(estLb: number, via: ShipVia): ShipQuote | null {
  const rate = shipRateCentsPerLb(via);
  if (rate === null) return null;
  if (estLb <= 0) return { est_lb: 0, buffer_lb: 0, chargeable_lb: 0, rate_cents_per_lb: rate, ship_cents: 0 };
  const buffer = Math.max(0.15 * estLb, 1);
  const chargeable = Math.ceil(estLb + buffer);
  return {
    est_lb: Math.round(estLb * 10) / 10,
    buffer_lb: Math.round(buffer * 10) / 10,
    chargeable_lb: chargeable,
    rate_cents_per_lb: rate,
    ship_cents: chargeable * rate,
  };
}

export function taxPct(): number {
  const v = process.env.NEXT_PUBLIC_SALES_TAX_PCT;
  if (v === undefined || v === "") return DEFAULT_TAX_PCT;
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TAX_PCT;
}

/** Línea "Impuestos de compra (FL)" — % sobre el subtotal de PRODUCTOS. */
export function taxCents(productSubtotalCents: number): number {
  return Math.round(productSubtotalCents * (taxPct() / 100));
}
