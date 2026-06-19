import { describe, test, expect } from "vitest";
import { createHash } from "node:crypto";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import {
  sampleBehavior,
  type ExposureContext,
  type JourneyPolicyResult,
  type SurfaceSection,
  type JourneyExposedItem,
} from "@/thesis/data/behavior-model";

/**
 * Build-A — the FAITHFUL multi-surface journey regime (spec §3-4, §10).
 *
 * These tests pin the GENERATOR-level invariants of journeyPolicy directly,
 * without the sim package: (a) the audited no-knob path stays bit-identical;
 * (b) hero sovereignty — P(examine hero[i]) ≈ λ^i; (c) the endogenous journey
 * actually renders pdp/cart surfaces; (d) the two-level vertical decay holds.
 */

const sha = (x: unknown): string =>
  createHash("sha256").update(JSON.stringify(x), "utf8").digest("hex");

const mkItem = (id: string): JourneyExposedItem => ({
  product_id: id,
  placement_id: "pl-test",
  section_type: "hero_grid",
  placement_version: 1,
  source: "exploit",
  propensity: 1,
});

const mkSection = (ids: string[], sectionType = "hero_grid"): SurfaceSection => ({
  sectionType,
  placementId: `pl-${sectionType}`,
  placementVersion: 1,
  items: ids.map((id) => ({ ...mkItem(id), section_type: sectionType, placement_id: `pl-${sectionType}` })),
});

describe("journeyPolicy: audited no-knob path untouched", () => {
  test("omitting journeyPolicy ⇒ bit-identical to the plain run (frozen hash)", () => {
    const cat = sampleCatalog(300, 1);
    const plain = sampleBehavior(cat, { users: 25, days: 45, seed: 77 });
    // The v3 test owns the canonical hash; here we only assert journeyPolicy is
    // not present and adds no field when absent.
    expect("journeyExposures" in plain).toBe(false);
    expect(sha(plain)).toBe(sha(sampleBehavior(cat, { users: 25, days: 45, seed: 77 })));
  });

  test("journeyPolicy and exposurePolicy together throw (mutually exclusive)", () => {
    const cat = sampleCatalog(50, 1);
    expect(() =>
      sampleBehavior(cat, {
        users: 1,
        days: 10,
        seed: 1,
        exposurePolicy: () => [],
        journeyPolicy: () => null,
      }),
    ).toThrow(/mutually exclusive/);
  });

  test("returning null per session ⇒ organic fallback (no journeyExposures rows)", () => {
    const cat = sampleCatalog(300, 1);
    const out = sampleBehavior(cat, { users: 20, days: 45, seed: 7, journeyPolicy: () => null });
    expect(out.journeyExposures).toBeDefined();
    expect(out.journeyExposures).toHaveLength(0);
    // organic fallback still produced events
    expect(out.events.length).toBeGreaterThan(0);
  });
});

describe("journeyPolicy: hero sovereignty (P(examine hero[i]) ≈ λ^i)", () => {
  test("first home section item i examined with prob λ^i (Monte Carlo)", () => {
    const cat = sampleCatalog(400, 3);
    const heroIds = cat.slice(0, 12).map((p) => p.source_product_id);
    const lambda = 0.85;
    // Hero-only home, no pdp/cart, so the ONLY thing that runs is the home
    // section-0 horizontal cascade — exactly the legacy single-cascade attention.
    const policy = (): JourneyPolicyResult => ({
      policyArm: "default",
      home: [mkSection(heroIds)],
      resolvePdp: () => [],
      resolveCart: () => [],
    });
    const out = sampleBehavior(cat, {
      users: 2000,
      days: 30,
      seed: 99,
      pGiftOverride: 0,
      journeyPolicy: policy,
    });
    // examined[i] = product_view of heroIds[i] over all sessions.
    const sessions = out.sessions.length;
    const viewByPos = new Array(heroIds.length).fill(0);
    const viewsBySession = new Map<string, Set<string>>();
    for (const e of out.events) {
      if (e.event_type !== "product_view") continue;
      const s = viewsBySession.get(e.session_id) ?? new Set();
      s.add(e.product_id);
      viewsBySession.set(e.session_id, s);
    }
    for (const seen of viewsBySession.values()) {
      heroIds.forEach((id, i) => {
        if (seen.has(id)) viewByPos[i] += 1;
      });
    }
    // P(examine hero[i]) must track λ^i within Monte-Carlo tolerance.
    for (let i = 0; i < 6; i++) {
      const empirical = viewByPos[i] / sessions;
      const expected = Math.pow(lambda, i);
      expect(Math.abs(empirical - expected)).toBeLessThan(0.04);
    }
  });
});

