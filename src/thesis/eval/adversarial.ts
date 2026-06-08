/**
 * F6 W7 — Adversarial synthetic profiles (spec §5 W7).
 *
 * Builds EXTREME synthetic `UnifiedCase`s that stress the assembled pipeline at the
 * edges its holdout never reaches. These cases are NOT drawn from the holdout: each
 * profile picks a deterministic set of REAL catalog ids (so the E1 vectors, NPMI
 * edges, popularity and business features are all real) to assemble a synthetic
 * `trainIds` history, then reproduces — verbatim — the same per-case derivation the
 * canonical loader runs (modes → gift-detect → 4-source RRF pool → objective
 * features → expected revenue). The ONLY structural difference from a holdout case
 * is that there is no held-out purchase, so `relevant` is the empty set: positional
 * IR metrics (nDCG/recall/MRR) are meaningless and the runner DOES NOT report them.
 * What W7 measures instead is graceful adaptation/degradation: gift-detector firing
 * + predicted recipient, mode count, recipient-fit@10, set-change@10 vs popular-
 * cohort, revenue@10, diversity@10 (spec §5 W7).
 *
 * Four profile families (spec §5 W7):
 *   1. pure-gift     — buyer and recipient demographically OPPOSITE (a masculine-
 *                      adult buyer whose entire session is feminine-adult, or vice
 *                      versa). The detector SHOULD fire and route to the recipient.
 *   2. multi-modal   — 5+ orthogonal subcategories (disjoint cohorts spanning
 *                      genders/ages), so PinnerSage must keep >=5 modes and the feed
 *                      cannot collapse to one taste.
 *   3. price-extreme — high-tail only (price_band 3) OR cheap only (price_band 0),
 *                      to probe whether the multi-objective scorer over/under-shoots
 *                      revenue at a degenerate budget band.
 *   4. ambiguous     — mixed signals that challenge the gift detector near its
 *                      ~0.43-precision operating point: a session that is
 *                      demographically coherent enough to look like a gift but whose
 *                      modal demographic only weakly differs from the buyer's, plus
 *                      a self-leaning variant the detector should NOT flag.
 *
 * No leakage (spec hazard #6): `giftSignal` is the F2 detector run on the synthetic
 * session, NEVER ground truth. `intentGT` here is the profile's INTENDED label (what
 * we built the profile to be) — used only to segment the report and to drive the
 * recipient-fit measurement's expected recipient; it is never a ranking feature.
 *
 * Embedding-space discipline (spec hazard #5 — cosineSim THROWS on mismatch): every
 * vector stays in E1 (prod2vec, 64d). `buildAdversarialCase` reuses exactly the E1
 * maps the loader uses; no 1024d text vector ever enters the assembled path.
 *
 * Determinism (spec §6): every choice is seed-driven via `makeRng`. No Math.random /
 * Date.now. Pure module: no DB / network — the caller supplies a `CatalogData`
 * bundle (the same reads the unified loader performs).
 */
import { l2normalize, meanPool, cosineSim } from "../embedders/space";
import { buildCandidatePool, type PooledCandidate } from "../rerank/candidates";
import { buildUserModes } from "../multivector/modes";
import {
  detectGiftIntent,
  type GiftSignal,
  type SessionItem,
  type UserDemographic,
} from "../multivector/gift-detect";
import {
  extractObjectiveFeatures,
  type ObjCtx,
  type ObjCandidate,
  type ObjectiveName,
} from "../objectives/objective-features";
import { expectedRevenue } from "../objectives/outcome";
import { makeRng } from "../data/rng";
import type { RankItem, UserContext } from "../types";
import type { UnifiedCase } from "./unified-cases";

// ── Constants (verbatim from unified-cases.ts so adversarial cases are processed
//    by the SAME pipeline geometry as holdout cases). ──────────────────────────
const SEED = 42;
const POOL_SIZE = 200;
const PRICE_BANDS = 4;
const RETRIEVAL_TOP = 80;
const NPMI_TOP = 50;
const POPULAR_TOP = 40;
const EXPLORATION_N = 30;
const MODE_OPTS = { distanceThreshold: 0.5, maxModes: 5 } as const;
const GIFT_OPTS = { minItems: 2, minDemographicCoherence: 0.6 } as const;

