import { describe, test, expect } from "vitest";
import { EVENT_TYPES, validatePayload } from "@/sectors/a-tracking/events/schema";

// Valid RFC 4122 v4 UUID (zod 4 enforces version/variant bits)
const validId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

describe("dismiss event schema", () => {
  test("dismiss is in EVENT_TYPES", () => {
    expect(EVENT_TYPES.includes("dismiss")).toBe(true);
  });

  test("valid payload with reason parses", () => {
    const out = validatePayload("dismiss", {
      product_id: validId,
      reason: "not_interested",
    }) as { product_id: string; reason?: string };
    expect(out.product_id).toBe(validId);
    expect(out.reason).toBe("not_interested");
  });

  test("valid payload without reason parses", () => {
    const out = validatePayload("dismiss", { product_id: validId }) as { product_id: string; reason?: string };
    expect(out.product_id).toBe(validId);
  });

  test("invalid product_id rejected", () => {
    expect(() => validatePayload("dismiss", { product_id: "not-uuid" })).toThrow();
  });

  test("invalid reason rejected", () => {
    expect(() =>
      validatePayload("dismiss", { product_id: validId, reason: "bogus" }),
    ).toThrow();
  });
});
