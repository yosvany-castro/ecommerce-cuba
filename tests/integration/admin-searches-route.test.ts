import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { persistSearch } from "@/sectors/c-search/persist/searches";
import { GET } from "@/app/api/admin/searches/route";
import { listSearches } from "@/sectors/c-search/admin/list";

beforeEach(async () => {
  await truncateTestTables(["searches", "users", "anonymous_sessions"]);
});

const sample = {
  intent: "compra" as const,
  recipient_gender: null,
  recipient_age_min: null,
  recipient_age_max: null,
  categories: ["ropa"],
  style: [],
  price_range: null,
  search_terms: "camiseta",
  confidence: 0.9,
  prompt_version: "v1.0.0-fase2",
};

function makeReq(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

async function seed3Searches(pg: any) {
  // Use small wait between inserts so occurred_at order is deterministic
  for (let i = 0; i < 3; i++) {
    await persistSearch(
      {
        anonymous_id: randomUUID(),
        user_id: null,
        raw_query: `query ${i}`,
        normalized_json: sample,
        prompt_version: "v1.0.0-fase2",
        search_method: i === 0 ? "bm25_only" : "hybrid_rrf",
        results_count: i * 5,
        hit_cache: i === 1,
        called_mock: i === 2,
      },
      pg,
    );
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("GET /api/admin/searches", () => {
  test("no auth → 401", async () => {
    const res = await GET(makeReq("http://localhost:3000/api/admin/searches"));
    expect(res.status).toBe(401);
  });
});

describe("listSearches", () => {
  test("returns paginated rows ordered by occurred_at DESC", async () => {
    await withTestDb(async (pg) => {
      await seed3Searches(pg);
      const r = await listSearches({ page: 1, limit: 50 }, pg);
      expect(r.rows.length).toBe(3);
      expect(r.total).toBe(3);
      // Most recent first
      expect(new Date(r.rows[0].occurred_at).getTime()).toBeGreaterThanOrEqual(new Date(r.rows[1].occurred_at).getTime());
      expect(new Date(r.rows[1].occurred_at).getTime()).toBeGreaterThanOrEqual(new Date(r.rows[2].occurred_at).getTime());
    });
  });

  test("filters by hit_cache=true", async () => {
    await withTestDb(async (pg) => {
      await seed3Searches(pg);
      const r = await listSearches({ hit_cache: true }, pg);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].raw_query).toBe("query 1");
    });
  });

  test("filters by method=bm25_only", async () => {
    await withTestDb(async (pg) => {
      await seed3Searches(pg);
      const r = await listSearches({ method: "bm25_only" }, pg);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].raw_query).toBe("query 0");
    });
  });

  test("paginates with limit=2 page=1 then page=2", async () => {
    await withTestDb(async (pg) => {
      await seed3Searches(pg);
      const p1 = await listSearches({ page: 1, limit: 2 }, pg);
      expect(p1.rows.length).toBe(2);
      expect(p1.total).toBe(3);
      const p2 = await listSearches({ page: 2, limit: 2 }, pg);
      expect(p2.rows.length).toBe(1);
      expect(p2.total).toBe(3);
    });
  });
});
