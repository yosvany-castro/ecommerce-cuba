# F4 — Infraestructura de catálogo real · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Preparar el camino del mock a proveedores reales (Shein/Amazon/AliExpress): seam `AggregatorProvider`, presupuesto diario con circuit breaker, single-flight de llamadas, y (tareas diferidas documentadas) ingesta asíncrona, freshness por query, dedup multi-proveedor.

**Architecture:** El mock se convierte en el PRIMER provider detrás de una interfaz; el gasto se controla leyendo `mock_calls` (ya audita cada llamada con costo); el single-flight es un Map in-process (un solo nodo Next — techo documentado). Nada de colas ni deps nuevas hasta que un provider real lo exija.

**Tech Stack:** TypeScript strict, pg, Vitest.

## Global Constraints

- Cero deps nuevas. El único mock permitido sigue siendo el agregador.
- `mock_calls` sigue registrando TODA llamada (éxito/error) — el presupuesto se lee de ahí.
- Cada corte de presupuesto queda visible en el trace (`decisionReason`) y en `searches`.
- Proveedores reales (4.5) = bloqueado por cuentas/keys/negocio (OFAC) — fuera de alcance de código.

---

### Task 1: Seam `AggregatorProvider` (el mock como provider 1)

**Files:**
- Create: `src/sectors/b-catalog/provider.ts`
- Modify: `src/sectors/c-search/search.ts` (import del seam en vez del mock)
- Modify: `src/sectors/b-catalog/cron/catalog-fill.ts` (ídem)

**Interfaces:**
- Produces: `interface AggregatorProvider { name: string; fetch(opts: FetchOptions): Promise<FetchResult> }`; `activeProvider: AggregatorProvider` (hoy = mock). Un provider real futuro = implementar la interfaz + swap aquí.

- [ ] **Step 1:** `provider.ts`:

```ts
// src/sectors/b-catalog/provider.ts — seam de proveedores externos (F4.1).
// El mock es el provider 1; Amazon/AliExpress/Shein implementarán esta interfaz.
import { fetchFromAggregator } from "./mock/aggregator";
import type { FetchOptions, FetchResult } from "./mock/types";

export interface AggregatorProvider {
  name: string;
  fetch(opts: FetchOptions): Promise<FetchResult>;
}

// ponytail: un solo provider activo; registry multi-proveedor cuando exista el segundo.
export const activeProvider: AggregatorProvider = {
  name: "mock",
  fetch: fetchFromAggregator,
};
```

(Verificar que `FetchOptions`/`FetchResult` viven en `mock/types` o exportarlos desde `mock/aggregator` — ajustar el import al real.)

- [ ] **Step 2:** `search.ts`: sustituir `import { fetchFromAggregator } ...` por `import { activeProvider } from "@/sectors/b-catalog/provider"` y la llamada por `activeProvider.fetch({...})`. Registrar `provider: activeProvider.name` dentro de `params` del INSERT a `mock_calls`.
- [ ] **Step 3:** `catalog-fill.ts`: mismo swap.
- [ ] **Step 4:** Verificar — `pnpm tsc --noEmit`; `pnpm vitest run tests/integration/search-mock-fallback.test.ts tests/integration/cron-catalog-fill.test.ts` PASS.
- [ ] **Step 5:** Commit — `feat(f4): seam AggregatorProvider; el mock es el provider 1 (T1)`

---

### Task 2: Presupuesto diario + single-flight

**Files:**
- Create: `src/sectors/c-search/decide/budget.ts`
- Create: `src/sectors/c-search/decide/single-flight.ts`
- Modify: `src/sectors/c-search/search.ts` (gate de presupuesto + flight compartido)
- Test: `tests/unit/aggregator-budget.test.ts`, `tests/unit/single-flight.test.ts`

**Interfaces:**
- Produces: `budgetExceeded(spentCents: number, budgetCents: number): boolean` (pura) + `fetchSpentLast24h(pg): Promise<number>` (SUM de mock_calls.called_at > now()-24h) + `AGGREGATOR_DAILY_BUDGET_CENTS` (env, default 400); `singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T>`.

- [ ] **Step 1: Tests failing primero:**

