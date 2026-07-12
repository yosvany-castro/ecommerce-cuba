import { notFound } from "next/navigation";
import { getById } from "@/sectors/b-catalog/repository/products";
import { getProductSections } from "@/storefront/pages/product";
import { toCard } from "@/storefront/map";
import { ProductView } from "@/components/tuki/ProductView";
import type { CardSource } from "@/components/tuki/ProductCard";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = new Set(["home", "category", "search"]);

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
  const card = toCard(product); // category ← metadata.category (single source)
  const sections = await getProductSections(id, category);
  // Rieles de recomendación bajo los detalles, en orden de slot: similar (8),
  // cross_sell (10), upsell (30) — ver 0026/0035. Secciones vacías no llegan.
  const RAIL_TYPES = new Set(["similar", "cross_sell", "upsell"]);
  const rails = sections.filter((s) => RAIL_TYPES.has(s.section_type) && s.items.length > 0);
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
      rails={rails}
      source={source}
      providerShipDays={providerShipDays}
    />
  );
}
