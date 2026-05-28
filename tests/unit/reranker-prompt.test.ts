import { describe, test, expect } from "vitest";
import {
  PROMPT_VERSION,
  RERANKER_SYSTEM_PROMPT,
} from "@/sectors/d-personalization/reranker/prompt";

describe("reranker prompt", () => {
  test("PROMPT_VERSION matches semver-fase3c pattern", () => {
    expect(PROMPT_VERSION).toMatch(/^v\d+\.\d+\.\d+-fase3c$/);
  });

  test("RERANKER_SYSTEM_PROMPT non-empty and mentions key rules", () => {
    expect(RERANKER_SYSTEM_PROMPT.length).toBeGreaterThan(200);
    expect(RERANKER_SYSTEM_PROMPT.toLowerCase()).toContain("razón");
    expect(RERANKER_SYSTEM_PROMPT.toLowerCase()).toContain("prohibido");
  });

  test("RERANKER_SYSTEM_PROMPT specifies JSON shape", () => {
    expect(RERANKER_SYSTEM_PROMPT).toContain("product_id");
    expect(RERANKER_SYSTEM_PROMPT).toContain("rank");
    expect(RERANKER_SYSTEM_PROMPT).toContain("reason");
    expect(RERANKER_SYSTEM_PROMPT).toContain("items");
  });
});
