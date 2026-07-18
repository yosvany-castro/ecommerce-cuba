#!/usr/bin/env tsx
/**
 * scripts/measure-price-gap.ts — decisión "medir primero" (spec B1, 2026-07-17):
 * ¿el precio de la API trae Welcome Deal escondido? Compara stored vs API en
 * ~16 productos y deja 2 columnas para que Yosvany llene navegando (anónimo y
 * logueado, precio en $ con punto decimal). Uso:
 *   pnpm measure:price-gap > /tmp/price-gap.csv          (fase 1: gasta cuota)
 *   pnpm measure:price-gap --report /tmp/price-gap.csv   (fase 2: reporte)
 * OJO cuota RapidAPI: máx 4 por fuente por corrida.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { withPgDirect } from "@/lib/db/helpers";
import { fetchDetailJson } from "@/sectors/b-catalog/revalidate";
import { parseDetail } from "@/sectors/b-catalog/resolve-retry";

const PER_SOURCE = 4;

async function measure() {
  const rows = await withPgDirect(async (pg) => {
    const r = await pg.query<{ source: string; source_product_id: string; title: string; price_cents: number; url: string | null }>(
      `SELECT source, source_product_id, title, price_cents, url
       FROM (
         SELECT source, source_product_id, title, price_cents, url,
                row_number() OVER (PARTITION BY source ORDER BY last_refreshed_at DESC) AS rn
         FROM products WHERE is_active = true AND url IS NOT NULL
       ) t WHERE rn <= $1
       ORDER BY source, source_product_id`,
      [PER_SOURCE],
    );
    return r.rows;
  });
  console.log("source,id,title,stored_cents,api_cents,url,browser_anon,browser_logged");
  for (const row of rows) {
    let api = "";
    try {
      const fetched = await fetchDetailJson({ source: row.source, source_product_id: row.source_product_id, url: row.url });
      const detail = fetched ? parseDetail(row.source, fetched.json) : null;
      api = detail ? String(detail.price_cents) : "ERROR";
    } catch {
      api = "ERROR";
    }
    const title = row.title.replaceAll('"', "'").slice(0, 60);
    console.log(`${row.source},${row.source_product_id},"${title}",${row.price_cents},${api},${row.url},,`);
  }
}

function report(file: string) {
  const lines = readFileSync(file, "utf8").trim().split("\n").slice(1);
  const bySource = new Map<string, { n: number; gapApi: number[]; gapAnon: number[] }>();
  for (const line of lines) {
    const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const [source, , , stored, api, , anon] = cols;
    const s = bySource.get(source) ?? { n: 0, gapApi: [], gapAnon: [] };
    s.n++;
    const st = parseInt(stored, 10);
    if (api && api !== "ERROR") s.gapApi.push((parseInt(api, 10) - st) / st);
    if (anon) s.gapAnon.push((parseFloat(anon) * 100 - st) / st); // navegador en $ → centavos
    bySource.set(source, s);
  }
  const pct = (xs: number[]) => (xs.length ? `${((xs.reduce((a, b) => a + b, 0) / xs.length) * 100).toFixed(1)}%` : "sin datos");
  for (const [source, s] of bySource) {
    console.log(`${source}: n=${s.n} · gap API vs stored: ${pct(s.gapApi)} · gap navegador-anónimo vs stored: ${pct(s.gapAnon)}`);
  }
  console.log("\ngap negativo grande en navegador-anónimo = Welcome Deal visible que la API no da (o viceversa).");
}

const reportIdx = process.argv.indexOf("--report");
if (reportIdx > -1) report(process.argv[reportIdx + 1]);
else measure().then(() => process.exit(0));
