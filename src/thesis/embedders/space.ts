/**
 * Shared contracts + math for the F1 embedding study. Every single-vector
 * embedder (E0,E1,E2,E3,E5) implements EmbeddingSpace; the late-interaction
 * embedder (E4) implements MultiVectorSpace. The study runner turns either into
 * F0 EvalCases and scores them with the shared eval harness.
 */
export interface EmbeddingSpace {
  name: string;
  /** Item vector for ranking; null if this item has no representation. */
  itemVector(productId: string): number[] | null;
  /** User/query vector from the user's TRAIN item ids; null if underivable. */
  userVector(trainItemIds: string[]): number[] | null;
}

export interface MultiVectorSpace {
  name: string;
  itemChunks(productId: string): number[][] | null;
  queryChunks(trainItemIds: string[]): number[][] | null;
}

export function l2normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  if (n === 0) return v.slice();
  return v.map((x) => x / n);
}

export function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const d = vectors[0].length;
  const out = new Array<number>(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) out[i] += v[i];
  return out.map((x) => x / vectors.length);
}

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const m = Math.min(a.length, b.length);
  for (let i = 0; i < m; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den === 0 ? 0 : dot / den;
}
