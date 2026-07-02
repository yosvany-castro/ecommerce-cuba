// src/sectors/c-search/decide/budget.ts — circuit breaker de gasto (F4 T2).
// Cada llamada al agregador cuesta $ real; el gasto ya se AUDITA en mock_calls
// (éxito y error) — el freno lee de ahí, sin contadores paralelos que puedan
// divergir. Env AGGREGATOR_DAILY_BUDGET_CENTS (default 400¢ ≈ 100 llamadas/día
// del mock a 4¢). 0 = agregador apagado.
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
