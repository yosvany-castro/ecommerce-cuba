/**
 * AUDIT EXPLORATION — one-time environment setup in test_schema.
 * Full reset, seed realistic catalogue (real embeddings), ambient popularity,
 * cohort centroids. Run once before persona experiments.
 */
import { openTestPg, seedCatalogIfEmpty, seedAmbientPopularity } from "./catalog";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";

async function main() {
  const pg = await openTestPg();
  try {
    const tables = [
      "feed_rerank_cache", "events", "user_profile_modes", "user_profiles",
      "session_vectors", "cohort_centroids", "co_occurrence_top", "co_occurrence",
      "excluded_products", "products", "anonymous_sessions",
    ];
    for (const t of tables) await pg.query(`TRUNCATE test_schema.${t} CASCADE`);
    console.log("[seed] truncated", tables.length, "tables");

    const byTitle = await seedCatalogIfEmpty(pg);
    console.log("[seed] catalogue:", byTitle.size, "products with embeddings");

    await seedAmbientPopularity(pg, byTitle);
    const ev = await pg.query(`SELECT count(*)::int AS c FROM events WHERE payload->>'ambient'='true'`);
    console.log("[seed] ambient view events:", ev.rows[0].c);

    const n = await computeCohortCentroids(pg);
    const cc = await pg.query(`SELECT cohort_id FROM cohort_centroids ORDER BY cohort_id`);
    console.log("[seed] cohort centroids computed:", n, "→", cc.rows.map((r) => r.cohort_id).join(", "));
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
