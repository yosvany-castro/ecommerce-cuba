import { makeRng } from "@/thesis/data/rng";
import type { SynthProduct } from "@/thesis/data/catalog-model";

/**
 * Calendario de shifts NO estacionarios — muestreado determinísticamente de
 * worldSeed, JAMÁS a mano y JAMÁS tras ver un ratio (anti-trampa A3 §8 #4).
 *
 * Magnitudes PRE-REGISTRADAS (A3 §1.3 — cambiarlas tras correr un seed del
 * gate invalida ese seed; re-registro + seeds frescos):
 * - Lanzamientos: ~1.7% del activo e0 por época (= 40 con 2400 activos);
 *   1 "hit" por oleada forzado al decil superior de a_i, el resto hereda Zipf.
 * - Agotamientos: 2.5% del activo/época, peso (1 − stock_health)·a_i
 *   (los bestsellers se agotan upstream — el dolor real del dropshipping).
 * - Demanda: cada 3 épocas 1-2 subcategorías "evento" ×2.0–3.0 por 2-3 épocas
 *   con rampa subida/bajada; el resto random-walk ×[0.9, 1.1] acumulativo.
 * - Repricing: 7% del activo/época, ±10–25%, priceBand ±1 en 30%.
 * Todos exógenos: el MISMO calendario para ambos brazos.
 */

export const LAUNCH_RATE = 1 / 60; // ≈1.7% del activo e0 por época
export const STOCKOUT_RATE = 0.025;
export const REPRICE_RATE = 0.07;
export const REPRICE_DELTA_MIN = 0.1;
export const REPRICE_DELTA_MAX = 0.25;
export const REPRICE_BAND_PROB = 0.3;
export const EVENT_EVERY_EPOCHS = 3;
export const EVENT_MULT_MIN = 2.0;
export const EVENT_MULT_MAX = 3.0;
export const WALK_MIN = 0.9;
export const WALK_MAX = 1.1;

export interface EpochShift {
  epoch: number;
  launches: string[];
  stockouts: string[];
  repricings: Map<string, { factor: number; bandDelta: -1 | 0 | 1 }>;
  /** m(subcat, t) = walk acumulado × overlay de evento (ya combinados). */
  demandBySubcategory: Map<string, number>;
}

export interface ShiftCalendar {
  /** Índice = época (0 = estado inicial, sin shift). */
  epochs: EpochShift[];
  /** a_i sobreescrita para los "hits" de lanzamiento (decil superior). */
  aOverrides: Map<string, number>;
  /** Log humano para el sanity report del harness. */
  log: string[];
}

export interface ShiftCalendarArgs {
  universe: readonly SynthProduct[];
  /** Atractividad Zipf base por id (pre-overrides). */
  aById: ReadonlyMap<string, number>;
  activeAtE0: ReadonlySet<string>;
  /** Pool de lanzamiento (universo − activos e0), en orden determinista. */
  reserved: readonly string[];
  epochsTotal: number;
}

/** Muestreo ponderado sin reemplazo (O(n) por draw — n≤3000, ~60 draws). */
function weightedSampleWithoutReplacement(
  items: { id: string; w: number }[],
  count: number,
  rnd: () => number,
): string[] {
  const pool = items.filter((x) => x.w > 0);
  const out: string[] = [];
  for (let k = 0; k < count && pool.length > 0; k++) {
    let total = 0;
    for (const x of pool) total += x.w;
    let r = rnd() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= pool[idx].w;
      if (r <= 0) break;
    }
    out.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return out;
}

