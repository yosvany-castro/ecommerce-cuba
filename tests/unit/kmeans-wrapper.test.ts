import { describe, test, expect } from "vitest";
import { runKMeans } from "@/sectors/d-personalization/vector/kmeans";
import { normalize, cosine } from "@/lib/math";

function makePoint(seedVector: number[], jitter: number, rngSeed: number): number[] {
  const r = (n: number) => {
    let h = (rngSeed + n) | 0;
    h = (h * 1664525 + 1013904223) >>> 0;
    return ((h & 0xffff) / 0xffff - 0.5) * jitter;
  };
  return seedVector.map((v, i) => v + r(i));
}

describe("runKMeans", () => {
  test("clusters 2 well-separated groups correctly", () => {
    const A = Array.from({ length: 10 }, (_, i) =>
      makePoint([1, 0, 0, 0], 0.05, i + 1),
    );
    const B = Array.from({ length: 10 }, (_, i) =>
      makePoint([0, 1, 0, 0], 0.05, 100 + i),
    );
    const points = [...A, ...B];
    const weights = points.map(() => 1);
    const out = runKMeans({ points, weights, k: 2 });
    expect(out.centroids.length).toBe(2);
    expect(out.cluster_of_point.length).toBe(20);
    const aClusters = new Set(out.cluster_of_point.slice(0, 10));
    const bClusters = new Set(out.cluster_of_point.slice(10));
    expect(aClusters.size).toBe(1);
    expect(bClusters.size).toBe(1);
    expect([...aClusters][0]).not.toBe([...bClusters][0]);
  });

  test("k=1 returns single centroid close to mean direction", () => {
    const points = [
      [1, 0, 0, 0],
      [0.9, 0.1, 0, 0],
      [0.95, 0.05, 0, 0],
    ];
    const weights = [1, 1, 1];
    const out = runKMeans({ points, weights, k: 1 });
    expect(out.centroids.length).toBe(1);
    const c = cosine(normalize(out.centroids[0]), [1, 0, 0, 0]);
    expect(c).toBeGreaterThan(0.95);
  });

  test("respects weights — high-weight outlier dominates centroid in k=1", () => {
    const points = [
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ];
    const weights = [1, 1, 100];
    const out = runKMeans({ points, weights, k: 1 });
    const c = cosine(normalize(out.centroids[0]), [0, 1, 0, 0]);
    expect(c).toBeGreaterThan(0.8);
  });

  test("k > n returns valid output (clamped to n clusters)", () => {
    const points = [[1, 0]];
    const weights = [1];
    const out = runKMeans({ points, weights, k: 3 });
    expect(out.cluster_of_point.length).toBe(1);
    expect(out.centroids.length).toBeLessThanOrEqual(1);
  });
});
