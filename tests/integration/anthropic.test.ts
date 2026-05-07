import { describe, it, expect } from "vitest";
import { sendMessage, MODELS } from "@/lib/llm/anthropic";

describe("anthropic client (real API)", () => {
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

  it("caches a long system prompt across two calls", async () => {
    // System block must be >= 4096 tokens for caching to be eligible on Haiku 4.5.
    // "Eres un asistente. " is ~5 tokens; repeat(1000) gives ~5000 tokens — above the threshold.
    const longSystem = "Eres un asistente. ".repeat(1000) + "Responde con UNA palabra.";

    const a = await sendMessage({
      model: MODELS.haiku,
      system: longSystem,
      cacheSystem: true,
      messages: [{ role: "user", content: "Di 'hola'." }],
      maxTokens: 16,
    });

    const b = await sendMessage({
      model: MODELS.haiku,
      system: longSystem,
      cacheSystem: true,
      messages: [{ role: "user", content: "Di 'hola'." }],
      maxTokens: 16,
    });

    // First call may or may not show a cache hit (just-created); second should.
    const cacheRead = b.usage.cache_read_input_tokens ?? 0;
    expect(cacheRead).toBeGreaterThan(0);
  });
});