// ── Catalog meta needed to assemble a case (the union the loader reads). ───────
/** Per-product catalog fields the adversarial builder needs (E1-universe only). */
export interface AdvProductMeta {
  gender: string | null;
  /** Age band bucket from age_target midpoint (bebe|nino|joven|adulto|mayor). */
  ageBand: string | null;
  priceBand: number;
  /** subcategory — the cohort key for popular-cohort + multi-modal disjointness. */
  cohort: string | null;
  category: string;
  title: string;
  priceCents: number;
  marginPct: number;
  sellerId: string;
  sellerAgeDays: number;
}

/**
 * The shared catalog bundle (all reads the unified loader performs, minus the
 * holdout). Supplied by the runner so this module stays pure/deterministic. Every
 * id key is in the E1 universe (catalog representable in E1).
 */
export interface CatalogData {
  /** id → E1 prod2vec vector (64d) — the canonical RankItem.vector space. */
  e1: Map<string, number[]>;
  /** id → catalog meta. */
  meta: Map<string, AdvProductMeta>;
  /** id → event-count popularity. */
  popById: Map<string, number>;
  /** id → ranked NPMI neighbours (best first), with scores. */
  npmiNeighbours: Map<string, { id: string; score: number }[]>;
  /** cohort (subcategory) → ids sorted by popularity desc (popular source). */
  cohortPopular: Map<string, string[]>;
  /** All E1-universe ids sorted by popularity desc (global popular fallback). */
  globalPopular: string[];
}

// ── Profile specification (deterministic selection over the real catalog). ─────

export type ProfileKind = "pure-gift" | "multi-modal" | "price-extreme" | "ambiguous";

/** One adversarial profile: a name, an intended GT label, and a synthetic session. */
export interface AdversarialProfile {
  /** Stable profile id (used in the report + per-profile seed). */
  id: string;
  kind: ProfileKind;
  /** Human-readable description for the report. */
  description: string;
  /** Intended label (segments the report + drives recipient-fit). NOT a feature. */
  intentGT: "self" | "gift";
  /** When intentGT="gift", the recipient the profile is built to target (for
   *  recipient-fit measurement). null for self profiles. */
  expectedRecipient: { gender: string; ageBand: string } | null;
  /** Synthetic train/session item ids (real catalog ids in the E1 universe). */
  trainIds: string[];
}

// ── Helpers (verbatim semantics from unified-cases.ts). ────────────────────────

/** Most frequent non-null value; deterministic alphabetical tie-break. */
function modeOf(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** Modal numeric (price band) over the session; 0 if none. */
function modeNum(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (const [v, c] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** Rounded mean of price bands (f4 objective budget convention). */
function meanBand(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((s, x) => s + x, 0) / values.length);
}

/** Stable per-profile seed for the exploration shuffle (mirrors uidSeed). */
function profileSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) ^ SEED;
}

/**
 * Deterministically pick the top-`k` E1-universe ids matching a predicate, ordered
 * by popularity desc then id (so a profile's session is realistic — the head of the
 * matching cohort — and bit-for-bit reproducible).
 */
function pickByPredicate(
  cat: CatalogData,
  pred: (id: string, m: AdvProductMeta) => boolean,
  k: number,
): string[] {
  const matches: string[] = [];
  for (const [id, m] of cat.meta) {
    if (!cat.e1.has(id)) continue;
    if (pred(id, m)) matches.push(id);
  }
  matches.sort((a, b) => (cat.popById.get(b) ?? 0) - (cat.popById.get(a) ?? 0) || a.localeCompare(b));
  return matches.slice(0, k);
}

// ── Profile builders (deterministic over the real catalog). ────────────────────

/**
 * pure-gift: a buyer whose persistent taste is one demographic pole, shopping a
 * session that is entirely the OPPOSITE pole. We model this as a session of
 * feminino-adulto items (e.g. moda_mujer/joyeria/belleza) — coherent and
 * cross-cohort relative to a masculine-adult buyer baseline. The detector SHOULD
 * fire (coherent + cross-gender) and route ranking to the feminine-adult recipient.
 *
 * We also build the mirror (masculine-adult session). Both are "gift" profiles; the
 * expectedRecipient is the session's pole so recipient-fit can be scored.
 */
