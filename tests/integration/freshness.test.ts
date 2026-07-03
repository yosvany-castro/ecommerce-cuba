import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import {
  getQueryFreshness,
  recordQueryAggregatorCall,
} from "@/sectors/c-search/decide/freshness";
import { hashQuery } from "@/sectors/c-search/cache/hash";
import { hybridSearch } from "@/sectors/c-search/search";
import { resetCallCount, getCallCount } from "@/sectors/b-catalog/mock/aggregator";

describe("getQueryFreshness / recordQueryAggregatorCall (F4 T4)", () => {
  beforeEach(async () => {
    await truncateTestTables(["query_aggregator_log"]);
  });

  test("returns null when the query hash was never aggregated", async () => {
    await withTestDb(async (pg) => {
      const out = await getQueryFreshness(hashQuery("nunca buscada"), pg);
      expect(out).toBeNull();
    });
  });

  test("returns last_called_at after recording a call (incl. 0 results = negative cache)", async () => {
    await withTestDb(async (pg) => {
      const h = hashQuery("cosa sin resultados");
      await recordQueryAggregatorCall(h, 0, pg);
      const out = await getQueryFreshness(h, pg);
      expect(out === null).toBe(false);
      expect(Date.now() - out!.getTime()).toBeLessThan(60_000);
    });
  });

  test("upsert refreshes the timestamp for the same hash (no duplicate rows)", async () => {
    await withTestDb(async (pg) => {
      const h = hashQuery("misma query dos veces");
      await recordQueryAggregatorCall(h, 3, pg);
      await recordQueryAggregatorCall(h, 7, pg);
      const rows = await pg.query(
        `SELECT result_count FROM query_aggregator_log WHERE query_hash = $1`,
        [h],
      );
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].result_count).toBe(7);
    });
  });
});

describe("hybridSearch per-query freshness gate (REAL APIs, MOCK_LIMIT=2)", () => {
  beforeEach(async () => {
    await truncateTestTables([
      "product_query_cache",
      "searches",
      "products",
      "mock_calls",
      "query_aggregator_log",
    ]);
    resetCallCount();
    process.env.HYBRID_SEARCH_MOCK_LIMIT = "2";
    process.env.MOCK_AGGREGATOR_ERROR_RATE = "0";
  });

  afterEach(() => {
    delete process.env.HYBRID_SEARCH_MOCK_LIMIT;
    delete process.env.MOCK_AGGREGATOR_ERROR_RATE;
  });

  test("a recently-aggregated query does NOT re-trigger the mock (negative/freshness cache)", async () => {
    await withTestDb(async (pg) => {
      // Simula que ESA query ya se consultó al agregador hace 1h con 0 resultados.
      const q = "gadget rarisimo inexistente xyz";
      await recordQueryAggregatorCall(hashQuery(q), 0, pg);

      const callsBefore = getCallCount();
      const result = await hybridSearch(q, { pg, anonymous_id: null, user_id: null });
      expect(result.calledMock).toBe(false);
      expect(getCallCount() - callsBefore).toBe(0);
    });
  }, 120_000);

  test("a DIFFERENT query in the same category still triggers the mock (fix del bug de categoría)", async () => {
    await withTestDb(async (pg) => {
      // Producto de 'electronica' + esa query ya aggregada: NO debe suprimir
      // una query electrónica DISTINTA (lo que la freshness por categoría rompía).
      await seedProductWithEmbedding(pg, {
        title: "Auriculares Sony",
        description: "auriculares bluetooth",
        metadata: { category: "electronica" },
        raw_category: "electronica",
      });
      await recordQueryAggregatorCall(hashQuery("auriculares bluetooth"), 5, pg);

      const callsBefore = getCallCount();
      const result = await hybridSearch("camara digital compacta 4k", {
        pg,
        anonymous_id: null,
        user_id: null,
      });
      // Query distinta ⇒ sin registro propio ⇒ el agregador SÍ se dispara.
      expect(result.calledMock).toBe(true);
      // Modo async (default): la llamada pagada ocurre en el job de fondo.
      await result.ingestion!;
      expect(getCallCount() - callsBefore).toBeGreaterThanOrEqual(1);
      // Y la query distinta quedó registrada por-query tras la ingesta.
      const logged = await getQueryFreshness(hashQuery("camara digital compacta 4k"), pg);
      expect(logged === null).toBe(false);
    });
  }, 240_000);
});
