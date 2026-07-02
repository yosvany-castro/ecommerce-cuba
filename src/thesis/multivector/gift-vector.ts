import { l2normalize, meanPool } from "../embedders/space";

/**
 * Build the EPHEMERAL recipient vector for a gift session: the L2-normalized mean
 * of the items the shopper is looking at this session. It represents intent toward
 * the recipient in the embedding space and is used ONLY for this request's
 * ranking — it is never written to the user's persistent modes (which is what
 * prevents gift history from poisoning the buyer's own profile).
 */
export function buildRecipientVector(sessionItemVectors: number[][]): number[] {
  if (sessionItemVectors.length === 0) return [];
  return l2normalize(meanPool(sessionItemVectors));
}
