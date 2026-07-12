// src/sectors/a-tracking/checkout-schema.ts — zod de items compartido entre
// /api/checkout y /api/checkout/anonymous. Un solo lugar para la selección
// color/size (antes cada ruta tenía su propio z.object() de items inline).
import { z } from "zod";

const colorSizeShape = {
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
};

// Item del checkout anónimo: el precio SIEMPRE se re-lee server-side (nunca
// del cliente) — este schema solo valida forma, jamás precio.
export const anonymousCheckoutItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(999),
  ...colorSizeShape,
});

// Item del checkout autenticado: sin quantity (esa viene de cart_items en
// DB) — solo la selección color/size del carrito local, cruzada por
// product_id (ver CheckoutInput en ./checkout.ts).
export const variantSelectionSchema = z.object({
  product_id: z.string().uuid(),
  ...colorSizeShape,
});
