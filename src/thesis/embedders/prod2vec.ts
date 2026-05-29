import { makeRng } from "../data/rng";
import { l2normalize } from "./space";

/**
 * Prod2Vec (Item2Vec / skip-gram with negative sampling, Barkan & Koenigstein
 * 2016) trained on session item-sequences. Pure TS, CPU-only — no GPU/torch.
 * Items that co-occur in sessions end up close in the learned space, capturing
 * COMMERCIAL relatedness that text embeddings miss. Deterministic given `seed`.
 */
export interface Prod2VecOpts {
  dim: number;
  epochs: number;
  window: number;
  negatives: number;
  seed: number;
  lr?: number; // initial learning rate (default 0.025, linearly decayed)
}

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

export function trainProd2Vec(sequences: string[][], opts: Prod2VecOpts): Map<string, number[]> {
  const rng = makeRng(opts.seed);
  const lr0 = opts.lr ?? 0.025;

  // Vocabulary + unigram^0.75 negative-sampling table (word2vec style).
  const counts = new Map<string, number>();
  for (const seq of sequences) for (const id of seq) counts.set(id, (counts.get(id) ?? 0) + 1);
  const vocab = [...counts.keys()].sort(); // deterministic order
  const idx = new Map(vocab.map((id, i) => [id, i]));
  const V = vocab.length;
  const negTable: number[] = [];
  for (let i = 0; i < V; i++) {
    const w = Math.pow(counts.get(vocab[i])!, 0.75);
    const reps = Math.max(1, Math.round(w * 100));
    for (let r = 0; r < reps; r++) negTable.push(i);
  }

  // Init input (center) + output (context) matrices, small random from the seeded RNG.
  const initMat = (): number[][] =>
    Array.from({ length: V }, () => Array.from({ length: opts.dim }, () => (rng.next() - 0.5) / opts.dim));
  const inVec = initMat();
  const outVec = initMat();

  const totalPairs = sequences.reduce((s, seq) => s + seq.length, 0) * opts.epochs;
  let trained = 0;

  for (let e = 0; e < opts.epochs; e++) {
    for (const seq of sequences) {
      for (let t = 0; t < seq.length; t++) {
        const center = idx.get(seq[t])!;
        const lr = Math.max(lr0 * 0.0001, lr0 * (1 - trained / Math.max(1, totalPairs)));
        const lo = Math.max(0, t - opts.window);
        const hi = Math.min(seq.length - 1, t + opts.window);
        for (let c = lo; c <= hi; c++) {
          if (c === t) continue;
          const ctx = idx.get(seq[c])!;
          const targets: [number, number][] = [[ctx, 1]];
          for (let n = 0; n < opts.negatives; n++) {
            const neg = negTable[rng.int(negTable.length)];
            if (neg !== ctx) targets.push([neg, 0]);
          }
          const ci = inVec[center];
          const grad = new Array<number>(opts.dim).fill(0);
          for (const [target, label] of targets) {
            const oj = outVec[target];
            let dot = 0;
            for (let k = 0; k < opts.dim; k++) dot += ci[k] * oj[k];
            const g = (label - sigmoid(dot)) * lr;
            for (let k = 0; k < opts.dim; k++) {
              grad[k] += g * oj[k];
              oj[k] += g * ci[k];
            }
          }
          for (let k = 0; k < opts.dim; k++) ci[k] += grad[k];
        }
        trained++;
      }
    }
  }

  const out = new Map<string, number[]>();
  for (let i = 0; i < V; i++) out.set(vocab[i], l2normalize(inVec[i]));
  return out;
}
