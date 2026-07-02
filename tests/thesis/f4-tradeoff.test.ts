import { describe, test, expect } from "vitest";
import { getPgClient } from "@/lib/db/pg";
import { expectedRevenue } from "@/thesis/objectives/outcome";
import { extractObjectiveFeatures, type ObjCtx, type ObjCandidate } from "@/thesis/objectives/objective-features";
import { multiObjectiveRanker, type ScorerItem, type ObjectiveWeights } from "@/thesis/objectives/scorer";
import { revenueAtK } from "@/thesis/eval/metrics";
import type { RankItem } from "@/thesis/types";

/**
 * On the real F4 dataset, weighting the `revenue` objective must raise expected
 * revenue@10 vs relevance-only over sampled users — the multi-objective trade-off
 * is genuine (the most relevant item is not the most lucrative). Requires the
 * F4-regenerated catalog (products carry margin_pct).
 */
describe("F4 trade-off is real (relevance-only vs revenue-weighted)", () => {
  test("revenue weight raises expected revenue@10 across sampled users", async () => {
    const pg = await getPgClient({ scope: "thesis" });
    try {
      const e1 = new Map<string, number[]>();
      for (const r of (await pg.query(`SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space='e1_prod2vec'`)).rows as { id: string; vector: number[] }[]) e1.set(r.id, r.vector.map(Number));
      const meta = new Map<string, { priceBand: number; margin: number; sellerAge: number; price_cents: number }>();
      for (const r of (await pg.query(`SELECT id::text id, price_cents, metadata FROM thesis.products`)).rows as { id: string; price_cents: number; metadata: Record<string, unknown> }[]) {
        const m = r.metadata ?? {};
        meta.set(r.id, { priceBand: Number(m.price_band ?? 0), margin: Number(m.margin_pct ?? 0), sellerAge: Number(m.seller_age_days ?? 9999), price_cents: r.price_cents });
      }
      expect([...meta.values()].some((m) => m.margin > 0)).toBe(true);
      const pop = new Map<string, number>();
      for (const r of (await pg.query(`SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`)).rows as { pid: string; c: number }[]) pop.set(r.pid, r.c);
      const maxPop = Math.max(1, ...pop.values());
      const users = (await pg.query(`SELECT DISTINCT user_id::text uid FROM thesis.holdout WHERE split='train' ORDER BY uid LIMIT 30`)).rows as { uid: string }[];

      const W0 = { relevance: 1, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, revenue: 0, diversity: 0 } as ObjectiveWeights;
      const WR = { relevance: 1, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, revenue: 1.5, diversity: 0 } as ObjectiveWeights;
      let revRelOnly = 0, revWeighted = 0;
      for (const u of users) {
        const train = ((await pg.query(`SELECT product_id::text pid FROM thesis.holdout WHERE user_id=$1 AND split='train'`, [u.uid])).rows as { pid: string }[]).map((r) => r.pid).filter((id) => e1.has(id));
        if (train.length === 0) continue;
        const medoid = e1.get(train[0])!;
        const budget = Math.round(train.reduce((s, id) => s + (meta.get(id)?.priceBand ?? 0), 0) / train.length);
        const cohortIds = [...e1.keys()].filter((id) => !train.includes(id)).slice(0, 120);
        // maxRevenue over this candidate set
        let maxRev = 0;
        const revById = new Map<string, number>();
        for (const id of cohortIds) {
          const m = meta.get(id)!;
          const affinity = Math.max(0, Math.min(1, cosineLike(medoid, e1.get(id)!)));
          const priceFit = Math.max(0, 1 - Math.abs(m.priceBand - budget) / 3);
          const rev = expectedRevenue({ affinity, priceFit, price_cents: m.price_cents, margin_pct: m.margin });
          revById.set(id, rev); maxRev = Math.max(maxRev, rev);
        }
        const ctx: ObjCtx = { modeMedoids: [medoid], budgetBand: budget, maxPopularity: maxPop, maxRevenue: maxRev };
        const items: ScorerItem[] = cohortIds.map((id) => {
          const m = meta.get(id)!;
          const f = extractObjectiveFeatures(ctx, { id, vector: e1.get(id)!, priceBand: m.priceBand, margin_pct: m.margin, popularity: pop.get(id) ?? 0, seller_age_days: m.sellerAge, price_cents: m.price_cents });
          return { id, vector: e1.get(id)!, features: f };
        });
        const cands: RankItem[] = cohortIds.map((id) => ({ id, popularity: 0, vector: e1.get(id)! }));
        revRelOnly += revenueAtK(multiObjectiveRanker(W0, items, 10).rank({ userVector: [], cohort: null }, cands), revById, 10);
        revWeighted += revenueAtK(multiObjectiveRanker(WR, items, 10).rank({ userVector: [], cohort: null }, cands), revById, 10);
      }
      expect(revWeighted).toBeGreaterThan(revRelOnly);
    } finally {
      await pg.end();
    }
  }, 120_000);
});

function cosineLike(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const den = Math.sqrt(na) * Math.sqrt(nb); return den === 0 ? 0 : d / den;
}
