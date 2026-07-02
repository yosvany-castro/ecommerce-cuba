import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { getPgClient } from "@/lib/db/pg";
import { loadUnifiedCases, type UnifiedCase } from "@/thesis/eval/unified-cases";
import {
  assembledRankerFor,
  trainAssembledLtr,
  type FeatureMetaById,
  type FeatureMeta,
  type AssembledConfig,
  F4_KNEE_WEIGHTS,
} from "@/thesis/eval/assembled";
import type { Client } from "pg";

/**
 * F6 W1 — REAL targeted tests for the assembled F1→F2→F3→F4 ranker.
 *
 * Runs against the INTACT n=2000 / seed-42 dataset (read-only). NO mocks. The
 * core contract: `assembledRankerFor(...).rank(ctx, candidates)` returns a FULL
 * PERMUTATION of the candidate ids — same length, all unique, set-equal to the
 * input ids (no drops, no dupes) — and never throws a cosineSim dimension error
 * (every stage operates in E1 64d). Tested for both rerank modes ('rrf', 'ltr')
 * with and without F4 weights.
 *
 * SAFE in isolation (read-only). Do NOT run the whole tests/thesis dir.
 */
describe("F6 assembled ranker emits a full permutation (real DB, n=2000)", () => {
  let pg: Client;
  let cases: UnifiedCase[];
  let metaById: FeatureMetaById;
  // Shared LTR model + per-case pool feature maps (train-split-only, seed 42).
  let model: ReturnType<typeof trainAssembledLtr>["model"];
  let featuresByCaseKey: Map<string, Map<string, number[]>>;
  const caseKeyOf = (c: UnifiedCase) => `${c.userId}|${[...c.relevant][0] ?? ""}`;

  beforeAll(async () => {
    pg = await getPgClient({ scope: "thesis" });
    // SMALL slice (first 30 cases) for speed, but real loaded data.
    const loaded = await loadUnifiedCases(pg, { limit: 30 });
    cases = loaded.cases;
    expect(cases.length).toBeGreaterThan(0);

    // Build the per-id FeatureMeta over the E1 universe, identical to the runner
    // (scripts/thesis/f6-headtohead.ts): age band from age_target midpoint.
    const e1Item = loaded.e1Item;
    metaById = new Map<string, FeatureMeta>();
    for (const r of (
      await pg.query<{ id: string; metadata: Record<string, unknown> }>(
        `SELECT id::text id, metadata FROM thesis.products`,
      )
    ).rows) {
      const m = r.metadata ?? {};
      const at = m.age_target as { min?: number; max?: number } | null | undefined;
      const vec = e1Item.get(r.id);
      if (vec === undefined) continue;
      metaById.set(r.id, {
        vector: vec,
        priceBand: typeof m.price_band === "number" ? m.price_band : 0,
        gender_target: (m.gender_target as string | null) ?? null,
        ageBand: ageBandOfRange(at),
      });
    }
    expect(metaById.size).toBeGreaterThan(0);

    // Train the shared LTR (train-split-only) for the 'ltr' rerank variants.
    const trained = trainAssembledLtr(cases, metaById);
    model = trained.model;
    featuresByCaseKey = trained.featuresByCaseKey;
  }, 180_000);

  afterAll(async () => {
    if (pg) await pg.end();
  });

  /** Assert `ranked` is a permutation of `candidates`' ids: same length, unique,
   *  set-equal. This is the load-bearing assembled-ranker contract. */
  function assertPermutation(ranked: string[], candidateIds: string[]): void {
    expect(ranked.length).toBe(candidateIds.length);
    const rankedSet = new Set(ranked);
    expect(rankedSet.size).toBe(ranked.length); // all unique (no dupes)
    const candSet = new Set(candidateIds);
    expect(rankedSet.size).toBe(candSet.size);
    for (const id of ranked) expect(candSet.has(id)).toBe(true); // no foreign ids
    for (const id of candidateIds) expect(rankedSet.has(id)).toBe(true); // no drops
  }

  // The four config combinations: rerank ∈ {rrf, ltr} × F4 ∈ {none, knee}.
  const configs: { label: string; cfg: AssembledConfig; needsLtr: boolean }[] = [
    { label: "rrf, no F4", cfg: { rerank: "rrf", f4Weights: null }, needsLtr: false },
    { label: "rrf + F4 knee", cfg: { rerank: "rrf", f4Weights: F4_KNEE_WEIGHTS }, needsLtr: false },
    { label: "ltr, no F4", cfg: { rerank: "ltr", f4Weights: null }, needsLtr: true },
    { label: "ltr + F4 knee", cfg: { rerank: "ltr", f4Weights: F4_KNEE_WEIGHTS }, needsLtr: true },
  ];

  for (const { label, cfg } of configs) {
    test(`FULL frame (${label}) → permutation over catalog\\train, no dim error`, () => {
      for (const c of cases) {
        const feats = featuresByCaseKey.get(caseKeyOf(c));
        const ranker = cfg.rerank === "ltr"
          ? assembledRankerFor(c, cfg, model, feats)
          : assembledRankerFor(c, cfg);
        // rank() throws on cosineSim dim mismatch — reaching the asserts means no throw.
        const ranked = ranker.rank(c.ctx, c.candidates);
        assertPermutation(ranked, c.candidates.map((x) => x.id));
      }
    });

    test(`POOL frame (${label}) → permutation over the 200-pool, no dim error`, () => {
      for (const c of cases) {
        // Pool frame: candidates restricted to the case's pool (runner semantics).
        const candById = new Map(c.candidates.map((x) => [x.id, x] as const));
        const poolCands = c.pool
          .map((p) => candById.get(p.id))
          .filter((x): x is NonNullable<typeof x> => x !== undefined);
        expect(poolCands.length).toBe(c.pool.length);
        const poolCase: UnifiedCase = { ...c, candidates: poolCands };

        const feats = featuresByCaseKey.get(caseKeyOf(c));
        const ranker = cfg.rerank === "ltr"
          ? assembledRankerFor(poolCase, cfg, model, feats)
          : assembledRankerFor(poolCase, cfg);
        const ranked = ranker.rank(poolCase.ctx, poolCase.candidates);
        assertPermutation(ranked, poolCase.candidates.map((x) => x.id));
      }
    });
  }

  test("LTR and RRF produce DIFFERENT orderings for at least one case (model is live)", () => {
    // Guards against a degenerate model that collapses to the RRF order — a real
    // regression signal, not a tautology. At least one case must reorder.
    let anyDiff = false;
    for (const c of cases) {
      const feats = featuresByCaseKey.get(caseKeyOf(c));
      const rrf = assembledRankerFor(c, { rerank: "rrf", f4Weights: null }).rank(c.ctx, c.candidates);
      const ltr = assembledRankerFor(c, { rerank: "ltr", f4Weights: null }, model, feats).rank(
        c.ctx,
        c.candidates,
      );
      // Compare only the pooled prefix (the tail is identical popular-cohort order).
      const poolN = c.pool.length;
      if (rrf.slice(0, poolN).join(",") !== ltr.slice(0, poolN).join(",")) {
        anyDiff = true;
        break;
      }
    }
    expect(anyDiff).toBe(true);
  });
});

/** Item age band from age_target midpoint — matches unified-cases.ageBandOf and
 *  the runner's ageBandOfRange (kept local; the source helpers are not exported). */
function ageBandOfRange(at: { min?: number; max?: number } | null | undefined): string | null {
  if (!at || typeof at.min !== "number" || typeof at.max !== "number") return null;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe";
  if (mid <= 11) return "nino";
  if (mid <= 25) return "joven";
  if (mid <= 59) return "adulto";
  return "mayor";
}
