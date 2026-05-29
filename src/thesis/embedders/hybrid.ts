import { l2normalize } from "./space";

/**
 * E2 hybrid: blends the text vector (good for cold-start / new items) with the
 * behavioral Prod2Vec vector (good once an item has interaction history). The
 * gate weight on TEXT is alpha = kappa/(kappa + nInteractions): text dominates
 * when the item is cold, behaviour takes over as it warms. Result re-normalized.
 */
export function hybridAlpha(nInteractions: number, kappa: number): number {
  return kappa / (kappa + nInteractions);
}

export function hybridVector(
  textVec: number[],
  behavVec: number[] | null,
  nInteractions: number,
  kappa: number,
): number[] {
  const t = l2normalize(textVec);
  if (!behavVec) return t;
  const b = l2normalize(behavVec);
  const a = hybridAlpha(nInteractions, kappa);
  const d = Math.min(t.length, b.length);
  const mix = new Array<number>(d);
  for (let i = 0; i < d; i++) mix[i] = a * t[i] + (1 - a) * b[i];
  return l2normalize(mix);
}
