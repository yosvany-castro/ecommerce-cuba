import { rrfFuse } from "@/sectors/d-personalization/retrieve/rrf";
import {
  predictTopSubcategories,
  rankByViewedCategoriesQuota,
} from "@/sectors/d-personalization/ranking/views-categories";
import type { ArmArtifacts } from "./crons";

/**
 * Resolvers sim espejo 1:1 de producción (blueprint §5.6):
 * - popular(global)      ≡ fetchPopularGlobal: events época t-1 DESC, id ASC,
 *                          solo productos con popularidad > 0, over-fetch ×2.
 * - popular(cohort)      ≡ filtrado a session_cohort (= subcategoría modal del
 *                          log del brazo); si vacío cae a global (registry.ts:84-94).
 *                          Desviación: prod pondera log-weighted por demografía;
 *                          el sim usa el conteo plano de la misma ventana.
 * - popular(pdp_category) en home (pdp_category=null) ⇒ cae a GLOBAL — el
 *   registry real hace fallback, no salta la sección (gana el repo sobre el
 *   blueprint §5.6 que decía "vacío").
 * - cross_sell           ≡ NPMI top del ancla: pdpAnchor en el journey (espejo
 *                          fiel del PDP actual), last-viewed del log en el home
 *                          legacy (desviación 2.C.1).
 * - cart_addons          ≡ NPMI sobre las anclas del carrito (cartIds) en el
 *                          journey, MIN(rank)/SUM(npmi) espejo de prod; sin
 *                          carrito ⇒ [] (cae por min_items).
 * - hero_grid            ≡ rrf-sess-pop (campeón exp-K): rrfFuse de cabeza
 *                          subcat-quota (módulo de producción) + cabeza
 *                          pop-global, cola por popularidad.
 * Todos enmascarados a activeIds(t) por construcción (los rankings se derivan
 * de listas ya filtradas a activos — anti-trampa #13).
 */

export interface SimSectionCtx {
  userId: string;
  sessionCohort: string | null;
  artifacts: ArmArtifacts;
  /** Activos con popularidad>0, orden events DESC + id ASC (≡ fetchPopularGlobal). */
  popularRank: readonly string[];
  /** TODOS los activos ordenados por popularidad (cola del hero / candidatos). */
  activeByPop: readonly string[];
  activeIds: ReadonlySet<string>;
  lastViewed: string | null;
  /** Vistas DISTINTAS pasadas del usuario (orden de primera vista), épocas < t. */
  viewedSubs: readonly (string | null)[];
  subcategoryOf: (id: string) => string | null;
  popOf: (id: string) => number;
  /** Cache por usuario del ranking hero (depende solo del estado del usuario). */
  heroCache: Map<string, string[]>;
  /**
   * PDP anchor (journeyPolicy regime): el producto cuyo PDP se está renderizando.
   * cross_sell se ancla AQUÍ (espejo de prod: NPMI del pdp_product_id actual),
   * no en lastViewed. null fuera de una visita PDP.
   */
  pdpAnchor?: string | null;
  /** Subcategoría del pdpAnchor — popular(pdp_category) cae a ella (espejo de prod). */
  pdpCategory?: string | null;
  /**
   * Cart anchors (journeyPolicy regime): los productos en el carrito. cart_addons
   * se ancla AQUÍ (NPMI sobre cada ancla, excluyendo lo ya carteado). Vacío fuera
   * de la visita al carrito.
   */
  cartIds?: readonly string[];
}

function heroRrfSessPop(ctx: SimSectionCtx): string[] {
  const cached = ctx.heroCache.get(ctx.userId);
  if (cached) return cached;
  const sessHead = rankByViewedCategoriesQuota({
    topSubcategories: predictTopSubcategories(ctx.viewedSubs, 4),
    candidates: ctx.activeByPop,
    subcategoryOf: ctx.subcategoryOf,
    popOf: ctx.popOf,
    headSize: 10,
  }).slice(0, 20);
  const popHead = ctx.activeByPop.slice(0, 20);
  const fused = rrfFuse([
    { source: "sess", items: sessHead.map((id, i) => ({ id, rank: i + 1 })) },
    { source: "pop", items: popHead.map((id, i) => ({ id, rank: i + 1 })) },
  ])
    .sort((a, b) => b.rrf_score - a.rrf_score || a.id.localeCompare(b.id))
    .map((x) => x.id);
  const inFused = new Set(fused);
  const tail = ctx.activeByPop.filter((id) => !inFused.has(id));
  const out = [...fused, ...tail];
  ctx.heroCache.set(ctx.userId, out);
  return out;
}

