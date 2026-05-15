import { KAPPA } from "./constants";

/**
 * Builds the initial (unnormalized, weight) pair for a fresh profile mode.
 *
 * Setting unnorm = KAPPA * prior and weight = KAPPA causes the incremental
 * update formula to implement Bayesian shrinkage automatically: with 0 events
 * the normalized vector equals the prior; as events accumulate, the prior
 * influence decays naturally.
 */
export function buildInitialUnnormalized(prior: readonly number[]): {
  unnorm: number[];
  weight: number;
} {
  const unnorm = new Array<number>(prior.length);
  for (let i = 0; i < prior.length; i++) unnorm[i] = prior[i] * KAPPA;
  return { unnorm, weight: KAPPA };
}
