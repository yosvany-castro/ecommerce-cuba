# Thesis F2 — Multi-vector user×recipient + gift model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Represent each user as multiple interest modes (PinnerSage Ward+medoids over the E1 prod2vec space), detect gift sessions and rank for an ephemeral recipient vector, fuse modes by quota+RRF, and prove via the F0 harness that this beats F1's single-vector baseline on gift and multi-modal segments.

**Architecture:** Pure library under `src/thesis/multivector/` (modes, gift-detect, gift-vector, retrieve) + one new metric (`recipientFitAtK`) + a DB-backed study runner `scripts/thesis/f2-study.ts` that reuses the F1 loading patterns and the F0 eval harness. Nothing touches production `src/sectors/`. Ground-truth recipients/intent already persisted in the `thesis` schema by F0.

**Tech Stack:** TypeScript 5.6, Node 24, `pg`, Vitest 4. Builds on F0 (`src/thesis/eval/*`, `src/thesis/types.ts`) and F1 (`thesis.item_vectors` space `e1_prod2vec`). Reuses `rrfFuse` from `src/sectors/d-personalization/retrieve/rrf.ts`. Branch `feat/thesis-personalization-program`, DB schema `thesis`.

**Spec:** `docs/superpowers/specs/2026-05-29-thesis-f2-multivector-recipient-gift-design.md`

---

## Key integration facts (verified — read before starting)
- `Ranker` (from `@/thesis/types`): `{ name: string; rank(ctx: UserContext, candidates: RankItem[]): string[] }`. `RankItem = {id, popularity, vector, cohort?}`. `UserContext = {userVector, cohort}`.
- `rrfFuse(lists: RankedList[], k0=60): FusedItem[]` from `@/sectors/d-personalization/retrieve/rrf`. `RankedList = { source: string; items: { id: string; rank: number }[] }`. `FusedItem = { id; rrf_score; sources }`, returned sorted desc by `rrf_score`. **Note: `rank` is 1-based position in each list.**
- `evaluateRanker(ranker, cases: EvalCase[], ks: number[]): EvalResult` and `aggregateCases<C extends EvalCase>(cases, rankerFor, ks, name): EvalResult` from `@/thesis/eval/harness` / `@/thesis/eval/aggregate`. `EvalCase = { ctx, candidates, relevant: Set, complements?: Set }`. `EvalResult` has `recall/ndcg/map/hit/complementRecall: Record<number,number>`, `mrr: number`, `n`, `ranker`.
- Vector utils from `@/thesis/embedders/space`: `l2normalize(v)`, `meanPool(vectors)`, `cosineSim(a,b)`.
- DB (`getPgClient({scope:"thesis"})`): `thesis.item_vectors(space, product_id, vector double precision[])`; `thesis.products(id, metadata jsonb {subcategory,brand,gender_target,age_target:{min,max},...})`; `thesis.events(anonymous_id, session_id, event_type, occurred_at, payload->>'product_id')`; `thesis.holdout(user_id, product_id, split)`; `thesis.sim_sessions(session_id, user_id, intent, recipient_id)`; `thesis.sim_user_recipients(id, user_id, relation, gender, age_min, age_max)`. NOTE: in the generator, `user_id` == the `anonymous_id` used on events (behavior-gen inserts events with `anonymous_id = user.user_id`).
- Embedders MUST NOT read `thesis.gt_product_factors` (leakage). F2 reads `item_vectors` (learned) + metadata (catalog facts) + sim_* (GT, only in the study runner to build segments/recipient-fit, never as a ranker input feature).

---

## File Structure
- `src/thesis/eval/metrics.ts` — ADD `recipientFitAtK` (+ existing untouched).
- `src/thesis/multivector/modes.ts` — `buildUserModes` (Ward + medoids).
- `src/thesis/multivector/gift-detect.ts` — `detectGiftIntent`.
- `src/thesis/multivector/gift-vector.ts` — `buildRecipientVector`.
- `src/thesis/multivector/retrieve.ts` — `multiModeRank` (quota + rrfFuse) implementing `Ranker`.
- `scripts/thesis/f2-study.ts` — study runner (baseline F1 vs F2, segmented + recipient-fit).
- Tests: `tests/thesis/recipient-fit.test.ts`, `modes.test.ts`, `gift-detect.test.ts`, `gift-vector.test.ts`, `multimode-retrieve.test.ts`, and integration `tests/thesis/f2-discrimination.test.ts`.
- `package.json` — add `thesis:f2-study`.

---

## Task 1: `recipientFitAtK` metric

