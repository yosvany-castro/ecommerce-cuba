#!/usr/bin/env tsx
/**
 * F6 W8 — Gift-detector robustness (spec §5 W8 / §8-G).
 *
 * The thesis ships a heuristic, interpretable gift detector (detectGiftIntent):
 * a session is a gift iff it is demographically COHERENT (a clear modal gender
 * shared by ≥ minDemographicCoherence of gender-bearing items) AND CROSS-COHORT
 * (its modal gender or age band differs from the buyer's own). F2-study reported
 * ~0.43 precision at the production thresholds {minItems:2, coherence:0.6}. W8
 * asks the honest question: can we raise the detector's precision/F1 WITHOUT
 * leaking ground truth into ranking?
 *
 * What this script does:
 *   1. Loads the canonical UnifiedCases (E1 64d) for the case set + E1 universe.
 *      The detector is then SCORED on the FAITHFUL session: the test item's own
 *      browsing session (events → sim_sessions join, exactly as f2-study.ts), NOT
 *      the user's whole train history. (Train-as-session — what unified-cases.ts
 *      feeds its embedded `giftSignal` — is DEGENERATE for detection: the session
 *      equals the buyer's history, so its modal gender/age ALWAYS equals the
 *      buyer's own → cross-cohort is structurally impossible and the detector
 *      NEVER fires. We report that fact, then evaluate the detector the way it is
 *      genuinely meant to run.)
 *   2. Uses the GT session intent (sim_sessions.intent, self|gift) ONLY as the
 *      LABEL to SCORE the detector. This is the spec §5-W8 EXCEPTION: evaluating
 *      the detector itself, NOT feeding GT into ranking. The label is NEVER read
 *      by the detector or by any heuristic feature.
 *   3. Sweeps thresholds minItems ∈ {1,2,3} × minDemographicCoherence ∈
 *      {0.4,0.5,0.6,0.7}; reports confusion matrix, precision/recall/F1, FP/FN
 *      vs the GT label for every cell.
 *   4. Proposes + tests ONE heuristic improvement (joint age+gender coherence
 *      weighting — a NON-LEAKY signal derived purely from the session's own
 *      item demographics) and reports whether F1 improves over the production
 *      detector at the same {minItems,coherence} grid.
 *
 * No leakage (spec §7 #6, W8 exception): the GT intent is the LABEL only. The
 * current detector and the proposed heuristic read ONLY per-item demographics
 * (gender_target, age_band) and the buyer's own modal demographic — exactly the
 * features detectGiftIntent already uses. No sim_sessions field is a feature.
 *
 * Determinism (spec §6): pure functions, seeded loader; no Math.random/Date.now
 * in scoring. The only Date.now is the report's generated_at stamp.
 *
 * Item space = e1_prod2vec. Writes NOTHING to the DB.
 *
 * Usage:
 *   pnpm tsx scripts/thesis/f6-gift-robustness.ts [--limit 0] [--out path-no-ext]
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import type { Client } from "pg";
import { getPgClient } from "@/lib/db/pg";
import { loadUnifiedCases } from "@/thesis/eval/unified-cases";
import {
  detectGiftIntent,
  type SessionItem,
  type UserDemographic,
} from "@/thesis/multivector/gift-detect";

// ── Connection-level retry (spec hazard #7: free-tier pooler lag). Retries a
//    query ONCE only on a connection-class failure; real SQL errors re-throw. ──
function isConnectionError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (typeof code === "string") {
    if (code.startsWith("08") || code === "57P01") return true;
    if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EPIPE" || code === "ETIMEDOUT")
      return true;
  }
  const msg = (e as { message?: string } | null)?.message ?? "";
  return /connection terminated|connection reset|server closed the connection|terminating connection|ECONNRESET/i.test(
    msg,
  );
}
async function queryRetry<T>(pg: Client, sql: string, params?: unknown[]): Promise<T[]> {
  try {
    return (await pg.query(sql, params)).rows as T[];
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    return (await pg.query(sql, params)).rows as T[];
  }
}

// ── Sweep grid (spec §5 W8). ────────────────────────────────────────────────
const MIN_ITEMS = [1, 2, 3] as const;
const MIN_COHERENCE = [0.4, 0.5, 0.6, 0.7] as const;
// Production thresholds baked into unified-cases.ts GIFT_OPTS (the reference cell).
const PROD_MIN_ITEMS = 2;
const PROD_MIN_COHERENCE = 0.6;

// ── CLI ─────────────────────────────────────────────────────────────────────
interface Cli {
  limit: number;
  out: string | null;
}
function parseCli(argv: string[]): Cli {
  const cli: Cli = { limit: 0, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`[f6-gift] flag ${a} requires a value`);
      i++;
      return v;
    };
    switch (a) {
      case "--limit":
        cli.limit = parseInt(next(), 10);
        break;
      case "--out":
        cli.out = next();
        break;
      default:
        throw new Error(`[f6-gift] unknown flag: ${a}`);
    }
  }
  if (!Number.isFinite(cli.limit) || cli.limit < 0) throw new Error(`[f6-gift] --limit must be >= 0`);
  return cli;
}

// ── Age band from a product's age_target {min,max}; null if absent. ──────────
// Verbatim from unified-cases.ts ageBandOf — keeps the session demographics the
// detector sees here IDENTICAL to what the loader feeds it in production.
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

// ── One detector-evaluation case: the session the detector sees + the GT label. ─
interface DetectCase {
  session: SessionItem[];
  user: UserDemographic;
  /** GT label (sim_sessions.intent): true iff the session is a real gift. SCORE-ONLY. */
  actualGift: boolean;
}

