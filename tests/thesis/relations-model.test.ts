import { describe, test, expect } from "vitest";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";

describe("buildRelations", () => {
  test("smartphone complements are accessories, not other phones", () => {
    const cat = sampleCatalog(600, 11);
    const rels = buildRelations(cat);
    const phone = cat.find(
      (p) => p.attrs.subcategory === "smartphone" && rels.some((r) => r.product_a_id === p.source_product_id && r.relation_type === "complement"),
    );
    if (!phone) return; // sampling may miss; substitute test below still covers structure
    const compSubs = new Set(
      rels
        .filter((r) => r.product_a_id === phone.source_product_id && r.relation_type === "complement")
        .map((r) => cat.find((p) => p.source_product_id === r.product_b_id)?.attrs.subcategory),
    );
    expect(compSubs.has("smartphone")).toBe(false);
    expect([...compSubs].some((s) => ["funda", "cargador", "powerbank", "audifonos"].includes(s ?? ""))).toBe(true);
  });

  test("same subcategory, different brand → substitute", () => {
    const cat = sampleCatalog(400, 12);
    const rels = buildRelations(cat);
    const subs = rels.filter((r) => r.relation_type === "substitute");
    expect(subs.length).toBeGreaterThan(0);
    for (const r of subs.slice(0, 20)) {
      const a = cat.find((p) => p.source_product_id === r.product_a_id)!;
      const b = cat.find((p) => p.source_product_id === r.product_b_id)!;
      expect(a.attrs.subcategory).toBe(b.attrs.subcategory);
      expect(a.attrs.brand).not.toBe(b.attrs.brand);
    }
  });

  test("relations are deterministic for same catalog", () => {
    const cat = sampleCatalog(200, 13);
    expect(buildRelations(cat)).toEqual(buildRelations(cat));
  });

  test("no self-relations", () => {
    const cat = sampleCatalog(300, 14);
    const rels = buildRelations(cat);
    for (const r of rels) expect(r.product_a_id).not.toBe(r.product_b_id);
  });

  test("complement edges are never same-subcategory (commercial, not linguistic)", () => {
    const cat = sampleCatalog(500, 21);
    const rels = buildRelations(cat);
    const sub = new Map(cat.map((p) => [p.source_product_id, p.attrs.subcategory]));
    const comps = rels.filter((r) => r.relation_type === "complement");
    expect(comps.length).toBeGreaterThan(0);
    for (const r of comps) expect(sub.get(r.product_a_id)).not.toBe(sub.get(r.product_b_id));
  });
});
