import type { ExposureContext } from "@/thesis/data/behavior-model";
import { selectPlacements } from "@/sectors/f-slate/select";
import { DEFAULT_PLACEMENTS, type PlacementConfig } from "@/sectors/f-slate/config";
import type { SlateRuleContext } from "@/sectors/f-slate/rules/types";
import { SECTION_REGISTRY } from "@/sectors/f-slate/sections/registry";
import { applyEpsilonExploration } from "@/sectors/d-personalization/explore/epsilon";
import { isHoldout } from "@/sectors/d-personalization/holdout";
import { EPSILON, SLATE_K } from "./constants";
import { resolveSimSection, type SimSectionCtx } from "./sections";
import type { ArmArtifacts } from "./crons";
import type { ArmLog } from "./ledger";
import type { World } from "./world";

/**
 * El puente exposurePolicy (blueprint §5.8): UN solo compositor para ambos
 * brazos — selectPlacements IMPORTADA de f-slate/select (el mismo código que
 * compose.ts, anti-H7), claiming por prioridad + min_items espejo de
 * resolve.ts, ε-greedy con applyEpsilonExploration real (rng = ctx.rng, el
 * ÚNICO stream legal), truncado a SLATE_K.
 *
 * 0 placements ⇒ DEFAULT_PLACEMENTS, JAMÁS [] — un slate vacío activaría el
 * régimen ORGÁNICO del generador (el buscador personal perfecto del usuario):
 * el exploit del fallback orgánico-oráculo queda bloqueado (anti-trampa #7).
 *
 * Holdout 10% del brazo agente: usuarios isHoldout (salt fijo del módulo de
 * producción) reciben SIEMPRE la composición congelada; sus compras cuentan
 * en el total del brazo (A3 §4).
 */

export interface ExposedItem {
  product_id: string;
  placement_id: string;
  section_type: string;
  placement_version: number;
  source: "exploit" | "explore";
  propensity: number;
}

export interface SessionExposure {
  userId: string;
  policyArm: "default" | "holdout";
  items: ExposedItem[];
}

export interface UserState {
  viewedSubsByUser: Map<string, (string | null)[]>;
  lastViewedByUser: Map<string, string>;
  cohortByUser: Map<string, string | null>;
  viewCountByUser: Map<string, number>;
}

