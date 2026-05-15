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
import { recomputeModesForBucket } from "@/sectors/d-personalization/multimode/recompute";
import type { FeedItem } from "@/sectors/d-personalization/retrieve";

function ndcgAt10(
  feed: { product: { id: string } }[],
  holdoutIds: string[],
): number {
  const rels = feed
    .slice(0, 10)
    .map((f) => (holdoutIds.includes(f.product.id) ? 1 : 0));
  const dcg = rels.reduce((s, rel, i) => s + rel / Math.log2(i + 2), 0);
  const ideal = Math.min(holdoutIds.length, 10);
  let idcg = 0;
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni === 0 ? 0 : inter / uni;
}

export interface Eval3bResult {
  multimode_ndcg_multi: number;
  multimode_ndcg_single: number;
  multimode_pass: boolean;
  crosssell_fundas_in_top10: number;
  crosssell_pass: boolean;
  diversity_jaccard_avg: number;
  diversity_pass: boolean;
}

async function setupCleanDb(pg: Client): Promise<void> {
  await pg.query(
    `TRUNCATE
       test_schema.co_occurrence_top, test_schema.co_occurrence,
       test_schema.products, test_schema.cohort_centroids,
       test_schema.user_profiles, test_schema.user_profile_modes,
       test_schema.session_vectors, test_schema.events,
       test_schema.excluded_products, test_schema.anonymous_sessions CASCADE`,
  );
}

