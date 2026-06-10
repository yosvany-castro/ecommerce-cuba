import {
  detectGiftIntent,
  type GiftOpts,
  type SessionItem,
  type UserDemographic,
} from "@/thesis/multivector/gift-detect";

/**
 * Conservative thresholds for SUGGESTING (never auto-applying) gift mode.
 *
 * Why conservative: the F6 audit (docs/auditoria-destructiva-f6-2026-06-09.md,
 * S3·H8) measured the detector at the old production thresholds
 * {minItems: 2, coherence: 0.6}: precision ≈ 0.38-0.41 at a SYNTHETIC gift
 * prevalence of 26-30%. At realistic prevalence (~8%), Bayes gives
 * precision ≈ 13% — 7 of every 8 silent pivots to gift mode would be wrong.
 *
 * The W8 grid (scripts/thesis/f6-gift-robustness.ts) swept
 * minItems ∈ {1,2,3} × coherence ∈ {0.4..0.7}; the strictest cell
 * {minItems: 3, coherence: 0.7} is the highest-precision operating point.
 * Even there the detector is only good enough to ASK the user
 * ("¿es un regalo?"), never to pivot the ranking on its own. A confirmed
 * suggestion also produces real gift labels, which the synthetic world lacks.
 */
export const GIFT_SUGGEST_THRESHOLDS: GiftOpts = {
  minItems: 3,
  minDemographicCoherence: 0.7,
};

export interface GiftSuggestion {
  /** True ⇒ the UI may ask "¿es un regalo?". NEVER changes the ranking by itself. */
  suggest: boolean;
  /** Inferred recipient demographic to prefill the confirmation prompt. Null unless suggest. */
  recipient: { gender: string; ageBand: string | null } | null;
  /** Demographic coherence of the session in [0,1]; 0 when not suggesting. */
  confidence: number;
}

/**
 * Pure, deterministic wrapper over detectGiftIntent that turns the gift signal
 * into a UI-confirmable SUGGESTION instead of a silent ranking pivot.
 *
 * Per the audit mandate ("sugerir, no pivotar en silencio"): the only path that
 * may switch the feed to a recipient bucket is the EXPLICIT session-state one
 * (session_vectors.current_recipient_id, matched against recipients the user
 * registered — see track-hook.ts / matchRecipientOrNull). This function must
 * never be wired to write session state or alter retrieval; callers surface
 * the suggestion and only the user's confirmation may set the recipient.
 */
export function suggestGiftMode(
  session: SessionItem[],
  user: UserDemographic,
): GiftSuggestion {
  const signal = detectGiftIntent(session, user, GIFT_SUGGEST_THRESHOLDS);
  if (!signal.isGift || signal.targetGender === null) {
    return { suggest: false, recipient: null, confidence: 0 };
  }
  return {
    suggest: true,
    recipient: { gender: signal.targetGender, ageBand: signal.targetAgeBand },
    confidence: signal.score,
  };
}
