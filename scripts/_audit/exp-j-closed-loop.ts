#!/usr/bin/env tsx
/**
 * EXP J — Loop cerrado: exposición mediada por el recomendador + cascada
 * (roadmap #6; diseño §4.3 "cerrar el loop en simulación"; auditoría
 * destructiva hallazgo 6 "usuarios-oráculo, cero loop").
 *
 * Pregunta: ¿una política puramente explotadora (ε=0) degenera el loop —
 * colapsa la cobertura de catálogo y el revenue realizado — frente a la MISMA
 * política con exploración ε=0.1 (Jiang et al., AIES 2019)?
 *
 * Diseño (in-memory, n=2000, users=800, days=90, mundo v2 con zipfEta=0.3):
 *   • época 0 — ORGÁNICA (sin exposurePolicy): el usuario navega el catálogo
 *     por su propia utilidad; produce el log inicial (vistas + popularidad)
 *     con el que arranca "la tienda".
 *   • épocas 1–2 — EXPOSICIÓN MEDIADA: pc-views-multi = top-3 subcategorías
 *     por VISTAS del usuario en épocas ANTERIORES × popularidad (eventos) de
 *     épocas anteriores, con cuotas proporcionales — el mejor feed realista de
 *     exp-I — envuelto en ε-greedy por slot. Cascada λ=0.85 (default).
 *   • Dos brazos: ε=0 (puro exploit) vs ε=0.1; ambos parten de la MISMA
 *     época 0 y cada brazo acumula SU propio log entre épocas.
 *
 * NOTA SOBRE SEEDS (desviación documentada de la spec "seed=42+epoch"):
 * sampleBehavior genera los 800 usuarios DESDE el seed, así que con seeds
 * distintos por época el panel cambiaría (otros user_id, otros tastes) y "las
 * vistas del usuario en épocas anteriores" no existirían — el loop jamás se
 * cerraría a nivel de usuario. Se usa seed=42 en TODAS las épocas: panel fijo
 * de usuarios; la divergencia entre épocas y brazos viene de la POLÍTICA (el
 * slate servido cambia qué se examina/compra y cómo se consumen los streams
 * rng). El ε-greedy usa makeRng con seed fija por (brazo, época).
 *
 * Métricas por época y brazo: revenue realizado/sesión (precio×margen de las
 * compras simuladas), nº de ítems distintos comprados (cobertura), Gini de
 * ventas sobre el catálogo, % de compras dentro del taste del comprador.
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import { sampleCatalog, type SynthProduct } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";
import {
  sampleBehavior,
  type BehaviorOutput,
  type ComplementsBySource,
  type ExposureContext,
  type SimEvent,
} from "@/thesis/data/behavior-model";
import { makeRng } from "@/thesis/data/rng";

const N = 2000;
const USERS = 800;
const DAYS = 90;
const SEED = 42;
const V2 = { zipfS: 1.0, zipfEta: 0.3, priceGamma: 0.8, pGiftMax: 0.16, stochasticChoice: true } as const;
const SLATE_K = 20; // con λ=0.85, E[examinados] ≈ 6.2 ≈ ventana orgánica 4–8
const TOP_SUBS = 3;
const EPOCHS_WITH_POLICY = 2; // épocas 1..2
const ARMS = [0, 0.1] as const;

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const OUT: string[] = [];
const log = (s: string) => {
  console.log(s);
  OUT.push(s);
};

/** Gini coefficient over non-negative counts (0 = igualitario, →1 = concentrado). */
function gini(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const sum = v.reduce((s, x) => s + x, 0);
  if (n === 0 || sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * v[i];
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

// ── Mundo fijo: catálogo + grafo GT de complementos (mismo estilo exp-h/i) ────
const catalog = sampleCatalog(N, SEED);
const byId = new Map<string, SynthProduct>(catalog.map((p) => [p.source_product_id, p]));
const allIds = catalog.map((p) => p.source_product_id);
const subOf = (id: string): string | null => byId.get(id)?.attrs.subcategory ?? null;
const idsBySub = new Map<string, string[]>();
for (const p of catalog) {
  const a = idsBySub.get(p.attrs.subcategory) ?? [];
  a.push(p.source_product_id);
  idsBySub.set(p.attrs.subcategory, a);
}
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

// ── Política pc-views-multi + ε-greedy sobre el log de épocas anteriores ──────
// La política sólo ve lo que una tienda real vería: eventos pasados (vistas,
// carts, compras) — JAMÁS latent_state.
function buildPolicy(
  prevEvents: readonly SimEvent[],
  epsilon: number,
  policySeed: number,
): (ctx: ExposureContext) => string[] {
  const pop = new Map<string, number>();
  const viewsByUser = new Map<string, string[]>();
  const seenByUser = new Map<string, Set<string>>();
  for (const e of prevEvents) {
    pop.set(e.product_id, (pop.get(e.product_id) ?? 0) + 1);
    if (e.event_type !== "product_view") continue;
    let seen = seenByUser.get(e.user_id);
    if (!seen) {
      seen = new Set<string>();
      seenByUser.set(e.user_id, seen);
    }
    if (!seen.has(e.product_id)) {
      seen.add(e.product_id);
      const a = viewsByUser.get(e.user_id) ?? [];
      a.push(e.product_id);
      viewsByUser.set(e.user_id, a);
    }
  }
  const byPop = (a: string, b: string) =>
    (pop.get(b) ?? 0) - (pop.get(a) ?? 0) || a.localeCompare(b);
  const globalPop = [...allIds].sort(byPop);
  const popBySub = new Map<string, string[]>();
  for (const [sub, ids] of idsBySub) popBySub.set(sub, [...ids].sort(byPop));
  // Toda la aleatoriedad de la política viene de un makeRng con seed fija por
  // (brazo, época) — nunca del reloj ni de Math.random.
  const policyRng = makeRng(policySeed >>> 0);

  return (ctx: ExposureContext): string[] => {
    // exploit = pc-views-multi: top-3 subcats por vistas previas del usuario,
    // cuotas proporcionales a la cuota de vistas, popularidad dentro de cada
    // una; relleno con popularidad global (cold-start ⇒ pop global pura).
    const views = viewsByUser.get(ctx.user.user_id) ?? [];
    const subCounts = new Map<string, number>();
    for (const id of views) {
      const s = subOf(id);
      if (s !== null) subCounts.set(s, (subCounts.get(s) ?? 0) + 1);
    }
    const topSubs = [...subCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_SUBS);
    const exploit: string[] = [];
    const used = new Set<string>();
    if (topSubs.length > 0) {
      const total = topSubs.reduce((s, [, c]) => s + c, 0);
      for (const [sub, c] of topSubs) {
        const quota = Math.max(1, Math.round((SLATE_K * c) / total));
        for (const id of (popBySub.get(sub) ?? []).slice(0, quota)) {
          if (!used.has(id)) {
            used.add(id);
            exploit.push(id);
          }
        }
      }
    }
    for (const id of globalPop) {
      if (exploit.length >= SLATE_K) break;
      if (!used.has(id)) {
        used.add(id);
        exploit.push(id);
      }
    }
    if (epsilon <= 0) return exploit.slice(0, SLATE_K);

    // ε-greedy por slot (mismo esquema que explore/epsilon.ts en producción):
    // con prob ε el slot se rellena con un ítem uniforme del catálogo aún no
    // servido en este slate (rechazo acotado: 20 usados de 2000 ⇒ ~1 intento).
    const slate: string[] = [];
    const inSlate = new Set<string>();
    let ePtr = 0;
    for (let slot = 0; slot < SLATE_K; slot++) {
      let chosen: string | null = null;
      if (policyRng.next() < epsilon) {
        for (let tries = 0; tries < 50; tries++) {
          const cand = allIds[policyRng.int(allIds.length)];
          if (!inSlate.has(cand)) {
            chosen = cand;
            break;
          }
        }
      }
      if (chosen === null) {
        while (ePtr < exploit.length && inSlate.has(exploit[ePtr])) ePtr++;
        if (ePtr < exploit.length) chosen = exploit[ePtr++];
      }
      if (chosen === null) break;
      inSlate.add(chosen);
      slate.push(chosen);
    }
    return slate;
  };
}

// ── Métricas por época ─────────────────────────────────────────────────────────
interface EpochMetrics {
  sessions: number;
  buys: number;
  revPerSession: number; // ¢ realizados (precio×margen) por sesión
  distinctBought: number; // cobertura: ítems distintos comprados
  giniSales: number;
  inTastePct: number;
}

function epochMetrics(out: BehaviorOutput): EpochMetrics {
  const taste = new Map(out.users.map((u) => [u.user_id, new Set(u.latent_state.tasteSubcategories)]));
  const buysByPid = new Map<string, number>();
  let revCents = 0;
  let buys = 0;
  let inTaste = 0;
  for (const e of out.events) {
    if (e.event_type !== "purchase") continue;
    buys++;
    buysByPid.set(e.product_id, (buysByPid.get(e.product_id) ?? 0) + 1);
    const p = byId.get(e.product_id)!;
    revCents += p.price_cents * p.margin_pct;
    if (taste.get(e.user_id)?.has(p.attrs.subcategory)) inTaste++;
  }
  const counts = catalog.map((p) => buysByPid.get(p.source_product_id) ?? 0);
  return {
    sessions: out.sessions.length,
    buys,
    revPerSession: revCents / Math.max(1, out.sessions.length),
    distinctBought: buysByPid.size,
    giniSales: gini(counts),
    inTastePct: (100 * inTaste) / Math.max(1, buys),
  };
}

const row = (label: string, m: EpochMetrics): string =>
  `  ${label.padEnd(18)} rev/sesión=${m.revPerSession.toFixed(0)}¢  cobertura=${String(m.distinctBought).padStart(4)} ítems  gini=${m.giniSales.toFixed(3)}  in-taste=${m.inTastePct.toFixed(1)}%  (compras=${m.buys}, sesiones=${m.sessions})`;

// ── Ejecución ──────────────────────────────────────────────────────────────────
log(`EXP J — loop cerrado (n=${N}, users=${USERS}, days=${DAYS}, v2 zipfEta=0.3, slate=${SLATE_K}, λ=0.85, panel seed=${SEED})`);

log(`\n━━━ época 0 (orgánica, compartida por ambos brazos) t=${el()}`);
const epoch0 = sampleBehavior(catalog, { users: USERS, days: DAYS, seed: SEED, ...V2 }, complementsBySource);
const m0 = epochMetrics(epoch0);
log(row("época 0 orgánica", m0));

const byArm = new Map<number, EpochMetrics[]>();
for (const eps of ARMS) {
  log(`\n━━━ brazo ε=${eps} t=${el()}`);
  let cumEvents: SimEvent[] = epoch0.events;
  const ms: EpochMetrics[] = [];
  for (let epoch = 1; epoch <= EPOCHS_WITH_POLICY; epoch++) {
    const policy = buildPolicy(cumEvents, eps, SEED * 1000 + epoch * 10 + Math.round(eps * 100));
    const out = sampleBehavior(
      catalog,
      { users: USERS, days: DAYS, seed: SEED, ...V2, exposurePolicy: policy },
      complementsBySource,
    );
    const m = epochMetrics(out);
    ms.push(m);
    log(row(`época ${epoch}`, m));
    cumEvents = cumEvents.concat(out.events);
  }
  byArm.set(eps, ms);
}

// ── Lectura: ¿colapsa ε=0 frente a ε=0.1? ─────────────────────────────────────
log(`\n━━━ comparación entre brazos (época 2, la más alejada del log orgánico)`);
const a0 = byArm.get(0)![EPOCHS_WITH_POLICY - 1];
const a1 = byArm.get(0.1)![EPOCHS_WITH_POLICY - 1];
const pct = (b: number, a: number) => `${(100 * (b - a) / Math.max(1e-9, a)).toFixed(1)}%`;
log(`  cobertura:   ε=0 ${a0.distinctBought} vs ε=0.1 ${a1.distinctBought}  (ε=0.1 ${pct(a1.distinctBought, a0.distinctBought)})`);
log(`  rev/sesión:  ε=0 ${a0.revPerSession.toFixed(0)}¢ vs ε=0.1 ${a1.revPerSession.toFixed(0)}¢  (ε=0.1 ${pct(a1.revPerSession, a0.revPerSession)})`);
log(`  gini ventas: ε=0 ${a0.giniSales.toFixed(3)} vs ε=0.1 ${a1.giniSales.toFixed(3)}`);
log(`  in-taste:    ε=0 ${a0.inTastePct.toFixed(1)}% vs ε=0.1 ${a1.inTastePct.toFixed(1)}%`);

writeFileSync(resolve(process.cwd(), "scripts/_audit/exp-j-results.txt"), OUT.join("\n") + "\n");
log(`\n[j] DONE t=${el()}`);
