import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getById } from "@/sectors/b-catalog/repository/products";
import { getProductSections } from "@/storefront/pages/product";
import { toCard } from "@/storefront/map";
import { imgSrc } from "@/lib/img";
import { ProductView, ProductRails } from "@/components/tuki/ProductView";
import type { CardSource } from "@/components/tuki/ProductCard";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = new Set(["home", "category", "search"]);

// Rieles de recomendación bajo los detalles, en orden de slot: similar (8),
// cross_sell (10), upsell (30) — ver 0026/0035. RSC async: la page lo pasa
// dentro de <Suspense> para que el producto (LCP) streamee SIN esperar el
// compose+resolve de la superficie pdp.
const RAIL_TYPES = new Set(["similar", "cross_sell", "upsell"]);
async function Rails({ id, category }: { id: string; category: string | null }) {
  const sections = await getProductSections(id, category);
  const rails = sections.filter((s) => RAIL_TYPES.has(s.section_type) && s.items.length > 0);
  return <ProductRails rails={rails} />;
}

const SHIMMER = {
  background: "linear-gradient(90deg,#E9E9E4 25%,#DFDFD9 40%,#E9E9E4 55%)",
  backgroundSize: "460px 100%",
  animation: "shimmer 1.1s linear infinite",
} as const;

function RailsFallback() {
  return (
    <div style={{ marginTop: 44, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
      {[1, 0.8, 0.6, 0.4].map((op, i) => (
        <div key={i} style={{ height: 220, borderRadius: 20, opacity: op, ...SHIMMER }} />
      ))}
    </div>
  );
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ src?: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const product = await getById(id);
  if (!product) return notFound();

  const category = (product.metadata as { category?: string } | null)?.category ?? null;
  const baseCard = toCard(product); // category ← metadata.category (single source)
  // La PDP muestra la foto GRANDE: variante 640 del CDN (toCard da la de card, 350)
  const card = { ...baseCard, image_url: imgSrc(product.image_url, product.source, 640) };
  const { src } = await searchParams;
  const source = (src && SOURCES.has(src) ? src : "direct") as CardSource;
  // Días tienda→depósito del proveedor (0036): acortan el rango de entrega.
  const providerShipDays =
    product.provider_ship_min_days != null && product.provider_ship_max_days != null
      ? { min: product.provider_ship_min_days, max: product.provider_ship_max_days }
      : null;

  return (
    <ProductView
      card={card}
      description={product.description}
      railsSlot={
        <Suspense fallback={<RailsFallback />}>
          <Rails id={id} category={category} />
        </Suspense>
      }
      source={source}
      providerShipDays={providerShipDays}
    />
  );
}
