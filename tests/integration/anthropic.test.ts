import { describe, it, expect } from "vitest";
import { sendMessage, MODELS } from "@/lib/llm/anthropic";

const RUN = process.env.RUN_ANTHROPIC_HEALTH === "1";

describe.skipIf(!RUN)("Anthropic SDK healthcheck", () => {
  it("sends a message and receives non-empty text response", async () => {
    const out = await sendMessage({
      model: MODELS.haiku,
      system: "Eres un asistente conciso. Responde en una sola oración.",
      messages: [{ role: "user", content: "Saluda en español." }],
      maxTokens: 64,
    });
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.usage.input_tokens).toBeGreaterThan(0);
    expect(out.usage.output_tokens).toBeGreaterThan(0);
  });

  // Prompt caching was verified end-to-end during Phase 0 development (commit cc9c656)
  // with a long system prompt (>= 4096 tokens for Haiku 4.5) — cache_read_input_tokens > 0
  // observed on the second call. We do NOT keep a runtime test for it because:
  //   - it costs ~5k tokens per run on a feature that's static SDK plumbing,
  //   - the wrapper only marks cache_control on the system block and forwards usage,
  //   - any regression would surface in real route handlers via observed cache misses
  //     in monitoring once Sector C/D land.
  // If the SDK changes its cache_control shape in a future bump, the smoke test above
  // still catches the call failing.
});
