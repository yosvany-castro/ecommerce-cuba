/**
 * Generative behaviour model for the thesis evaluation framework.
 *
 * GENERATIVE STORY
 * ────────────────
 * Each SimUser has a LATENT STATE: a small set of preferred subcategories
 * (tasteSubcategories) and a preferred price tier (budgetBand).  These are
 * sampled once at user-creation time and are NEVER written to the output tables
 * that any ranking model will see — they only appear in `SimUser.latent_state`
 * which is used solely by the evaluation harness as ground truth.
 *
 * WHY THE TASTE IS LEARNABLE BUT NOT LEAKED
 * ──────────────────────────────────────────
 * The click model assigns a high affinity score (AFFINITY_IN_TASTE = 10) to
 * products in the user's taste subcategories and a low score (AFFINITY_OUT = 1)
 * to everything else.  The resulting event stream is statistically biased toward
 * the planted taste:  >50 % of product_view events land in taste subcategories
 * (validated by the concentration test).  A collaborative-filter or embedding
 * model can therefore *learn* the taste from co-occurrence — but the raw taste
 * labels are kept separate and no model is given direct access to them.  This is
 * the key epistemic property required by the thesis.
 *
 * GIFT SESSIONS
 * ─────────────
 * With probability p_gift a session becomes a gift purchase for one of the
 * user's pre-sampled recipients.  The click model then pivots: affinity is
 * driven by demographic match (gender + age band) rather than the shopper's own
 * taste.  This introduces realistic noise that prevents trivial taste recovery.
 *
 * TEMPORAL HOLDOUT — SESSION-LEVEL SPLIT (LEAKAGE-FREE)
 * ──────────────────────────────────────────────────────
 * The split granularity is the SESSION, not the individual purchase.  Rationale:
 * an examiner will ask "split at what granularity?" — the answer is session-level
 * so that no test item can co-occur with a train item inside the same basket.
 *
 * Policy:
 *   • Group each user's purchases by session.
 *   • If the user has purchases in ≥ 2 DISTINCT sessions: ALL purchases of the
 *     user's LAST purchasing session → split = "test"; every purchase in any
 *     earlier session → split = "train".
 *   • Otherwise (purchases in 0 or 1 session): all purchases → "train"
 *     (no test row for that user).
 *
 * Because session start times are STRICTLY increasing per user and every event
 * is STRICTLY after every event of all prior sessions, this guarantees:
 *   (1) every test purchase occurs strictly after every train purchase, and
 *   (2) the test session shares NO purchase with any train session
 *       — i.e. a co-occurrence recommender cannot recover the test item from
 *       the train basket.  This is the leakage-free temporal split the thesis
 *       claims.
 *
 * DETERMINISM
 * ───────────
 * All randomness is drawn from `makeRng(opts.seed)`.  Timestamps derive from
 * BASE_DATE_MS (a fixed epoch) + a per-user cumulative session offset that
 * strictly increases with session index — never from Date.now() and never from
 * a draw that could collide on the same instant.
 */

import { makeRng, type Rng } from "./rng";
import type { SynthProduct } from "./catalog-model";

// ─── Fixed epoch — all timestamps are offsets from this date ─────────────────
/** 2026-01-01T00:00:00Z in ms.  Never use Date.now() — all ts derived here. */
const BASE_DATE_MS = Date.parse("2026-01-01T00:00:00Z");
const MS_PER_DAY = 86_400_000;

// ─── Click-model coefficients (named for thesis readability) ─────────────────

/**
 * Affinity multiplier when a product's subcategory is in the user's taste.
 * High value (10) ensures taste signal clearly dominates noise, making it
 * learnable while remaining non-trivial (other products still appear).
 */
const AFFINITY_IN_TASTE = 10;

/**
 * Baseline affinity for out-of-taste products.  Kept at 1 (not 0) so the
 * user occasionally browses outside their taste — realistic serendipity.
 */
const AFFINITY_OUT = 1;

/**
 * How strongly budget mismatch suppresses a product's score.
 * score *= exp(-PRICE_PENALTY_COEFF * price_sensitivity * |priceBand - budgetBand|)
 */
const PRICE_PENALTY_COEFF = 0.7;

/** Small Gaussian noise std added to scores before ranking (prevents ties). */
const SCORE_NOISE_STD = 0.05;

/**
 * Affinity multiplier for a gift product whose gender/age matches the recipient.
 * Same magnitude as AFFINITY_IN_TASTE to produce comparable signal strength.
 */
const GIFT_AFFINITY_MATCH = 10;

/** Baseline affinity for gift products that don't match the recipient's profile. */
const GIFT_AFFINITY_MISMATCH = 1;

/** Cart conversion probability per viewed product. */
const P_CART = 0.4;

/** Purchase conversion probability per carted product. */
const P_BUY = 0.5;

/** Min/max number of products shown per session (top-k window). */
const VIEW_WINDOW_MIN = 4;
const VIEW_WINDOW_MAX = 8;

/** Min/max number of shopping sessions generated per user. */
const SESSIONS_PER_USER_MIN = 2;
const SESSIONS_PER_USER_MAX = 7;