// ── Confusion matrix + derived rates. ────────────────────────────────────────
interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  /** P(predict gift). Useful to see the production detector's over-firing. */
  positiveRate: number;
}

function confusion(preds: boolean[], labels: boolean[]): Confusion {
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0;
  for (let i = 0; i < preds.length; i++) {
    const p = preds[i];
    const a = labels[i];
    if (p && a) tp++;
    else if (p && !a) fp++;
    else if (!p && a) fn++;
    else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const n = Math.max(1, preds.length);
  return { tp, fp, fn, tn, precision, recall, f1, positiveRate: (tp + fp) / n };
}

// ── Proposed NON-LEAKY heuristic: joint age+gender coherence. ────────────────
//
// Rationale (spec §8-G "ponderar por coherencia de edad+género"): the production
// detector fires on demographic GENDER coherence alone, then declares cross-cohort
// on gender OR age. On a catalog where most items carry a gender_target, an
// incidental gender skew in an otherwise SELF browsing session is enough to fire
// (the ~0.43-precision over-firing). A real gift session is coherent on BOTH the
// recipient's gender AND age band; a self session that merely skews one gender is
// usually age-DIFFUSE. So we require a JOINT coherence: the session must be
// coherent in gender AND coherent in age band, and the cross-cohort test must be
// the SAME gender-or-age rule. This is strictly a stronger AND on the same
// session-internal demographics — no GT, no sim_sessions field, no new data.
//
// Pure & deterministic. Reads only the session's own item demographics + the
// buyer's modal demographic (identical feature surface to detectGiftIntent).
interface JointOpts {
  minItems: number;
  minDemographicCoherence: number;
}
interface JointSignal {
  isGift: boolean;
}
function coherenceOf(values: (string | null)[]): { modal: string | null; coherence: number } {
  const bearing = values.filter((v): v is string => v !== null);
  if (bearing.length === 0) return { modal: null, coherence: 0 };
  const modal = modeOf(values);
  const coherence = bearing.filter((v) => v === modal).length / bearing.length;
  return { modal, coherence };
}
function detectGiftJoint(
  session: SessionItem[],
  user: UserDemographic,
  opts: JointOpts,
): JointSignal {
  if (session.length < opts.minItems) return { isGift: false };

  const g = coherenceOf(session.map((s) => s.gender_target));
  const a = coherenceOf(session.map((s) => s.age_band));

  // JOINT coherence: both gender AND age must clear the bar. (Age band is only
  // required to be coherent when the session actually bears age info; a fully
  // age-null session falls back to gender-only coherence, never inventing data.)
  const genderCoherent = g.modal !== null && g.coherence >= opts.minDemographicCoherence;
  const ageBearing = session.some((s) => s.age_band !== null);
  const ageCoherent = !ageBearing || (a.modal !== null && a.coherence >= opts.minDemographicCoherence);
  const coherent = genderCoherent && ageCoherent;

  const crossGender = g.modal !== user.gender;
  const crossAge = a.modal !== null && user.ageBand !== null && a.modal !== user.ageBand;
  const crossCohort = crossGender || crossAge;

  return { isGift: coherent && crossCohort };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ── Load canonical cases for the case set + E1 universe (deterministic,
    //    holdout intact). We DETECT on the faithful actual session below, but the
    //    loader fixes WHICH (user, test-item) cases exist and gives us each case's
    //    embedded train-as-session giftSignal for the degeneracy diagnostic. ────
    const loaded = await loadUnifiedCases(pg, cli.limit > 0 ? { limit: cli.limit } : undefined);
    const cases = loaded.cases;
    const caseKeys = new Set(cases.map((c) => `${c.userId}|${[...c.relevant][0] ?? ""}`));
    // DEGENERACY DIAGNOSTIC: how often does the loader's embedded train-as-session
    // detector fire? (Expected ~0 — session == buyer history → no cross-cohort.)
    const trainSessionFired = cases.filter((c) => c.giftSignal.isGift).length;

    // ── Per-id demographics (gender_target + age band). Same read shape as the
    //    loader; one round-trip. ────────────────────────────────────────────────
    const demo = new Map<string, { gender: string | null; ageBand: string | null }>();
    {
      const rows = (
        await pg.query<{ id: string; metadata: Record<string, unknown> }>(
          `SELECT id::text id, metadata FROM thesis.products`,
        )
      ).rows;
      for (const r of rows) {
        const m = r.metadata ?? {};
        const at = m.age_target as { min?: number; max?: number } | null | undefined;
        demo.set(r.id, {
          gender: (m.gender_target as string | null) ?? null,
          ageBand: ageBandOf(at),
        });
      }
    }

    // ── FAITHFUL session per (user, test-item): the ACTUAL browsing session the
    //    test product belongs to (events → sim_sessions), exactly as f2-study.ts.
    //    This is the session the detector is genuinely meant to run on — diverse
    //    products that nonetheless target one recipient — where cross-cohort can
    //    actually hold. The session intent is the SCORE-ONLY GT label. ───────────
    const testSession = new Map<string, { sid: string; intent: string }>();
    for (const r of (
      await queryRetry<{ uid: string; pid: string; sid: string; intent: string }>(
        pg,
        `SELECT DISTINCT h.user_id::text uid, h.product_id::text pid, e.session_id::text sid, s.intent
           FROM thesis.holdout h
           JOIN thesis.events e ON e.anonymous_id = h.user_id AND e.payload->>'product_id' = h.product_id::text
           JOIN thesis.sim_sessions s ON s.session_id = e.session_id
          WHERE h.split='test'
          ORDER BY 1, 2, 3`,
      )
    )) {
      const k = `${r.uid}|${r.pid}`;
      if (!testSession.has(k)) testSession.set(k, { sid: r.sid, intent: r.intent });
    }
    // session_id → distinct product_ids (the session's item set).
    const sessionItems = new Map<string, string[]>();
    for (const r of (
      await queryRetry<{ sid: string; pid: string }>(
        pg,
        `SELECT e.session_id::text sid, e.payload->>'product_id' pid
           FROM thesis.events e
          WHERE e.payload->>'product_id' IS NOT NULL
          GROUP BY 1, 2`,
      )
    )) {
      const a = sessionItems.get(r.sid) ?? [];
      a.push(r.pid);
      sessionItems.set(r.sid, a);
    }

    // ── Build one detector-evaluation case per loaded case (faithful session). ──
    // Buyer's own modal demographic = modal gender/age over the TRAIN history
    // (the buyer's persistent taste), identical to f2-study.ts. The detector then
    // tests whether the SESSION is coherent AND cross-cohort vs that buyer.
    const detectCases: DetectCase[] = [];
    let noSession = 0;
    for (const c of cases) {
      const k = `${c.userId}|${[...c.relevant][0] ?? ""}`;
      if (!caseKeys.has(k)) continue;
      const ts = testSession.get(k);
      const sessionPids = (ts ? sessionItems.get(ts.sid) ?? [] : []).filter((id) => demo.has(id));
      if (sessionPids.length === 0) {
        noSession++;
        continue; // no resolvable session → exclude (can't score the detector).
      }
      const session: SessionItem[] = sessionPids.map((id) => ({
        product_id: id,
        gender_target: demo.get(id)?.gender ?? null,
        age_band: demo.get(id)?.ageBand ?? null,
      }));
      const user: UserDemographic = {
        gender: c.buyerGender,
        ageBand: c.buyerAgeBand,
      };
      // SCORE-ONLY label: the actual session's GT intent (fallback to case.intentGT).
      const actualGift = ts ? ts.intent === "gift" : c.intentGT === "gift";
      detectCases.push({ session, user, actualGift });
    }

    const labels = detectCases.map((d) => d.actualGift);
    const nGift = labels.filter(Boolean).length;
    const nSelf = labels.length - nGift;
    console.log(
      `[f6-gift] cases=${detectCases.length} (gift ${nGift}, self ${nSelf}) ` +
        `e1-universe=${loaded.meta.n} train-session-fired=${trainSessionFired}/${cases.length} ` +
        `no-session-excluded=${noSession}`,
    );

    // ── Sweep the production detector across the grid. ──────────────────────────
    interface Cell {
      minItems: number;
      minCoherence: number;
      detector: "production" | "joint";
      conf: Confusion;
    }
    const cells: Cell[] = [];
    for (const minItems of MIN_ITEMS) {
      for (const minCoherence of MIN_COHERENCE) {
        const preds = detectCases.map(
          (d) => detectGiftIntent(d.session, d.user, { minItems, minDemographicCoherence: minCoherence }).isGift,
        );
        cells.push({ minItems, minCoherence, detector: "production", conf: confusion(preds, labels) });
      }
    }
    // ── Sweep the proposed joint heuristic across the SAME grid. ────────────────
    for (const minItems of MIN_ITEMS) {
      for (const minCoherence of MIN_COHERENCE) {
        const preds = detectCases.map(
          (d) => detectGiftJoint(d.session, d.user, { minItems, minDemographicCoherence: minCoherence }).isGift,
        );
        cells.push({ minItems, minCoherence, detector: "joint", conf: confusion(preds, labels) });
      }
    }

    const cellOf = (det: "production" | "joint", mi: number, mc: number): Cell =>
      cells.find((x) => x.detector === det && x.minItems === mi && x.minCoherence === mc)!;

    // ── Reference: production detector at the baked-in {2,0.6} thresholds. ───────
    const prodRef = cellOf("production", PROD_MIN_ITEMS, PROD_MIN_COHERENCE);
    // ── Best F1 cell per detector across the whole grid. ────────────────────────
    const bestOf = (det: "production" | "joint"): Cell =>
      cells
        .filter((x) => x.detector === det)
        .reduce((a, b) => (b.conf.f1 > a.conf.f1 ? b : a));
    const bestProd = bestOf("production");
    const bestJoint = bestOf("joint");
    // ── Honest verdict: does the joint heuristic beat production at the SAME
    //    production thresholds {2,0.6}, AND at each detector's own best cell? ─────
    const jointAtProd = cellOf("joint", PROD_MIN_ITEMS, PROD_MIN_COHERENCE);
    const jointBeatsAtProd = jointAtProd.conf.f1 > prodRef.conf.f1;
    const jointBeatsBest = bestJoint.conf.f1 > bestProd.conf.f1;

    // ── Render markdown. ────────────────────────────────────────────────────────
    const f3 = (x: number) => x.toFixed(3);
    const sgn = (x: number) => (x >= 0 ? "+" : "");
    const md = renderMarkdown({
      nCases: detectCases.length,
      nGift,
      nSelf,
      eUniverse: loaded.meta.n,
      trainSessionFired,
      nLoaded: cases.length,
      noSession,
      cells,
      cellOf,
      prodRef,
      bestProd,
      bestJoint,
      jointAtProd,
      jointBeatsAtProd,
      jointBeatsBest,
      f3,
      sgn,
    });

    // ── Render JSON sidecar. ────────────────────────────────────────────────────
    const json = {
      generated_at: new Date().toISOString(),
      workstream: "W8-gift-robustness",
      item_space: loaded.meta.space,
      e1_universe: loaded.meta.n,
      eval_cases: detectCases.length,
      n_gift: nGift,
      n_self: nSelf,
      session_source: "test item's actual browsing session (events→sim_sessions), as f2-study.ts",
      train_as_session_degeneracy: {
        loader_cases: cases.length,
        train_session_detector_fired: trainSessionFired,
        note:
          "unified-cases.ts feeds the detector the TRAIN history as the session, so the " +
          "session's modal demographic equals the buyer's own → cross-cohort impossible → " +
          "the embedded giftSignal never fires. W8 scores the detector on the FAITHFUL " +
          "actual session instead.",
        no_session_excluded: noSession,
      },
      grid: { min_items: MIN_ITEMS, min_coherence: MIN_COHERENCE },
      production_thresholds: { min_items: PROD_MIN_ITEMS, min_coherence: PROD_MIN_COHERENCE },
      label_source: "sim_sessions.intent (SCORE-ONLY; never a detector feature)",
      cells: cells.map((c) => ({
        detector: c.detector,
        min_items: c.minItems,
        min_coherence: c.minCoherence,
        tp: c.conf.tp,
        fp: c.conf.fp,
        fn: c.conf.fn,
        tn: c.conf.tn,
        precision: c.conf.precision,
        recall: c.conf.recall,
        f1: c.conf.f1,
        positive_rate: c.conf.positiveRate,
      })),
      heuristic_improvement: {
        name: "joint age+gender coherence (non-leaky)",
        description:
          "Require BOTH gender coherence AND age-band coherence (when age info present) " +
          "before firing; cross-cohort rule unchanged (gender OR age). Reads only " +
          "session-internal item demographics + buyer modal demographic — no GT.",
        production_ref: { ...prodRef.conf, min_items: prodRef.minItems, min_coherence: prodRef.minCoherence },
        joint_at_production_thresholds: {
          ...jointAtProd.conf,
          min_items: jointAtProd.minItems,
          min_coherence: jointAtProd.minCoherence,
        },
        f1_delta_at_production_thresholds: jointAtProd.conf.f1 - prodRef.conf.f1,
        beats_production_at_production_thresholds: jointBeatsAtProd,
        best_production_cell: { ...bestProd.conf, min_items: bestProd.minItems, min_coherence: bestProd.minCoherence },
        best_joint_cell: { ...bestJoint.conf, min_items: bestJoint.minItems, min_coherence: bestJoint.minCoherence },
        f1_delta_best_vs_best: bestJoint.conf.f1 - bestProd.conf.f1,
        beats_production_at_best_cell: jointBeatsBest,
      },
    };

    // ── Write (md + json sidecar, house style). ─────────────────────────────────
    const base =
      cli.out ??
      resolve(process.cwd(), "docs/superpowers/reports/2026-06-08-thesis-f6-gift-robustness-n2000-seed42");
    const outMd = base.endsWith(".md") ? base : `${base}.md`;
    const outJson = base.endsWith(".md") ? base.replace(/\.md$/, ".json") : `${base}.json`;
    writeFileSync(outMd, md);
    writeFileSync(outJson, JSON.stringify(json, null, 2) + "\n");

    console.log(md);
    console.log(`[f6-gift] wrote ${outMd}`);
    console.log(`[f6-gift] wrote ${outJson}`);
  } finally {
    await pg.end();
  }
}

// ── Markdown renderer (pure). ───────────────────────────────────────────────
interface Cell {
  minItems: number;
  minCoherence: number;
  detector: "production" | "joint";
  conf: Confusion;
}
function renderMarkdown(o: {
  nCases: number;
  nGift: number;
  nSelf: number;
  eUniverse: number;
  trainSessionFired: number;
  nLoaded: number;
  noSession: number;
  cells: Cell[];
  cellOf: (det: "production" | "joint", mi: number, mc: number) => Cell;
  prodRef: Cell;
  bestProd: Cell;
  bestJoint: Cell;
  jointAtProd: Cell;
  jointBeatsAtProd: boolean;
  jointBeatsBest: boolean;
  f3: (x: number) => string;
  sgn: (x: number) => string;
}): string {
  const { f3, sgn } = o;
  const rows: string[] = [];

  rows.push("# Thesis F6 W8 — Gift-detector robustness", "");
  rows.push(
    `Item space: e1_prod2vec (canonical 64d). E1 universe: ${o.eUniverse}. ` +
      `Eval cases: ${o.nCases} (gift ${o.nGift}, self ${o.nSelf}). ` +
      `Label = sim_sessions.intent (SCORE-ONLY — never a detector feature; W8 exception).`,
    "",
  );
  rows.push(
    "The detector is scored on the FAITHFUL session: each test item's ACTUAL " +
      "browsing session (events → sim_sessions, as `f2-study.ts`). The buyer's own " +
      "modal gender/age comes from their TRAIN history; cross-cohort = the session's " +
      "modal gender OR age band differs from that buyer demographic. The production " +
      `detector (unified-cases GIFT_OPTS) lives at minItems=${o.prodRef.minItems}, ` +
      `coherence=${o.prodRef.minCoherence}.`,
    "",
  );

  // ── Degeneracy diagnostic. ─────────────────────────────────────────────────
  rows.push("## Why not score on the train history? (degeneracy diagnostic)", "");
  rows.push(
    "`unified-cases.ts` feeds the detector each user's TRAIN items as the session, " +
      "so the session's modal demographic ALWAYS equals the buyer's own modal " +
      "demographic → cross-cohort is structurally impossible and the embedded " +
      `\`giftSignal\` fires on **${o.trainSessionFired}/${o.nLoaded}** loaded cases. ` +
      "W8 therefore scores the detector on the actual session — the way the F2 " +
      `pipeline genuinely runs it (${o.noSession} loaded cases had no resolvable ` +
      "session and were excluded).",
    "",
  );

  // ── Production-detector sweep. ─────────────────────────────────────────────
  rows.push("## Production detector — threshold sweep (confusion matrix + P/R/F1)", "");
  rows.push(
    "| minItems | coherence | TP | FP | FN | TN | Precision | Recall | F1 | P(predict gift) |",
    "|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const mi of MIN_ITEMS) {
    for (const mc of MIN_COHERENCE) {
      const c = o.cellOf("production", mi, mc);
      const star = mi === o.prodRef.minItems && mc === o.prodRef.minCoherence ? " ⟵ prod" : "";
      rows.push(
        `| ${mi}${star} | ${mc} | ${c.conf.tp} | ${c.conf.fp} | ${c.conf.fn} | ${c.conf.tn} | ` +
          `${f3(c.conf.precision)} | ${f3(c.conf.recall)} | ${f3(c.conf.f1)} | ${f3(c.conf.positiveRate)} |`,
      );
    }
  }
  rows.push("");
  rows.push(
    `Production cell {${o.prodRef.minItems},${o.prodRef.minCoherence}}: precision ` +
      `${f3(o.prodRef.conf.precision)}, recall ${f3(o.prodRef.conf.recall)}, F1 ` +
      `${f3(o.prodRef.conf.f1)} (FP=${o.prodRef.conf.fp}, FN=${o.prodRef.conf.fn}). ` +
      `Best-F1 production cell: {${o.bestProd.minItems},${o.bestProd.minCoherence}} → F1 ` +
      `${f3(o.bestProd.conf.f1)} (precision ${f3(o.bestProd.conf.precision)}, recall ` +
      `${f3(o.bestProd.conf.recall)}).`,
    "",
  );

  // ── Proposed heuristic sweep. ──────────────────────────────────────────────
  rows.push("## Proposed heuristic — joint age+gender coherence (NON-LEAKY)", "");
  rows.push(
    "Improvement: require BOTH gender coherence AND age-band coherence (when the " +
      "session bears age info) before firing; the cross-cohort rule is unchanged " +
      "(gender OR age vs the buyer). This reads ONLY the session's own item " +
      "demographics + the buyer's modal demographic — the same feature surface as " +
      "the production detector. `sim_sessions.intent` is NOT a feature (no leakage).",
    "",
  );
  rows.push(
    "| minItems | coherence | TP | FP | FN | TN | Precision | Recall | F1 | P(predict gift) |",
    "|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const mi of MIN_ITEMS) {
    for (const mc of MIN_COHERENCE) {
      const c = o.cellOf("joint", mi, mc);
      rows.push(
        `| ${mi} | ${mc} | ${c.conf.tp} | ${c.conf.fp} | ${c.conf.fn} | ${c.conf.tn} | ` +
          `${f3(c.conf.precision)} | ${f3(c.conf.recall)} | ${f3(c.conf.f1)} | ${f3(c.conf.positiveRate)} |`,
      );
    }
  }
  rows.push("");

  // ── Head-to-head verdict. ──────────────────────────────────────────────────
  rows.push("## Verdict — does the non-leaky heuristic raise F1?", "");
  const dAtProd = o.jointAtProd.conf.f1 - o.prodRef.conf.f1;
  rows.push(
    `**At the production thresholds {${o.prodRef.minItems},${o.prodRef.minCoherence}}:** joint F1 ` +
      `${f3(o.jointAtProd.conf.f1)} vs production F1 ${f3(o.prodRef.conf.f1)} — ` +
      `${sgn(dAtProd)}${(dAtProd).toFixed(3)} F1 ` +
      `(${o.jointBeatsAtProd ? "IMPROVES" : "does NOT improve"}). ` +
      `Precision ${f3(o.jointAtProd.conf.precision)} vs ${f3(o.prodRef.conf.precision)}; recall ` +
      `${f3(o.jointAtProd.conf.recall)} vs ${f3(o.prodRef.conf.recall)}; ` +
      `FP ${o.jointAtProd.conf.fp} vs ${o.prodRef.conf.fp}.`,
    "",
  );
  const dBest = o.bestJoint.conf.f1 - o.bestProd.conf.f1;
  rows.push(
    `**Best cell vs best cell:** joint best-F1 ${f3(o.bestJoint.conf.f1)} at ` +
      `{${o.bestJoint.minItems},${o.bestJoint.minCoherence}} vs production best-F1 ` +
      `${f3(o.bestProd.conf.f1)} at {${o.bestProd.minItems},${o.bestProd.minCoherence}} — ` +
      `${sgn(dBest)}${dBest.toFixed(3)} F1 (${o.jointBeatsBest ? "IMPROVES" : "does NOT improve"}).`,
    "",
  );
  rows.push(
    o.jointBeatsAtProd || o.jointBeatsBest
      ? "**Read:** the joint age+gender coherence heuristic raises detector F1 without " +
          "any leakage — tightening the coherence requirement trims false-positive " +
          "self-sessions that merely skew one gender, at the cost of some recall on " +
          "age-diffuse gift sessions. Reported as a candidate detector upgrade."
      : "**Read (honest, negative):** the joint heuristic does NOT raise F1 over the " +
          "production detector on this dataset — the extra age-coherence requirement " +
          "removes true-positive gift sessions (age-diffuse but genuinely cross-gender) " +
          "faster than it removes false positives. The simpler gender-only detector " +
          "stands; reported with the same weight as a positive result (F6 honesty mandate).",
    "",
  );

  return rows.join("\n") + "\n";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