describe("journeyPolicy: two-level vertical decay across sections", () => {
  test("P(reach section v) ≈ λ^v: a section-v item is examined ≈ λ^v of the time", () => {
    const cat = sampleCatalog(400, 3);
    const lambda = 0.85;
    // 4 vertical sections, each a single distinct item. Section v's only item is
    // examined iff the vertical cascade reaches v ⇒ empirical share ≈ λ^v.
    const probes = cat.slice(0, 4).map((p) => p.source_product_id);
    const policy = (): JourneyPolicyResult => ({
      policyArm: "default",
      home: probes.map((id) => mkSection([id], "popular")),
      resolvePdp: () => [],
      resolveCart: () => [],
    });
    const out = sampleBehavior(cat, {
      users: 2500,
      days: 30,
      seed: 4242,
      pGiftOverride: 0,
      journeyPolicy: policy,
    });
    const sessions = out.sessions.length;
    const viewsBySession = new Map<string, Set<string>>();
    for (const e of out.events) {
      if (e.event_type !== "product_view") continue;
      const s = viewsBySession.get(e.session_id) ?? new Set();
      s.add(e.product_id);
      viewsBySession.set(e.session_id, s);
    }
    const reached = new Array(probes.length).fill(0);
    for (const seen of viewsBySession.values()) {
      probes.forEach((id, v) => {
        if (seen.has(id)) reached[v] += 1;
      });
    }
    for (let v = 0; v < probes.length; v++) {
      const empirical = reached[v] / sessions;
      const expected = Math.pow(lambda, v);
      expect(Math.abs(empirical - expected)).toBeLessThan(0.04);
    }
  });
});

describe("journeyPolicy: endogenous depth-1 journey (pdp + cart surfaces)", () => {
  test("a viewed home item opens its PDP; a carted item opens the cart", () => {
    const cat = sampleCatalog(400, 5);
    const heroIds = cat.slice(0, 8).map((p) => p.source_product_id);
    const crossId = cat[300].source_product_id; // distinct from hero
    const cartAddonId = cat[350].source_product_id;
    const seenPdpAnchors: string[] = [];
    const seenCartIds: string[][] = [];
    const policy = (): JourneyPolicyResult => ({
      policyArm: "default",
      home: [mkSection(heroIds)],
      resolvePdp: (anchor) => {
        seenPdpAnchors.push(anchor);
        return [mkSection([crossId], "cross_sell")];
      },
      resolveCart: (ids) => {
        seenCartIds.push(ids);
        return [mkSection([cartAddonId], "cart_addons")];
      },
    });
    const out = sampleBehavior(cat, {
      users: 300,
      days: 30,
      seed: 11,
      pGiftOverride: 0,
      journeyPolicy: policy,
    });
    const exps = out.journeyExposures!;
    expect(exps.length).toBe(out.sessions.length);

    // At least some sessions render the pdp surface (a home item was viewed).
    const pdpImps = exps.flatMap((e) => e.impressions.filter((i) => i.surface === "pdp"));
    expect(pdpImps.length).toBeGreaterThan(0);
    expect(pdpImps.every((i) => i.section_type === "cross_sell")).toBe(true);
    // resolvePdp was called with home product ids only.
    expect(seenPdpAnchors.every((a) => heroIds.includes(a))).toBe(true);

    // Some sessions carted something ⇒ a cart surface was rendered.
    const cartImps = exps.flatMap((e) => e.impressions.filter((i) => i.surface === "cart"));
    expect(cartImps.length).toBeGreaterThan(0);
    expect(cartImps.every((i) => i.section_type === "cart_addons")).toBe(true);

    // Depth-1: cross_sell / cart_addons items NEVER open further PDP/cart
    // surfaces — resolvePdp is only ever called with home (hero) ids.
    expect(seenPdpAnchors.includes(crossId)).toBe(false);
    expect(seenPdpAnchors.includes(cartAddonId)).toBe(false);
  });

  test("deterministic by seed under a fixed journeyPolicy", () => {
    const cat = sampleCatalog(300, 2);
    const ids = cat.slice(0, 10).map((p) => p.source_product_id);
    const mk = (): JourneyPolicyResult => ({
      policyArm: "default",
      home: [mkSection(ids)],
      resolvePdp: () => [mkSection([cat[200].source_product_id], "cross_sell")],
      resolveCart: () => [mkSection([cat[250].source_product_id], "cart_addons")],
    });
    const opts = { users: 40, days: 30, seed: 5, pGiftOverride: 0, journeyPolicy: mk };
    const a = sampleBehavior(cat, opts);
    const b = sampleBehavior(cat, opts);
    expect(sha(a)).toBe(sha(b));
  });
});
