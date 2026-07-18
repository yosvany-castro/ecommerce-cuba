import type { Client } from "pg";
import { embed } from "@/lib/embeddings/voyage";
import { hashQuery } from "./cache/hash";
import { lookupExact, writeExact, EXACT_CACHE_TTL_SECONDS } from "./cache/exact";
import { lookupSemantic, getSemanticCacheTheta } from "./cache/semantic";
import { normalizeQueryWithLLM } from "./normalizer/normalize";
import type { NormalizedQuery } from "./normalizer/prompt";
import { bm25Search, type SearchFilters } from "./retrieve/bm25";
import { cosineSearch } from "./retrieve/cosine";
import type { FusedProduct, RankedProduct } from "./retrieve/rrf";
import { fuseRelevant } from "./retrieve/price-boost";
import {
  shouldCallMock,
  countStrongHits,
  currentStrongHitMinScore,
  isTitleLikeQuery,
  LOCAL_HITS_THRESHOLD,
  FRESHNESS_THRESHOLD_HOURS,
} from "./decide/shouldCallMock";
import { getQueryFreshness, recordQueryAggregatorCall } from "./decide/freshness";
import { persistSearch, type SearchMethod } from "./persist/searches";
import type { ProductListRow } from "@/sectors/b-catalog/repository/products";
import { activeProvider } from "@/sectors/b-catalog/provider";
import {
  AGGREGATOR_DAILY_BUDGET_CENTS,
  budgetExceeded,
  fetchSpentLast24h,
} from "./decide/budget";
import { singleFlight } from "./decide/single-flight";
import { asyncIngestEnabled, queueExternalIngest, type IngestOutcome } from "./ingest-async";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";
import type { MockCategory } from "@/sectors/b-catalog/mock/types";
import { Tracer, NoopTracer, type ITracer } from "./debug/tracer";
import type { SearchTrace } from "./debug/trace";

const RETRIEVE_K = 50;

// Enum real del catálogo — única fuente de verdad para filtrar categorías
// normalizadas (ver comentario en la construcción de filters).
const VALID_CATEGORIES = new Set<string>([
  "ropa",
  "electronica",
  "hogar",
  "juguetes_bebe",
  "belleza",
  "otros",
] satisfies MockCategory[]);

export interface HybridSearchCtx {
  pg: Client;
  anonymous_id: string | null;
  user_id: string | null;
}

export interface HybridSearchOpts {
  trace?: boolean;
  /** Fuerza la ingesta externa aunque el normalizador dude (low_confidence):
   * fallback de URL por slug (`/api/search?force=1`) — spec Bloque 1. */
  forceIngest?: boolean;
}

export interface HybridSearchResult {
  products: ProductListRow[];
  normalized: (NormalizedQuery & { prompt_version: string }) | null;
  hitCache: boolean;
  calledMock: boolean;
  method: SearchMethod;
  trace?: SearchTrace;
  /**
   * F4 T3: job de ingesta externa EN VUELO (solo cuando calledMock=true en
   * modo async). Producción lo ignora (fire-and-forget); tests/evals pueden
   * await-earlo para determinismo. Jamás rechaza.
   */
  ingestion?: Promise<IngestOutcome>;
}

async function resolveProducts(ids: string[], pg: Client): Promise<ProductListRow[]> {
  if (ids.length === 0) return [];
  const r = await pg.query(
    `SELECT id, title, description, price_cents, currency, image_url, url, metadata, created_at, source
     FROM products
     WHERE id = ANY($1::uuid[]) AND is_active = true`,
    [ids],
  );
  const byId = new Map<string, ProductListRow>(r.rows.map((x: ProductListRow) => [x.id, x]));
  return ids.map((id) => byId.get(id)).filter((x): x is ProductListRow => x !== undefined);
}

