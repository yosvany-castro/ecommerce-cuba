// CONTRACT TEST: this schema MUST mirror the one in src/app/api/admin/searches/route.ts.
// Extracted here so we can unit-test validation without going through the auth0 layer (banned mock).
import { describe, test, expect } from "vitest";
import { z } from "zod";

// We re-derive the schema here to avoid importing the route module which has side effects.
// This must mirror the schema in src/app/api/admin/searches/route.ts.
const queryParamSchema = z.object({
  from: z.string().datetime().optional().transform((s) => (s ? new Date(s) : undefined)),
  to: z.string().datetime().optional().transform((s) => (s ? new Date(s) : undefined)),
  hit_cache: z.enum(["true", "false"]).optional().transform((s) => (s === undefined ? undefined : s === "true")),
  method: z.enum(["hybrid_rrf", "bm25_only", "cosine_only"]).optional(),
  page: z.string().regex(/^\d+$/).optional().transform((s) => (s ? Math.max(1, parseInt(s, 10)) : undefined)),
  limit: z.string().regex(/^\d+$/).optional().transform((s) => (s ? Math.min(200, parseInt(s, 10)) : undefined)),
});

describe("admin/searches route — query param validation", () => {
  test("rejects invalid method", () => {
    const r = queryParamSchema.safeParse({ method: "invalid_value" });
    expect(r.success).toBe(false);
  });

  test("rejects non-datetime from", () => {
    const r = queryParamSchema.safeParse({ from: "2026/05/07" });
    expect(r.success).toBe(false);
  });

  test("rejects non-numeric page", () => {
    const r = queryParamSchema.safeParse({ page: "abc" });
    expect(r.success).toBe(false);
  });

  test("accepts valid combination", () => {
    const r = queryParamSchema.safeParse({
      method: "hybrid_rrf",
      hit_cache: "true",
      page: "2",
      limit: "20",
      from: "2026-01-01T00:00:00Z",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.method).toBe("hybrid_rrf");
      expect(r.data.hit_cache).toBe(true);
      expect(r.data.page).toBe(2);
      expect(r.data.limit).toBe(20);
      expect(r.data.from).toBeInstanceOf(Date);
    }
  });

  test("clamps limit to max 200", () => {
    const r = queryParamSchema.safeParse({ limit: "500" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(200);
  });

  test("clamps page to min 1", () => {
    const r = queryParamSchema.safeParse({ page: "0" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.page).toBe(1);
  });
});
