/** An item observed in the current session. */
export interface SessionItem {
  product_id: string;
  gender_target: string | null;
  age_band: string | null;
}

/** The buyer's own dominant demographic, derived from their history. */
export interface UserDemographic {
  gender: string | null;
  ageBand: string | null;
}

export interface GiftOpts {
  /** Minimum session items before gift can be inferred. */
  minItems: number;
  /** Fraction of (gender-bearing) session items that must share the modal gender to count as coherent. */
  minDemographicCoherence: number;
}

export interface GiftSignal {
  isGift: boolean;
  score: number;
  reasons: string[];
  /** The recipient demographic the session points at (modal gender/age of the session). */
  targetGender: string | null;
  targetAgeBand: string | null;
}

/** Most frequent non-null value; deterministic alphabetical tie-break. Null if no non-null values. */
function modeOf(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Heuristic, interpretable gift detection at the SESSION level (no trained model,
 * no ground-truth at inference). Per spec §4.2, the signal is DEMOGRAPHIC (not
 * embedding) coherence: real gift sessions are product-diverse (the shopper browses
 * across subcategories) yet target a single recipient, so the session's items are
 * demographically coherent (shared gender/age band) and CROSS-COHORT relative to the
 * buyer's own dominant demographic. This mirrors PinnerSage-adjacent gift modeling —
 * a transient intent distinct from the buyer's persistent taste modes.
 *
 * A session is a gift when it is BOTH:
 *  - demographically coherent (a clear modal gender shared by enough items), AND
 *  - cross-cohort (its modal gender OR age band differs from the buyer's own).
 *
 * Pure and deterministic.
 */
export function detectGiftIntent(session: SessionItem[], user: UserDemographic, opts: GiftOpts): GiftSignal {
  if (session.length < opts.minItems) {
    return { isGift: false, score: 0, reasons: ["too_few_items"], targetGender: null, targetAgeBand: null };
  }

  const modalGender = modeOf(session.map((s) => s.gender_target));
  const modalAgeBand = modeOf(session.map((s) => s.age_band));

  const genderBearing = session.filter((s) => s.gender_target !== null);
  const coherence =
    genderBearing.length === 0
      ? 0
      : genderBearing.filter((s) => s.gender_target === modalGender).length / genderBearing.length;
  const coherent = modalGender !== null && coherence >= opts.minDemographicCoherence;

  const crossGender = modalGender !== user.gender;
  const crossAge = modalAgeBand !== null && user.ageBand !== null && modalAgeBand !== user.ageBand;
  const crossCohort = crossGender || crossAge;

  const reasons: string[] = [];
  if (coherent) reasons.push("demographically_coherent");
  if (crossGender) reasons.push("cross_cohort_gender");
  if (crossAge) reasons.push("cross_cohort_age");

  const isGift = coherent && crossCohort;
  const score = isGift ? coherence : 0;
  return { isGift, score, reasons, targetGender: modalGender, targetAgeBand: modalAgeBand };
}
