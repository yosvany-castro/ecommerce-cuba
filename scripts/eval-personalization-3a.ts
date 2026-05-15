#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { getPgClient } from "@/lib/db/pg";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { generateFeed } from "@/sectors/d-personalization/feed";
import {
  COHORT_IDS,
  parseCohort,
  AGE_BAND_RANGES,
  type CohortId,
} from "@/sectors/d-personalization/cohorts/definitions";

interface SyntheticUser {
  label: string;
  anonymous_id: string;
  session_id: string;
  events_cohorts: CohortId[];
}

export interface Eval3aResult {
  recall_at_10: number;
  baseline_recall_at_10: number;
  per_user: { label: string; recall: number; cohort: CohortId | "mixed" }[];
  jaccard_inter_user: number;
  shift_user_split_score: number;
}

async function seedCatalog(
  pg: Client,
  perCohort: number,
): Promise<Map<CohortId, string[]>> {
  const byCohort = new Map<CohortId, string[]>();
  for (const c of COHORT_IDS) {
    if (c === "unisex_indeterminado") continue;
    const { gender, age_band } = parseCohort(c);
    if (!gender || !age_band) continue;
    const r = AGE_BAND_RANGES[age_band];
    const ids: string[] = [];
    for (let i = 0; i < perCohort; i++) {
      const p = await seedProductWithEmbedding(pg, {
        title: `${c} item ${i}`,
        description: `producto de cohorte ${c}`,
        metadata: { gender_target: gender, age_target: r },
      });
      ids.push(p.id);
    }
    byCohort.set(c, ids);
  }
  return byCohort;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni === 0 ? 0 : inter / uni;
}

