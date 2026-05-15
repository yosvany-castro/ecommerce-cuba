import { normalize } from "@/lib/math";
import { ALPHA_BASE, ALPHA_PER_EVENT, ALPHA_MAX } from "./constants";

export function alphaFor(nEventsInSession: number): number {
  return Math.min(ALPHA_MAX, ALPHA_BASE + ALPHA_PER_EVENT * nEventsInSession);
}

/**
 * Combines profile and session vectors with dynamic α.
 * α = 0.1 with 0 session events (profile dominates).
 * α = 0.7 with ≥12 session events (session dominates).
 */
export function effectiveUserVector(
  profileNormalized: readonly number[],
  sessionNormalized: readonly number[] | null,
  nEventsInSession: number,
): number[] {
  if (!sessionNormalized) return profileNormalized.slice();
  const a = alphaFor(nEventsInSession);
  const d = profileNormalized.length;
  const mix = new Array<number>(d);
  for (let i = 0; i < d; i++) {
    mix[i] = a * sessionNormalized[i] + (1 - a) * profileNormalized[i];
  }
  return normalize(mix);
}
