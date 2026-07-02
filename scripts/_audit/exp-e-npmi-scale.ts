#!/usr/bin/env tsx
/**
 * AUDIT EXP E — Does the NPMI transductive leak GROW with catalog scale?
 *
 * In-memory markets at the spec's three scales (users ∝ n, days=90, seed=42).
 * For each: rebuild the co-occurrence graph FULL (as shipped: all events) vs
 * TRAIN-ONLY (test sessions excluded) and measure the NPMI source hit-rate
 * (held-out purchase ∈ top-50 of the shipped anchor = last view incl. test
 * session). If the leak share grows with n, part of the "edge grows with scale"
 * headline is the leak growing, not the system.
 */
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";
import { sampleBehavior, type ComplementsBySource } from "@/thesis/data/behavior-model";
import { buildPairCounts, buildNpmiTop, type EvRow } from "./lib";

const CONFIGS = [
  { n: 2000, users: 800, days: 90, seed: 42 },
  { n: 5000, users: 2000, days: 90, seed: 42 },
  { n: 10000, users: 4000, days: 90, seed: 42 },
];

for (const cfg of CONFIGS) {
  const catalog = sampleCatalog(cfg.n, cfg.seed);
  const complementsBySource: ComplementsBySource = (() => {
    const map = new Map<string, string[]>();
    for (const rel of buildRelations(catalog)) {
      if (rel.relation_type !== "complement") continue;
      const arr = map.get(rel.product_a_id) ?? [];
      arr.push(rel.product_b_id);
      map.set(rel.product_a_id, arr);
    }
    return map;
  })();
  const out = sampleBehavior(catalog, { users: cfg.users, days: cfg.days, seed: cfg.seed }, complementsBySource);

  const events: EvRow[] = out.events.map((e) => ({
    sid: e.session_id,
    uid: e.user_id,
    et: e.event_type,
    pid: e.product_id,
    ts: e.occurred_at,
  }));

  // test sessions = session of each held-out test purchase
  const purchaseSession = new Map<string, string>();
  for (const e of out.events) {
    if (e.event_type === "purchase") purchaseSession.set(`${e.user_id}|${e.product_id}|${e.occurred_at}`, e.session_id);
  }
  const testRows = out.holdout.filter((h) => h.split === "test");
  const testSessionIds = new Set<string>();
  for (const h of testRows) {
    const sid = purchaseSession.get(`${h.user_id}|${h.product_id}|${h.occurred_at}`);
    if (sid) testSessionIds.add(sid);
  }

  // shipped anchor: last product_view per user over ALL events
  const lastViewedAll = new Map<string, string>();
  for (const e of out.events) {
    if (e.event_type === "product_view") lastViewedAll.set(e.user_id, e.product_id);
  }
  // train history (purchases) per user for the not-in-train filter
  const trainByUser = new Map<string, Set<string>>();
  for (const h of out.holdout) {
    if (h.split !== "train") continue;
    const s = trainByUser.get(h.user_id) ?? new Set<string>();
    s.add(h.product_id);
    trainByUser.set(h.user_id, s);
  }

  const npmiFull = buildNpmiTop(buildPairCounts(events));
  const npmiTrain = buildNpmiTop(buildPairCounts(events, testSessionIds));

  const hit = (m: Map<string, { id: string; score: number }[]>, anchor: string | undefined, pid: string, trainSet: Set<string>) => {
    if (!anchor) return false;
    return (m.get(anchor) ?? [])
      .map((x) => x.id)
      .filter((id) => !trainSet.has(id))
      .slice(0, 50)
      .includes(pid);
  };

  let hFull = 0,
    hTrain = 0;
  for (const h of testRows) {
    const trainSet = trainByUser.get(h.user_id) ?? new Set<string>();
    const anchor = lastViewedAll.get(h.user_id);
    if (hit(npmiFull, anchor, h.product_id, trainSet)) hFull++;
    if (hit(npmiTrain, anchor, h.product_id, trainSet)) hTrain++;
  }
  const n = testRows.length;
  const leakShare = hFull > 0 ? (hFull - hTrain) / hFull : 0;
  console.log(
    `n=${cfg.n}: NPMI-hit FULL=${((100 * hFull) / n).toFixed(1)}% TRAIN-ONLY=${((100 * hTrain) / n).toFixed(1)}% ` +
      `→ cuota de fuga=${(100 * leakShare).toFixed(1)}% (testRows=${n})`,
  );
}
