// src/components/tuki/checkout-core.ts — lógica pura del checkout Tuki. Sin React, sin browser.
// Envío por peso + validaciones. Calcado de dc.html shipCalc/shipErrs/billErrs (script 1112–1138)
// con precios en centavos.
import { estimateDeliveryForCart } from "@/lib/delivery";

export interface ShipMethod {
  id: "rapido" | "estandar" | "lento";
  icon: string;
  name: string;
  sub: string;
  price_cents: number;
  maxLb?: number;
  minLb?: number;
  reco?: boolean;
}

// IDs y PRECIOS intactos (viven en el enum del server, el pricing map de
// checkout-anonymous.ts y pedidos históricos — cobro = lo mostrado). Lo que
// cambió: nombres y días honestos según la vía REAL del reenvío a Cuba —
// rapido/estandar viajan en avión, lento en barco. Los días ya no son
// constantes demo ("camión de siempre 3-5 días"): salen de src/lib/delivery.ts
// según las tiendas del carrito.
export const SHIP: ShipMethod[] = [
  { id: "rapido", icon: "⚡", name: "Aéreo prioritario", sub: "en avión, primero en salir", price_cents: 1299, maxLb: 10 },
  { id: "estandar", icon: "✈️", name: "Aéreo estándar", sub: "en avión, envío agrupado", price_cents: 499, reco: true },
  { id: "lento", icon: "🚢", name: "Marítimo", sub: "en barco, ideal para lo pesado", price_cents: 199, minLb: 5 },
];

// ponytail: knob de consolidación — el aéreo estándar espera al próximo envío
// agrupado (~40% más que el prioritario); calibrar con los tiempos reales.
const GROUP_FACTOR = 1.4;

export type ShipOption = ShipMethod & {
  blocked: boolean;
  reason: string;
  effectivePriceCents: number;
  d1: number;
  d2: number;
};

export function shipOptions(
  weightLb: number,
  subtotalCents: number,
  sources: (string | null | undefined)[] = [],
  freeCents = 5000,
): ShipOption[] {
  const wS = weightLb.toFixed(1).replace(".0", "");
  const air = estimateDeliveryForCart(sources, "aereo");
  const sea = estimateDeliveryForCart(sources, "maritimo");
  const days: Record<ShipMethod["id"], [number, number]> = {
    rapido: [air.minDays, air.maxDays],
    estandar: [Math.round(air.minDays * GROUP_FACTOR), Math.round(air.maxDays * GROUP_FACTOR)],
    lento: [sea.minDays, sea.maxDays],
  };
  return SHIP.map((s) => {
    const overMax = s.maxLb != null && weightLb > s.maxLb;
    const underMin = s.minLb != null && weightLb < s.minLb;
    const blocked = overMax || underMin;
    const effectivePriceCents = s.id === "estandar" && subtotalCents >= freeCents ? 0 : s.price_cents;
    let reason = "";
    if (overMax) reason = `tu caja pesa ${wS} lb y el aéreo acepta máx ${s.maxLb} lb — quita algo pesado o elige otro`;
    if (underMin)
      reason = `pide mínimo ${s.minLb} lb y llevas ${wS} lb — súmale ${(s.minLb! - weightLb).toFixed(1)} lb o elige otro`;
    return { ...s, d1: days[s.id][0], d2: days[s.id][1], blocked, reason, effectivePriceCents };
  });
}

// Devuelve flags de ERROR por campo (true = inválido), como dc.html shipErrs.
export function validateShipping(f: {
  nombre: string;
  ci: string;
  tel: string;
  dir: string;
  ciudad: string;
}): Record<string, boolean> {
  return {
    nombre: !f.nombre.trim(),
    ci: !/^\d{6,}$/.test(f.ci),
    tel: !f.tel.trim(),
    dir: !f.dir.trim(),
    ciudad: !f.ciudad.trim(),
  };
}

// eta legible "llega <d1> – <d2>" (dc.html fmtDia es-MX, script 959). Pura salvo now/locale.
export function etaLine(d1: number, d2: number, now = Date.now()): string {
  const day = 864e5;
  const fmtDia = (ms: number) =>
    new Date(ms)
      .toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })
      .replace(/[.,]/g, "");
  return `llega ${fmtDia(now + d1 * day)} – ${fmtDia(now + d2 * day)}`;
}

// dc.html billErrs: sin factura aparte no hay errores; con ella, razón/dirf no vacíos y rfc ≥ 6.
export function validateBilling(
  billSame: boolean,
  fb: { razon: string; rfc: string; dirf: string },
): Record<string, boolean> {
  if (billSame) return {};
  return {
    razon: !fb.razon.trim(),
    rfc: fb.rfc.trim().length < 6,
    dirf: !fb.dirf.trim(),
  };
}
