import { describe, test, expect } from "vitest";
import { deepseekFlashProvider, defaultProvider } from "@/lib/llm/providers";

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
  }, 15_000);

  test("defaultProvider is deepseekFlashProvider", () => {
    expect(defaultProvider).toBe(deepseekFlashProvider);
    expect(defaultProvider.name).toBe("deepseek-chat");
  });
});