function buildPureGiftProfiles(cat: CatalogData): AdversarialProfile[] {
  const profiles: AdversarialProfile[] = [];

  // (a) recipient = feminino/adulto (moda_mujer, joyeria, belleza). Coherent gift.
  const femAdult = pickByPredicate(
    cat,
    (_id, m) => m.gender === "femenino" && m.ageBand === "adulto",
    6,
  );
  if (femAdult.length >= GIFT_OPTS.minItems) {
    profiles.push({
      id: "pure-gift-fem-adulto",
      kind: "pure-gift",
      description:
        "Pure gift: session is 6 feminino/adulto items (moda_mujer/joyeria/belleza); " +
        "demographically opposite to a masculine-adult buyer baseline. Detector should fire.",
      intentGT: "gift",
      expectedRecipient: { gender: "femenino", ageBand: "adulto" },
      trainIds: femAdult,
    });
  }

  // (b) recipient = niño (juguetes / moda_infantil — gender null/unisex, age nino).
  //     Cross-AGE (nino vs adulto buyer) even though gender is unisex.
  const child = pickByPredicate(
    cat,
    (_id, m) => m.ageBand === "nino" && (m.category === "juguetes" || m.category === "moda_infantil"),
    6,
  );
  if (child.length >= GIFT_OPTS.minItems) {
    profiles.push({
      id: "pure-gift-nino",
      kind: "pure-gift",
      description:
        "Pure gift: session is 6 niño items (juguetes/moda_infantil); cross-AGE vs an " +
        "adult buyer (gift for a child). Detector should fire on cross_cohort_age.",
      intentGT: "gift",
      expectedRecipient: { gender: "unisex", ageBand: "nino" },
      trainIds: child,
    });
  }

  return profiles;
}

/**
 * multi-modal: 5+ orthogonal subcategories from disjoint cohorts spanning genders
 * and ages — the antithesis of a single coherent taste. PinnerSage must keep
 * multiple modes; the feed cannot collapse to one cohort. Built by taking the most-
 * popular item from each of 6 maximally-disjoint subcategories.
 */
function buildMultiModalProfiles(cat: CatalogData): AdversarialProfile[] {
  // Six deliberately orthogonal cohorts (different category + gender + age mix).
  const targetSubcats = [
    "smartphone", // tecnologia, masculino, adulto, premium/high
    "vestido", // moda_mujer, femenino, adulto
    "muneca", // juguetes, null, nino
    "zapatillas_running", // deporte, masculino, joven
    "perfume", // belleza, femenino, adulto
    "teclado", // accesorios_tech, masculino, adulto, budget
  ];
  const ids: string[] = [];
  for (const sub of targetSubcats) {
    const top = pickByPredicate(cat, (_id, m) => m.cohort === sub, 1);
    if (top.length > 0) ids.push(top[0]);
  }
  if (ids.length < 5) return [];
  return [
    {
      id: "multi-modal-6cohorts",
      kind: "multi-modal",
      description:
        `Multi-modal: 6 orthogonal subcategories (${targetSubcats.join(", ")}) — disjoint ` +
        "cohorts spanning genders/ages. Forces PinnerSage to keep >=5 interest modes.",
      intentGT: "self",
      expectedRecipient: null,
      trainIds: ids,
    },
  ];
}

/**
 * price-extreme: a session confined to ONE degenerate price band — either the high
 * tail (band 3) or the cheap floor (band 0) — to probe whether the multi-objective
 * scorer over/under-shoots revenue at a budget band the user never strays from.
 * Kept within a single coherent cohort family so the ONLY extreme axis is price.
 */
function buildPriceExtremeProfiles(cat: CatalogData): AdversarialProfile[] {
  const profiles: AdversarialProfile[] = [];

  // (a) high-tail only: band-3 items (tecnologia/joyeria/moda_mujer high tier).
  const highTail = pickByPredicate(cat, (_id, m) => m.priceBand === 3, 6);
  if (highTail.length >= 2) {
    profiles.push({
      id: "price-extreme-high",
      kind: "price-extreme",
      description:
        "Price-extreme (high tail): session is 6 price_band-3 items only. Probes whether " +
        "the scorer chases revenue past the user's never-leaving-the-high-band budget.",
      intentGT: "self",
      expectedRecipient: null,
      trainIds: highTail,
    });
  }

  // (b) cheap only: band-0 items (budget accesorios_tech/deporte/juguetes).
  const cheap = pickByPredicate(cat, (_id, m) => m.priceBand === 0, 6);
  if (cheap.length >= 2) {
    profiles.push({
      id: "price-extreme-cheap",
      kind: "price-extreme",
      description:
        "Price-extreme (cheap floor): session is 6 price_band-0 items only. Probes whether " +
        "the scorer's revenue tilt drags a budget user toward unaffordable high-margin items.",
      intentGT: "self",
      expectedRecipient: null,
      trainIds: cheap,
    });
  }

  return profiles;
}

