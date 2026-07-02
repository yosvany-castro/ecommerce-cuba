#!/usr/bin/env tsx
/**
 * F2 study: F1 single-vector baseline vs F2 multi-vector + gift model on the
 * thesis holdout, SEGMENTED by session intent (self/gift) and user multimodality,
 * plus recipient-fit@k on gift sessions. Item space = e1_prod2vec.
 * Usage: pnpm thesis:f2-study
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { l2normalize, meanPool } from "@/thesis/embedders/space";
import { cosineSingleVectorRanker } from "@/thesis/eval/baselines";
import { evaluateRanker, type EvalCase } from "@/thesis/eval/harness";
import { aggregateCases } from "@/thesis/eval/aggregate";
import { buildUserModes, type UserMode } from "@/thesis/multivector/modes";
import { detectGiftIntent, type SessionItem, type UserDemographic } from "@/thesis/multivector/gift-detect";
import { buildRecipientVector } from "@/thesis/multivector/gift-vector";
import { multiModeRank } from "@/thesis/multivector/retrieve";
import { recipientFitAtK, type ItemDemographics, type RecipientProfile } from "@/thesis/eval/metrics";
import type { RankItem, Ranker, UserContext } from "@/thesis/types";

const KS = [5, 10, 20];

function ageBandOf(at: { min?: number; max?: number } | null | undefined): string | null {
  if (!at || typeof at.min !== "number" || typeof at.max !== "number") return null;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe";
  if (mid <= 11) return "nino";
  if (mid <= 25) return "joven";
  if (mid <= 59) return "adulto";
  return "mayor";
}

/** Most frequent non-null value; deterministic alphabetical tie-break. Null if none. */
function modeOf(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // E1 vectors
    const e1 = new Map<string, number[]>();
    const e1r = await pg.query(`SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space='e1_prod2vec'`);
    for (const r of e1r.rows as { id: string; vector: number[] }[]) e1.set(r.id, r.vector.map(Number));
    if (e1.size === 0) {
      console.error("[f2] no e1_prod2vec vectors — run pnpm thesis:train-prod2vec");
      process.exit(1);
    }

    // catalog demographics + cohort
    const demo = new Map<string, ItemDemographics & { ageBand: string | null }>();
    const cohortById = new Map<string, string | null>();
    const mr = await pg.query(`SELECT id::text id, metadata FROM thesis.products`);
    for (const r of mr.rows as { id: string; metadata: Record<string, unknown> }[]) {
      const m = r.metadata ?? {};
      const at = m.age_target as { min?: number; max?: number } | null | undefined;
      demo.set(r.id, {
        gender_target: (m.gender_target as string | null) ?? null,
        age_min: at?.min ?? 0,
        age_max: at?.max ?? 130,
        ageBand: ageBandOf(at),
      });
      cohortById.set(r.id, (m.subcategory as string | null) ?? null);
    }
    const popById = new Map<string, number>();
    for (const r of (await pg.query(`SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`)).rows as { pid: string; c: number }[]) popById.set(r.pid, r.c);

    // holdout train/test
    const trainByUser = new Map<string, string[]>();
    for (const r of (await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`)).rows as { uid: string; pid: string }[]) {
      const a = trainByUser.get(r.uid) ?? [];
      a.push(r.pid);
      trainByUser.set(r.uid, a);
    }
    const tests = (await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test'`)).rows as { uid: string; pid: string }[];

    // Map each test (user, holdout product) to the session that exact product belongs to,
    // then load THAT session's product items. The detector runs on the actual session,
    // not the user's whole mixed train history.
    // `${uid}|${pid}` -> the actual session (id + GT intent + recipient) the test item belongs to.
    const testSession = new Map<string, { sid: string; intent: string; rid: string | null }>();
    for (const r of (await pg.query(`
      SELECT DISTINCT h.user_id::text uid, h.product_id::text pid, e.session_id::text sid,
             s.intent, s.recipient_id::text rid
      FROM thesis.holdout h
      JOIN thesis.events e ON e.anonymous_id = h.user_id AND e.payload->>'product_id' = h.product_id::text
      JOIN thesis.sim_sessions s ON s.session_id = e.session_id
      WHERE h.split='test'`)).rows as { uid: string; pid: string; sid: string; intent: string; rid: string | null }[]) {
      const k = `${r.uid}|${r.pid}`;
      if (!testSession.has(k)) testSession.set(k, { sid: r.sid, intent: r.intent, rid: r.rid }); // first session containing the exact product
    }
    const sessionItems = new Map<string, string[]>(); // session_id -> distinct product_ids
    for (const r of (await pg.query(`
      SELECT e.session_id::text sid, e.payload->>'product_id' pid
      FROM thesis.events e
      WHERE e.payload->>'product_id' IS NOT NULL
      GROUP BY 1, 2`)).rows as { sid: string; pid: string }[]) {
      const a = sessionItems.get(r.sid) ?? [];
      a.push(r.pid);
      sessionItems.set(r.sid, a);
    }

    // each user's most-recent session intent + recipient (GT, for segments + recipient-fit ONLY, never a ranker feature)
    const lastSession = new Map<string, { intent: string; rid: string | null }>();
    for (const r of (await pg.query(`SELECT user_id::text uid, intent, recipient_id::text rid FROM thesis.sim_sessions ORDER BY user_id, started_at DESC`)).rows as { uid: string; intent: string; rid: string | null }[]) {
      if (!lastSession.has(r.uid)) lastSession.set(r.uid, { intent: r.intent, rid: r.rid });
    }
    const recById = new Map<string, RecipientProfile>();
    for (const r of (await pg.query(`SELECT id::text id, gender, age_min, age_max FROM thesis.sim_user_recipients`)).rows as { id: string; gender: string; age_min: number; age_max: number }[]) recById.set(r.id, { gender: r.gender, age_min: r.age_min, age_max: r.age_max });

    // common universe = items with an E1 vector (sorted, identical candidates for both models)
    const commonIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
    const commonSet = new Set(commonIds);

    interface F2Case extends EvalCase {
      uid: string;
      intent: string;
      nModes: number;
      recipient: RecipientProfile | null;
      f2Modes: UserMode[];
      predGift: boolean;
    }
    const baselineCases: F2Case[] = [];
    const f2Cases: F2Case[] = [];

    for (const t of tests) {
      const train = (trainByUser.get(t.uid) ?? []).filter((id) => commonSet.has(id));
      if (train.length === 0 || !commonSet.has(t.pid)) continue;
      const trainSet = new Set(train);
      const candidateIds = commonIds.filter((id) => !trainSet.has(id));
      const candidates: RankItem[] = candidateIds.map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: e1.get(id)!, cohort: cohortById.get(id) ?? null }));
      const relevant = new Set([t.pid]);
      const history = train.map((id) => e1.get(id)!);
      const modes = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });

      // The actual session this test item belongs to (its product items + demographics).
      const ts = testSession.get(`${t.uid}|${t.pid}`);
      const sessionProductIds = (ts ? sessionItems.get(ts.sid) ?? [] : []).filter((id) => commonSet.has(id));
      const session: SessionItem[] = sessionProductIds.map((id) => ({
        product_id: id,
        gender_target: demo.get(id)?.gender_target ?? null,
        age_band: demo.get(id)?.ageBand ?? null,
      }));
      // Buyer's own dominant demographic = modal gender + age band across their TRAIN history.
      const userDemographic: UserDemographic = {
        gender: modeOf(train.map((id) => demo.get(id)?.gender_target ?? null)),
        ageBand: modeOf(train.map((id) => demo.get(id)?.ageBand ?? null)),
      };
      const gift = detectGiftIntent(session, userDemographic, { minItems: 2, minDemographicCoherence: 0.6 });

      // GT intent + recipient from the test item's ACTUAL session (the one the detector
      // ran on), falling back to the user's last session if the item maps to none.
      const sess = ts ?? lastSession.get(t.uid);
      const recipient = sess?.rid ? (recById.get(sess.rid) ?? null) : null;
      const intent = sess?.intent ?? "self";
      const ctx: UserContext = { userVector: l2normalize(meanPool(history)), cohort: cohortById.get(t.pid) ?? null };
      // Gift → ephemeral recipient vector built from the SESSION items' e1 vectors (never persisted).
      const sessionVectors = sessionProductIds.map((id) => e1.get(id)!);
      const f2Modes: UserMode[] = gift.isGift ? [{ medoid: buildRecipientVector(sessionVectors), weight: 1, size: sessionVectors.length }] : modes;

      const base: F2Case = { ctx, candidates, relevant, uid: t.uid, intent, nModes: modes.length, recipient, f2Modes, predGift: gift.isGift };
      baselineCases.push(base);
      f2Cases.push(base);
    }

    const baselineRanker = cosineSingleVectorRanker();
    const f2RankerFor = (c: F2Case): Ranker => ({ name: "f2-multivector", rank: (_ctx: UserContext, cands: RankItem[]) => multiModeRank({ modes: c.f2Modes, candidates: cands, perModeK: 20 }) });
    const segOf = (c: F2Case) => `${c.intent}|${c.nModes <= 1 ? "1mode" : c.nModes <= 3 ? "2-3modes" : "4+modes"}`;
    const segments = [...new Set(f2Cases.map(segOf))].sort();

    const rows: string[] = [];
    rows.push("# Thesis F2 — Multi-vector × recipient + gift study", "");
    rows.push(`Item space: e1_prod2vec. Common universe: ${commonIds.length}. Test cases: ${f2Cases.length}.`, "");
    rows.push("Modes: average-linkage cosine clustering + medoids (PinnerSage-style), order-invariant. Retrieval: per-mode quota + RRF; gift sessions use a single ephemeral recipient vector.", "");
    rows.push("Gift detection: demographic coherence + cross-cohort (gender/age) on the test item's actual session.", "");
    rows.push("| Segment | n | model | nDCG@10 | Recall@10 | MRR |", "|---|---|---|---|---|---|");
    const evalSeg = (label: string, bs: F2Case[], fs: F2Case[]) => {
      if (fs.length === 0) return;
      const b = evaluateRanker(baselineRanker, bs, KS);
      const f = aggregateCases(fs, f2RankerFor, KS, "f2-multivector");
      rows.push(`| ${label} | ${b.n} | F1-single | ${b.ndcg[10].toFixed(3)} | ${b.recall[10].toFixed(3)} | ${b.mrr.toFixed(3)} |`);
      rows.push(`| ${label} | ${f.n} | F2-multivec | ${f.ndcg[10].toFixed(3)} | ${f.recall[10].toFixed(3)} | ${f.mrr.toFixed(3)} |`);
    };
    evalSeg("overall", baselineCases, f2Cases);
    for (const seg of segments) evalSeg(seg, baselineCases.filter((c) => segOf(c) === seg), f2Cases.filter((c) => segOf(c) === seg));

    // gift-detection diagnostic vs ground truth (sim_sessions.intent). The detector
    // fired iff predGift; ground-truth gift iff the test item's ACTUAL session intent == 'gift'
    // (the same session the detector ran on), for a faithful precision/recall.
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const c of f2Cases) {
      const actualGift = c.intent === "gift";
      if (c.predGift && actualGift) tp++;
      else if (c.predGift && !actualGift) fp++;
      else if (!c.predGift && actualGift) fn++;
      else tn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    rows.push("", `## Gift detection vs ground truth (n=${f2Cases.length})`, "");
    rows.push(`- Confusion: TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);
    rows.push(`- Precision: ${precision.toFixed(3)}`, `- Recall: ${recall.toFixed(3)}`, `- F1: ${f1.toFixed(3)}`);

    // recipient-fit@10 on gift cases (GT intent == 'gift' with a known recipient)
    const demoRecord: Record<string, ItemDemographics> = {};
    for (const [id, d] of demo) demoRecord[id] = { gender_target: d.gender_target, age_min: d.age_min, age_max: d.age_max };
    const giftCases = f2Cases.filter((c) => c.intent === "gift" && c.recipient);
    let fitB = 0, fitF = 0;
    for (const c of giftCases) {
      const bRanked = baselineRanker.rank(c.ctx, c.candidates);
      const fRanked = multiModeRank({ modes: c.f2Modes, candidates: c.candidates, perModeK: 20 });
      fitB += recipientFitAtK(bRanked, c.recipient!, demoRecord, 10);
      fitF += recipientFitAtK(fRanked, c.recipient!, demoRecord, 10);
    }
    const ng = Math.max(1, giftCases.length);
    rows.push("", `## Recipient-fit@10 (gift sessions, n=${giftCases.length})`, "");
    rows.push(`- F1-single: ${(fitB / ng).toFixed(3)}`, `- F2-multivec: ${(fitF / ng).toFixed(3)}`);

    const md = rows.join("\n") + "\n";
    const out = resolve(process.cwd(), "docs/superpowers/reports/2026-05-29-thesis-f2-study.md");
    writeFileSync(out, md);
    console.log(md);
    console.log(`[f2] wrote ${out}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
