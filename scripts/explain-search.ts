#!/usr/bin/env tsx
/**
 * CLI: pnpm explain "regalo para mi abuelo"
 *
 * Ejecuta hybridSearch contra la BD configurada con opts.trace=true y
 * formatea las secciones del SearchTrace en terminal.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { withPgDirect } from "@/lib/db/helpers";
import { hybridSearch } from "@/sectors/c-search/search";

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return "  --";
  return ms.toFixed(0).padStart(4) + "ms";
}

function header(s: string): string {
  return `\n\x1b[1m${s}\x1b[0m\n${"─".repeat(s.length)}`;
}

function dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`;
}

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error('Usage: pnpm explain "<query>"');
    process.exit(1);
  }

  const result = await withPgDirect((pg) =>
    hybridSearch(query, { pg, anonymous_id: null, user_id: null }, { trace: true }),
  );
  const t = result.trace;
  if (!t) {
    console.error("no trace generated");
    process.exit(2);
  }

  console.log(header("RESUMEN"));
  console.log(`Query:           ${t.raw_query}`);
  console.log(`Hash:            ${t.hash.slice(0, 16)}…`);
  console.log(`Method:          ${result.method}`);
  console.log(`Products:        ${t.final.products_count}`);
  console.log(`Total:           ${fmtMs(t.timings_ms.total)}`);

  console.log(header("CACHÉ"));
  console.log(`Exact:           ${t.cache.exact_hit}`);
  console.log(
    `Semantic:        ${t.cache.semantic_hit}${
      t.cache.semantic_similarity !== undefined
        ? ` (sim ${t.cache.semantic_similarity.toFixed(3)})`
        : ""
    }`,
  );

  console.log(header("LO QUE ENTENDIÓ EL LLM"));
  if (!t.normalized) {
    console.log(dim("(LLM no disponible o cache hit)"));
  } else {
    const n = t.normalized;
    console.log(`Intent:          ${n.intent}`);
    console.log(`Género:          ${n.recipient_gender ?? "—"}`);
    console.log(
      `Edad:            ${n.recipient_age_min ?? "?"} – ${n.recipient_age_max ?? "?"}`,
    );
    console.log(`Categories:      ${n.categories.join(", ") || "—"}`);
    console.log(`Price range:     ${n.price_range ?? "—"}`);
    console.log(`Search terms:    ${n.search_terms}`);
    console.log(`Confidence:      ${n.confidence.toFixed(2)}`);
  }

  console.log(header("FILTROS APLICADOS"));
  console.log(JSON.stringify(t.filters_applied, null, 2));

  console.log(header("FRESHNESS (por query)"));
  console.log(`Query hash:      ${t.freshness.query_hash ? t.freshness.query_hash.slice(0, 12) : "(none)"}`);
  console.log(`Última llamada:  ${t.freshness.last_called_at ?? "—"}`);
  console.log(
    `Hours old:       ${t.freshness.hours_old !== null ? t.freshness.hours_old.toFixed(1) : "—"}`,
  );

  console.log(header("BM25 TOP 5"));
  for (const r of t.retrieval.bm25.slice(0, 5)) {
    console.log(`  ${r.rank}. ${r.title}  ${dim(`(${r.score.toFixed(3)})`)}`);
  }
  if (t.retrieval.bm25.length === 0) console.log(dim("  (empty)"));

  console.log(header("COSINE TOP 5"));
  for (const r of t.retrieval.cosine.slice(0, 5)) {
    console.log(`  ${r.rank}. ${r.title}  ${dim(`(${r.score.toFixed(3)})`)}`);
  }
  if (t.retrieval.cosine.length === 0) console.log(dim("  (empty)"));

  console.log(header("RRF FUSED TOP 5"));
  t.retrieval.fused
    .slice(0, 5)
    .forEach((f, i) =>
      console.log(`  ${i + 1}. ${f.title}  ${dim(`(rrf=${f.rrf_score.toFixed(4)})`)}`),
    );
  if (t.retrieval.fused.length === 0) console.log(dim("  (empty)"));

  console.log(header("DECISIÓN MOCK FALLBACK"));
  console.log(`Should call:     ${t.decision.should_call_mock}`);
  console.log(`Razón:           ${t.decision.reason}`);
  console.log(`Invocado:        ${t.mock_fallback.invoked}`);
  if (t.mock_fallback.invoked) {
    console.log(`Recibidos:       ${t.mock_fallback.products_fetched ?? 0}`);
    console.log(`Procesados:      ${t.mock_fallback.products_processed ?? 0}`);
    console.log(`Fallidos:        ${t.mock_fallback.products_failed ?? 0}`);
  }

  console.log(header("RESULTADO FINAL TOP 5"));
  t.final.top_10
    .slice(0, 5)
    .forEach((p, i) =>
      console.log(`  ${i + 1}. ${p.title}  ${dim(`($${(p.price_cents / 100).toFixed(2)})`)}`),
    );
  if (t.final.top_10.length === 0) console.log(dim("  (empty)"));

  console.log(header("TIMINGS (ms, desc)"));
  const entries = Object.entries(t.timings_ms)
    .filter(([, v]) => typeof v === "number")
    .sort(([, a], [, b]) => (b as number) - (a as number));
  for (const [k, v] of entries) {
    console.log(`  ${k.padEnd(24)} ${fmtMs(v as number)}`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
