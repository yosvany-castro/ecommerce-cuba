import { describe, test, expect } from "vitest";
import { DEFAULT_THETA, getSemanticCacheTheta } from "@/sectors/c-search/cache/semantic";

describe("getSemanticCacheTheta", () => {
  test("defaults to DEFAULT_THETA when env var is absent or empty", () => {
    expect(getSemanticCacheTheta({})).toBe(DEFAULT_THETA);
    expect(getSemanticCacheTheta({ SEMANTIC_CACHE_THRESHOLD: "" })).toBe(DEFAULT_THETA);
    expect(getSemanticCacheTheta({ SEMANTIC_CACHE_THRESHOLD: "  " })).toBe(DEFAULT_THETA);
  });

  test("parses a valid override", () => {
    expect(getSemanticCacheTheta({ SEMANTIC_CACHE_THRESHOLD: "0.87" })).toBe(0.87);
    expect(getSemanticCacheTheta({ SEMANTIC_CACHE_THRESHOLD: "1" })).toBe(1);
  });

  test("rejects values that would disable or break the threshold", () => {
    // θ≤0 would make every cached row a hit; θ>1 is unsatisfiable for cosine.
    expect(getSemanticCacheTheta({ SEMANTIC_CACHE_THRESHOLD: "0" })).toBe(DEFAULT_THETA);
    expect(getSemanticCacheTheta({ SEMANTIC_CACHE_THRESHOLD: "-0.5" })).toBe(DEFAULT_THETA);
    expect(getSemanticCacheTheta({ SEMANTIC_CACHE_THRESHOLD: "1.5" })).toBe(DEFAULT_THETA);
    expect(getSemanticCacheTheta({ SEMANTIC_CACHE_THRESHOLD: "abc" })).toBe(DEFAULT_THETA);
    expect(getSemanticCacheTheta({ SEMANTIC_CACHE_THRESHOLD: "NaN" })).toBe(DEFAULT_THETA);
    expect(getSemanticCacheTheta({ SEMANTIC_CACHE_THRESHOLD: "Infinity" })).toBe(DEFAULT_THETA);
  });
});
