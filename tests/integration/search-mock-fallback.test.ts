import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { resetCallCount, getCallCount } from "@/sectors/b-catalog/mock/aggregator";
import { hybridSearch } from "@/sectors/c-search/search";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { recordQueryAggregatorCall } from "@/sectors/c-search/decide/freshness";
import { hashQuery } from "@/sectors/c-search/cache/hash";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache", "searches", "products", "mock_calls"]);
  resetCallCount();
  process.env.HYBRID_SEARCH_MOCK_LIMIT = "2"; // keep tests cheap
  process.env.MOCK_AGGREGATOR_ERROR_RATE = "0"; // determinism in integration
});

afterEach(() => {
  delete process.env.HYBRID_SEARCH_MOCK_LIMIT;
  delete process.env.MOCK_AGGREGATOR_ERROR_RATE;
});

describe("hybridSearch mock fallback (REAL APIs, capped at 2 products per call)", () => {
  test("count < 12 + confidence > 0.5 → ingesta ASÍNCRONA: local ya, externo en la siguiente búsqueda", async () => {
    await withTestDb(async (pg) => {
      const callsBefore = getCallCount();
      const result = await hybridSearch("auriculares bluetooth con cancelación de ruido", {
        pg,
        anonymous_id: randomUUID(),
        user_id: null,
      });
      // Contrato F4 T3: la búsqueda regresa lo LOCAL de inmediato (catálogo
      // vacío ⇒ 0 productos) con el job de ingesta EN VUELO.
      expect(result.calledMock).toBe(true);
      expect(result.products.length).toBe(0);
      expect(result.ingestion === undefined).toBe(false);

      const search = await pg.query(`SELECT called_mock FROM searches`);
      expect(search.rows[0].called_mock).toBe(true);

      // Determinismo en test: await del job (producción es fire-and-forget).
      const out = await result.ingestion!;
      expect(out.was_error).toBe(false);
      expect(out.processed).toBeGreaterThan(0);
      expect(getCallCount() - callsBefore).toBeGreaterThanOrEqual(1);

      const mc = await pg.query(`SELECT count(*)::int AS c FROM mock_calls`);
      expect(mc.rows[0].c).toBeGreaterThanOrEqual(1);

      // Smart mock generó productos relevantes, ya ingestados al catálogo.
      const relevant = await pg.query(
        `SELECT count(*)::int AS c FROM products
         WHERE lower(title) ~ '(auricular|audifono|audio|headphone|earphone|bluetooth)'`,
      );
      expect(relevant.rows[0].c).toBeGreaterThan(0);

      // El job invalidó la caché exacta ⇒ la MISMA query re-recupera y ahora
      // sí incluye lo externo.
      const again = await hybridSearch("auriculares bluetooth con cancelación de ruido", {
        pg,
        anonymous_id: randomUUID(),
        user_id: null,
      });
      expect(again.hitCache).toBe(false);
      expect(again.products.length).toBeGreaterThan(0);
    });
  }, 240_000);

  test("SEARCH_ASYNC_INGEST=false → modo síncrono legacy: la primera búsqueda incluye lo externo", async () => {
    process.env.SEARCH_ASYNC_INGEST = "false";
    try {
      await withTestDb(async (pg) => {
        const result = await hybridSearch("mochila escolar resistente", {
          pg,
          anonymous_id: randomUUID(),
          user_id: null,
        });
        expect(result.calledMock).toBe(true);
        expect(result.ingestion === undefined).toBe(true);
        expect(result.products.length).toBeGreaterThan(0);
      });
    } finally {
      delete process.env.SEARCH_ASYNC_INGEST;
    }
  }, 240_000);

  test("count >= 12 + confidence > 0.5 → mock NOT invoked even with valid query", async () => {
    await withTestDb(async (pg) => {
      // Seed 15 products in 'electronica' so count >= 12
      const { seedProductWithEmbedding } = await import("@/../tests/helpers/seed");
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, {
          title: `Audífonos modelo ${i}`,
          description: "auriculares bluetooth",
          metadata: { category: "electronica" },
          raw_category: "electronica",
        });
      }
      const callsBefore = getCallCount();
      const result = await hybridSearch("audífonos bluetooth", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(result.calledMock).toBe(false);
      expect(getCallCount() - callsBefore).toBe(0);
    });
  }, 240_000);

  test("low confidence + count < 12 → mock NOT invoked (early skip)", async () => {
    await withTestDb(async (pg) => {
      // No products. Garbage query → low confidence.
      const callsBefore = getCallCount();
      const result = await hybridSearch("asdfgh qwerty zzzz", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(result.calledMock).toBe(false);
      expect(getCallCount() - callsBefore).toBe(0);
      const mc = await pg.query(`SELECT count(*)::int AS c FROM mock_calls`);
      expect(mc.rows[0].c).toBe(0);
    });
  }, 60_000);

  // F4 T7: 15 productos LOCALES recuperados por coseno pero SEMÁNTICAMENTE lejanos
  // (score ~0.2, sin match léxico BM25) NO son "hits fuertes". Con la política vieja
  // (fused.length=15 ≥ 12) esto marcaba "enough_local_hits" y mataba la ingesta; con
  // el piso 0.55 la decisión ya no los cuenta. Freshness reciente suprime la llamada
  // pagada para que el test sea determinista y barato.
  test("15 vecinos coseno flojos (score < piso) NO cuentan como hits fuertes", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, {
          title: `Auriculares inalambricos bluetooth modelo ${i}`,
          description: "audio, cancelacion de ruido, para musica",
          metadata: { category: "electronica" },
          raw_category: "electronica",
        });
      }
      const q = "bujia para motor fuera de borda nautico repuesto";
      // Ya aggregada hace 1s ⇒ freshness suprime el pago; la decisión es determinista.
      await recordQueryAggregatorCall(hashQuery(q), 0, pg);

      const callsBefore = getCallCount();
      const result = await hybridSearch(q, { pg, anonymous_id: randomUUID(), user_id: null }, { trace: true });
      const decision = result.trace!.decision;

      // Los 15 productos SÍ fueron recuperados por coseno...
      expect(result.trace!.retrieval.cosine.length).toBeGreaterThan(0);
      // ...pero NINGUNO es fuerte (score < 0.55, 0 BM25) ⇒ la decisión ve < 12.
      expect(decision.strong_hits).toBeLessThan(12);
      // ⇒ jamás es "enough_local_hits" (la política vieja lo habría sido).
      expect(decision.reason).not.toBe("enough_local_hits");
      // Sin pago (freshness), determinista.
      expect(result.calledMock).toBe(false);
      expect(getCallCount() - callsBefore).toBe(0);
    });
  }, 120_000);
});
