// src/sectors/c-search/retrieve/price-boost.ts — T2a: "barato primero". El
// público cubano prefiere lo BARATO; tras fusionar bm25+cosine (RRF puro,
// solo relevancia léxico/semántica) reordenamos por
// score' = rrf_score × factor(price_cents), un ajuste suave, no un filtro.
import { rrfFuse, RRF_K0, type FusedProduct, type RankedProduct } from "./rrf";

function envFloat(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined) return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

const DEFAULT_CHEAP_BOOST = 0.25;
const DEFAULT_EXPENSIVE_PENALTY = 0.2;

// Leídos por llamada (no congelados a nivel de módulo) para que los tests
// puedan pisar PRICE_CHEAP_BOOST/PRICE_EXPENSIVE_PENALTY sin resetear el módulo
// — mismo patrón que currentStrongHitMinScore() en decide/shouldCallMock.ts.
export function currentCheapBoost(): number {
  return envFloat("PRICE_CHEAP_BOOST", DEFAULT_CHEAP_BOOST);
}
export function currentExpensivePenalty(): number {
  return envFloat("PRICE_EXPENSIVE_PENALTY", DEFAULT_EXPENSIVE_PENALTY);
}

const CHEAP_MAX_CENTS = 1500; // $15
const MID_MAX_CENTS = 5000; // $50
const EXPENSIVE_MIN_CENTS = 12000; // $120

// Alta demanda en Cuba (apagones/inestabilidad eléctrica) pese al precio alto
// — estos productos NO reciben el penalty de "caro".
export const EXPENSIVE_EXCEPTION_REGEX =
  /generador|planta el[eé]ctrica|power station|ecoflow|inversor|panel solar|bater[ií]a (solar|de litio)/i;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** factor(price_cents): ≤$15 boost, $15–50 baja suave a 1.0, $50–120 baja
 * suave a 1-penalty, >$120 plano en 1-penalty. */
export function priceFactor(price_cents: number): number {
  const boost = currentCheapBoost();
  const penalty = currentExpensivePenalty();
  if (price_cents <= CHEAP_MAX_CENTS) return 1 + boost;
  if (price_cents <= MID_MAX_CENTS) {
    const t = (price_cents - CHEAP_MAX_CENTS) / (MID_MAX_CENTS - CHEAP_MAX_CENTS);
    return lerp(1 + boost, 1, t);
  }
  if (price_cents <= EXPENSIVE_MIN_CENTS) {
    const t = (price_cents - MID_MAX_CENTS) / (EXPENSIVE_MIN_CENTS - MID_MAX_CENTS);
    return lerp(1, 1 - penalty, t);
  }
  return 1 - penalty;
}

/** priceFactor + excepción de alta demanda: si el título matchea y el factor
 * cae por debajo de 1 (zona de penalty), se anula el penalty (factor=1). */
export function priceFactorForProduct(price_cents: number, title: string): number {
  const f = priceFactor(price_cents);
  if (f < 1 && EXPENSIVE_EXCEPTION_REGEX.test(title)) return 1;
  return f;
}

function buildPriceMap(
  lists: RankedProduct[][],
): Map<string, { price_cents: number; title: string }> {
  const map = new Map<string, { price_cents: number; title: string }>();
  for (const list of lists) {
    for (const r of list) {
      if (r.price_cents !== undefined && r.title !== undefined && !map.has(r.id)) {
        map.set(r.id, { price_cents: r.price_cents, title: r.title });
      }
    }
  }
  return map;
}

/** Reordena `fused` por score' = rrf_score × factor(price). Productos sin
 * price_cents/title conocido (no debería pasar — bm25/cosine siempre los
 * traen) quedan con factor=1, sin mover su posición relativa al resto de
 * empates. Array.prototype.sort es estable (spec ES2019+): mismo score'
 * conserva el orden de relevancia que trajo el RRF. */
export function applyPriceBoost(
  fused: FusedProduct[],
  info: Map<string, { price_cents: number; title: string }>,
): FusedProduct[] {
  const adjustedScore = (p: FusedProduct): number => {
    const meta = info.get(p.id);
    return meta ? p.rrf_score * priceFactorForProduct(meta.price_cents, meta.title) : p.rrf_score;
  };
  return [...fused].sort((a, b) => adjustedScore(b) - adjustedScore(a));
}

/** rrfFuse + reorden "barato primero" en un solo paso — la forma en que
 * search.ts debe fusionar bm25/cosine (los dos sitios: fuse inicial y re-fuse
 * post-ingesta). Las listas de entrada ya traen price_cents/title (SELECT de
 * bm25Search/cosineSearch), así que no hace falta una query extra. */
export function fuseWithPriceBoost(lists: RankedProduct[][], k0: number = RRF_K0): FusedProduct[] {
  const fused = rrfFuse(lists, k0);
  return applyPriceBoost(fused, buildPriceMap(lists));
}
