import { describe, test, expect } from "vitest";
import { sampleBehavior } from "@/thesis/data/behavior-model";
import { buildWorld } from "@/sectors/g-agents/sim/world";
import { runSeedPipeline } from "@/sectors/g-agents/sim/engine";

/**
 * Mundo no estacionario: (a) panel bit-estable — las subcategorías del view
 * son constantes entre épocas (si cambian, distinctSubcategories re-baraja a
 * los usuarios y los brazos dejan de ser comparables, A3 §1.1); (b) un shift
 * de demanda ×2-3 SUBE las compras de su subcategoría (el canal att→funnel
 * funciona); (c) inactivos jamás en eventos de épocas medidas + brazos
 * alineados (A/A determinista ⇒ ratio exactamente 1).
 * Solo seed de desarrollo (123) — los seeds del gate no se tocan.
 */

const SPEC = { universeSize: 400, activeAtE0: 320, users: 150, measuredEpochs: 3 };

describe("sim world (no estacionario, panel estable)", () => {
  test("subcategorías del epochView constantes entre épocas; universo inmutable", () => {
    const world = buildWorld(123, SPEC);
    const subsAt = (t: number) =>
      [...new Set(world.epochView(t).map((p) => p.attrs.subcategory))].sort().join("|");
    const base = subsAt(0);
    for (let t = 1; t < world.epochsTotal; t++) {
      expect(subsAt(t)).toBe(base);
      expect(world.epochView(t).map((p) => p.source_product_id)).toEqual(
        world.epochView(0).map((p) => p.source_product_id),
      );
    }
    world.assertUnchanged(); // hash estable post-lecturas
  });

  test("shift de demanda sube las compras de su subcategoría (direccional)", () => {
    const world = buildWorld(123, SPEC);
    // localizar el (t, sub) con mayor multiplicador del calendario muestreado
    let peak = { t: 0, sub: "", m: 0 };
    for (let t = 1; t < world.epochsTotal; t++) {
      for (const [sub, m] of world.calendar.epochs[t].demandBySubcategory) {
        if (m > peak.m) peak = { t, sub, m };
      }
    }
    expect(peak.m).toBeGreaterThanOrEqual(1.4); // hay evento real en el calendario
    const view = world.epochView(peak.t);
    const subOf = new Map(view.map((p) => [p.source_product_id, p.attrs.subcategory]));
    const buysIn = (att: Map<string, number>): number => {
      const out = sampleBehavior(view, {
        users: SPEC.users,
        days: 14,
        seed: 123,
        priceGamma: 0.8,
        pGiftMax: 0.16,
        stochasticChoice: true,
        attractivenessById: att,
      });
      return out.events.filter(
        (e) => e.event_type === "purchase" && subOf.get(e.product_id) === peak.sub,
      ).length;
    };
    // mismo mundo/época, atractividad con el shift vs la del estado inicial:
    const withShift = buysIn(world.attractiveness(peak.t));
    const withoutShift = buysIn(world.attractiveness(0));
    expect(withShift).toBeGreaterThan(withoutShift);
  });

  test("épocas medidas sin inactivos + A/A determinista (ratio = 1 exacto)", async () => {
    // mode 'none': ambos brazos congelados — cualquier desalineación de brazos
    // (rng, logs, política) rompe el 1.0 exacto; el invariante de inactivos
    // aborta dentro del pipeline si un evento medido referencia un inactivo.
    const r = await runSeedPipeline({
      worldSeed: 123,
      spec: { universeSize: 300, activeAtE0: 240, users: 80, measuredEpochs: 2 },
      mode: "none",
    });
    expect(r.frozenMarginCents).toBeGreaterThan(0);
    expect(Math.abs(r.ratio - 1)).toBeLessThan(1e-9);
  });
});