export async function runEval3aSmoke(opts: {
  productsPerCohort: number;
  eventsPerUser: number;
}): Promise<Eval3aResult> {
  const pg = await getPgClient({ scope: "test" });
  try {
    await pg.query(
      `TRUNCATE test_schema.products, test_schema.cohort_centroids,
                test_schema.user_profiles, test_schema.user_profile_modes,
                test_schema.session_vectors, test_schema.events,
                test_schema.excluded_products, test_schema.anonymous_sessions CASCADE`,
    );
    const catalog = await seedCatalog(pg, opts.productsPerCohort);
    await computeCohortCentroids(pg);

    // Reserve a holdout slice (last 3 products per cohort) — never shown to users.
    const holdoutByCohort = new Map<CohortId, string[]>();
    const trainByCohort = new Map<CohortId, string[]>();
    for (const [c, ids] of catalog) {
      const k = Math.min(3, Math.floor(ids.length / 2));
      holdoutByCohort.set(c, ids.slice(-k));
      trainByCohort.set(c, ids.slice(0, ids.length - k));
    }

    const N = opts.eventsPerUser;
    const u1: SyntheticUser = {
      label: "U1-femenino_adulta",
      anonymous_id: randomUUID(),
      session_id: randomUUID(),
      events_cohorts: new Array(N).fill("femenino_adulta") as CohortId[],
    };
    const u2: SyntheticUser = {
      label: "U2-masculino_adulto",
      anonymous_id: randomUUID(),
      session_id: randomUUID(),
      events_cohorts: new Array(N).fill("masculino_adulto") as CohortId[],
    };
    const u3: SyntheticUser = {
      label: "U3-femenino_nina",
      anonymous_id: randomUUID(),
      session_id: randomUUID(),
      events_cohorts: new Array(N).fill("femenino_nina") as CohortId[],
    };
    const u5: SyntheticUser = {
      label: "U5-shift_fem_to_masc_nino",
      anonymous_id: randomUUID(),
      session_id: randomUUID(),
      events_cohorts: [
        ...(new Array(Math.floor(N / 2)).fill("femenino_adulta") as CohortId[]),
        ...(new Array(Math.ceil(N / 2)).fill("masculino_nino") as CohortId[]),
      ],
    };

    const usedByUser: Record<string, Set<string>> = {
      [u1.anonymous_id]: new Set(),
      [u2.anonymous_id]: new Set(),
      [u3.anonymous_id]: new Set(),
      [u5.anonymous_id]: new Set(),
    };

    async function runUserEvents(u: SyntheticUser) {
      await pg.query(
        `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [u.anonymous_id],
      );
      for (const c of u.events_cohorts) {
        // Only train slice — never expose holdout products to the user
        const ids = trainByCohort.get(c) ?? [];
        if (ids.length === 0) continue;
        const usedSet = usedByUser[u.anonymous_id];
        const candidate =
          ids.find((id) => !usedSet.has(id)) ??
          ids[Math.floor(Math.random() * ids.length)];
        usedSet.add(candidate);
        await processEventForPersonalization(
          {
            anonymous_id: u.anonymous_id,
            user_id: null,
            session_id: u.session_id,
            event_type: "product_view",
            payload: { product_id: candidate, source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
      }
    }

    for (const u of [u1, u2, u3, u5]) await runUserEvents(u);

    async function feedFor(u: SyntheticUser) {
      return generateFeed(
        {
          user_id: null,
          anonymous_id: u.anonymous_id,
          session_id: u.session_id,
          limit: 10,
        },
        pg,
      );
    }

    function recallAt10(feedIds: string[], heldOut: string[]): number {
      const set = new Set(feedIds);
      const hit = heldOut.filter((h) => set.has(h)).length;
      return heldOut.length === 0 ? 0 : hit / heldOut.length;
    }

    const heldU1 = holdoutByCohort.get("femenino_adulta") ?? [];
    const heldU2 = holdoutByCohort.get("masculino_adulto") ?? [];
    const heldU3 = holdoutByCohort.get("femenino_nina") ?? [];

    const f1 = await feedFor(u1);
    const f2 = await feedFor(u2);
    const f3 = await feedFor(u3);
    const f5 = await feedFor(u5);

    const r1 = recallAt10(f1.map((f) => f.product.id), heldU1);
    const r2 = recallAt10(f2.map((f) => f.product.id), heldU2);
    const r3 = recallAt10(f3.map((f) => f.product.id), heldU3);
    const recall = (r1 + r2 + r3) / 3;

    // Baseline: top-popular = the 10 most recently inserted products
    // (proxy for "global popular" in smoke without real event log)
    const popR = await pg.query(
      `SELECT id::text FROM products ORDER BY created_at DESC LIMIT 10`,
    );
    const popIds = (popR.rows as { id: string }[]).map((x) => x.id);
    const baseR1 = recallAt10(popIds, heldU1);
    const baseR2 = recallAt10(popIds, heldU2);
    const baseR3 = recallAt10(popIds, heldU3);
    const baseRecall = (baseR1 + baseR2 + baseR3) / 3;

    const s1 = new Set(f1.map((f) => f.product.id));
    const s2 = new Set(f2.map((f) => f.product.id));
    const s3 = new Set(f3.map((f) => f.product.id));
    const jacc =
      (jaccard(s1, s2) + jaccard(s1, s3) + jaccard(s2, s3)) / 3;

    const mascNinoIds = new Set(catalog.get("masculino_nino") ?? []);
    const u5Score =
      f5.filter((f) => mascNinoIds.has(f.product.id)).length /
      Math.max(1, f5.length);

    return {
      recall_at_10: recall,
      baseline_recall_at_10: baseRecall,
      per_user: [
        { label: u1.label, recall: r1, cohort: "femenino_adulta" },
        { label: u2.label, recall: r2, cohort: "masculino_adulto" },
        { label: u3.label, recall: r3, cohort: "femenino_nina" },
      ],
      jaccard_inter_user: jacc,
      shift_user_split_score: u5Score,
    };
  } finally {
    await pg.end();
  }
}

async function main() {
  const r = await runEval3aSmoke({ productsPerCohort: 8, eventsPerUser: 12 });
  const TODAY = new Date().toISOString().slice(0, 10);
  console.log(`# Fase 3a — Eval result · ${TODAY}\n`);
  console.log(`| Métrica | Valor |`);
  console.log(`|---|---|`);
  console.log(`| Recall@10 (avg U1+U2+U3) | ${(r.recall_at_10 * 100).toFixed(1)}% |`);
  console.log(
    `| Baseline (top-popular global) | ${(r.baseline_recall_at_10 * 100).toFixed(1)}% |`,
  );
  console.log(
    `| Δ (pp) | ${((r.recall_at_10 - r.baseline_recall_at_10) * 100).toFixed(1)} |`,
  );
  console.log(
    `| Jaccard inter-user (lower=better) | ${r.jaccard_inter_user.toFixed(3)} |`,
  );
  console.log(
    `| U5 shift score (masc_nino %) | ${(r.shift_user_split_score * 100).toFixed(1)}% |`,
  );
  console.log();
  console.log(`## Per-user breakdown\n`);
  for (const u of r.per_user) {
    console.log(`- **${u.label}** (cohort ${u.cohort}): Recall@10 = ${(u.recall * 100).toFixed(1)}%`);
  }
  console.log();
  const passed = r.recall_at_10 - r.baseline_recall_at_10 >= 0.20;
  console.log(
    `**Compuerta Recall@10 ≥ baseline + 20pp:** ${passed ? "✅ PASS" : "⚠️ NO ALCANZADO"}`,
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
