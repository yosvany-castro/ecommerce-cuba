// src/sectors/b-catalog/provider.ts — seam de proveedores externos (F4.1).
// El mock es el provider 1; Amazon/AliExpress/Shein implementarán esta interfaz
// (fetch con rate limit/backoff propios) y el swap ocurre AQUÍ, no en los call-sites.
import { fetchFromAggregator, type FetchOptions, type FetchResult } from "./mock/aggregator";

export interface AggregatorProvider {
  name: string;
  fetch(opts: FetchOptions): Promise<FetchResult>;
}

// ponytail: un solo provider activo; registry multi-proveedor cuando exista el segundo.
export const activeProvider: AggregatorProvider = {
  name: "mock",
  fetch: fetchFromAggregator,
};
