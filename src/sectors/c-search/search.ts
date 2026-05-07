import type { Client } from "pg";
import { embed } from "@/lib/embeddings/voyage";
import { hashQuery } from "./cache/hash";
import { lookupExact, writeExact, EXACT_CACHE_TTL_SECONDS } from "./cache/exact";
import { lookupSemantic, DEFAULT_THETA } from "./cache/semantic";
import { normalizeQueryWithLLM } from "./normalizer/normalize";
import type { NormalizedQuery } from "./normalizer/prompt";
import { bm25Search } from "./retrieve/bm25";
import { cosineSearch } from "./retrieve/cosine";
import { rrfFuse, RRF_K0, type FusedProduct, type RankedProduct } from "./retrieve/rrf";
import { shouldCallMock } from "./decide/shouldCallMock";
import { persistSearch, type SearchMethod } from "./persist/searches";
import type { ProductListRow } from "@/sectors/b-catalog/repository/products";

const RETRIEVE_K = 50;

export interface HybridSearchCtx {
  pg: Client;
  anonymous_id: string | null;
  user_id: string | null;
}

export interface HybridSearchResult {
  products: ProductListRow[];
  normalized: (NormalizedQuery & { prompt_version: string }) | null;
  hitCache: boolean;
  calledMock: boolean;
  method: SearchMethod;
}

async function resolveProducts(ids: string[], pg: Client): Promise<ProductListRow[]> {
  if (ids.length === 0) return [];
  const r = await pg.query(
    `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at
     FROM products
     WHERE id = ANY($1::uuid[]) AND is_active = true`,
    [ids],
  );
  // Preserve the ranking order
  const byId = new Map<string, ProductListRow>(r.rows.map((x: ProductListRow) => [x.id, x]));
  return ids.map((id) => byId.get(id)).filter((x): x is ProductListRow => x !== undefined);
}

function deriveMethod(bm25: RankedProduct[], cos: RankedProduct[]): SearchMethod {
  if (bm25.length > 0 && cos.length > 0) return "hybrid_rrf";
  if (bm25.length === 0 && cos.length > 0) return "cosine_only";
  return "bm25_only";
}

export async function hybridSearch(rawQuery: string, ctx: HybridSearchCtx): Promise<HybridSearchResult> {
  const { pg, anonymous_id, user_id } = ctx;
  if (!rawQuery || !rawQuery.trim()) {
    return { products: [], normalized: null, hitCache: false, calledMock: false, method: "bm25_only" };
  }

  // 1. Hash + exact cache
  const hash = hashQuery(rawQuery);
  const exact = await lookupExact(hash, pg);
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
    return { products, normalized: exact.normalized_json, hitCache: true, calledMock: false, method: "hybrid_rrf" };
  }

  // 2. Embed query (used by semantic cache + cosine retrieval)
  const [queryEmbedding] = await embed([rawQuery], { inputType: "query" });

  // 3. Semantic cache
  const semantic = await lookupSemantic(queryEmbedding, DEFAULT_THETA, pg);
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
    return { products, normalized: semantic.normalized_json, hitCache: true, calledMock: false, method: "hybrid_rrf" };
  }

  // 4. LLM normalize (with fallback to graceful degradation)
  let normalized: (NormalizedQuery & { prompt_version: string }) | null = null;
  try {
    normalized = await normalizeQueryWithLLM(rawQuery);
  } catch {
    normalized = null;
  }

  const searchTerms = normalized?.search_terms ?? rawQuery;
  const filters = { categories: normalized?.categories ?? undefined };

  // 5. BM25 + cosine in parallel
  const [bm25, cos] = await Promise.all([
    bm25Search(searchTerms, filters, RETRIEVE_K, pg),
    cosineSearch(queryEmbedding, filters, RETRIEVE_K, pg),
  ]);

  // 6. Fuse
  const fused: FusedProduct[] = rrfFuse([bm25, cos], RRF_K0);
  let calledMock = false;

  // 7. Mock fallback (Task 14b will enable this; currently no-op)
  if (normalized && shouldCallMock(fused.length, normalized.confidence)) {
    // Implementation deferred to Task 14b
  }

  const method = deriveMethod(bm25, cos);
  const productIds = fused.map((f) => f.id);

  // 8. Cache the result (only on miss path) — only when normalized is not null
  if (normalized) {
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

  const products = await resolveProducts(productIds, pg);
  return { products, normalized, hitCache: false, calledMock, method };
}
