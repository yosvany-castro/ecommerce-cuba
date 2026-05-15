import { describe, test, expect } from "vitest";
import { eventInputSchema, validatePayload, EVENT_TYPES, type EventType } from "@/sectors/a-tracking/events/schema";

// RFC 4122 v4 UUIDs (zod 4 enforces strict version/variant bits)
const validId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const orderId = "b1234567-89ab-4cde-8abc-123456789012";
const validIso = "2026-05-07T10:00:00.000Z";

const validCases: Record<EventType, unknown> = {
  product_view:    { product_id: validId, source: "home" },
  add_to_cart:     { product_id: validId, quantity: 2 },
  remove_from_cart:{ product_id: validId, quantity: 1 },
  add_to_wishlist: { product_id: validId },
  purchase:        { order_id: orderId, product_ids: [validId], total_cents: 1500 },
  search:          { raw_query: "zapatillas", results_count: 12, method: "like" },
  product_dwell:   { product_id: validId, dwell_ms: 35000 },
  category_click:  { category: "ropa" },
  filter_applied:  { filter_type: "price", filter_value: "low" },
  page_view:       { path: "/products/123" },
  session_start:   {},
  session_end:     { duration_ms: 60000 },
  dismiss:         { product_id: validId, reason: "not_interested" },
};

describe("eventInputSchema (envelope)", () => {
  test("accepts valid envelope", () => {
    const r = eventInputSchema.parse({
      event_type: "page_view",
      occurred_at: validIso,
      payload: { path: "/" },
    });
    expect(r.event_type).toBe("page_view");
    expect(r.client_event_id).toBeUndefined();
  });

  test("rejects unknown event_type", () => {
    expect(() => eventInputSchema.parse({
      event_type: "fake_event",
      occurred_at: validIso,
      payload: {},
    })).toThrow();
  });

  test("rejects malformed occurred_at", () => {
    expect(() => eventInputSchema.parse({
      event_type: "page_view",
      occurred_at: "2026/05/07",
      payload: { path: "/" },
    })).toThrow();
  });

  test("accepts optional client_event_id (uuid)", () => {
    const r = eventInputSchema.parse({
      client_event_id: validId,
      event_type: "page_view",
      occurred_at: validIso,
      payload: { path: "/" },
    });
    expect(r.client_event_id).toBe(validId);
  });

  test("rejects non-uuid client_event_id", () => {
    expect(() => eventInputSchema.parse({
      client_event_id: "not-a-uuid",
      event_type: "page_view",
      occurred_at: validIso,
      payload: { path: "/" },
    })).toThrow();
  });
});

describe("validatePayload — happy path for every event_type", () => {
  test.each(EVENT_TYPES)("%s: valid payload parses", (eventType) => {
    const payload = validCases[eventType];
    expect(() => validatePayload(eventType, payload)).not.toThrow();
  });
});

describe("validatePayload — invalid payloads reject", () => {
  test("product_view: missing product_id rejected", () => {
    expect(() => validatePayload("product_view", { source: "home" })).toThrow();
  });
  test("product_view: invalid source rejected", () => {
    expect(() => validatePayload("product_view", { product_id: validId, source: "weird" })).toThrow();
  });
  test("add_to_cart: quantity 0 rejected", () => {
    expect(() => validatePayload("add_to_cart", { product_id: validId, quantity: 0 })).toThrow();
  });
  test("product_dwell: dwell_ms < 30000 rejected", () => {
    expect(() => validatePayload("product_dwell", { product_id: validId, dwell_ms: 29999 })).toThrow();
  });
  test("purchase: empty product_ids rejected", () => {
    expect(() => validatePayload("purchase", { order_id: orderId, product_ids: [], total_cents: 0 })).toThrow();
  });
  test("search: negative results_count rejected", () => {
    expect(() => validatePayload("search", { raw_query: "x", results_count: -1, method: "like" })).toThrow();
  });
  test("page_view: empty path rejected", () => {
    expect(() => validatePayload("page_view", { path: "" })).toThrow();
  });
});
