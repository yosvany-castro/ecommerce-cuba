#!/usr/bin/env tsx
/**
 * Smoke live de los proveedores Apify (T3). GASTA CENTAVOS — corre actores reales.
 * CLI: pnpm apify:smoke --source amazon|aliexpress|shein|all --query "..." --limit 5 [--ingest]
 *
 * Sin --ingest: corre cada fuente una vez, imprime tabla (title/price/old/imgs#/colors#/sizes#)
 *   + costCents + latencyMs, y guarda los items CRUDOS en tests/fixtures/apify/<source>-sample.json.
 *   NO persiste nada — el run es efímero e invisible al breaker de presupuesto
 *   (mock_calls), a propósito: es un smoke de inspección, no gasto operativo real.
 * Con --ingest: además inserta en mock_calls (mismo shape que catalog-refresh, así el
 *   breaker ve el gasto) y pasa cada producto mapeado por processProduct (pg dedicado).
 *
 * Llama runActorGetItems directo (no makeApifyProvider) para quedarse con los items crudos
 * pre-mapeo Y el costo del mismo run — una sola llamada viva por fuente.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runActorGetItems } from "@/sectors/b-catalog/apify/client";
import * as amazon from "@/sectors/b-catalog/apify/sources/amazon";
import * as aliexpress from "@/sectors/b-catalog/apify/sources/aliexpress";
import * as shein from "@/sectors/b-catalog/apify/sources/shein";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";
import { withPgDirect } from "@/lib/db/helpers";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";

const SOURCES = { amazon, aliexpress, shein };
type SourceName = keyof typeof SOURCES;

const { values } = parseArgs({
  options: {
    source: { type: "string", default: "all" },
    query: { type: "string" },
    limit: { type: "string", default: "5" },
    ingest: { type: "boolean", default: false },
  },
});

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/apify");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

async function runSource(name: SourceName, query: string, limit: number, ingest: boolean) {
  const mod = SOURCES[name];
  console.log(`\n=== ${name} (${mod.ACTOR_SLUG}) — query="${query}" limit=${limit} ===`);
  let items: unknown[], costCents: number, latencyMs: number;
  try {
    ({ items, costCents, latencyMs } = await runActorGetItems(
      mod.ACTOR_SLUG,
      mod.buildInput({ query, limit }),
      // timeoutSecs por fuente (mismo valor que usa el provider real) — una sola fuente de verdad.
      { limitItems: limit, estimatePerItemUsd: mod.PER_ITEM_USD, timeoutSecs: mod.TIMEOUT_SECS },
    ));
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[${name}] FAILED: ${msg}`);
    return { name, ok: false as const, error: msg };
  }

  // Guardar crudos (máx 5) para endurecer mappers con datos reales.
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(join(FIXTURE_DIR, `${name}-sample.json`), JSON.stringify(items.slice(0, 5), null, 2));

  const products = items
    .map((it) => mod.mapItem(it))
    .filter((p): p is MockProduct => p !== null);

  const rows = products.map((p) => {
    const a = p.attributes;
    return {
      title: p.title.slice(0, 40),
      price: (p.price_cents / 100).toFixed(2),
      old: a.old_price_cents ? (num(a.old_price_cents) / 100).toFixed(2) : "-",
      imgs: Array.isArray(a.images) ? a.images.length : p.image_url ? 1 : 0,
      colors: Array.isArray(a.colors) ? a.colors.length : 0,
      sizes: Array.isArray(a.sizes) ? a.sizes.length : 0,
    };
  });

  console.log(`raw=${items.length} mapped=${products.length} cost=${costCents}¢ latency=${latencyMs}ms`);
  console.table(rows);

  if (ingest) {
    await withPgDirect(async (pg) => {
      // Mismo shape que catalog-refresh (cron/catalog-refresh.ts): el breaker de
      // presupuesto (fetchSpentLast24h) suma simulated_cost_cents sin distinguir
      // origen — sin esta fila, un smoke --ingest gasta centavos invisibles al freno.
      await pg.query(
        `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
         VALUES ($1::jsonb, $2, $3, $4, false)`,
        [
          JSON.stringify({ source: "apify_smoke", provider: name, query }),
          products.length,
          costCents,
          Math.round(latencyMs),
        ],
      );
      if (products.length) {
        const out = [];
        for (const p of products) out.push(await processProduct(p, pg));
        console.log(
          `[${name}] ingested: ` +
            out.map((r) => `${r.productId.slice(0, 8)}(${r.inserted ? "new" : "upd"})`).join(", "),
        );
      }
    });
  }

  return { name, ok: true as const, raw: items.length, mapped: products.length, costCents, latencyMs };
}

async function main() {
  const query = values.query ?? "deals";
  const limit = Math.min(parseInt(values.limit!, 10) || 5, 5); // tope duro ≤5
  const names: SourceName[] =
    values.source === "all" || !values.source
      ? (Object.keys(SOURCES) as SourceName[])
      : [values.source as SourceName];

  if (names.some((n) => !(n in SOURCES))) {
    console.error("Fuente inválida. Usa: amazon|aliexpress|shein|all");
    process.exit(2);
  }

  const summary = [];
  for (const n of names) summary.push(await runSource(n, query, limit, values.ingest!));

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  const totalCost = summary.reduce((s, r) => s + (r.ok ? r.costCents : 0), 0);
  console.log(`TOTAL cost: ${totalCost}¢`);
  process.exit(summary.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
