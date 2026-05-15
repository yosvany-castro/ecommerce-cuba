import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { cosine } from "@/lib/math/cosine";
import { normalize } from "@/lib/math/normalize";

describe("cosine", () => {
  it("identical unit vectors → 1", () => {
    const v = normalize([3, 4, 0]);
    expect(cosine(v, v)).toBeCloseTo(1, 9);
  });

  it("orthogonal unit vectors → 0", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 9);
  });

  it("opposite unit vectors → -1", () => {
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 9);
  });

  it("zero vector cosine returns 0 (defined behavior, no NaN)", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("dimension mismatch throws", () => {
    expect(() => cosine([1, 2], [1, 2, 3])).toThrow();
  });

  it("property: cosine is symmetric", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -10, max: 10, noNaN: true }), { minLength: 2, maxLength: 256 }),
        fc.array(fc.float({ min: -10, max: 10, noNaN: true }), { minLength: 2, maxLength: 256 }),
        (a, b) => {
          if (a.length !== b.length) return; // skip mismatched
          if (a.every((x) => x === 0) || b.every((x) => x === 0)) return;
          const ab = cosine(a, b);
          const ba = cosine(b, a);
          expect(Math.abs(ab - ba)).toBeLessThan(1e-9);
        },
      ),
    );
  });

  it("property: cosine ∈ [-1, 1] within float tolerance", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -10, max: 10, noNaN: true }), { minLength: 2, maxLength: 256 }),
        fc.array(fc.float({ min: -10, max: 10, noNaN: true }), { minLength: 2, maxLength: 256 }),
        (a, b) => {
          if (a.length !== b.length) return;
          if (a.every((x) => x === 0) || b.every((x) => x === 0)) return;
          const c = cosine(a, b);
          expect(c).toBeGreaterThanOrEqual(-1 - 1e-9);
          expect(c).toBeLessThanOrEqual(1 + 1e-9);
        },
      ),
    );
  });
});
