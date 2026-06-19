import { describe, test, expect } from "vitest";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import {
  sampleBehavior,
  type JourneyPolicyResult,
  type SurfaceSection,
  type JourneyExposedItem,
} from "@/thesis/data/behavior-model";
import { buildWorld } from "@/sectors/g-agents/sim/world";
import { buildUserState, makeArmJourneyPolicy } from "@/sectors/g-agents/sim/policy";
import { makeArm, ingestEpoch, realizedMarginCents } from "@/sectors/g-agents/sim/ledger";
import { SimPlacementStore } from "@/sectors/g-agents/sim/store";
import { runEpochCrons } from "@/sectors/g-agents/sim/crons";
import { epochStart, SLATE_K } from "@/sectors/g-agents/sim/constants";

/**
 * Build-A sim-level tests (spec §10): per-section truncation (no global
 * slice-20), the journey writing pdp/cart impressions to the ledger, and
 * surface-has-signal — an agent carousel with real items raises the realized
 * margin vs a hero-only frozen arm (the regression the multi-surface world
 * fixes: today the carousel is sliced away ⇒ zero lift).
 */

const SPEC = { universeSize: 600, activeAtE0: 480, users: 200, measuredEpochs: 2 };

const mkItem = (id: string, sectionType: string, placementId: string): JourneyExposedItem => ({
  product_id: id,
  placement_id: placementId,
  section_type: sectionType,
  placement_version: 1,
  source: "exploit",
  propensity: 1,
});

const mkSection = (ids: string[], sectionType: string, placementId: string): SurfaceSection => ({
  sectionType,
  placementId,
  placementVersion: 1,
  items: ids.map((id) => mkItem(id, sectionType, placementId)),
});

/** Seed the frozen hero (≡ engine.seedFrozenConfig) into a store. */
function seedHero(store: SimPlacementStore): void {
  const t0 = epochStart(0);
  store.seed({
    surface: "home", slot: 10, section_type: "hero_grid", params: { limit: 20 },
    rule: null, scope: "global", scope_ref: null, status: "approved", risk_tier: "low",
    experiment_id: null, ttl_until: null, created_by: "seed", version: 1,
    created_at: t0, updated_at: t0, proposal_key: null, proposal_meta: null,
  });
}

describe("journey per-section truncation (no global slice-20)", () => {
  test("a second home section with limit L coexists, capped at L items per session", () => {
    const cat = sampleCatalog(600, 9);
    const heroIds = cat.slice(0, 18).map((p) => p.source_product_id);
    const carouselIds = cat.slice(18, 30).map((p) => p.source_product_id); // 12 items
    const L = 6;
    const policy = (): JourneyPolicyResult => ({
      policyArm: "default",
      home: [
        mkSection(heroIds, "hero_grid", "pl-hero"),
        mkSection(carouselIds.slice(0, L), "popular", "pl-pop"),
      ],
      resolvePdp: () => [],
      resolveCart: () => [],
    });
    const out = sampleBehavior(cat, {
      users: 100, days: 30, seed: 3, pGiftOverride: 0, journeyPolicy: policy,
    });
    let popSurfaced = false;
    for (const e of out.journeyExposures!) {
      const pop = e.impressions.filter((i) => i.section_type === "popular");
      expect(pop.length).toBeLessThanOrEqual(L);
      if (pop.length > 0) popSurfaced = true;
    }
    expect(popSurfaced).toBe(true); // the section survives — proof there is no global slice-20
  });

  test("the real sim policy renders >SLATE_K home items when the agent adds a carousel", () => {
    const world = buildWorld(123, SPEC);
    const t = 1;
    const store = new SimPlacementStore(99);
    seedHero(store);
    // An agent carousel below the hero (slot 20, popular global, 10 items).
    store.seed({
      surface: "home", slot: 20, section_type: "popular", params: { limit: 10, mode: "global" },
      rule: null, scope: "global", scope_ref: null, status: "approved", risk_tier: "low",
      experiment_id: null, ttl_until: null, created_by: "agent:merchandiser/v1", version: 1,
      created_at: epochStart(0), updated_at: epochStart(0), proposal_key: null, proposal_meta: null,
    });
    // Warm a log so popularity/npmi exist for the resolvers.
    const arm = makeArm("agent", store);
    const warm = sampleBehavior(world.epochView(0), {
      users: world.spec.users, days: 14, seed: world.worldSeed,
      attractivenessById: world.attractiveness(0),
    }, world.complements(0));
    ingestEpoch({ arm, out: warm, exposures: null, world, epoch: 0 });

    const artifacts = runEpochCrons(arm.log, t);
    const userState = buildUserState(arm.log, t, world);
    const rows = store.selectableRows(epochStart(t));
    const armPolicy = makeArmJourneyPolicy({
      rows, holdoutRows: null, artifacts, userState, world, epoch: t,
    });
    // Inspect ONE session's composed home: hero + carousel sections, each
    // truncated by its own limit — never the single 20-item list of the old world.
    let maxHomeItems = 0;
    let sawCarousel = false;
    const out = sampleBehavior(world.epochView(t), {
      users: world.spec.users, days: 14, seed: world.worldSeed,
      attractivenessById: world.attractiveness(t), journeyPolicy: armPolicy.policy,
    }, world.complements(t));
    for (const e of out.journeyExposures!) {
      const home = e.impressions.filter((i) => i.surface === "home");
      maxHomeItems = Math.max(maxHomeItems, home.length);
      if (home.some((i) => i.section_type === "popular")) sawCarousel = true;
    }
    expect(sawCarousel).toBe(true);
    // hero(20) + popular(10) ⇒ a home wider than SLATE_K=20 is now possible.
    expect(maxHomeItems).toBeGreaterThan(SLATE_K);
  });
});

