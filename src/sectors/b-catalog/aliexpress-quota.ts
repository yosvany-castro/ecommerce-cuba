// src/sectors/b-catalog/aliexpress-quota.ts — guard de cuota compartido para
// AliExpress DataHub (free-tier con tope duro mensual). Extraído de
// api/products/[id]/hydrate/route.ts para reusarlo también en
// api/products/resolve-url/route.ts (Tarea 2) sin duplicar el lock+reserva.
import type { Client } from "pg";

const ALIEXPRESS_QUOTA = Number(process.env.HYDRATE_QUOTA_ALIEXPRESS) || 40;

// Todo consumidor de la cuota AliExpress DataHub debe (a) contar contra este
// mismo set de sources y (b) sumarse a él — si se agrega un consumidor nuevo,
// su source va acá para que los demás guards también lo vean.
const COUNTED_SOURCES = [
  "hydrate_aliexpress",
  "checkout_revalidate",
  "rapidapi_aliexpress_search",
  "resolve_url_aliexpress",
] as const;

/**
 * Lock + reserva atómica del slot de cuota mensual ANTES del fetch (evita que
 * N requests concurrentes lean todos el mismo count antes de que ninguno
 * reserve). `source` etiqueta la auditoría en mock_calls — debe ser uno de
 * COUNTED_SOURCES para que las demás llamadas a este guard también lo vean.
 * Devuelve true si reservó (hay cupo), false si excedido (no reserva nada).
 */
export async function reserveAliexpressQuota(
  pg: Client,
  source: (typeof COUNTED_SOURCES)[number],
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  await pg.query("BEGIN");
  try {
    await pg.query(`SELECT pg_advisory_xact_lock(hashtext('hydrate_aliexpress_quota'))`);
    const q = await pg.query(
      `SELECT count(*)::int AS n FROM mock_calls
       WHERE params->>'source' = ANY($1::text[])
         AND called_at >= date_trunc('month', now())`,
      [COUNTED_SOURCES],
    );
    if (q.rows[0].n >= ALIEXPRESS_QUOTA) {
      await pg.query("ROLLBACK");
      return false;
    }
    await pg.query(
      `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, was_error)
       VALUES ($1::jsonb, 0, 0, false)`,
      [JSON.stringify({ source, ...extra })],
    );
    await pg.query("COMMIT");
    return true;
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  }
}
