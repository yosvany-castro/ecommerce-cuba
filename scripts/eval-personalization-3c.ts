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
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

function ndcgAt10(feedIds: string[], holdoutIds: string[]): number {
  const set = new Set(holdoutIds);
  const rels = feedIds.slice(0, 10).map((id) => (set.has(id) ? 1 : 0));
  const dcg = rels.reduce((s, r, i) => s + r / Math.log2(i + 2), 0);
  const ideal = Math.min(holdoutIds.length, 10);
  let idcg = 0;
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

function recallAt10(feedIds: string[], holdoutIds: string[]): number {
  if (holdoutIds.length === 0) return 0;
  const set = new Set(holdoutIds);
  const hits = feedIds.slice(0, 10).filter((id) => set.has(id)).length;
  return hits / holdoutIds.length;
}

export interface Eval3cResult {
  ndcg_3c: number;
  recall_3c: number;
  ndcg_baseline: number;
  recall_baseline: number;
  ndcg_delta_pct: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  cache_hit_rate: number;
  estimated_llm_cost_usd: number;
  pass: boolean;
}

async function setupCleanDb(pg: Client): Promise<void> {
  await pg.query(
    `TRUNCATE
       test_schema.feed_rerank_cache, test_schema.co_occurrence_top, test_schema.co_occurrence,
       test_schema.products, test_schema.cohort_centroids,
       test_schema.user_profiles, test_schema.user_profile_modes,
       test_schema.session_vectors, test_schema.events,
       test_schema.excluded_products, test_schema.anonymous_sessions CASCADE`,
  );
}

export async function runEval3c(): Promise<Eval3cResult> {
  const pg = await getPgClient({ scope: "test" });
  try {
    await setupCleanDb(pg);

    const cohorts: Array<{
      gender: string;
      ageRange: { min: number; max: number };
      label: string;
    }> = [
      {
        gender: "femenino",
        ageRange: { min: 26, max: 59 },
        label: "fem_adulta",
      },
      {
        gender: "masculino",
        ageRange: { min: 26, max: 59 },
        label: "masc_adulto",
      },
      {
        gender: "femenino",
        ageRange: { min: 4, max: 11 },
        label: "fem_nina",
      },
      {
        gender: "masculino",
        ageRange: { min: 60, max: 99 },
        label: "masc_mayor",
      },
      {
        gender: "femenino",
        ageRange: { min: 12, max: 25 },
        label: "fem_joven",
      },
    ];
    const productsByCohort = new Map<string, string[]>();
    for (const c of cohorts) {
      const ids: string[] = [];
      for (let i = 0; i < 12; i++) {
        const p = await seedProductWithEmbedding(pg, {
          title: `${c.label} item ${i}`,
          metadata: { gender_target: c.gender, age_target: c.ageRange },
        });
        ids.push(p.id);
      }
      productsByCohort.set(c.label, ids);
    }
    await computeCohortCentroids(pg);

    const NUM_USERS = 5;
    const users: Array<{
      anonymous_id: string;
      sessions: string[];
      cohort: string;
    }> = [];
    for (let u = 0; u < NUM_USERS; u++) {
      const cohort = cohorts[u % cohorts.length].label;
      const aid = randomUUID();
      await pg.query(
        `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [aid],
      );
      users.push({ anonymous_id: aid, sessions: [randomUUID()], cohort });
    }

    const HOLDOUT_BY_USER = new Map<string, string[]>();
    const TRAIN_BY_USER = new Map<string, string[]>();
    for (const user of users) {
      const ids = productsByCohort.get(user.cohort) ?? [];
      HOLDOUT_BY_USER.set(user.anonymous_id, ids.slice(-3));
      TRAIN_BY_USER.set(user.anonymous_id, ids.slice(0, ids.length - 3));
    }

    const baseDate = Date.now() - 30 * 24 * 3600 * 1000;
    for (const user of users) {
      const trainIds = TRAIN_BY_USER.get(user.anonymous_id) ?? [];
      for (let day = 1; day <= 23; day++) {
        for (let k = 0; k < 2; k++) {
          const id = trainIds[(day + k) % trainIds.length];
          const ts = new Date(baseDate + day * 24 * 3600 * 1000).toISOString();
          await pg.query(
            `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
             VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
            [
              user.anonymous_id,
              user.sessions[0],
              ts,
              JSON.stringify({ product_id: id, source: "home" }),
            ],
          );
          await processEventForPersonalization(
            {
              anonymous_id: user.anonymous_id,
              user_id: null,
              session_id: user.sessions[0],
              event_type: "product_view",
              payload: { product_id: id, source: "home" },
              occurred_at: ts,
            },
            pg,
          );
        }
      }
    }

    await recomputeNPMI(pg);

    const latencies: number[] = [];
    let totalNdcg = 0;
    let totalRecall = 0;
    let totalNdcgBaseline = 0;
    let totalRecallBaseline = 0;
    let cacheHits = 0;
    let totalLLMCalls = 0;

    const popR = await pg.query(
      `SELECT (payload->>'product_id')::uuid AS pid, COUNT(*)::int AS n
       FROM events
       WHERE occurred_at > now() - interval '7 days'
         AND event_type = 'product_view'
       GROUP BY (payload->>'product_id')
       ORDER BY n DESC LIMIT 10`,
    );
    const baselineIds = (popR.rows as { pid: string }[]).map((x) => x.pid);

    for (const user of users) {
      const holdoutIds = HOLDOUT_BY_USER.get(user.anonymous_id) ?? [];
      const t0 = Date.now();
      const feed = await generateFeed(
        {
          user_id: null,
          anonymous_id: user.anonymous_id,
          session_id: user.sessions[0],
          limit: 10,
        },
        pg,
      );
      const elapsed = Date.now() - t0;
      latencies.push(elapsed);

      if (elapsed < 200) cacheHits++;
      else totalLLMCalls++;

      const feedIds = feed.map((f) => f.product.id);
      totalNdcg += ndcgAt10(feedIds, holdoutIds);
      totalRecall += recallAt10(feedIds, holdoutIds);
      totalNdcgBaseline += ndcgAt10(baselineIds, holdoutIds);
      totalRecallBaseline += recallAt10(baselineIds, holdoutIds);

      const t1 = Date.now();
      await generateFeed(
        {
          user_id: null,
          anonymous_id: user.anonymous_id,
          session_id: user.sessions[0],
          limit: 10,
        },
        pg,
      );
      const elapsed2 = Date.now() - t1;
      latencies.push(elapsed2);
      if (elapsed2 < 200) cacheHits++;
      else totalLLMCalls++;
    }

    const ndcg3c = totalNdcg / NUM_USERS;
    const recall3c = totalRecall / NUM_USERS;
    const ndcgBaseline = totalNdcgBaseline / NUM_USERS;
    const recallBaseline = totalRecallBaseline / NUM_USERS;
    const ndcgDeltaPct =
      ndcgBaseline > 0 ? ((ndcg3c - ndcgBaseline) / ndcgBaseline) * 100 : 0;

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    // DeepSeek pricing approx: input cache-miss $0.27/M, output $1.10/M.
    // ~1500 tok in, ~600 tok out per rerank call ≈ $0.001 per call.
    const COST_PER_CALL_USD = 0.001;
    const estimatedCost = totalLLMCalls * COST_PER_CALL_USD;
    const hitRate = cacheHits / (cacheHits + totalLLMCalls) || 0;

    return {
      ndcg_3c: ndcg3c,
      recall_3c: recall3c,
      ndcg_baseline: ndcgBaseline,
      recall_baseline: recallBaseline,
      ndcg_delta_pct: ndcgDeltaPct,
      latency_p50_ms: p50,
      latency_p95_ms: p95,
      latency_p99_ms: p99,
      cache_hit_rate: hitRate,
      estimated_llm_cost_usd: estimatedCost,
      pass: ndcgDeltaPct >= 5 && p99 < 1500,
    };
  } finally {
    await pg.end();
  }
}