function deriveMethod(bm25: RankedProduct[], cos: RankedProduct[]): SearchMethod {
  if (bm25.length > 0 && cos.length > 0) return "hybrid_rrf";
  if (bm25.length === 0 && cos.length > 0) return "cosine_only";
  return "bm25_only";
}

async function titlesByIds(ids: string[], pg: Client): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const r = await pg.query(
    `SELECT id, title FROM products WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(r.rows.map((x: { id: string; title: string }) => [x.id, x.title]));
}

export async function hybridSearch(
  rawQuery: string,
  ctx: HybridSearchCtx,
  opts: HybridSearchOpts = {},
): Promise<HybridSearchResult> {
  const { pg, anonymous_id, user_id } = ctx;
  const tracer: ITracer = opts.trace ? new Tracer(rawQuery) : new NoopTracer();

  if (!rawQuery || !rawQuery.trim()) {
    return {
      products: [],
      normalized: null,
      hitCache: false,
      calledMock: false,
      method: "bm25_only",
    };
  }

  // 1. Hash + exact cache
  tracer.start("hash");
  const hash = hashQuery(rawQuery);
  tracer.end("hash");
  tracer.set("hash", hash);

  tracer.start("exact_cache_lookup");
  const exact = await lookupExact(hash, pg);
  tracer.end("exact_cache_lookup");

  if (exact) {
    const products = await resolveProducts(exact.products_returned, pg);
    await persistSearch(
      {
        anonymous_id,
        user_id,
        raw_query: rawQuery,
        normalized_json: exact.normalized_json,
        prompt_version: exact.normalized_json.prompt_version,
        search_method: "hybrid_rrf",
        results_count: products.length,
        hit_cache: true,
        called_mock: false,
      },
      pg,
    );
    tracer.set("cache", { exact_hit: true, semantic_hit: false });
    tracer.set("normalized", exact.normalized_json);
    tracer.set("decision", { should_call_mock: false, reason: "exact_cache_hit" });
    tracer.set("final", {
      method: "hybrid_rrf",
      products_count: products.length,
      top_10: products.slice(0, 10).map((p) => ({
        id: p.id,
        title: p.title,
        price_cents: p.price_cents,
      })),
    });
    return {
      products,
      normalized: exact.normalized_json,
      hitCache: true,
      calledMock: false,
      method: "hybrid_rrf",
      trace: opts.trace ? tracer.finish() : undefined,
    };
  }

  // 2. Embed query (used by semantic cache + cosine retrieval)
  tracer.start("embed");
  const [queryEmbedding] = await embed([rawQuery], { inputType: "query" });
  tracer.end("embed");
  if (queryEmbedding) {
    let norm = 0;
    for (const v of queryEmbedding) norm += v * v;
    norm = Math.sqrt(norm);
    tracer.set("embedding", {
      dim: queryEmbedding.length,
      norm,
      sample: queryEmbedding.slice(0, 5),
    });
  }

  // 3. Semantic cache
  tracer.start("semantic_cache_lookup");
  const semantic = await lookupSemantic(queryEmbedding, getSemanticCacheTheta(), pg);
  tracer.end("semantic_cache_lookup");

  if (semantic) {
    const products = await resolveProducts(semantic.products_returned, pg);
    await persistSearch(
      {
        anonymous_id,
        user_id,
        raw_query: rawQuery,
        normalized_json: semantic.normalized_json,
        prompt_version: semantic.normalized_json.prompt_version,
        search_method: "hybrid_rrf",
        results_count: products.length,
        hit_cache: true,
        called_mock: false,
      },
      pg,
    );
    tracer.set("cache", { exact_hit: false, semantic_hit: true });
    tracer.set("normalized", semantic.normalized_json);
    tracer.set("decision", { should_call_mock: false, reason: "semantic_cache_hit" });
    tracer.set("final", {
      method: "hybrid_rrf",
      products_count: products.length,
      top_10: products.slice(0, 10).map((p) => ({
        id: p.id,
        title: p.title,
        price_cents: p.price_cents,
      })),
    });
    return {
      products,
      normalized: semantic.normalized_json,
      hitCache: true,
      calledMock: false,
      method: "hybrid_rrf",
      trace: opts.trace ? tracer.finish() : undefined,
    };
  }

  // 4. LLM normalize (with fallback to graceful degradation)
  tracer.start("llm_normalize");
  let normalized: (NormalizedQuery & { prompt_version: string }) | null = null;
  try {
    normalized = await normalizeQueryWithLLM(rawQuery);
  } catch {
    normalized = null;
  }
  tracer.end("llm_normalize");
  tracer.set("normalized", normalized);

  const searchTerms = normalized?.search_terms ?? rawQuery;
  const ageMin = normalized?.recipient_age_min ?? undefined;
  const ageMax = normalized?.recipient_age_max ?? undefined;
  const ageBothPresent = typeof ageMin === "number" && typeof ageMax === "number";
  // El normalizador LLM puede inventar categorías fuera del enum del catálogo
  // (visto en vivo 2026-07-12: "guantes de boxeo" → ["deportes"], que no existe
  // → filtro insatisfacible → 0 resultados con los productos correctos en DB).
  // Categoría desconocida se descarta; si no queda ninguna, no se filtra.
  const knownCategories = normalized?.categories?.filter((c) =>
    VALID_CATEGORIES.has(c),
  );
  const filters: SearchFilters = normalized
    ? {
        categories: knownCategories?.length ? knownCategories : undefined,
        gender_target: normalized.recipient_gender ?? undefined,
        age_min: ageBothPresent ? ageMin : undefined,
        age_max: ageBothPresent ? ageMax : undefined,
        price_range: normalized.price_range ?? undefined,
      }
    : {};
  tracer.set("filters_applied", filters);

  // 5. BM25 + cosine in parallel
  tracer.start("bm25");
  const bm25P = bm25Search(searchTerms, filters, RETRIEVE_K, pg).then((res) => {
    tracer.end("bm25");
    return res;
  });
  tracer.start("cosine");
  const cosP = cosineSearch(queryEmbedding, filters, RETRIEVE_K, pg).then((res) => {
    tracer.end("cosine");
    return res;
  });
  const [bm25, cos] = await Promise.all([bm25P, cosP]);

  // 6. Fuse (T2a: "barato primero" + piso de relevancia sobre lo devuelto —
  // ver retrieve/price-boost.ts::fuseRelevant)
  tracer.start("rrf");
  let fused: FusedProduct[] = fuseRelevant(bm25, cos);
  tracer.end("rrf");

  // 7. Freshness check (POR QUERY, F4 T4) + mock fallback decision.
  tracer.start("freshness_check");
  const lastRefreshedAt = normalized ? await getQueryFreshness(hash, pg) : null;
  tracer.end("freshness_check");
  tracer.set("freshness", {
    query_hash: hash,
    last_called_at: lastRefreshedAt ? lastRefreshedAt.toISOString() : null,
    hours_old: lastRefreshedAt
      ? (Date.now() - lastRefreshedAt.getTime()) / (3600 * 1000)
      : null,
  });

  let calledMock = false;
  let ingestion: Promise<IngestOutcome> | undefined;
  let mockProductsFetched = 0;
  let mockProductsProcessed = 0;
  let mockProductsFailed = 0;
  let decisionReason = "not evaluated";

  // F4 T7: cuenta hits FUERTES (match léxico BM25 o coseno ≥ piso), no el total
  // fusionado. El fuse no conserva scores de origen, así que se cuenta desde las
  // listas PRE-fuse (bm25/cos). Con SEARCH_STRONG_HIT_MIN_SCORE=0 se recupera el
  // conteo total viejo. NO cambia el orden ni los resultados, solo la decisión.
  const strongHits = countStrongHits(
    bm25.map((b) => b.id),
    cos,
    currentStrongHitMinScore(),
  );

  if (normalized) {
    // Título pegado (>8 palabras) o force=1: la confianza del LLM no veta
    // la ingesta (spec Bloque 1) — se pasa 1 en su lugar.
    const titlePaste = isTitleLikeQuery(rawQuery) || opts.forceIngest === true;
    let should = shouldCallMock(strongHits, titlePaste ? 1 : normalized.confidence, lastRefreshedAt);
    if (!should) {
      if (strongHits >= LOCAL_HITS_THRESHOLD) decisionReason = "enough_local_hits";
      else if (!titlePaste && normalized.confidence <= 0.5) decisionReason = "low_confidence";
      else if (
        lastRefreshedAt &&
        (Date.now() - lastRefreshedAt.getTime()) / (3600 * 1000) < FRESHNESS_THRESHOLD_HOURS
      ) {
        decisionReason = "query_recently_refreshed";
      } else decisionReason = "criteria_not_met";
    } else {
      // F4 T2: freno de gasto ANTES de pagar — el presupuesto se lee de la
      // auditoría real (mock_calls, 24h). Corta con razón visible en el trace.
      const spent = await fetchSpentLast24h(pg);
      if (budgetExceeded(spent, AGGREGATOR_DAILY_BUDGET_CENTS)) {
        should = false;
        decisionReason = "daily_budget_exhausted";
      } else {
        decisionReason = "low_count_high_confidence_stale_category";
      }
    }
    tracer.set("decision", { should_call_mock: should, reason: decisionReason, strong_hits: strongHits });

    if (should && asyncIngestEnabled()) {
      // F4 T3 (decisión 2026-07-02): devolver lo LOCAL ya — el fetch externo +
      // enriquecimiento corre de fondo (ingest-async.ts) e invalida la caché
      // exacta al terminar; los productos externos aparecen en la siguiente
      // búsqueda idéntica. SEARCH_ASYNC_INGEST=false restaura el modo síncrono.
      tracer.start("mock_fallback");
      const searchPath = (await pg.query(`SHOW search_path`)).rows[0].search_path as string;
      ingestion = queueExternalIngest({
        hash,
        query: normalized.search_terms,
        category: normalized.categories?.[0] as MockCategory | undefined,
        limit: process.env.HYBRID_SEARCH_MOCK_LIMIT
          ? parseInt(process.env.HYBRID_SEARCH_MOCK_LIMIT, 10)
          : undefined,
        searchPath,
      });
      calledMock = true; // la llamada pagada se disparó (en vuelo)
      tracer.end("mock_fallback");
    } else if (should) {
      tracer.start("mock_fallback");
      try {
        const limitOverride = process.env.HYBRID_SEARCH_MOCK_LIMIT
          ? parseInt(process.env.HYBRID_SEARCH_MOCK_LIMIT, 10)
          : undefined;
        const t0 = Date.now();
        // F4 T2: dos búsquedas idénticas concurrentes comparten UNA llamada
        // pagada (key = hash canónico de la query).
        const mockResult = await singleFlight(`aggregator:${hash}`, () =>
          activeProvider.fetch({
            category: normalized.categories?.[0] as MockCategory | undefined,
            query: normalized.search_terms,
            limit: limitOverride,
          }),
        );
        mockProductsFetched = mockResult.products.length;
        await pg.query(
          `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
           VALUES ($1::jsonb, $2, $3, $4, false)`,
          [
            JSON.stringify({ source: "hybrid_search_fallback", query: normalized.search_terms }),
            mockResult.products.length,
            mockResult.cost_cents,
            Math.round(Date.now() - t0),
          ],
        );
        // F4 T4: registra la llamada por-query (freshness + negative cache) —
        // incluso 0 resultados cuenta, para no re-consultar la misma query.
        await recordQueryAggregatorCall(hash, mockResult.products.length, pg);
        const seen = new Set<string>();
        for (const raw of mockResult.products) {
          const key = `${raw.source}:${raw.source_product_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            await processProduct(raw, pg);
            mockProductsProcessed++;
          } catch {
            mockProductsFailed++;
          }
        }
        calledMock = true;
        const [bm25Re, cosRe] = await Promise.all([
          bm25Search(searchTerms, filters, RETRIEVE_K, pg),
          cosineSearch(queryEmbedding, filters, RETRIEVE_K, pg),
        ]);
        fused = fuseRelevant(bm25Re, cosRe);
      } catch {
        try {
          await pg.query(
            `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
             VALUES ($1::jsonb, 0, 4, 0, true)`,
            [JSON.stringify({ source: "hybrid_search_fallback", query: normalized.search_terms })],
          );
        } catch {
          // don't crash if logging also fails
        }
        calledMock = true;
      }
      tracer.end("mock_fallback");
    }
  }

  tracer.set("mock_fallback", {
    invoked: calledMock,
    products_fetched: mockProductsFetched,
    products_processed: mockProductsProcessed,
    products_failed: mockProductsFailed,
  });

  const method = deriveMethod(bm25, cos);
  const productIds = fused.map((f) => f.id);

  // 8. Cache (only on miss path). Con ingesta async EN VUELO no se escribe:
  // el job la invalidaría al terminar, pero si terminara ANTES de esta línea
  // la escritura resucitaría el resultado local-only por 24h (race). Ese
  // request simplemente no cachea; la siguiente búsqueda puebla la caché.
  // Tampoco se cachea un resultado VACÍO: congelarlo 24h deja la query muerta
  // aunque el catálogo crezca (visto en vivo 2026-07-12 — un poll durante la
  // ingesta cacheó 0 productos), y recomputar un vacío es barato.
  if (normalized && !ingestion && productIds.length > 0) {
    tracer.start("persist");
    await writeExact(
      {
        query_hash: hash,
        query_embedding: queryEmbedding,
        normalized_json: normalized,
        products_returned: productIds,
        ttl_seconds: EXACT_CACHE_TTL_SECONDS,
      },
      pg,
    );
    tracer.end("persist");
  }

  // 9. Persist search log
  await persistSearch(
    {
      anonymous_id,
      user_id,
      raw_query: rawQuery,
      normalized_json: normalized,
      prompt_version: normalized?.prompt_version ?? null,
      search_method: method,
      results_count: fused.length,
      hit_cache: false,
      called_mock: calledMock,
    },
    pg,
  );

  tracer.start("resolve_products");
  const products = await resolveProducts(productIds, pg);
  tracer.end("resolve_products");

  // 10. Populate retrieval + final on tracer
  if (opts.trace) {
    const allIds = Array.from(
      new Set([...bm25.map((b) => b.id), ...cos.map((c) => c.id), ...fused.map((f) => f.id)]),
    );
    const titles = await titlesByIds(allIds, pg);
    tracer.set("retrieval", {
      bm25: bm25.slice(0, 10).map((r) => ({
        id: r.id,
        rank: r.rank,
        score: r.score,
        title: titles.get(r.id) ?? "",
      })),
      cosine: cos.slice(0, 10).map((r) => ({
        id: r.id,
        rank: r.rank,
        score: r.score,
        title: titles.get(r.id) ?? "",
      })),
      fused: fused.slice(0, 10).map((f) => ({
        id: f.id,
        rrf_score: f.rrf_score,
        ranks: f.ranks,
        title: titles.get(f.id) ?? "",
      })),
    });
    tracer.set("final", {
      method,
      products_count: products.length,
      top_10: products.slice(0, 10).map((p) => ({
        id: p.id,
        title: p.title,
        price_cents: p.price_cents,
      })),
    });
  }

  return {
    products,
    normalized,
    hitCache: false,
    calledMock,
    method,
    ingestion,
    trace: opts.trace ? tracer.finish() : undefined,
  };
}
