export const LOCAL_HITS_THRESHOLD = 12;
export const CONFIDENCE_THRESHOLD = 0.5;
export const DEFAULT_FRESHNESS_THRESHOLD_HOURS = 24;

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
