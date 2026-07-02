import { describe, test, expect } from "vitest";
import { makeRng } from "@/thesis/data/rng";
import { buildWorld } from "@/sectors/g-agents/sim/world";
import { makeArmPolicy, type UserState } from "@/sectors/g-agents/sim/policy";
import type { ExposureContext, SimUser } from "@/thesis/data/behavior-model";

/**
 * El exploit del fallback orgánico-oráculo (anti-trampa A3 §8 #7): un slate []
 * activa el régimen ORGÁNICO del generador (buscador personal perfecto). Con 0
 * placements la política DEBE servir DEFAULT_PLACEMENTS (hero), jamás [].
 */

const SPEC = { universeSize: 200, activeAtE0: 160, users: 10, measuredEpochs: 1 };

function fakeCtx(): ExposureContext {
  const user: SimUser = {
    user_id: "u-test",
    latent_state: { tasteSubcategories: [], budgetBand: 1 },
    p_gift: 0,
    price_sensitivity: 0.5,
    recipients: [],
  };
  return { user, sessionIndex: 0, isGift: false, recipient: null, rng: makeRng(1) };
}

const emptyState: UserState = {
  viewedSubsByUser: new Map(),
  lastViewedByUser: new Map(),
  cohortByUser: new Map(),
  viewCountByUser: new Map(),
};

describe("makeArmPolicy: 0 placements ⇒ DEFAULT, jamás []", () => {
  test("store vacío ⇒ slate del hero default, no vacío", () => {
    const world = buildWorld(123, SPEC);
    const arm = makeArmPolicy({
      rows: [], // config evaluó a 0 placements
      holdoutRows: null,
      artifacts: { popularity: new Map(), npmiTop: new Map() },
      userState: emptyState,
      world,
      epoch: 0,
    });
    const slate = arm.policy(fakeCtx());
    expect(slate.length).toBeGreaterThan(0);
    expect(arm.exposures).toHaveLength(1);
    expect(arm.exposures[0].items[0].section_type).toBe("hero_grid");
    expect(arm.exposures[0].items[0].placement_id).toBe("default-home-hero");
    // todo lo servido es activo (máscara estructural)
    const active = world.activeIds(0);
    for (const id of slate) expect(active.has(id)).toBe(true);
  });
});
