#!/usr/bin/env tsx
/**
 * Cron: ofertas del día (bento v2). Corre cada noche (ver ops/crontab):
 * elige los 12 productos activos con MAYOR descuento REAL del proveedor
 * (old_price > price, con foto) y los fija para el día. Idempotente por día
 * (ON CONFLICT DO NOTHING) — correrlo dos veces no cambia la selección;
 * --force la reemplaza.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { withPgDirect } from "@/lib/db/helpers";

async function main() {
  const force = process.argv.includes("--force");
  const n = await withPgDirect(async (pg) => {
    const sel = await pg.query(
      `SELECT id FROM products
       WHERE is_active = true
         AND image_url IS NOT NULL AND image_url <> ''
         AND (metadata->'attrs'->>'old_price_cents')::int > price_cents
       ORDER BY ((metadata->'attrs'->>'old_price_cents')::int - price_cents)::float
                / NULLIF((metadata->'attrs'->>'old_price_cents')::int, 0) DESC
       LIMIT 12`,
    );
    const ids = sel.rows.map((r: { id: string }) => r.id);
    if (ids.length === 0) {
      console.log("[cron-ofertas] 0 productos con descuento real — nada que fijar");
      return 0;
    }
    await pg.query(
      `INSERT INTO daily_offers (day, product_ids) VALUES (CURRENT_DATE, $1::uuid[])
       ON CONFLICT (day) ${force ? "DO UPDATE SET product_ids = EXCLUDED.product_ids" : "DO NOTHING"}`,
      [ids],
    );
    return ids.length;
  });
  console.log(`[cron-ofertas] fijadas ${n} ofertas para hoy`);
}

main().catch((e) => {
  console.error("[cron-ofertas] failed:", e);
  process.exit(1);
});
