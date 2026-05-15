/** L2-normalize a vector. Zero vectors return a zero vector (not NaN). */
export function normalize(v: readonly number[]): number[] {
  const sumSq = v.reduce((s, x) => s + x * x, 0);
  if (sumSq === 0) return v.slice() as number[];
  const inv = 1 / Math.sqrt(sumSq);
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}
