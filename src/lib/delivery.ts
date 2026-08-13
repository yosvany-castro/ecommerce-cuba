// src/lib/delivery.ts — estimado de entrega HONESTO multi-tienda. Puro, sin
// imports de server: se usa en PDP (client) y checkout.
//
// La cadena real tiene 2 tramos que el usuario NO debe ver por separado:
//   tramo 1: marketplace → depósito (varía por tienda: Amazon días, AliExpress
//            semanas — dato de negocio, no viene fiable de los actores)
//   tramo 2: depósito → Cuba (varía por vía: aérea o marítima)
// Al usuario se le muestra UN rango total en días, siempre etiquetado como
// estimado. Nada de "24-48 h" inventado (eso es lo que había hard-coded).
//
// ponytail: rangos como constantes de calibración editables a mano — son
// conocimiento del negocio de Yosvany y se ajustan con la experiencia real de
// cada envío; mover a DB/admin cuando exista el admin.

export type ShippingVia = "express" | "aereo" | "maritimo";

/** Días marketplace → depósito, por tienda (default para producto sin dato del
 * proveedor — AliExpress da su shippingTime por producto y ese manda). */
const STORE_TO_HUB_DAYS: Record<string, [number, number]> = {
  amazon: [3, 7],
  walmart: [3, 8],
  shein: [8, 15],
  aliexpress: [10, 25],
  temu: [10, 25], // China directo, mismo perfil que aliexpress (provisional)
  default: [8, 20],
};

/** Días depósito → entrega en Cuba, por vía.
 * express: PROVISIONAL — Yosvany debe confirmar los días reales de su cadena. */
const HUB_TO_CUBA_DAYS: Record<ShippingVia, [number, number]> = {
  express: [3, 7],
  aereo: [7, 15],
  maritimo: [25, 45],
};

export interface DeliveryEstimate {
  minDays: number;
  maxDays: number;
  via: ShippingVia;
}

export interface ProviderShipDays {
  min: number;
  max: number;
}

export function estimateDelivery(
  source: string | null | undefined,
  via: ShippingVia,
  providerShipDays?: ProviderShipDays | null,
): DeliveryEstimate {
  const store = providerShipDays
    ? [providerShipDays.min, providerShipDays.max]
    : (STORE_TO_HUB_DAYS[source ?? ""] ?? STORE_TO_HUB_DAYS.default);
  const cuba = HUB_TO_CUBA_DAYS[via];
  return { minDays: store[0] + cuba[0], maxDays: store[1] + cuba[1], via };
}

export interface CartDeliveryItem {
  source?: string | null;
  providerDays?: ProviderShipDays | null;
}

/** Carrito multi-tienda: manda el item MÁS LENTO (todo viaja junto desde el
 * depósito), y el rango se calcula sobre el peor tramo 1 del carrito. Acepta
 * los días del proveedor por item (P1-8: la MISMA base que usa la PDP). */
export function estimateDeliveryForCart(items: CartDeliveryItem[], via: ShippingVia): DeliveryEstimate {
  const list = items.length ? items : [{}];
  const ests = list.map((i) => estimateDelivery(i.source, via, i.providerDays));
  return {
    minDays: Math.max(...ests.map((e) => e.minDays)),
    maxDays: Math.max(...ests.map((e) => e.maxDays)),
    via,
  };
}

/** "18–33 días" — un solo rango legible, sin exponer la cadena interna. */
export function formatDeliveryRange(e: DeliveryEstimate): string {
  return `${e.minDays}–${e.maxDays} días`;
}

const DAY_MS = 864e5;
function fmtDia(ms: number): string {
  return new Date(ms)
    .toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    .replace(/[.,]/g, "");
}

/** Presentación elegida (fechas concretas): "24 jul" / "21 ago" — las fechas
 * se sienten más cercanas que contar 30 días. Mismo formato que etaLine del
 * checkout (es-MX). */
export function deliveryDates(e: DeliveryEstimate, now = Date.now()): { from: string; to: string } {
  return { from: fmtDia(now + e.minDays * DAY_MS), to: fmtDia(now + e.maxDays * DAY_MS) };
}

/** "entre el 24 jul y el 21 ago" — frase lista para la UI. */
export function deliveryPhrase(e: DeliveryEstimate, now = Date.now()): string {
  const d = deliveryDates(e, now);
  return `entre el ${d.from} y el ${d.to}`;
}

/** ¿El carrito mezcla tiendas? (aviso honesto: puede llegar en varias entregas) */
export function hasMultipleStores(sources: (string | null | undefined)[]): boolean {
  return new Set(sources.map((s) => s ?? "")).size > 1;
}
