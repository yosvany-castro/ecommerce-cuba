/**
 * Deterministic seeded RNG (mulberry32). Pure: same seed → same sequence.
 *
 * Every synthetic generator (catalog, relations, behavior) draws from a seeded
 * Rng so the entire thesis dataset is bit-for-bit reproducible from a single
 * `--seed` — a hard requirement for a defensible empirical study.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform element of `arr`. */
  pick<T>(arr: readonly T[]): T;
  /** Standard normal (mean 0, std 1) via Box–Muller. */
  gaussian(): number;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    int(n: number): number {
      return Math.floor(next() * n);
    },
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(next() * arr.length)];
    },
    gaussian(): number {
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
