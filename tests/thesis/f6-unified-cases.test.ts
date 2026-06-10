import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { getPgClient } from "@/lib/db/pg";
import { loadUnifiedCases, type UnifiedCasesResult } from "@/thesis/eval/unified-cases";
import type { Client } from "pg";

/**
 * F6 W1 — REAL targeted tests for the canonical unified-cases loader.
 *
 * Runs against WHATEVER thesis dataset the shared DB currently holds (it is a
 * shared free-tier instance — at the time of writing the v2 dataset, n=5000 /
 * eta=0.7 / seed 123; cf. auditoría destructiva 2026-06-09). Therefore NO
 * hardcoded dataset sizes: every assertion is an INTERNAL-CONSISTENCY check of
 * the loader's output against live DB counts (meta.n == |e1Item| == count of
 * item_vectors in the canonical space, relevant ⊆ universe, candidates ==
 * universe \ train, pool ⊆ candidates, ...). NO mocks: real Postgres
 * (getPgClient scope=thesis) + already-stored E1 vectors. Strong assertions
 * only (no toBeDefined / not.toBeNull). Read-only — never truncates or
 * regenerates. Determinism (spec §6) is asserted by a second load.
 *
 * Case cap: a FULL load on the v2 dataset would materialize ~2.3k cases, each
 * with a full ~5k-item candidate frame (~10M RankItems) — out of memory budget
 * for a unit test. CASE_LIMIT bounds that; the loader's ORDER BY (user_id,
 * product_id) makes the prefix deterministic, so per-case invariants checked
 * on the prefix hold with the same force.
 *
 * SAFE to run in isolation (this file ONLY reads). Do NOT run the whole
 * tests/thesis dir — harness-discrimination.test.ts TRUNCATEs thesis.products.
 */
const CASE_LIMIT = 200;

