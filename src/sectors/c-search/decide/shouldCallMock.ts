export const LOCAL_HITS_THRESHOLD = 12;
export const CONFIDENCE_THRESHOLD = 0.5;
export const FRESHNESS_THRESHOLD_HOURS = 24;

export function shouldCallMock(
  localCount: number,
  confidence: number,
  lastRefreshedAt: Date | null,
): boolean {
  if (localCount >= LOCAL_HITS_THRESHOLD) return false;
  if (confidence <= CONFIDENCE_THRESHOLD) return false;
  if (lastRefreshedAt) {
    const ageHours = (Date.now() - lastRefreshedAt.getTime()) / (3600 * 1000);
    if (ageHours < FRESHNESS_THRESHOLD_HOURS) return false;
  }
  return true;
}
