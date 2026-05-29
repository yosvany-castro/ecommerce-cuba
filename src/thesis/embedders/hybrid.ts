import { l2normalize, cosineSim } from "./space";
import type { Ranker, RankItem, UserContext } from "../types";

/**
 * E2 hybrid: blends the text vector (good for cold-start / new items) with the
 * behavioral Prod2Vec vector (good once an item has interaction history). The
 * gate weight on TEXT is alpha = kappa/(kappa + nInteractions): text dominates
 * when the item is cold, behaviour takes over as it warms. Result re-normalized.
 */
export function hybridAlpha(nInteractions: number, kappa: number): number {
  return kappa / (kappa + nInteractions);
}

export function hybridVector(
  textVec: number[],
  behavVec: number[] | null,
  nInteractions: number,
  kappa: number,
): number[] {
  const t = l2normalize(textVec);
  if (!behavVec) return t;
  const b = l2normalize(behavVec);
  const a = hybridAlpha(nInteractions, kappa);
  const d = Math.min(t.length, b.length);
  const mix = new Array<number>(d);
  for (let i = 0; i < d; i++) mix[i] = a * t[i] + (1 - a) * b[i];
  return l2normalize(mix);
}

/**
 * E2 as SCORE-LEVEL fusion (dimension-safe): blend the text cosine and the
 * behavioral cosine, each computed in its OWN space (text 1024-d, behaviour 64-d
 * — never mixed component-wise). Per-item gate alpha = kappa/(kappa+popularity):
 * cold/rare items lean on text, popular items lean on behaviour. Candidates with
 * no behavioral vector fall back to text cosine only. Pure; deterministic
 * (tie-break by id).
 */
export function hybridScoreFusionRanker(opts: {
  textUser: number[];
  behavUser: number[] | null;
  textItem: Map<string, number[]>;
  behavItem: Map<string, number[]>;
  popOf: (id: string) => number;
  kappa: number;
}): Ranker {
  return {
    name: "e2-hybrid-fusion",
    rank(_ctx: UserContext, candidates: RankItem[]): string[] {
      return candidates
        .map((c) => {
          const tv = opts.textItem.get(c.id);
          const tcos = tv ? cosineSim(opts.textUser, tv) : 0;
          const bv = opts.behavItem.get(c.id);
          let score = tcos;
          if (opts.behavUser && bv) {
            const a = opts.kappa / (opts.kappa + opts.popOf(c.id));
            score = a * tcos + (1 - a) * cosineSim(opts.behavUser, bv);
          }
          return { id: c.id, score };
        })
        .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
        .map((x) => x.id);
    },
  };
}
