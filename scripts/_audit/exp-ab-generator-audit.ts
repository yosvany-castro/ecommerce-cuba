#!/usr/bin/env tsx
/**
 * AUDIT EXP A+B — Structural audit of the synthetic market generator.
 *
 * A) Popularity concentration: is item popularity Zipf-like (real e-commerce)
 *    or quasi-uniform (which would doom popularity baselines BY CONSTRUCTION
 *    and manufacture the "edge grows with scale" narrative)?
 * B) Test-set composition: what fraction of held-out purchases are
 *    (gift / in-taste / seeded GT-complement / other)? If the seeded-complement
 *    share ≈ the claimed "28-37% NPMI-only-reachable", that claim is an echo of
 *    the generator dial P_COMPLEMENT_SEED, not a discovery.
 *
 * Pure in-memory: no DB, no API. Mirrors the spec §6 regeneration matrix
 * (n=2000/u=800, n=5000/u=2000, n=10000/u=4000; days=90; seed=42).
 */
import { sampleCatalog, type SynthProduct } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";
import {
  sampleBehavior,
  type ComplementsBySource,
  type SimEvent,
} from "@/thesis/data/behavior-model";

interface Cfg {
  n: number;
  users: number;
  days: number;
  seed: number;
}

const CONFIGS: Cfg[] = [
  { n: 2000, users: 800, days: 90, seed: 42 },
  { n: 5000, users: 2000, days: 90, seed: 42 },
  { n: 5000, users: 2000, days: 90, seed: 123 }, // matches the dataset currently in DB
  { n: 10000, users: 4000, days: 90, seed: 42 },
];

