/**
 * Confianza y mínimos de muestra (puro). El enforcement vive en report.ts
 * (estructura: null + flag), no solo en el prompt — el agente nunca ve un 0.0
 * que en realidad es "sin datos".
 */

/** Wilson score interval al 95%. null si la muestra no es válida. */
export function wilson95(successes: number, n: number): [number, number] | null {
  if (n <= 0 || successes < 0 || successes > n) return null;
  const z = 1.959963984540054;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export const MIN_SERVED_FOR_SEEN_RATE = 50;
export const MIN_SEEN_FOR_CTR = 200;
export const MIN_PURCHASES_FOR_REVENUE_RATE = 10;
export const MIN_SESSIONS_PER_ARM = 30;
export const MIN_PURCHASES_FOR_HOLDOUT_DELTA = 10;
