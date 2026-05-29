#!/usr/bin/env tsx
/**
 * Thesis F0 eval runner CLI.
 *
 * Loads the temporal holdout from the `thesis` DB, constructs eval cases from
 * the train/test split, runs the four baseline rankers, and writes a markdown +
 * JSON report to docs/superpowers/reports/.
 *
 * Case construction:
 *   For each (user, test-product) pair where the user has ≥1 train purchase
 *   with a known factor vector:
 *     - userVector = element-wise mean of the user's train-item factor vectors.
 *     - cohort     = subcategory of the test product.
 *     - candidates = full catalog MINUS the user's train items (already bought).
 *     - relevant   = { testProductId }.
 *   Users with no usable train vector (no factor data) are skipped.
 *
 * Popularity fix (F3c bug):
 *   The prior F3c baseline used a 7-day window on events, so synthetic events
 *   that fell outside the window produced an empty popular baseline → nDCG 0 →
 *   spurious 0% delta. Here popularity is ALL-TIME event count (no time filter),
 *   guaranteeing a non-zero signal whenever any event has been recorded.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync, mkdirSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import type { RankItem } from "@/thesis/types";
import type { EvalCase } from "@/thesis/eval/harness";
import { evaluateRanker } from "@/thesis/eval/harness";
import {
  randomRanker,
  popularGlobalRanker,
  popularCohortRanker,
  cosineSingleVectorRanker,
} from "@/thesis/eval/baselines";
import { renderReport } from "@/thesis/eval/report";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Element-wise mean of a list of equal-length vectors. */
function meanVec(vs: number[][]): number[] {
  if (vs.length === 0) return [];
  const dim = vs[0].length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vs) {
    for (let i = 0; i < dim; i++) {
      out[i] += v[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    out[i] /= vs.length;
  }
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ── 1. Load catalog with factor vectors and ALL-TIME popularity ──────────
    //
    // ALL-TIME event count: no WHERE clause on occurred_at / created_at.
    // This is intentional — the F3c baseline used a 7-day window which caused
    // an empty popular-global baseline for synthetic data generated outside that
    // window, producing nDCG 0 and a spurious delta.  All-time popularity ensures
    // a non-zero signal whenever any event exists for a product.
    const catalogRes = await pg.query<{
      id: string;
      factor_vector: number[];
      cohort: string | null;
      popularity: number;
    }>(`
      SELECT
        p.id::text                        AS id,
        f.factor_vector,
        p.metadata->>'subcategory'        AS cohort,
        COALESCE(pop.c, 0)::int           AS popularity
      FROM thesis.products p
      JOIN thesis.gt_product_factors f ON f.product_id = p.id
      LEFT JOIN (
        SELECT
          (payload->>'product_id') AS pid,
          count(*)                 AS c
        FROM thesis.events
        WHERE payload->>'product_id' IS NOT NULL
        GROUP BY 1
      ) pop ON pop.pid = p.id::text
    `);

    const catalog: RankItem[] = catalogRes.rows.map((r) => ({
      id: r.id,
      popularity: r.popularity,
      vector: (r.factor_vector as unknown as number[]).map(Number),
      cohort: r.cohort,
    }));

    const catalogSet = new Set(catalog.map((c) => c.id));
    const factorById = new Map<string, number[]>(
      catalog.map((c) => [c.id, c.vector]),
    );
    const cohortById = new Map<string, string | null>(
      catalog.map((c) => [c.id, c.cohort ?? null]),
    );

    // ── 2. Load train purchases per user ─────────────────────────────────────
    const trainRes = await pg.query<{ uid: string; pid: string }>(`
      SELECT user_id::text AS uid, product_id::text AS pid
      FROM thesis.holdout
      WHERE split = 'train'
    `);

    const trainByUser = new Map<string, string[]>();
    for (const { uid, pid } of trainRes.rows) {
      if (!trainByUser.has(uid)) trainByUser.set(uid, []);
      trainByUser.get(uid)!.push(pid);
    }

    // ── 3. Load test rows ────────────────────────────────────────────────────
    const testRes = await pg.query<{ uid: string; pid: string }>(`
      SELECT user_id::text AS uid, product_id::text AS pid
      FROM thesis.holdout
      WHERE split = 'test'
    `);

    // ── 4. Build eval cases ──────────────────────────────────────────────────
    const cases: EvalCase[] = [];

    for (const { uid, pid: testPid } of testRes.rows) {
      // Skip test products not in catalog (no factor vector)
      if (!catalogSet.has(testPid)) continue;

      const trainPids = trainByUser.get(uid) ?? [];
      // Collect train item vectors (only those present in the catalog)
      const trainVecs: number[][] = trainPids
        .filter((p) => factorById.has(p))
        .map((p) => factorById.get(p)!);

      // Skip users with no usable train vector
      if (trainVecs.length === 0) continue;

      const userVector = meanVec(trainVecs);
      const trainSet = new Set(trainPids);

      // Candidates = full catalog minus already-bought train items
      const candidates = catalog.filter((item) => !trainSet.has(item.id));

      const testCohort = cohortById.get(testPid) ?? null;

      cases.push({
        ctx: { userVector, cohort: testCohort },
        candidates,
        relevant: new Set([testPid]),
      });
    }

    console.log(`[eval] built ${cases.length} cases`);

    // ── 5. Run rankers ───────────────────────────────────────────────────────
    const ks = [5, 10, 20];
    const rankers = [
      randomRanker(),
      popularGlobalRanker(),
      popularCohortRanker(),
      cosineSingleVectorRanker(),
    ];

    const results = rankers.map((rk) => evaluateRanker(rk, cases, ks));

    // ── 6. Write reports ─────────────────────────────────────────────────────
    const reportsDir = resolve(process.cwd(), "docs/superpowers/reports");
    mkdirSync(reportsDir, { recursive: true });

    const baseName = "2026-05-29-thesis-f0-baseline-eval";
    const mdPath = resolve(reportsDir, `${baseName}.md`);
    const jsonPath = resolve(reportsDir, `${baseName}.json`);

    const markdown = renderReport(results, ks);
    writeFileSync(mdPath, markdown, "utf8");
    writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");

    console.log(markdown);
    console.log(`[eval] wrote ${mdPath}`);
    console.log(`[eval] wrote ${jsonPath}`);
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error("[eval] fatal:", err);
  process.exit(1);
});
