import { describe, test, expect } from "vitest";
import { buildUserModes } from "@/thesis/multivector/modes";
import { cosineSim } from "@/thesis/embedders/space";

describe("buildUserModes (Ward + medoids)", () => {
  // Two orthogonal tastes: cluster A near x-axis, cluster B near y-axis.
  const history = [
    [1, 0, 0], [0.97, 0.02, 0], [0.95, 0.05, 0],     // A (3)
    [0, 1, 0], [0.02, 0.98, 0],                       // B (2)
  ];

  test("recovers two modes for a clearly bimodal history", () => {
    const modes = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });
    expect(modes.length).toBe(2);
  });

  test("mode weights are the cluster size fractions and sum to 1", () => {
    const modes = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });
    const total = modes.reduce((s, m) => s + m.weight, 0);
    expect(total).toBeCloseTo(1, 9);
    const sorted = [...modes].sort((a, b) => b.weight - a.weight);
    expect(sorted[0].weight).toBeCloseTo(0.6, 9);
    expect(sorted[1].weight).toBeCloseTo(0.4, 9);
  });

  test("each medoid is one of the history vectors (a real item, not a centroid)", () => {
    const modes = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });
    for (const m of modes) {
      expect(history.some((h) => h.every((x, i) => x === m.medoid[i]))).toBe(true);
    }
  });

  test("modes point at the two distinct tastes", () => {
    const modes = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });
    const simToX = modes.map((m) => cosineSim(m.medoid, [1, 0, 0]));
    const simToY = modes.map((m) => cosineSim(m.medoid, [0, 1, 0]));
    expect(Math.max(...simToX)).toBeGreaterThan(0.9);
    expect(Math.max(...simToY)).toBeGreaterThan(0.9);
  });

  test("single item → single mode weight 1; empty → []", () => {
    expect(buildUserModes([[1, 2, 3]], { distanceThreshold: 0.5, maxModes: 5 })).toEqual([
      { medoid: [1, 2, 3], weight: 1, size: 1 },
    ]);
    expect(buildUserModes([], { distanceThreshold: 0.5, maxModes: 5 })).toEqual([]);
  });

  test("maxModes caps the number of modes", () => {
    const modes = buildUserModes(history, { distanceThreshold: 0.0001, maxModes: 2 });
    expect(modes.length).toBeLessThanOrEqual(2);
  });

  test("deterministic for the same input", () => {
    const a = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });
    const b = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });
    expect(a).toEqual(b);
  });
});