async function subExpMultimode(
  pg: Client,
  opts: { eventsPerStyle: number; productsPerStyle: number },
): Promise<{ ndcg_multi: number; ndcg_single: number }> {
  await setupCleanDb(pg);

  const formalIds: string[] = [];
  const casualIds: string[] = [];
  for (let i = 0; i < opts.productsPerStyle; i++) {
    formalIds.push(
      (await seedProductWithEmbedding(pg, {
        title: `Vestido formal elegante de gala ${i}`,
        description: "ropa elegante para eventos formales",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      })).id,
    );
    casualIds.push(
      (await seedProductWithEmbedding(pg, {
        title: `Camiseta casual algodón diaria ${i}`,
        description: "ropa cómoda casual para uso diario",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      })).id,
    );
  }
  await computeCohortCentroids(pg);

  const holdK = Math.max(1, Math.floor(opts.productsPerStyle / 3));
  const heldFormal = formalIds.slice(-holdK);
  const heldCasual = casualIds.slice(-holdK);
  const trainFormal = formalIds.slice(0, formalIds.length - holdK);
  const trainCasual = casualIds.slice(0, casualIds.length - holdK);

  const anon = randomUUID();
  const sid = randomUUID();
  await pg.query(
    `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [anon],
  );

  let idx = 0;
  for (let i = 0; i < opts.eventsPerStyle; i++) {
    for (const list of [trainFormal, trainCasual]) {
      const id = list[i % list.length];
      const now = new Date(Date.now() + idx * 1000).toISOString();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [anon, sid, now, JSON.stringify({ product_id: id, source: "home" })],
      );
      await processEventForPersonalization(
        {
          anonymous_id: anon,
          user_id: null,
          session_id: sid,
          event_type: "product_view",
          payload: { product_id: id, source: "home" },
          occurred_at: now,
        },
        pg,
      );
      idx++;
    }
  }

  const feedMulti = await generateFeed(
    { user_id: null, anonymous_id: anon, session_id: sid, limit: 10 },
    pg,
  );
  const ndcgMulti = ndcgAt10(feedMulti, [...heldFormal, ...heldCasual]);

  // Force single-mode and re-eval
  const upR = await pg.query(
    `SELECT id::text FROM user_profiles WHERE anonymous_id = $1`,
    [anon],
  );
  await recomputeModesForBucket(
    {
      user_profile_id: upR.rows[0].id,
      recipient_id: null,
      cohort_id: "femenino_adulta",
      target_modes: 1,
    },
    pg,
  );
  const feedSingle = await generateFeed(
    { user_id: null, anonymous_id: anon, session_id: sid, limit: 10 },
    pg,
  );
  const ndcgSingle = ndcgAt10(feedSingle, [...heldFormal, ...heldCasual]);

  return { ndcg_multi: ndcgMulti, ndcg_single: ndcgSingle };
}

async function subExpCrossSell(
  pg: Client,
  opts: { coSessions: number },
): Promise<{ fundas_in_top10: number }> {
  await setupCleanDb(pg);

  const iPhones: string[] = [];
  const fundas: string[] = [];
  for (let i = 0; i < 3; i++) {
    iPhones.push(
      (await seedProductWithEmbedding(pg, {
        title: `iPhone 15 Pro 256GB modelo ${i}`,
        description: "smartphone Apple iPhone gama alta",
        metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
      })).id,
    );
    fundas.push(
      (await seedProductWithEmbedding(pg, {
        title: `Funda silicona iPhone 15 Pro color ${i}`,
        description: "accesorio protector silicona suave",
        metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
      })).id,
    );
  }
  const randoms: string[] = [];
  for (let i = 0; i < 10; i++) {
    randoms.push(
      (await seedProductWithEmbedding(pg, {
        title: `Random no relacionado ${i}`,
        metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
      })).id,
    );
  }
  await computeCohortCentroids(pg);

  for (let s = 0; s < opts.coSessions; s++) {
    const sid = randomUUID();
    const aid = randomUUID();
    await pg.query(
      `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [aid],
    );
    const ip = iPhones[s % iPhones.length];
    const fn = fundas[s % fundas.length];
    const t0 = new Date(Date.now() + s * 1000).toISOString();
    const t1 = new Date(Date.now() + s * 1000 + 500).toISOString();
    await pg.query(
      `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
       VALUES ($1, $2, 'product_view', $3, $4::jsonb), ($1, $2, 'product_view', $5, $6::jsonb)`,
      [
        aid,
        sid,
        t0,
        JSON.stringify({ product_id: ip, source: "home" }),
        t1,
        JSON.stringify({ product_id: fn, source: "home" }),
      ],
    );
    await processEventForPersonalization(
      {
        anonymous_id: aid,
        user_id: null,
        session_id: sid,
        event_type: "product_view",
        payload: { product_id: ip, source: "home" },
        occurred_at: t0,
      },
      pg,
    );
    await processEventForPersonalization(
      {
        anonymous_id: aid,
        user_id: null,
        session_id: sid,
        event_type: "product_view",
        payload: { product_id: fn, source: "home" },
        occurred_at: t1,
      },
      pg,
    );
  }

  // Inject noise pairs so NPMI math has non-degenerate variance
  for (let i = 0; i < randoms.length - 1; i++) {
    for (let j = i + 1; j < randoms.length; j++) {
      const [lo, hi] =
        randoms[i] < randoms[j] ? [randoms[i], randoms[j]] : [randoms[j], randoms[i]];
      await pg.query(
        `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
         VALUES ($1, $2, 5, now())
         ON CONFLICT DO NOTHING`,
        [lo, hi],
      );
    }
  }

  await recomputeNPMI(pg);

  const newAnon = randomUUID();
  const newSession = randomUUID();
  await pg.query(
    `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [newAnon],
  );
  const tNow = new Date().toISOString();
  await pg.query(
    `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
     VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
    [newAnon, newSession, tNow, JSON.stringify({ product_id: iPhones[0], source: "home" })],
  );
  await processEventForPersonalization(
    {
      anonymous_id: newAnon,
      user_id: null,
      session_id: newSession,
      event_type: "product_view",
      payload: { product_id: iPhones[0], source: "home" },
      occurred_at: tNow,
    },
    pg,
  );

  const feed = await generateFeed(
    { user_id: null, anonymous_id: newAnon, session_id: newSession, limit: 10 },
    pg,
  );
  return { fundas_in_top10: feed.filter((f) => fundas.includes(f.product.id)).length };
}

