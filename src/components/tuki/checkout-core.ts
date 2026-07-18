// src/components/tuki/checkout-core.ts — lógica pura del checkout Tuki. Sin React, sin browser.
// Envío por peso + validaciones. Calcado de dc.html shipCalc/shipErrs/billErrs (script 1112–1138)
// con precios en centavos.
import { estimateDeliveryForCart } from "@/lib/delivery";
import { shipQuote, shipRateCentsPerLb, type ShipQuote, type ShipVia } from "@/lib/shipping";

export type ShipId = ShipVia;

export interface ShipOption {
  id: ShipVia;
  icon: string;
  name: string;
  sub: string;
  quote: ShipQuote;
  d1: number;
  d2: number;
  reco?: boolean;
}

const VIA_META: Record<ShipVia, { icon: string; name: string; sub: string; reco?: boolean }> = {
  aereo: { icon: "✈️", name: "Aéreo", sub: "en avión — se cobra por libra", reco: true },
  maritimo: { icon: "🚢", name: "Marítimo", sub: "en barco — más barato, ideal para lo pesado" },
};

/** Vías de envío reales (spec B1): precio = libras cobrables × tarifa/lb
 * (ver src/lib/shipping.ts). Una vía sin tarifa configurada NO se ofrece.
 * Días honestos de src/lib/delivery.ts según las tiendas del carrito. */
export function shipOptions(weightLb: number, sources: (string | null | undefined)[] = []): ShipOption[] {
  return (["aereo", "maritimo"] as const)
    .filter((via) => shipRateCentsPerLb(via) !== null)
    .map((via) => {
      const days = estimateDeliveryForCart(sources, via);
      return { id: via, ...VIA_META[via], quote: shipQuote(weightLb, via)!, d1: days.minDays, d2: days.maxDays };
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
