import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { normalize } from "@/lib/math/normalize";

describe("normalize", () => {
  it("zero vector returns zero vector (no NaN)", () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("unit vector is preserved", () => {
    expect(normalize([1, 0, 0])).toEqual([1, 0, 0]);
  });

  it("scalar multiple of unit vector normalizes to it", () => {
    const n = normalize([5, 0, 0]);
    expect(n[0]).toBeCloseTo(1, 9);
    expect(n[1]).toBe(0);
    expect(n[2]).toBe(0);
  });

  it("property: any non-zero vector normalizes to unit norm", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -100, max: 100, noNaN: true }), { minLength: 2, maxLength: 1024 }),
        (raw) => {
          if (raw.every((x) => x === 0)) return; // skip zero
          const n = normalize(raw);
          const norm = Math.sqrt(n.reduce((s, x) => s + x * x, 0));
          expect(Math.abs(norm - 1)).toBeLessThan(1e-9);
        },
      ),
    );
  });
});