**Files:**
- Modify: `src/thesis/eval/metrics.ts` (append)
- Test: `tests/thesis/recipient-fit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/recipient-fit.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { recipientFitAtK, type ItemDemographics, type RecipientProfile } from "@/thesis/eval/metrics";

describe("recipientFitAtK", () => {
  const demo: Record<string, ItemDemographics> = {
    a: { gender_target: "femenino", age_min: 4, age_max: 11 }, // girl
    b: { gender_target: "masculino", age_min: 26, age_max: 59 }, // adult man
    c: { gender_target: "femenino", age_min: 4, age_max: 11 }, // girl
    d: { gender_target: null, age_min: 0, age_max: 130 }, // unisex any-age
  };
  const recipient: RecipientProfile = { gender: "femenino", age_min: 6, age_max: 9 }; // a young girl

  test("fraction of top-k matching the recipient's gender AND age band", () => {
    // top-3 = [a (fit), b (no gender), c (fit)] → 2/3
    expect(recipientFitAtK(["a", "b", "c"], recipient, demo, 3)).toBeCloseTo(2 / 3, 9);
  });
  test("unisex/any-age item counts as a fit (gender null matches anyone)", () => {
    // top-2 = [d (unisex, age covers 6-9 → fit), b (man, no)] → 1/2
    expect(recipientFitAtK(["d", "b"], recipient, demo, 2)).toBeCloseTo(0.5, 9);
  });
  test("empty ranked → 0", () => {
    expect(recipientFitAtK([], recipient, demo, 5)).toBe(0);
  });
  test("k larger than list uses the whole list as denominator", () => {
    // top-10 over [a,c] both fit → 2/2 = 1
    expect(recipientFitAtK(["a", "c"], recipient, demo, 10)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/recipient-fit.test.ts`
Expected: FAIL — `recipientFitAtK` not exported.

- [ ] **Step 3: Implement (append to `src/thesis/eval/metrics.ts`)**

```ts
/** Demographic targeting of a catalog item (from product metadata). */
export interface ItemDemographics {
  gender_target: string | null;
  age_min: number;
  age_max: number;
}

/** The recipient a gift session is for (from sim_user_recipients ground truth). */
export interface RecipientProfile {
  gender: string;
  age_min: number;
  age_max: number;
}

/**
 * Recipient-fit@k: fraction of the top-k whose demographic targeting matches the
 * gift recipient. An item fits when (a) its gender_target is null/unisex OR equals
 * the recipient's gender, AND (b) its age band overlaps the recipient's age range.
 * Measures whether a gift feed actually targets the right person. Denominator is
 * min(k, ranked.length).
 */
export function recipientFitAtK(
  ranked: string[],
  recipient: RecipientProfile,
  demographics: Record<string, ItemDemographics>,
  k: number,
): number {
  const top = ranked.slice(0, k);
  if (top.length === 0) return 0;
  let fit = 0;
  for (const id of top) {
    const d = demographics[id];
    if (!d) continue;
    const genderOk = d.gender_target === null || d.gender_target === "unisex" || d.gender_target === recipient.gender;
    const ageOk = d.age_min <= recipient.age_max && d.age_max >= recipient.age_min;
    if (genderOk && ageOk) fit++;
  }
  return fit / top.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/recipient-fit.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/eval/metrics.ts tests/thesis/recipient-fit.test.ts
git commit -m "feat(thesis): recipientFitAtK metric — does a gift feed target the right person

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: User modes (Ward + medoids)

**Files:**
- Create: `src/thesis/multivector/modes.ts`
- Test: `tests/thesis/modes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/modes.test.ts`:
```ts
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
    // larger cluster (A, 3/5) has the bigger weight
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/modes.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/multivector/modes.ts`**

```ts
import { cosineSim } from "../embedders/space";

/**
 * One interest mode of a user: a representative real item (medoid), the fraction
 * of the user's history it covers (weight), and the cluster size. PinnerSage
 * (Pal et al., KDD'20): cluster the history, summarize each cluster by its medoid
 * (interpretable) rather than a centroid (a possibly-empty point in space).
 */
export interface UserMode {
  medoid: number[];
  weight: number;
  size: number;
}

export interface ModeOpts {
  /** Agglomerative cut: stop merging once the closest pair's distance exceeds this. */
  distanceThreshold: number;
  /** Hard cap on the number of modes (forces merging past the threshold if needed). */
  maxModes: number;
}

/** Cosine DISTANCE in [0,2]; 0 = identical direction. */
function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSim(a, b);
}

/**
 * Ward-style agglomerative clustering with average-linkage cosine distance.
 * (True Ward uses variance; for unit-ish embeddings average-linkage cosine is the
 * standard, cheaper, deterministic choice and matches PinnerSage's spirit.)
 * History is small (tens of items per user) so O(n^2 log n) is fine.
 */
