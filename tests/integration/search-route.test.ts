import { describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding, createAnonymousSession } from "@/../tests/helpers/seed";
import { GET } from "@/app/api/search/route";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache", "searches", "products", "anonymous_sessions"]);
});

function makeReq(q: string, cookies: Record<string, string> = {}): NextRequest {
  const url = `http://localhost:3000/api/search?q=${encodeURIComponent(q)}`;
  const headers = new Headers();
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookieStr) headers.set("cookie", cookieStr);
  return new NextRequest(url, { method: "GET", headers });
}

describe("GET /api/search (hybrid)", () => {
  test("empty q → empty result with no_query shape", async () => {
    const res = await GET(makeReq(""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ products: [], count: 0, hit_cache: false, called_mock: false });
  });

  test("real query with seeded products → returns hybrid result with normalized shape", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, { title: `Camiseta deportiva ${i}`, description: "camiseta deportiva de manga corta", metadata: { category: "ropa" }, raw_category: "ropa" });
      }
      const anonId = await createAnonymousSession(pg);
      const res = await GET(makeReq("camiseta deportiva", { anonymous_id: anonId }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBeGreaterThan(0);
      expect(body.method).toBe("hybrid_rrf");
      expect(body.normalized).toMatchObject({ search_terms: expect.any(String), confidence: expect.any(Number) });
    });
  }, 120_000);

  test("second identical request returns hit_cache=true", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, { title: `Pantalón corto ${i}`, description: "pantalón corto de verano", metadata: { category: "ropa" }, raw_category: "ropa" });
      }
      const anonId = await createAnonymousSession(pg);
      const res1 = await GET(makeReq("pantalón corto", { anonymous_id: anonId }));
      const body1 = await res1.json();
      const res2 = await GET(makeReq("pantalón corto", { anonymous_id: anonId }));
      const body2 = await res2.json();
      expect(body1.hit_cache).toBe(false);
      expect(body2.hit_cache).toBe(true);
      expect(body2.products.map((p: { id: string }) => p.id)).toEqual(body1.products.map((p: { id: string }) => p.id));
    });
  }, 180_000);

  test("garbage query → 200 + count=0 or low + called_mock=false", async () => {
    process.env.HYBRID_SEARCH_MOCK_LIMIT = "2"; // safety cap if mock fallback fires
    try {
      const res = await GET(makeReq("asdfgh qwerty zzzz"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.called_mock).toBe(false);
      // "low confidence" path: count should be empty or very small, never large.
      expect(body.count).toBeLessThanOrEqual(5);
      expect(typeof body.count).toBe("number");
    } finally {
      delete process.env.HYBRID_SEARCH_MOCK_LIMIT;
    }
  }, 60_000);
});
