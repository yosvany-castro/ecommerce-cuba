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

  test("cubre is_active=true filter y LIMIT 6: 7 activos + 1 inactivo → devuelve 6, excluye inactivo", async () => {
    await withTestDb(async (pg) => {
      // Seed 7 active products
      const activeProducts: { id: string }[] = [];
      for (let i = 1; i <= 7; i++) {
        const p = await seedProduct(pg, { title: `Zapatilla Test ${i}` });
        activeProducts.push(p);
      }

      // Seed 1 inactive product with the same token
      const inactiveProduct = await seedProduct(pg, { title: "Zapatilla Test 8" });
      await pg.query(`UPDATE products SET is_active = false WHERE id = $1`, [inactiveProduct.id]);

      // Request with distinctive token
      const res = await GET(makeReq("Zapatilla Test"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.suggestions)).toBe(true);

      // Assert exactly 6 results (LIMIT 6)
      expect(body.suggestions).toHaveLength(6);

      // Assert that all results are active and the inactive product is excluded
      const returnedIds = body.suggestions.map((s: { id: string }) => s.id);
      expect(returnedIds).not.toContain(inactiveProduct.id);

      // Verify all returned products are among the 7 active ones
      for (const returned of body.suggestions) {
        expect(activeProducts.map(p => p.id)).toContain(returned.id);
      }
    });
  });
});
