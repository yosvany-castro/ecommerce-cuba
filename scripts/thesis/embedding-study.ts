#!/usr/bin/env tsx
/**
 * F1 embedding study. EVERY space ranks the SAME users against ONE common
 * candidate universe (items representable in every participating space) so the
 * cross-space metrics are apples-to-apples; only the vectors differ. For each
 * test-holdout user: userVector = mean of the user's TRAIN item vectors in THAT
 * space; candidates = common universe minus the user's train items; relevant =
 * test product; complements = GT complement graph of the test product
 * (intersected with the candidate universe). Scores with the F0 harness, then
 * emits a markdown comparison + a production recommendation. Spaces with no
 * persisted vectors are skipped (logged), not failed.
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
import { hybridScoreFusionRanker } from "@/thesis/embedders/hybrid";
import { meanPool, l2normalize } from "@/thesis/embedders/space";
import { recommendProductionSpace, type SpaceScore } from "@/thesis/embedders/recommend";
import type { RankItem } from "@/thesis/types";

const KS = [5, 10, 20];
const COST: Record<string, number> = { e0_text: 1, e1_prod2vec: 1, e2_hybrid: 1, e3_two_tower: 1, e4_late: 5, e5_context3: 2 };
const KAPPA = 5;
const E4_QUERY_CAP = 24;
// Per-space embedding dimension disclosure (E2 is score-fusion, E4 is chunk-MaxSim).
const DIM_NOTE: Record<string, string> = {
  e0_text: "1024",
  e1_prod2vec: "64",
  e2_hybrid: "score-fusion (text 1024-d ⊕ behaviour 64-d)",
  e3_two_tower: "64",
  e4_late: "chunk-MaxSim",
  e5_context3: "1024",
};

/** A shared scaffold entry: identical users + candidate ids for every space. */
interface Scaffold {
  uid: string;
  pid: string;
  train: string[];
  trainSet: Set<string>;
  candidateIds: string[];
  complements: Set<string>;
  cohort: string | null;
}

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

    // ── 1. Load all spaces first ────────────────────────────────────────────
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

    // E4 chunks from item_chunk_vectors
    const chR = await pg.query(`SELECT product_id::text id, chunk_index, vector FROM thesis.item_chunk_vectors WHERE space='e4_late' ORDER BY product_id, chunk_index`);
    const itemChunks = new Map<string, number[][]>();
    for (const row of chR.rows as { id: string; chunk_index: number; vector: number[] }[]) {
      const arr = itemChunks.get(row.id) ?? []; arr[row.chunk_index] = row.vector.map(Number); itemChunks.set(row.id, arr);
    }

    // ── 2. Common candidate universe ────────────────────────────────────────
    // PARTICIPATING single-vector spaces = non-empty maps. E0 is the base.
    const singleSpaces: { space: string; vecs: Map<string, number[]> }[] = [
      { space: "e0_text", vecs: e0 },
      { space: "e1_prod2vec", vecs: e1 },
      { space: "e3_two_tower", vecs: e3 },
      { space: "e5_context3", vecs: e5 },
    ];
    const participating = singleSpaces.filter((s) => {
      if (s.vecs.size === 0) { console.log(`[study] skip ${s.space} (no vectors)`); return false; }
      return true;
    });
    const e4Participates = itemChunks.size > 0;
    if (!e4Participates) console.log(`[study] skip e4_late (no chunks)`);

    const e0Present = e0.size > 0;
    if (!e0Present) throw new Error("[study] E0 (text) has no vectors — cannot build a common universe");

    // commonIds = items representable in EVERY participating single-vector space
    // AND (if E4 participates) the E4 chunk-id set. Built deterministically from
    // a sorted base list (E0's ids).
    const baseSorted = [...e0.keys()].sort((a, b) => a.localeCompare(b));
    const commonIds = new Set<string>();
    for (const id of baseSorted) {
      let ok = true;
      for (const { vecs } of participating) { if (!vecs.has(id)) { ok = false; break; } }
      if (ok && e4Participates && !itemChunks.has(id)) ok = false;
      if (ok) commonIds.add(id);
    }

    // E2 participates iff E0 and E1 both present (uses commonIds ⊆ E0∩E1).
    const e2Participates = e0Present && e1.size > 0;

    // ── 3. Shared scaffold (built ONCE) ─────────────────────────────────────
    const commonSorted = [...commonIds].sort((a, b) => a.localeCompare(b));
    const scaffold: Scaffold[] = [];
    const testsSorted = [...tests].sort((a, b) => a.uid.localeCompare(b.uid) || a.pid.localeCompare(b.pid));
    for (const t of testsSorted) {
      const train = (trainByUser.get(t.uid) ?? []).filter((id) => commonIds.has(id));
      if (train.length === 0 || !commonIds.has(t.pid)) continue;
      const trainSet = new Set(train);
      const candidateIds = commonSorted.filter((id) => !trainSet.has(id));
      const complements = new Set(
        [...(complByItem.get(t.pid) ?? [])].filter((id) => commonIds.has(id) && !trainSet.has(id)),
      );
      scaffold.push({ uid: t.uid, pid: t.pid, train, trainSet, candidateIds, complements, cohort: cohortById.get(t.pid) ?? null });
    }

    const results: { space: string; res: EvalResult }[] = [];

    // ── 4. Single-vector spaces (E0,E1,E3,E5) ───────────────────────────────
    const scoreSingle = (space: string, vecs: Map<string, number[]>) => {
      const cases: EvalCase[] = scaffold.map((s) => {
        const userVector = l2normalize(meanPool(s.train.map((id) => vecs.get(id)!)));
        const candidates: RankItem[] = s.candidateIds.map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: vecs.get(id)!, cohort: cohortById.get(id) ?? null }));
        return { ctx: { userVector, cohort: s.cohort }, candidates, relevant: new Set([s.pid]), complements: s.complements };
      });
      const res = evaluateRanker(cosineSingleVectorRanker(), cases, KS);
      results.push({ space, res });
      console.log(`[study] ${space}: ${cases.length} cases nDCG@10=${res.ndcg[10].toFixed(3)} complR@10=${res.complementRecall[10].toFixed(3)}`);
    };
    for (const { space, vecs } of participating) scoreSingle(space, vecs);

    // ── 5. E2 hybrid (dimension-safe score-fusion over the shared scaffold) ──
    if (e2Participates) {
      type E2Case = EvalCase & { textUser: number[]; behavUser: number[] };
      const cases: E2Case[] = scaffold.map((s) => {
        const textUser = l2normalize(meanPool(s.train.map((id) => e0.get(id)!)));
        // commonIds ⊆ e1, so every train item has an e1 vector → non-null.
        const behavUser = l2normalize(meanPool(s.train.map((id) => e1.get(id)!)));
        const candidates: RankItem[] = s.candidateIds.map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: [], cohort: cohortById.get(id) ?? null }));
        return { ctx: { userVector: [], cohort: s.cohort }, candidates, relevant: new Set([s.pid]), complements: s.complements, textUser, behavUser };
      });
      const res = aggregateCases(
        cases,
        (c) => hybridScoreFusionRanker({ textUser: c.textUser, behavUser: c.behavUser, textItem: e0, behavItem: e1, popOf: (id) => popById.get(id) ?? 0, kappa: KAPPA }),
        KS,
        "e2_hybrid",
      );
      results.push({ space: "e2_hybrid", res });
      console.log(`[study] e2_hybrid: ${res.n} cases nDCG@10=${res.ndcg[10].toFixed(3)} complR@10=${res.complementRecall[10].toFixed(3)}`);
    } else {
      console.log(`[study] skip e2_hybrid (need E0 and E1)`);
    }

    // ── 6. E4 late interaction (MaxSim over chunks, shared scaffold) ─────────
    if (e4Participates) {
      type E4Case = EvalCase & { queryChunks: number[][] };
      const cases: E4Case[] = scaffold.map((s) => {
        const queryChunks = s.train.flatMap((id) => itemChunks.get(id)!).slice(0, E4_QUERY_CAP);
        const candidates: RankItem[] = s.candidateIds.map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: [], cohort: cohortById.get(id) ?? null }));
        return { ctx: { userVector: [], cohort: s.cohort }, candidates, relevant: new Set([s.pid]), complements: s.complements, queryChunks };
      });
      const res = aggregateCases(cases, (c) => maxSimRanker(itemChunks, () => c.queryChunks), KS, "e4_late");
      results.push({ space: "e4_late", res });
      console.log(`[study] e4_late: ${res.n} cases nDCG@10=${res.ndcg[10].toFixed(3)} complR@10=${res.complementRecall[10].toFixed(3)}`);
    }

    // ── 7. Report ───────────────────────────────────────────────────────────
    const participatingSpaces = results.map((r) => r.space);
    const dimLines = participatingSpaces.map((sp) => `- \`${sp}\`: ${DIM_NOTE[sp] ?? "?"}`).join("\n");
    const header = `| Space | cases | MRR | ${KS.map((k) => `nDCG@${k}`).join(" | ")} | ${KS.map((k) => `Recall@${k}`).join(" | ")} | complR@10 |`;
    const sep = `|${"---|".repeat(3 + KS.length * 2 + 1)}`;
    const lines = [
      "# Thesis F1 — Embedding Study",
      "",
      "## Fair-comparison disclosure",
      "",
      `- Common candidate universe (items representable in EVERY participating space): **${commonIds.size}** items.`,
      `- Eval cases (identical users across all spaces): **${scaffold.length}**.`,
      `- Complement targets are intersected with the candidate universe (and exclude the user's train items).`,
      `- Per-space representation / dimension:`,
      dimLines,
      `- E4 late-interaction query is capped at **${E4_QUERY_CAP}** chunks per user.`,
      "",
      header,
      sep,
    ];
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
    writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify({ commonUniverse: commonIds.size, cases: scaffold.length, results, recommendation: rec }, null, 2));
    console.log(md);
    console.log(`[study] wrote ${out}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