/**
 * ambiguous: sessions engineered to sit on the detector's knife-edge (~0.43
 * precision). Two variants:
 *   (a) gift-leaning-noisy: a mostly-coherent cross-cohort session with ONE off-pole
 *       item, so coherence hovers near the minDemographicCoherence threshold. Built
 *       to be a true gift (intentGT="gift") the detector may FN.
 *   (b) self-leaning-mixed: a session whose modal gender MATCHES the buyer's own
 *       (so not cross-cohort) but spans subcategories — looks browse-y but is self.
 *       The detector should NOT fire; intentGT="self".
 */
function buildAmbiguousProfiles(cat: CatalogData): AdversarialProfile[] {
  const profiles: AdversarialProfile[] = [];

  // (a) gift-leaning-noisy: 4 feminino/adulto + 2 masculino → coherence 4/6≈0.67,
  //     just above the 0.6 threshold; one demographic axis muddied.
  const femCore = pickByPredicate(cat, (_id, m) => m.gender === "femenino" && m.ageBand === "adulto", 4);
  const mascNoise = pickByPredicate(cat, (_id, m) => m.gender === "masculino" && m.ageBand === "adulto", 2);
  if (femCore.length === 4 && mascNoise.length === 2) {
    profiles.push({
      id: "ambiguous-gift-noisy",
      kind: "ambiguous",
      description:
        "Ambiguous (gift-leaning, noisy): 4 feminino/adulto + 2 masculino items → coherence " +
        "≈0.67, hovering just over the 0.6 threshold. A true gift the detector may FN.",
      intentGT: "gift",
      expectedRecipient: { gender: "femenino", ageBand: "adulto" },
      trainIds: [...femCore, ...mascNoise],
    });
  }

  // (b) self-leaning-mixed: 5 masculino items across subcats (tech + deporte) — modal
  //     gender = masculino = buyer's own → NOT cross-cohort. Detector should pass.
  const mascMixed = pickByPredicate(
    cat,
    (_id, m) =>
      m.gender === "masculino" &&
      (m.category === "tecnologia" || m.category === "deporte" || m.category === "accesorios_tech"),
    5,
  );
  if (mascMixed.length >= 4) {
    profiles.push({
      id: "ambiguous-self-mixed",
      kind: "ambiguous",
      description:
        "Ambiguous (self-leaning, mixed): 5 masculino items across tech/deporte — modal gender " +
        "= the buyer's own, so NOT cross-cohort. Detector should NOT fire (true self).",
      intentGT: "self",
      expectedRecipient: null,
      trainIds: mascMixed,
    });
  }

  return profiles;
}

/**
 * Build all adversarial profile SPECS (deterministic). Each spec is a synthetic
 * session of real catalog ids; `buildAdversarialCase` turns one into a UnifiedCase.
 */
export function buildAdversarialProfiles(cat: CatalogData): AdversarialProfile[] {
  return [
    ...buildPureGiftProfiles(cat),
    ...buildMultiModalProfiles(cat),
    ...buildPriceExtremeProfiles(cat),
    ...buildAmbiguousProfiles(cat),
  ];
}

// ── Case assembly (verbatim pipeline geometry from unified-cases.ts). ──────────

/**
 * The buyer demographic baseline a pure-gift / ambiguous profile is "opposite" to.
 * For self profiles the buyer demographic IS the session's own modal demographic
 * (so the detector sees a non-cross-cohort session, as in real self holdout cases).
 * For gift profiles we anchor the buyer to a FIXED opposite pole so the cross-cohort
 * signal is real and deterministic — NOT read from any GT table.
 */
