// src/sectors/b-catalog/multi.ts — provider "multi": fan-out en paralelo a
// varias fuentes ya registradas y merge de resultados en una sola búsqueda.
import type { AggregatorProvider } from "./provider";
import type { FetchOptions, FetchResult } from "./mock/aggregator";
import type { MockProduct } from "./mock/types";

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
      const settled = await Promise.allSettled(providers.map((p) => p.fetch(opts)));

      const ok: FetchResult[] = [];
      const failures: string[] = [];
      settled.forEach((s, i) => {
        const name = providers[i].name;
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
