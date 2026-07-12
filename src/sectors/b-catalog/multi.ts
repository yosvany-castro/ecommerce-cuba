// src/sectors/b-catalog/multi.ts — provider "multi": fan-out en paralelo a
// varias fuentes ya registradas y merge de resultados en una sola búsqueda.
import type { AggregatorProvider } from "./provider";
import type { FetchOptions, FetchResult } from "./mock/aggregator";
import type { MockCategory, MockProduct } from "./mock/types";

// Mismo criterio de dedupe que usa runCatalogRefresh: source+source_product_id
// no colisiona entre marketplaces distintos, pero sí si el mismo provider
// aparece dos veces en la config — en ese caso gana el primero (orden de la lista).
function dedupe(products: MockProduct[]): MockProduct[] {
  const seen = new Set<string>();
  return products.filter((p) => {
    const key = `${p.source}:${p.source_product_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Ruteo de ingesta por categoría: corta el gasto (~50%, de N fuentes del
 * universo a ~2 por query) y aplica la especialización real de las tiendas
 * para el público cubano (prefiere BARATO) — aliexpress es barato/todo-terreno
 * así que entra en todas las categorías; shein cubre ropa/belleza; amazon y
 * walmart (caros pero rápidos) quedan para electrónica/hogar/juguetes y como
 * relleno de "otros". Se tunea EDITANDO esta tabla (a propósito, no env) — el
 * universo real de fuentes disponibles lo sigue decidiendo MULTI_PROVIDER_SOURCES
 * en provider.ts; este mapa solo FILTRA ese universo por categoría (un nombre
 * que no esté en el universo configurado simplemente no aparece nunca).
 */
export const CATEGORY_PROVIDER_MAP: Record<MockCategory, string[]> = {
  ropa: ["shein-prod", "aliexpress-prod"],
  belleza: ["shein-prod", "aliexpress-prod"],
  electronica: ["aliexpress-prod", "walmart-prod"],
  hogar: ["aliexpress-prod", "walmart-prod"],
  juguetes_bebe: ["aliexpress-prod", "walmart-prod"],
  otros: ["aliexpress-prod", "amazon-prod"],
};
// Sin categoría (o categoría desconocida): mismo criterio que "otros".
const DEFAULT_CATEGORY_PROVIDERS = CATEGORY_PROVIDER_MAP.otros;

function providersForCategory(
  providers: AggregatorProvider[],
  category: MockCategory | undefined,
): AggregatorProvider[] {
  const wanted = (category && CATEGORY_PROVIDER_MAP[category]) || DEFAULT_CATEGORY_PROVIDERS;
  const filtered = providers.filter((p) => wanted.includes(p.name));
  // Defensivo (T1): si el mapa no matchea nada del universo configurado, mejor
  // consultar todo el universo que devolver 0 resultados en silencio.
  return filtered.length > 0 ? filtered : providers;
}

/**
 * makeMultiProvider: fan-out con Promise.allSettled — un provider que falla se
 * loguea (console.warn) y no tumba a los demás; el merge sale de los exitosos.
 * Si TODOS fallan, se lanza con el detalle agregado de cada fallo.
 *
 * OJO con `opts.limit`: cada provider recibe los mismos `opts` tal cual, así
 * que el límite es POR FUENTE, no total — con N fuentes el resultado puede
 * traer hasta N * limit productos (antes de dedupe).
 */
export function makeMultiProvider(providers: AggregatorProvider[]): AggregatorProvider {
  return {
    name: "multi",
    async fetch(opts: FetchOptions): Promise<FetchResult> {
      const t0 = Date.now();
      const selected = providersForCategory(providers, opts.category);
      const settled = await Promise.allSettled(selected.map((p) => p.fetch(opts)));

      const ok: FetchResult[] = [];
      const failures: string[] = [];
      settled.forEach((s, i) => {
        const name = selected[i].name;
        if (s.status === "fulfilled") {
          ok.push(s.value);
        } else {
          failures.push(`${name}: ${String(s.reason)}`);
          console.warn(`[multi] ${name} falló:`, s.reason);
        }
      });

      if (ok.length === 0) {
        throw new Error(`[multi] todos los providers fallaron — ${failures.join(" | ")}`);
      }

      return {
        products: dedupe(ok.flatMap((r) => r.products)),
        cost_cents: ok.reduce((sum, r) => sum + r.cost_cents, 0),
        latency_ms: Date.now() - t0,
      };
    },
  };
}
