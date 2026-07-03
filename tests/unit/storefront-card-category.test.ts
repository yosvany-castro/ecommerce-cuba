// tests/unit/storefront-card-category.test.ts
import { describe, expect, it } from "vitest";
import { toCard } from "@/storefront/map";

describe("toCard", () => {
  it("propaga metadata.category al StorefrontCard", () => {
    const c = toCard(
      {
        id: "x", title: "t", description: "", price_cents: 100, currency: "USD",
        image_url: null, metadata: { category: "hogar" }, created_at: "2026-01-01",
      } as never,
      "por algo",
      3,
    );
    expect(c.category).toBe("hogar");
    expect(c.reason).toBe("por algo");
  });
  it("category null si metadata no la trae", () => {
    const c = toCard({
      id: "x", title: "t", description: "", price_cents: 100, currency: "USD",
      image_url: null, metadata: {}, created_at: "",
    } as never);
    expect(c.category).toBeNull();
  });
});
