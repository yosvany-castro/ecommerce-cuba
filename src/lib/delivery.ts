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

export type ShippingVia = "aereo" | "maritimo";

/** Días marketplace → depósito, por tienda. default cubre tiendas futuras. */
const STORE_TO_HUB_DAYS: Record<string, [number, number]> = {
  amazon: [3, 7],
  walmart: [3, 8],
  shein: [9, 18],
  aliexpress: [15, 35],
  default: [10, 25],
};

/** Días depósito → entrega en Cuba, por vía. */
const HUB_TO_CUBA_DAYS: Record<ShippingVia, [number, number]> = {
  aereo: [7, 15],
  maritimo: [30, 55],
};

export interface DeliveryEstimate {
  minDays: number;
  maxDays: number;
  via: ShippingVia;
}

export function estimateDelivery(source: string | null | undefined, via: ShippingVia): DeliveryEstimate {
  const store = STORE_TO_HUB_DAYS[source ?? ""] ?? STORE_TO_HUB_DAYS.default;
  const cuba = HUB_TO_CUBA_DAYS[via];
  return { minDays: store[0] + cuba[0], maxDays: store[1] + cuba[1], via };
}

/** Carrito multi-tienda: manda el item MÁS LENTO (todo viaja junto desde el
 * depósito), y el rango se calcula sobre el peor tramo 1 del carrito. */
export function estimateDeliveryForCart(sources: (string | null | undefined)[], via: ShippingVia): DeliveryEstimate {
  const ests = (sources.length ? sources : [null]).map((s) => estimateDelivery(s, via));
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

/** ¿El carrito mezcla tiendas? (aviso honesto: puede llegar en varias entregas) */
export function hasMultipleStores(sources: (string | null | undefined)[]): boolean {
  return new Set(sources.map((s) => s ?? "")).size > 1;
}