describe("F6 unified-cases loader (real DB, dataset-agnostic consistency)", () => {
  let pg: Client;
  let loaded: UnifiedCasesResult;
  /** Live count of E1 vectors in the canonical space (the loader's universe source). */
  let dbE1Count: number;
  /** Live count of thesis.products (superset of the E1 universe). */
  let dbProductCount: number;

  beforeAll(async () => {
    pg = await getPgClient({ scope: "thesis" });
    // One bounded load shared across the structural tests below (see CASE_LIMIT
    // note above). The universe maps (e1Item/textItem) are ALWAYS full-catalog
    // regardless of the case limit, so universe-level checks stay exact.
    loaded = await loadUnifiedCases(pg, { limit: CASE_LIMIT });
    dbE1Count = parseInt(
      (
        await pg.query<{ c: string }>(
          `SELECT count(*)::text c FROM thesis.item_vectors WHERE space = 'e1_prod2vec'`,
        )
      ).rows[0]!.c,
      10,
    );
    dbProductCount = parseInt(
      (await pg.query<{ c: string }>(`SELECT count(*)::text c FROM thesis.products`)).rows[0]!.c,
      10,
    );
  }, 180_000);

  afterAll(async () => {
    if (pg) await pg.end();
  });

  test("universe and meta are internally consistent with the live DB", () => {
    expect(loaded.cases.length).toBeGreaterThan(0);
    expect(loaded.cases.length).toBeLessThanOrEqual(CASE_LIMIT);
    // meta.n = the E1 (prod2vec, 64d) universe = catalog representable in E1.
    // It must equal BOTH the loaded vector map and the live item_vectors count.
    expect(loaded.meta.n).toBeGreaterThan(0);
    expect(loaded.meta.n).toBe(loaded.e1Item.size);
    expect(loaded.e1Item.size).toBe(dbE1Count);
    // The E1 universe is a subset of the catalog (some products lack a vector).
    expect(dbProductCount).toBeGreaterThan(0);
    expect(loaded.e1Item.size).toBeLessThanOrEqual(dbProductCount);

    expect(loaded.meta.nCases).toBe(loaded.cases.length);
    expect(loaded.meta.space).toBe("e1_prod2vec");
    expect(loaded.meta.poolSize).toBe(200);
    // The E1 universe map is the canonical 64d space; every vector must be 64d.
    for (const v of loaded.e1Item.values()) {
      expect(v.length).toBe(64);
      break; // dim is uniform; one check + the cosineSim invariant guards the rest.
    }
  });

  test("every case's relevant + train ids live inside the E1 universe", () => {
    let relevantOutsideUniverse = 0;
    let trainOutsideUniverse = 0;
    for (const c of loaded.cases) {
      for (const id of c.relevant) if (!loaded.e1Item.has(id)) relevantOutsideUniverse++;
      for (const id of c.trainIds) if (!loaded.e1Item.has(id)) trainOutsideUniverse++;
    }
    expect(relevantOutsideUniverse).toBe(0);
    expect(trainOutsideUniverse).toBe(0);
  });

  test("every case excludes the user's train items from its candidates", () => {
    // Aggregate violation counters across all cases (cheap); assert on totals.
    let emptyCandidates = 0;
    let trainLeak = 0; // a train id appearing among candidates
    let dupCandidates = 0; // candidate ids not unique
    let wrongFrameSize = 0; // candidates.length !== universe - train
    let candidateOutsideUniverse = 0; // a candidate id without an E1 vector
    for (const c of loaded.cases) {
      if (c.candidates.length === 0) emptyCandidates++;
      const candIds = new Set(c.candidates.map((x) => x.id));
      if (candIds.size !== c.candidates.length) dupCandidates++;
      for (const t of c.trainIds) if (candIds.has(t)) trainLeak++;
      for (const id of candIds) if (!loaded.e1Item.has(id)) candidateOutsideUniverse++;
      // Full frame = E1 universe \ train (train is filtered to in-universe ids).
      if (c.candidates.length !== loaded.meta.n - c.trainIds.length) wrongFrameSize++;
    }
    expect(emptyCandidates).toBe(0);
    expect(trainLeak).toBe(0);
    expect(dupCandidates).toBe(0);
    expect(wrongFrameSize).toBe(0);
    expect(candidateOutsideUniverse).toBe(0);
  });

  test("every case has a bounded non-empty pool and exactly one relevant id", () => {
    let emptyPool = 0;
    let overSizedPool = 0; // pool.length > 200
    let wrongRelevant = 0; // relevant.size !== 1
    let dupPool = 0; // pool ids not unique
    let poolNotInCandidates = 0; // a pool id absent from candidates
    for (const c of loaded.cases) {
      if (c.pool.length === 0) emptyPool++;
      if (c.pool.length > 200) overSizedPool++;
      if (c.relevant.size !== 1) wrongRelevant++;
      const poolIds = c.pool.map((p) => p.id);
      const poolSet = new Set(poolIds);
      if (poolSet.size !== poolIds.length) dupPool++;
      const candIds = new Set(c.candidates.map((x) => x.id));
      for (const id of poolIds) if (!candIds.has(id)) poolNotInCandidates++;
    }
    expect(emptyPool).toBe(0);
    expect(overSizedPool).toBe(0);
    expect(wrongRelevant).toBe(0);
    expect(dupPool).toBe(0);
    expect(poolNotInCandidates).toBe(0);
  });

  test("objById / revenueById / sellerById cover the pool; revenue is finite >= 0", () => {
    // Iterate every pool id of every case imperatively (cheap) and COUNT
    // violations; assert on the aggregated counters. This covers the full loaded
    // data with strong assertions without ~200k per-item expect() calls.
    const OBJ_NAMES = [
      "relevance",
      "margin",
      "convProb",
      "novelty",
      "sellerFairness",
      "revenue",
    ] as const;
    let totalPoolIds = 0;
    let missingObj = 0;
    let missingRevenue = 0;
    let missingSeller = 0;
    let badRevenue = 0; // not finite or < 0
    let badSeller = 0; // empty / non-string
    let badObj = 0; // any objective not finite-in-[0,1]

    for (const c of loaded.cases) {
      for (const p of c.pool) {
        totalPoolIds++;
        if (!c.objById.has(p.id)) missingObj++;
        if (!c.revenueById.has(p.id)) missingRevenue++;
        if (!c.sellerById.has(p.id)) missingSeller++;

        const rev = c.revenueById.get(p.id);
        if (rev === undefined || !Number.isFinite(rev) || rev < 0) badRevenue++;

        const seller = c.sellerById.get(p.id);
        if (typeof seller !== "string" || seller.length === 0) badSeller++;

        const obj = c.objById.get(p.id);
        if (obj === undefined) {
          badObj++;
        } else {
          for (const name of OBJ_NAMES) {
            const v = obj[name];
            if (!Number.isFinite(v) || v < 0 || v > 1) {
              badObj++;
              break;
            }
          }
        }
      }
    }

    expect(totalPoolIds).toBeGreaterThan(0);
    // Full coverage of pool ids by every per-id map.
    expect(missingObj).toBe(0);
    expect(missingRevenue).toBe(0);
    expect(missingSeller).toBe(0);
    // All values well-formed.
    expect(badRevenue).toBe(0);
    expect(badSeller).toBe(0);
    expect(badObj).toBe(0);
  });

  test("gift detector FIRES on a non-trivial set of cases (W8 regression)", () => {
    // Before the W8 fix the detector ran on the user's TRAIN history, whose modal
    // demographic always equals the buyer's own → cross-cohort impossible → gift
    // fired on 0/N cases. The loader now runs the detector on the test item's
    // ACTUAL session (excluding the test product). Assert it genuinely fires
    // within the deterministic CASE_LIMIT prefix (the v2 dataset has ~11 gift-
    // intent sessions in the first 200 ordered test rows).
    let fired = 0;
    let giftIntent = 0;
    for (const c of loaded.cases) {
      if (c.giftSignal.isGift) fired++;
      if (c.intentGT === "gift") giftIntent++;
    }
    expect(giftIntent).toBeGreaterThan(0);
    expect(fired).toBeGreaterThan(0);
  });

  test("DETERMINISM: a second limited load reproduces identical case + pool ids", async () => {
    // A second INDEPENDENT load of the first 5 cases (deterministic ORDER BY in
    // the loader). Compare its case ids + pool ids against the matching prefix of
    // the shared CASE_LIMIT load. Deep equality on the ordered id sequences.
    const LIMIT = 5;
    const second = await loadUnifiedCases(pg, { limit: LIMIT });
    expect(second.cases.length).toBe(LIMIT);

    const firstPrefix = loaded.cases.slice(0, LIMIT);
    expect(second.cases.length).toBe(firstPrefix.length);

    const caseKeyOf = (c: { userId: string; relevant: Set<string> }) =>
      `${c.userId}|${[...c.relevant][0] ?? ""}`;

    // Identical case ids in identical order.
    expect(second.cases.map(caseKeyOf)).toEqual(firstPrefix.map(caseKeyOf));

    // Identical ordered pool ids for each sampled case.
    for (let i = 0; i < LIMIT; i++) {
      expect(second.cases[i].pool.map((p) => p.id)).toEqual(
        firstPrefix[i].pool.map((p) => p.id),
      );
      // Identical ordered candidate ids too (the full frame must be stable).
      expect(second.cases[i].candidates.map((x) => x.id)).toEqual(
        firstPrefix[i].candidates.map((x) => x.id),
      );
      // Identical revenue values for the pool (numeric determinism).
      expect(second.cases[i].pool.map((p) => second.cases[i].revenueById.get(p.id))).toEqual(
        firstPrefix[i].pool.map((p) => firstPrefix[i].revenueById.get(p.id)),
      );
    }
  }, 180_000);

  test("CLEAN mode loads leak-free cases with a usable serve-time anchor", async () => {
    // Leak-free evaluation mode (auditoría destructiva 2026-06-09): popularity =
    // train-only, serve context = pre-purchase prefix. Assert it (a) produces
    // cases without throwing, (b) keeps the same structural invariants, and
    // (c) yields at least one case with a usable last-viewed NPMI anchor (the
    // pre-purchase prefix / train fallback must not collapse to all-null).
    const cleanLoaded = await loadUnifiedCases(pg, { limit: 30, clean: true });
    expect(cleanLoaded.cases.length).toBeGreaterThan(0);
    expect(cleanLoaded.cases.length).toBeLessThanOrEqual(30);
    expect(cleanLoaded.meta.n).toBe(cleanLoaded.e1Item.size);
    expect(cleanLoaded.e1Item.size).toBe(dbE1Count);

    let withAnchor = 0; // lastViewedId non-null AND resolvable in the catalog
    let trainLeak = 0;
    for (const c of cleanLoaded.cases) {
      if (c.lastViewedId !== null && typeof c.lastViewedTitle === "string") withAnchor++;
      const candIds = new Set(c.candidates.map((x) => x.id));
      for (const t of c.trainIds) if (candIds.has(t)) trainLeak++;
    }
    expect(withAnchor).toBeGreaterThanOrEqual(1);
    expect(trainLeak).toBe(0);
  }, 180_000);
});
