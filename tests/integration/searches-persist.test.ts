import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser } from "@/../tests/helpers/seed";
import { persistSearch } from "@/sectors/c-search/persist/searches";

beforeEach(async () => {
  await truncateTestTables(["searches", "users", "anonymous_sessions"]);
});

const sampleNormalized = {
  intent: "compra" as const,
  recipient_gender: null,
  recipient_age_min: null,
  recipient_age_max: null,
  categories: ["ropa"],
  style: [],
  price_range: null,
  search_terms: "camiseta",
  confidence: 0.85,
  prompt_version: "v1.0.0-fase2",
};

describe("persistSearch", () => {
  test("inserts a row with all fields including normalized_json", async () => {
    await withTestDb(async (pg) => {
      const anonId = randomUUID();
      await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [anonId]);
      await persistSearch(
        {
          anonymous_id: anonId,
          user_id: null,
          raw_query: "camiseta deportiva",
          normalized_json: sampleNormalized,
          prompt_version: "v1.0.0-fase2",
          search_method: "hybrid_rrf",
          results_count: 18,
          hit_cache: false,
          called_mock: false,
        },
        pg,
      );
      const r = await pg.query(`SELECT * FROM searches WHERE anonymous_id = $1`, [anonId]);
      expect(r.rows).toHaveLength(1);
      const row = r.rows[0];
      expect(row.raw_query).toBe("camiseta deportiva");
      expect(row.search_method).toBe("hybrid_rrf");
      expect(row.results_count).toBe(18);
      expect(row.hit_cache).toBe(false);
      expect(row.called_mock).toBe(false);
      expect(row.normalized_json).toMatchObject({ intent: "compra", search_terms: "camiseta" });
      expect(row.prompt_version).toBe("v1.0.0-fase2");
    });
  });

  test("accepts null normalized_json (LLM failure fallback)", async () => {
    await withTestDb(async (pg) => {
      await persistSearch(
        {
          anonymous_id: randomUUID(),
          user_id: null,
          raw_query: "asdfgh",
          normalized_json: null,
          prompt_version: null,
          search_method: "bm25_only",
          results_count: 0,
          hit_cache: false,
          called_mock: false,
        },
        pg,
      );
      const r = await pg.query(`SELECT normalized_json, prompt_version FROM searches`);
      expect(r.rows[0].normalized_json).toBeNull();
      expect(r.rows[0].prompt_version).toBeNull();
    });
  });

  test("attaches user_id when provided", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      await persistSearch(
        {
          anonymous_id: randomUUID(),
          user_id: user.id,
          raw_query: "regalo",
          normalized_json: sampleNormalized,
          prompt_version: "v1.0.0-fase2",
          search_method: "hybrid_rrf",
          results_count: 10,
          hit_cache: true,
          called_mock: false,
        },
        pg,
      );
      const r = await pg.query(`SELECT user_id, hit_cache FROM searches`);
      expect(r.rows[0].user_id).toBe(user.id);
      expect(r.rows[0].hit_cache).toBe(true);
    });
  });
});
