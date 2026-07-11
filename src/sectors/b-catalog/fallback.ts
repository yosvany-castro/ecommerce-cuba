// src/sectors/b-catalog/fallback.ts — envuelve un provider primario con un
// fallback (F4: providers reales). Regla: si primary lanza O devuelve 0
// productos, se loguea y se intenta el fallback. Sin límite de reintentos
// del primary — un fallo es un fallo, se pasa la pelota una vez.
import type { AggregatorProvider } from "./provider";
import type { FetchOptions, FetchResult } from "./mock/aggregator";

export function withFallback(
  primary: AggregatorProvider,
  fallback: AggregatorProvider,
): AggregatorProvider {
  return {
    name: `${primary.name}+fb:${fallback.name}`,
    async fetch(opts: FetchOptions): Promise<FetchResult> {
      try {
        const result = await primary.fetch(opts);
        if (result.products.length > 0) return result;
        console.warn(`[fallback] ${primary.name} devolvió 0 productos — usando ${fallback.name}`);
      } catch (e) {
        console.warn(`[fallback] ${primary.name} falló — usando ${fallback.name}:`, e);
      }
      return fallback.fetch(opts);
    },
  };
}
