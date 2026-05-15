import type { Client } from "pg";
import { normalize } from "@/lib/math";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { cohortIdFor, type CohortId } from "./definitions";

interface ProductRow {
  embedding_text: string;
  gender_target: string | null;
  age_min: number | null;
  age_max: number | null;
}

function parseVectorText(s: string): number[] {
  return JSON.parse(s) as number[];
}

export async function computeCohortCentroids(pg: Client): Promise<void> {
  const r = await pg.query(
    `SELECT embedding::text AS embedding_text,
            (metadata->>'gender_target') AS gender_target,
            ((metadata->'age_target'->>'min')::int) AS age_min,
            ((metadata->'age_target'->>'max')::int) AS age_max
     FROM products
     WHERE is_active = true AND embedding IS NOT NULL`,
  );

  const buckets = new Map<CohortId, { sum: number[]; count: number }>();
  for (const row of r.rows as ProductRow[]) {
    const repAge =
      row.age_max !== null && row.age_min !== null
        ? Math.round((row.age_min + row.age_max) / 2)
        : null;
    const cohort = cohortIdFor(
      row.gender_target as "femenino" | "masculino" | "unisex" | null,
      repAge,
    );
    if (cohort === "unisex_indeterminado") continue; // skip fallback bucket — sólo cohortes concretas
    let b = buckets.get(cohort);
    if (!b) {
      b = { sum: new Array<number>(EMBEDDING_DIM).fill(0), count: 0 };
      buckets.set(cohort, b);
    }
    const v = parseVectorText(row.embedding_text);
    if (v.length !== EMBEDDING_DIM) continue;
    for (let i = 0; i < EMBEDDING_DIM; i++) b.sum[i] += v[i];
    b.count += 1;
  }

  for (const [cohort, { sum, count }] of buckets) {
    const centroid = normalize(sum.map((x) => x / count));
    await pg.query(
      `INSERT INTO cohort_centroids (cohort_id, centroid_vector, n_users_in_cohort, last_recompute_at)
       VALUES ($1, $2::vector, $3, now())
       ON CONFLICT (cohort_id) DO UPDATE SET
         centroid_vector = EXCLUDED.centroid_vector,
         n_users_in_cohort = EXCLUDED.n_users_in_cohort,
         last_recompute_at = EXCLUDED.last_recompute_at`,
      [cohort, "[" + centroid.join(",") + "]", count],
    );
  }
}
