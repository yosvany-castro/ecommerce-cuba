/**
 * Off-Policy Evaluation (OPE) Estimators
 * =======================================
 * OPE lets us estimate the expected reward of a NEW (target) ranking policy
 * from interaction logs collected under a DIFFERENT (logging) policy — without
 * running a live A/B test.  All three estimators below are pure functions with
 * no side-effects, no I/O, and no randomness.
 *
 * --- Fields on OpeLog ---
 * reward:      observed binary/continuous reward (e.g. conversion = 1).
 * loggingProp: probability that the logging policy chose this action/item.
 * targetProp:  probability that the TARGET policy would choose the same action.
 * estReward:   (optional) direct model estimate of E[reward | context, action].
 *
 * --- Importance weight ---
 * w = targetProp / loggingProp
 * When loggingProp <= 0 the sample is unusable (divide-by-zero), so w = 0.
 *
 * --- IPS (Inverse Propensity Scoring) ---
 * V_IPS = mean( w * reward )
 * Unbiased when propensities are correctly specified.  High variance when
 * weights are large (target very different from logging).
 *
 * --- SNIPS (Self-Normalised IPS) ---
 * V_SNIPS = sum(w * reward) / sum(w)
 * Biased but lower variance than IPS via self-normalisation (Swaminathan &
 * Joachims, 2015).  Equivalent to a weighted mean of rewards.
 *
 * --- Doubly-Robust (DR) ---
 * V_DR = mean( estReward + w * (reward - estReward) )
 * Combines a direct model estimate with an IPS correction term.  Unbiased if
 * EITHER the propensities OR the reward model is correct ("doubly robust").
 * When estReward is absent (defaults to 0) the formula reduces exactly to IPS.
 * When the reward model is perfect (estReward == reward for every log), the
 * residual (reward - estReward) is 0, so the weights drop out and
 * V_DR = mean(estReward) — variance is eliminated entirely.
 */

export interface OpeLog {
  reward: number;
  loggingProp: number;
  targetProp: number;
  /** Optional direct-model reward estimate; defaults to 0 (→ DR reduces to IPS). */
  estReward?: number;
}

/** Private helper: importance weight for a single log entry. */
function weight(l: OpeLog): number {
  return l.loggingProp <= 0 ? 0 : l.targetProp / l.loggingProp;
}

/**
 * IPS estimator: mean( w * reward ).
 * Returns 0 for empty input or when all weights are zero.
 */
export function ips(logs: OpeLog[]): number {
  if (logs.length === 0) return 0;
  const total = logs.reduce((sum, l) => sum + weight(l) * l.reward, 0);
  return total / logs.length;
}

/**
 * SNIPS (self-normalised IPS) estimator: sum(w*reward) / sum(w).
 * Lower variance than IPS via self-normalisation.
 * Returns 0 for empty input or when sum of weights is zero.
 */
export function snips(logs: OpeLog[]): number {
  if (logs.length === 0) return 0;
  let sumWeightedReward = 0;
  let sumWeights = 0;
  for (const l of logs) {
    const w = weight(l);
    sumWeightedReward += w * l.reward;
    sumWeights += w;
  }
  return sumWeights === 0 ? 0 : sumWeightedReward / sumWeights;
}

/**
 * Doubly-Robust estimator: mean( estReward + w * (reward - estReward) ).
 * Falls back to IPS when estReward is absent (treated as 0).
 * Returns 0 for empty input.
 */
export function doublyRobust(logs: OpeLog[]): number {
  if (logs.length === 0) return 0;
  const total = logs.reduce((sum, l) => {
    const w = weight(l);
    const est = l.estReward ?? 0;
    return sum + est + w * (l.reward - est);
  }, 0);
  return total / logs.length;
}
