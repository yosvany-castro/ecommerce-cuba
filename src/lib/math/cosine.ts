/**
 * Cosine similarity. Returns 0 if either vector is zero (defined non-NaN behavior).
 * Throws on dimension mismatch.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    sa += a[i] * a[i];
    sb += b[i] * b[i];
  }
  if (sa === 0 || sb === 0) return 0;
  return dot / Math.sqrt(sa * sb);
}
