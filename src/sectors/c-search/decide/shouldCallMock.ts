export const LOCAL_HITS_THRESHOLD = 12;
export const CONFIDENCE_THRESHOLD = 0.5;
export const DEFAULT_FRESHNESS_THRESHOLD_HOURS = 24;

/**
 * F4 T7: piso de similitud coseno para considerar un hit "fuerte". Sin piso, el
 * retrieve top-K devuelve ~40-50 vecinos siempre, y `shouldCallMock` nunca
 * dispara ⇒ la ingesta externa por búsqueda queda muerta. `0` desactiva el piso
 * (todos los hits coseno cuentan = comportamiento viejo exacto).
 */
export const DEFAULT_STRONG_HIT_MIN_SCORE = 0.55;

export function currentStrongHitMinScore(): number {
  const v = process.env.SEARCH_STRONG_HIT_MIN_SCORE;
  if (v === undefined) return DEFAULT_STRONG_HIT_MIN_SCORE;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : DEFAULT_STRONG_HIT_MIN_SCORE;
}

/**
 * Cuenta hits "fuertes" únicos: un producto es fuerte si (a) apareció en BM25
 * (match léxico = relevante por definición) O (b) su score coseno ≥ minScore.
 * Si minScore ≤ 0, desactiva el piso por completo (todos los hits coseno cuentan).
 * Devuelve el tamaño del UNION por id (un producto en ambas listas cuenta 1).
 */
export function countStrongHits(
  bm25Ids: string[],
  cosineHits: { id: string; score: number }[],
  minScore: number,
): number {
  const strong = new Set<string>(bm25Ids);
  for (const h of cosineHits) {
    if (minScore <= 0 || h.score >= minScore) strong.add(h.id);
  }
  return strong.size;
}

/** @deprecated use `currentFreshnessThresholdHours()` to allow env override. */
export const FRESHNESS_THRESHOLD_HOURS = DEFAULT_FRESHNESS_THRESHOLD_HOURS;

export function currentFreshnessThresholdHours(): number {
  const v = process.env.FRESHNESS_THRESHOLD_HOURS;
  if (v === undefined) return DEFAULT_FRESHNESS_THRESHOLD_HOURS;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : DEFAULT_FRESHNESS_THRESHOLD_HOURS;
}

export function shouldCallMock(
  localCount: number,
  confidence: number,
  lastRefreshedAt: Date | null,
): boolean {
  if (localCount >= LOCAL_HITS_THRESHOLD) return false;
  if (confidence <= CONFIDENCE_THRESHOLD) return false;
  if (lastRefreshedAt) {
    const ageHours = (Date.now() - lastRefreshedAt.getTime()) / (3600 * 1000);
    if (ageHours < currentFreshnessThresholdHours()) return false;
  }
  return true;
}
