import { describe, test, expect } from "vitest";
import { makeRng } from "@/thesis/data/rng";

describe("makeRng", () => {
  test("same seed yields identical sequence", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  test("different seeds diverge", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  test("next() is in [0,1)", () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  test("int(n) is in [0,n)", () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const x = r.int(5);
      expect(x >= 0 && x < 5 && Number.isInteger(x)).toBe(true);
    }
  });

  test("pick returns an element of the array", () => {
    const r = makeRng(3);
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) expect(arr.includes(r.pick(arr))).toBe(true);
  });
});
