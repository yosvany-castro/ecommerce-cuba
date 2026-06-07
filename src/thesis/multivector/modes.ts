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

/**
 * Average-linkage agglomerative clustering with cosine distance (the standard,
 * deterministic choice for unit-ish embeddings; matches PinnerSage's spirit of
 * conceptually-coherent interest clusters). History is small (tens of items per
 * user) so O(n^2) per merge is fine. Each cluster is summarized by its medoid.
 */
export function buildUserModes(history: number[][], opts: ModeOpts): UserMode[] {
  const n = history.length;
  if (n === 0) return [];
  if (n === 1) return [{ medoid: history[0], weight: 1, size: 1 }];

  let clusters: number[][] = history.map((_, i) => [i]);

  const avgLinkage = (c1: number[], c2: number[]): number => {
    let s = 0;
    for (const i of c1) for (const j of c2) s += cosineDistance(history[i], history[j]);
    return s / (c1.length * c2.length);
  };

  while (clusters.length > 1) {
    let bestI = 0, bestJ = 1, bestD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = avgLinkage(clusters[i], clusters[j]);
        if (d < bestD - 1e-12) { bestD = d; bestI = i; bestJ = j; }
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
      if (tot < best - 1e-12) { best = tot; medoidIdx = i; }
    }
    return { medoid: history[medoidIdx], weight: idxs.length / n, size: idxs.length };
  });
  // stable order: largest cluster first, then by medoid first component
  return modes.sort((a, b) => b.size - a.size || a.medoid[0] - b.medoid[0]);
}
