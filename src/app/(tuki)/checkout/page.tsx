// /checkout — checkout anónimo Tuki. El carrito vive en el cliente
// (useTukiCart); la orden real se crea vía POST /api/checkout/anonymous.
// Server component solo para leer el país por IP: desde Cuba el flujo salta
// la facturación y ofrece "link para familiar" (?pais=CU lo fuerza en local).
import { CheckoutFlow } from "@/components/tuki/CheckoutFlow";
import { visitorCountry } from "@/lib/geo";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ pais?: string }> }) {
  const { pais } = await searchParams;
  return <CheckoutFlow fromCuba={(await visitorCountry(pais)) === "CU"} />;
}
