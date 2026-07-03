import { describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProduct } from "@/../tests/helpers/seed";
import { GET } from "@/app/api/suggest/route";

beforeEach(async () => {
  await truncateTestTables(["products"]);
});

function makeReq(q: string): NextRequest {
  return new NextRequest(`http://x/api/suggest?q=${encodeURIComponent(q)}`);
}

describe("GET /api/suggest", () => {
  test("devuelve máx 6 sugerencias con id, title y category", async () => {
    await withTestDb(async (pg) => {
      await seedProduct(pg, { title: "Freidora eléctrica", metadata: { category: "cocina" } });
      const res = await GET(makeReq("frei"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.suggestions)).toBe(true);
      expect(body.suggestions.length).toBeLessThanOrEqual(6);
      for (const s of body.suggestions) {
        expect(typeof s.id).toBe("string");
        expect(typeof s.title).toBe("string");
      }
      expect(body.suggestions.some((s: { title: string }) => s.title === "Freidora eléctrica")).toBe(true);
      expect(body.suggestions.find((s: { title: string; category: string | null }) => s.title === "Freidora eléctrica")?.category).toBe("cocina");
    });
  });

  test("q vacía → lista vacía sin tocar DB", async () => {
    const res = await GET(makeReq(""));
    expect((await res.json()).suggestions).toEqual([]);
  });

  test("q de 1 carácter → lista vacía (umbral mínimo 2)", async () => {
    const res = await GET(makeReq("a"));
    expect((await res.json()).suggestions).toEqual([]);
  });
});
