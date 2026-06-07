import { describe, test, expect, vi } from "vitest";
import { llmRerank, type LlmCandidate } from "@/thesis/rerank/llm-reranker";
import * as providers from "@/lib/llm/providers";

const cands: LlmCandidate[] = [
  { product_id: "11111111-1111-1111-1111-111111111111", title: "Funda iPhone", price_cents: 1900, brand: "Spigen", category: "accesorios_tech", npmi_to_last_viewed: 0.5, source: "npmi" },
  { product_id: "22222222-2222-2222-2222-222222222222", title: "Vestido de noche", price_cents: 8900, brand: "Zara", category: "moda_mujer", npmi_to_last_viewed: 0, source: "popular" },
  { product_id: "33333333-3333-3333-3333-333333333333", title: "Cargador USB-C", price_cents: 2200, brand: "Anker", category: "accesorios_tech", npmi_to_last_viewed: 0.4, source: "npmi" },
];

describe("llmRerank (real DeepSeek)", () => {
  test("returns a full permutation of the candidate ids (valid shape)", async () => {
    const r = await llmRerank(cands, { profile_summary: "hombre adulto, tecnología", is_gift: false, recipient_summary: null, last_viewed: "iPhone 15 Pro" });
    expect([...r.order].sort()).toEqual(cands.map((c) => c.product_id).sort());
  }, 60_000);

  test("provider error → counted fallback, input order preserved", async () => {
    // The DeepSeek client is a singleton that caches the API key at first use, so
    // rotating the env var mid-process doesn't reinitialize it. Instead we spy on
    // defaultProvider.chat to simulate a network/auth rejection — this reliably
    // exercises the catch branch and the usedFallback contract regardless of
    // which test runs first.
    const spy = vi.spyOn(providers.defaultProvider, "chat").mockRejectedValueOnce(
      new Error("401 Unauthorized — invalid API key (simulated for fallback test)"),
    );
    try {
      const r = await llmRerank(cands, { profile_summary: "x", is_gift: false, recipient_summary: null, last_viewed: null });
      expect(r.usedFallback).toBe(true);
      expect(r.order).toEqual(cands.map((c) => c.product_id));
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});
