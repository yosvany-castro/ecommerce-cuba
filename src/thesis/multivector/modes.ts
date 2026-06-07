import { cosineSim } from "../embedders/space";

/**
 * One interest mode of a user: a representative real item (medoid), the fraction
 * of the user's history it covers (weight), and the cluster size. PinnerSage
 * (Pal et al., KDD'20): cluster the history, summarize each cluster by its medoid
 * (interpretable) rather than a centroid (a possibly-empty point in space).
 */
export interface UserMode {
  medoid: number[];
  weight: number;
  size: number;
}

export interface ModeOpts {
  /** Agglomerative cut: stop merging once the closest pair's distance exceeds this. */
  distanceThreshold: number;
  /** Hard cap on the number of modes (forces merging past the threshold if needed). */
  maxModes: number;
}

/** Cosine DISTANCE in [0,2]; 0 = identical direction. */
function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSim(a, b);
}

/** Lexicographic vector comparison: componentwise, then by length (shorter first). */
function lexCompare(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/**
 * Average-linkage agglomerative clustering with cosine distance (the standard,
 * deterministic choice for unit-ish embeddings; matches PinnerSage's spirit of
 * conceptually-coherent interest clusters). History is small (tens of items per
 * user) so O(n^2) per merge is fine. Each cluster is summarized by its medoid.
 *
 * Order-invariant: result depends only on the set of history vectors, not their
 * input order (canonical sort + value-based tie-breaks).
 */
export function buildUserModes(historyIn: number[][], opts: ModeOpts): UserMode[] {
  const n = historyIn.length;
  if (n === 0) return [];
  if (n === 1) return [{ medoid: historyIn[0], weight: 1, size: 1 }];

  // Canonical, value-determined order so array-position tie-breaks below become
  // value-based (and thus independent of the caller's input order).
  const history = [...historyIn].sort(lexCompare);

  let clusters: number[][] = history.map((_, i) => [i]);

  const avgLinkage = (c1: number[], c2: number[]): number => {
    let s = 0;
    for (const i of c1) for (const j of c2) s += cosineDistance(history[i], history[j]);
    return s / (c1.length * c2.length);
  };

  // Representative (lexicographically smallest) vector of a cluster, for tie-breaks.
  const clusterRep = (idxs: number[]): number[] => {
    let rep = history[idxs[0]];
    for (const i of idxs) if (lexCompare(history[i], rep) < 0) rep = history[i];
    return rep;
  };

  while (clusters.length > 1) {
    let bestI = 0, bestJ = 1, bestD = Infinity;
    let bestRep: number[] | null = null;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = avgLinkage(clusters[i], clusters[j]);
        if (d < bestD - 1e-12) {
          bestD = d; bestI = i; bestJ = j;
          bestRep = clusterRep([...clusters[i], ...clusters[j]]);
        } else if (Math.abs(d - bestD) <= 1e-12) {
          // Value-based tie-break: prefer the pair whose merged representative is
          // lexicographically smaller (deterministic regardless of input order).
          const rep = clusterRep([...clusters[i], ...clusters[j]]);
          if (bestRep === null || lexCompare(rep, bestRep) < 0) {
            bestD = d; bestI = i; bestJ = j; bestRep = rep;
          }
        }
      }
    }
    // stop only when the closest pair is far enough AND we are within the cap
    if (bestD > opts.distanceThreshold && clusters.length <= opts.maxModes) break;
    const merged = [...clusters[bestI], ...clusters[bestJ]];
    clusters = clusters.filter((_, k) => k !== bestI && k !== bestJ);
    clusters.push(merged);
  }

  const modes: UserMode[] = clusters.map((idxs) => {
    let medoidIdx = idxs[0], best = Infinity;
    for (const i of idxs) {
      let tot = 0;
      for (const j of idxs) tot += cosineDistance(history[i], history[j]);
      if (tot < best - 1e-12) {
        best = tot; medoidIdx = i;
      } else if (Math.abs(tot - best) <= 1e-12 && lexCompare(history[i], history[medoidIdx]) < 0) {
        // Value-based tie-break: lexicographically-smaller vector wins.
        medoidIdx = i;
      }
    }
    return { medoid: history[medoidIdx], weight: idxs.length / n, size: idxs.length };
  });
  // stable order: largest cluster first, then by full lexicographic medoid value.
  return modes.sort((a, b) => b.size - a.size || lexCompare(a.medoid, b.medoid));
}
