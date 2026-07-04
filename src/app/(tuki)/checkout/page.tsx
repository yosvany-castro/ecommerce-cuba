"use client";
// /checkout — checkout anónimo Tuki (4 pasos). El carrito vive en el cliente
// (useTukiCart); la orden real se crea vía POST /api/checkout/anonymous.
import { CheckoutFlow } from "@/components/tuki/CheckoutFlow";

export default function CheckoutPage() {
  return <CheckoutFlow />;
}
