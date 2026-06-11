import { createHash } from "node:crypto";
import { sampleCatalog, type SynthProduct } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";
import { makeRng } from "@/thesis/data/rng";
import type { ComplementsBySource } from "@/thesis/data/behavior-model";
import { ZIPF_ETA, ZIPF_S, type WorldSpec } from "./constants";
import { buildShiftCalendar, type ShiftCalendar } from "./shifts";

/**
 * Mundo del harness (blueprint §5.4): catálogo-universo INMUTABLE (mismos ids
 * y subcategorías en todas las épocas y brazos ⇒ panel de usuarios bit-estable,
 * A3 §1.1) + vistas por época (precios mutados), atractividad por época
 * (att=0 para inactivos: el knob v3 hace .get(id) ?? 1, así que el 0 explícito
 * es OBLIGATORIO) y máscara estructural activeIds(t) aplicada por el slate
 * builder. Object.freeze + hash verificado tras cada fase de agente (#9).
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface World {
  worldSeed: number;
  spec: WorldSpec;
  epochsTotal: number;
  universe: readonly SynthProduct[];
  calendar: ShiftCalendar;
  epochView(t: number): SynthProduct[];
  attractiveness(t: number): Map<string, number>;
  activeIds(t: number): ReadonlySet<string>;
  complements(t: number): ComplementsBySource;
  subcategoryOf(id: string): string | null;
  categoryOf(id: string): string | null;
  priceAt(t: number, id: string): number;
  marginOf(id: string): number;
  launchEpochOf(id: string): number;
  /** Lanza si el universo o el calendario mutaron (anti-trampa #9). */
  assertUnchanged(): void;
  hash: string;
}

