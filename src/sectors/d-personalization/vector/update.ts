export interface UpdateInput {
  unnorm: number[];
  weight: number;
  lastUpdatedAt: Date;
  product: number[];
  eventWeight: number;
  now: Date;
  tauMs: number;
}

export interface UpdateOutput {
  newUnnorm: number[];
  newWeight: number;
}

/**
 * Applies temporal decay to (unnorm, weight) and accumulates the new event.
 *
 * Math:
 *   decay = exp(-Δt / τ)
 *   new_unnorm = old_unnorm * decay + event_weight * product
 *   new_weight = old_weight * decay + event_weight
 *
 * Properties:
 *  - When old state is (κ * prior, κ), the result implements Bayesian shrinkage.
 *  - For n → ∞ events of the same product, the normalized vector converges to it.
 */
export function applyDecayAndAccumulate(input: UpdateInput): UpdateOutput {
  const dtMs = Math.max(0, input.now.getTime() - input.lastUpdatedAt.getTime());
  const decay = Math.exp(-dtMs / input.tauMs);
  const d = input.unnorm.length;
  if (input.product.length !== d) {
    throw new Error(`dim mismatch ${input.product.length} vs ${d}`);
  }
  const newUnnorm = new Array<number>(d);
  for (let i = 0; i < d; i++) {
    newUnnorm[i] = input.unnorm[i] * decay + input.eventWeight * input.product[i];
  }
  const newWeight = input.weight * decay + input.eventWeight;
  return { newUnnorm, newWeight };
}
