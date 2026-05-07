import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProduct } from "@/../tests/helpers/seed";
import { listByDate, getById, searchLike } from "@/sectors/b-catalog/repository/products";

beforeEach(async () => {
  await truncateTestTables(["products"]);
});

describe("products repository", () => {
  test("listByDate orders by created_at DESC", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProduct(pg, { title: "First" });
      await new Promise((r) => setTimeout(r, 30));
      const b = await seedProduct(pg, { title: "Second" });
      await new Promise((r) => setTimeout(r, 30));
      const c = await seedProduct(pg, { title: "Third" });

      const rows = await listByDate({ limit: 10, pg });
      expect(rows.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    });
  });

  test("listByDate respects limit", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 5; i++) await seedProduct(pg, { title: `P${i}` });
      const rows = await listByDate({ limit: 2, pg });
      expect(rows).toHaveLength(2);
    });
  });

  test("getById returns the product or null", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProduct(pg, { title: "Findable" });
      const found = await getById(a.id, pg);
      expect(found?.id).toBe(a.id);
      expect(found?.title).toBe("Findable");
      const missing = await getById("00000000-0000-0000-0000-000000000000", pg);
      expect(missing).toBeNull();
    });
  });

  test("searchLike matches title (ILIKE) — case-insensitive", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProduct(pg, { title: "Auriculares Sony" });
      await seedProduct(pg, { title: "Camiseta de algodón" });
      const r = await searchLike({ query: "auriculares", pg });
      expect(r.map((p) => p.id)).toEqual([a.id]);
    });
  });

  test("searchLike matches description and returns empty array on no match", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProduct(pg, { title: "Producto X", description: "tela impermeable" });
      const matched = await searchLike({ query: "impermeable", pg });
      expect(matched.map((p) => p.id)).toEqual([a.id]);
      const empty = await searchLike({ query: "no-existe-zzzz", pg });
      expect(empty).toEqual([]);
    });
  });
});
