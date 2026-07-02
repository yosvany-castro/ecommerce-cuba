/**
 * Thesis evaluation metric suite — pure, side-effect-free functions.
 *
 * All metrics operate on a ranked list of predicted item IDs and a ground-truth
 * relevant set. No DB, network, Date, or Math.random calls are made here.
 *
 * Metric semantics follow the standard IR definitions used in academic work:
 *   - Positions are 0-based internally; log2 discount uses position + 2 so rank-1 = log2(2) = 1.
 *   - k is the cutoff: only the first k items in `ranked` are considered.
 *   - All functions return 0 for degenerate inputs (empty relevant set, no hits, etc.).
 */

// ─── private helpers ────────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors. Returns 0 for zero-magnitude vectors.
 */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Floor for popularity values to prevent log2(0) = -Infinity.
 * Chosen small enough not to distort realistic popularity distributions.
 */
const POPULARITY_EPSILON = 1e-9;

// ─── public metric functions ─────────────────────────────────────────────────

/**
 * Recall@k — fraction of relevant items found in the top-k ranked results.
 * Returns 0 when the relevant set is empty.
 */
export function recallAtK(
  ranked: string[],
  relevant: Set<string>,
  k: number,
): number {
  if (relevant.size === 0) return 0;
  const topK = ranked.slice(0, k);
  const hits = topK.filter((id) => relevant.has(id)).length;
  return hits / relevant.size;
}

/**
 * nDCG@k — normalized Discounted Cumulative Gain with binary relevance.
 *
 * DCG uses gain 1 for relevant items at 0-based position i with discount 1/log2(i+2).
 * IDCG is computed assuming the ideal ranking fills the first min(|relevant|, k) slots.
 * Returns 0 when IDCG is 0 (no relevant items or k=0).
 */
export function ndcgAtK(
  ranked: string[],
  relevant: Set<string>,
  k: number,
): number {
  const topK = ranked.slice(0, k);

  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevant.has(topK[i])) {
      dcg += 1 / Math.log2(i + 2); // i+2 because log2(1)=0; rank-1 gives log2(2)=1
    }
  }

  // Ideal DCG: first min(|relevant|, k) positions are all hits
  const idealHits = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * MRR — Mean Reciprocal Rank of the first relevant item in the ranked list.
 * Considers the full ranked list (no cutoff). Returns 0 if no hit is found.
 */
export function mrr(ranked: string[], relevant: Set<string>): number {
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * MAP@k — Mean Average Precision at k.
 *
 * For each relevant item found at 0-based position i among the top-k,
 * precision = (number of hits up to and including i) / (i + 1).
 * The average is taken over min(|relevant|, k) — the maximum number of
 * relevant items that could appear in the top-k window.
 * Returns 0 when the relevant set is empty.
 */
export function mapAtK(
  ranked: string[],
  relevant: Set<string>,
  k: number,
): number {
  if (relevant.size === 0) return 0;
  const topK = ranked.slice(0, k);
  let hits = 0;
  let precisionSum = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevant.has(topK[i])) {
      hits++;
      precisionSum += hits / (i + 1);
    }
  }
  const denominator = Math.min(relevant.size, k);
  return precisionSum / denominator;
}

/**
 * Hit Rate@k — 1 if any relevant item appears in the top-k; 0 otherwise.
 */
export function hitRateAtK(
  ranked: string[],
  relevant: Set<string>,
  k: number,
): number {
  const topK = ranked.slice(0, k);
  return topK.some((id) => relevant.has(id)) ? 1 : 0;
}

/**
 * Complement Recall@k — fraction of known complement items found in the top-k.
 *
 * Semantically identical to recallAtK; named separately for clarity in
 * complement-recommendation evaluation contexts.
 */
export function complementRecallAtK(
  ranked: string[],
  complements: Set<string>,
  k: number,
): number {
  return recallAtK(ranked, complements, k);
}

/**
 * Intra-List Diversity — 1 minus the average pairwise cosine similarity of
 * the embedding vectors of the ranked items.
 *
 * A value of 1 means all pairs are orthogonal (maximally diverse);
 * 0 means all items are identical in embedding space.
 * Returns 0 when fewer than 2 vectors are provided.
 */
export function intraListDiversity(vectors: number[][]): number {
  if (vectors.length < 2) return 0;
  let totalSimilarity = 0;
  let pairCount = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      totalSimilarity += cosine(vectors[i], vectors[j]);
      pairCount++;
    }
  }
  const avgSimilarity = totalSimilarity / pairCount;
  return 1 - avgSimilarity;
}

