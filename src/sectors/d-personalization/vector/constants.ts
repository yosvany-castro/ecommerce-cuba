import type { EventType } from "@/sectors/a-tracking/events/schema";

/**
 * Weight applied to each event type when updating the user vector.
 * Events with weight 0 are tracked for cohort signals but do not move the vector.
 * `dismiss` will be added to EventType in T8 and is already accounted for here
 * (weight 0 because it feeds excluded_products, not the vector).
 */
export const EVENT_WEIGHTS: Record<EventType | "dismiss", number> = {
  purchase: 5.0,
  add_to_cart: 3.0,
  add_to_wishlist: 2.0,
  product_dwell: 1.5,
  product_view: 1.0,
  category_click: 0.5,
  remove_from_cart: 0,
  search: 0,
  filter_applied: 0,
  page_view: 0,
  session_start: 0,
  session_end: 0,
  dismiss: 0, // dismiss feeds excluded_products, not the vector
};

export const TAU_PROFILE_DAYS = 60;
export const TAU_SESSION_MINUTES = 30;
export const KAPPA = 10;
