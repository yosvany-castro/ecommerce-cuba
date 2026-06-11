import {
  MIN_COUNT_FOR_NPMI,
  NPMI_TOP_K,
  npmiFromCounts,
} from "@/sectors/d-personalization/co-occurrence/npmi-recompute";
import { NPMI_WINDOW_EPOCHS, POPULARITY_WINDOW_EPOCHS } from "./constants";
import type { ArmLog } from "./ledger";

/**
 * "Crons" del sim (blueprint §5.7): popularidad (ventana 1 época ≈ 7-14d) y
 * NPMI (ventana 6 épocas ≈ 90d, paridad con la poda F3/F4), reconstruidos del
 * log PROPIO de cada brazo y SOLO de épocas < t — no existe código que toque
 * eventos de la época en curso (anti-trampa #1, fuga transductiva H3).
 *
 * buildPairCounts/buildNpmiTop: promovidos VERBATIM de scripts/_audit/lib.ts
 * (overlap 1.000 con el SQL de producción verificado en la auditoría F6);
 * la fórmula NPMI y sus umbrales se importan del módulo de producción.
 */

export interface ArmArtifacts {
  /** Conteo de eventos (view+cart+purchase) por producto, ventana 1 época. */
  popularity: Map<string, number>;
  npmiTop: Map<string, { id: string; score: number }[]>;
}

interface EvLite {
  sid: string;
  pid: string;
  et: string;
}

/** ≡ lib.ts buildPairCounts (espejo del backfill SQL): peso MAX por sesión. */
export function buildPairCounts(events: EvLite[]): Map<string, number> {
  const w = (et: string) => (et === "purchase" ? 5 : et === "add_to_cart" ? 3 : 1);
  const perSession = new Map<string, Map<string, number>>();
  for (const ev of events) {
    let m = perSession.get(ev.sid);
    if (!m) {
      m = new Map();
      perSession.set(ev.sid, m);
    }
    m.set(ev.pid, Math.max(m.get(ev.pid) ?? 0, w(ev.et)));
  }
  const pairs = new Map<string, number>();
  for (const m of perSession.values()) {
    const ids = [...m.keys()].sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        const weight = Math.max(m.get(ids[i])!, m.get(ids[j])!);
        pairs.set(key, (pairs.get(key) ?? 0) + weight);
      }
    }
  }
  return pairs;
}

/** ≡ lib.ts buildNpmiTop: filtro count≥3, expansión simétrica, npmi>0, top-50. */
export function buildNpmiTop(
  pairs: Map<string, number>,
): Map<string, { id: string; score: number }[]> {
  let nTotal = 0;
  const perProduct = new Map<string, number>();
  const filtered: { a: string; b: string; count: number }[] = [];
  for (const [key, count] of pairs) {
    if (count < MIN_COUNT_FOR_NPMI) continue;
    const [a, b] = key.split("|");
    filtered.push({ a, b, count });
    nTotal += count;
    perProduct.set(a, (perProduct.get(a) ?? 0) + count);
    perProduct.set(b, (perProduct.get(b) ?? 0) + count);
  }
  const expanded = new Map<string, { id: string; score: number }[]>();
  const push = (p: string, r: string, s: number) => {
    const a = expanded.get(p) ?? [];
    a.push({ id: r, score: s });
    expanded.set(p, a);
  };
  for (const f of filtered) {
    const npmi = npmiFromCounts({
      countAB: f.count,
      countA: perProduct.get(f.a)!,
      countB: perProduct.get(f.b)!,
      nTotal,
    });
    if (npmi <= 0) continue;
    push(f.a, f.b, npmi);
    push(f.b, f.a, npmi);
  }
  for (const [p, arr] of expanded) {
    arr.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
    expanded.set(p, arr.slice(0, NPMI_TOP_K));
  }
  return expanded;
}

/** Artefactos para servir la época t: SOLO eventos de épocas < t. */
export function runEpochCrons(log: ArmLog, t: number): ArmArtifacts {
  const popularity = new Map<string, number>();
  const npmiEvents: EvLite[] = [];
  const popFrom = t - POPULARITY_WINDOW_EPOCHS;
  const npmiFrom = t - NPMI_WINDOW_EPOCHS;
  for (const e of log.events) {
    if (e.epoch >= t) continue; // jamás la época en curso ni el futuro
    if (e.epoch >= popFrom) {
      popularity.set(e.product_id, (popularity.get(e.product_id) ?? 0) + 1);
    }
    if (e.epoch >= npmiFrom) {
      npmiEvents.push({ sid: e.session_id, pid: e.product_id, et: e.event_type });
    }
  }
  return { popularity, npmiTop: buildNpmiTop(buildPairCounts(npmiEvents)) };
}