/** Min/max number of taste subcategories assigned to each user. */
const TASTE_K_MIN = 1;
const TASTE_K_MAX = 3;

/** Max budget band index (inclusive). */
const BUDGET_BAND_MAX = 3;

/** p_gift upper bound when drawn from uniform (capped at 0.6 to keep self sessions dominant). */
const P_GIFT_NATURAL_MAX = 0.6;

/** price_sensitivity range [min, max]. */
const PRICE_SENS_MIN = 0.3;
const PRICE_SENS_RANGE = 0.7; // actual = min + rng.next() * range → [0.3, 1.0)

/** Each user has 1–3 recipients. */
const RECIPIENT_COUNT_MIN = 1;
const RECIPIENT_COUNT_MAX = 3;

// ─── Complement co-occurrence seeding (F0 spec §4.4) ──────────────────────────

/**
 * Probability that a SELF session, after picking its taste-driven items, also
 * pulls in ground-truth COMPLEMENTS of one of those items into the SAME basket.
 *
 * WHY THIS EXISTS — F0 spec §4.4 ("Co-ocurrencia intra-sesión sembrada desde el
 * grafo GT — los complementos se co-ven/co-compran"):
 * Without this, the only co-occurrence in the event stream comes from shared
 * taste subcategories, so the NPMI co-occurrence graph is ORTHOGONAL to the GT
 * complement graph (smartphone↔funda share no taste subcategory and never land
 * in the same basket by chance). Cross-sell is then unrecoverable. Seeding GT
 * complements into the same session makes anchor↔complement genuinely co-occur,
 * so NPMI recovers the GT complement graph — the thesis's central claim.
 *
 * Kept ADDITIVE and a minority of events (≈0.5 of self sessions add 1–2 items on
 * top of the 4–8 taste items) so the taste signal that F1/F2 rely on stays
 * dominant.
 */
const P_COMPLEMENT_SEED = 0.5;

/** Min/max number of GT complements injected into a seeded session. */
const COMPLEMENTS_PER_SESSION_MIN = 1;
const COMPLEMENTS_PER_SESSION_MAX = 2;

// ─── Recommender-mediated exposure (roadmap #6) ───────────────────────────────
// Motivation (auditoría destructiva 2026-06-09, hallazgo 6 "usuarios-oráculo,
// cero loop"): in v1/v2 every session shows the user the top of their OWN
// latent affinity over the full catalog — a perfect personal search engine.
// The recommender never influences exposure, so feedback-loop dynamics
// (position bias, degeneration, exploration value) are unmeasurable. The
// exposurePolicy knob closes the loop RecSim-style: "the store" picks the
// slate, the user examines it with a cascade and converts according to how
// much they actually like what they were shown.

/** Default cascade continuation probability when exposurePolicy is active. */
const CASCADE_LAMBDA_DEFAULT = 0.85;

/**
 * Floor/ceiling of the satisfaction multiplier s_i = score_i/AFFINITY_IN_TASTE
 * applied to the conversion funnel in the exposure regime. The 0.05 floor
 * mirrors the price-fit floor in scoreProduct: even a fully off-taste,
 * wrong-price exposed item converts at 5 % of the base funnel rate
 * (serendipity), never at exactly 0.
 */
const SATISFACTION_MIN = 0.05;
const SATISFACTION_MAX = 1;

// ─── Recipient profile pool ───────────────────────────────────────────────────

interface RecipientProfile {
  relation: string;
  gender: string;
  age_min: number;
  age_max: number;
}

/**
 * Fixed pool of gift recipient archetypes.  Drawn from by each user to populate
 * their recipients list.  Age ranges are intentionally broad to match AgeBand
 * boundaries: bebe[0-2], nino[3-12], joven[13-24], adulto[25-59], mayor[60+].
 */
const RECIPIENT_PROFILES: RecipientProfile[] = [
  { relation: "pareja",   gender: "femenino",  age_min: 25, age_max: 59 },
  { relation: "hijo",     gender: "masculino", age_min: 3,  age_max: 12 },
  { relation: "hija",     gender: "femenino",  age_min: 3,  age_max: 12 },
  { relation: "madre",    gender: "femenino",  age_min: 40, age_max: 75 },
  { relation: "padre",    gender: "masculino", age_min: 40, age_max: 75 },
  { relation: "amigo",    gender: "masculino", age_min: 13, age_max: 35 },
  { relation: "amiga",    gender: "femenino",  age_min: 13, age_max: 35 },
  { relation: "abuelo",   gender: "masculino", age_min: 60, age_max: 90 },
  { relation: "abuela",   gender: "femenino",  age_min: 60, age_max: 90 },
  { relation: "bebe",     gender: "unisex",    age_min: 0,  age_max: 2  },
] as const;

// ─── AgeBand → numeric range map ─────────────────────────────────────────────

