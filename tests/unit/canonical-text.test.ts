import { describe, test, expect } from "vitest";
import { buildCanonicalText } from "@/sectors/b-catalog/enrichment/canonical";

const baseProduct = {
  id: "x",
  source: "amazon" as const,
  source_product_id: "1",
  title: "Auriculares inalámbricos",
  description: "Cancelación de ruido activa, batería 30h",
  image_url: "u",
  price_cents: 1000,
  brand: "B",
  raw_category: "electronica",
  attributes: {},
};

const baseMetadata = {
  category: "electronica" as const,
  subcategory: "audifonos",
  gender_target: null,
  age_target: { min: null, max: null },
  occasion: [],
  style: [],
  keywords: ["bluetooth", "ruido"],
  enrichment_status: "ok" as const,
  prompt_version: "v1.0.0-fase1",
};

describe("buildCanonicalText", () => {
  test("includes title, description, category+subcategory, and keywords joined", () => {
    const text = buildCanonicalText(baseProduct, baseMetadata);
    expect(text).toContain("Auriculares inalámbricos");
    expect(text).toContain("Cancelación de ruido activa, batería 30h");
    expect(text).toContain("electronica audifonos");
    expect(text).toContain("bluetooth");
    expect(text).toContain("ruido");
  });

  test("two products with same title but different descriptions produce different canonical texts", () => {
    const a = buildCanonicalText(
      { ...baseProduct, description: "Cancelación de ruido activa" },
      baseMetadata,
    );
    const b = buildCanonicalText(
      { ...baseProduct, description: "Sin cancelación de ruido" },
      baseMetadata,
    );
    expect(a).not.toBe(b);
  });

  test("missing subcategory: only category appears", () => {
    const text = buildCanonicalText(baseProduct, { ...baseMetadata, subcategory: null });
    expect(text).toContain("electronica");
    expect(text).not.toMatch(/electronica\s+null/);
  });
});
