// tests/unit/storefront-map.test.ts
import { describe, it, expect } from "vitest";
import type { ComposedPage } from "@/sectors/f-slate/compose";
import type { ResolvedSection } from "@/sectors/f-slate/sections/types";
import { toPage, toSection } from "@/storefront/map";

const section: ResolvedSection = {
  placement_id: "pl1", section_type: "hero_grid", slot: 10, title: "Para ti",
  display: "grid",
  items: [
    { id: "p1", title: "Auriculares", price_cents: 125000, currency: "CUP", image_url: "/p1.jpg", source: "amazon", reason: "viste audio", position: 1001 },
    { id: "p2", title: "Sin foto", price_cents: 9900, currency: "CUP", image_url: null, source: "aliexpress" },
  ],
  next_cursor: "cur-1", slate_id: "sl9", outcome: "served", resolve_ms: 4,
};
const page = { composition_id: "c1", surface: "home", placements: [], rule_ctx: {}, config_source: "db", config_version: "v1" } as unknown as ComposedPage;

describe("storefront trim", () => {
  it("drops engine internals, keeps raw money + nullable image + slate_id + outcome", () => {
    const s = toSection(section);
    expect(s).toEqual({
      placement_id: "pl1", section_type: "hero_grid", title: "Para ti", display: "grid",
      outcome: "served", next_cursor: "cur-1", slate_id: "sl9",
      items: section.items, // raw cards passthrough
    });
    expect("slot" in s).toBe(false);
    expect("resolve_ms" in s).toBe(false);
    expect(s.items[0].price_cents).toBe(125000); // raw, no formatted
    expect(s.items[1].image_url).toBeNull();      // nullable preserved
  });

  it("toPage carries composition_id + surface", () => {
    const out = toPage(page, [section], "home");
    expect(out.composition_id).toBe("c1");
    expect(out.surface).toBe("home");
    expect(out.sections).toHaveLength(1);
  });
});