/** Devuelve candidatos en over-fetch ×2 (≡ resolvers de registry.ts); el
 *  claiming/limit/min_items los aplica el policy (≡ resolve.ts). */
export function resolveSimSection(
  sectionType: string,
  params: Record<string, unknown>,
  ctx: SimSectionCtx,
): string[] {
  switch (sectionType) {
    case "hero_grid":
      return heroRrfSessPop(ctx);

    case "popular": {
      const limit = typeof params.limit === "number" ? params.limit : 10;
      const mode = typeof params.mode === "string" ? params.mode : "global";
      // pdp_category bajo un PDP (journey): populares de la subcat del ancla,
      // excluyendo el propio ancla (espejo de registry.ts:70-83). Sin ancla ⇒
      // cae a global (registry hace fallback, no salta la sección).
      if (mode === "pdp_category" && ctx.pdpCategory != null) {
        const inCat = ctx.popularRank.filter(
          (id) => id !== ctx.pdpAnchor && ctx.subcategoryOf(id) === ctx.pdpCategory,
        );
        if (inCat.length > 0) return inCat.slice(0, limit * 2);
      }
      if (mode === "cohort" && ctx.sessionCohort !== null) {
        const inCohort = ctx.popularRank.filter(
          (id) => ctx.subcategoryOf(id) === ctx.sessionCohort,
        );
        if (inCohort.length > 0) return inCohort.slice(0, limit * 2);
      }
      // mode global, cohort sin items, o pdp_category sin pdp ⇒ global (registry verbatim)
      return ctx.popularRank.slice(0, limit * 2);
    }

    case "cross_sell": {
      const limit = typeof params.limit === "number" ? params.limit : 8;
      // journey: ancla en el PDP actual (pdpAnchor); fuera del journey (home
      // legacy) ancla en lastViewed — desviación 2.C.1 ya documentada.
      const anchor = ctx.pdpAnchor != null ? ctx.pdpAnchor : ctx.lastViewed;
      if (anchor === null || anchor === undefined) return [];
      const top = ctx.artifacts.npmiTop.get(anchor) ?? [];
      return top
        .filter((x) => ctx.activeIds.has(x.id) && x.id !== anchor)
        .slice(0, limit * 2)
        .map((x) => x.id);
    }

    case "cart_addons": {
      // journey: NPMI sobre cada ancla del carrito, excluyendo lo ya carteado;
      // orden MIN(rank) ASC, SUM(npmi) DESC, id ASC (espejo de registry.ts:38-56).
      const cartIds = ctx.cartIds ?? [];
      if (cartIds.length === 0) return []; // sin carrito ⇒ [] (cae por min_items)
      const limit = typeof params.limit === "number" ? params.limit : 6;
      const inCart = new Set(cartIds);
      const minRank = new Map<string, number>();
      const sumNpmi = new Map<string, number>();
      for (const anchor of cartIds) {
        const top = ctx.artifacts.npmiTop.get(anchor) ?? [];
        top.forEach((x, rank) => {
          if (inCart.has(x.id) || !ctx.activeIds.has(x.id)) return;
          minRank.set(x.id, Math.min(minRank.get(x.id) ?? Infinity, rank));
          sumNpmi.set(x.id, (sumNpmi.get(x.id) ?? 0) + x.score);
        });
      }
      return [...minRank.keys()]
        .sort(
          (a, b) =>
            (minRank.get(a)! - minRank.get(b)!) ||
            (sumNpmi.get(b)! - sumNpmi.get(a)!) ||
            a.localeCompare(b),
        )
        .slice(0, limit * 2);
    }

    default:
      return []; // sección desconocida ⇒ skip con warn en prod
  }
}