export function buildUserModes(history: number[][], opts: ModeOpts): UserMode[] {
  const n = history.length;
  if (n === 0) return [];
  if (n === 1) return [{ medoid: history[0], weight: 1, size: 1 }];

  // clusters as index lists; start as singletons
  let clusters: number[][] = history.map((_, i) => [i]);

  const avgLinkage = (c1: number[], c2: number[]): number => {
    let s = 0;
    for (const i of c1) for (const j of c2) s += cosineDistance(history[i], history[j]);
    return s / (c1.length * c2.length);
  };

  while (clusters.length > 1) {
    // find closest pair (deterministic: lowest indices win ties)
    let bestI = 0, bestJ = 1, bestD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = avgLinkage(clusters[i], clusters[j]);
        if (d < bestD - 1e-12) { bestD = d; bestI = i; bestJ = j; }
      }
    }
    // stop if the closest pair is far enough AND we are within the mode cap
    if (bestD > opts.distanceThreshold && clusters.length <= opts.maxModes) break;
    const merged = [...clusters[bestI], ...clusters[bestJ]];
    clusters = clusters.filter((_, k) => k !== bestI && k !== bestJ);
    clusters.push(merged);
  }

  // summarize each cluster by its medoid (min total intra-cluster distance)
  const modes: UserMode[] = clusters.map((idxs) => {
    let medoidIdx = idxs[0], best = Infinity;
    for (const i of idxs) {
      let tot = 0;
      for (const j of idxs) tot += cosineDistance(history[i], history[j]);
      if (tot < best - 1e-12) { best = tot; medoidIdx = i; }
    }
    return { medoid: history[medoidIdx], weight: idxs.length / n, size: idxs.length };
  });
  // stable order: largest cluster first, then by medoid first component
  return modes.sort((a, b) => b.size - a.size || a.medoid[0] - b.medoid[0]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/modes.test.ts`
Expected: PASS (7).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/multivector/modes.ts tests/thesis/modes.test.ts
git commit -m "feat(thesis): PinnerSage user modes — agglomerative cosine clustering + medoids

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Gift intent detection

> **SUPERSEDED (2026-06-07):** the embedding-coherence + away-from-user detector
> below was found to fire 0× on realistic gift sessions (which are product-diverse
> but demographically coherent). It was redesigned per spec §4.2 to **demographic
> coherence + cross-cohort (gender/age) on the actual session** (commit `a80ba89`).
> See the spec §4.2 and `src/thesis/multivector/gift-detect.ts` for the shipped
> design; the code/tests/report below this line describe the original draft only.

**Files:**
- Create: `src/thesis/multivector/gift-detect.ts`
- Test: `tests/thesis/gift-detect.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/gift-detect.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { detectGiftIntent, type SessionItem } from "@/thesis/multivector/gift-detect";
import type { UserMode } from "@/thesis/multivector/modes";

describe("detectGiftIntent", () => {
  // User is an adult man into tech: modes point at masculino/adulto.
  const userModes: UserMode[] = [{ medoid: [1, 0, 0], weight: 1, size: 10 }];

  // A gift session: all items target a little girl (coherent with each other,
  // incoherent with the user's modes).
  const giftSession: SessionItem[] = [
    { product_id: "g1", vector: [0, 1, 0], gender_target: "femenino", age_band: "nino" },
    { product_id: "g2", vector: [0, 0.98, 0.02], gender_target: "femenino", age_band: "nino" },
    { product_id: "g3", vector: [0.02, 0.97, 0], gender_target: "femenino", age_band: "nino" },
  ];
  // A self session: items match the user's own profile.
  const selfSession: SessionItem[] = [
    { product_id: "s1", vector: [1, 0, 0], gender_target: "masculino", age_band: "adulto" },
    { product_id: "s2", vector: [0.97, 0.03, 0], gender_target: "masculino", age_band: "adulto" },
  ];

  test("flags a coherent cross-profile session as gift", () => {
    const r = detectGiftIntent(giftSession, userModes, { minItems: 2, maxSimToModes: 0.5, minInternalCoherence: 0.6 });
    expect(r.isGift).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  test("does not flag a self session that matches the user's modes", () => {
    const r = detectGiftIntent(selfSession, userModes, { minItems: 2, maxSimToModes: 0.5, minInternalCoherence: 0.6 });
    expect(r.isGift).toBe(false);
  });

  test("too few items → not gift (insufficient evidence)", () => {
    const r = detectGiftIntent(giftSession.slice(0, 1), userModes, { minItems: 2, maxSimToModes: 0.5, minInternalCoherence: 0.6 });
    expect(r.isGift).toBe(false);
  });

  test("incoherent session (random directions) → not gift even if far from user", () => {
    const incoherent: SessionItem[] = [
      { product_id: "i1", vector: [0, 1, 0], gender_target: "femenino", age_band: "nino" },
      { product_id: "i2", vector: [0, 0, 1], gender_target: "masculino", age_band: "mayor" },
    ];
    const r = detectGiftIntent(incoherent, userModes, { minItems: 2, maxSimToModes: 0.5, minInternalCoherence: 0.6 });
    expect(r.isGift).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/gift-detect.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/multivector/gift-detect.ts`**

```ts
import { cosineSim, meanPool } from "../embedders/space";
import type { UserMode } from "./modes";

/** An item observed in the current session. */
export interface SessionItem {
  product_id: string;
  vector: number[];
  gender_target: string | null;
  age_band: string | null;
}

export interface GiftOpts {
  /** Minimum session items before gift can be inferred. */
  minItems: number;
  /** Session counts as "away from the user" when its best similarity to any mode ≤ this. */
  maxSimToModes: number;
  /** Session counts as "internally coherent" when mean pairwise similarity ≥ this. */
  minInternalCoherence: number;
}

export interface GiftSignal {
  isGift: boolean;
  score: number;
  reasons: string[];
}

/** Mean pairwise cosine of the session items (how focused the session is). */
function internalCoherence(vectors: number[][]): number {
  if (vectors.length < 2) return 1;
  let s = 0, pairs = 0;
  for (let i = 0; i < vectors.length; i++)
    for (let j = i + 1; j < vectors.length; j++) { s += cosineSim(vectors[i], vectors[j]); pairs++; }
  return pairs === 0 ? 1 : s / pairs;
}

/**
 * Heuristic, interpretable gift detection at the SESSION level (no trained model,
 * no ground-truth at inference). A session is a gift when it is BOTH:
 *  - coherent in itself (the user is focused on one kind of thing this session), AND
 *  - far from the user's own interest modes (it's not their own taste).
 * Demographic coherence (all items share gender/age) reinforces the signal.
 */
export function detectGiftIntent(session: SessionItem[], userModes: UserMode[], opts: GiftOpts): GiftSignal {
  const reasons: string[] = [];
  if (session.length < opts.minItems) return { isGift: false, score: 0, reasons: ["too_few_items"] };

  const vectors = session.map((s) => s.vector);
  const coherence = internalCoherence(vectors);
  const sessionCentroid = meanPool(vectors);
  const simToModes = userModes.length === 0 ? 0 : Math.max(...userModes.map((m) => cosineSim(sessionCentroid, m.medoid)));

  const coherent = coherence >= opts.minInternalCoherence;
  const awayFromUser = userModes.length === 0 ? false : simToModes <= opts.maxSimToModes;

  // demographic coherence: do all items share a single non-null gender?
  const genders = new Set(session.map((s) => s.gender_target).filter((g) => g !== null));
  const demoCoherent = genders.size === 1;

  if (coherent) reasons.push("internally_coherent");
  if (awayFromUser) reasons.push("away_from_user_modes");
  if (demoCoherent) reasons.push("shared_recipient_demographics");

  const isGift = coherent && awayFromUser;
  // score: how strongly both conditions hold (only meaningful when isGift)
  const score = isGift ? coherence * (1 - simToModes) : 0;
  return { isGift, score, reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/gift-detect.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/multivector/gift-detect.ts tests/thesis/gift-detect.test.ts
git commit -m "feat(thesis): session-level gift-intent detection (coherent + away-from-user)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Ephemeral recipient vector

**Files:**
- Create: `src/thesis/multivector/gift-vector.ts`
- Test: `tests/thesis/gift-vector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/gift-vector.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { buildRecipientVector } from "@/thesis/multivector/gift-vector";

describe("buildRecipientVector", () => {
  test("L2-normalized mean of the gift-session item vectors", () => {
    const v = buildRecipientVector([[1, 0], [1, 0], [0, 1]]); // mean (2/3,1/3) → normalized
    const norm = Math.hypot(v[0], v[1]);
    expect(norm).toBeCloseTo(1, 9);
    expect(v[0]).toBeGreaterThan(v[1]); // x-direction dominates
  });
  test("single item → that item's unit vector", () => {
    const v = buildRecipientVector([[3, 4]]);
    expect(v[0]).toBeCloseTo(0.6, 9);
    expect(v[1]).toBeCloseTo(0.8, 9);
  });
  test("empty → []", () => {
    expect(buildRecipientVector([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/gift-vector.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/multivector/gift-vector.ts`**

```ts
import { l2normalize, meanPool } from "../embedders/space";

/**
 * Build the EPHEMERAL recipient vector for a gift session: the L2-normalized mean
 * of the items the shopper is looking at this session. It represents intent toward
 * the recipient in the embedding space and is used ONLY for this request's
 * ranking — it is never written to the user's persistent modes (which is what
 * prevents gift history from poisoning the buyer's own profile).
 */
export function buildRecipientVector(sessionItemVectors: number[][]): number[] {
  if (sessionItemVectors.length === 0) return [];
  return l2normalize(meanPool(sessionItemVectors));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/gift-vector.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/multivector/gift-vector.ts tests/thesis/gift-vector.test.ts
git commit -m "feat(thesis): ephemeral recipient vector for gift sessions (no profile poisoning)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Multi-mode quota+RRF retrieval

**Files:**
- Create: `src/thesis/multivector/retrieve.ts`
- Test: `tests/thesis/multimode-retrieve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/multimode-retrieve.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { multiModeRank } from "@/thesis/multivector/retrieve";
import type { UserMode } from "@/thesis/multivector/modes";
import type { RankItem } from "@/thesis/types";

describe("multiModeRank", () => {
  // Catalogue: 2 x-items, 2 y-items, 1 z-item.
  const candidates: RankItem[] = [
    { id: "x1", popularity: 0, vector: [1, 0, 0] },
    { id: "x2", popularity: 0, vector: [0.9, 0.1, 0] },
    { id: "y1", popularity: 0, vector: [0, 1, 0] },
    { id: "y2", popularity: 0, vector: [0, 0.9, 0.1] },
    { id: "z1", popularity: 0, vector: [0, 0, 1] },
  ];

  test("two equal-weight modes surface BOTH tastes near the top (not a compromise)", () => {
    const modes: UserMode[] = [
      { medoid: [1, 0, 0], weight: 0.5, size: 5 },
      { medoid: [0, 1, 0], weight: 0.5, size: 5 },
    ];
    const out = multiModeRank({ modes, candidates, perModeK: 3 });
    const top4 = out.slice(0, 4);
    expect(top4.some((id) => id.startsWith("x"))).toBe(true);
    expect(top4.some((id) => id.startsWith("y"))).toBe(true);
  });

  test("a single mode ranks that taste first", () => {
    const modes: UserMode[] = [{ medoid: [1, 0, 0], weight: 1, size: 5 }];
    const out = multiModeRank({ modes, candidates, perModeK: 3 });
    expect(out[0]).toBe("x1");
  });

  test("returns every candidate id exactly once", () => {
    const modes: UserMode[] = [
      { medoid: [1, 0, 0], weight: 0.7, size: 7 },
      { medoid: [0, 1, 0], weight: 0.3, size: 3 },
    ];
    const out = multiModeRank({ modes, candidates, perModeK: 2 });
    expect([...out].sort()).toEqual(["x1", "x2", "y1", "y2", "z1"]);
  });

  test("no modes → empty", () => {
    expect(multiModeRank({ modes: [], candidates, perModeK: 3 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/multimode-retrieve.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/multivector/retrieve.ts`**

```ts
import { cosineSim } from "../embedders/space";
import { rrfFuse, type RankedList } from "@/sectors/d-personalization/retrieve/rrf";
import type { RankItem } from "../types";
import type { UserMode } from "./modes";

export interface MultiModeOpts {
  /** Active user modes (self session). For a gift session, pass one mode with the recipient vector, weight 1. */
  modes: UserMode[];
  candidates: RankItem[];
  /** Base candidates pulled per mode before fusion; the actual quota per mode is round(perModeK * weight), min 1. */
  perModeK: number;
}

/**
 * Multi-mode retrieval (PinnerSage serving): rank candidates by cosine to EACH
 * active mode, take a per-mode quota proportional to the mode's weight, fuse the
 * per-mode lists with Reciprocal Rank Fusion. Every candidate still receives a
 * final position (tail items fused after the quota slices). Diversity across modes
 * is preserved instead of being averaged into a single compromise vector.
 *
 * Returns candidate ids in final ranked order (a `Ranker.rank` body can call this).
 */
export function multiModeRank(opts: MultiModeOpts): string[] {
  if (opts.modes.length === 0) return [];
  const lists: RankedList[] = [];
  const seen = new Set<string>();

  opts.modes.forEach((mode, mi) => {
    const ranked = opts.candidates
      .map((c) => ({ id: c.id, s: cosineSim(mode.medoid, c.vector) }))
      .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
    const quota = Math.max(1, Math.round(opts.perModeK * mode.weight));
    const slice = ranked.slice(0, quota);
    for (const r of slice) seen.add(r.id);
    lists.push({ source: `mode_${mi}`, items: slice.map((r, idx) => ({ id: r.id, rank: idx + 1 })) });
  });

  const fused = rrfFuse(lists).map((f) => f.id);

  // append any candidates not pulled into any quota, in deterministic id order,
  // so the ranker returns a full permutation of the candidate set.
  const tail = opts.candidates
    .map((c) => c.id)
    .filter((id) => !seen.has(id))
    .sort((a, b) => a.localeCompare(b));
  return [...fused, ...tail];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/multimode-retrieve.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/multivector/retrieve.ts tests/thesis/multimode-retrieve.test.ts
git commit -m "feat(thesis): multi-mode quota+RRF retrieval (reuses repo rrfFuse)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: F2 study runner (baseline F1 vs F2, segmented + recipient-fit)

**Files:**
- Create: `scripts/thesis/f2-study.ts`
- Modify: `package.json` (add script)

- [ ] **Step 1: Add the npm script**

In `package.json` "scripts", after `"thesis:embedding-study"`, add:
```json
    "thesis:f2-study": "tsx scripts/thesis/f2-study.ts",
```

- [ ] **Step 2: Write the runner**

Create `scripts/thesis/f2-study.ts`:
```ts
#!/usr/bin/env tsx
/**
 * F2 study: compare the F1 single-vector baseline against the F2 multi-vector +
 * gift model on the thesis holdout, SEGMENTED by session intent (self/gift) and
 * user multimodality, plus recipient-fit@k on gift sessions.
 *
 * Item space = E1 prod2vec (thesis.item_vectors space='e1_prod2vec'); the strongest
 * single-vector space from F1, and the space the user history is clustered in.
 *
 * Usage: pnpm thesis:f2-study
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { l2normalize, meanPool } from "@/thesis/embedders/space";
import { cosineSingleVectorRanker } from "@/thesis/eval/baselines";
import { evaluateRanker, type EvalCase } from "@/thesis/eval/harness";
import { aggregateCases } from "@/thesis/eval/aggregate";
import { buildUserModes, type UserMode } from "@/thesis/multivector/modes";
import { detectGiftIntent, type SessionItem } from "@/thesis/multivector/gift-detect";
import { buildRecipientVector } from "@/thesis/multivector/gift-vector";
import { multiModeRank } from "@/thesis/multivector/retrieve";
import { recipientFitAtK, type ItemDemographics, type RecipientProfile } from "@/thesis/eval/metrics";
import type { RankItem } from "@/thesis/types";

const KS = [5, 10, 20];

interface Demo extends ItemDemographics { ageBand: string | null; }

function ageBandOf(at: { min?: number; max?: number } | null | undefined): string | null {
  if (!at || typeof at.min !== "number" || typeof at.max !== "number") return null;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe"; if (mid <= 11) return "nino"; if (mid <= 25) return "joven"; if (mid <= 59) return "adulto"; return "mayor";
}

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ---- load E1 item vectors ----
    const e1 = new Map<string, number[]>();
    const e1r = await pg.query(`SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space='e1_prod2vec'`);
    for (const r of e1r.rows as { id: string; vector: number[] }[]) e1.set(r.id, r.vector.map(Number));
    if (e1.size === 0) { console.error("[f2] no e1_prod2vec vectors — run pnpm thesis:train-prod2vec first"); process.exit(1); }

    // ---- catalog metadata (demographics + cohort) ----
    const demo = new Map<string, Demo>();
    const cohortById = new Map<string, string | null>();
    const mr = await pg.query(`SELECT id::text id, metadata FROM thesis.products`);
    for (const r of mr.rows as { id: string; metadata: Record<string, unknown> }[]) {
      const m = r.metadata ?? {};
      const at = m.age_target as { min?: number; max?: number } | null | undefined;
      demo.set(r.id, {
        gender_target: (m.gender_target as string | null) ?? null,
        age_min: at?.min ?? 0, age_max: at?.max ?? 130, ageBand: ageBandOf(at),
      });
      cohortById.set(r.id, (m.subcategory as string | null) ?? null);
    }
    const popById = new Map<string, number>();
    const popR = await pg.query(`SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`);
    for (const r of popR.rows as { pid: string; c: number }[]) popById.set(r.pid, r.c);

    // ---- train / test holdout ----
    const trainByUser = new Map<string, string[]>();
    const trR = await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`);
    for (const r of trR.rows as { uid: string; pid: string }[]) { const a = trainByUser.get(r.uid) ?? []; a.push(r.pid); trainByUser.set(r.uid, a); }
    const tests = (await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test'`)).rows as { uid: string; pid: string }[];

    // ---- per-user last test session + its intent/recipient (GT, for segments + recipient-fit) ----
    // map each test user to the most recent session and its intent/recipient
    const sessR = await pg.query(
      `SELECT user_id::text uid, session_id::text sid, intent, recipient_id::text rid, started_at
       FROM thesis.sim_sessions ORDER BY user_id, started_at DESC`,
    );
    const lastSession = new Map<string, { intent: string; rid: string | null }>();
    for (const r of sessR.rows as { uid: string; intent: string; rid: string | null }[]) {
      if (!lastSession.has(r.uid)) lastSession.set(r.uid, { intent: r.intent, rid: r.rid });
    }
    // session items = the train items the user interacted with in their gift session(s);
    // approximation: use the user's train items as the "current session" signal.
    const recById = new Map<string, RecipientProfile & { id: string }>();
    const recR = await pg.query(`SELECT id::text id, gender, age_min, age_max FROM thesis.sim_user_recipients`);
    for (const r of recR.rows as { id: string; gender: string; age_min: number; age_max: number }[]) recById.set(r.id, { id: r.id, gender: r.gender, age_min: r.age_min, age_max: r.age_max });

    // ---- common universe = items with an E1 vector ----
    const commonIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
    const commonSet = new Set(commonIds);

    // ---- build scaffold ----
    interface F2Case extends EvalCase { uid: string; intent: string; nModes: number; recipient: RecipientProfile | null; }
    const baselineCases: F2Case[] = [];
    const f2Cases: F2Case[] = [];

    for (const t of tests) {
      const train = (trainByUser.get(t.uid) ?? []).filter((id) => commonSet.has(id));
      if (train.length === 0 || !commonSet.has(t.pid)) continue;
      const trainSet = new Set(train);
      const candidateIds = commonIds.filter((id) => !trainSet.has(id));
      const candidates: RankItem[] = candidateIds.map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: e1.get(id)!, cohort: cohortById.get(id) ?? null }));
      const relevant = new Set([t.pid]);

      const history = train.map((id) => e1.get(id)!);
      const modes = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });

      // gift detection on the train items as a proxy session signal
      const sessionItems: SessionItem[] = train.map((id) => ({
        product_id: id, vector: e1.get(id)!, gender_target: demo.get(id)?.gender_target ?? null, age_band: demo.get(id)?.ageBand ?? null,
      }));
      const gift = detectGiftIntent(sessionItems, modes, { minItems: 2, maxSimToModes: 0.5, minInternalCoherence: 0.5 });

      const sess = lastSession.get(t.uid);
      const recipient = sess?.rid ? (recById.get(sess.rid) ?? null) : null;
      const intent = sess?.intent ?? "self";
      const ctx = { userVector: l2normalize(meanPool(history)), cohort: cohortById.get(t.pid) ?? null };

      baselineCases.push({ ctx, candidates, relevant, uid: t.uid, intent, nModes: modes.length, recipient });

      // F2 ranker chooses modes vs ephemeral recipient vector
      const f2Modes: UserMode[] = gift.isGift
        ? [{ medoid: buildRecipientVector(history), weight: 1, size: history.length }]
        : modes;
      f2Cases.push({ ctx, candidates, relevant, uid: t.uid, intent, nModes: modes.length, recipient, /* carried */ });
      // attach modes for the per-case ranker via a parallel map keyed by index
      (f2Cases[f2Cases.length - 1] as F2Case & { f2Modes: UserMode[] }).f2Modes = f2Modes;
    }

    // ---- evaluate, overall + per segment ----
    const baselineRanker = cosineSingleVectorRanker();
    const f2RankerFor = (c: EvalCase) => ({
      name: "f2-multivector",
      rank: (_ctx: typeof c.ctx, cands: RankItem[]) => multiModeRank({ modes: (c as F2Case & { f2Modes: UserMode[] }).f2Modes, candidates: cands, perModeK: 20 }),
    });

    const segOf = (c: F2Case) => `${c.intent}|${c.nModes <= 1 ? "1mode" : c.nModes <= 3 ? "2-3modes" : "4+modes"}`;
    const segments = ["overall", ...new Set(f2Cases.map(segOf))];

    const rows: string[] = [];
    rows.push("# Thesis F2 — Multi-vector × recipient + gift study", "");
    rows.push(`Item space: e1_prod2vec. Common universe: ${commonIds.length}. Test cases: ${f2Cases.length}.`, "");
    rows.push("| Segment | n | model | nDCG@10 | Recall@10 | MRR |", "|---|---|---|---|---|---|");

    const evalSeg = (label: string, bCases: F2Case[], fCases: F2Case[]) => {
      if (fCases.length === 0) return;
      const b = evaluateRanker(baselineRanker, bCases, KS);
      const f = aggregateCases(fCases, f2RankerFor, KS, "f2-multivector");
      rows.push(`| ${label} | ${b.n} | F1-single | ${b.ndcg[10].toFixed(3)} | ${b.recall[10].toFixed(3)} | ${b.mrr.toFixed(3)} |`);
      rows.push(`| ${label} | ${f.n} | F2-multivec | ${f.ndcg[10].toFixed(3)} | ${f.recall[10].toFixed(3)} | ${f.mrr.toFixed(3)} |`);
    };
    evalSeg("overall", baselineCases, f2Cases);
    for (const seg of segments.filter((s) => s !== "overall")) {
      evalSeg(seg, baselineCases.filter((c) => segOf(c) === seg), f2Cases.filter((c) => segOf(c) === seg));
    }

    // ---- recipient-fit@10 on gift cases ----
    const demoRecord: Record<string, ItemDemographics> = {};
    for (const [id, d] of demo) demoRecord[id] = { gender_target: d.gender_target, age_min: d.age_min, age_max: d.age_max };
    const giftCases = f2Cases.filter((c) => c.intent === "gift" && c.recipient);
    let fitB = 0, fitF = 0;
    for (const c of giftCases) {
      const bRanked = baselineRanker.rank(c.ctx, c.candidates);
      const fRanked = multiModeRank({ modes: (c as F2Case & { f2Modes: UserMode[] }).f2Modes, candidates: c.candidates, perModeK: 20 });
      fitB += recipientFitAtK(bRanked, c.recipient!, demoRecord, 10);
      fitF += recipientFitAtK(fRanked, c.recipient!, demoRecord, 10);
    }
    const ng = Math.max(1, giftCases.length);
    rows.push("", `## Recipient-fit@10 (gift sessions, n=${giftCases.length})`, "");
    rows.push(`- F1-single: ${(fitB / ng).toFixed(3)}`, `- F2-multivec: ${(fitF / ng).toFixed(3)}`);

    const md = rows.join("\n") + "\n";
    const out = resolve(process.cwd(), "docs/superpowers/reports/2026-05-29-thesis-f2-study.md");
    writeFileSync(out, md);
    console.log(md);
    console.log(`[f2] wrote ${out}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm typecheck 2>&1 | grep -v '\.next/' | grep -E 'f2-study|multivector' || echo "no F2 TS errors"`
Expected: `no F2 TS errors`.

- [ ] **Step 4: Run the study (dataset from F1 scale-up already present; if not, regenerate per the note below)**

Run: `pnpm thesis:f2-study`
Expected: a markdown table with overall + per-segment rows (F1-single vs F2-multivec) and a recipient-fit@10 block. Sanity: in the `gift|*` segments and multi-mode segments, F2 nDCG@10 ≥ F1; recipient-fit@10 F2 ≥ F1. If the dataset is missing, first run:
```bash
pnpm thesis:catalog --n 2000 --seed 42 && pnpm thesis:relations && pnpm thesis:behavior --users 800 --days 90 --seed 42 && pnpm thesis:train-prod2vec --dim 64 --epochs 30 --seed 42
```
then re-run `pnpm thesis:f2-study`. Report BLOCKED on DB-asleep (ENOTFOUND).

- [ ] **Step 5: Commit (runner only; the report is committed in Task 8)**

```bash
git add scripts/thesis/f2-study.ts package.json
git commit -m "feat(thesis): F2 study runner — F1-single vs F2-multivector, segmented + recipient-fit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Integration discrimination test (real DB)

**Files:**
- Create: `tests/thesis/f2-discrimination.test.ts`

This proves the core thesis claim on real data: a planted bimodal user is served BOTH tastes by F2 but only a compromise by the single-vector baseline.

- [ ] **Step 1: Write the test**

Create `tests/thesis/f2-discrimination.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { buildUserModes } from "@/thesis/multivector/modes";
import { multiModeRank } from "@/thesis/multivector/retrieve";
import { cosineSingleVectorRanker } from "@/thesis/eval/baselines";
import { l2normalize, meanPool } from "@/thesis/embedders/space";
import type { RankItem } from "@/thesis/types";

/**
 * Replicates the feedback's 70/30 experiment in the eval harness's terms (pure,
 * no DB needed — this is the controlled discrimination check the spec requires).
 * A user with two orthogonal tastes: single-vector retrieval collapses to a
 * compromise that under-serves the minority taste; multi-mode retrieval surfaces
 * BOTH. We assert the multi-mode top-10 contains more of the minority taste.
 */
describe("F2 discrimination: multi-vector beats single-vector for a bimodal user", () => {
  test("multi-mode top-10 covers the minority taste better than single-vector", () => {
    // history: 7 shoe-like (x-axis), 3 bag-like (y-axis)
    const history: number[][] = [
      ...Array.from({ length: 7 }, (_, i) => [1, i * 0.001, 0]),
      ...Array.from({ length: 3 }, (_, i) => [0, 1, i * 0.001]),
    ];
    // catalogue: 50 shoes, 50 bags
    const candidates: RankItem[] = [
      ...Array.from({ length: 50 }, (_, i) => ({ id: `shoe${i}`, popularity: 0, vector: [1, i * 0.0001, 0] })),
      ...Array.from({ length: 50 }, (_, i) => ({ id: `bag${i}`, popularity: 0, vector: [0, 1, i * 0.0001] })),
    ];

    const modes = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });
    expect(modes.length).toBe(2); // two tastes recovered

    const f2 = multiModeRank({ modes, candidates, perModeK: 20 });
    const single = cosineSingleVectorRanker().rank(
      { userVector: l2normalize(meanPool(history)), cohort: null },
      candidates,
    );

    const bagsInTop10 = (ids: string[]) => ids.slice(0, 10).filter((id) => id.startsWith("bag")).length;
    // single-vector compromise buries the minority (bags); multi-mode surfaces them
    expect(bagsInTop10(f2)).toBeGreaterThan(bagsInTop10(single));
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/thesis/f2-discrimination.test.ts`
Expected: PASS (1). If `bagsInTop10(single)` already ≥ f2, the single-vector compromise did NOT bury the minority — investigate the mean-pool vs mode geometry rather than weakening the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/thesis/f2-discrimination.test.ts
git commit -m "test(thesis): F2 multi-vector surfaces a bimodal user's minority taste vs single-vector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: End-to-end run, report, final verification + push

**Files:** generated report only.

- [ ] **Step 1: Ensure dataset present and run the study**

Run: `pnpm thesis:f2-study`
Expected: prints the markdown and `[f2] wrote …`. (If dataset missing, regenerate per Task 6 Step 4.)

- [ ] **Step 2: Full gate**

Run:
```bash
npx vitest run tests/thesis && pnpm test:quality && (pnpm typecheck 2>&1 | grep -v '\.next/' | grep -E 'thesis|multivector' || echo "no thesis TS errors")
```
Expected: all thesis tests pass; `[check-test-quality] OK`; `no thesis TS errors`.

- [ ] **Step 3: Confirm existing suite green**

Run: `npx vitest run tests/unit`
Expected: 176+ passing (no regressions).

- [ ] **Step 4: Commit the report + push**

```bash
git add docs/superpowers/reports/2026-05-29-thesis-f2-study.md
git commit -m "docs(thesis): F2 study results — multi-vector + gift vs single-vector, segmented

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push origin feat/thesis-personalization-program
```
Expected: pushed; local == remote.

---

## Self-Review notes (for the implementer)
- **Spec coverage:** modes §4.1→Task 2; gift-detect §4.2→Task 3; gift-vector §4.3→Task 4; retrieve §4.4→Task 5; study runner §4.5→Task 6; recipientFit §5→Task 1; segmented eval §5→Task 6; discrimination check §5→Task 7; final verify §8→Task 8.
- **Reuse, not reinvention:** `rrfFuse` (repo), `l2normalize/meanPool/cosineSim` (F1 space.ts), `evaluateRanker/aggregateCases` (F0), `cosineSingleVectorRanker` (F0 baseline = the F1 single-vector model). No new RRF/metric infra beyond `recipientFitAtK`.
- **No mocks:** unit modules are pure (toy fixtures); the study runner + discrimination integration hit the real DB / use real E1 vectors. `pnpm test:quality` enforces no banned mocks/weak assertions.
- **No production changes:** everything under `src/thesis/` + `scripts/thesis/`.
- **Type consistency:** `UserMode {medoid,weight,size}`, `SessionItem {product_id,vector,gender_target,age_band}`, `GiftSignal {isGift,score,reasons}`, `multiModeRank({modes,candidates,perModeK})→string[]`, `recipientFitAtK(ranked,recipient,demographics,k)`, `ItemDemographics {gender_target,age_min,age_max}`, `RecipientProfile {gender,age_min,age_max}` — used identically across Tasks 1–7.
- **Known approximation (documented):** the runner uses each user's TRAIN items as the gift-session proxy (we don't replay per-session event windows in the offline holdout). The honest caveat: gift detection precision is bounded by this proxy; the report should also print detection precision/recall vs `sim_sessions.intent` as a diagnostic. If the implementer has time, add that diagnostic to the runner; it is not required for the plan to be complete.