describe("journey writes pdp + cart impressions to the ledger", () => {
  test("a viewed home item ⇒ surface='pdp'; a carted item ⇒ surface='cart'", () => {
    const cat = sampleCatalog(600, 9);
    const world = buildWorld(123, SPEC);
    const heroIds = cat.slice(0, 8).map((p) => p.source_product_id);
    const policy = (): JourneyPolicyResult => ({
      policyArm: "default",
      home: [mkSection(heroIds, "hero_grid", "pl-hero")],
      resolvePdp: () => [mkSection([cat[400].source_product_id], "cross_sell", "pl-xsell")],
      resolveCart: () => [mkSection([cat[450].source_product_id], "cart_addons", "pl-cart")],
    });
    const out = sampleBehavior(cat, {
      users: 250, days: 30, seed: 8, pGiftOverride: 0, journeyPolicy: policy,
    });
    const arm = makeArm("x", new SimPlacementStore(1));
    ingestEpoch({ arm, out, exposures: null, world, epoch: 0 });
    const surfaces = new Set(arm.log.impressions.map((i) => i.surface));
    expect(surfaces.has("home")).toBe(true);
    expect(surfaces.has("pdp")).toBe(true);
    expect(surfaces.has("cart")).toBe(true);
    const pdp = arm.log.impressions.find((i) => i.surface === "pdp")!;
    expect(pdp.section_id).toBe("cross_sell");
    expect(pdp.placement_id).toBe("pl-xsell");
    expect(pdp.position).toBeGreaterThanOrEqual(1);
  });
});

describe("surface-has-signal: an agent carousel raises realizedMarginCents vs frozen", () => {
  test("hero + popular carousel (real sim policy) beats hero-only — additive surface", () => {
    const world = buildWorld(2024, SPEC);
    const t = 1;

    const run = (withCarousel: boolean): number => {
      const store = new SimPlacementStore(withCarousel ? 11 : 22);
      seedHero(store);
      if (withCarousel) {
        store.seed({
          surface: "home", slot: 20, section_type: "popular",
          params: { limit: 10, mode: "global" }, rule: null, scope: "global", scope_ref: null,
          status: "approved", risk_tier: "low", experiment_id: null, ttl_until: null,
          created_by: "agent:merchandiser/v1", version: 1,
          created_at: epochStart(0), updated_at: epochStart(0), proposal_key: null, proposal_meta: null,
        });
      }
      const arm = makeArm(withCarousel ? "agent" : "frozen", store);
      // e0 warmup (organic) → e1 journey, ingest both.
      const out0 = sampleBehavior(world.epochView(0), {
        users: world.spec.users, days: 14, seed: world.worldSeed,
        attractivenessById: world.attractiveness(0),
      }, world.complements(0));
      ingestEpoch({ arm, out: out0, exposures: null, world, epoch: 0 });

      const artifacts = runEpochCrons(arm.log, t);
      const userState = buildUserState(arm.log, t, world);
      const rows = store.selectableRows(epochStart(t));
      const armPolicy = makeArmJourneyPolicy({
        rows, holdoutRows: null, artifacts, userState, world, epoch: t,
      });
      const out1 = sampleBehavior(world.epochView(t), {
        users: world.spec.users, days: 14, seed: world.worldSeed,
        attractivenessById: world.attractiveness(t), journeyPolicy: armPolicy.policy,
      }, world.complements(t));
      ingestEpoch({ arm, out: out1, exposures: null, world, epoch: t });
      return realizedMarginCents(arm, t, t);
    };

    const frozenMargin = run(false);
    const agentMargin = run(true);
    expect(frozenMargin).toBeGreaterThan(0);
    // The carousel is ADDITIVE (extra examined items that convert) ⇒ strictly
    // more realized margin. Under the old global slice-20 it would be ≈ frozen.
    expect(agentMargin).toBeGreaterThan(frozenMargin);
  });
});