function buyerDemographicFor(
  profile: AdversarialProfile,
  sessionModalGender: string | null,
  sessionModalAge: string | null,
): UserDemographic {
  if (profile.intentGT === "self") {
    // Self: buyer == session pole (no cross-cohort → detector correctly passes).
    return { gender: sessionModalGender, ageBand: sessionModalAge };
  }
  // Gift: buyer is the OPPOSITE pole of the recipient the profile targets, so the
  // session is genuinely cross-cohort. Deterministic, derived from the profile.
  const rec = profile.expectedRecipient;
  if (rec === null) return { gender: sessionModalGender, ageBand: sessionModalAge };
  // Opposite gender: femenino<->masculino; unisex/null recipient keeps masculino anchor.
  const oppGender = rec.gender === "femenino" ? "masculino" : "femenino";
  // Buyer anchored to adulto so a niño-recipient session is genuinely cross-AGE and a
  // same-age opposite-gender session is genuinely cross-GENDER.
  return { gender: oppGender, ageBand: "adulto" };
}

/**
 * Turn one adversarial profile spec into a fully-formed `UnifiedCase`, reproducing
 * the canonical loader's per-case derivation EXACTLY (modes → gift-detect →
 * 4-source RRF pool → objective features → expected revenue), so the assembled
 * pipeline and the baselines process it with identical geometry. `relevant` is the
 * empty set (no held-out purchase) — the runner reports adaptation metrics, never
 * positional IR.
 *
 * @throws if the profile's session has no E1-universe items (caller guarantees
 *         non-empty via the builders; defensive).
 */