const AGE_BAND_RANGE: Record<string, [number, number]> = {
  bebe:   [0,   2],
  nino:   [3,   12],
  joven:  [13,  24],
  adulto: [25,  59],
  mayor:  [60,  120],
};

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface SimUser {
  user_id: string;
  latent_state: { tasteSubcategories: string[]; budgetBand: number };
  p_gift: number;
  price_sensitivity: number;
  recipients: { id: string; relation: string; gender: string; age_min: number; age_max: number }[];
}

export interface SimSession {
  session_id: string;
  user_id: string;
  intent: "self" | "gift";
  recipient_id: string | null;
  started_at: string;
}

export interface SimEvent {
  user_id: string;
  session_id: string;
  event_type: "product_view" | "add_to_cart" | "purchase";
  product_id: string;
  occurred_at: string;
}

export interface HoldoutRow {
  user_id: string;
  product_id: string;
  occurred_at: string;
  split: "train" | "test";
}

export interface BehaviorOutput {
  users: SimUser[];
  sessions: SimSession[];
  events: SimEvent[];
  holdout: HoldoutRow[];
}

export interface BehaviorOpts {
  users: number;
  days: number;
  seed: number;
  pGiftOverride?: number;

  // ── v2 realism knobs (all optional; omitted ⇒ output BIT-IDENTICAL to v1) ──
  // Motivation (auditoría destructiva 2026-06-09): the v1 world has quasi-flat
  // item popularity (purchase Gini ≈ 0.41, top-10 % of items ≈ 26 % of sales),
  // which dooms popularity baselines BY CONSTRUCTION and manufactures the
  // "edge grows with catalog size" narrative. Real online retail is heavy-
  // tailed: ≈ 72/28 (top 20 % of SKUs ≈ 72 % of sales; Brynjolfsson, Hu &
  // Simester 2011, Management Science). v1 also has NO price elasticity
  // (P(buy|view) constant), which lets revenue-tilted rankers push expensive
  // items at zero conversion cost, and a gift prevalence of ~30 % of sessions
  // (real stores: 5–10 %).

  /**
   * Zipf exponent `s` for INTRINSIC item attractiveness. When set, each item
   * gets attractiveness ∝ rank^(−s) over a seed-shuffled rank assignment
   * (mean-normalized to 1), multiplied into the view-choice score. s = 0.8
   * reproduces ≈ 72/28 attractiveness mass on a 5000-item catalog
   * (Σ k^−0.8 ≈ x^0.2/0.2 ⇒ top-20 % share ≈ 0.2^0.2 ≈ 0.72).
   * Undefined ⇒ off (v1: popularity is emergent taste noise only).
   */
  zipfS?: number;
  /**
   * Exponent applied to the normalized attractiveness inside the score
   * (score = affinity · priceFit · att^eta + noise). Dampens how much
   * bestsellers transcend personal taste. Default 1 when zipfS is set.
   */
  zipfEta?: number;
  /**
   * Price elasticity γ of CONVERSION (MNL-style price term in the utility):
   * P(cart) and P(buy) are multiplied by exp(−γ · price_sensitivity ·
   * priceBand/3). 0/undefined ⇒ off (v1: conversion independent of price).
   * γ ≈ 0.8 ⇒ a max-band item converts ≈ 45–79 % as often, per sensitivity.
   */
  priceGamma?: number;
  /**
   * Upper bound of the natural p_gift draw (p_gift ~ U[0, pGiftMax]).
   * Default 0.6 (v1, mean ≈ 30 % gift sessions). Realistic: 0.16 ⇒ mean ≈ 8 %.
   */
  pGiftMax?: number;
  /**
   * Stochastic basket choice: sample the view window WITHOUT replacement with
   * probability ∝ score (Plackett–Luce / sequential MNL) instead of the v1
   * deterministic top-k. Uses a SEPARATE rng stream so v1 runs are untouched.
   */
  stochasticChoice?: boolean;
  /**
   * Recommender-mediated exposure (roadmap #6 — closes the feedback loop):
   * returns the RANKED slate of source_product_ids "the store" shows for this
   * session. When present, the basket is NOT chosen by argmax/Plackett–Luce
   * over the catalog; the user examines the slate via a cascade (see
   * cascadeLambda) and converts through the existing funnel gated by a
   * satisfaction term — a bad slate converts poorly, which IS the feedback
   * signal a closed loop learns from. All new draws (cascade continuation and
   * whatever the policy draws via ctx.rng) come from the EXISTING rngV2
   * stream, preserving the guarantee that omitting every v2 knob yields
   * BIT-IDENTICAL v1 output. An empty or unresolvable slate makes the session
   * fall back to organic (catalog-scored) behaviour.
   */
  exposurePolicy?: (ctx: ExposureContext) => string[];
  /**
   * Cascade continuation probability (cascade click model): slot 0 is always
   * examined; after examining slot j the user moves to slot j+1 with this
   * probability (one rngV2 draw per transition). Default 0.85 ⇒ E[examined]
   * ≈ 6.2 on a 20-slot slate — comparable to the organic VIEW_WINDOW of 4–8.
   * Only consulted when exposurePolicy is present (no-op otherwise).
   */
  cascadeLambda?: number;
}

