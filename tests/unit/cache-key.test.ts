import { describe, test, expect } from "vitest";
import { buildRerankCacheKey } from "@/sectors/d-personalization/reranker/cache-key";
import { PROMPT_VERSION } from "@/sectors/d-personalization/reranker/prompt";

describe("buildRerankCacheKey", () => {
  const validProfileId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  test("returns 64-char hex sha256", () => {
    const key = buildRerankCacheKey(validProfileId, ["id-1", "id-2", "id-3"]);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  test("same inputs (different order) yield SAME hash (sort-independent)", () => {
    const k1 = buildRerankCacheKey(validProfileId, ["a", "b", "c"]);
    const k2 = buildRerankCacheKey(validProfileId, ["c", "a", "b"]);
    const k3 = buildRerankCacheKey(validProfileId, ["b", "c", "a"]);
    expect(k1).toBe(k2);
    expect(k1).toBe(k3);
  });

  test("different profile_id yields different hash", () => {
    const k1 = buildRerankCacheKey(validProfileId, ["a", "b"]);
    const k2 = buildRerankCacheKey(
      "b1234567-89ab-4cde-8abc-123456789012",
      ["a", "b"],
    );
    expect(k1).not.toBe(k2);
  });

  test("different ids set yields different hash", () => {
    const k1 = buildRerankCacheKey(validProfileId, ["a", "b"]);
    const k2 = buildRerankCacheKey(validProfileId, ["a", "c"]);
    expect(k1).not.toBe(k2);
  });

  test("PROMPT_VERSION matches expected pattern (sanity for cache invalidation)", () => {
    expect(PROMPT_VERSION).toMatch(/^v\d+\.\d+\.\d+-fase3c$/);
    const k = buildRerankCacheKey(validProfileId, ["a"]);
    expect(k.length).toBe(64);
  });
});
