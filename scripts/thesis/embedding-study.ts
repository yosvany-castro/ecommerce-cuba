#!/usr/bin/env tsx
/**
 * F1 embedding study. For each available space, build eval cases from the thesis
 * holdout (userVector = mean of the user's TRAIN item vectors in THAT space;
 * candidates = catalog minus the user's train items; relevant = test product;
 * complements = GT complement graph of the test product), score with the F0
 * harness, then emit a markdown comparison + a production recommendation.
 * Spaces with no persisted vectors are skipped (logged), not failed.
 * Usage: pnpm thesis:embedding-study
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { evaluateRanker, type EvalCase, type EvalResult } from "@/thesis/eval/harness";
import { aggregateCases } from "@/thesis/eval/aggregate";
import { cosineSingleVectorRanker } from "@/thesis/eval/baselines";
import { maxSimRanker } from "@/thesis/embedders/maxsim";
import { meanPool, l2normalize } from "@/thesis/embedders/space";
import { recommendProductionSpace, type SpaceScore } from "@/thesis/embedders/recommend";
import type { RankItem } from "@/thesis/types";

const KS = [5, 10, 20];
const COST: Record<string, number> = { e0_text: 1, e1_prod2vec: 1, e2_hybrid: 1, e3_two_tower: 1, e4_late: 5, e5_context3: 2 };

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const meta = await pg.query(`SELECT id::text id, metadata->>'subcategory' cohort FROM thesis.products`);
    const cohortById = new Map((meta.rows as { id: string; cohort: string }[]).map((r) => [r.id, r.cohort]));
    const popR = await pg.query(`SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`);
    const popById = new Map((popR.rows as { pid: string; c: number }[]).map((r) => [r.pid, r.c]));
    const trainR = await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`);
    const trainByUser = new Map<string, string[]>();
    for (const r of trainR.rows as { uid: string; pid: string }[]) { const a = trainByUser.get(r.uid) ?? []; a.push(r.pid); trainByUser.set(r.uid, a); }
    const testR = await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test'`);
    const tests = testR.rows as { uid: string; pid: string }[];
    const complR = await pg.query(`SELECT product_a_id::text a, product_b_id::text b FROM thesis.gt_product_relations WHERE relation_type='complement'`);
    const complByItem = new Map<string, Set<string>>();
    for (const r of complR.rows as { a: string; b: string }[]) { const s = complByItem.get(r.a) ?? new Set<string>(); s.add(r.b); complByItem.set(r.a, s); }

    // helpers to build single-vector cases
    const buildSingleCases = (vecs: Map<string, number[]>): EvalCase[] => {
      const allIds = [...vecs.keys()];
      const cases: EvalCase[] = [];
      for (const t of tests) {
        const train = (trainByUser.get(t.uid) ?? []).filter((id) => vecs.has(id));
        if (train.length === 0 || !vecs.has(t.pid)) continue;
        const userVector = l2normalize(meanPool(train.map((id) => vecs.get(id)!)));
        const trainSet = new Set(train);
        const candidates: RankItem[] = allIds.filter((id) => !trainSet.has(id)).map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: vecs.get(id)!, cohort: cohortById.get(id) ?? null }));
        cases.push({ ctx: { userVector, cohort: cohortById.get(t.pid) ?? null }, candidates, relevant: new Set([t.pid]), complements: complByItem.get(t.pid) });
      }
      return cases;
    };

    const results: { space: string; res: EvalResult }[] = [];

    // E0 text (from products.embedding)
    const e0 = new Map<string, number[]>();
    const e0r = await pg.query(`SELECT id::text id, embedding::text v FROM thesis.products WHERE embedding IS NOT NULL`);
    for (const row of e0r.rows as { id: string; v: string }[]) e0.set(row.id, JSON.parse(row.v));

    // E1, E3, E5 from item_vectors
    const loadSpace = async (space: string): Promise<Map<string, number[]>> => {
      const m = new Map<string, number[]>();
      const r = await pg.query(`SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space=$1`, [space]);
      for (const row of r.rows as { id: string; vector: number[] }[]) m.set(row.id, row.vector.map(Number));
      return m;
    };
    const e1 = await loadSpace("e1_prod2vec");
    const e3 = await loadSpace("e3_two_tower");
    const e5 = await loadSpace("e5_context3");

    const scoreSingle = (space: string, vecs: Map<string, number[]>) => {
      if (vecs.size === 0) { console.log(`[study] skip ${space} (no vectors)`); return; }
      const cases = buildSingleCases(vecs);
      const res = evaluateRanker(cosineSingleVectorRanker(), cases, KS);
      results.push({ space, res });
      console.log(`[study] ${space}: ${cases.length} cases nDCG@10=${res.ndcg[10].toFixed(3)} complR@10=${res.complementRecall[10].toFixed(3)}`);
    };
    scoreSingle("e0_text", e0);
    scoreSingle("e1_prod2vec", e1);
    scoreSingle("e3_two_tower", e3);
    scoreSingle("e5_context3", e5);

    // E2 hybrid (text ⊕ prod2vec), kappa=5, blend per-item by popularity
    if (e0.size && e1.size) {
      const KAPPA = 5;
      const hyb = new Map<string, number[]>();
      for (const [id, tv] of e0) {
        const bv = e1.get(id);
        if (!bv) { hyb.set(id, l2normalize(tv)); continue; }
        const a = KAPPA / (KAPPA + (popById.get(id) ?? 0));
        const d = Math.min(tv.length, bv.length);
        const mix = new Array<number>(d);
        for (let i = 0; i < d; i++) mix[i] = a * tv[i] + (1 - a) * bv[i];
        hyb.set(id, l2normalize(mix));
      }
      scoreSingle("e2_hybrid", hyb);
    }

    // E4 late interaction (MaxSim over chunks) — per-case query chunks → aggregateCases
    const chR = await pg.query(`SELECT product_id::text id, chunk_index, vector FROM thesis.item_chunk_vectors WHERE space='e4_late' ORDER BY product_id, chunk_index`);
    const itemChunks = new Map<string, number[][]>();
    for (const row of chR.rows as { id: string; chunk_index: number; vector: number[] }[]) {
      const arr = itemChunks.get(row.id) ?? []; arr[row.chunk_index] = row.vector.map(Number); itemChunks.set(row.id, arr);
    }
    if (itemChunks.size) {
      const allIds = [...itemChunks.keys()];
      type E4Case = EvalCase & { queryChunks: number[][] };
      const cases: E4Case[] = [];
      for (const t of tests) {
        const train = (trainByUser.get(t.uid) ?? []).filter((id) => itemChunks.has(id));
        if (train.length === 0 || !itemChunks.has(t.pid)) continue;
        const queryChunks = train.flatMap((id) => itemChunks.get(id)!).slice(0, 24); // cap for cost
        const trainSet = new Set(train);
        const candidates: RankItem[] = allIds.filter((id) => !trainSet.has(id)).map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: [], cohort: cohortById.get(id) ?? null }));
        cases.push({ ctx: { userVector: [], cohort: cohortById.get(t.pid) ?? null }, candidates, relevant: new Set([t.pid]), complements: complByItem.get(t.pid), queryChunks });
      }
      const res = aggregateCases(cases, (c) => maxSimRanker(itemChunks, () => c.queryChunks), KS, "e4_late");
      results.push({ space: "e4_late", res });
      console.log(`[study] e4_late: ${res.n} cases nDCG@10=${res.ndcg[10].toFixed(3)} complR@10=${res.complementRecall[10].toFixed(3)}`);
    } else {
      console.log(`[study] skip e4_late (no chunks)`);
    }

    // report
    const header = `| Space | cases | MRR | ${KS.map((k) => `nDCG@${k}`).join(" | ")} | ${KS.map((k) => `Recall@${k}`).join(" | ")} | complR@10 |`;
    const sep = `|${"---|".repeat(3 + KS.length * 2 + 1)}`;
    const lines = ["# Thesis F1 — Embedding Study", "", `Cases vary per space (users with ≥1 train item in that space).`, "", header, sep];
    for (const { space, res } of results) {
      lines.push(`| ${space} | ${res.n} | ${res.mrr.toFixed(3)} | ${KS.map((k) => res.ndcg[k].toFixed(3)).join(" | ")} | ${KS.map((k) => res.recall[k].toFixed(3)).join(" | ")} | ${res.complementRecall[10].toFixed(3)} |`);
    }
    const scores: SpaceScore[] = results.map(({ space, res }) => ({ space, ndcg10: res.ndcg[10], complementRecall10: res.complementRecall[10], servingCost: COST[space] ?? 1 }));
    const rec = recommendProductionSpace(scores, { costWeight: 0.5 });
    lines.push("", "## Production recommendation", "", `**Deploy: \`${rec.winner}\`** (utility = quality − 0.5·normalizedCost).`, "", "| Space | quality | utility |", "|---|---|---|");
    for (const r of rec.ranked) lines.push(`| ${r.space} | ${r.quality.toFixed(3)} | ${r.utility.toFixed(3)} |`);
    const md = lines.join("\n") + "\n";
    const out = resolve(process.cwd(), "docs/superpowers/reports/2026-05-29-thesis-f1-embedding-study.md");
    writeFileSync(out, md);
    writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify({ results, recommendation: rec }, null, 2));
    console.log(md);
    console.log(`[study] wrote ${out}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