/**
 * Context handed to an exposurePolicy at the START of each session — only
 * information "the store" could plausibly have plus the simulation handles the
 * policy needs to stay deterministic. NOTE: `user` includes latent_state;
 * honest policies must not read it (it is ground truth) — oracle policies in
 * tests/experiments may, explicitly labelled as such.
 */
export interface ExposureContext {
  user: SimUser;
  /** 0-based index of this session within the user's session sequence. */
  sessionIndex: number;
  isGift: boolean;
  /** Demographics of the gift recipient (gift sessions only), else null. */
  recipient: { gender: string; age_min: number; age_max: number } | null;
  /** The shared rngV2 stream — the ONLY randomness a policy may use. */
  rng: Rng;
}

/**
 * Map from a product's `source_product_id` to the `source_product_id`s of its
 * GROUND-TRUTH complements (relation_type='complement'). Built by the caller via
 * `buildRelations(catalog)` filtered to complements. When provided (non-empty),
 * SELF sessions probabilistically seed these complements into the same basket so
 * NPMI co-occurrence recovers the GT complement graph (F0 spec §4.4). When empty
 * or omitted, behaviour is identical to the pre-§4.4 generator (taste-only).
 */
export type ComplementsBySource = Map<string, readonly string[]>;

// ─── UUID v4 generator ────────────────────────────────────────────────────────

/**
 * Generate a UUID v4 string from the shared Rng.
 * Layout: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 *   version nibble = 4
 *   variant nibble = one of [8,9,a,b]
 * This satisfies the regex /^[0-9a-f]{8}-...-4...-[89ab]...-[0-9a-f]{12}$/.
 */
function makeUuidV4(rng: ReturnType<typeof makeRng>): string {
  // 32 random hex nibbles → 16 bytes
  const hex = Array.from({ length: 32 }, () => rng.int(16).toString(16)).join("");
  // UUID v4 layout (no hyphens, 32 hex chars):
  //   [0..7]  time_low              (8 hex)
  //   [8..11] time_mid              (4 hex)
  //   [12..15] time_hi_and_version  (4 hex) — char 12 MUST be '4'
  //   [16..19] clock_seq            (4 hex) — char 16 MUST be in [89ab]
  //   [20..31] node                 (12 hex)
  const withVersion =
    hex.slice(0, 12) + "4" + hex.slice(13);            // 32 chars: inject version at 12
  const variantNibble = ["8", "9", "a", "b"][rng.int(4)];
  const full =
    withVersion.slice(0, 16) + variantNibble + withVersion.slice(17); // 32 chars: inject variant at 16
  return (
    full.slice(0, 8)  + "-" +
    full.slice(8, 12) + "-" +
    full.slice(12, 16) + "-" +
    full.slice(16, 20) + "-" +
    full.slice(20, 32)
  );
}

// ─── Timestamp helper ─────────────────────────────────────────────────────────

/** Convert a millisecond offset from BASE_DATE_MS to an ISO 8601 string. */
function msOffsetToIso(msOffset: number): string {
  return new Date(BASE_DATE_MS + Math.floor(msOffset)).toISOString();
}

/**
 * Minimum strictly-positive gap (ms) added per session index so that
 * session s+1 always starts after session s for the SAME user, even when the
 * random day spread would otherwise collide on the same instant.  One minute is
 * far larger than the per-event second-granularity spacing, so sessions can
 * never interleave in time.
 */
const SESSION_INDEX_GAP_MS = 60_000; // 1 minute per session index

/** Strictly-increasing per-event spacing (ms). 1 second guarantees ordering. */
const EVENT_STEP_MS = 1_000;

// ─── Distinct subcategory extractor ──────────────────────────────────────────

function distinctSubcategories(catalog: SynthProduct[]): string[] {
  const seen = new Set<string>();
  for (const p of catalog) seen.add(p.attrs.subcategory);
  // Sort for determinism regardless of catalog ordering
  return [...seen].sort();
}

// ─── Age-band overlap helper ──────────────────────────────────────────────────

/**
 * Returns true if the product's age band range overlaps the recipient's
 * [age_min, age_max].  Overlap = the ranges share at least one integer year.
 */
function ageBandFitsRecipient(ageBand: string, recipientAgeMin: number, recipientAgeMax: number): boolean {
  const range = AGE_BAND_RANGE[ageBand];
  if (!range) return false;
  return range[0] <= recipientAgeMax && range[1] >= recipientAgeMin;
}

// ─── Click-model score ────────────────────────────────────────────────────────

/**
 * Compute the affinity score of `product` for a given shopping context.
 *
 * For SELF sessions: affinity = AFFINITY_IN_TASTE if subcategory ∈ taste, else AFFINITY_OUT.
 * For GIFT sessions: affinity = GIFT_AFFINITY_MATCH if gender and age both fit recipient.
 *
 * Price fit: exp(-PRICE_PENALTY_COEFF * price_sensitivity * |priceBand - budgetBand|).
 * Small Gaussian noise prevents degenerate ties that would make the ranking
 * trivially deterministic within a score tier.
 */
