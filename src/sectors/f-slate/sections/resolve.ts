import type { Client } from "pg";
import { serveFeedPage } from "@/sectors/d-personalization/feed";
import type { ComposedPage, ComposeIdentity, ComposeSurfaceArgs } from "../compose";
import { SECTION_REGISTRY } from "./registry";
import { logSectionImpressions, type SectionImpressionRow } from "./impressions";
import type { ResolvedSection, SectionCardDTO } from "./types";
import { toCard } from "@/storefront/map";

/**
 * Section runner (D3): executes a composition's placements in PRIORITY order
 * (the sacrifice/claim order), dedupes candidates against higher-priority
 * claims AND the user's exclusions, enforces min_items, and hydrates all
 * carousel products in ONE query. A section that fails/times out degrades to
 * nothing — a secondary section can never take the page down.
 *
 * hero_grid is special: its content IS the materialized slate feed
 * (serveFeedPage — already hydrated, already logged, carries the infinite-
 * scroll cursor). Everything else returns candidate ids.
 */

export async function resolveSections(
  page: ComposedPage,
  identity: ComposeIdentity,
  surfaceArgs: ComposeSurfaceArgs | undefined,
  pg: Client,
): Promise<ResolvedSection[]> {
  // Claim set seed: exclusiones del usuario (dismiss/fatiga) aplican a TODA sección.
  const claimed = new Set<string>();
  try {
    const r = await pg.query(
      `SELECT product_id::text AS id FROM excluded_products
       WHERE ttl_until > now()
         AND ((user_id IS NOT NULL AND user_id = $1)
           OR (user_id IS NULL AND anonymous_id = $2))`,
      [identity.user_id, identity.anonymous_id],
    );
    for (const row of r.rows as { id: string }[]) claimed.add(row.id);
  } catch {
    /* exclusiones no disponibles: secciones siguen, el feed las aplica internamente */
  }

  // Orden de ejecución = prioridad (feed=0 primero reclama sus items), luego slot.
  const ordered = [...page.placements].sort((a, b) => a.priority - b.priority || a.slot - b.slot);

  const results: ResolvedSection[] = [];
  const pendingHydration: { section: ResolvedSection; ids: string[]; version: number }[] = [];

  for (const p of ordered) {
    const started = performance.now();
    const base = {
      placement_id: p.placement_id,
      section_type: p.section_type,
      slot: p.slot,
      title: p.title_default,
      display: p.display,
    };

    if (p.section_type === "hero_grid") {
      try {
        const feed = await withBudget(
          serveFeedPage(
            {
              user_id: identity.user_id,
              anonymous_id: identity.anonymous_id,
              session_id: identity.session_id,
            },
            pg,
          ),
          p.budget_ms,
        );
        const items: SectionCardDTO[] = feed.items.map((it) => toCard(it.product, it.reason, it.position));
        for (const it of items) claimed.add(it.id);
        results.push({
          ...base,
          items,
          next_cursor: feed.next_cursor,
          slate_id: feed.slate_id,
          outcome: items.length === 0 ? "empty" : "served",
          resolve_ms: Math.round(performance.now() - started),
        });
      } catch (e) {
        console.warn(`[slate] hero_grid failed (${(e as Error).message}) — page continues`);
        results.push({ ...base, items: [], outcome: isTimeout(e) ? "timeout" : "error", resolve_ms: Math.round(performance.now() - started) });
      }
      continue;
    }

    const resolver = SECTION_REGISTRY[p.section_type];
    if (!resolver) {
      console.warn(`[slate] unknown section_type '${p.section_type}' — skipped (forward-compat)`);
      results.push({ ...base, items: [], outcome: "unknown_type", resolve_ms: 0 });
      continue;
    }

    // Params: los del placement → si no validan, default_params → si tampoco, skip.
    const parsed = resolver.paramsSchema.safeParse(p.params);
    const fallback = parsed.success ? parsed : resolver.paramsSchema.safeParse(p.default_params);
    if (!fallback.success) {
      results.push({ ...base, items: [], outcome: "error", resolve_ms: 0 });
      continue;
    }
    const params = fallback.data as never;
    const limit = (params as { limit?: number }).limit ?? p.min_items;

    try {
      const candidateIds = await withBudget(
        resolver.resolve(params, { identity, rule_ctx: page.rule_ctx, surfaceArgs, claimed }, pg),
        p.budget_ms,
      );
      const ids = candidateIds.filter((id) => !claimed.has(id)).slice(0, limit);
      if (ids.length < p.min_items) {
        results.push({ ...base, items: [], outcome: ids.length === 0 ? "empty" : "below_min", resolve_ms: Math.round(performance.now() - started) });
        continue;
      }
      for (const id of ids) claimed.add(id);
      const section: ResolvedSection = {
        ...base,
        items: [], // se hidrata abajo, en UNA query para todas las secciones
        outcome: "served",
        resolve_ms: Math.round(performance.now() - started),
      };
      results.push(section);
      pendingHydration.push({ section, ids, version: p.version });
    } catch (e) {
      results.push({ ...base, items: [], outcome: isTimeout(e) ? "timeout" : "error", resolve_ms: Math.round(performance.now() - started) });
    }
  }

  // ── Hidratación única para todos los carruseles. ──
  const allIds = pendingHydration.flatMap((x) => x.ids);
  if (allIds.length > 0) {
    const r = await pg.query(
      `SELECT id::text, title, price_cents, currency, image_url, metadata, source, weight_grams
       FROM products WHERE id = ANY($1::uuid[]) AND is_active = true`,
      [allIds],
    );
    const byId = new Map(
      (r.rows as Array<SectionCardDTO & { metadata?: unknown }>).map((row) => [row.id, toCard(row)]),
    );
    for (const { section, ids } of pendingHydration) {
      section.items = ids
        .map((id) => byId.get(id))
        .filter((x): x is SectionCardDTO => x !== undefined);
      if (section.items.length === 0) section.outcome = "empty";
    }
  }

  // ── C1b: impresiones de carruseles (lo realmente hidratado, post-claims).
  //    feed_request_id = composition_id; cubre ambos callers (home SSR y
  //    /api/slate/resolve) sin tocarlos. ──
  const impressionRows: SectionImpressionRow[] = [];
  for (const { section, version } of pendingHydration) {
    if (section.outcome !== "served") continue;
    section.items.forEach((it, idx) => {
      impressionRows.push({
        position: section.slot * 100 + idx + 1,
        product_id: it.id,
        section_type: section.section_type,
        placement_version: version,
      });
    });
  }
  await logSectionImpressions(
    {
      composition_id: page.composition_id,
      session_id: identity.session_id,
      user_profile_id: null, // el runner no resuelve perfil (igual que logSlateDecision en los callers)
      page_request_id: null,
      rows: impressionRows,
    },
    pg,
  );

  // El orden visual es por slot (la prioridad solo decide claims/sacrificio).
  return results.sort((a, b) => a.slot - b.slot);
}

class BudgetTimeout extends Error {
  constructor(ms: number) {
    super(`section budget ${ms}ms exceeded`);
  }
}
function isTimeout(e: unknown): boolean {
  return e instanceof BudgetTimeout;
}
async function withBudget<T>(work: Promise<T>, budgetMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BudgetTimeout(budgetMs)), budgetMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
