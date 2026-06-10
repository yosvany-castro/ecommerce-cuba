#!/usr/bin/env tsx
/**
 * AUDIT EXP G — Calibrate simulator v2 against empirical online-retail shape.
 * Target: top-20 % SKUs ≈ 72 % of sales (Brynjolfsson et al. 2011, "72/28"),
 * while the taste signal stays learnable (>50 % of self views in-taste was the
 * v1 epistemic property; v2 will trade some of it to bestsellers, realistically).
 */
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";
import { sampleBehavior, type ComplementsBySource } from "@/thesis/data/behavior-model";

const N = 5000,
  USERS = 2000,
  DAYS = 90,
  SEED = 42;

const catalog = sampleCatalog(N, SEED);
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

const subOf = new Map(catalog.map((p) => [p.source_product_id, p.attrs.subcategory]));
const bandOf = new Map(catalog.map((p) => [p.source_product_id, p.attrs.priceBand]));

function gini(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const sum = v.reduce((s, x) => s + x, 0);
  if (n === 0 || sum === 0) return 0;
  let w = 0;
  for (let i = 0; i < n; i++) w += (i + 1) * v[i];
  return (2 * w) / (n * sum) - (n + 1) / n;
}
function topShare(values: number[], frac: number): number {
  const v = [...values].sort((a, b) => b - a);
  const sum = v.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  const k = Math.max(1, Math.floor(v.length * frac));
  return v.slice(0, k).reduce((s, x) => s + x, 0) / sum;
}

interface Cfg {
  label: string;
  zipfS?: number;
  zipfEta?: number;
  priceGamma?: number;
  pGiftMax?: number;
  stochasticChoice?: boolean;
}
const CFGS: Cfg[] = [
  { label: "v1 (actual)" },
  { label: "v2 s=0.8 eta=1.0", zipfS: 0.8, zipfEta: 1.0, priceGamma: 0.8, pGiftMax: 0.16, stochasticChoice: true },
  { label: "v2 s=0.8 eta=0.5", zipfS: 0.8, zipfEta: 0.5, priceGamma: 0.8, pGiftMax: 0.16, stochasticChoice: true },
  { label: "v2 s=1.0 eta=0.7", zipfS: 1.0, zipfEta: 0.7, priceGamma: 0.8, pGiftMax: 0.16, stochasticChoice: true },
];

for (const cfg of CFGS) {
  const t0 = Date.now();
  const out = sampleBehavior(
    catalog,
    { users: USERS, days: DAYS, seed: SEED, zipfS: cfg.zipfS, zipfEta: cfg.zipfEta, priceGamma: cfg.priceGamma, pGiftMax: cfg.pGiftMax, stochasticChoice: cfg.stochasticChoice },
    complementsBySource,
  );
  const buys = new Map<string, number>();
  let highBand = 0,
    totBuys = 0;
  for (const e of out.events) {
    if (e.event_type !== "purchase") continue;
    buys.set(e.product_id, (buys.get(e.product_id) ?? 0) + 1);
    totBuys++;
    if ((bandOf.get(e.product_id) ?? 0) >= 2) highBand++;
  }
  const counts = catalog.map((p) => buys.get(p.source_product_id) ?? 0);

  // taste learnability: share of self-session views in the user's taste subcats
  const taste = new Map(out.users.map((u) => [u.user_id, new Set(u.latent_state.tasteSubcategories)]));
  const selfSessions = new Set(out.sessions.filter((s) => s.intent === "self").map((s) => s.session_id));
  let inTaste = 0,
    views = 0;
  for (const e of out.events) {
    if (e.event_type !== "product_view" || !selfSessions.has(e.session_id)) continue;
    views++;
    if (taste.get(e.user_id)?.has(subOf.get(e.product_id) ?? "")) inTaste++;
  }
  const giftShare = out.sessions.filter((s) => s.intent === "gift").length / out.sessions.length;
  console.log(
    `${cfg.label.padEnd(18)} | ventas: top20%=${(100 * topShare(counts, 0.2)).toFixed(0)}% top10%=${(100 * topShare(counts, 0.1)).toFixed(0)}% gini=${gini(counts).toFixed(2)} ` +
      `| views in-taste=${(100 * inTaste / Math.max(1, views)).toFixed(0)}% | gift=${(100 * giftShare).toFixed(0)}% | compras banda≥2=${(100 * highBand / Math.max(1, totBuys)).toFixed(0)}% | testRows=${out.holdout.filter((h) => h.split === "test").length} | ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
}