export function buildAdversarialCase(cat: CatalogData, profile: AdversarialProfile): UnifiedCase {
  const train = profile.trainIds.filter((id) => cat.e1.has(id));
  if (train.length === 0) {
    throw new Error(`[adversarial] profile ${profile.id} has no E1-universe session items`);
  }
  const trainSet = new Set(train);
  const history = train.map((id) => cat.e1.get(id)!);
  const modes = buildUserModes(history, MODE_OPTS);
  const modeMedoids = modes.map((m) => m.medoid);

  const commonIds = [...cat.e1.keys()].sort((a, b) => a.localeCompare(b));
  const commonSet = new Set(commonIds);
  const allMinusTrain = commonIds.filter((id) => !trainSet.has(id));

  // ── SOURCE 1: retrieval — top-80 by max cosine to mode medoids. ────────────
  const retrieval = [...allMinusTrain]
    .map((id) => ({
      id,
      s: modeMedoids.length ? Math.max(...modeMedoids.map((m) => cosineSim(m, cat.e1.get(id)!))) : 0,
    }))
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
    .slice(0, RETRIEVAL_TOP)
    .map((x) => x.id);

  // ── SOURCE 2: npmi — neighbours of the "last viewed" (the LAST session item). ─
  // A synthetic session has no event stream; we use the last train id as the
  // last-viewed anchor (deterministic), mirroring the loader's NPMI source.
  const lv = train[train.length - 1] ?? null;
  const npmi = (lv ? (cat.npmiNeighbours.get(lv) ?? []) : [])
    .map((n) => n.id)
    .filter((id) => commonSet.has(id) && !trainSet.has(id))
    .slice(0, NPMI_TOP);

  // ── SOURCE 3: popular — cohort-popularity of train[0]'s cohort (<=40). ──────
  const seedCohort = cat.meta.get(train[0])?.cohort ?? "__none__";
  const popSource = (cat.cohortPopular.get(seedCohort) ?? cat.globalPopular)
    .filter((id) => !trainSet.has(id))
    .slice(0, POPULAR_TOP);
  const popular = popSource.length
    ? popSource
    : cat.globalPopular.filter((id) => !trainSet.has(id)).slice(0, POPULAR_TOP);

  // ── SOURCE 4: exploration — 30 ids via seeded shuffle of all-minus-train. ───
  const rng = makeRng(profileSeed(profile.id));
  const shuf = [...allMinusTrain];
  for (let i = shuf.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [shuf[i], shuf[j]] = [shuf[j], shuf[i]];
  }
  const exploration = shuf.slice(0, EXPLORATION_N);

  const pool: PooledCandidate[] = buildCandidatePool(
    [
      { source: "retrieval", ids: retrieval },
      { source: "npmi", ids: npmi },
      { source: "popular", ids: popular },
      { source: "exploration", ids: exploration },
    ],
    POOL_SIZE,
  );
  const poolOrder = pool.map((p) => p.id);

  // ── Gift detection (DETECTOR on the synthetic session — never GT). ─────────
  const session: SessionItem[] = train.map((id) => ({
    product_id: id,
    gender_target: cat.meta.get(id)?.gender ?? null,
    age_band: cat.meta.get(id)?.ageBand ?? null,
  }));
  const sessionModalGender = modeOf(train.map((id) => cat.meta.get(id)?.gender ?? null));
  const sessionModalAge = modeOf(train.map((id) => cat.meta.get(id)?.ageBand ?? null));
  const userDemographic = buyerDemographicFor(profile, sessionModalGender, sessionModalAge);
  const giftSignal: GiftSignal = detectGiftIntent(session, userDemographic, GIFT_OPTS);
  const recipientGender = giftSignal.isGift ? giftSignal.targetGender : null;
  const recipientAgeBand = giftSignal.isGift ? giftSignal.targetAgeBand : null;

  // ── Budget bands. ──────────────────────────────────────────────────────────
  const budgetBandMode = modeNum(train.map((id) => cat.meta.get(id)?.priceBand ?? 0));
  const budgetBandMean = meanBand(train.map((id) => cat.meta.get(id)?.priceBand ?? 0));

  // ── Full last-viewed → npmi map (superset of pool). ────────────────────────
  const lvNpmi = new Map<string, number>();
  if (lv) for (const n of cat.npmiNeighbours.get(lv) ?? []) lvNpmi.set(n.id, n.score);

  // ── Per-POOL expectedRevenue (affinity = max cosine to modes). ─────────────
  const revenueById = new Map<string, number>();
  for (const id of poolOrder) {
    const m = cat.meta.get(id)!;
    const affinity = modeMedoids.length
      ? Math.max(0, Math.min(1, Math.max(...modeMedoids.map((md) => cosineSim(md, cat.e1.get(id)!)))))
      : 0;
    const priceFit = Math.max(0, 1 - Math.abs(m.priceBand - budgetBandMean) / (PRICE_BANDS - 1));
    revenueById.set(
      id,
      expectedRevenue({ affinity, priceFit, price_cents: m.priceCents, margin_pct: m.marginPct }),
    );
  }
  const maxRevenue = Math.max(0, ...[...revenueById.values()]);
  const globalMaxPop = Math.max(1, ...[...cat.popById.values()]);

  // ── F4 objective features per POOL id. ─────────────────────────────────────
  const objCtx: ObjCtx = {
    modeMedoids,
    budgetBand: budgetBandMean,
    maxPopularity: globalMaxPop,
    maxRevenue,
  };
  const objById = new Map<string, Record<ObjectiveName, number>>();
  const sellerById = new Map<string, string>();
  for (const id of poolOrder) {
    const m = cat.meta.get(id)!;
    const objCand: ObjCandidate = {
      id,
      vector: cat.e1.get(id)!,
      priceBand: m.priceBand,
      price_cents: m.priceCents,
      margin_pct: m.marginPct,
      popularity: cat.popById.get(id) ?? 0,
      seller_age_days: m.sellerAgeDays,
    };
    objById.set(id, extractObjectiveFeatures(objCtx, objCand));
    sellerById.set(id, m.sellerId);
  }

  // ── Canonical candidates = FULL frame (catalog \ train) in E1. ─────────────
  const candidates: RankItem[] = allMinusTrain.map((id) => ({
    id,
    popularity: cat.popById.get(id) ?? 0,
    vector: cat.e1.get(id)!,
    cohort: cat.meta.get(id)?.cohort ?? null,
  }));

  // ctx: userVector = L2-normalized mean-pool of E1 history (f3 convention, as in
  // unified-cases). ctx.cohort = the seed cohort (no held-out test product exists,
  // so popular-cohort anchors to the session's dominant cohort — the realistic
  // production choice for a feed with no target item).
  const ctx: UserContext = {
    userVector: l2normalize(meanPool(history)),
    cohort: seedCohort === "__none__" ? null : seedCohort,
  };

  return {
    ctx,
    candidates,
    relevant: new Set<string>(), // no held-out purchase — IR metrics not reported.
    userId: profile.id,
    trainIds: train,
    lastViewedId: lv,
    giftSignal,
    intentGT: profile.intentGT,
    modes,
    pool,
    objById,
    revenueById,
    sellerById,
    popById: cat.popById,
    lvNpmi,
    budgetBandMode,
    budgetBandMean,
    buyerGender: userDemographic.gender,
    buyerAgeBand: userDemographic.ageBand,
    recipientGender,
    recipientAgeBand,
    lastViewedTitle: lv ? cat.meta.get(lv)?.title ?? null : null,
    e2: undefined, // adversarial path is E1-only (no e2_hybrid baseline here).
  };
}
