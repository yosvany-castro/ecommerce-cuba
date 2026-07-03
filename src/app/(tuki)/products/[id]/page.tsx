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
  const combos = sections.find((s) => s.section_type === "cross_sell")?.items ?? [];
  const { src } = await searchParams;
  const source = (src && SOURCES.has(src) ? src : "direct") as CardSource;

  return <ProductView card={card} description={product.description} combos={combos} source={source} />;
}
