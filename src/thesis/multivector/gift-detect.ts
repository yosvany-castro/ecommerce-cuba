import { cosineSim, meanPool } from "../embedders/space";
import type { UserMode } from "./modes";

/** An item observed in the current session. */
export interface SessionItem {
  product_id: string;
  vector: number[];
  gender_target: string | null;
  // age_band: carried for downstream/diagnostics; not used by the current decision rule
  age_band: string | null;
}

export interface GiftOpts {
  /** Minimum session items before gift can be inferred. */
  minItems: number;
  /** Session counts as "away from the user" when its best similarity to any mode <= this. */
  maxSimToModes: number;
  /** Session counts as "internally coherent" when mean pairwise similarity >= this. */
  minInternalCoherence: number;
}

export interface GiftSignal {
  isGift: boolean;
  score: number;
  reasons: string[];
}

/** Mean pairwise cosine of the session items (how focused the session is). */
function internalCoherence(vectors: number[][]): number {
  if (vectors.length < 2) return 1;
  let s = 0, pairs = 0;
  for (let i = 0; i < vectors.length; i++)
    for (let j = i + 1; j < vectors.length; j++) { s += cosineSim(vectors[i], vectors[j]); pairs++; }
  return pairs === 0 ? 1 : s / pairs;
}

/**
 * Heuristic, interpretable gift detection at the SESSION level (no trained model,
 * no ground-truth at inference). A session is a gift when it is BOTH:
 *  - coherent in itself (the user is focused on one kind of thing this session), AND
 *  - far from the user's own interest modes (it's not their own taste).
 * Demographic coherence (all items share a single non-null gender) is surfaced as
 * an explanatory signal only (does not change the decision).
 */
export function detectGiftIntent(session: SessionItem[], userModes: UserMode[], opts: GiftOpts): GiftSignal {
  const reasons: string[] = [];
  if (session.length < opts.minItems) return { isGift: false, score: 0, reasons: ["too_few_items"] };

  const vectors = session.map((s) => s.vector);
  const coherence = internalCoherence(vectors);
  const sessionCentroid = meanPool(vectors);
  const simToModes = userModes.length === 0 ? 0 : Math.max(...userModes.map((m) => cosineSim(sessionCentroid, m.medoid)));

  const coherent = coherence >= opts.minInternalCoherence;
  // Known limitation: a user with many diverse modes rarely registers as "away", so gift recall drops as mode count grows (accepted; an omnivore's gift looks like their own taste).
  const awayFromUser = userModes.length === 0 ? false : simToModes <= opts.maxSimToModes;

  const genders = new Set(session.map((s) => s.gender_target).filter((g) => g !== null));
  const demoCoherent = genders.size === 1;

  if (coherent) reasons.push("internally_coherent");
  if (awayFromUser) reasons.push("away_from_user_modes");
  if (demoCoherent) reasons.push("shared_recipient_demographics");

  const isGift = coherent && awayFromUser;
  const score = isGift ? coherence * (1 - simToModes) : 0;
  // Known false-positive: a focused self-purchase in a brand-new category looks gift-like (coherent + far from existing modes).
  return { isGift, score, reasons };
}