```ts
// tests/unit/aggregator-budget.test.ts
import { describe, it, expect } from "vitest";
import { budgetExceeded } from "@/sectors/c-search/decide/budget";

describe("presupuesto del agregador", () => {
  it("bloquea al alcanzar el límite exacto", () => {
    expect(budgetExceeded(400, 400)).toBe(true);
    expect(budgetExceeded(399, 400)).toBe(false);
  });
  it("presupuesto 0 = agregador apagado", () => {
    expect(budgetExceeded(0, 0)).toBe(true);
  });
});
```

```ts
// tests/unit/single-flight.test.ts
import { describe, it, expect } from "vitest";
import { singleFlight } from "@/sectors/c-search/decide/single-flight";

describe("single-flight", () => {
  it("dos llamadas concurrentes con la misma key comparten UNA ejecución", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return calls;
    };
    const [a, b] = await Promise.all([singleFlight("k", fn), singleFlight("k", fn)]);
    expect(calls).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
  it("tras resolverse, la key vuelve a estar libre", async () => {
    let calls = 0;
    const fn = async () => ++calls;
    await singleFlight("k2", fn);
    await singleFlight("k2", fn);
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Implementaciones mínimas:**

```ts
// src/sectors/c-search/decide/budget.ts — circuit breaker de gasto (F4.2).
// El gasto real ya se audita en mock_calls; el freno lee de ahí. Env
// AGGREGATOR_DAILY_BUDGET_CENTS (default 400 = ~100 llamadas/día del mock).
import type { Client } from "pg";

export const AGGREGATOR_DAILY_BUDGET_CENTS = (() => {
  const raw = parseInt(process.env.AGGREGATOR_DAILY_BUDGET_CENTS ?? "400", 10);
  return Number.isFinite(raw) ? Math.max(0, raw) : 400;
})();

export function budgetExceeded(spentCents: number, budgetCents: number): boolean {
  return spentCents >= budgetCents;
}

export async function fetchSpentLast24h(pg: Client): Promise<number> {
  const r = await pg.query(
    `SELECT COALESCE(SUM(simulated_cost_cents), 0)::int AS spent
     FROM mock_calls WHERE called_at > now() - interval '24 hours'`,
  );
  return (r.rows[0] as { spent: number }).spent;
}
```

```ts
// src/sectors/c-search/decide/single-flight.ts — dedupe de llamadas en vuelo.
// ponytail: Map in-process (un nodo Next); multi-instancia ⇒ advisory lock pg.
const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p as Promise<T>;
}
```

- [ ] **Step 3: Cablear en `search.ts`:** tras `shouldCallMock` positivo: `const spent = await fetchSpentLast24h(pg); if (budgetExceeded(spent, AGGREGATOR_DAILY_BUDGET_CENTS)) { decisionReason = "daily_budget_exhausted"; tracer.set(...) }` y NO llamar; la llamada al provider se envuelve en `singleFlight(queryHash, () => activeProvider.fetch(...))` (key = hash canónico ya computado en el path).
- [ ] **Step 4:** Verificar — unit nuevos PASS; `pnpm tsc`; `pnpm vitest run tests/integration/search-mock-fallback.test.ts` PASS (el presupuesto default no corta con la DB de test: pocas llamadas).
- [ ] **Step 5:** Commit — `feat(f4): presupuesto diario del agregador + single-flight (T2)`

---

### Task 3 (DIFERIDA — día): Ingesta asíncrona
Devolver lo local ya + `after()` de Next para fetch+enrich post-respuesta. Cambia la semántica (los productos externos aparecen en la SIGUIENTE búsqueda) — requiere decisión de UX del dueño y ajuste del test `search-mock-fallback`.

### Task 4 (DIFERIDA — día): Freshness por query + negative cache
`last_refreshed_at` por hash de query (tabla nueva pequeña o columna en product_query_cache), no por categoría.

### Task 5 (DIFERIDA — día): Dedup multi-proveedor
Producto canónico por embedding+título (umbral calibrado con `calibrate-semantic-cache`).

---

## Self-Review
**Cobertura:** F4.1 (seam) = T1; presupuesto/single-flight = T2; async/freshness/dedup = diferidas explícitas con criterio. ✓
**Placeholders:** T1 Step 1 pide verificar la ubicación real de FetchOptions/FetchResult — acción concreta. ✓
**Tipos:** `AggregatorProvider.fetch` = firma de `fetchFromAggregator`. ✓
