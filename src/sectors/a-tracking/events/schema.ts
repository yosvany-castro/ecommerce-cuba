import { z } from "zod";

export const EVENT_TYPES = [
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "add_to_wishlist",
  "purchase",
  "search",
  "product_dwell",
  "category_click",
  "filter_applied",
  "page_view",
  "session_start",
  "session_end",
  "dismiss",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const uuid = z.string().uuid();

export const PAYLOAD_SCHEMAS = {
  product_view: z.object({
    product_id: uuid,
    source: z.enum(["home", "category", "search", "direct"]),
  }),
  add_to_cart: z.object({ product_id: uuid, quantity: z.number().int().min(1) }),
  remove_from_cart: z.object({ product_id: uuid, quantity: z.number().int().min(1) }),
  add_to_wishlist: z.object({ product_id: uuid }),
  purchase: z.object({
    order_id: uuid,
    product_ids: z.array(uuid).min(1),
    total_cents: z.number().int().min(0),
  }),
  search: z.object({
    raw_query: z.string().min(1),
    results_count: z.number().int().min(0),
    method: z.enum(["like", "bm25_only", "cosine_only", "hybrid_rrf"]),
  }),
  product_dwell: z.object({
    product_id: uuid,
    dwell_ms: z.number().int().min(30000),
  }),
  category_click: z.object({ category: z.string().min(1) }),
  filter_applied: z.object({
    filter_type: z.string().min(1),
    filter_value: z.union([z.string(), z.number()]),
  }),
  page_view: z.object({ path: z.string().min(1) }),
  session_start: z.object({}).strict(),
  session_end: z.object({ duration_ms: z.number().int().min(0) }),
  dismiss: z.object({
    product_id: uuid,
    reason: z
      .enum(["not_interested", "already_have", "wrong_recipient", "other"])
      .optional(),
  }),
} as const satisfies Record<EventType, z.ZodTypeAny>;

export const eventInputSchema = z.object({
  client_event_id: uuid.optional(),
  event_type: z.enum(EVENT_TYPES),
  occurred_at: z.string().datetime(),
  payload: z.unknown(),
});

export type EventInput = z.infer<typeof eventInputSchema>;

export function validatePayload(eventType: EventType, payload: unknown) {
  return PAYLOAD_SCHEMAS[eventType].parse(payload);
}