function gini(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const sum = v.reduce((s, x) => s + x, 0);
  if (n === 0 || sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * v[i];
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

function topShare(values: number[], frac: number): number {
  const v = [...values].sort((a, b) => b - a);
  const sum = v.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  const k = Math.max(1, Math.floor(v.length * frac));
  return v.slice(0, k).reduce((s, x) => s + x, 0) / sum;
}

function pct(x: number): string {
  return (100 * x).toFixed(1) + "%";
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return 0;
  return v[Math.floor(v.length / 2)];
}

for (const cfg of CONFIGS) {
  const t0 = Date.now();
  const catalog = sampleCatalog(cfg.n, cfg.seed);
  const byId = new Map<string, SynthProduct>(catalog.map((p) => [p.source_product_id, p]));

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

  // ── Indexes ────────────────────────────────────────────────────────────────
  const sessionIntent = new Map<string, "self" | "gift">();
  for (const s of out.sessions) sessionIntent.set(s.session_id, s.intent);
  const userTaste = new Map<string, Set<string>>();
  for (const u of out.users) userTaste.set(u.user_id, new Set(u.latent_state.tasteSubcategories));

  // purchase event -> session lookup
  const purchaseSession = new Map<string, string>(); // `${uid}|${pid}|${ts}` -> session_id
  const eventsBySession = new Map<string, SimEvent[]>();
  for (const ev of out.events) {
    if (ev.event_type === "purchase") {
      purchaseSession.set(`${ev.user_id}|${ev.product_id}|${ev.occurred_at}`, ev.session_id);
    }
    const a = eventsBySession.get(ev.session_id) ?? [];
    a.push(ev);
    eventsBySession.set(ev.session_id, a);
  }

  // test-session ids (the session of each held-out test purchase)
  const testRows = out.holdout.filter((h) => h.split === "test");
  const testSessions = new Set<string>();
  for (const h of testRows) {
    const sid = purchaseSession.get(`${h.user_id}|${h.product_id}|${h.occurred_at}`);
    if (sid) testSessions.add(sid);
  }

  // ── A. Popularity concentration ────────────────────────────────────────────
  // popularity as SHIPPED (popById): count of ALL events per product (incl. test sessions)
  const popAll = new Map<string, number>();
  const popTrainOnly = new Map<string, number>(); // excluding test sessions
  let purchaseEvents = 0;
  const purchasesPerItem = new Map<string, number>();
  for (const ev of out.events) {
    popAll.set(ev.product_id, (popAll.get(ev.product_id) ?? 0) + 1);
    if (!testSessions.has(ev.session_id)) {
      popTrainOnly.set(ev.product_id, (popTrainOnly.get(ev.product_id) ?? 0) + 1);
    }
    if (ev.event_type === "purchase") {
      purchaseEvents++;
      purchasesPerItem.set(ev.product_id, (purchasesPerItem.get(ev.product_id) ?? 0) + 1);
    }
  }
  const allCounts = catalog.map((p) => popAll.get(p.source_product_id) ?? 0);
  const purchCounts = catalog.map((p) => purchasesPerItem.get(p.source_product_id) ?? 0);

  // subcategory sizes
  const bySub = new Map<string, string[]>();
  for (const p of catalog) {
    const a = bySub.get(p.attrs.subcategory) ?? [];
    a.push(p.source_product_id);
    bySub.set(p.attrs.subcategory, a);
  }
  const subSizes = [...bySub.values()].map((a) => a.length);

  // ── B. Test composition + popularity-rank of test item in its subcategory ──
  let gift = 0,
    inTaste = 0,
    seededComp = 0,
    other = 0;
  let rankLe10 = 0,
    rankLe40 = 0,
    rankLe10Train = 0,
    rankLe40Train = 0;
  const ranks: number[] = [];

  // pre-sort each subcategory by shipped popularity desc (tie: id asc), as the popular source does
  const subRankAll = new Map<string, Map<string, number>>();
  const subRankTrain = new Map<string, Map<string, number>>();
  for (const [sub, ids] of bySub) {
    const mkRank = (pop: Map<string, number>) => {
      const sorted = [...ids].sort(
        (a, b) => (pop.get(b) ?? 0) - (pop.get(a) ?? 0) || a.localeCompare(b),
      );
      return new Map(sorted.map((id, i) => [id, i + 1]));
    };
    subRankAll.set(sub, mkRank(popAll));
    subRankTrain.set(sub, mkRank(popTrainOnly));
  }

  for (const h of testRows) {
    const sid = purchaseSession.get(`${h.user_id}|${h.product_id}|${h.occurred_at}`);
    const intent = sid ? sessionIntent.get(sid) : undefined;
    const prod = byId.get(h.product_id)!;
    const taste = userTaste.get(h.user_id)!;

    if (intent === "gift") gift++;
    else if (taste.has(prod.attrs.subcategory)) inTaste++;
    else {
      // out-of-taste in a self session: is it a GT complement of a co-session item?
      const sessionPids = new Set((eventsBySession.get(sid ?? "") ?? []).map((e) => e.product_id));
      sessionPids.delete(h.product_id);
      let isComp = false;
      for (const otherPid of sessionPids) {
        const comps = complementsBySource.get(otherPid);
        if (comps && comps.includes(h.product_id)) {
          isComp = true;
          break;
        }
      }
      if (isComp) seededComp++;
      else other++;
    }

    const sub = prod.attrs.subcategory;
    const r = subRankAll.get(sub)!.get(h.product_id)!;
    const rTrain = subRankTrain.get(sub)!.get(h.product_id)!;
    ranks.push(r);
    if (r <= 10) rankLe10++;
    if (r <= 40) rankLe40++;
    if (rTrain <= 10) rankLe10Train++;
    if (rTrain <= 40) rankLe40Train++;
  }

  const nT = testRows.length;
  console.log(`\n━━━ n=${cfg.n} users=${cfg.users} seed=${cfg.seed} (${((Date.now() - t0) / 1000).toFixed(0)}s) ━━━`);
  console.log(
    `  events=${out.events.length} purchases=${purchaseEvents} testRows=${nT} subcats=${bySub.size} ` +
      `items/subcat median=${median(subSizes)}`,
  );
  console.log(`  [A] eventos por ítem: media=${(out.events.length / cfg.n).toFixed(1)} mediana=${median(allCounts)}`);
  console.log(
    `  [A] POPULARIDAD (eventos): gini=${gini(allCounts).toFixed(3)} top1%share=${pct(topShare(allCounts, 0.01))} ` +
      `top10%share=${pct(topShare(allCounts, 0.10))} itemsConCero=${pct(allCounts.filter((x) => x === 0).length / cfg.n)}`,
  );
  console.log(
    `  [A] COMPRAS por ítem:     gini=${gini(purchCounts).toFixed(3)} top1%share=${pct(topShare(purchCounts, 0.01))} ` +
      `top10%share=${pct(topShare(purchCounts, 0.10))} itemsConCero=${pct(purchCounts.filter((x) => x === 0).length / cfg.n)}`,
  );
  console.log(
    `  [B] composición del test: gift=${pct(gift / nT)} in-taste=${pct(inTaste / nT)} ` +
      `complemento-sembrado=${pct(seededComp / nT)} otro=${pct(other / nT)}`,
  );
  console.log(
    `  [B] rank del ítem-test en su subcategoría por popularidad (shipped, incl. test): ` +
      `P(≤10)=${pct(rankLe10 / nT)} P(≤40)=${pct(rankLe40 / nT)} mediana=${median(ranks)}`,
  );
  console.log(
    `  [B] idem popularidad TRAIN-ONLY (sin fuga):                                     ` +
      `P(≤10)=${pct(rankLe10Train / nT)} P(≤40)=${pct(rankLe40Train / nT)}`,
  );
}
