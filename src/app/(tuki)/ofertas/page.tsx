// /ofertas — las ofertas del día (rotan cada noche, cron:ofertas). Descuentos
// REALES del proveedor; la ruta que el bento promete con "ver las N ofertas →".
import { getDailyOffers } from "@/storefront/pages/offers";
import { CategoryView } from "@/components/tuki/CategoryView";

export const dynamic = "force-dynamic";

export default async function OfertasPage() {
  const { cards, total } = await getDailyOffers();
  return (
    <CategoryView
      cards={cards}
      header={{
        crumb: "Ofertas",
        title: "Ofertas del día",
        why: `${total} descuentos reales — rotan a medianoche`,
        deep: "#A2683B",
        tint: "#FBEFE2",
      }}
    />
  );
}
