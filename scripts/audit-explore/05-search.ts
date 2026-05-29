/**
 * EXPERIMENT 5 — Search: how it understands queries (component-level, no mock).
 *
 * Tests BM25 (exact/lexical), cosine (semantic), and the LLM normalizer (intent)
 * directly, avoiding the full hybridSearch mock-aggregator path ($ cost).
 *
 * HYPOTHESES:
 *  H1. BM25 nails an exact model query ("Nike Air Zoom").
 *  H2. Cosine handles vague intent ("algo elegante para una fiesta") → dresses.
 *  H3. The LLM normalizer extracts gift recipient/intent ("regalo para mi abuelo").
 *  Observation: search has NO profile personalization (verified in search.ts).
 */
import { openTestPg, seedCatalogIfEmpty } from "./catalog";
import { bm25Search } from "@/sectors/c-search/retrieve/bm25";
import { cosineSearch } from "@/sectors/c-search/retrieve/cosine";
import { rrfFuse, RRF_K0 } from "@/sectors/c-search/retrieve/rrf";
import { normalizeQueryWithLLM } from "@/sectors/c-search/normalizer/normalize";
import { embed } from "@/lib/embeddings/voyage";

async function main() {
  const pg = await openTestPg();
  try {
    await seedCatalogIfEmpty(pg);
    const titles = async (ids: string[]) => {
      if (ids.length === 0) return [] as string[];
      const r = await pg.query(`SELECT id::text, title FROM products WHERE id = ANY($1::uuid[])`, [ids]);
      const m = new Map(r.rows.map((x: { id: string; title: string }) => [x.id, x.title]));
      return ids.map((i) => (m.get(i) as string) ?? i);
    };

    for (const q of ["Nike Air Zoom", "zapatillas para correr", "algo elegante para una fiesta", "auriculares para musica"]) {
      console.log(`\n>>> QUERY: "${q}"`);
      const bm = await bm25Search(q, {}, 5, pg);
      const [qv] = await embed([q], { inputType: "query" });
      const cs = await cosineSearch(qv, {}, 5, pg);
      const fused = rrfFuse([bm, cs], RRF_K0).slice(0, 5);
      console.log("  BM25 :", (await titles(bm.map((x) => x.id))).map((t) => t.slice(0, 28)).join(" | ") || "(none)");
      console.log("  COSINE:", (await titles(cs.map((x) => x.id))).map((t) => t.slice(0, 28)).join(" | "));
      console.log("  FUSED :", (await titles(fused.map((x) => x.id))).map((t) => t.slice(0, 28)).join(" | "));
    }

    console.log("\n############ LLM intent normalization ############");
    for (const q of ["regalo para mi abuelo", "algo barato para mi hija de 8 años", "Nike Air Zoom talla 42"]) {
      try {
        const n = await normalizeQueryWithLLM(q);
        console.log(`\n  "${q}" →`, JSON.stringify({
          intent: (n as Record<string, unknown>).intent,
          category: (n as Record<string, unknown>).category,
          filters: (n as Record<string, unknown>).filters,
          recipient_gender: (n as Record<string, unknown>).recipient_gender,
          recipient_age_min: (n as Record<string, unknown>).recipient_age_min,
          recipient_age_max: (n as Record<string, unknown>).recipient_age_max,
          expansions: (n as Record<string, unknown>).expansions,
        }));
      } catch (e) {
        console.log(`  "${q}" → normalize error:`, (e as Error).message);
      }
    }
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