async function main() {
  const r = await runEval3c();
  console.log(
    `# Fase 3c — Eval result · ${new Date().toISOString().slice(0, 10)}\n`,
  );
  console.log(`## Cuantitativo (holdout temporal)`);
  console.log(`- nDCG@10 F3c:      ${(r.ndcg_3c * 100).toFixed(1)}%`);
  console.log(`- nDCG@10 baseline: ${(r.ndcg_baseline * 100).toFixed(1)}%`);
  console.log(`- Delta relativo:   ${r.ndcg_delta_pct.toFixed(1)}%`);
  console.log(`- Recall@10 F3c:    ${(r.recall_3c * 100).toFixed(1)}%`);
  console.log(`- Recall@10 base:   ${(r.recall_baseline * 100).toFixed(1)}%`);
  console.log();
  console.log(`## Latencia (ms)`);
  console.log(`- p50: ${r.latency_p50_ms}`);
  console.log(`- p95: ${r.latency_p95_ms}`);
  console.log(`- p99: ${r.latency_p99_ms}`);
  console.log();
  console.log(`## Cache & costo`);
  console.log(`- Hit rate: ${(r.cache_hit_rate * 100).toFixed(1)}%`);
  console.log(`- Costo LLM eval: $${r.estimated_llm_cost_usd.toFixed(4)}`);
  console.log();
  console.log(
    `**Compuerta:** nDCG@10 +5% relativo Y p99 < 1.5s → ${r.pass ? "✅ PASS" : "⚠️ FAIL"}`,
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
