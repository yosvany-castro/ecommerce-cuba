#!/usr/bin/env tsx
/**
 * Backfill de la 0046: traduce al español title/description de los productos
 * que aún están en el idioma del proveedor (title_original IS NULL). Lo nuevo
 * ya entra traducido por el normalizador de la ingesta.
 *
 * Paso 0 (regla de oro del precio): ANTES de traducir, congela el peso
 * heurístico calculado sobre el título ORIGINAL en weight_grams
 * (weight_source='heuristic'), para que el envío de un producto ya mostrado no
 * cambie porque cambió el idioma de su título. El LLM lo sigue refinando igual.
 *
 * Uso: pnpm tsx scripts/translate-catalog.ts [--limit N] [--dry]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Client } from "pg";
import { defaultProvider } from "@/lib/llm/providers";
import { stripMarkdownWrapper } from "@/sectors/b-catalog/enrichment/normalizer";
import { estimateWeightGrams } from "@/lib/weight";

const BATCH = 8;
const CONCURRENCY = 4;
const args = process.argv.slice(2);
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1], 10) : 100_000;
const dry = args.includes("--dry");

const SYSTEM = `Traduces fichas de producto de e-commerce al español natural (como las escribiría una tienda en español).
Recibes un JSON array [{i, title, description}]. Devuelve SOLO un JSON {"items": [{i, title_es, description_es}]} con el MISMO i.
- title_es: máximo 90 caracteres; conserva marca, modelo y medidas; quita relleno SEO y años repetidos.
- description_es: traducción resumida a lo esencial, máximo 500 caracteres; null si la descripción está vacía o es igual al título.
- Si el texto ya está en español, devuélvelo corregido y recortado igual.`;

interface Row {
  id: string;
  title: string;
  description: string | null;
}

async function translateBatch(rows: Row[]): Promise<Map<string, { title: string; description: string | null }>> {
  const input = rows.map((r, i) => ({ i, title: r.title, description: (r.description ?? "").slice(0, 1200) }));
  const res = await defaultProvider.chat({
    system: SYSTEM,
    cacheSystem: true,
    jsonMode: true,
    messages: [{ role: "user", content: JSON.stringify(input) }],
    maxTokens: 4000,
    temperature: 0,
  });
  const parsed = JSON.parse(stripMarkdownWrapper(res.text)) as { items?: { i: number; title_es?: string; description_es?: string | null }[] };
  const out = new Map<string, { title: string; description: string | null }>();
  for (const it of parsed.items ?? []) {
    const row = rows[it.i];
    const t = it.title_es?.trim();
    if (!row || !t || t.length < 2 || t.length > 160) continue; // salida rara: ese producto queda para la próxima corrida
    out.set(row.id, { title: t, description: it.description_es?.trim() || (row.description === row.title ? t : row.description) });
  }
  return out;
}

async function main() {
  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  // Paso 0: congelar pesos heurísticos sobre el texto ORIGINAL.
  const toFreeze = await pg.query<{ id: string; title: string; description: string | null; category: string | null }>(
    `SELECT id::text, title, description, metadata->>'category' AS category
     FROM products WHERE weight_grams IS NULL AND title_original IS NULL`,
  );
  console.log(`[translate] congelando peso heurístico de ${toFreeze.rows.length} productos`);
  if (!dry) {
    for (const r of toFreeze.rows) {
      const g = estimateWeightGrams({ title: r.title, category: r.category, description: r.description }).grams;
      await pg.query(`UPDATE products SET weight_grams = $1, weight_source = 'heuristic' WHERE id = $2 AND weight_grams IS NULL`, [g, r.id]);
    }
  }

  const { rows } = await pg.query<Row>(
    `SELECT id::text, title, description FROM products WHERE title_original IS NULL ORDER BY is_active DESC, created_at DESC LIMIT $1`,
    [limit],
  );
  console.log(`[translate] ${rows.length} productos por traducir${dry ? " (dry)" : ""}`);
  const batches: Row[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));

  let done = 0;
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < batches.length) {
        const b = batches[next++];
        try {
          const tr = await translateBatch(b);
          for (const r of b) {
            const t = tr.get(r.id);
            if (!t) {
              failed++;
              continue;
            }
            if (dry) console.log(`  ${r.title.slice(0, 60)}  →  ${t.title}`);
            else
              await pg.query(
                `UPDATE products SET title_original = title, description_original = description, title = $1, description = $2
                 WHERE id = $3 AND title_original IS NULL`,
                [t.title, t.description, r.id],
              );
            done++;
          }
        } catch (e) {
          failed += b.length;
          console.warn(`[translate] lote falló: ${(e as Error).message.slice(0, 120)}`);
        }
        process.stdout.write(`\r[translate] ${done} ok · ${failed} pendientes`);
      }
    }),
  );
  console.log(`\n[translate] listo: ${done} traducidos, ${failed} quedan para otra corrida`);
  await pg.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