/**
 * Novelty@k — mean self-information of items in the top-k, measured via popularity.
 *
 * For each item, novelty = −log2(max(POPULARITY_EPSILON, popularity)).
 * Items absent from the popularity map are treated as having popularity = POPULARITY_EPSILON
 * (maximally novel). Returns 0 when the top-k window is empty.
 *
 * @param popularity  Map from item ID to its popularity in [0, 1].
 */
export function novelty(
  ranked: string[],
  popularity: Map<string, number>,
  k: number,
): number {
  const topK = ranked.slice(0, k);
  if (topK.length === 0) return 0;
  const totalNovelty = topK.reduce((sum, id) => {
    const pop = Math.max(POPULARITY_EPSILON, popularity.get(id) ?? POPULARITY_EPSILON);
    return sum + -Math.log2(pop);
  }, 0);
  return totalNovelty / topK.length;
}

/** Demographic targeting of a catalog item (from product metadata). */
export interface ItemDemographics {
  gender_target: string | null;
  age_min: number;
  age_max: number;
}

/** The recipient a gift session is for (from sim_user_recipients ground truth). */
export interface RecipientProfile {
  gender: string;
  age_min: number;
  age_max: number;
}

/**
 * Recipient-fit@k: fraction of the top-k whose demographic targeting matches the
 * gift recipient. An item fits when (a) its gender_target is null/unisex OR equals
 * the recipient's gender, AND (b) its age band overlaps the recipient's age range.
 * Measures whether a gift feed actually targets the right person. Denominator is
 * min(k, ranked.length).
 *
 * Comparable across rankers ONLY when they return equal-length lists (denominator
 * is min(k, ranked.length)); the F2 study guarantees this by ranking the same full
 * candidate permutation.
 */
export function recipientFitAtK(
  ranked: string[],
  recipient: RecipientProfile,
  demographics: Record<string, ItemDemographics>,
  k: number,
): number {
  const top = ranked.slice(0, k);
  if (top.length === 0) return 0;
  let fit = 0;
  for (const id of top) {
    const d = demographics[id];
    if (!d) continue;
    const genderOk = d.gender_target === null || d.gender_target === "unisex" || d.gender_target === recipient.gender;
    const ageOk = d.age_min <= recipient.age_max && d.age_max >= recipient.age_min;
    if (genderOk && ageOk) fit++;
  }
  return fit / top.length;
}

/**
 * Set-change@k: fraction of the reranked top-k that is NOT in the base top-k.
 * Measures how much a reranker actually changes membership of the top-k (set,
 * not order) versus the base ordering. 0 = same items, 1 = fully replaced.
 * Directly answers "does the reranker change the set?". Denominator = min(k, reranked.length).
 */
export function setChangeAtK(reranked: string[], base: string[], k: number): number {
  const top = reranked.slice(0, k);
  if (top.length === 0) return 0;
  const baseSet = new Set(base.slice(0, k));
  let changed = 0;
  for (const id of top) if (!baseSet.has(id)) changed++;
  return changed / top.length;
}

/**
 * Revenue@k: total expected revenue (GMV) of the top-k. `revenueById` maps a
 * product id to its expected revenue (P(buy)·price·margin); missing → 0. The
 * business counterpart to nDCG — what the feed is expected to earn.
 */
export function revenueAtK(ranked: string[], revenueById: Map<string, number>, k: number): number {
  let total = 0;
  for (const id of ranked.slice(0, k)) total += revenueById.get(id) ?? 0;
  return total;
}

/**
 * Gini coefficient of seller exposure in the top-k (0 = every seller equally
 * exposed, →1 = one seller dominates). Fairness guardrail: lower is fairer.
 * A single-seller slate of length>1 is maximal concentration (returns 1−1/len).
 */
export function sellerExposureGini(ranked: string[], sellerById: Map<string, string>, k: number): number {
  const top = ranked.slice(0, k);
  if (top.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const id of top) {
    const s = sellerById.get(id);
    if (s === undefined) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const values = [...counts.values()].sort((a, b) => a - b);
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return top.length > 1 ? 1 - 1 / top.length : 0;
  const sum = values.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  // Gini = (2·Σ i·x_i)/(n·Σ x_i) − (n+1)/n , i 1-based over ascending values
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * values[i];
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}