function scoreProduct(
  product: SynthProduct,
  tasteSubs: Set<string>,
  budgetBand: number,
  priceSensitivity: number,
  isGift: boolean,
  recipient: RecipientProfile | null,
  noise: number,
  attFactor = 1,
): number {
  let affinity: number;

  if (isGift && recipient !== null) {
    const genderMatch =
      product.attrs.gender === "unisex" ||
      product.attrs.gender === recipient.gender;
    const ageMatch = ageBandFitsRecipient(product.attrs.ageBand, recipient.age_min, recipient.age_max);
    affinity = genderMatch && ageMatch ? GIFT_AFFINITY_MATCH : GIFT_AFFINITY_MISMATCH;
  } else {
    affinity = tasteSubs.has(product.attrs.subcategory) ? AFFINITY_IN_TASTE : AFFINITY_OUT;
  }

  const priceDelta = Math.abs(product.attrs.priceBand - budgetBand);
  // exp(...) ∈ (0, 1]; clamp to a small positive floor so a large budget
  // mismatch can never drive price-fit to ~0 (which would let additive noise
  // invert the affinity ranking) and never goes negative.
  const priceFit = Math.max(0.05, Math.exp(-PRICE_PENALTY_COEFF * priceSensitivity * priceDelta));

  // attFactor = att^eta (v2 Zipf attractiveness; 1 when the knob is off) —
  // multiplicative so bestsellers can transcend taste, as in real demand.
  return affinity * priceFit * attFactor + noise;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Generate the full synthetic behavioural dataset.
 *
 * @param catalog - Output of sampleCatalog(); treated as read-only.
 * @param opts    - Simulation parameters.  All randomness comes from makeRng(opts.seed).
 * @param complementsBySource - Optional GT complement adjacency (source_product_id →
 *   complement source_product_ids). When provided, SELF sessions seed complements
 *   into the same basket per F0 spec §4.4. Defaults to empty (taste-only behaviour).
 */
export function sampleBehavior(
  catalog: SynthProduct[],
  opts: BehaviorOpts,
  complementsBySource: ComplementsBySource = new Map(),
): BehaviorOutput {
  const rng = makeRng(opts.seed);

  // ── v2 knobs — every v2-only draw comes from a SEPARATE rng stream so that
  // default opts leave the main stream untouched (bit-identical v1 output). ──
  const rngV2 = makeRng((opts.seed ^ 0x9e3779b9) >>> 0);
  const zipfEta = opts.zipfEta ?? 1;

  /** Intrinsic attractiveness^eta per product (mean-normalized Zipf); empty when off. */
  const attFactorById = new Map<string, number>();
  if (opts.zipfS !== undefined && opts.zipfS > 0) {
    // Seed-shuffled rank assignment: which product is the bestseller is random,
    // but the SHAPE of demand is Zipf(s) — heavy-tailed like real retail.
    const ids = catalog.map((p) => p.source_product_id).sort((a, b) => a.localeCompare(b));
    for (let i = ids.length - 1; i > 0; i--) {
      const j = rngV2.int(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    let sum = 0;
    const raw: number[] = [];
    for (let r = 0; r < ids.length; r++) {
      const a = Math.pow(r + 1, -opts.zipfS);
      raw.push(a);
      sum += a;
    }
    const meanAtt = sum / ids.length;
    for (let r = 0; r < ids.length; r++) {
      attFactorById.set(ids[r], Math.pow(raw[r] / meanAtt, zipfEta));
    }
  }

  /** Conversion elasticity factor exp(−γ·sens·band/3) ∈ (0,1]; 1 when off. */
  const elasticity = (priceBand: number, priceSensitivity: number): number =>
    opts.priceGamma !== undefined && opts.priceGamma > 0
      ? Math.exp(-opts.priceGamma * priceSensitivity * (priceBand / BUDGET_BAND_MAX))
      : 1;

  const allSubs = distinctSubcategories(catalog);

  // Index catalog by source_product_id so seeded complements (looked up by id in
  // the GT graph) resolve to the actual SynthProduct that goes through the funnel.
  const productById = new Map<string, SynthProduct>();
  for (const p of catalog) productById.set(p.source_product_id, p);

  // ── 1. Generate users ────────────────────────────────────────────────────────
  const users: SimUser[] = [];
  for (let i = 0; i < opts.users; i++) {
    const k = TASTE_K_MIN + rng.int(TASTE_K_MAX - TASTE_K_MIN + 1); // [1,3]
    // Sample k distinct taste subcategories without replacement
    const shuffled = [...allSubs];
    for (let j = 0; j < k; j++) {
      const idx = j + rng.int(shuffled.length - j);
      [shuffled[j], shuffled[idx]] = [shuffled[idx], shuffled[j]];
    }
    const tasteSubcategories = shuffled.slice(0, k);
    const budgetBand = rng.int(BUDGET_BAND_MAX + 1); // [0,3]
    const p_gift =
      opts.pGiftOverride !== undefined
        ? opts.pGiftOverride
        : rng.next() * (opts.pGiftMax ?? P_GIFT_NATURAL_MAX);
    const price_sensitivity = PRICE_SENS_MIN + rng.next() * PRICE_SENS_RANGE;

    // 1–3 recipients drawn from the fixed pool (allow repeats for small pools)
    const numRecipients = RECIPIENT_COUNT_MIN + rng.int(RECIPIENT_COUNT_MAX - RECIPIENT_COUNT_MIN + 1);
    const recipients = Array.from({ length: numRecipients }, () => {
      const profile = rng.pick(RECIPIENT_PROFILES);
      return { id: makeUuidV4(rng), ...profile };
    });

    users.push({
      user_id: makeUuidV4(rng),
      latent_state: { tasteSubcategories, budgetBand },
      p_gift,
      price_sensitivity,
      recipients,
    });
  }

  // ── 2. Generate sessions + events ────────────────────────────────────────────
  const sessions: SimSession[] = [];
  const events: SimEvent[] = [];

  for (const user of users) {
    const tasteSubsSet = new Set(user.latent_state.tasteSubcategories);
    const numSessions = SESSIONS_PER_USER_MIN + rng.int(SESSIONS_PER_USER_MAX - SESSIONS_PER_USER_MIN + 1);

    // Space session start times across the days window with random jitter, but
    // make the start STRICTLY increasing per user.  The random day spread keeps
    // realism; the `si * SESSION_INDEX_GAP_MS` term guarantees session s+1 starts
    // strictly after session s even if the random spread collides on the same
    // instant.  Per-event spacing (EVENT_STEP_MS, seconds) is always smaller than
    // SESSION_INDEX_GAP_MS (a minute), so a session's events can never overlap the
    // next session's start.
    let dayCursor = rng.next() * (opts.days / numSessions);

    for (let si = 0; si < numSessions; si++) {
      const sessionDay = dayCursor;
      dayCursor += rng.next() * ((opts.days - dayCursor) / (numSessions - si));

      // Strictly-increasing session start in ms from BASE_DATE_MS.
      const sessionStartMs = sessionDay * MS_PER_DAY + si * SESSION_INDEX_GAP_MS;

      const isGift = rng.next() < user.p_gift;
      const recipient =
        isGift && user.recipients.length > 0 ? rng.pick(user.recipients) : null;

      const session: SimSession = {
        session_id: makeUuidV4(rng),
        user_id: user.user_id,
        intent: isGift ? "gift" : "self",
        recipient_id: isGift && recipient ? recipient.id : null,
        started_at: msOffsetToIso(sessionStartMs),
      };
      sessions.push(session);

      // Recipient profile reused by organic scoring, exposure satisfaction
      // and the policy context (identical shape to the previous inline object).
      const recipientProfile: RecipientProfile | null = recipient
        ? { relation: recipient.relation, gender: recipient.gender, age_min: recipient.age_min, age_max: recipient.age_max }
        : null;
      const attOf = (p: SynthProduct): number =>
        attFactorById.size > 0 ? (attFactorById.get(p.source_product_id) ?? 1) : 1;

      // ── Basket selection: exposure-mediated OR organic ───────────────────────
      // Exposure regime (roadmap #6): "the store" decides what the user sees;
      // the user examines the slate via a cascade. Organic regime (default):
      // the user scores the whole catalog and picks top-k / Plackett–Luce —
      // bit-identical to v1/v2 when exposurePolicy is absent.
      let basket: SynthProduct[] | null = null;
      /**
       * Per-item conversion gate (exposure regime only): satisfaction
       * s_i = score_i/AFFINITY_IN_TASTE ∈ [SATISFACTION_MIN, SATISFACTION_MAX]
       * multiplies P_CART and P_BUY so a slate the user dislikes converts
       * poorly — that low conversion IS the closed-loop feedback. null in the
       * organic regime; items absent from the map (seeded complements) convert
       * at the plain funnel rate (sat = 1) because the user pulled them in.
       */
      let satisfactionById: Map<string, number> | null = null;

      if (opts.exposurePolicy) {
        const slate = opts.exposurePolicy({
          user,
          sessionIndex: si,
          isGift,
          recipient: recipientProfile
            ? { gender: recipientProfile.gender, age_min: recipientProfile.age_min, age_max: recipientProfile.age_max }
            : null,
          rng: rngV2,
        });
        // Resolve ids → products, dropping unknown ids and duplicates while
        // preserving the policy's ranking order.
        const resolved: SynthProduct[] = [];
        const seenSlate = new Set<string>();
        for (const id of slate) {
          const p = productById.get(id);
          if (p !== undefined && !seenSlate.has(id)) {
            seenSlate.add(id);
            resolved.push(p);
          }
        }
        if (resolved.length > 0) {
          // Cascade examination (cascade click model): slot 0 is ALWAYS
          // examined; after slot j the user continues to slot j+1 with
          // probability cascadeLambda. Every draw comes from rngV2 so the
          // no-knob output stays bit-identical to v1.
          const lambda = opts.cascadeLambda ?? CASCADE_LAMBDA_DEFAULT;
          basket = [resolved[0]];
          for (let j = 1; j < resolved.length; j++) {
            if (rngV2.next() >= lambda) break;
            basket.push(resolved[j]);
          }
          // Satisfaction from the NOISELESS click-model score (noise = 0, with
          // the item's attFactor) — the same latent utility that drives organic
          // choice, so both regimes share one ground truth.
          satisfactionById = new Map<string, number>();
          for (const p of basket) {
            const s = scoreProduct(
              p,
              tasteSubsSet,
              user.latent_state.budgetBand,
              user.price_sensitivity,
              isGift,
              recipientProfile,
              0,
              attOf(p),
            );
            satisfactionById.set(
              p.source_product_id,
              Math.min(SATISFACTION_MAX, Math.max(SATISFACTION_MIN, s / AFFINITY_IN_TASTE)),
            );
          }
        }
        // Empty/unresolvable slate ⇒ basket stays null ⇒ organic fallback below.
      }

      if (basket === null) {
        // Score catalog and pick top-k products to show
        const viewWindow = VIEW_WINDOW_MIN + rng.int(VIEW_WINDOW_MAX - VIEW_WINDOW_MIN + 1);
        const scored = catalog.map((p) => ({
          p,
          score: scoreProduct(
            p,
            tasteSubsSet,
            user.latent_state.budgetBand,
            user.price_sensitivity,
            isGift,
            recipientProfile,
            rng.gaussian() * SCORE_NOISE_STD,
            attOf(p),
          ),
        }));
        if (opts.stochasticChoice) {
          // Plackett–Luce / sequential-MNL sampling WITHOUT replacement ∝ score:
          // popularity emerges across users instead of every same-taste user
          // seeing the identical deterministic top-k. Draws come from rngV2.
          const pool = scored.map((s) => ({ p: s.p, w: Math.max(s.score, 1e-6) }));
          basket = [];
          for (let pick = 0; pick < viewWindow && pool.length > 0; pick++) {
            let total = 0;
            for (const x of pool) total += x.w;
            let r = rngV2.next() * total;
            let idx = 0;
            for (; idx < pool.length - 1; idx++) {
              r -= pool[idx].w;
              if (r <= 0) break;
            }
            basket.push(pool[idx].p);
            pool.splice(idx, 1);
          }
        } else {
          // v1: deterministic top-k (ties broken by insertion order).
          scored.sort((a, b) => b.score - a.score);
          basket = scored.slice(0, viewWindow).map((s) => s.p);
        }
      }

      // ── Complement co-occurrence seeding (F0 spec §4.4) ────────────────────
      // For SELF sessions only (gift sessions pivot to demographic match, so a
      // GT complement of a taste item is not the right intent there), with
      // probability P_COMPLEMENT_SEED, pull 1–2 GT complements of one of the
      // basket's items INTO THE SAME basket. These extra items are co-viewed
      // (and may convert via the same funnel) so NPMI links anchor↔complement.
      //
      // Leakage-free split is preserved because the complements live in the SAME
      // session as their anchor — they share that session's train/test fate
      // exactly like the taste items; no cross-session injection occurs.
      if (!isGift && complementsBySource.size > 0 && rng.next() < P_COMPLEMENT_SEED) {
        // Candidate anchors = basket items that actually have GT complements
        // present in this catalog. Sorted by id then chosen via rng → deterministic.
        const inBasket = new Set(basket.map((p) => p.source_product_id));
        const anchors = basket
          .filter((p) => {
            const comps = complementsBySource.get(p.source_product_id);
            return comps !== undefined && comps.length > 0;
          })
          .sort((a, b) => a.source_product_id.localeCompare(b.source_product_id));

        if (anchors.length > 0) {
          const anchor = anchors[rng.int(anchors.length)];
          // Complement source ids not already in the basket, sorted for determinism.
          const compIds = [...(complementsBySource.get(anchor.source_product_id) ?? [])]
            .filter((id) => !inBasket.has(id) && productById.has(id))
            .sort((a, b) => a.localeCompare(b));

          if (compIds.length > 0) {
            const want =
              COMPLEMENTS_PER_SESSION_MIN +
              rng.int(COMPLEMENTS_PER_SESSION_MAX - COMPLEMENTS_PER_SESSION_MIN + 1);
            const take = Math.min(want, compIds.length);
            // Partial Fisher–Yates over a copy to pick `take` distinct complements.
            const pool = [...compIds];
            for (let j = 0; j < take; j++) {
              const idx = j + rng.int(pool.length - j);
              [pool[j], pool[idx]] = [pool[idx], pool[j]];
              const comp = productById.get(pool[j]);
              if (comp) {
                basket.push(comp);
                inBasket.add(comp.source_product_id);
              }
            }
          }
        }
      }

      // Emit product_view → add_to_cart → purchase chain per product.
      // `eventCounter` strictly increases within the session, giving every event
      // a unique, strictly-ordered occurred_at = sessionStart + counter seconds.
      // Because the max in-session offset (events * EVENT_STEP_MS) stays well
      // below SESSION_INDEX_GAP_MS, all events of session s are strictly before
      // session s+1's start — so every event has a globally well-defined order
      // per user.
      let eventCounter = 0;
      const eventTs = (): string =>
        msOffsetToIso(sessionStartMs + ++eventCounter * EVENT_STEP_MS);
      for (const p of basket) {
        events.push({
          user_id: user.user_id,
          session_id: session.session_id,
          event_type: "product_view",
          product_id: p.source_product_id,
          occurred_at: eventTs(),
        });

        // v2 price elasticity: expensive items (relative to the buyer's
        // sensitivity) convert less. ef = 1 when the knob is off (v1).
        const ef = elasticity(p.attrs.priceBand, user.price_sensitivity);
        // Exposure-regime satisfaction gate; sat = 1 in the organic regime and
        // for seeded complements. Multiplying by exactly 1 is an IEEE no-op,
        // so the no-knob output stays bit-identical.
        const sat =
          satisfactionById === null ? 1 : (satisfactionById.get(p.source_product_id) ?? 1);
        if (rng.next() < P_CART * ef * sat) {
          events.push({
            user_id: user.user_id,
            session_id: session.session_id,
            event_type: "add_to_cart",
            product_id: p.source_product_id,
            occurred_at: eventTs(),
          });

          if (rng.next() < P_BUY * ef * sat) {
            events.push({
              user_id: user.user_id,
              session_id: session.session_id,
              event_type: "purchase",
              product_id: p.source_product_id,
              occurred_at: eventTs(),
            });
          }
        }
      }
    }
  }

  // ── 3. Build SESSION-LEVEL temporal holdout (leakage-free) ─────────────────────
  // Policy (see header doc): group each user's purchases by session; if the user
  // has purchases in ≥2 distinct sessions, ALL purchases of the user's LAST
  // purchasing session → "test" and every earlier-session purchase → "train".
  // Otherwise all purchases → "train".  Because session start times strictly
  // increase per user and every event is strictly after every prior session's
  // events, the test session is guaranteed to be strictly after — and disjoint
  // in products from — all train sessions of that user.
  const holdout: HoldoutRow[] = [];

  // session_id → its strictly-increasing start (ms order key) for the owning user
  const sessionStartIso = new Map<string, string>();
  for (const s of sessions) sessionStartIso.set(s.session_id, s.started_at);

  // Group purchases by user, then by session.
  const purchasesByUser = new Map<string, Map<string, SimEvent[]>>();
  for (const ev of events) {
    if (ev.event_type !== "purchase") continue;
    let bySession = purchasesByUser.get(ev.user_id);
    if (!bySession) {
      bySession = new Map<string, SimEvent[]>();
      purchasesByUser.set(ev.user_id, bySession);
    }
    const arr = bySession.get(ev.session_id) ?? [];
    arr.push(ev);
    bySession.set(ev.session_id, arr);
  }

  for (const [userId, bySession] of purchasesByUser) {
    // Order this user's purchasing sessions by their (strictly-increasing) start.
    const orderedSessionIds = [...bySession.keys()].sort((a, b) =>
      (sessionStartIso.get(a) ?? "").localeCompare(sessionStartIso.get(b) ?? ""),
    );
    const distinctSessions = orderedSessionIds.length;
    const lastSessionId = orderedSessionIds[distinctSessions - 1];
    const hasTestSession = distinctSessions >= 2;

    // Products purchased in any EARLIER (train) session.  A product that also
    // appears in the last session is NOT a valid holdout — the model already saw
    // it in train — so it stays train-only (removed from the test set below).
    const trainProducts = new Set<string>();
    if (hasTestSession) {
      for (const sessionId of orderedSessionIds) {
        if (sessionId === lastSessionId) continue;
        for (const ev of bySession.get(sessionId)!) trainProducts.add(ev.product_id);
      }
    }

    for (const sessionId of orderedSessionIds) {
      const isTestSession = hasTestSession && sessionId === lastSessionId;

      // Deduplicate purchases on product_id within the session, keeping the
      // latest occurrence (deterministic: occurred_at is strictly increasing).
      const dedupedMap = new Map<string, SimEvent>();
      for (const ev of bySession.get(sessionId)!) dedupedMap.set(ev.product_id, ev);
      const deduped = [...dedupedMap.values()].sort((a, b) =>
        a.occurred_at.localeCompare(b.occurred_at),
      );

      for (const ev of deduped) {
        if (isTestSession && trainProducts.has(ev.product_id)) {
          // This product was already purchased in a train session, so it is
          // already in the train holdout via its earlier row.  Adding it again
          // here (as a late "train" row in the test session) would push the
          // train time window past the test rows and break the strict temporal
          // ordering; and labelling it "test" would leak.  Drop it entirely:
          // the product is represented by its earlier train row.
          continue;
        }
        const split: "train" | "test" = isTestSession ? "test" : "train";
        holdout.push({
          user_id: userId,
          product_id: ev.product_id,
          occurred_at: ev.occurred_at,
          split,
        });
      }
    }
  }

  return { users, sessions, events, holdout };
}