export function buildShiftCalendar(worldSeed: number, args: ShiftCalendarArgs): ShiftCalendar {
  // Stream propio: jamás toca los streams del generador de comportamiento.
  const rng = makeRng((worldSeed ^ 0x51f7c4d3) >>> 0);
  const log: string[] = [];

  const subOf = new Map<string, string>();
  const stockHealth = new Map<string, number>();
  for (const p of args.universe) {
    subOf.set(p.source_product_id, p.attrs.subcategory);
    stockHealth.set(p.source_product_id, p.stock_health);
  }
  const allSubs = [...new Set(args.universe.map((p) => p.attrs.subcategory))].sort();

  // ── a_i de los hits: decil superior de la distribución base. ──
  const aSortedDesc = [...args.aById.values()].sort((a, b) => b - a);
  const topDecile = aSortedDesc.slice(0, Math.max(1, Math.floor(aSortedDesc.length / 10)));
  const aOverrides = new Map<string, number>();

  // ── Oleadas de lanzamiento: barajado fijo del pool reservado. ──
  const launchPool = [...args.reserved];
  for (let i = launchPool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [launchPool[i], launchPool[j]] = [launchPool[j], launchPool[i]];
  }
  const launchesPerEpoch = Math.max(1, Math.round(args.activeAtE0.size * LAUNCH_RATE));
  let launchPtr = 0;

  // ── Demanda: walk acumulado por subcategoría + overlay de eventos. ──
  const walk = new Map<string, number>(allSubs.map((s) => [s, 1]));
  // overlayByEpoch[t].get(sub) = multiplicador de evento vigente en t.
  const overlayByEpoch: Map<string, number>[] = Array.from(
    { length: args.epochsTotal },
    () => new Map<string, number>(),
  );

  const active = new Set(args.activeAtE0);
  const epochs: EpochShift[] = [
    {
      epoch: 0,
      launches: [],
      stockouts: [],
      repricings: new Map(),
      demandBySubcategory: new Map(allSubs.map((s) => [s, 1])),
    },
  ];

  for (let t = 1; t < args.epochsTotal; t++) {
    // 1. Lanzamientos (oleada; el primero de cada oleada es el hit).
    const launches = launchPool.slice(launchPtr, launchPtr + launchesPerEpoch);
    launchPtr += launches.length;
    if (launches.length > 0) {
      const hit = launches[0];
      aOverrides.set(hit, topDecile[rng.int(topDecile.length)]);
      log.push(`e${t}: launch wave ${launches.length} (hit=${hit})`);
    }
    for (const id of launches) active.add(id);

    // 2. Agotamientos exógenos, sesgados a bestsellers frágiles.
    const activeSorted = [...active].sort();
    const stockoutCount = Math.round(activeSorted.length * STOCKOUT_RATE);
    const stockouts = weightedSampleWithoutReplacement(
      activeSorted.map((id) => ({
        id,
        w: (1 - (stockHealth.get(id) ?? 0.5)) * (aOverrides.get(id) ?? args.aById.get(id) ?? 0),
      })),
      stockoutCount,
      () => rng.next(),
    );
    for (const id of stockouts) active.delete(id);
    log.push(`e${t}: stockouts ${stockouts.length}/${activeSorted.length}`);

    // 3. Repricing ±10-25%, banda ±1 en 30%.
    const repricings = new Map<string, { factor: number; bandDelta: -1 | 0 | 1 }>();
    const repriceable = [...active].sort();
    const repriceCount = Math.round(repriceable.length * REPRICE_RATE);
    for (let k = 0; k < repriceCount; k++) {
      const id = repriceable[rng.int(repriceable.length)];
      if (repricings.has(id)) continue;
      const delta = REPRICE_DELTA_MIN + rng.next() * (REPRICE_DELTA_MAX - REPRICE_DELTA_MIN);
      const up = rng.next() < 0.5;
      const factor = up ? 1 + delta : 1 - delta;
      const bandDelta: -1 | 0 | 1 = rng.next() < REPRICE_BAND_PROB ? (up ? 1 : -1) : 0;
      repricings.set(id, { factor, bandDelta });
    }

    // 4. Demanda: walk por subcategoría + eventos cada 3 épocas.
    for (const s of allSubs) {
      walk.set(s, (walk.get(s) ?? 1) * (WALK_MIN + rng.next() * (WALK_MAX - WALK_MIN)));
    }
    if (t >= 2 && (t - 2) % EVENT_EVERY_EPOCHS === 0) {
      const nCats = 1 + rng.int(2);
      const duration = 2 + rng.int(2);
      for (let c = 0; c < nCats; c++) {
        const sub = allSubs[rng.int(allSubs.length)];
        const mult = EVENT_MULT_MIN + rng.next() * (EVENT_MULT_MAX - EVENT_MULT_MIN);
        // Rampa subida/bajada: extremos a mitad de fuerza (en log-espacio).
        for (let k = 0; k < duration && t + k < args.epochsTotal; k++) {
          const edge = duration > 1 && (k === 0 || k === duration - 1);
          const m = Math.pow(mult, edge ? 0.5 : 1);
          const cur = overlayByEpoch[t + k].get(sub) ?? 1;
          overlayByEpoch[t + k].set(sub, Math.max(cur, m));
        }
        log.push(`e${t}: demand event ${sub} ×${mult.toFixed(2)} dur=${duration}`);
      }
    }

    const demandBySubcategory = new Map<string, number>();
    for (const s of allSubs) {
      demandBySubcategory.set(s, (walk.get(s) ?? 1) * (overlayByEpoch[t].get(s) ?? 1));
    }

    epochs.push({ epoch: t, launches, stockouts, repricings, demandBySubcategory });
  }

  return { epochs, aOverrides, log };
}