export function buildWorld(worldSeed: number, spec: WorldSpec): World {
  const epochsTotal = 2 + spec.measuredEpochs;
  const universe = sampleCatalog(spec.universeSize, worldSeed);
  for (const p of universe) {
    Object.freeze(p.attrs);
    Object.freeze(p);
  }
  Object.freeze(universe);

  const byId = new Map<string, SynthProduct>(universe.map((p) => [p.source_product_id, p]));

  // ── a_i: Zipf(s) sobre barajado seed-fijo (stream propio del mundo). ──
  const worldRng = makeRng((worldSeed ^ 0xa77ac7e1) >>> 0);
  const ids = universe.map((p) => p.source_product_id).sort((a, b) => a.localeCompare(b));
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = worldRng.int(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const aById = new Map<string, number>();
  for (let r = 0; r < shuffled.length; r++) aById.set(shuffled[r], Math.pow(r + 1, -ZIPF_S));

  // ── Partición activos e0 / reservados (segundo barajado del mismo stream). ──
  const partition = [...ids];
  for (let i = partition.length - 1; i > 0; i--) {
    const j = worldRng.int(i + 1);
    [partition[i], partition[j]] = [partition[j], partition[i]];
  }
  const activeAtE0 = new Set(partition.slice(0, spec.activeAtE0));
  const reserved = partition.slice(spec.activeAtE0);

  const calendar = buildShiftCalendar(worldSeed, {
    universe,
    aById,
    activeAtE0,
    reserved,
    epochsTotal,
  });
  const aFinal = new Map(aById);
  for (const [id, a] of calendar.aOverrides) aFinal.set(id, a);

  // ── Conjuntos activos acumulados + época de lanzamiento. ──
  const launchEpoch = new Map<string, number>();
  for (const id of activeAtE0) launchEpoch.set(id, 0);
  const activeByEpoch: Set<string>[] = [new Set(activeAtE0)];
  for (let t = 1; t < epochsTotal; t++) {
    const prev = activeByEpoch[t - 1];
    const next = new Set(prev);
    const shift = calendar.epochs[t];
    for (const id of shift.launches) {
      next.add(id);
      if (!launchEpoch.has(id)) launchEpoch.set(id, t);
    }
    for (const id of shift.stockouts) next.delete(id);
    activeByEpoch.push(next);
  }

  // ── Precio/banda acumulados por época. ──
  const priceByEpoch: Map<string, { price: number; band: number }>[] = [];
  {
    let cur = new Map<string, { price: number; band: number }>(
      universe.map((p) => [
        p.source_product_id,
        { price: p.price_cents, band: p.attrs.priceBand },
      ]),
    );
    priceByEpoch.push(cur);
    for (let t = 1; t < epochsTotal; t++) {
      const next = new Map(cur);
      for (const [id, r] of calendar.epochs[t].repricings) {
        const prev = next.get(id)!;
        next.set(id, {
          price: Math.max(1, Math.round(prev.price * r.factor)),
          band: Math.min(3, Math.max(0, prev.band + r.bandDelta)),
        });
      }
      priceByEpoch.push(next);
      cur = next;
    }
  }

  // ── Complementos GT, filtrados activo×activo por época. ──
  const complementsAll = new Map<string, string[]>();
  for (const rel of buildRelations([...universe])) {
    if (rel.relation_type !== "complement") continue;
    const arr = complementsAll.get(rel.product_a_id) ?? [];
    arr.push(rel.product_b_id);
    complementsAll.set(rel.product_a_id, arr);
  }

  const viewCache = new Map<number, SynthProduct[]>();
  const attCache = new Map<number, Map<string, number>>();
  const compCache = new Map<number, ComplementsBySource>();

  const worldHash = sha256(
    JSON.stringify({
      worldSeed,
      spec,
      ids,
      basePrices: universe.map((p) => p.price_cents),
      calendar: calendar.epochs.map((e) => ({
        l: e.launches,
        s: e.stockouts,
        r: [...e.repricings.entries()],
        d: [...e.demandBySubcategory.entries()],
      })),
    }),
  );

  const world: World = {
    worldSeed,
    spec,
    epochsTotal,
    universe,
    calendar,

    epochView(t) {
      let v = viewCache.get(t);
      if (!v) {
        const prices = priceByEpoch[t];
        v = universe.map((p) => {
          const cur = prices.get(p.source_product_id)!;
          if (cur.price === p.price_cents && cur.band === p.attrs.priceBand) return p;
          return { ...p, price_cents: cur.price, attrs: { ...p.attrs, priceBand: cur.band } };
        });
        viewCache.set(t, v);
      }
      return v;
    },

    attractiveness(t) {
      let att = attCache.get(t);
      if (!att) {
        const active = activeByEpoch[t];
        const demand = calendar.epochs[t].demandBySubcategory;
        const raw = new Map<string, number>();
        let sum = 0;
        for (const id of active) {
          const sub = byId.get(id)!.attrs.subcategory;
          const x = (aFinal.get(id) ?? 0) * (demand.get(sub) ?? 1);
          raw.set(id, x);
          sum += x;
        }
        const mean = sum / Math.max(1, active.size);
        att = new Map<string, number>();
        // 0 EXPLÍCITO para inactivos: el generador hace .get(id) ?? 1.
        for (const id of ids) {
          const x = raw.get(id);
          att.set(id, x === undefined ? 0 : Math.pow(x / mean, ZIPF_ETA));
        }
        attCache.set(t, att);
      }
      return att;
    },

    activeIds: (t) => activeByEpoch[t],

    complements(t) {
      let c = compCache.get(t);
      if (!c) {
        const active = activeByEpoch[t];
        c = new Map<string, readonly string[]>();
        for (const [a, comps] of complementsAll) {
          if (!active.has(a)) continue;
          const filtered = comps.filter((b) => active.has(b));
          if (filtered.length > 0) c.set(a, filtered);
        }
        compCache.set(t, c);
      }
      return c;
    },

    subcategoryOf: (id) => byId.get(id)?.attrs.subcategory ?? null,
    categoryOf: (id) => byId.get(id)?.attrs.category ?? null,
    priceAt: (t, id) => priceByEpoch[t].get(id)?.price ?? 0,
    marginOf: (id) => byId.get(id)?.margin_pct ?? 0,
    launchEpochOf: (id) => launchEpoch.get(id) ?? 0,

    assertUnchanged() {
      const now = sha256(
        JSON.stringify({
          worldSeed,
          spec,
          ids: universe.map((p) => p.source_product_id).sort((a, b) => a.localeCompare(b)),
          basePrices: universe.map((p) => p.price_cents),
          calendar: calendar.epochs.map((e) => ({
            l: e.launches,
            s: e.stockouts,
            r: [...e.repricings.entries()],
            d: [...e.demandBySubcategory.entries()],
          })),
        }),
      );
      if (now !== worldHash) {
        throw new Error("sim world mutated after build — illegal write detected (anti-trampa #9)");
      }
    },
    hash: worldHash,
  };

  return world;
}
