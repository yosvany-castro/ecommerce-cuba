import { kmeans } from "ml-kmeans";
import { cosine } from "@/lib/math";

export interface KMeansInput {
  points: number[][];
  weights: number[];
  k: number;
}

export interface KMeansOutput {
  centroids: number[][];
  cluster_of_point: number[];
}

const SCALE = 10;
const MAX_TOTAL_REPLICAS = 5000;

/**
 * Wraps ml-kmeans with weight support (via replication) and cosine distance.
 *
 * ml-kmeans does not support sample weights natively; we approximate by
 * replicating each point ceil(weight * SCALE) times, capped at MAX_TOTAL_REPLICAS.
 */
export function runKMeans(input: KMeansInput): KMeansOutput {
  if (input.points.length === 0) {
    return { centroids: [], cluster_of_point: [] };
  }
  if (input.k <= 0) throw new Error("k must be > 0");
  const k = Math.min(input.k, input.points.length);

  const expanded: number[][] = [];
  const originalIndex: number[] = [];
  let total = 0;
  for (let i = 0; i < input.points.length; i++) {
    const w = Math.max(0, input.weights[i] ?? 1);
    const reps = Math.max(1, Math.ceil(w * SCALE));
    for (let j = 0; j < reps && total < MAX_TOTAL_REPLICAS; j++) {
      expanded.push(input.points[i]);
      originalIndex.push(i);
      total++;
    }
  }

  const result = kmeans(expanded, k, {
    initialization: "kmeans++",
    maxIterations: 100,
    distanceFunction: (a: number[], b: number[]) => 1 - cosine(a, b),
  });

  const clusterOfPoint = new Array<number>(input.points.length).fill(-1);
  for (let i = 0; i < expanded.length; i++) {
    const origIdx = originalIndex[i];
    if (clusterOfPoint[origIdx] === -1) {
      clusterOfPoint[origIdx] = result.clusters[i];
    }
  }

  return {
    centroids: result.centroids as number[][],
    cluster_of_point: clusterOfPoint,
  };
}
