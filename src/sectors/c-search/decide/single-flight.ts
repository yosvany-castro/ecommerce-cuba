// src/sectors/c-search/decide/single-flight.ts — dedupe de llamadas en vuelo
// (F4 T2): dos búsquedas idénticas concurrentes pagaban DOBLE llamada al
// agregador. ponytail: Map in-process (un solo nodo Next); si algún día hay
// multi-instancia, sustituir por advisory lock de Postgres.
const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p as Promise<T>;
}
