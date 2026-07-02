// tests/unit/storefront-pages.test.ts — wiring del DAL con el motor mockeado.
// No se mockea @/lib/db/helpers (R3): se testean los núcleos *(identity, pg)
// pasando un pg inerte que los mocks del motor jamás usan.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Client } from "pg";

const { composePage, logSlateDecision, resolveSections } = vi.hoisted(() => ({
  composePage: vi.fn(),
  logSlateDecision: vi.fn(),
  resolveSections: vi.fn(),
}));
vi.mock("@/sectors/f-slate/compose", () => ({ composePage, logSlateDecision }));
vi.mock("@/sectors/f-slate/sections/resolve", () => ({ resolveSections }));
vi.mock("@/sectors/d-personalization/holdout", () => ({ isHoldout: vi.fn(() => false) }));
// evita cargar next/headers + Auth0Client en entorno de unit test
vi.mock("@/storefront/identity", () => ({ resolveIdentity: vi.fn() }));

import { homePage } from "@/storefront/pages/home";
import { productSections } from "@/storefront/pages/product";

const identity = { user_id: null, anonymous_id: "a1", session_id: "s1" };
const pg = {} as Client; // inerte: el motor está mockeado, nadie lo usa
const composed = { composition_id: "c1", surface: "home", placements: [], rule_ctx: {}, config_source: "db", config_version: "v1" };
const hero = [{ placement_id: "pl1", section_type: "hero_grid", slot: 10, title: "Para ti", display: "grid", items: [], next_cursor: null, slate_id: "sl1", outcome: "served", resolve_ms: 1 }];

beforeEach(() => vi.clearAllMocks());

describe("storefront pages", () => {
  it("homePage compone home + loguea el slate_id del hero + devuelve página trimmed", async () => {
    composePage.mockResolvedValue(composed);
    resolveSections.mockResolvedValue(hero);
    const out = await homePage(identity, pg);
    expect(composePage).toHaveBeenCalledWith({ surface: "home", identity }, pg);
    expect(logSlateDecision.mock.calls[0][1].slate_id).toBe("sl1");
    expect(out.composition_id).toBe("c1");
    expect(out.sections[0].placement_id).toBe("pl1");
    expect("slot" in out.sections[0]).toBe(false);
  });

  it("productSections compone pdp con ancla + categoría", async () => {
    composePage.mockResolvedValue({ ...composed, surface: "pdp" });
    resolveSections.mockResolvedValue([]);
    const out = await productSections(identity, "p9", "audio", pg);
    expect(composePage).toHaveBeenCalledWith(
      { surface: "pdp", identity, surfaceArgs: { pdp_product_id: "p9", pdp_category: "audio" } },
      pg,
    );
    expect(out).toEqual([]);
  });
});
