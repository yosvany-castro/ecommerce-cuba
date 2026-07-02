import { describe, test, expect } from "vitest";
import { deepseekFlashProvider, deepseekProProvider, defaultProvider } from "@/lib/llm/providers";

describe("LLM providers (real API)", () => {
  test("deepseekFlashProvider responds to a minimal ping with usage data", async () => {
    const res = await deepseekFlashProvider.chat({
      system: "Reply with the single word OK and nothing else.",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 10,
      temperature: 0,
    });
    expect(res.text.trim().length).toBeGreaterThan(0);
    // The system says "Reply with the single word OK". Verify the response is short
    // and contains "OK" — a generic non-empty string would pass with previous assertion alone.
    expect(res.text.trim().toUpperCase()).toContain("OK");
    expect(res.text.trim().length).toBeLessThanOrEqual(20);
    expect(res.usage.input_tokens).toBeGreaterThan(0);
    expect(res.usage.output_tokens).toBeGreaterThan(0);
    // thinking:"disabled" must hold on v4-flash: a one-word answer with reasoning
    // burn would show dozens-hundreds of completion tokens, not single digits.
    expect(res.usage.output_tokens).toBeLessThanOrEqual(10);
  }, 15_000);

  test("deepseekProProvider (thinking enabled) answers with usage data", async () => {
    const res = await deepseekProProvider.chat({
      system: "Reply with the single word OK and nothing else.",
      messages: [{ role: "user", content: "ping" }],
      // maxTokens covers reasoning + answer on thinking models; keep headroom.
      maxTokens: 1024,
      temperature: 0,
    });
    expect(res.text.trim().toUpperCase()).toContain("OK");
    expect(res.usage.input_tokens).toBeGreaterThan(0);
    expect(res.usage.output_tokens).toBeGreaterThan(0);
  }, 60_000);

  test("defaultProvider is deepseekFlashProvider on v4", () => {
    expect(defaultProvider).toBe(deepseekFlashProvider);
    expect(defaultProvider.name).toBe("deepseek-v4-flash");
  });
});