async function subExpDiversity(
  pg: Client,
  opts: { eventsPerUser: number },
): Promise<{ jaccard_avg: number }> {
  await setupCleanDb(pg);

  const seedCohort = async (gender: string, age: { min: number; max: number }) => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(
        (await seedProductWithEmbedding(pg, {
          title: `${gender}-${age.min} item ${i}`,
          metadata: { gender_target: gender, age_target: age },
        })).id,
      );
    }
    return ids;
  };
  const cFem = await seedCohort("femenino", { min: 26, max: 59 });
  const cMasc = await seedCohort("masculino", { min: 26, max: 59 });
  const cNino = await seedCohort("masculino", { min: 4, max: 11 });
  await computeCohortCentroids(pg);

  const runUser = async (ids: string[]): Promise<FeedItem[]> => {
    const aid = randomUUID();
    const sid = randomUUID();
    await pg.query(
      `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [aid],
    );
    for (let i = 0; i < opts.eventsPerUser; i++) {
      const id = ids[i % ids.length];
      const now = new Date(Date.now() + i * 1000).toISOString();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [aid, sid, now, JSON.stringify({ product_id: id, source: "home" })],
      );
      await processEventForPersonalization(
        {
          anonymous_id: aid,
          user_id: null,
          session_id: sid,
          event_type: "product_view",
          payload: { product_id: id, source: "home" },
          occurred_at: now,
        },
        pg,
      );
    }
    return generateFeed(
      { user_id: null, anonymous_id: aid, session_id: sid, limit: 10 },
      pg,
    );
  };

  const f1 = await runUser(cFem);
  const f2 = await runUser(cMasc);
  const f3 = await runUser(cNino);
  const s1 = new Set(f1.map((f) => f.product.id));
  const s2 = new Set(f2.map((f) => f.product.id));
  const s3 = new Set(f3.map((f) => f.product.id));
  const avg = (jaccard(s1, s2) + jaccard(s1, s3) + jaccard(s2, s3)) / 3;
  return { jaccard_avg: avg };
}

export async function runEval3b(opts: {
  multimodeEventsPerStyle: number;
  multimodeProductsPerStyle: number;
  crossSellCoSessions: number;
  diversityEventsPerUser: number;
}): Promise<Eval3bResult> {
  const pg = await getPgClient({ scope: "test" });
  try {
    const mm = await subExpMultimode(pg, {
      eventsPerStyle: opts.multimodeEventsPerStyle,
      productsPerStyle: opts.multimodeProductsPerStyle,
    });
    const cs = await subExpCrossSell(pg, { coSessions: opts.crossSellCoSessions });
    const div = await subExpDiversity(pg, { eventsPerUser: opts.diversityEventsPerUser });
    return {
      multimode_ndcg_multi: mm.ndcg_multi,
      multimode_ndcg_single: mm.ndcg_single,
      multimode_pass: mm.ndcg_multi >= mm.ndcg_single,
      crosssell_fundas_in_top10: cs.fundas_in_top10,
      crosssell_pass: cs.fundas_in_top10 >= 1,
      diversity_jaccard_avg: div.jaccard_avg,
      diversity_pass: div.jaccard_avg >= 0.05 && div.jaccard_avg <= 0.40,
    };
  } finally {
    await pg.end();
  }
}

async function main() {
  const r = await runEval3b({
    multimodeEventsPerStyle: 13,
    multimodeProductsPerStyle: 12,
    crossSellCoSessions: 10,
    diversityEventsPerUser: 8,
  });
  console.log(`# Fase 3b — Eval result · ${new Date().toISOString().slice(0, 10)}\n`);
  console.log(`## Sub-experimento 1: Multi-modo within-cohort`);
  console.log(`- nDCG@10 multi-modo: ${(r.multimode_ndcg_multi * 100).toFixed(1)}%`);
  console.log(`- nDCG@10 single-modo: ${(r.multimode_ndcg_single * 100).toFixed(1)}%`);
  console.log(
    `- Compuerta (multi >= single): ${r.multimode_pass ? "✅ PASS" : "⚠️ FAIL"}\n`,
  );
  console.log(`## Sub-experimento 2: Cross-sell vía NPMI`);
  console.log(`- Fundas iPhone en top-10: ${r.crosssell_fundas_in_top10}`);
  console.log(`- Compuerta (>=1): ${r.crosssell_pass ? "✅ PASS" : "⚠️ FAIL"}\n`);
  console.log(`## Sub-experimento 3: Diversidad guardrail`);
  console.log(`- Jaccard inter-user avg: ${r.diversity_jaccard_avg.toFixed(3)}`);
  console.log(
    `- Compuerta [0.05, 0.40]: ${r.diversity_pass ? "✅ PASS" : "⚠️ FAIL"}\n`,
  );
  const allPass = r.multimode_pass && r.crosssell_pass && r.diversity_pass;
  console.log(
    `**${allPass ? "✅ ALL SUB-EXPERIMENTS PASS" : "⚠️ Some sub-experiments did NOT pass"}**`,
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