/** Estado por usuario derivado del log del brazo, SOLO épocas < t. */
export function buildUserState(log: ArmLog, t: number, world: World): UserState {
  const seenByUser = new Map<string, Set<string>>();
  const viewedSubsByUser = new Map<string, (string | null)[]>();
  const lastViewedByUser = new Map<string, string>();
  for (const e of log.events) {
    if (e.epoch >= t || e.event_type !== "product_view") continue;
    let seen = seenByUser.get(e.user_id);
    if (!seen) {
      seen = new Set();
      seenByUser.set(e.user_id, seen);
    }
    if (!seen.has(e.product_id)) {
      seen.add(e.product_id);
      const subs = viewedSubsByUser.get(e.user_id) ?? [];
      subs.push(world.subcategoryOf(e.product_id));
      viewedSubsByUser.set(e.user_id, subs);
    }
    lastViewedByUser.set(e.user_id, e.product_id); // events vienen en orden temporal
  }
  const cohortByUser = new Map<string, string | null>();
  const viewCountByUser = new Map<string, number>();
  for (const [uid, subs] of viewedSubsByUser) {
    viewCountByUser.set(uid, subs.length);
    // moda con desempate lexicográfico (≡ modeOfStr de exp-K)
    const counts = new Map<string, number>();
    for (const s of subs) if (s !== null) counts.set(s, (counts.get(s) ?? 0) + 1);
    let best: string | null = null;
    let bc = 0;
    for (const [s, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (c > bc) {
        best = s;
        bc = c;
      }
    }
    cohortByUser.set(uid, best);
  }
  return { viewedSubsByUser, lastViewedByUser, cohortByUser, viewCountByUser };
}

/** hour/day deterministas por (user, sessionIndex): el started_at del
 *  generador no es visible para la política — pseudo-reloj estable entre
 *  brazos, sin consumir rng (desviación declarada). */
function pseudoClock(userId: string, sessionIndex: number): { hour: number; dow: number } {
  let h = 2166136261 >>> 0;
  const s = `${userId}|${sessionIndex}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return { hour: h % 24, dow: Math.floor(h / 24) % 7 };
}

export interface ArmPolicyArgs {
  /** Filas servibles del brazo en la frontera t (store.selectableRows). */
  rows: PlacementConfig[];
  /** Composición congelada para usuarios holdout (brazo agente); null = sin holdout. */
  holdoutRows: PlacementConfig[] | null;
  artifacts: ArmArtifacts;
  userState: UserState;
  world: World;
  epoch: number;
}

export interface ArmPolicy {
  policy: (ctx: ExposureContext) => string[];
  /** Una entrada por invocación, en orden — zip con out.sessions en ingestEpoch. */
  exposures: SessionExposure[];
}

export function makeArmPolicy(args: ArmPolicyArgs): ArmPolicy {
  const { world, epoch, artifacts, userState } = args;
  const active = world.activeIds(epoch);
  const popOf = (id: string) => artifacts.popularity.get(id) ?? 0;
  const byPop = (a: string, b: string) => popOf(b) - popOf(a) || a.localeCompare(b);
  const activeByPop = [...active].sort(byPop);
  const popularRank = activeByPop.filter((id) => popOf(id) > 0);
  const heroCache = new Map<string, string[]>();
  const exposures: SessionExposure[] = [];

  const policy = (ctx: ExposureContext): string[] => {
    const uid = ctx.user.user_id;
    const holdout =
      args.holdoutRows !== null && isHoldout({ user_id: uid, anonymous_id: null });
    const rows = holdout ? args.holdoutRows! : args.rows;

    const { hour, dow } = pseudoClock(uid, ctx.sessionIndex);
    const ruleCtx: SlateRuleContext = {
      surface: "home",
      hour_of_day: hour,
      day_of_week: dow,
      is_logged_in: true,
      user_segment: null,
      session_cohort: userState.cohortByUser.get(uid) ?? null,
      recipient_active: false, // detector real precision ~13% — dárselo sería oráculo (2.C.3)
      signal_window_size: userState.viewCountByUser.get(uid) ?? 0,
      gift_confirmed: false,
      cart_item_count: 0,
      pdp_product_id: null,
      pdp_category: null,
    };

    let selected = selectPlacements(rows, ruleCtx);
    if (selected.length === 0) selected = DEFAULT_PLACEMENTS.home; // anti-trampa #7

    const sectionCtx: SimSectionCtx = {
      userId: uid,
      sessionCohort: ruleCtx.session_cohort,
      artifacts,
      popularRank,
      activeByPop,
      activeIds: active,
      lastViewed: userState.lastViewedByUser.get(uid) ?? null,
      viewedSubs: userState.viewedSubsByUser.get(uid) ?? [],
      subcategoryOf: world.subcategoryOf,
      popOf,
      heroCache,
    };

    // ── Claiming espejo de resolve.ts: prioridad ASC, luego slot ASC. ──
    const claimed = new Set<string>();
    const byPlacement = new Map<string, string[]>();
    const claimOrder = [...selected].sort((a, b) => a.priority - b.priority || a.slot - b.slot);
    for (const p of claimOrder) {
      if (p.section_type === "hero_grid") {
        const limit = typeof p.params.limit === "number" ? p.params.limit : 20;
        const ids = resolveSimSection("hero_grid", p.params, sectionCtx)
          .filter((id) => !claimed.has(id))
          .slice(0, limit);
        for (const id of ids) claimed.add(id);
        byPlacement.set(p.placement_id, ids);
        continue;
      }
      const resolver = SECTION_REGISTRY[p.section_type];
      if (!resolver) continue; // unknown_type ⇒ skip (forward-compat)
      const parsed = resolver.paramsSchema.safeParse(p.params);
      const fallback = parsed.success ? parsed : resolver.paramsSchema.safeParse(p.default_params);
      if (!fallback.success) continue;
      const params = fallback.data as Record<string, unknown>;
      const limit = typeof params.limit === "number" ? params.limit : p.min_items;
      const ids = resolveSimSection(p.section_type, params, sectionCtx)
        .filter((id) => !claimed.has(id))
        .slice(0, limit);
      if (ids.length < p.min_items) continue; // below_min ⇒ sección no servida
      for (const id of ids) claimed.add(id);
      byPlacement.set(p.placement_id, ids);
    }

    // ── Ensamblado visual por slot ASC (resolve.ts:184). ──
    const slate: ExposedItem[] = [];
    for (const p of selected) {
      const ids = byPlacement.get(p.placement_id);
      if (!ids) continue;
      for (const id of ids) {
        slate.push({
          product_id: id,
          placement_id: p.placement_id,
          section_type: p.section_type,
          placement_version: p.version,
          source: "exploit",
          propensity: 1,
        });
      }
    }

    // ── ε-greedy por slot con la función REAL de producción. ──
    const inSlate = new Set(slate.map((s) => s.product_id));
    const pool = activeByPop.filter((id) => !inSlate.has(id));
    const explored = applyEpsilonExploration(
      slate.map((s, i) => ({ product_id: s.product_id, rank: i + 1, reason: "" })),
      pool,
      { epsilon: EPSILON, rng: () => ctx.rng.next() },
    );
    const items: ExposedItem[] = explored.slice(0, SLATE_K).map((e, i) => ({
      product_id: e.product_id,
      placement_id: slate[i].placement_id, // el slot conserva su atribución
      section_type: slate[i].section_type,
      placement_version: slate[i].placement_version,
      source: e.source,
      propensity: e.propensity,
    }));

    exposures.push({ userId: uid, policyArm: holdout ? "holdout" : "default", items });
    return items.map((x) => x.product_id);
  };

  return { policy, exposures };
}
