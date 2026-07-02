import { describe, expect, it } from "vitest";
import { runSeedPipeline } from "@/sectors/g-agents/sim/engine";
import type { WorldSpec } from "@/sectors/g-agents/sim/constants";

/**
 * Fase D ataque 1 (blueprint §7.1-7.2): A/A y null-agent. Si dos brazos
 * IDÉNTICOS divergen, el harness fabrica diferencias y nada del gate vale.
 * Mundo mínimo y seed 123 (jamás los del gate).
 */

const SPEC: WorldSpec = { universeSize: 800, activeAtE0: 640, users: 120, measuredEpochs: 2 };

describe("harness A/A (ataque 1)", () => {
  it("A/A: ambos brazos frozen ⇒ margen bit-idéntico por época (ratio 1.0 exacto)", async () => {
    const r = await runSeedPipeline({ worldSeed: 123, spec: SPEC, mode: "none", aa: true });
    // CRN (mismo seed de comportamiento en ambos brazos) ⇒ la igualdad es
    // EXACTA, no estadística: cualquier delta = asimetría de brazos.
    expect(r.agentMarginCents).toBe(r.frozenMarginCents);
    expect(r.trajectories.agent).toEqual(r.trajectories.frozen);
    expect(r.ratio).toBe(1);
    expect(r.frontiers).toHaveLength(0); // A/A jamás corre la frontera del agente
  }, 60_000);

  it("null-agent: frontera que no propone nada ⇒ ratio en banda A/A [0.97, 1.03]", async () => {
    const r = await runSeedPipeline({
      worldSeed: 123,
      spec: SPEC,
      mode: "llm",
      llmRunner: async () => ({ proposals: [], truncated: false, cached: true }),
    });
    // La frontera corre (readMetrics + holdout activo) pero no escribe: si el
    // solo hecho de medir o etiquetar holdout mueve el ratio, hay fuga.
    expect(r.frontiers).toHaveLength(SPEC.measuredEpochs);
    expect(r.frontiers.every((f) => !f.storeChanged)).toBe(true);
    expect(r.ratio).toBeGreaterThanOrEqual(0.97);
    expect(r.ratio).toBeLessThanOrEqual(1.03);
  }, 60_000);
});
